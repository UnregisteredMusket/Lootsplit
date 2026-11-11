// Audit 2026-11-10, A1 (P0 money): a sale was priced at the inverse of the faction buying rate,
// so with good standing buying an item and selling it straight back to the same shop paid more
// than it cost (shipped defaults: Idolized −20% at a 75% buy rate, pay 400 cp, get 469 cp).
// Owner decision (2026-11-11, option 1): a sale's unit payout is capped at what the same shop
// would charge that same seller for that item right now (market events, faction standing, the
// shop's markup and the seller's Charisma included). These tests run the loop as a player through
// the shared room (`submitCommands`), on the DM's device (`executeLocalCommand`) and on a player
// link (economy.ts `sellToShop`), and pin the price breakdown's cap line.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand, sellToShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { seatView } from "./player-view.ts";
import { fromCopper, toCopper } from "./money.ts";
import { breakdownLines, shopBuyBreakdown, viewerBreakdown, type PriceBreakdown } from "./price-breakdown.ts";
import { planSaleSplit, shopSale } from "./sale-split.ts";
import { defaultFactionDraft, factionEffects, type FactionDraft } from "./factions.ts";
import { FACTIONS_PROTOCOL } from "./tabletop-protocol.ts";
import { blankSheet } from "../characters/model.mjs";
import type { Shop, StockLine } from "./types.ts";

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

const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const wallet = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const sum = (b: PriceBreakdown) => b.base.copper + b.factors.reduce((n, f) => n + f.copper, 0);
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);

/** A 500 cp lantern on unlimited stock at one shop (no location: open everywhere). */
function campaign(buyRate: number, cha?: number): CloudTable {
  const shop: Shop = {
    id: "emporium", name: "Gilded Emporium", keeper: "", place: "", notes: "", wealth: "princely", priceScale: 1,
    acceptAnyCategory: true, sellRate: 1, buyRate, category: "general",
  };
  const lantern: StockLine = { id: "lantern", shopId: "emporium", name: "Lantern", copper: 500, baseCopper: 500, rarity: "common", quantity: null, notes: "", category: "general" };
  const sheet = blankSheet();
  if (cha !== undefined) sheet.scores.cha = cha;
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(10_000), ...(cha !== undefined ? { sheet } : {}) },
      { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(0) },
    ],
    holdings: [
      { id: "hoard-lantern", purseId: "hoard", name: "Lantern", kind: "item", quantity: 1, unitCopper: 500, notes: "", category: "general" },
    ],
    shops: [shop],
    stock: [lantern],
    journal: readJournal({ finance: { day: 1 } }),
  };
}

/** Each faction controls the shop, is visible, and the party (Aria) is Idolized with it. */
function withFactions(t: CloudTable, factions: Array<{ id: string; priceByTier?: Record<string, number> }>): CloudTable {
  return run(
    t,
    ...factions.flatMap(({ id, priceByTier }, i): Command[] => {
      const draft: FactionDraft = {
        ...defaultFactionDraft(),
        name: `Faction ${id}`,
        description: "",
        controls: { locationIds: [], shopIds: ["emporium"] },
        ...(priceByTier ? { priceByTier: { ...defaultFactionDraft().priceByTier, ...priceByTier } } : {}),
      };
      return [
        { id: `save-${i}`, kind: "faction-save", factionId: id, revision: null, faction: draft },
        { id: `show-${i}`, kind: "faction-visibility", factionId: id, revision: 0, hidden: false },
        { id: `renown-${i}`, kind: "faction-renown", factionId: id, characters: [{ characterId: "aria", delta: 700 }], reason: "Deeds" },
      ];
    }),
  );
}

/** Buy one lantern and sell it straight back, as Aria's player seat in a live shared room. */
async function loop(table: CloudTable, label: string) {
  const dm = await openRoom({ name: label, table });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: FACTIONS_PROTOCOL };
  const state = async () => (await roomState({ code: dm.code, token: dm.token })).table;
  const start = wallet(await state(), "aria");
  await submitCommands({ ...AT, batchId: `${label}-b`, commands: [{ id: `${label}-b`, kind: "buy", stockId: "lantern", purseId: "aria", quantity: 1 }] });
  const afterBuy = await state();
  const bought = afterBuy.holdings.find((h) => h.id === `${label}-b-item`)!;
  await submitCommands({ ...AT, batchId: `${label}-s`, commands: [{ id: `${label}-s`, kind: "sell", holdingId: bought.id, shopId: "emporium", quantity: 1 }] });
  const end = wallet(await state(), "aria");
  return { start, paid: start - wallet(afterBuy, "aria"), got: end - wallet(afterBuy, "aria"), end };
}

test("A1: Idolized (−20%) at a 75% buy rate: buying and selling back never ends above the start", async () => {
  const r = await loop(withFactions(campaign(0.75), [{ id: "guild" }]), "one");
  assert.equal(r.paid, 400);
  assert.equal(r.got, 400, "the payout is capped at the 400 cp the shop charges Aria (was 469)");
  assert.ok(r.end <= r.start);
});

test("A1: two Idolized factions at a 50% buy rate", async () => {
  const r = await loop(withFactions(campaign(0.5), [{ id: "guild" }, { id: "crown" }]), "two");
  assert.equal(r.paid, 320);
  assert.equal(r.got, 320, "was 391");
  assert.ok(r.end <= r.start);
});

