// Named market events (owner-approved 2026-11-05): DM-authored, named, timed price multipliers
// with a scope (realm, location, shop) and an optional item category. Applied when a shop's asking
// price is computed, never stored into stock; rounded once with the markup and premium. These
// tests pin the logic, the breakdown each viewer sees, the commands' permission, stale checks and
// replay in rooms and on the device (same command, same charge), history, old data, older clients
// and the player projection (secret and hidden events never named).
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { applyCloudTable, buyFromShop, economySnapshot, executeLocalCommand, sellToShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord } from "./session-records.ts";
import { seatView } from "./player-view.ts";
import { fromCopper, toCopper } from "./money.ts";
import { breakdownLines, shopBuyBreakdown, shopSellBreakdown, viewerBreakdown, type PriceBreakdown } from "./price-breakdown.ts";
import { planSaleSplit, unitSalePrice } from "./sale-split.ts";
import { shopAsking } from "./vendors.ts";
import {
  campaignDay,
  effectText,
  eventRate,
  eventStatus,
  lineEvents,
  MARKET_EVENT_LIMIT,
  OTHER_ADJUSTMENTS_ID,
  saleEvents,
  unlimitedEventRate,
  readMarketEvents,
  type MarketEvent,
} from "./market-events.ts";
import {
  CURRENT_TABLETOP_PROTOCOL,
  MARKET_EVENTS_PROTOCOL,
  MARKET_MARKUP_PROTOCOL,
  tableForProtocol,
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

const shopBase = { keeper: "", place: "", notes: "", buyRate: 0.5, wealth: "modest", priceScale: 1 } as const;
const baker: Shop = { ...shopBase, id: "baker", name: "Riverside Baker", sellRate: 1.1, category: "provisions", locationId: "market-ward" };
const smith: Shop = { ...shopBase, id: "smith", name: "Anvil & Sons", sellRate: 1, category: "smith", locationId: "river-city" };
const back: Shop = { ...shopBase, id: "back", name: "Back room", sellRate: 1, category: "general", locationId: "market-ward", blackMarket: true, blackMarketPremium: 1.5 };
const far: Shop = { ...shopBase, id: "far", name: "Far Hill Stores", sellRate: 1, category: "provisions", locationId: "far-hill" };
const line = (id: string, shopId: string, copper: number, category?: string): StockLine => ({
  id,
  shopId,
  name: id,
  copper,
  baseCopper: copper,
  rarity: "common",
  quantity: null,
  notes: "",
  ...(category ? { category } : {}),
});
function campaign(day = 10, blackMarketActive = false): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(100000) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: fromCopper(100000) },
    ],
    shops: [baker, smith, back, far],
    stock: [
      line("grain", "baker", 333, "provisions"),
      line("lace", "baker", 1000, "cloth"),
      line("blade", "smith", 1337),
      line("salt", "back", 99),
      line("oats", "far", 50, "provisions"),
    ],
    journal: readJournal({
      finance: { day },
      market: {
        currentLocationId: "market-ward",
        locations: [
          { id: "riverlands", kind: "region", parentId: null, name: "Riverlands", description: "" },
          { id: "river-city", kind: "city", parentId: "riverlands", name: "River City", description: "" },
          { id: "market-ward", kind: "area", parentId: "river-city", name: "Market Ward", description: "" },
          { id: "hills", kind: "region", parentId: null, name: "Secret Hills", description: "" },
          { id: "far-hill", kind: "town", parentId: "hills", name: "Far Hill", description: "" },
        ],
      },
      world: { blackMarketActive },
    }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const blight: MarketEvent = {
  id: "blight",
  name: "Blight in the Riverlands",
  scope: { kind: "location", locationId: "riverlands" },
  category: "provisions",
  permille: 1800,
  startDay: 5,
  endDay: 26,
  note: "The Duke hoards grain",
};
const festival: MarketEvent = { id: "festival", name: "Harvest festival", scope: { kind: "realm" }, permille: 900, startDay: 8, endDay: 12 };
const add = (id: string, e: MarketEvent): Command => ({ id, kind: "market-event", eventId: e.id, before: null, after: e });
const withEvents = (t: CloudTable, ...events: MarketEvent[]) => {
  let next = t;
  events.forEach((e, i) => (next = applyCommand(next, dmSeat, add(`add-${i}-${e.id}`, e))));
  return next;
};
/** Goods to sell: Aria's grain and an unidentified jewel presented as grain, and a party fund's grain. */
const goods = (t: CloudTable): CloudTable => {
  const item = (id: string, purseId: string, unitCopper: number, category: string, extra: Partial<Holding> = {}): Holding => ({
    id, purseId, name: id, kind: "item", quantity: 4, unitCopper, notes: "", category, ...extra,
  });
  return {
    ...t,
    purses: [...t.purses, { id: "hoard", name: "The Hoard", kind: "party", coins: fromCopper(0) }],
    holdings: [
      item("sack", "aria", 333, "provisions"),
      item("gem", "aria", 5000, "jewels", { unidentified: { name: "Seed pouch", value: 333, category: "provisions" } }),
      item("cloak", "aria", 1000, "cloth"),
      item("hoard-grain", "hoard", 333, "provisions"),
    ],
  };
};
const sum = (b: PriceBreakdown) => b.base.copper + b.factors.reduce((n, f) => n + f.copper, 0);
const wallet = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);

