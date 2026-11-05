// "Why this price?" breakdowns (comparable-tools research 2026-11-03, priority 2). The commands
// call these functions for the amount they move, so these tests pin (1) that every breakdown's
// total equals the price formula the engine used before this change, over generated inputs,
// (2) that the listed factors add up to the unit price, (3) that the shared and device commands
// charge the breakdown total, and (4) that a player's view never carries DM-only detail.
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCloudTable, blankPurse, buyFromShop, buyListing, economySnapshot, sellToShop } from "./economy.ts";
import { fromCopper, priceAfterCharisma, toCopper } from "./money.ts";
import { readJournal } from "./journal.ts";
import { scalePrice, DEFAULT_REALM } from "./scale.ts";
import {
  barterSweetenBreakdown,
  breakdownLines,
  charismaFor,
  exchangeBreakdown,
  listingBreakdown,
  listPriceDerivation,
  negotiatorFor,
  shopBuyBreakdown,
  shopSellBreakdown,
  sweetenCopper,
  viewerBreakdown,
  type PriceBreakdown,
} from "./price-breakdown.ts";
import type { ItemCategory, ItemRarity, Shop, Wealth } from "./types.ts";

// The formulas exactly as the commands wrote them before this change.
const legacy = {
  buy: (shop: Pick<Shop, "sellRate" | "blackMarket" | "blackMarketPremium">, copper: number, cha: number | null, qty: number) =>
    priceAfterCharisma(Math.round(copper * shop.sellRate * (shop.blackMarket ? (shop.blackMarketPremium ?? 1.5) : 1)), cha) * qty,
  sellServer: (unit: number, buyRate: number, qty: number) => Math.round(unit * buyRate) * qty,
  sellDevice: (unit: number, buyRate: number, qty: number) => Math.max(0, Math.round(unit * buyRate)) * qty,
  listing: (copper: number, cha: number | null, qty: number) => priceAfterCharisma(copper, cha) * qty,
  exchange: (ask: number, bid: number, dir: "buy" | "sell", qty: number) => qty * (dir === "buy" ? ask : bid),
  sweeten: (given: number, received: number, accept: number) =>
    Math.ceil(Math.max(0, Math.ceil((given * accept) / 100) - received) / 10) * 10,
};

// A small deterministic generator (no Math.random, so failures reproduce).
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
const RATES = [0, 0.1, 0.3, 0.33, 0.5, 0.55, 0.6, 0.75, 0.9, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.333, 1.5, 1.65, 2, 2.75, 3, 7.77];
const PREMIUMS = [undefined, 1.01, 1.1, 1.25, 1.5, 2, 3.3, 100];
const CHA = [null, 1, 8, 10, 11, 12, 13, 15, 16, 18, 20, 24, 30, 31, 13.7, Number.NaN];
const COPPER = [0, 1, 2, 3, 5, 7, 9, 10, 15, 33, 45, 99, 100, 125, 333, 999, 1001, 7500, 12345, 250000, 9_999_999];

const sum = (b: PriceBreakdown) => b.base.copper + b.factors.reduce((n, f) => n + f.copper, 0);

test("shop purchase: the breakdown total equals the engine's price for every generated configuration", () => {
  const r = rng(7);
  let checked = 0;
  for (const sellRate of RATES)
    for (const premium of PREMIUMS)
      for (const blackMarket of [false, true])
        for (const cha of CHA) {
          const shop = { sellRate, blackMarket, ...(premium === undefined ? {} : { blackMarketPremium: premium }) };
          const copper = pick(r, COPPER),
            qty = 1 + Math.floor(r() * 40);
          const b = shopBuyBreakdown(shop, copper, cha, qty);
          assert.equal(b.total, legacy.buy(shop, copper, cha, qty), JSON.stringify({ shop, copper, cha, qty }));
          assert.equal(sum(b), b.unit, `factors add up: ${breakdownLines(b).join(" | ")}`);
          assert.equal(b.unit * qty, b.total);
          // The player's folded view keeps the same total and the same unit sum.
          const player = viewerBreakdown(b, false);
          assert.equal(sum(player), b.unit);
          assert.equal(player.total, b.total);
          checked++;
        }
  assert.ok(checked > 5000);
});

