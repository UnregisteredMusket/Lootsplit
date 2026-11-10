// Settlement tiers, phase S2 (owner decisions 2026-11-10): the per-item sale cap (off until the DM
// turns it on; refuse or pay at the limit) and the rarity cap on generated shop stock (on for places
// with a tier). These tests pin: old journals and places without a tier sell exactly as before; the
// DM-only `settlement-limits` command (checked against what the DM saw, replay, history); refusals
// and capped payouts in `sell` and sell-and-split with copper conserved; the shared engine, the DM's
// device and the player link's own transaction agreeing on payouts and error text; older apps
// (protocol 31) refused where the cap lowers a payout; the player projection (the mode and each
// visible place's limit only; tier names only for tiers visible places use); and that the rarity cap
// filters generated stock but never hand-added stock.
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
import { addShelfStock, applyCloudTable, economySnapshot, executeLocalCommand, sellToShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord } from "./session-records.ts";
import { seatView } from "./player-view.ts";
import { fromCopper, toCopper } from "./money.ts";
import { composeShelf } from "./compose.ts";
import { DEFAULT_REALM } from "./scale.ts";
import { breakdownLines, shopSellBreakdown } from "./price-breakdown.ts";
import { planSaleSplit, saleProblem, shopSale } from "./sale-split.ts";
import {
  limitSettings,
  OLD_CLIENT_SETTLEMENT_PRICE,
  readSettlements,
  settlementMaxRarity,
  settlementSaleLimit,
  settlementTiers,
} from "./settlements.ts";
import { SETTLEMENT_LADDERS, type SettlementLimitSettings, type SettlementProfile } from "./settlements-schema.ts";
import { CURRENT_TABLETOP_PROTOCOL, QUEST_RENOWN_PROTOCOL, SETTLEMENT_LIMITS_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
import type { CatalogItem, Holding, Shop } from "./types.ts";

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

const shopBase = { keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", priceScale: 1, category: "general", acceptAnyCategory: true } as const;
// The Docks are an area of Port City; the stall is campaign-wide; the mill is in Brook.
const drink: Shop = { ...shopBase, id: "drink", name: "Dead Man's Drink", locationId: "docks", merchantPurse: 1_000_000 };
const stall: Shop = { ...shopBase, id: "stall", name: "Wandering Stall" };
const mill: Shop = { ...shopBase, id: "mill", name: "Brook Mill", locationId: "brook" };
const item = (id: string, purseId: string, name: string, unitCopper: number, quantity: number) =>
  ({ id, purseId, name, kind: "item", quantity, unitCopper, notes: "", category: "general" }) as Holding;
const pc = (id: string, name: string) => ({ id, name, kind: "character" as const, coins: fromCopper(10_000) });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot"), { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(0) }],
    holdings: [
      // 3,000 gp each: a 0.5 buy rate pays 1,500 gp, above a small town's 1,000 gp limit.
      item("crown", "aria", "Jewelled crown", 300_000, 2),
      item("mug", "aria", "Pewter mug", 400, 4),
      item("hoard-crown", "hoard", "Jewelled crown", 300_000, 2),
      item("hoard-mug", "hoard", "Pewter mug", 401, 3),
    ],
    shops: [drink, stall, mill],
    journal: readJournal({
      finance: { day: 3 },
      market: {
        currentLocationId: "docks",
        locations: [
          { id: "coast", kind: "region", parentId: null, name: "The Coast", description: "" },
          { id: "port-city", kind: "city", parentId: "coast", name: "Port City", description: "" },
          { id: "docks", kind: "area", parentId: "port-city", name: "The Docks", description: "" },
          { id: "uptown", kind: "city", parentId: "coast", name: "Uptown", description: "" },
          { id: "brook", kind: "town", parentId: "coast", name: "Brook", description: "" },
        ],
      },
    }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const DEFAULTS: SettlementLimitSettings = { sale: "off", saleLimits: {}, rarity: true, maxRarity: {} };
const profile = (id: string, locationId: string, next: SettlementProfile | null, before: SettlementProfile | null = null): Command => ({
  id, kind: "settlement-profile", locationId, before, profile: next,
});
const limits = (id: string, after: Partial<SettlementLimitSettings>, before: SettlementLimitSettings = DEFAULTS): Command => ({
  id, kind: "settlement-limits", before, after: { ...DEFAULTS, ...after },
});
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);
const wallet = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);
const settlementsOf = (t: CloudTable) => readSettlements((t.journal as { settlements?: unknown }).settlements);
const sell = (id: string, holdingId: string, quantity: number, shopId = "drink"): Command => ({ id, kind: "sell", holdingId, shopId, quantity });
const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};
/** Port City is a small town (1,000 gp per item); Brook a hamlet (200 gp); Uptown has no size. */
const sized = () =>
  run(
    campaign(),
    profile("p1", "port-city", { tier: "small-town", population: "about 3,000" }),
    profile("p2", "brook", { tier: "hamlet" }),
  );
