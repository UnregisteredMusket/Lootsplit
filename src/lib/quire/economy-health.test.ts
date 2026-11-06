// Economy health (owner-approved 2026-11-05): the classification of a fixture campaign built with
// the real commands, conservation (faucets − sinks + transfers + unclassified = change in party
// coins, per session and for the campaign), in-game weeks, net worth with unidentified items at
// their presented value, the advisory wealth guide, deferred archives and older lines.
import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, type Command } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { encounterCoinLine } from "./award-tag.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readFinance } from "./finance.ts";
import { readJournal } from "./journal.ts";
import { fromCopper, toCopper } from "./money.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { economyHealth, netWorth, partyPurses, srdStartingGold, type PeriodFlows } from "./economy-health.ts";
import type { LedgerLine, Purse } from "./types.ts";

const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
let n = 0;
const run = (t: CloudTable, cmd: Record<string, unknown>) => applyCommand(t, dm, { id: `cmd-${++n}`, ...cmd } as Command);
/** A line written outside the commands (an older client, a trade leg): coins move with it. */
function push(t: CloudTable, line: Omit<LedgerLine, "at" | "shopId"> & Partial<LedgerLine>) {
  const p = t.purses.find((x) => x.id === line.purseId)!;
  p.coins = fromCopper(toCopper(p.coins) + line.copper);
  t.ledger.push({ at: Date.now(), shopId: null, ...line });
}
const partyCoins = (t: CloudTable) => {
  const party = partyPurses(t);
  return t.purses.filter((p) => party.has(p.id)).reduce((s, p) => s + toCopper(p.coins), 0);
};
/** Conservation: what the view classifies adds up to the change of party coins on the ledger. */
const conserved = (p: PeriodFlows) => p.faucetTotal - p.sinkTotal + p.transfers.net + p.unclassified.net;

function fixture() {
  const aria: Purse = { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(2000) };
  aria.sheet = { ...characterSheet(aria, []), level: 5 } as Purse["sheet"];
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: [
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(10_000) },
      aria,
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: fromCopper(1000) },
      { id: "dunstan", name: "Dunstan the porter", kind: "character", control: "npc", coins: fromCopper(500) },
      { id: "treasury", name: "Exchange treasury", kind: "character", control: "npc", coins: fromCopper(50_000) },
    ],
    holdings: [
      { id: "sword", purseId: "aria", name: "Longsword", kind: "item", quantity: 1, unitCopper: 2000, notes: "", category: "smith" },
      { id: "gem", purseId: "bram", name: "Star ruby", kind: "item", quantity: 1, unitCopper: 50_000, notes: "", unidentified: { name: "Red stone", value: 1000 } },
      { id: "vial", purseId: "hoard", name: "Potion of giant strength", kind: "item", quantity: 2, unitCopper: 30_000, notes: "", unidentified: { name: "Cloudy vial" } },
      { id: "deed", purseId: "hoard", name: "Mill", kind: "property", quantity: 1, unitCopper: 100_000, notes: "" },
      { id: "npc-axe", purseId: "dunstan", name: "Axe", kind: "item", quantity: 1, unitCopper: 900, notes: "" },
    ],
    shops: [
      { id: "marlow", name: "Marlow's Forge", keeper: "", place: "Port Ashby", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "smith", priceScale: 1, acceptedCategories: ["smith"] },
    ],
    stock: [{ id: "rope", shopId: "marlow", name: "Rope", copper: 100, baseCopper: 100, rarity: "common", quantity: 20, notes: "", category: "smith" }],
    journal: readJournal({ finance: readFinance() }),
  };
  const start = partyCoins(t);

  // Session 1.
  t = run(t, { kind: "session", name: "Tolls of the Weir", end: false });
  t = run(t, { kind: "coin-split", sourceId: "hoard", copper: 300, recipientIds: ["aria", "bram"], remainder: { rule: "party-fund", purseId: "hoard" }, expect: { share: 150, remainderTo: null } });
  t = run(t, { kind: "give", fromId: "bram", toId: "aria", copper: 50, holdingId: null, quantity: 0 });
  t = run(t, { kind: "give", fromId: "aria", toId: "dunstan", copper: 25, holdingId: null, quantity: 0 });
  t = run(t, { id: "mayor", kind: "post", purseId: "hoard", copper: 500, summary: "Reward from the mayor" });
  t = run(t, { kind: "post", purseId: "bram", copper: -120, summary: "Bribe to the gate guard" });
  t = run(t, { kind: "set-coins", purseId: "aria", before: t.purses.find((p) => p.id === "aria")!.coins, coins: fromCopper(toCopper(t.purses.find((p) => p.id === "aria")!.coins) + 10) });
  t = run(t, { kind: "buy", stockId: "rope", purseId: "aria", quantity: 2 });
  t = run(t, { kind: "sell", holdingId: "sword", shopId: "marlow", quantity: 1 });
  push(t, encounterCoinLine("award-1", Date.now(), "bram", "Weir bandits", 700));
  t = run(t, { kind: "finance-loan", terms: { name: "Guild loan", purseId: "aria", lenderId: "", rateBps: 0, periodDays: 10, compound: false, payment: 100 }, principal: 1000 });
  t = run(t, { kind: "finance-rule", rule: { id: "mill-income", name: "Mill takings", purseId: "hoard", kind: "income", copper: 400, periodDays: 10, holdingId: "", active: true } });
  t = run(t, { kind: "finance-rule", rule: { id: "mill-wage", name: "Miller's wage", purseId: "hoard", kind: "expense", copper: 150, periodDays: 10, holdingId: "", active: true } });
  // A trade at an exchange: the owner leg is the party's, the treasury leg is not.
  push(t, { id: "trade-1-owner", purseId: "bram", copper: -300, summary: "Exchange: bought 1 crate of salt", transactionType: "purchase", trade: { receiptId: "trade-1", leg: "owner" } });
  push(t, { id: "trade-1-treasury", purseId: "treasury", copper: 300, summary: "Exchange: bought 1 crate of salt", transactionType: "transfer", trade: { receiptId: "trade-1", leg: "treasury" } });
  // Older lines: a legacy Give pair (no kind), and a line nothing recognises.
  push(t, { id: "old-give", purseId: "bram", copper: -40, summary: "Transfer sent" });
  push(t, { id: "old-give-received", purseId: "hoard", copper: 40, summary: "Transfer received" });
  push(t, { id: "odd", purseId: "bram", copper: 7, summary: "Mysterious windfall" });
  const afterOne = partyCoins(t);
  t = run(t, { kind: "session", name: "Tolls of the Weir", end: true });

  // Downtime of 10 days, applied as Session 2 starts: income, wage, loan installment.
  t = run(t, { kind: "downtime-plan", days: 10, name: "Harvest" });
  t = run(t, { kind: "session", name: "The Drowned Vault", end: false, downtimeId: t.journal!.finance!.downtime.at(-1)!.id });
  t = run(t, { kind: "finance-repay", loanId: t.journal!.finance!.loans[0]!.id, copper: 100 });
  t = run(t, { id: "buy-2", kind: "buy", stockId: "rope", purseId: "bram", quantity: 1 });
  const line = t.ledger.find((l) => l.id === "buy-2")!;
  t = run(t, { kind: "ledger-void", target: { kind: "ledger", id: line.id }, before: canonicalJson(line), reason: "Bought by mistake." });
  // A device gift whose recipient is credited later: one side only.
  push(t, { id: "gift-1", purseId: "aria", copper: -30, summary: "Gave Bram Ironfoot 3 sp", transactionType: "transfer" });
  // The DM linked the mayor's reward to a quest (only its reward links matter here).
  t.journal!.quests = { quests: [{ rewardLinks: [{ kind: "ledger", id: "mayor" }] }] } as never;
  return { t, start, afterOne };
}