test("market events: the breakdown equals list × events × markup × premium, rounded once, for generated inputs", () => {
  const r = rng(26);
  const PERMILLE = [100, 250, 500, 900, 999, 1000, 1001, 1100, 1333, 1800, 2500, 7770, 10000];
  let checked = 0;
  for (const sellRate of RATES)
    for (const premium of PREMIUMS)
      for (const blackMarket of [false, true]) {
        const shop = { sellRate, blackMarket, ...(premium === undefined ? {} : { blackMarketPremium: premium }) };
        for (let i = 0; i < 6; i++) {
          const events = Array.from({ length: Math.floor(r() * 4) }, (_, n) => ({
            id: `e${n}`,
            name: `Event ${n}`,
            permille: pick(r, PERMILLE),
            ...(r() < 0.4 ? { secret: true as const } : {}),
          }));
          let rate = 1;
          for (const e of events) rate *= e.permille / 1000;
          rate = events.length ? Math.min(10, Math.max(0.1, rate)) : 1;
          const copper = pick(r, COPPER),
            cha = pick(r, CHA),
            qty = 1 + Math.floor(r() * 20);
          const b = shopBuyBreakdown(shop, copper, cha, qty, { events });
          const expected =
            priceAfterCharisma(Math.round(copper * rate * sellRate * (blackMarket ? (premium ?? 1.5) : 1)), cha) * qty;
          assert.equal(b.total, expected, JSON.stringify({ shop, copper, cha, qty, events }));
          assert.equal(sum(b), b.unit, `factors add up: ${breakdownLines(b).join(" | ")}`);
          const player = viewerBreakdown(b, false);
          assert.equal(sum(player), b.unit);
          assert.equal(player.total, b.total);
          assert.ok(!JSON.stringify(player).includes("secret"), "secret events are folded for players");
          checked++;
        }
      }
  assert.ok(checked > 1000);
});

test("shop sale, market listing, exchange and barter: the breakdown equals the engine for generated inputs", () => {
  const r = rng(11);
  for (let i = 0; i < 4000; i++) {
    const unit = pick(r, COPPER),
      rate = pick(r, RATES),
      qty = 1 + Math.floor(r() * 99),
      cha = pick(r, CHA);
    const sale = shopSellBreakdown({ buyRate: rate }, unit, qty);
    assert.equal(sale.total, legacy.sellServer(unit, rate, qty));
    assert.equal(sale.total, legacy.sellDevice(unit, rate, qty));
    assert.equal(sum(sale), sale.unit);
    const listing = listingBreakdown(unit, cha, qty);
    assert.equal(listing.total, legacy.listing(unit, cha, qty));
    assert.equal(sum(listing), listing.unit);
    const ask = 1 + pick(r, COPPER),
      bid = Math.floor(ask * r());
    for (const dir of ["buy", "sell"] as const) {
      const ex = exchangeBreakdown({ askCopper: ask, bidCopper: bid }, dir, qty);
      assert.equal(ex.total, legacy.exchange(ask, bid, dir, qty));
    }
    const given = pick(r, COPPER),
      received = pick(r, COPPER),
      accept = 50 + Math.floor(r() * 100);
    assert.equal(sweetenCopper(given, received, accept), legacy.sweeten(given, received, accept));
    const add = sweetenCopper(given, received, accept);
    const dm = barterSweetenBreakdown(add, { npcName: "Mara", given, received, acceptPercent: accept });
    assert.equal(dm.total, add);
    assert.equal(sum(dm), add, breakdownLines(dm).join(" | "));
  }
});