const capped = (mode: "refuse" | "pay-limit") => run(sized(), limits("l1", { sale: mode }));
const REFUSAL = "Shops in Port City pay at most 1,000 gp for one item; this one would fetch 1,500 gp, so this shop won't buy it.";

test("defaults: Pathfinder base values per tier, sale cap off and rarity cap on; old journals sell as before", () => {
  assert.deepEqual(
    SETTLEMENT_LADDERS.pf1.tiers.map((t) => [t.id, t.saleLimit / 100, t.maxRarity]),
    [
      ["thorp", 50, "common"], ["hamlet", 200, "common"], ["village", 500, "uncommon"], ["small-town", 1000, "uncommon"],
      ["large-town", 2000, "rare"], ["small-city", 4000, "rare"], ["large-city", 8000, "magic"], ["metropolis", 16000, "magic"],
    ],
  );
  assert.deepEqual(
    SETTLEMENT_LADDERS.simple.tiers.map((t) => [t.id, t.saleLimit / 100, t.maxRarity]),
    [["village", 500, "common"], ["town", 1000, "uncommon"], ["city", 4000, "rare"], ["large-city", 8000, "magic"], ["capital", 16000, "magic"]],
  );
  assert.deepEqual(limitSettings({}), DEFAULTS);
  // A campaign without settlements, and one with sizes but the cap off: exactly the old payout.
  for (const t of [campaign(), sized()]) {
    assert.equal(settlementSaleLimit(t.journal, drink), undefined);
    const crown = t.holdings.find((h) => h.id === "crown")!;
    assert.deepEqual(shopSale(crown, drink, 2, t.journal, t.purses), shopSellBreakdown(drink, 300_000, 2, crown, { events: [], factions: [] }));
    const sold = applyCommand(t, ariaSeat, sell("s1", "crown", 2));
    assert.equal(wallet(sold, "aria") - wallet(t, "aria"), 300_000);
  }
  // S1's stored shape (no limits, no new profile fields) reads unchanged; the sizes add no key.
  assert.equal("limits" in settlementsOf(sized()), false);
  const raw = JSON.parse(JSON.stringify(sized().journal));
  assert.deepEqual(readJournal(raw).settlements, sized().journal!.settlements);
  // A later phase's fields are ignored, not an error.
  raw.settlements.limits = { sale: "refuse", weekly: true };
  raw.settlements.places["port-city"].restockDays = 7;
  assert.deepEqual(readSettlements(readJournal(raw).settlements).limits, { sale: "refuse" });
});

