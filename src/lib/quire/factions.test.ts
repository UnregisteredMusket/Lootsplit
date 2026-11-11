// Factions, Renown and Favor (owner design 2026-11-05, PR A): DM-made factions with a karma-style
// tier ladder, per-character renown and Favor, the party median's tier setting prices at the shops
// a faction controls. These tests pin the logic, the prices (buy and sell, every breakdown adds up
// to the charge), the commands (DM only, revision checks, replay, all-or-nothing, history), the
// device's parity with the shared engine, old data and older clients, and the player projection
// (only visible factions, only the seat's own standing, hidden factions only as "Local standing").
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, readCloudTableForImport, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand, sellToShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { seatView } from "./player-view.ts";
import { fromCopper, toCopper } from "./money.ts";
import { breakdownLines, shopBuyBreakdown, shopSellBreakdown, viewerBreakdown, type PriceBreakdown } from "./price-breakdown.ts";
import { lineEvents } from "./market-events.ts";
import { planSaleSplit, unitSalePrice } from "./sale-split.ts";
import {
  DEFAULT_PRICE_BY_TIER,
  DEFAULT_TIERS,
  defaultFactionDraft,
  factionBuyRate,
  factionEffects,
  factionParty,
  factionSaleRate,
  LOCAL_STANDING_ID,
  medianRenown,
  readFactions,
  tierFor,
  type Faction,
  type FactionDraft,
} from "./factions.ts";
import {
  AWARD_DETAILS_PROTOCOL,
  CURRENT_TABLETOP_PROTOCOL,
  FACTIONS_PROTOCOL,
  tabletopResponse,
} from "./tabletop-protocol.ts";
import type { Holding, Shop, StockLine } from "./types.ts";