test("logic: days, scope, category, combined rate and status", () => {
  assert.equal(eventStatus(blight, 4), "upcoming");
  assert.equal(eventStatus(blight, 5), "active");
  assert.equal(eventStatus(blight, 25), "active");
  assert.equal(eventStatus(blight, 26), "ended", "the end day is the first day it no longer applies");
  const t = withEvents(campaign(10), blight, festival);
  const j = t.journal;
  assert.equal(campaignDay(j), 10);
  // Grain at the baker: the city ward is inside the Riverlands; both events, start-day order.
  assert.deepEqual(lineEvents(j, baker, t.stock[0]!).map((e) => e.id), ["blight", "festival"]);
  // Lace is cloth: only the realm-wide festival.
  assert.deepEqual(lineEvents(j, baker, t.stock[1]!).map((e) => e.id), ["festival"]);
  // A smith line takes its shop's category; the festival covers all items.
  assert.deepEqual(lineEvents(j, smith, t.stock[2]!).map((e) => e.id), ["festival"]);
  // Far Hill is outside the Riverlands.
  assert.deepEqual(lineEvents(j, far, t.stock[4]!).map((e) => e.id), ["festival"]);
  // Shop scope.
  const one = withEvents(campaign(10), { ...festival, id: "sale", scope: { kind: "shop", shopId: "smith" } });
  assert.deepEqual(lineEvents(one.journal, smith, one.stock[2]!).map((e) => e.id), ["sale"]);
  assert.deepEqual(lineEvents(one.journal, baker, one.stock[0]!), []);
  // Out of its days: nothing.
  assert.deepEqual(lineEvents(withEvents(campaign(30), blight).journal, baker, t.stock[0]!), []);
  assert.equal(eventRate([]), 1);
  assert.equal(eventRate([{ permille: 1800 }, { permille: 900 }]), 1.8 * 0.9);
  assert.equal(eventRate([{ permille: 10000 }, { permille: 10000 }]), 10, "overlapping events stay within ×10");
  assert.equal(eventRate([{ permille: 100 }, { permille: 100 }]), 0.1);
  assert.equal(effectText(1800), "×1.8 (+80%)");
  assert.equal(effectText(900), "×0.9 (−10%)");
  // The combined rate does not depend on the events' order (a player's copy orders them differently).
  const many = [1001, 1333, 900, 7770, 999, 1100].map((permille) => ({ permille }));
  assert.equal(unlimitedEventRate(many), unlimitedEventRate([...many].reverse()));
  assert.equal(eventRate(many), eventRate([many[3]!, many[0]!, many[5]!, many[1]!, many[4]!, many[2]!]));
  // An event ended before it started never applies and counts as ended.
  assert.equal(eventStatus({ startDay: 8, endDay: 8 }, 3), "ended");
  // Selling to a shop: the item's category (an unidentified item's presented one) decides.
  const sold = goods(t);
  const [sack, gem, cloak] = sold.holdings;
  assert.deepEqual(saleEvents(j, baker, sack!).map((e) => e.id), ["blight", "festival"]);
  assert.deepEqual(saleEvents(j, baker, gem!).map((e) => e.id), ["blight", "festival"], "presented as provisions");
  assert.deepEqual(saleEvents(j, baker, cloak!).map((e) => e.id), ["festival"]);
  assert.deepEqual(saleEvents(j, far, sack!).map((e) => e.id), ["festival"]);
  assert.deepEqual(saleEvents(j, baker, { category: undefined }).map((e) => e.id), ["festival"], "no category: all-items events only");
});