test("settlement-limits: DM only, checked against what the DM saw, only differences stored, DM-only history", () => {
  const t = sized();
  assert.match(errorOf(() => applyCommand(t, ariaSeat, limits("x", { sale: "refuse" }))), /Only the DM/);
  assert.match(errorOf(() => run(t, limits("x", { sale: "refuse" }, { ...DEFAULTS, sale: "refuse" }))), /changed elsewhere/);
  assert.match(errorOf(() => run(t, limits("x", { saleLimits: { capital: 100 } }))), /belongs to one of this campaign's tiers/);
  assert.match(errorOf(() => run(t, limits("x", { saleLimits: { thorp: 0 } }))), /./, "a limit is at least 1 cp");
  const saved = run(t, limits("l1", { sale: "pay-limit", saleLimits: { "small-town": 100_000, hamlet: 30_000 }, rarity: false, maxRarity: { village: "uncommon", thorp: "rare" } }));
  // Values equal to the tier's default are not stored.
  assert.deepEqual(settlementsOf(saved).limits, { sale: "pay-limit", saleLimits: { hamlet: 30_000 }, rarityOff: true, maxRarity: { thorp: "rare" } });
  assert.deepEqual(limitSettings(settlementsOf(saved)), { sale: "pay-limit", saleLimits: { hamlet: 30_000 }, rarity: false, maxRarity: { thorp: "rare" } });
  assert.deepEqual(saved.shops, t.shops, "limits never rewrite a shop");
  const line = saved.journal!.events.at(-1)!;
  assert.equal(line.summary, "Settlement limits saved: sale cap pay the limit; rarity cap off");
  assert.equal(line.dmOnly, true);
  // Back to the defaults: no limits key is left.
  const reset = run(saved, limits("l2", DEFAULTS, limitSettings(settlementsOf(saved))));
  assert.equal("limits" in settlementsOf(reset), false);
  // Changing the ladder keeps the limits and drops per-tier values the new ladder doesn't have.
  const lone = run(campaign(), limits("l3", { sale: "refuse", saleLimits: { thorp: 1_000, village: 9_000 } }));
  const simple = run(lone, { id: "l4", kind: "settlement-ladder", before: { ladder: "pf1", names: {} }, after: { ladder: "simple", names: {} } });
  assert.deepEqual(settlementsOf(simple).limits, { sale: "refuse", saleLimits: { village: 9_000 } });
});

test("refuse: an item above the place's limit is refused with the limit named; nothing moves", () => {
  const t = capped("refuse");
  assert.deepEqual(settlementSaleLimit(t.journal, drink), { copper: 100_000, mode: "refuse", place: "Port City" });
  assert.equal(errorOf(() => applyCommand(t, ariaSeat, sell("s1", "crown", 1))), REFUSAL);
  // Cheaper items, campaign-wide shops and places without a size are not capped.
  const mug = applyCommand(t, ariaSeat, sell("s2", "mug", 4));
  assert.equal(wallet(mug, "aria") - wallet(t, "aria"), 800);
  const stalled = applyCommand(t, ariaSeat, sell("s3", "crown", 2, "stall"));
  assert.equal(wallet(stalled, "aria") - wallet(t, "aria"), 300_000);
  const free = run(t, profile("m1", "port-city", null, { tier: "small-town", population: "about 3,000" }));
  assert.equal(settlementSaleLimit(free.journal, drink), undefined, "a place whose size is cleared has no cap");
  assert.equal(wallet(applyCommand(free, ariaSeat, sell("s8", "crown", 2)), "aria") - wallet(t, "aria"), 300_000);
  // The hamlet's limit is 200 gp; the DM's per-tier value and a place's own value both win.
  // (The DM sells at Brook's mill: the party is in the Docks.)
  assert.equal(wallet(applyCommand(t, dmSeat, sell("s4", "mug", 1, "mill")), "aria") - wallet(t, "aria"), 200);
  assert.equal(errorOf(() => applyCommand(t, dmSeat, sell("s4b", "crown", 1, "mill"))), REFUSAL.replace("Port City", "Brook").replace("1,000 gp", "200 gp"));
  const tier = run(t, limits("l2", { sale: "refuse", saleLimits: { "small-town": 150_000 } }, limitSettings(settlementsOf(t))));
  assert.equal(wallet(applyCommand(tier, ariaSeat, sell("s5", "crown", 1)), "aria") - wallet(t, "aria"), 150_000);
  const place = run(t, profile("p3", "port-city", { tier: "small-town", population: "about 3,000", saleLimit: 200_000 }, { tier: "small-town", population: "about 3,000" }));
  assert.equal(wallet(applyCommand(place, ariaSeat, sell("s6", "crown", 2)), "aria") - wallet(t, "aria"), 300_000);
  // The shop's own purchase limit applies first: a shop that already pays at most 900 gp is not refused.
  const own = { ...t, shops: t.shops.map((s) => (s.id === "drink" ? { ...s, purchaseLimit: 90_000 } : s)) };
  assert.equal(wallet(applyCommand(own, ariaSeat, sell("s7", "crown", 1)), "aria") - wallet(t, "aria"), 90_000);
  // The breakdown players see before confirming carries the same reason.
  const b = shopSale(t.holdings[0]!, drink, 1, t.journal, t.purses);
  assert.equal(b.refused, REFUSAL);
});

test("pay at the limit: each pricier item pays the limit, shown as a factor; copper is conserved", () => {
  const t = capped("pay-limit");
  const b = shopSale(t.holdings[0]!, drink, 2, t.journal, t.purses);
  assert.equal(b.refused, undefined);
  assert.equal(b.unit, 100_000);
  assert.ok(breakdownLines(b).includes("Shops in Port City pay at most 1,000 gp for one item: −50,000 cp"));
  assert.equal(b.base.copper + b.factors.reduce((n, f) => n + f.copper, 0), b.unit, "the factors add up to the payout");
  const sold = applyCommand(t, ariaSeat, sell("s1", "crown", 2));
  const gained = wallet(sold, "aria") - wallet(t, "aria");
  assert.equal(gained, 200_000);
  assert.equal(drink.merchantPurse! - sold.shops.find((s) => s.id === "drink")!.merchantPurse!, gained, "the shop's purse pays exactly what Aria gains");
  const ledger = sold.ledger.filter((l) => l.id.startsWith("s1"));
  assert.deepEqual(ledger.map((l) => l.copper), [200_000]);
  assert.equal(sold.holdings.some((h) => h.id === "crown"), false);
  // An item at or under the limit is untouched.
  assert.equal(shopSale(t.holdings[1]!, drink, 1, t.journal, t.purses).factors.length, 1, "only the buy rate");
});

test("sell and split: refused lots are named, capped lots split evenly, and every copper lands somewhere", () => {
  const input = { fundId: "hoard", shopId: "drink", lots: [{ holdingId: "hoard-crown", quantity: 2 }, { holdingId: "hoard-mug", quantity: 3 }], recipientIds: ["aria", "bram"], rule: "party-fund" as const };
  const refusing = capped("refuse");
  assert.equal(saleProblem(refusing.holdings[2]!, drink, "dm", refusing.journal, refusing.purses), REFUSAL);
  assert.throws(() => planSaleSplit(refusing, input, { actor: "dm" }), { message: `Jewelled crown: ${REFUSAL}` });
  const t = capped("pay-limit");
  const plan = planSaleSplit(t, input, { actor: "dm" });
  // Two crowns at the 1,000 gp limit and three mugs at round(401 × 0.5) = 201 cp.
  assert.deepEqual(plan.lots.map((l) => [l.unitPaid, l.paid]), [[100_000, 200_000], [201, 603]]);
  assert.equal(plan.proceeds, 200_603);
  const cmd: Command = {
    id: "ss1", kind: "sale-split", fundId: "hoard", shopId: "drink", lots: input.lots, recipientIds: input.recipientIds,
    remainder: { rule: "party-fund" }, expect: { proceeds: plan.proceeds, share: plan.split.share, remainderTo: plan.split.remainderTo },
  };
  const split = run(t, cmd);
  const gains = ["aria", "bram", "hoard"].map((id) => wallet(split, id) - wallet(t, id));
  assert.equal(gains.reduce((a, b) => a + b, 0), plan.proceeds, "proceeds are conserved through the split");
  assert.equal(gains[0], gains[1]);
  assert.equal(drink.merchantPurse! - split.shops.find((s) => s.id === "drink")!.merchantPurse!, plan.proceeds);
  // A stale plan (made before the DM turned the cap on) is refused, never paid at the old price.
  const old = planSaleSplit(sized(), input, { actor: "dm" });
  assert.match(errorOf(() => run(t, { ...cmd, id: "ss2", expect: { proceeds: old.proceeds, share: old.split.share, remainderTo: old.split.remainderTo } })), /changed/);
});

test("projection: players get the mode and each visible place's limit; never the tier table, other places or the rarity cap", () => {
  const t = run(
    capped("pay-limit"),
    limits("l2", { sale: "pay-limit", saleLimits: { hamlet: 30_000 }, maxRarity: { "small-town": "rare" } }, { ...DEFAULTS, sale: "pay-limit" }),
    profile("p3", "uptown", { tier: "metropolis", saleLimit: 2_000_000, maxRarity: "rare" }),
    { id: "n1", kind: "settlement-ladder", before: { ladder: "pf1", names: {} }, after: { ladder: "pf1", names: { "small-town": "Market town", metropolis: "Crown city" } } },
  );
  const view = projectRecord(t, ariaSeat);
  const s = settlementsOf(view);
  // The party is in the Docks: only Port City is on its path.
  assert.deepEqual(s.places, { "port-city": { tier: "small-town", population: "about 3,000", saleLimit: 100_000 } });
  assert.deepEqual(s.limits, { sale: "pay-limit" });
  // Privacy review of S1: only the names of tiers visible places use.
  assert.deepEqual(s.names, { "small-town": "Market town" });
  const text = JSON.stringify(view.journal);
  for (const secret of ["Crown city", "30000", "2000000", "maxRarity", "rarityOff", "saleLimits", "uptown\":{"])
    assert.ok(!text.includes(secret), `the player's copy holds ${secret}`);
  // The player's quote is the charge, and a copy projected again keeps the same values.
  const quoted = shopSale(view.holdings.find((h) => h.id === "crown")!, view.shops.find((x) => x.id === "drink")!, 2, view.journal, view.purses);
  assert.equal(quoted.total, shopSale(t.holdings[0]!, drink, 2, t.journal, t.purses).total);
  assert.deepEqual(settlementsOf(projectRecord(view, ariaSeat)), s);
  assert.deepEqual(settlementsOf(seatView(t, { purseIds: ["aria"] })), s, "Preview as player projects the same");
  // The DM keeps everything; with the cap off players get no limit at all.
  assert.deepEqual(settlementsOf(projectRecord(t, dmSeat)), settlementsOf(t));
  const off = run(t, limits("l3", { ...limitSettings(settlementsOf(t)), sale: "off" }, limitSettings(settlementsOf(t))));
  const offView = settlementsOf(projectRecord(off, ariaSeat));
  assert.equal(offView.limits, undefined);
  assert.deepEqual(offView.places["port-city"], { tier: "small-town", population: "about 3,000" });
});

test("rarity cap: generated stock stays at or under the place's rarest; hand-added stock is never limited", async () => {
  const catalog: CatalogItem[] = (["common", "uncommon", "rare", "magic"] as const).flatMap((rarity) =>
    [1, 2, 3].map((n) => ({ id: `${rarity}-${n}`, name: `${rarity} ${n}`, category: "general", rarity, baseCopper: 100 * n, notes: "", origin: "stock", service: false }) as CatalogItem),
  );
  const flags = { common: true, uncommon: true, rare: true, magic: true };
  const input = { category: "general" as const, wealth: "rich" as const, flags, priceScale: 1, depth: 1, realm: DEFAULT_REALM, selection: "all" as const };
  const t = sized();
  // Port City is a small town: uncommon at most. Brook is a hamlet: common.
  assert.deepEqual(settlementMaxRarity(t.journal, "docks"), { rarity: "uncommon", source: "Port City · Small town" });
  assert.equal(settlementMaxRarity(t.journal, "brook")!.rarity, "common");
  assert.equal(settlementMaxRarity(t.journal, "uptown"), undefined, "no size, no cap");
  assert.equal(settlementMaxRarity(t.journal, null), undefined);
  assert.equal(settlementMaxRarity(campaign().journal, "docks"), undefined);
  const rarities = (cap?: "common" | "uncommon" | "rare" | "magic") =>
    [...new Set(composeShelf(catalog, { ...input, ...(cap ? { maxRarity: cap } : {}) }, () => 0.5).map((l) => l.rarity))].sort();
  assert.deepEqual(rarities(), ["common", "magic", "rare", "uncommon"], "no cap: as before");
  assert.deepEqual(rarities(settlementMaxRarity(t.journal, "docks")!.rarity), ["common", "uncommon"]);
  assert.deepEqual(rarities("common"), ["common"]);
  // The suggested assortment honours it too.
  assert.ok(composeShelf(catalog, { ...input, selection: "suggested", maxRarity: "rare" }, () => 0.3).every((l) => l.rarity !== "magic"));
  // The DM's per-tier value, a place's own value, and turning the cap off.
  const tier = run(t, limits("l1", { maxRarity: { "small-town": "magic" } }));
  assert.equal(settlementMaxRarity(tier.journal, "docks")!.rarity, "magic");
  const place = run(t, profile("p3", "brook", { tier: "hamlet", maxRarity: "rare" }, { tier: "hamlet" }));
  assert.equal(settlementMaxRarity(place.journal, "brook")!.rarity, "rare");
  const off = run(t, limits("l2", { rarity: false }));
  assert.equal(settlementMaxRarity(off.journal, "docks"), undefined);
  // Hand-added stock: the DM adds a magic item to a hamlet's shop; it is stored as given.
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  await addShelfStock("mill", [{ name: "Staff of storms", copper: 500_000, baseCopper: 500_000, quantity: 1, rarity: "magic", notes: "" }]);
  const after = await economySnapshot();
  assert.ok(after.stock.some((s) => s.shopId === "mill" && s.rarity === "magic" && s.name === "Staff of storms"));
  // Existing shops and stock never change when a cap is set.
  assert.deepEqual(run(t, limits("l3", { maxRarity: { "small-town": "common" } })).stock, t.stock);
});

test("shared rooms: a player can't change limits, a replayed sale pays once, the player's quote is the charge", async () => {
  const dm = await openRoom({ name: "Limits DM", table: sized() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: CURRENT_TABLETOP_PROTOCOL };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: CURRENT_TABLETOP_PROTOCOL };
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const state = async () => (await roomState(DT)).table;
  await assert.rejects(submitCommands({ ...AT, batchId: "c0", commands: [limits("c0", { sale: "pay-limit" })] }), /DM/);
  assert.equal(settlementsOf(await state()).limits, undefined);
  await submitCommands({ ...DT, batchId: "c1", commands: [limits("c1", { sale: "pay-limit" })] });
  await submitCommands({ ...DT, batchId: "c1", commands: [limits("c1", { sale: "pay-limit" })] });
  const table = await state();
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("c1-")).length, 1, "a retry changes nothing");
  const view = (await roomState(AT)).table;
  const quoted = shopSale(view.holdings.find((h) => h.id === "crown")!, view.shops.find((s) => s.id === "drink")!, 2, view.journal, view.purses).total;
  assert.equal(quoted, 200_000);
  const start = wallet(table, "aria");
  await submitCommands({ ...AT, batchId: "c2", commands: [sell("c2", "crown", 2)] });
  await submitCommands({ ...AT, batchId: "c2", commands: [sell("c2", "crown", 2)] });
  const after = await state();
  assert.equal(wallet(after, "aria") - start, quoted, "paid once, at the quoted limit");
  assert.equal(after.ledger.filter((l) => l.id.startsWith("c2")).length, 1);
});