// Disposable in-memory D1 stand-in; never a real campaign.
const sql = new DatabaseSync(":memory:");
for (const file of [
  "0001_campaign_rooms.sql",
  "0019_campaign_room_reports.sql",
  "0024_campaign_room_receipts.sql",
  "0026_campaign_room_sections.sql",
  "0029_campaign_room_report_parts.sql",
  "0030_campaign_room_archive_keys.sql",
  "0003_accounts.sql",
  "0008_encounters.sql",
])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${file}`, import.meta.url), "utf8"));
(globalThis as any).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: any[] = [];
      return {
        bind(...args: any[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("FROM play_characters")) return { results: [] };
          return { results: sql.prepare(query).all(...values) };
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } };
        },
      };
    },
  },
};

const shopBase = { keeper: "", place: "", notes: "", buyRate: 0.5, wealth: "modest", priceScale: 1, acceptAnyCategory: true } as const;
const drink: Shop = { ...shopBase, id: "drink", name: "Dead Man's Drink", sellRate: 1, category: "inn", locationId: "docks" };
const smith: Shop = { ...shopBase, id: "smith", name: "Anvil & Sons", sellRate: 1, category: "smith", locationId: "port-city" };
const baker: Shop = { ...shopBase, id: "baker", name: "Riverside Baker", sellRate: 1.1, category: "provisions" };
const line = (id: string, shopId: string, copper: number): StockLine => ({
  id, shopId, name: id, copper, baseCopper: copper, rarity: "common", quantity: null, notes: "",
});
const pc = (id: string, name: string) => ({ id, name, kind: "character" as const, coins: fromCopper(100000) });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      pc("aria", "Aria Thorne"),
      pc("bram", "Bram Ironfoot"),
      pc("cora", "Cora Vale"),
      // Departed: out of the party, so not in the median.
      pc("gone", "Old Wil"),
      { ...pc("npc", "Hired Blade"), control: "npc" as const },
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(0) },
    ],
    holdings: [
      { id: "mug", purseId: "aria", name: "Pewter mug", kind: "item", quantity: 4, unitCopper: 400, notes: "", category: "general" } as Holding,
      { id: "hoard-mug", purseId: "hoard", name: "Pewter mug", kind: "item", quantity: 4, unitCopper: 400, notes: "", category: "general" } as Holding,
    ],
    shops: [drink, smith, baker],
    stock: [line("ale", "drink", 1000), line("blade", "smith", 2000), line("bread", "baker", 333)],
    journal: readJournal({
      finance: { day: 3 },
      market: {
        currentLocationId: "docks",
        locations: [
          { id: "coast", kind: "region", parentId: null, name: "The Coast", description: "" },
          { id: "port-city", kind: "city", parentId: "coast", name: "Port City", description: "" },
          { id: "docks", kind: "area", parentId: "port-city", name: "The Docks", description: "" },
          { id: "uptown", kind: "city", parentId: "coast", name: "Uptown", description: "" },
        ],
      },
      world: {
        characterPositions: [{ purseId: "gone", inParty: false, locationId: null, visible: true, sheetVisible: true }],
      },
    }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const draft = (name: string, controls: FactionDraft["controls"], extra: Partial<FactionDraft> = {}): FactionDraft => ({
  ...defaultFactionDraft(),
  name,
  description: `${name}, as the party knows it.`,
  controls,
  ...extra,
});
const save = (id: string, factionId: string, d: FactionDraft, revision: number | null = null): Command => ({
  id, kind: "faction-save", factionId, revision, faction: d,
});
const reveal = (id: string, factionId: string, revision: number): Command => ({
  id, kind: "faction-visibility", factionId, revision, hidden: false,
});
const renown = (id: string, factionId: string, characters: [string, number][], reason = "Deeds"): Command => ({
  id, kind: "faction-renown", factionId, characters: characters.map(([characterId, delta]) => ({ characterId, delta })), reason,
});
const factionsOf = (t: CloudTable) => readFactions((t.journal as { factions?: unknown }).factions);
const faction = (t: CloudTable, id: string) => factionsOf(t).find((f) => f.id === id)!;
const wallet = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const sum = (b: PriceBreakdown) => b.base.copper + b.factors.reduce((n, f) => n + f.copper, 0);
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);

/**
 * The Black Hand (visible, owns only Dead Man's Drink), the Harbour Guild (visible, controls Port
 * City and so the Docks inside it) and the Pale Court (hidden, owns the baker). Party: Aria 400,
 * Bram 300, Cora 100 with the Black Hand (median 300: Admired, −10%); the guild 150/100/−50
 * (median 100: Liked, −5%); the court −400 for everyone (Hated, +25%).
 */
function world(): CloudTable {
  return run(
    campaign(),
    save("s1", "black-hand", draft("The Black Hand", { locationIds: [], shopIds: ["drink"] }, { note: "Run by the harbourmaster" })),
    save("s2", "guild", draft("Harbour Guild", { locationIds: ["port-city"], shopIds: [] })),
    save("s3", "court", draft("The Pale Court", { locationIds: [], shopIds: ["baker"] })),
    reveal("v1", "black-hand", 0),
    reveal("v2", "guild", 0),
    renown("r1", "black-hand", [["aria", 400], ["bram", 300], ["cora", 100], ["gone", -900]]),
    renown("r2", "guild", [["aria", 150], ["bram", 100], ["cora", -50]]),
    renown("r3", "court", [["aria", -400], ["bram", -400], ["cora", -400]]),
  );
}

test("logic: median (odd, even rounded toward 0), tiers, the current party and the defaults", () => {
  assert.equal(medianRenown([]), 0);
  assert.equal(medianRenown([5, -3, 9]), 5);
  assert.equal(medianRenown([10, 15]), 12);
  assert.equal(medianRenown([-10, -15]), -12, "rounded toward 0");
  assert.equal(medianRenown([-3, 4]), 0);
  assert.deepEqual(DEFAULT_TIERS.map((t) => t.name), ["Vilified", "Hated", "Disliked", "Neutral", "Liked", "Admired", "Idolized"]);
  assert.deepEqual(DEFAULT_TIERS.map((t) => DEFAULT_PRICE_BY_TIER[t.id]), [50, 25, 10, 0, -5, -10, -20]);
  assert.equal(tierFor(DEFAULT_TIERS, 0).name, "Neutral");
  assert.equal(tierFor(DEFAULT_TIERS, -1000).name, "Vilified");
  assert.equal(tierFor(DEFAULT_TIERS, 299).name, "Liked");
  assert.equal(tierFor(DEFAULT_TIERS, 300).name, "Admired");
  assert.equal(tierFor(DEFAULT_TIERS, 1000).name, "Idolized");
  // Departed characters, NPCs and funds are not the party.
  assert.deepEqual(factionParty(campaign()).map((p) => p.id), ["aria", "bram", "cora"]);
  // Rates: exactly 1 without factions; selling pays the inverse; order never matters.
  assert.equal(factionBuyRate([]), 1);
  assert.equal(factionSaleRate([]), 1);
  const a = { percent: -10 }, b = { percent: 25 };
  assert.equal(factionBuyRate([a, b]), factionBuyRate([b, a]));
  assert.equal(factionSaleRate([b]), 1 / 1.25);
  assert.equal(factionBuyRate([{ percent: 500 }, { percent: 500 }]), 10, "kept within ×10");
});

test("renown: automatic Favor at the faction's rate, clamps, losses keep Favor, one command for the party", () => {
  let t = run(campaign(), save("s1", "bh", draft("The Black Hand", { locationIds: [], shopIds: ["drink"] }, { favorRatePercent: 50 })));
  t = run(t, renown("r1", "bh", [["aria", 7], ["bram", 30], ["cora", -20]], "Returned the ledger"));
  assert.deepEqual(faction(t, "bh").standing, { aria: [7, 3], bram: [30, 15], cora: [-20, 0] }, "floor(gain × 50 / 100)");
  // A loss never removes Favor; the clamp caps the gain that earns Favor.
  t = run(t, renown("r2", "bh", [["aria", -50]]), renown("r3", "bh", [["bram", 1500]]), renown("r4", "bh", [["bram", 500]]));
  assert.deepEqual(faction(t, "bh").standing.aria, [-43, 3]);
  assert.deepEqual(faction(t, "bh").standing.bram, [1000, 500], "only the 970 actually gained earns Favor");
  // DM Favor: granted and removed, never below 0; a refusal changes nothing (all-or-nothing).
  const grant = (id: string, characters: [string, number][]): Command => ({
    id, kind: "faction-favor-grant", factionId: "bh", characters: characters.map(([characterId, delta]) => ({ characterId, delta })), reason: "Bribe",
  });
  t = run(t, grant("f1", [["cora", 12]]));
  assert.deepEqual(faction(t, "bh").standing.cora, [-20, 12]);
  assert.throws(() => run(t, grant("f2", [["aria", 1], ["cora", -13]])), /only 12 Favor/);
  assert.deepEqual(faction(run(t, grant("f3", [["cora", -12]])), "bh").standing.cora, [-20, 0]);
  // A character back at 0/0 has no entry (the live record stays small).
  const back = run(t, grant("f4", [["cora", -12]]), renown("r5", "bh", [["cora", 20]]));
  assert.deepEqual(faction(back, "bh").standing.cora, [0, 10]);
  assert.equal(faction(run(back, grant("f5", [["cora", -10]])), "bh").standing.cora, undefined);
  // History: one event per character, on its purse, with who, change and reason.
  const logs = t.journal!.events.filter((e) => e.id.startsWith("r1-"));
  assert.deepEqual(
    logs.map((e) => [e.purseId, e.summary, !!e.dmOnly]),
    [
      ["aria", "Aria Thorne: renown with The Black Hand +7 (now 7, Neutral) · +3 Favor · Returned the ledger", true],
      ["bram", "Bram Ironfoot: renown with The Black Hand +30 (now 30, Neutral) · +15 Favor · Returned the ledger", true],
      ["cora", "Cora Vale: renown with The Black Hand −20 (now −20, Neutral) · Returned the ledger", true],
    ],
    "a hidden faction's history is DM-only",
  );
  const shown = run(t, reveal("v", "bh", 0), renown("r6", "bh", [["aria", 1]]));
  assert.equal(shown.journal!.events.find((e) => e.id.startsWith("r6-"))!.dmOnly, undefined, "a visible faction's lines reach their own player");
  // Only player characters; each listed once.
  assert.throws(() => run(t, renown("x1", "bh", [["npc", 5]])), /player characters/);
  assert.throws(() => run(t, renown("x2", "bh", [["hoard", 5]])), /player characters/);
  assert.throws(() => run(t, renown("x3", "bh", [["aria", 5], ["aria", 1]])), /once/);
  assert.throws(() => run(t, renown("x4", "bh", [["aria", 0]])));
});

test("commands: DM only, revision-checked, validated; delete keeps history and restores", () => {
  const t = world();
  for (const cmd of [
    save("p1", "mine", draft("Mine", { locationIds: [], shopIds: [] })),
    renown("p2", "black-hand", [["aria", 1000]]),
    { id: "p3", kind: "faction-favor-grant", factionId: "black-hand", characters: [{ characterId: "aria", delta: 99 }], reason: "x" },
    reveal("p4", "court", 0),
    { id: "p5", kind: "faction-delete", factionId: "court", revision: 0, deleted: true },
  ] as Command[])
    assert.throws(() => applyCommand(t, ariaSeat, cmd), /Only the DM/);
  // A new faction starts hidden; editing needs the current revision and keeps standing.
  assert.equal(faction(t, "court").hidden, true);
  assert.throws(() => run(t, save("e0", "guild", draft("Guild", { locationIds: [], shopIds: [] }), 0)), /changed on another device/);
  const edited = run(t, save("e1", "guild", draft("The Harbour Guild", { locationIds: ["port-city"], shopIds: [] }), 1));
  assert.equal(faction(edited, "guild").name, "The Harbour Guild");
  assert.equal(faction(edited, "guild").revision, 2);
  assert.deepEqual(faction(edited, "guild").standing, faction(t, "guild").standing);
  assert.throws(() => run(t, save("e2", "black-hand", draft("Again", { locationIds: [], shopIds: [] }))), /already exists/);
  // References must exist; prices name only this faction's tiers; IDs never take the synthetic one.
  assert.throws(() => run(t, save("e3", "n1", draft("X", { locationIds: [], shopIds: ["nowhere"] }))), /existing shops/);
  assert.throws(() => run(t, save("e4", "n2", draft("X", { locationIds: ["nowhere"], shopIds: [] }))), /existing locations/);
  assert.throws(() => run(t, save("e5", "n3", draft("X", { locationIds: [], shopIds: [] }, { priceByTier: { saint: -50 } }))), /tiers/);
  assert.throws(() => run(t, save("e6", LOCAL_STANDING_ID, draft("X", { locationIds: [], shopIds: [] }))));
  assert.throws(() => run(t, save("e7", "n4", draft("X", { locationIds: [], shopIds: [] }, { tiers: [{ id: "a", name: "A", min: 0 }, { id: "b", name: "B", min: 5 }] }))), /−1000/);
  // Delete keeps the faction (and its standing and history) but it no longer prices or changes.
  const deleted = run(t, { id: "d1", kind: "faction-delete", factionId: "black-hand", revision: 1, deleted: true });
  assert.equal(faction(deleted, "black-hand").deleted, true);
  assert.deepEqual(faction(deleted, "black-hand").standing, faction(t, "black-hand").standing);
  assert.deepEqual(factionEffects(deleted.journal, deleted.purses, drink).map((e) => e.id), ["guild"]);
  assert.throws(() => run(deleted, renown("d2", "black-hand", [["aria", 1]])), /Restore/);
  assert.equal(deleted.journal!.events.filter((e) => e.id.startsWith("r1-")).length, 4, "history stays");
  const restored = run(deleted, { id: "d3", kind: "faction-delete", factionId: "black-hand", revision: 2, deleted: false });
  assert.equal(faction(restored, "black-hand").deleted, undefined);
});

test("prices: direct and location control, shop overrides, two factions each a line, buy and sell charge the breakdown", () => {
  const t = world();
  const ale = t.stock.find((s) => s.id === "ale")!;
  // Dead Man's Drink: the Black Hand (Admired −10%) and the guild through the Docks (Liked −5%).
  const effects = factionEffects(t.journal, t.purses, drink);
  assert.deepEqual(effects.map((e) => [e.name, e.tier, e.percent]), [["The Black Hand", "Admired", -10], ["Harbour Guild", "Liked", -5]]);
  const b = shopBuyBreakdown(drink, 1000, null, 2, { factions: effects });
  assert.equal(b.unit, 855);
  assert.equal(sum(b), b.unit);
  assert.deepEqual(breakdownLines(b), ["List price: 1,000 cp", "The Black Hand: Admired −10%: −100 cp", "Harbour Guild: Liked −5%: −45 cp", "855 cp each × 2", "Total: 1,710 cp (17 gp, 1 sp)"]);
  // Only shops it controls: the smith is the guild's (Port City), the baker only the court's.
  assert.deepEqual(factionEffects(t.journal, t.purses, smith).map((e) => e.id), ["guild"]);
  assert.deepEqual(factionEffects(t.journal, t.purses, baker).map((e) => [e.id, e.percent, !!e.hidden]), [["court", 25, true]]);
  // The DM's line names the hidden faction and says what players see.
  const court = shopBuyBreakdown(baker, 333, null, 1, { factions: factionEffects(t.journal, t.purses, baker) });
  assert.equal(court.unit, 458); // 333 × 1.25 × 1.1 = 457.875
  assert.ok(breakdownLines(court).includes("The Pale Court: Hated +25% (hidden: players see Local standing): +83 cp"));
  assert.equal(sum(court), court.unit);
  // Buying charges the breakdown; the stored stock price is never rewritten.
  const bought = applyCommand(t, ariaSeat, { id: "b1", kind: "buy", stockId: "ale", purseId: "aria", quantity: 2 });
  assert.equal(wallet(t, "aria") - wallet(bought, "aria"), 1710);
  assert.equal(bought.stock.find((s) => s.id === "ale")!.copper, ale.copper);
  // Selling pays the inverse: 400 / 0.855 × 0.5 = 233.9… → 234 per mug.
  const sale = shopSellBreakdown(drink, 400, 2, t.holdings[0], { factions: effects });
  assert.equal(sale.unit, 234);
  assert.equal(sum(sale), sale.unit);
  const sold = applyCommand(t, ariaSeat, { id: "s1", kind: "sell", holdingId: "mug", shopId: "drink", quantity: 2 });
  assert.equal(wallet(sold, "aria") - wallet(t, "aria"), 468);
  // A shop override replaces the faction's tier % at that shop only.
  const override = run(t, save("o1", "black-hand", draft("The Black Hand", { locationIds: [], shopIds: ["drink"] }, { shopPriceByTier: { drink: { admired: -30 } } }), 1));
  assert.deepEqual(factionEffects(override.journal, override.purses, drink).map((e) => e.percent), [-30, -5]);
  // A tier at 0% changes nothing and makes no line; the median moves with the party.
  const leaves = { ...t, journal: readJournal({ ...t.journal, world: { characterPositions: [{ purseId: "aria", inParty: false, locationId: null, visible: true, sheetVisible: true }, { purseId: "gone", inParty: false, locationId: null, visible: true, sheetVisible: true }] } }) };
  // Without Aria: Bram 300, Cora 100 → 200 Liked (−5%); the guild 100, −50 → 25 Neutral (0%).
  assert.deepEqual(factionEffects(leaves.journal, leaves.purses, drink).map((e) => [e.id, e.tier, e.percent]), [["black-hand", "Liked", -5]]);
  // With market events in the same pipeline, rounded once.
  const festival = run(t, { id: "m1", kind: "market-event", eventId: "fair", before: null, after: { id: "fair", name: "Fair", scope: { kind: "realm" }, permille: 1200, startDay: 0, endDay: 10 } });
  const both = shopBuyBreakdown(drink, 1000, null, 1, { events: lineEvents(festival.journal, drink, ale), factions: effects });
  assert.equal(both.unit, Math.round(1000 * 1.2 * 0.855));
  assert.equal(sum(both), both.unit);
  const charged = applyCommand(festival, ariaSeat, { id: "b2", kind: "buy", stockId: "ale", purseId: "aria", quantity: 1 });
  assert.equal(wallet(festival, "aria") - wallet(charged, "aria"), both.total);
  // No factions: exactly the price before this feature.
  assert.deepEqual(shopBuyBreakdown(drink, 1000, 14, 1, { factions: [] }), shopBuyBreakdown(drink, 1000, 14, 1));
  assert.deepEqual(shopSellBreakdown(drink, 400, 1, t.holdings[0], { factions: [] }), shopSellBreakdown(drink, 400, 1, t.holdings[0]));
});

test("sell and split prices each lot with faction standing, and a stale review is refused", () => {
  const t = world();
  assert.equal(unitSalePrice(t.holdings[1]!, drink, t.journal, t.purses), 234);
  const plan = planSaleSplit(t, { fundId: "hoard", shopId: "drink", lots: [{ holdingId: "hoard-mug", quantity: 4 }], recipientIds: ["aria", "bram"], rule: "party-fund" }, { actor: "dm" });
  assert.equal(plan.proceeds, 936);
  const cmd = (proceeds: number, share: number): Command => ({
    id: `ss-${proceeds}`, kind: "sale-split", fundId: "hoard", shopId: "drink", lots: [{ holdingId: "hoard-mug", quantity: 4 }],
    recipientIds: ["aria", "bram"], remainder: { rule: "party-fund" }, expect: { proceeds, share, remainderTo: null },
  });
  const split = run(t, cmd(936, 468));
  assert.equal(wallet(split, "aria") - wallet(t, "aria"), 468);
  assert.throws(() => run(t, cmd(800, 400)), /changed/);
});

test("projection: only visible factions, only the seat's own standing, the party tier; hidden ones as Local standing", () => {
  const t = world();
  const view = projectRecord(t, ariaSeat);
  const text = JSON.stringify(view);
  for (const secret of ["Pale Court", "court", "harbourmaster", "Old Wil: renown"]) assert.ok(!text.includes(secret), `the player's copy names ${secret}`);
  const mine = factionsOf(view);
  assert.deepEqual(mine.map((f) => f.id), ["black-hand", "guild"]);
  for (const f of mine) {
    assert.deepEqual(Object.keys(f.standing), ["aria"], "only Aria's own standing");
    assert.equal(f.note, undefined);
  }
  const hand = mine[0]!;
  assert.deepEqual(hand.standing.aria, [400, 400]);
  assert.deepEqual(hand.party, { tier: "admired" }, "the tier, never the median score");
  // Prices only for the party's tier; controls only for what the seat can see.
  assert.deepEqual(hand.priceByTier, { admired: -10 });
  assert.deepEqual(mine[1]!.controls.shopIds.sort(), ["drink", "smith"]);
  // The court's effect on the baker arrives as one rate, and the player's price is the charge.
  assert.deepEqual((view.journal as { factionAdjustments?: unknown }).factionAdjustments, [{ shopId: "baker", rate: 1.25 }]);
  for (const s of view.stock) {
    const shop = view.shops.find((x) => x.id === s.shopId)!;
    const full = t.shops.find((x) => x.id === s.shopId)!;
    const shown = shopBuyBreakdown(shop, s.copper, null, 3, { factions: factionEffects(view.journal, view.purses, shop) });
    const charged = shopBuyBreakdown(full, s.copper, null, 3, { factions: factionEffects(t.journal, t.purses, full) });
    assert.equal(shown.total, charged.total, s.id);
    assert.equal(sum(viewerBreakdown(shown, false)), shown.unit);
    const paid = shopSellBreakdown(full, 400, 2, t.holdings[0], { factions: factionEffects(t.journal, t.purses, full) }).total;
    assert.equal(shopSellBreakdown(shop, 400, 2, t.holdings[0], { factions: factionEffects(view.journal, view.purses, shop) }).total, paid, `${s.id} sale`);
  }
  const bread = shopBuyBreakdown(baker, 333, null, 1, { factions: factionEffects(view.journal, view.purses, baker) });
  assert.ok(breakdownLines(viewerBreakdown(bread, false)).includes("Local standing: +83 cp"));
  // The DM's breakdown, as a player would be shown it, also says only "Local standing".
  const dmBread = shopBuyBreakdown(baker, 333, null, 1, { factions: factionEffects(t.journal, t.purses, baker) });
  assert.ok(!JSON.stringify(viewerBreakdown(dmBread, false)).includes("Pale"));
  // History: Aria reads her own visible renown lines, never others' or a hidden faction's.
  const lines = view.journal!.events.map((e) => e.summary);
  assert.ok(lines.some((s) => s.startsWith("Aria Thorne: renown with The Black Hand +400")));
  assert.ok(!lines.some((s) => s.startsWith("Bram") || s.startsWith("Cora")));
  // A two-character party: only the tier (the median would give away the other's score).
  const out = (purseId: string) => ({ purseId, inParty: false, locationId: null, visible: true, sheetVisible: true });
  const pair = { ...t, journal: readJournal({ ...t.journal, world: { characterPositions: [out("cora"), out("gone")] } }) };
  assert.deepEqual(factionsOf(projectRecord(pair, ariaSeat))[0]!.party, { tier: "admired" }, "Aria 400, Bram 300: 350, no score");
  // Hidden again after players saw it: its earlier lines are withheld, here and in archives.
  const rehidden = run(t, { id: "h1", kind: "faction-visibility", factionId: "black-hand", revision: 1, hidden: true });
  const rehiddenView = projectRecord(rehidden, ariaSeat);
  assert.ok(!JSON.stringify(rehiddenView).includes("Black Hand"));
  const kept = structuredClone(t);
  archiveSession(kept, "s-old", "Old session", 1);
  const hiddenNow = run(kept, { id: "h2", kind: "faction-visibility", factionId: "black-hand", revision: 1, hidden: true });
  assert.ok(!projectRecord(hiddenNow, ariaSeat).journal!.reports![0]!.snapshot.includes("Black Hand"));
  assert.ok(projectRecord(kept, ariaSeat).journal!.reports![0]!.snapshot.includes("Black Hand"), "visible: Aria reads her own line");
  // An older client's whole-journal write keeps the faction tag on the stored line.
  const untagged = { ...t.journal!, events: t.journal!.events.map(({ factionId: _f, ...e }) => e) };
  assert.ok(preserveJournalMetadata(untagged, t.journal!).events.filter((e) => e.factionId === "black-hand").length >= 4);
  // A seat without a character (a guest without a seat) gets no faction, yet the same prices.
  const guest = projectRecord(t, { ...ariaSeat, purseIds: [] });
  assert.equal(factionsOf(guest).length, 0);
  assert.ok(!JSON.stringify(guest.journal).includes("Black Hand"));
  for (const shop of guest.shops)
    assert.equal(
      factionBuyRate(factionEffects(guest.journal, guest.purses, shop)),
      factionBuyRate(factionEffects(t.journal, t.purses, t.shops.find((x) => x.id === shop.id)!)),
      shop.id,
    );
  // A hidden faction that changes no visible price leaves no trace.
  const neutral = run(t, renown("n1", "court", [["aria", 400], ["bram", 400], ["cora", 400]]));
  assert.equal("factionAdjustments" in projectRecord(neutral, ariaSeat).journal!, false);
  // The DM keeps everything; seatView (Preview as player) projects the same as the room.
  assert.equal(factionsOf(projectRecord(t, dmSeat)).length, 3);
  assert.deepEqual(factionsOf(seatView(t, { purseIds: ["aria"] })), mine);
  // A copy projected again keeps its projected values (an archive, a player's device).
  const again = projectRecord(view, ariaSeat);
  assert.deepEqual(factionsOf(again), mine);
  assert.deepEqual((again.journal as { factionAdjustments?: unknown }).factionAdjustments, [{ shopId: "baker", rate: 1.25 }]);
  // Archived sessions are projected by the same rules.
  const archived = structuredClone(t);
  archiveSession(archived, "session-1", "Session 1", 1);
  const report = projectRecord(archived, ariaSeat).journal!.reports![0]!;
  assert.ok(!report.snapshot.includes("Pale Court") && !report.snapshot.includes("bram\":["));
});