test("breakdown: each event by name, rounding once; the asking price is shopAsking's", () => {
  const events = [
    { id: "blight", name: "Blight in the Riverlands", permille: 1800 },
    { id: "festival", name: "Harvest festival", permille: 900 },
  ];
  // 333 × 1.8 × 0.9 × 1.1 = 593.406 → 593; Charisma 14 takes 4%.
  const b = shopBuyBreakdown(baker, 333, 14, 2, { events });
  assert.equal(shopAsking(baker, 333, eventRate(events)), 593);
  assert.equal(sum(b), b.unit);
  assert.deepEqual(breakdownLines(b).slice(0, 4), [
    "List price: 333 cp",
    "Market event: Blight in the Riverlands: +266 cp",
    "Market event: Harvest festival: −60 cp",
    "Shop sells at 110%: +54 cp",
  ]);
  assert.equal(b.factors[0]!.percent, 80);
  assert.equal(b.factors[1]!.percent, -10);
  // No events: exactly the price before this feature.
  assert.deepEqual(shopBuyBreakdown(baker, 333, 14, 2, { events: [] }), shopBuyBreakdown(baker, 333, 14, 2));
  // A secret event is DM-only: players see "Other adjustments" with the same copper and total.
  const secret = shopBuyBreakdown(back, 99, null, 1, { events: [{ id: "x", name: "Smugglers caught", permille: 2000, secret: true }] });
  assert.match(secret.factors[0]!.label, /Smugglers caught \(secret: players see Other adjustments\)/);
  const player = viewerBreakdown(secret, false);
  assert.equal(player.factors[0]!.label, "Other adjustments");
  assert.equal(player.factors[0]!.copper, 99);
  assert.equal(player.total, secret.total);
  assert.doesNotMatch(JSON.stringify(player), /Smugglers/);
  // The ×10 limit is its own factor and still adds up.
  const capped = shopBuyBreakdown(smith, 7, null, 1, { events: [{ id: "a", name: "A", permille: 10000 }, { id: "b", name: "B", permille: 5000 }] });
  assert.equal(capped.unit, 70);
  assert.equal(sum(capped), 70);
  assert.ok(capped.factors.some((f) => f.key === "event-limit"));
});

test("commands: DM only, stale-checked, validated, one DM-only event each; End now keeps history", () => {
  const t = campaign(10);
  assert.throws(() => applyCommand(t, ariaSeat, add("p1", blight)), /Only the DM/);
  assert.throws(() => applyCommand(t, dmSeat, add("p2", { ...blight, scope: { kind: "location", locationId: "nowhere" } })), /existing location/);
  assert.throws(() => applyCommand(t, dmSeat, add("p3", { ...blight, scope: { kind: "shop", shopId: "gone" } })), /existing shop/);
  assert.throws(() => applyCommand(t, dmSeat, add("p4", { ...blight, endDay: blight.startDay })), /at least one day/);
  assert.throws(() => applyCommand(t, dmSeat, add("p5", { ...blight, permille: 50 })));
  assert.throws(() => applyCommand(t, dmSeat, add("p5b", { ...blight, permille: 10001 })));
  assert.throws(() => applyCommand(t, dmSeat, { id: "p6", kind: "market-event", eventId: "other", before: null, after: blight }), /one market event/);
  const on = applyCommand(t, dmSeat, add("p7", blight));
  assert.deepEqual(readMarketEvents(on.journal!.marketEvents), [blight]);
  const logged = on.journal!.events.filter((e) => e.id.startsWith("p7"));
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.dmOnly, true);
  assert.match(logged[0]!.summary, /Market event added: Blight in the Riverlands, ×1.8 \(\+80%\), days 5–26/);
  // Adding the same event again (a replayed add) is refused, never duplicated.
  assert.throws(() => applyCommand(on, dmSeat, add("p8", blight)), /already exists/);
  // Edit: stale `before` refused; a current one applies.
  assert.throws(
    () => applyCommand(on, dmSeat, { id: "p9", kind: "market-event", eventId: "blight", before: { ...blight, permille: 1500 }, after: { ...blight, permille: 2000 } }),
    /changed\. Refresh/,
  );
  const edited = applyCommand(on, dmSeat, { id: "p10", kind: "market-event", eventId: "blight", before: blight, after: { ...blight, permille: 2000 } });
  assert.equal(readMarketEvents(edited.journal!.marketEvents)[0]!.permille, 2000);
  // End now: the end day becomes today, the event stays as history and can't be edited or ended again.
  const ended = applyCommand(edited, dmSeat, { id: "p11", kind: "market-event-end", eventId: "blight", before: { ...blight, permille: 2000 } });
  const kept = readMarketEvents(ended.journal!.marketEvents);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.endDay, 10);
  assert.equal(eventStatus(kept[0]!, 10), "ended");
  assert.throws(() => applyCommand(ended, dmSeat, { id: "p12", kind: "market-event-end", eventId: "blight", before: kept[0]! }), /already ended/);
  assert.throws(() => applyCommand(ended, dmSeat, { id: "p13", kind: "market-event", eventId: "blight", before: kept[0]!, after: { ...kept[0]!, name: "Renamed" } }), /stay as recorded/);
  assert.throws(() => applyCommand(ended, ariaSeat, { id: "p14", kind: "market-event-end", eventId: "blight", before: kept[0]! }), /Only the DM/);
  // Ending an upcoming event: it ends on its start day, without ever applying.
  const upcoming = withEvents(campaign(1), festival);
  const cancelled = applyCommand(upcoming, dmSeat, { id: "p15", kind: "market-event-end", eventId: "festival", before: festival });
  const called = readMarketEvents(cancelled.journal!.marketEvents)[0]!;
  assert.equal(called.endDay, festival.startDay);
  assert.equal(eventStatus(called, 1), "ended");
  assert.equal(eventStatus(called, festival.startDay), "ended", "it never becomes active");
  assert.throws(() => applyCommand(cancelled, dmSeat, { id: "p15b", kind: "market-event-end", eventId: "festival", before: called }), /already ended/);
  // No money or stock moves; stored stock prices are never rewritten.
  assert.deepEqual(ended.purses, t.purses);
  assert.deepEqual(ended.stock, t.stock);
  // The count limit includes ended events.
  const full = campaign(10);
  full.journal!.marketEvents = Array.from({ length: MARKET_EVENT_LIMIT }, (_, i) => ({ ...festival, id: `e${i}` }));
  assert.throws(() => applyCommand(full, dmSeat, add("p16", blight)), /at most 300/);
});