test("list-price derivation appears only when today's rates reproduce the stored price, and adds up", () => {
  const r = rng(3);
  const wealths: Wealth[] = ["poor", "modest", "rich", "princely"];
  const rarities: ItemRarity[] = ["common", "uncommon", "rare", "magic"];
  const cats: ItemCategory[] = ["provisions", "smith", "cloth", "apothecary", "inn", "general", "curios", "stable", "scribe", "jewels"];
  let shown = 0;
  for (let i = 0; i < 3000; i++) {
    const realm = {
      ...DEFAULT_REALM,
      season: Math.floor(r() * 5),
      inflation: pick(r, [0.5, 1, 1.2, 2.5]),
      scarcity: pick(r, [0, 1, 2]),
      war: pick(r, [0, 0.5, 2]),
      plague: pick(r, [0, 1, 2]),
      shortage: pick(r, [0, 1.5]),
      roads: pick(r, [0, 1, 2]),
    };
    const shop = { wealth: pick(r, wealths), priceScale: pick(r, [0.25, 1, 1.4, 3]), category: pick(r, cats) };
    const base = pick(r, COPPER.filter((c) => c > 0));
    const line = { baseCopper: base, rarity: pick(r, rarities), category: shop.category };
    const copper = scalePrice(base, { ...shop, rarity: line.rarity, realm });
    const d = listPriceDerivation(shop, { ...line, copper }, realm)!;
    assert.ok(d, "a stored price made with today's rates is explained");
    assert.equal(base + d.reduce((n, f) => n + f.copper, 0), copper);
    assert.ok(d.every((f) => f.dmOnly));
    // A price the DM edited by hand is not explained by rates that did not make it.
    assert.equal(listPriceDerivation(shop, { ...line, copper: copper + 1 }, realm), undefined);
    shown++;
  }
  assert.equal(shown, 3000);
  // Readable example, as in the research note.
  const winter = listPriceDerivation(
    { wealth: "modest", priceScale: 1, category: "provisions" },
    { baseCopper: 10, rarity: "common", category: "provisions", copper: 15 },
    { ...DEFAULT_REALM, season: 0 },
  )!;
  assert.deepEqual(breakdownLines({ base: { label: "Base", copper: 10 }, listDerivation: winter, factors: [], unit: 15, quantity: 1, total: 15 }), [
    "Base: 10 cp",
    "  Winter +50%: +5 cp",
    "Total: 15 cp (1 sp, 5 cp)",
  ]);
});

test("the negotiator is the paying character, with the same Charisma rule the commands use", () => {
  const hero = { ...blankPurse("character"), id: "aria", name: "Aria" };
  hero.sheet!.scores.cha = 16;
  assert.deepEqual(negotiatorFor(hero, []), { name: "Aria", cha: 16, percent: 6, party: false });
  const fund = { ...blankPurse("party"), id: "fund", name: "Party fund" };
  assert.equal(charismaFor(fund, []), null);
  assert.equal(negotiatorFor(fund, [])!.party, true);
  const b = shopBuyBreakdown({ sellRate: 1 }, 100, 16, 1, { negotiator: negotiatorFor(hero, []) });
  assert.deepEqual(breakdownLines(b), ["List price: 100 cp", "Aria negotiates: Charisma 16, 6% off: −6 cp", "Total: 94 cp (9 sp, 4 cp)"]);
});

test("players see DM-only factors folded into Other adjustments, never their detail; the black-market markup as a description", () => {
  const shop = { sellRate: 1.1, blackMarket: true, blackMarketPremium: 2 };
  const derivation = listPriceDerivation(
    { wealth: "rich", priceScale: 1, category: "smith" },
    { baseCopper: 100, rarity: "rare", category: "smith", copper: scalePrice(100, { wealth: "rich", rarity: "rare", priceScale: 1, category: "smith", realm: { ...DEFAULT_REALM, war: 2 } }) },
    { ...DEFAULT_REALM, war: 2 },
  );
  assert.ok(derivation);
  const b = shopBuyBreakdown(shop, 1000, 14, 2, { listDerivation: derivation });
  const dmText = JSON.stringify(viewerBreakdown(b, true));
  assert.match(dmText, /Black-market markup \+100% \(players see \\"Steep\\"\)/);
  assert.match(dmText, /War/);
  const player = viewerBreakdown(b, false);
  const text = JSON.stringify(player) + breakdownLines(player).join("\n");
  // Owner, 2026-11-04: players see the black-market markup, by default as a description only.
  assert.doesNotMatch(text, /premium|War|wealth|Rarity|\+100%|200/);
  assert.equal(player.listDerivation, undefined);
  assert.deepEqual(player.factors.map((f) => f.label), ["Shop sells at 110%", "Black-market markup: Steep", "Charisma 14, 4% off"]);
  assert.equal(player.total, b.total);
  // Barter: a player's quote has no valuation, so the whole amount is "private valuation", and
  // a player's view of it names no figure but the amount itself.
  const pb = viewerBreakdown(barterSweetenBreakdown(40, { npcName: "Mara" }), false);
  assert.deepEqual(breakdownLines(pb), ["Coins to add: 0 cp", "Other adjustments: +40 cp", "Total: 40 cp (4 sp)"]);
  const dmBarter = viewerBreakdown(barterSweetenBreakdown(40, { npcName: "Mara", given: 500, received: 413, acceptPercent: 90 }), false);
  assert.doesNotMatch(JSON.stringify(dmBarter), /413|500|90%/);
});