test("hardening: stored adjustments and party tiers never price the DM's or the server's copy; import strips them", async () => {
  const t = world();
  const honest = factionBuyRate(factionEffects(t.journal, t.purses, baker));
  const tainted: CloudTable = { ...t, journal: { ...t.journal!, factionAdjustments: [{ shopId: "baker", rate: 5 }] } as CloudTable["journal"] };
  assert.equal(factionBuyRate(factionEffects(tainted.journal, tainted.purses, baker)), honest);
  const view = projectRecord(t, ariaSeat);
  const imported = readCloudTableForImport(view)!;
  assert.equal("factionAdjustments" in imported.journal!, false);
  assert.ok(factionsOf(imported).every((f) => f.party === undefined));
  const dm = await openRoom({ name: "From a player's copy", table: view });
  const opened = (await roomState({ code: dm.code, token: dm.token })).table;
  assert.equal("factionAdjustments" in opened.journal!, false);
  // A whole-journal write (an older client's) never replaces the stored factions.
  const written = preserveJournalMetadata({ ...t.journal, factions: [] }, t.journal!);
  assert.deepEqual(readFactions((written as { factions?: unknown }).factions), factionsOf(t));
  // Old data: a campaign without factions prices exactly as before.
  assert.deepEqual(factionEffects(campaign().journal, campaign().purses, drink), []);
  assert.deepEqual(readFactions(undefined), []);
});