test("every party line of the fixture campaign is classified, and coins are conserved per session", () => {
  const { t, start, afterOne } = fixture();
  const view = economyHealth(t);
  const [one, two] = view.sessions.filter((s) => s.kind === "session");
  assert.equal(one!.label, "Session 1 · Tolls of the Weir");
  assert.equal(one!.inProgress, false);
  assert.equal(two!.inProgress, true);

  // Session 1, by category.
  assert.equal(one!.faucets.quests, 500, "the DM's posting linked to a quest is a quest reward");
  assert.equal(one!.faucets.grants, 10, "a direct coin edit upwards is a DM grant");
  assert.equal(one!.faucets.sales, 1000, "Marlow buys the sword at half");
  assert.equal(one!.faucets.encounter, 700);
  assert.equal(one!.faucets.loans, 1000);
  assert.equal(one!.sinks.purchases, 200 + 300, "rope and the exchange trade");
  assert.equal(one!.sinks.deductions, 120);
  assert.equal(one!.sinks["to-others"], 25, "Give to an NPC leaves the party");
  assert.equal(one!.transfers.moved, 300 + 50 + 40, "the fund split, Give between characters and an older Give");
  assert.equal(one!.transfers.net, 0);
  assert.deepEqual(one!.unclassified, { count: 1, net: 7 });
  assert.equal(one!.coinChange, afterOne - start);
  assert.equal(conserved(one!), one!.coinChange);

  // Session 2: the downtime settlement, a repayment and a reversed purchase.
  assert.equal(two!.faucets.income, 400);
  assert.equal(two!.sinks.upkeep, 150);
  assert.equal(two!.sinks.repayments, 100 + 100, "the downtime installment and the manual repayment");
  assert.equal(two!.sinks.purchases, 0, "a voided purchase cancels itself");
  assert.equal(two!.unclassified.count, 1, "a Give with no other side is never silently dropped");
  assert.equal(two!.unclassified.net, -30);
  assert.equal(conserved(two!), two!.coinChange);
  assert.equal(two!.coinChange, partyCoins(t) - afterOne);

  // Campaign so far, and nothing from NPCs or the treasury.
  assert.equal(conserved(view.campaign), partyCoins(t) - start);
  assert.equal(view.campaign.coinChange, partyCoins(t) - start);
  assert.ok(view.entries.every((e) => e.lineIds.every((id) => !id.includes("treasury"))));
  assert.deepEqual(view.unclassified.map((e) => e.summary).sort(), ["Gave Bram Ironfoot 3 sp", "Mysterious windfall"]);
});