test("old data and older clients: no events means unchanged prices; whole-journal writes keep them", () => {
  assert.deepEqual(readMarketEvents(undefined), []);
  assert.equal(readJournal({}).marketEvents, undefined);
  const t = campaign(10);
  assert.deepEqual(lineEvents(t.journal, baker, t.stock[0]!), []);
  assert.deepEqual(lineEvents(undefined, baker, t.stock[0]!), []);
  assert.equal(campaignDay(readJournal({})), 0);
  const on = withEvents(campaign(10), blight);
  const current = readJournal(on.journal);
  const { marketEvents: _dropped, ...old } = current;
  assert.deepEqual(preserveJournalMetadata(old, current).marketEvents, [blight]);
  // A journal write can't add or change events either: only the commands do.
  assert.equal(preserveJournalMetadata({ ...current, marketEvents: [festival] }, readJournal({})).marketEvents, undefined);
  assert.deepEqual(tableForProtocol(on, 0).journal!.marketEvents, [blight]);
  assert.equal(MARKET_EVENTS_PROTOCOL, 26);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, MARKET_EVENTS_PROTOCOL);
  const table = projectRecord(on, ariaSeat);
  const draft = JSON.stringify([{ id: "d", kind: "market-event-end", eventId: "blight", before: blight }]);
  assert.throws(() => tabletopResponse({ table, draft }, MARKET_MARKUP_PROTOCOL), /updated Lootsplitter client/);
  assert.equal(tabletopResponse({ table, draft }, MARKET_EVENTS_PROTOCOL).table, table);
});