test("protocol 29: older apps are refused where a faction changes the price, and drafts ask them to update", async () => {
  assert.equal(FACTIONS_PROTOCOL, 29);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= FACTIONS_PROTOCOL);
  const t = world();
  const dm = await openRoom({ name: "Old app", table: t });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const OLD = { code: dm.code, token: aria.token, tabletopProtocol: AWARD_DETAILS_PROTOCOL };
  const state = async () => (await roomState({ code: dm.code, token: dm.token })).table;
  const start = wallet(await state(), "aria");
  await assert.rejects(
    submitCommands({ ...OLD, batchId: "o1", commands: [{ id: "o1", kind: "buy", stockId: "ale", purseId: "aria", quantity: 1 }] }),
    /older Lootsplitter app/,
  );
  await assert.rejects(
    submitCommands({ ...OLD, batchId: "o2", commands: [{ id: "o2", kind: "sell", holdingId: "mug", shopId: "drink", quantity: 1 }] }),
    /older Lootsplitter app/,
  );
  assert.equal(wallet(await state(), "aria"), start, "nothing moved");
  // An older DM app's sell and split, planned without factions, is refused with the same reason.
  const old = structuredClone(t);
  delete (old.journal as { factions?: unknown }).factions;
  const plan = planSaleSplit(old, { fundId: "hoard", shopId: "drink", lots: [{ holdingId: "hoard-mug", quantity: 1 }], recipientIds: ["aria"], rule: "party-fund" }, { actor: "dm" });
  await assert.rejects(
    submitCommands({
      code: dm.code, token: dm.token, tabletopProtocol: AWARD_DETAILS_PROTOCOL, batchId: "o3",
      commands: [{ id: "o3", kind: "sale-split", fundId: "hoard", shopId: "drink", lots: [{ holdingId: "hoard-mug", quantity: 1 }], recipientIds: ["aria"], remainder: { rule: "party-fund" }, expect: { proceeds: plan.proceeds, share: plan.split.share, remainderTo: plan.split.remainderTo } }],
    }),
    /older Lootsplitter app/,
  );
  // The updated app is charged the faction price.
  await submitCommands({ ...OLD, tabletopProtocol: FACTIONS_PROTOCOL, batchId: "o4", commands: [{ id: "o4", kind: "buy", stockId: "ale", purseId: "aria", quantity: 1 }] });
  assert.equal(start - wallet(await state(), "aria"), 855);
  // A shop without faction effects trades as before for the older app (the baker's court is
  // hidden but still prices: refused too; a shop with no faction at all is untouched).
  const free = run(campaign());
  const room2 = await openRoom({ name: "No factions", table: free });
  const aria2 = await joinRoom({ code: room2.code, purseId: "aria", name: "Aria" });
  await choosePace({ code: room2.code, token: room2.token, live: true });
  await submitCommands({ code: room2.code, token: aria2.token, tabletopProtocol: AWARD_DETAILS_PROTOCOL, batchId: "o5", commands: [{ id: "o5", kind: "buy", stockId: "ale", purseId: "aria", quantity: 1 }] });
  // Drafts with faction commands ask older apps to finish on the updated website.
  const draftText = JSON.stringify([renown("dr", "guild", [["aria", 5]])]);
  const response = { table: t, draft: draftText };
  assert.throws(() => tabletopResponse(response, AWARD_DETAILS_PROTOCOL), /updated website/);
  assert.equal(tabletopResponse(response, FACTIONS_PROTOCOL).table, t);
});