test("in-game weeks follow the campaign clock: downtime moves later lines into week 2", () => {
  const { t } = fixture();
  const view = economyHealth(t);
  assert.equal(view.day, 10);
  assert.deepEqual(view.weeks.map((w) => w.label), ["Week 1 · days 1–7", "Week 2 · days 8–14"]);
  const [w1, w2] = view.weeks;
  // The settlement belongs to the day it started from (day 0, week 1).
  assert.equal(w1!.faucets.income, 400);
  assert.equal(w2!.sinks.repayments, 100);
  for (const w of view.weeks) assert.equal(conserved(w), w.coinChange);
  assert.equal(w1!.coinChange + w2!.coinChange, view.campaign.coinChange);
});

test("net worth: coins and items of the party, unidentified items at their presented value", () => {
  const { t } = fixture();
  const worth = netWorth(t);
  assert.equal(worth.coins, partyCoins(t));
  // Rope ×2 (aria, 100 each), the gem as players see it (10 gp); the sword was sold, the NPC's axe is not the party's.
  assert.equal(worth.items, 200 + 1000);
  assert.equal(worth.unvalued, 2, "an unidentified item with no presented value is flagged");
  assert.equal(worth.property, 100_000, "properties are listed, not added");
  assert.equal(worth.total, worth.coins + worth.items);
  const view = economyHealth(t);
  assert.deepEqual(view.trend.map((p) => p.label), ["S1", "S2"]);
  assert.deepEqual(view.trend.at(-1)!.worth, worth);
  assert.equal(view.sessions.find((s) => s.number === 1)!.worth!.coins, view.trend[0]!.worth.coins);
});

test("the advisory wealth guide uses the SRD starting gold by level, or the DM's own target", () => {
  const { t } = fixture();
  assert.equal(srdStartingGold(1), 0);
  assert.equal(srdStartingGold(5), 63_750);
  assert.equal(srdStartingGold(11), 637_500);
  assert.equal(srdStartingGold(20), 2_137_500);
  const view = economyHealth(t);
  assert.deepEqual(view.wealth.characters.map((c) => [c.name, c.level, c.guideCopper]), [["Aria Thorne", 5, 63_750], ["Bram Ironfoot", 1, 0]]);
  assert.equal(view.wealth.guideCopper, 63_750);
  const own = economyHealth(t, { targetPerLevel: (level) => level * 1000 });
  assert.equal(own.wealth.guideCopper, 6000);
});

test("archived sessions not loaded are counted, never fetched or guessed; unreadable ones too", () => {
  const { t } = fixture();
  const report = t.journal!.reports![0]!;
  const deferred = { ...t, journal: { ...t.journal!, reports: [{ ...report, snapshot: "", deferred: true as const }] } };
  const view = economyHealth(deferred);
  assert.equal(view.notLoaded, 1);
  const one = view.sessions.find((s) => s.number === 1)!;
  assert.equal(one.unavailable, "not-loaded");
  assert.equal(one.worth, null);
  assert.equal(one.coinChange, 0);
  const broken = economyHealth({ ...t, journal: { ...t.journal!, reports: [{ ...report, id: "x", snapshot: "{oops" }] } });
  assert.equal(broken.unreadable, 1);
});

test("reading is pure: the campaign is not changed and the same view is computed twice", () => {
  const { t } = fixture();
  const before = JSON.stringify(t);
  const a = economyHealth(t);
  const b = economyHealth(t);
  assert.equal(JSON.stringify(t), before);
  assert.deepEqual(a, b);
});

test("an empty or older campaign reads without errors", () => {
  const view = economyHealth({ ...emptyCloudTable(), journal: undefined });
  assert.equal(view.sessions.length, 0);
  assert.equal(view.campaign.coinChange, 0);
  assert.equal(view.notLoaded, 0);
  const legacy = economyHealth({
    ...emptyCloudTable(),
    purses: [{ id: "a", name: "A", kind: "character", coins: fromCopper(0) }],
    ledger: [
      { id: "l1", at: 1, purseId: "a", shopId: "s", summary: "Bought 1 Rope from Marlow", copper: -100 },
      { id: "l2", at: 2, purseId: "a", shopId: null, summary: "Encounter loot: Goblins", copper: 300 },
    ],
  });
  assert.equal(legacy.campaign.sinks.purchases, 100);
  assert.equal(legacy.campaign.faucets.encounter, 300);
  assert.equal(legacy.sessions[0]!.label, "Since the last session");
});