test("projection: players get today's open events without the note; secret and hidden ones unnamed", () => {
  const secretRealm: MarketEvent = { id: "tax", name: "Secret guild levy", scope: { kind: "realm" }, category: "provisions", permille: 1200, startDay: 0, endDay: 99, secret: true, note: "Guild" };
  const hiddenPlace: MarketEvent = { id: "hills", name: "Hill famine", scope: { kind: "location", locationId: "hills" }, permille: 3000, startDay: 0, endDay: 99 };
  const hiddenVendor: MarketEvent = { id: "raid", name: "Watch raid on the back room", scope: { kind: "shop", shopId: "back" }, permille: 2000, startDay: 0, endDay: 99 };
  const upcoming: MarketEvent = { id: "war", name: "Coming war", scope: { kind: "realm" }, permille: 1500, startDay: 50, endDay: 60 };
  const over: MarketEvent = { id: "fair", name: "Old fair", scope: { kind: "realm" }, permille: 1100, startDay: 0, endDay: 3 };
  const t = withEvents(campaign(10), blight, secretRealm, hiddenPlace, hiddenVendor, upcoming, over);
  for (const view of [projectRecord(t, ariaSeat), seatView(t, ariaSeat)]) {
    const events = readMarketEvents(view.journal!.marketEvents);
    const text = JSON.stringify(view.journal);
    for (const secret of ["Duke hoards", "Secret guild levy", "Guild\"", "Hill famine", "hills\"", "Watch raid", "Coming war", "Old fair"])
      assert.doesNotMatch(text, new RegExp(secret), secret);
    // Only the open blight, without its note and with today as its only day; no secret entries.
    assert.deepEqual(events.map((e) => [e.id, e.startDay, e.endDay, e.note, e.secret]), [["blight", 10, 11, undefined, undefined]]);
    // The secret levy affects the two visible shops' provisions: one combined rate for each.
    const adjustments = view.journal!.marketAdjustments!;
    assert.deepEqual(adjustments.map((a) => [a.shopId, a.category, a.day]).sort(), [["baker", "provisions", 10], ["smith", "provisions", 10]]);
    assert.deepEqual(readJournal(view.journal).marketAdjustments, adjustments, "the player's copy parses");
    // The player's own price for grain equals what the DM's campaign charges.
    const grain = view.stock.find((s) => s.id === "grain")!;
    const mine = shopBuyBreakdown(baker, grain.copper, null, 1, { events: lineEvents(view.journal, baker, grain) });
    const charged = shopBuyBreakdown(baker, 333, null, 1, { events: lineEvents(t.journal, baker, t.stock[0]!) });
    assert.equal(mine.total, charged.total);
    const shown = viewerBreakdown(mine, false);
    assert.deepEqual(shown.factors.map((f) => f.label), ["Market event: Blight in the Riverlands", "Other adjustments", "Shop sells at 110%"]);
  }
  // While the black market is hidden, its vendor's event never reaches players; revealed, it does.
  assert.doesNotMatch(JSON.stringify(projectRecord(t, ariaSeat)), /back room|"back"/i);
  const revealed = withEvents(campaign(10, true), hiddenVendor);
  assert.deepEqual(readMarketEvents(projectRecord(revealed, ariaSeat).journal!.marketEvents).map((e) => e.name), ["Watch raid on the back room"]);
  // The DM sees everything, notes included.
  assert.equal(readMarketEvents(projectRecord(t, dmSeat).journal!.marketEvents).length, 6);
  assert.match(JSON.stringify(projectRecord(t, dmSeat).journal), /Duke hoards/);
  // The DM-only log lines never reach players.
  assert.equal(projectRecord(t, ariaSeat).journal!.events.some((e) => /Market event/.test(e.summary)), false);
  // A campaign without events projects without the key.
  assert.equal("marketEvents" in projectRecord(campaign(10), ariaSeat).journal!, false);
  // Projected again (an archive or a device copy of a player's view): the same prices.
  const again = projectRecord(projectRecord(t, ariaSeat), ariaSeat);
  const grain = again.stock.find((s) => s.id === "grain")!;
  assert.equal(
    shopBuyBreakdown(baker, 333, null, 1, { events: lineEvents(again.journal, baker, grain) }).total,
    shopBuyBreakdown(baker, 333, null, 1, { events: lineEvents(t.journal, baker, t.stock[0]!) }).total,
  );
});

test("projection: many shops and many secret events fold into one rate per shop; the player's price is the charge", () => {
  const t0 = campaign(10);
  const shops: Shop[] = Array.from({ length: 40 }, (_, i) => ({ ...baker, id: `s${i}`, name: `Shop ${i}`, sellRate: 1 + (i % 3) / 10 }));
  t0.shops = [...t0.shops, ...shops];
  t0.stock = [...t0.stock, ...shops.flatMap((s, i) => [line(`g${i}`, s.id, 1000, "provisions"), line(`c${i}`, s.id, 777, "cloth"), line(`n${i}`, s.id, 555)])];
  const secret = Array.from({ length: 12 }, (_, i): MarketEvent => ({
    id: `levy-${i}`, name: `Levy ${i}`, scope: { kind: "realm" }, permille: [1200, 1333, 900, 2500][i % 4]!,
    ...(i % 3 === 1 ? { category: "provisions" as const } : {}), startDay: 0, endDay: 99, secret: true,
  }));
  // Twelve secret events multiply past ×10: the clamp must match the server's exactly.
  const t = withEvents(t0, blight, festival, ...secret);
  const view = projectRecord(t, ariaSeat);
  const parsed = readJournal(view.journal);
  assert.deepEqual(readMarketEvents(parsed.marketEvents).map((e) => e.id), ["blight", "festival"]);
  const perShop = new Map<string, number>();
  for (const a of parsed.marketAdjustments!) perShop.set(a.shopId, (perShop.get(a.shopId) ?? 0) + 1);
  assert.ok([...perShop.values()].every((n) => n <= 11), "at most one entry per shop and category");
  assert.doesNotMatch(JSON.stringify(view.journal), /Levy|levy-/);
  for (const s of view.stock) {
    const shop = t.shops.find((x) => x.id === s.shopId)!;
    const server = t.stock.find((x) => x.id === s.id)!;
    const charged = shopBuyBreakdown(shop, server.copper, 14, 3, { events: lineEvents(t.journal, shop, server) });
    const shown = shopBuyBreakdown(shop, s.copper, 14, 3, { events: lineEvents(parsed, shop, s) });
    assert.equal(shown.total, charged.total, s.id);
    assert.equal(sum(viewerBreakdown(shown, false)), shown.unit);
  }
  // Sales too: every category the shop could be paid for.
  for (const shop of view.shops)
    for (const category of [undefined, "provisions", "cloth", "jewels", "weapon"]) {
      const item = { category, unidentified: undefined };
      const charged = shopSellBreakdown(shop, 1000, 2, item, { events: saleEvents(t.journal, shop, item) }).total;
      assert.equal(shopSellBreakdown(shop, 1000, 2, item, { events: saleEvents(parsed, shop, item) }).total, charged, `${shop.id} ${category}`);
    }
  // A shared room buys at the projected price.
  const bought = applyCommand(t, ariaSeat, { id: "many-buy", kind: "buy", stockId: "g7", purseId: "aria", quantity: 3 });
  const g7 = view.stock.find((x) => x.id === "g7")!;
  const shop7 = t.shops.find((x) => x.id === "s7")!;
  assert.equal(wallet(t, "aria") - wallet(bought, "aria"), shopBuyBreakdown(shop7, 1000, null, 3, { events: lineEvents(parsed, shop7, g7) }).total);
});