test("protocol 32: older apps are refused where the cap lowers a payout; drafts with settlement commands ask them to update", async () => {
  assert.equal(SETTLEMENT_LIMITS_PROTOCOL, 32);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, SETTLEMENT_LIMITS_PROTOCOL);
  const dm = await openRoom({ name: "Old app", table: capped("pay-limit") });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const OLD = { code: dm.code, token: aria.token, tabletopProtocol: QUEST_RENOWN_PROTOCOL };
  const state = async () => (await roomState({ code: dm.code, token: dm.token })).table;
  const start = wallet(await state(), "aria");
  await assert.rejects(submitCommands({ ...OLD, batchId: "o1", commands: [sell("o1", "crown", 1)] }), { message: OLD_CLIENT_SETTLEMENT_PRICE });
  assert.equal(wallet(await state(), "aria"), start, "nothing moved");
  // Under the limit the older app sells as before.
  await submitCommands({ ...OLD, batchId: "o2", commands: [sell("o2", "mug", 1)] });
  assert.equal(wallet(await state(), "aria") - start, 200);
  // The updated app is paid at the limit.
  await submitCommands({ ...OLD, tabletopProtocol: SETTLEMENT_LIMITS_PROTOCOL, batchId: "o3", commands: [sell("o3", "crown", 1)] });
  assert.equal(wallet(await state(), "aria") - start, 100_200);
  // Drafts with any settlement command ask protocol 31 apps to finish on the updated website.
  const t = sized();
  for (const c of [limits("d1", { sale: "refuse" }), profile("d2", "uptown", { tier: "village" })]) {
    const response = { table: t, draft: JSON.stringify([c]) };
    assert.throws(() => tabletopResponse(response, QUEST_RENOWN_PROTOCOL), /updated website/);
    assert.equal(tabletopResponse(response, SETTLEMENT_LIMITS_PROTOCOL).table, t);
  }
});