test("shared rooms: players refused on the server, a retry applies once, the player's quote is the charge", async () => {
  const dm = await openRoom({ name: "Factions DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: FACTIONS_PROTOCOL };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: FACTIONS_PROTOCOL };
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const state = async () => (await roomState(DT)).table;
  const create = save("c1", "black-hand", draft("The Black Hand", { locationIds: [], shopIds: ["drink"] }));
  await assert.rejects(submitCommands({ ...AT, batchId: "c0", commands: [{ ...create, id: "c0" }] }));
  assert.equal((await state()).journal!.factions, undefined);
  await submitCommands({ ...DT, batchId: "c1", commands: [create] });
  await submitCommands({ ...DT, batchId: "c1", commands: [create] });
  const party = renown("c2", "black-hand", [["aria", 400], ["bram", 300], ["cora", 300]]);
  await submitCommands({ ...DT, batchId: "c2", commands: [reveal("c3", "black-hand", 0), party] });
  await submitCommands({ ...DT, batchId: "c2", commands: [reveal("c3", "black-hand", 0), party] });
  const table = await state();
  assert.deepEqual(faction(table, "black-hand").standing, { aria: [400, 400], bram: [300, 300], cora: [300, 300] }, "a retry changes nothing");
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("c2-")).length, 3);
  // A player renown command is refused by the server, whatever the client claims.
  await assert.rejects(submitCommands({ ...AT, batchId: "c4", commands: [renown("c4", "black-hand", [["aria", 600]])] }), /DM/);
  // The player's view: own standing, the party tier, and the quote equals the charge.
  const view = (await roomState(AT)).table;
  const hand = factionsOf(view)[0]!;
  assert.deepEqual(hand.standing, { aria: [400, 400] });
  assert.deepEqual(hand.party, { tier: "admired" });
  const ale = view.stock.find((s) => s.id === "ale")!;
  const quoted = shopBuyBreakdown(drink, ale.copper, null, 2, { factions: factionEffects(view.journal, view.purses, drink) }).total;
  assert.equal(quoted, 1800);
  const before = wallet(table, "aria");
  await submitCommands({ ...AT, batchId: "c5", commands: [{ id: "c5", kind: "buy", stockId: "ale", purseId: "aria", quantity: 2 }] });
  assert.equal(before - wallet(await state(), "aria"), quoted);
});