// The shared engine and the device charge exactly the breakdown total.
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
function table(): CloudTable {
  const hero = { ...blankPurse("character"), id: "aria", name: "Aria", coins: fromCopper(10_000_000) };
  hero.sheet!.scores.cha = 17;
  return {
    ...emptyCloudTable(),
    purses: [hero, { ...blankPurse("party"), id: "fund", name: "Party fund", coins: fromCopper(10_000_000) }],
    shops: [
      { id: "bm", name: "Back room", keeper: "", place: "", notes: "", sellRate: 1.15, buyRate: 0.33, wealth: "rich", category: "mixed", priceScale: 1, blackMarket: true, blackMarketPremium: 1.37 },
    ],
    stock: [{ id: "blade", shopId: "bm", name: "Blade", copper: 1337, baseCopper: 1337, rarity: "common", quantity: null, notes: "", category: "smith" }],
    holdings: [{ id: "gem", purseId: "aria", kind: "item", name: "Gem", quantity: 9, unitCopper: 777, notes: "", category: "jewels" }],
    listings: [{ id: "cart", name: "Cart", kind: "item", copper: 999, quantity: null, notes: "" }],
    journal: readJournal({ world: { blackMarketActive: true } }),
  };
}
const wallet = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);

test("shared and device commands charge and pay the breakdown total", async () => {
  const t = table();
  const shop = t.shops[0]!;
  const cases = [
    { cmd: { id: "b1", kind: "buy", stockId: "blade", purseId: "aria", quantity: 3 } as const, purse: "aria", delta: -shopBuyBreakdown(shop, 1337, 17, 3).total, device: () => buyFromShop({ stockId: "blade", purseId: "aria", quantity: 3 }, { commandId: "b1" }) },
    { cmd: { id: "b2", kind: "buy", stockId: "blade", purseId: "fund", quantity: 2 } as const, purse: "fund", delta: -shopBuyBreakdown(shop, 1337, null, 2).total, device: () => buyFromShop({ stockId: "blade", purseId: "fund", quantity: 2 }, { commandId: "b2" }) },
    { cmd: { id: "l1", kind: "listing", listingId: "cart", purseId: "aria", quantity: 4 } as const, purse: "aria", delta: -listingBreakdown(999, 17, 4).total, device: () => buyListing({ listingId: "cart", purseId: "aria", quantity: 4 }, { commandId: "l1" }) },
    { cmd: { id: "s1", kind: "sell", holdingId: "gem", shopId: "bm", quantity: 5 } as const, purse: "aria", delta: shopSellBreakdown(shop, 777, 5).total, device: () => sellToShop({ holdingId: "gem", shopId: "bm", quantity: 5 }, { commandId: "s1" }) },
  ];
  for (const c of cases) {
    const shared = applyCommand(table(), dm, c.cmd, { source: "server", random: () => 50 });
    assert.equal(wallet(shared, c.purse) - wallet(t, c.purse), c.delta, c.cmd.id);
    await applyCloudTable(table());
    await c.device();
    const device = await economySnapshot();
    assert.equal(wallet(device, c.purse) - wallet(t, c.purse), c.delta, `device ${c.cmd.id}`);
    // Replay: the same command ID moves nothing more.
    await c.device();
    assert.equal(wallet(await economySnapshot(), c.purse) - wallet(t, c.purse), c.delta, `replay ${c.cmd.id}`);
  }
  // The expected figures, worked by hand: 1337 × 1.15 × 1.37 = 2106.42 → 2106; Charisma 17 takes 7%.
  assert.equal(shopBuyBreakdown(shop, 1337, 17).unit, Math.round((2106 * 93) / 100));
});