test("IDs: a DM event can't take the synthetic Other adjustments ID or any odd ID", () => {
  const t = campaign(10);
  for (const bad of [OTHER_ADJUSTMENTS_ID, "other adjustments", "a/b", ""])
    assert.throws(() => applyCommand(t, dmSeat, { id: "bad", kind: "market-event", eventId: bad, before: null, after: { ...festival, id: bad } }), bad);
  // An open event named like the fold never changes a player's price.
  const look = withEvents(campaign(10), { ...festival, id: "other-adjustments", name: "Other adjustments" }, { ...blight, id: "x", secret: true });
  const view = projectRecord(look, ariaSeat);
  const grain = view.stock.find((s) => s.id === "grain")!;
  assert.equal(
    shopBuyBreakdown(baker, 333, null, 1, { events: lineEvents(view.journal, baker, grain) }).total,
    shopBuyBreakdown(baker, 333, null, 1, { events: lineEvents(look.journal, baker, look.stock[0]!) }).total,
  );
});

test("older apps (protocol 25): a price an event changes is refused; unchanged lines trade as before", async () => {
  const table = goods(campaign(10));
  table.shops = table.shops.map((s) => (s.id === "baker" ? { ...s, acceptAnyCategory: true } : s));
  const dm = await openRoom({ name: "Old app", table });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: MARKET_EVENTS_PROTOCOL };
  const OLD = { code: dm.code, token: aria.token, tabletopProtocol: MARKET_MARKUP_PROTOCOL };
  await choosePace({ code: dm.code, token: dm.token, live: true });
  await submitCommands({ ...DT, batchId: "o0", commands: [add("o0", blight)] });
  const state = async () => (await roomState({ code: dm.code, token: dm.token })).table;
  const start = wallet(await state(), "aria");
  // Grain (provisions in the Riverlands) is changed by the blight: refused, nothing moves.
  await assert.rejects(
    submitCommands({ ...OLD, batchId: "o1", commands: [{ id: "o1", kind: "buy", stockId: "grain", purseId: "aria", quantity: 1 }] }),
    /older Lootsplitter app/,
  );
  await assert.rejects(
    submitCommands({ ...OLD, batchId: "o2", commands: [{ id: "o2", kind: "sell", holdingId: "sack", shopId: "baker", quantity: 1 }] }),
    /older Lootsplitter app/,
  );
  assert.equal(wallet(await state(), "aria"), start);
  // Lace (cloth) and the cloak aren't changed by any event: they trade exactly as before.
  await submitCommands({ ...OLD, batchId: "o3", commands: [{ id: "o3", kind: "buy", stockId: "lace", purseId: "aria", quantity: 1 }] });
  await submitCommands({ ...OLD, batchId: "o4", commands: [{ id: "o4", kind: "sell", holdingId: "cloak", shopId: "baker", quantity: 1 }] });
  assert.equal(wallet(await state(), "aria") - start, -1100 + 500);
  // The updated app is charged the event price.
  await submitCommands({ ...OLD, tabletopProtocol: MARKET_EVENTS_PROTOCOL, batchId: "o5", commands: [{ id: "o5", kind: "buy", stockId: "grain", purseId: "aria", quantity: 1 }] });
  assert.equal(wallet(await state(), "aria") - start, -1100 + 500 - Math.round(333 * 1.8 * 1.1));
  // Sell and split planned without the event (167 per sack) is refused with the same reason.
  const old = { ...table, journal: readJournal({ ...table.journal }) };
  const unchanged = planSaleSplit(old, { fundId: "hoard", shopId: "baker", lots: [{ holdingId: "hoard-grain", quantity: 1 }], recipientIds: ["aria"], rule: "party-fund" }, { actor: "dm" });
  await assert.rejects(
    submitCommands({
      code: dm.code, token: dm.token, tabletopProtocol: MARKET_MARKUP_PROTOCOL, batchId: "o6",
      commands: [{ id: "o6", kind: "sale-split", fundId: "hoard", shopId: "baker", lots: [{ holdingId: "hoard-grain", quantity: 1 }], recipientIds: ["aria"], remainder: { rule: "party-fund" }, expect: { proceeds: unchanged.proceeds, share: unchanged.split.share, remainderTo: unchanged.split.remainderTo } }],
    }),
    /older Lootsplitter app/,
  );
});