test("offline parity: the device runs the same commands, and commands.ts and economy.ts charge and pay the same", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const steps: Command[] = [
    save("d1", "black-hand", draft("The Black Hand", { locationIds: [], shopIds: ["drink"] })),
    save("d2", "guild", draft("Harbour Guild", { locationIds: ["port-city"], shopIds: [] })),
    reveal("d3", "black-hand", 0),
    renown("d4", "black-hand", [["aria", 400], ["bram", 300], ["cora", 100]]),
    renown("d5", "guild", [["aria", 150], ["bram", 100], ["cora", -50]]),
    { id: "d6", kind: "faction-favor-grant", factionId: "guild", characters: [{ characterId: "cora", delta: 7 }], reason: "A tip" },
  ];
  const shared = run(campaign(), ...steps);
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  assert.deepEqual(factionsOf(once), factionsOf(shared));
  assert.deepEqual(factionsOf(twice), factionsOf(once), "retries change nothing");
  const logs = (t: CloudTable) => t.journal!.events.filter((e) => /renown|Favor|Faction/.test(e.summary)).map((e) => [e.id, e.summary, e.purseId, e.dmOnly]);
  assert.deepEqual(logs(once), logs(shared));
  // Errors match too.
  const sharedError = (() => {
    try {
      run(shared, { id: "d7", kind: "faction-favor-grant", factionId: "guild", characters: [{ characterId: "cora", delta: -8 }], reason: "x" });
    } catch (e) {
      return (e as Error).message;
    }
  })();
  const localError = await executeLocalCommand({ id: "d7", kind: "faction-favor-grant", factionId: "guild", characters: [{ characterId: "cora", delta: -8 }], reason: "x" }).catch((e: Error) => e.message);
  assert.equal(localError, sharedError);
  // Buy and sell: commands.ts (shared), the DM's device (executeLocalCommand) and a player link
  // (economy.ts buyFromShop / sellToShop on the projected copy) all move the same copper.
  const sharedBuy = applyCommand(shared, dmSeat, { id: "b1", kind: "buy", stockId: "ale", purseId: "aria", quantity: 2 });
  const charge = wallet(shared, "aria") - wallet(sharedBuy, "aria");
  assert.equal(charge, 1710);
  await buyFromShop({ stockId: "ale", purseId: "aria", quantity: 2 }, { commandId: "b1" });
  await buyFromShop({ stockId: "ale", purseId: "aria", quantity: 2 }, { commandId: "b1" });
  const afterBuy = await economySnapshot();
  assert.equal(wallet(once, "aria") - wallet(afterBuy, "aria"), charge);
  const sharedSell = applyCommand(shared, dmSeat, { id: "s1", kind: "sell", holdingId: "mug", shopId: "drink", quantity: 2 });
  await sellToShop({ holdingId: "mug", shopId: "drink", quantity: 2 }, { commandId: "s1" });
  assert.equal(wallet(await economySnapshot(), "aria") - wallet(afterBuy, "aria"), wallet(sharedSell, "aria") - wallet(shared, "aria"));
  // The player-link path (economy.ts's own transaction) on Aria's projected copy.
  const projected = seatView(shared, { purseIds: ["aria"] });
  setSeat({ role: "player", purseIds: ["aria"], shopIds: ["drink", "smith", "baker"], openedAt: 0 });
  await applyCloudTable(projected);
  const linkStart = wallet(await economySnapshot(), "aria");
  await buyFromShop({ stockId: "ale", purseId: "aria", quantity: 2 }, { commandId: "pb1" });
  await buyFromShop({ stockId: "ale", purseId: "aria", quantity: 2 }, { commandId: "pb1" });
  const linkBuy = await economySnapshot();
  assert.equal(linkStart - wallet(linkBuy, "aria"), charge, "economy.ts charges what commands.ts charges");
  await sellToShop({ holdingId: "mug", shopId: "drink", quantity: 2 }, { commandId: "ps1" });
  assert.equal(wallet(await economySnapshot(), "aria") - wallet(linkBuy, "aria"), wallet(sharedSell, "aria") - wallet(shared, "aria"));
  // Faction commands are the DM's, on the device too.
  const refused = await executeLocalCommand(renown("d8", "guild", [["aria", 5]])).catch((e: Error) => e.message);
  assert.match(String(refused), /DM/);
  setSeat(DM_SEAT);
});