test("offline parity: the DM's device and the player link pay and refuse exactly as the shared engine", async () => {
  for (const mode of ["refuse", "pay-limit"] as const) {
    setSeat(DM_SEAT);
    await applyCloudTable(sized());
    const steps: Command[] = [limits(`${mode}-l`, { sale: mode })];
    const shared = run(sized(), ...steps);
    for (const s of steps) await executeLocalCommand(s);
    for (const s of steps) await executeLocalCommand(s);
    const once = await economySnapshot();
    assert.deepEqual(once.journal!.settlements, shared.journal!.settlements);
    assert.equal(once.journal!.events.filter((e) => e.summary.startsWith("Settlement limits")).length, 1, "retries change nothing");
    // The DM's device runs the shared `sell`.
    const sharedSale = (() => {
      try {
        return wallet(applyCommand(shared, dmSeat, sell("s1", "crown", 2)), "aria") - wallet(shared, "aria");
      } catch (e) {
        return (e as Error).message;
      }
    })();
    const device = await executeLocalCommand(sell("s1", "crown", 2)).then(
      async () => wallet(await economySnapshot(), "aria") - wallet(once, "aria"),
      (e: Error) => e.message,
    );
    assert.deepEqual(device, sharedSale, `${mode}: device`);
    // The player link: economy.ts's own transaction on Aria's projected copy, with a retry.
    const projected = seatView(shared, { purseIds: ["aria"] });
    setSeat({ role: "player", purseIds: ["aria"], shopIds: ["drink", "stall", "mill"], openedAt: 0 });
    await applyCloudTable(projected);
    const linkStart = wallet(await economySnapshot(), "aria");
    const link = await sellToShop({ holdingId: "crown", shopId: "drink", quantity: 2 }, { commandId: `${mode}-ps1` }).then(
      async () => {
        await sellToShop({ holdingId: "crown", shopId: "drink", quantity: 2 }, { commandId: `${mode}-ps1` });
        return wallet(await economySnapshot(), "aria") - linkStart;
      },
      (e: Error) => e.message,
    );
    assert.deepEqual(link, sharedSale, `${mode}: player link`);
    assert.deepEqual(sharedSale, mode === "refuse" ? REFUSAL : 200_000);
    // Limits are the DM's on the device too.
    assert.match(String(await executeLocalCommand(limits(`${mode}-x`, { sale: "off" })).catch((e: Error) => e.message)), /DM/);
  }
  setSeat(DM_SEAT);
});

test("tiers: the S1 helpers still read the ladder with the new fields", () => {
  const t = sized();
  assert.deepEqual(settlementTiers(settlementsOf(t)).map((x) => x.name).slice(0, 2), ["Thorp", "Hamlet"]);
});