test("shared rooms: players refused, a retry applies once, and buy charges the breakdown", async () => {
  const dm = await openRoom({ name: "Events DM", table: campaign(10) });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: MARKET_EVENTS_PROTOCOL };
  await choosePace({ ...DT, live: true });
  const state = async () => (await roomState(DT)).table;
  await assert.rejects(submitCommands({ ...AT, batchId: "r0", commands: [add("r0", blight)] }));
  assert.equal((await state()).journal!.marketEvents, undefined);
  const cmd = add("r1", blight);
  await submitCommands({ ...DT, batchId: "r1", commands: [cmd] });
  await submitCommands({ ...DT, batchId: "r1", commands: [cmd] });
  const table = await state();
  assert.deepEqual(table.journal!.marketEvents, [blight]);
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("r1")).length, 1, "a retry changes nothing");
  // The player's view prices grain with the event, and the server charges exactly that.
  const view = (await roomState(AT)).table;
  const grain = view.stock.find((s) => s.id === "grain")!;
  const quoted = shopBuyBreakdown(baker, grain.copper, null, 3, { events: lineEvents(view.journal, baker, grain) });
  assert.equal(quoted.total, Math.round(333 * 1.8 * 1.1) * 3);
  const before = wallet(table, "aria");
  await submitCommands({ ...AT, batchId: "r2", commands: [{ id: "r2", kind: "buy", stockId: "grain", purseId: "aria", quantity: 3 }] });
  await submitCommands({ ...AT, batchId: "r2", commands: [{ id: "r2", kind: "buy", stockId: "grain", purseId: "aria", quantity: 3 }] });
  const after = await state();
  assert.equal(before - wallet(after, "aria"), quoted.total);
  // The stored stock price is unchanged.
  assert.equal(after.stock.find((s) => s.id === "grain")!.copper, 333);
  // End now from the room; the next purchase is back to the list price.
  await submitCommands({ ...DT, batchId: "r3", commands: [{ id: "r3", kind: "market-event-end", eventId: "blight", before: blight }] });
  const ended = await state();
  assert.equal(readMarketEvents(ended.journal!.marketEvents)[0]!.endDay, 10);
  await submitCommands({ ...AT, batchId: "r4", commands: [{ id: "r4", kind: "buy", stockId: "grain", purseId: "aria", quantity: 1 }] });
  assert.equal(wallet(ended, "aria") - wallet(await state(), "aria"), Math.round(333 * 1.1));
});

test("offline: the device runs the same commands and charges the same price; retries apply once", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign(10));
  let shared = campaign(10);
  const steps: Command[] = [add("d1", blight), add("d2", festival), { id: "d3", kind: "market-event-end", eventId: "festival", before: festival }];
  for (const s of steps) shared = applyCommand(shared, dmSeat, s);
  for (const s of steps) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of steps) await executeLocalCommand(s);
  const twice = await economySnapshot();
  assert.deepEqual(once.journal!.marketEvents, shared.journal!.marketEvents);
  assert.deepEqual(twice.journal!.marketEvents, once.journal!.marketEvents, "retries change nothing");
  const logs = (t: CloudTable) => t.journal!.events.filter((e) => /Market event/.test(e.summary)).map((e) => [e.id, e.summary, e.dmOnly]);
  assert.deepEqual(logs(once), logs(shared));
  assert.deepEqual(logs(twice), logs(once));
  // Buying grain on the device and in the shared engine: the same charge, the breakdown's total.
  const expected = shopBuyBreakdown(baker, 333, null, 2, { events: lineEvents(shared.journal, baker, shared.stock[0]!) }).total;
  assert.equal(expected, Math.round(333 * 1.8 * 1.1) * 2);
  const sharedBuy = applyCommand(shared, dmSeat, { id: "b1", kind: "buy", stockId: "grain", purseId: "aria", quantity: 2 });
  assert.equal(wallet(shared, "aria") - wallet(sharedBuy, "aria"), expected);
  await buyFromShop({ stockId: "grain", purseId: "aria", quantity: 2 }, { commandId: "b1" });
  await buyFromShop({ stockId: "grain", purseId: "aria", quantity: 2 }, { commandId: "b1" });
  assert.equal(wallet(once, "aria") - wallet(await economySnapshot(), "aria"), expected);
  const stale = await executeLocalCommand({ ...steps[0]!, id: "d4" }).catch((e: Error) => e.message);
  assert.match(String(stale), /already exists/);
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  const refused = await executeLocalCommand(add("d5", { ...festival, id: "f2" })).catch((e: Error) => e.message);
  assert.match(String(refused), /DM/);
  setSeat(DM_SEAT);
});