test("old saves: a stored faction from this version reads back, and unknown later fields are ignored", () => {
  const t = world();
  const raw = JSON.parse(JSON.stringify(t.journal));
  raw.factions[0].laterField = [{ id: "x", name: "Safe house", cost: 3 }];
  const journal = readJournal(raw);
  assert.deepEqual(readFactions((journal as { factions?: unknown }).factions).map((f: Faction) => f.name), ["The Black Hand", "Harbour Guild", "The Pale Court"]);
  assert.deepEqual(readJournal({}).events, []);
});

test("every server path that projects an archived session passes today's hidden factions (privacy review of #438)", () => {
  // A faction hidden after a session was archived must stay hidden in account exports and
  // archived-map lookups too, not only in the room view (projectArchivedReport).
  for (const file of ["cloudflare/campaign-records.mjs", "cloudflare/account-map-assets.mjs"]) {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    const calls = source.match(/projectRecord\(readArchivedSnapshot\([^;]*;/g) ?? [];
    assert.ok(calls.length > 0, `${file} projects archived sessions`);
    for (const call of calls) assert.match(call, /hiddenFactions/, `${file}: ${call}`);
  }
});

// Audit I1: the player's hidden-purse projection priced lots without the faction rate.
test("a hidden merchant purse is judged at the faction payout players are actually paid", () => {
  const t = world();
  t.shops = t.shops.map((s) => (s.id === "drink" ? { ...s, merchantPurse: 210 } : s));
  // 400 / 0.855 × 50% = 234 cp a mug, more than the 210 cp purse holds.
  assert.equal(unitSalePrice(t.holdings[0]!, drink, t.journal, t.purses), 234);
  assert.equal(projectRecord(t, ariaSeat).shops.find((s) => s.id === "drink")!.merchantAffords!.mug, "none");
  assert.throws(() => applyCommand(t, ariaSeat, { id: "f-sell", kind: "sell", holdingId: "mug", shopId: "drink", quantity: 1 }), /can't afford/);
});