test("A1: a custom −90% tier", async () => {
  const r = await loop(withFactions(campaign(0.5), [{ id: "cult", priceByTier: { idolized: -90 } }]), "custom");
  assert.equal(r.paid, 50);
  assert.equal(r.got, 50, "was 2,500");
  assert.ok(r.end <= r.start);
});

test("A1: the cap is the price to this seller, Charisma included", async () => {
  // Charisma 20 takes 10% off what Aria pays: 400 → 360, so the shop pays her at most 360.
  const r = await loop(withFactions(campaign(0.75, 20), [{ id: "guild" }]), "cha");
  assert.equal(r.paid, 360);
  assert.equal(r.got, 360);
  assert.ok(r.end <= r.start);
});

test("the price breakdown shows the cap as a line, and every line adds up to the payout", () => {
  const t = withFactions(campaign(0.75), [{ id: "guild" }]);
  const h = { ...t.holdings[0]!, purseId: "aria" };
  const sale = shopSale(h, t.shops[0]!, 2, t.journal, t.purses, "player", t.sheets);
  const charge = shopBuyBreakdown(t.shops[0]!, 500, null, 1, { factions: factionEffects(t.journal, t.purses, t.shops[0]!) }).unit;
  assert.equal(charge, 400);
  assert.equal(sale.unit, 400);
  assert.equal(sale.total, 800);
  assert.equal(sum(sale), sale.unit);
  const cap = sale.factors.find((f) => f.key === "asking-cap")!;
  assert.equal(cap.copper, -69);
  assert.deepEqual(breakdownLines(viewerBreakdown(sale, false)), [
    "Lot value: 500 cp",
    "Faction guild: Idolized +25%: +125 cp",
    "Shop buys at 75%: −156 cp",
    "Capped at what this shop charges the seller for it (400 cp): −69 cp",
    "400 cp each × 2",
    "Total: 800 cp (8 gp)",
  ]);
  // Below the cap nothing changes: no line, the same payout as before.
  const plain = shopSale(h, { ...t.shops[0]!, buyRate: 0.5 }, 1, t.journal, t.purses, "player", t.sheets);
  assert.equal(plain.unit, 313);
  assert.ok(!plain.factors.some((f) => f.key === "asking-cap"));
  // The DM is capped too (the cap is not the settlement limit the DM is exempt from).
  assert.equal(shopSale(h, t.shops[0]!, 1, t.journal, t.purses, "dm", t.sheets).unit, 400);
});

test("sell and split from a party fund is capped at the shop's price (a party fund has no Charisma)", () => {
  const t = withFactions(campaign(0.75), [{ id: "guild" }]);
  const plan = planSaleSplit(t, { fundId: "hoard", shopId: "emporium", lots: [{ holdingId: "hoard-lantern", quantity: 1 }], recipientIds: ["aria"], rule: "party-fund" }, { actor: "dm" });
  assert.equal(plan.proceeds, 400);
  const split = run(t, {
    id: "ss", kind: "sale-split", fundId: "hoard", shopId: "emporium", lots: [{ holdingId: "hoard-lantern", quantity: 1 }],
    recipientIds: ["aria"], remainder: { rule: "party-fund" }, expect: { proceeds: 400, share: 400, remainderTo: null },
  });
  assert.equal(wallet(split, "aria") - wallet(t, "aria"), 400);
});

test("offline parity: the DM's device and a player link pay what the shared engine pays", async () => {
  const shared = withFactions(campaign(0.75, 20), [{ id: "guild" }]);
  const sharedBuy = applyCommand(shared, ariaSeat, { id: "p-b", kind: "buy", stockId: "lantern", purseId: "aria", quantity: 1 });
  const sharedSell = applyCommand(sharedBuy, ariaSeat, { id: "p-s", kind: "sell", holdingId: "p-b-item", shopId: "emporium", quantity: 1 });
  const sharedGot = wallet(sharedSell, "aria") - wallet(sharedBuy, "aria");
  assert.equal(sharedGot, 360);
  // The DM's device runs the shared command through executeLocalCommand.
  setSeat(DM_SEAT);
  await applyCloudTable(sharedBuy);
  await executeLocalCommand({ id: "p-s", kind: "sell", holdingId: "p-b-item", shopId: "emporium", quantity: 1 });
  await executeLocalCommand({ id: "p-s", kind: "sell", holdingId: "p-b-item", shopId: "emporium", quantity: 1 });
  const device = await economySnapshot();
  assert.equal(wallet(device, "aria") - wallet(sharedBuy, "aria"), sharedGot, "device = shared, and a retry pays once");
  // A player link runs economy.ts's own transaction on Aria's projected copy.
  setSeat({ role: "player", purseIds: ["aria"], shopIds: ["emporium"], openedAt: 0 });
  await applyCloudTable(seatView(shared, { purseIds: ["aria"] }));
  const linkStart = wallet(await economySnapshot(), "aria");
  await buyFromShop({ stockId: "lantern", purseId: "aria", quantity: 1 }, { commandId: "l-b" });
  const linkBuy = await economySnapshot();
  assert.equal(linkStart - wallet(linkBuy, "aria"), 360);
  await sellToShop({ holdingId: "l-b-item", shopId: "emporium", quantity: 1 }, { commandId: "l-s" });
  await sellToShop({ holdingId: "l-b-item", shopId: "emporium", quantity: 1 }, { commandId: "l-s" });
  assert.equal(wallet(await economySnapshot(), "aria") - wallet(linkBuy, "aria"), sharedGot, "economy.ts pays what commands.ts pays");
  setSeat(DM_SEAT);
});