test("selling: the payout takes today's events with the buy rate, rounded once, in rooms, offline and in sell and split", async () => {
  const t = withEvents(goods(campaign(10)), blight, festival);
  const sack = t.holdings[0]!;
  // 333 × 0.9 × 1.8 × 0.5 = 269.73 → 270 per sack; the breakdown adds up and names the events.
  const b = shopSellBreakdown(baker, 333, 2, sack, { events: saleEvents(t.journal, baker, sack) });
  assert.equal(b.unit, 270);
  assert.equal(sum(b), b.unit);
  assert.deepEqual(breakdownLines(b).slice(0, 4), [
    "Lot value: 333 cp",
    "Market event: Blight in the Riverlands: +266 cp",
    "Market event: Harvest festival: −60 cp",
    "Shop buys at 50%: −269 cp",
  ]);
  // No events: exactly the payout before this feature.
  assert.deepEqual(shopSellBreakdown(baker, 333, 2, sack, { events: [] }), shopSellBreakdown(baker, 333, 2, sack));
  // Shared `sell` pays the breakdown total; the unidentified gem sells as presented, with the events.
  const sold = applyCommand(t, ariaSeat, { id: "s1", kind: "sell", holdingId: "sack", shopId: "baker", quantity: 2 });
  assert.equal(wallet(sold, "aria") - wallet(t, "aria"), 540);
  const gem = applyCommand(t, ariaSeat, { id: "s2", kind: "sell", holdingId: "gem", shopId: "baker", quantity: 1 });
  assert.equal(wallet(gem, "aria") - wallet(t, "aria"), 270);
  // The player's projected copy quotes the same payout (Why this payout?).
  const view = projectRecord(t, ariaSeat);
  const mine = view.holdings.find((h) => h.id === "sack")!;
  assert.equal(shopSellBreakdown(baker, mine.unitCopper, 2, mine, { events: saleEvents(view.journal, baker, mine) }).total, 540);
  // Sell and split prices each lot the same way, and its reviewed total must match.
  assert.equal(unitSalePrice(t.holdings[3]!, baker, t.journal), 270);
  const plan = planSaleSplit(t, { fundId: "hoard", shopId: "baker", lots: [{ holdingId: "hoard-grain", quantity: 4 }], recipientIds: ["aria", "bram"], rule: "party-fund" }, { actor: "dm" });
  assert.equal(plan.proceeds, 1080);
  const split = applyCommand(t, dmSeat, {
    id: "ss", kind: "sale-split", fundId: "hoard", shopId: "baker", lots: [{ holdingId: "hoard-grain", quantity: 4 }],
    recipientIds: ["aria", "bram"], remainder: { rule: "party-fund" }, expect: { proceeds: 1080, share: 540, remainderTo: null },
  });
  assert.equal(wallet(split, "aria") - wallet(t, "aria"), 540);
  // A review made without the events (668, as an older client would quote it) is refused, never paid differently.
  assert.throws(() =>
    applyCommand(t, dmSeat, {
      id: "ss2", kind: "sale-split", fundId: "hoard", shopId: "baker", lots: [{ holdingId: "hoard-grain", quantity: 4 }],
      recipientIds: ["aria", "bram"], remainder: { rule: "party-fund" }, expect: { proceeds: 668, share: 334, remainderTo: null },
    }),
  );
  // Offline: the device pays the same, once per command ID.
  setSeat(DM_SEAT);
  await applyCloudTable(t);
  const start = wallet(await economySnapshot(), "aria");
  await sellToShop({ holdingId: "sack", shopId: "baker", quantity: 2 }, { commandId: "s1" });
  await sellToShop({ holdingId: "sack", shopId: "baker", quantity: 2 }, { commandId: "s1" });
  const after = await economySnapshot();
  assert.equal(wallet(after, "aria") - start, 540);
  assert.equal(after.holdings.find((h) => h.id === "sack")!.quantity, 2);
});
