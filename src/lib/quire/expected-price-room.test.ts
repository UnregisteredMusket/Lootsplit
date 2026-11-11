// Expected prices on `buy` and `sell` (audit 2026-11-10, C2/A3; owner decision 2026-11-11:
// refuse on any mismatch). A Live-mode player's tap carries the unit price it showed (and, for a
// purchase, the item's name); a DM reprice, a buy-rate cut or a shop-list swap that reuses the
// stock line's ID in between is refused with nothing charged. Older apps (tabletop protocol 33 and
// below) send no `expect` and keep today's behaviour. The device runs the same check: the DM's
// device through the shared command, the player link through buyFromShop/sellToShop.
import "./commands.ts";
import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "./cloud.server.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema, PRICE_CHANGED, type Command } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { applyCloudTable, buyFromShop, buyListing, economySnapshot, sellToShop } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { fromCopper, toCopper } from "./money.ts";
import { stockFingerprint, listFingerprint, shopListsOf } from "./shop-lists.ts";
import { CURRENT_TABLETOP_PROTOCOL, EXPECTED_PRICE_PROTOCOL, SHOP_LISTS_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
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

const general: Shop = {
  id: "general", name: "Harbor General", keeper: "Mira", place: "", notes: "", sellRate: 1, buyRate: 0.5,
  wealth: "modest", priceScale: 1, category: "general", acceptedCategories: ["general"],
};
const rope: StockLine = {
  id: "rope", shopId: "general", name: "Hempen rope", copper: 100, baseCopper: 100, quantity: 6, notes: "", rarity: "common",
};
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [{ id: "aria", name: "Aria Thorne", kind: "character", coins: fromCopper(100_000) }],
    shops: [general],
    stock: [rope],
    holdings: [{ id: "pelt", purseId: "aria", name: "Wolf pelt", kind: "item", quantity: 3, unitCopper: 200, notes: "", category: "general" }],
    listings: [{ id: "cart", name: "Cart", kind: "item", copper: 300, quantity: null, notes: "" }],
    journal: readJournal({
      // A saved list that remembers the rope's line: swapping it in reuses the ID "rope".
      shopLists: { lists: [{ id: "gilded", name: "Gilded goods", items: [{ name: "Gilded rope", copper: 40_000, baseCopper: 40_000, quantity: 1, notes: "", rarity: "rare", lineId: "rope" }] }] },
    }),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const buy = (id: string, expect?: { unit: number; name: string }): Command =>
  ({ id, kind: "buy", stockId: "rope", purseId: "aria", quantity: 1, ...(expect ? { expect } : {}) }) as Command;
const sell = (id: string, expect?: { unit: number }): Command =>
  ({ id, kind: "sell", holdingId: "pelt", shopId: "general", quantity: 1, ...(expect ? { expect } : {}) }) as Command;
const reprice = (t: CloudTable, copper: number): Command => {
  const before = t.stock.find((l) => l.id === "rope")!;
  return { id: `reprice-${copper}`, kind: "patch", changes: [{ store: "stock", id: "rope", before, after: { ...before, copper } }] } as Command;
};
const buyRate = (t: CloudTable, rate: number): Command => {
  const before = t.shops.find((s) => s.id === "general")!;
  return { id: `rate-${rate}`, kind: "patch", changes: [{ store: "shops", id: "general", before, after: { ...before, buyRate: rate } }] } as Command;
};
const swap = (t: CloudTable): Command =>
  ({
    id: "swap-gilded", kind: "shop-list-swap", shopId: "general", listId: "gilded", savedName: "Harbor stock",
    before: stockFingerprint(t.stock, "general"),
    listBefore: listFingerprint(shopListsOf(t.journal).lists.find((l: { id: string }) => l.id === "gilded")!),
  }) as Command;
const coinsOf = (t: CloudTable) => toCopper(t.purses.find((p) => p.id === "aria")!.coins);
function money(t: CloudTable) {
  return {
    coins: coinsOf(t),
    holdings: t.holdings.map((h) => [h.id, h.name, h.quantity]).sort(),
    stock: t.stock.map((l) => [l.id, l.name, l.copper, l.quantity]).sort(),
    ledger: t.ledger.map((l) => l.id).sort(),
    merchant: t.shops.map((s) => s.merchantPurse ?? null),
  };
}
async function liveRoom() {
  const dm = await openRoom({ name: "Expected price", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  await choosePace({ ...dm, live: true });
  return { dm, player: { code: dm.code, token: aria.token } };
}
const refusal = (work: Promise<unknown>) => work.then(() => "", (e: Error) => e.message);

test("the refusal names the price change and says nothing was charged", () => {
  assert.equal(PRICE_CHANGED, "The price changed. Review it again; nothing was charged.");
});

test("Live room: a DM reprice between showing and tapping is refused, nothing charged", async () => {
  const { dm, player } = await liveRoom();
  const host = (await roomState(dm)).table;
  // The player's screen shows the rope at 100 cp; the DM reprices it to 3,000 cp.
  await submitCommands({ ...dm, batchId: "reprice", commands: [reprice(host, 3000)] });
  const repriced = (await roomState(dm)).table;
  const stale = buy("stale-buy", { unit: 100, name: "Hempen rope" });
  assert.equal(await refusal(submitCommands({ ...player, tabletopProtocol: EXPECTED_PRICE_PROTOCOL, batchId: "stale", commands: [stale] })), PRICE_CHANGED);
  assert.deepEqual(money((await roomState(dm)).table), money(repriced));
  // Reviewed again at the new price: charged once, at the price shown.
  const fresh = buy("fresh-buy", { unit: 3000, name: "Hempen rope" });
  await submitCommands({ ...player, tabletopProtocol: EXPECTED_PRICE_PROTOCOL, batchId: "fresh", commands: [fresh] });
  const bought = (await roomState(dm)).table;
  assert.equal(coinsOf(repriced) - coinsOf(bought), 3000);
  // A lost response retried with the same command ID changes nothing.
  await submitCommands({ ...player, tabletopProtocol: EXPECTED_PRICE_PROTOCOL, batchId: "fresh-retry", commands: [fresh] });
  assert.deepEqual(money((await roomState(dm)).table), money(bought));
});

test("Live room: a cut buy rate between showing and tapping refuses the stale sale, nothing paid", async () => {
  const { dm, player } = await liveRoom();
  const host = (await roomState(dm)).table;
  // The pelt (200 cp) shows a 100 cp offer at 50%; the DM cuts the buy rate to 1%.
  await submitCommands({ ...dm, batchId: "rate", commands: [buyRate(host, 0.01)] });
  const cut = (await roomState(dm)).table;
  assert.equal(await refusal(submitCommands({ ...player, tabletopProtocol: EXPECTED_PRICE_PROTOCOL, batchId: "stale", commands: [sell("stale-sell", { unit: 100 })] })), PRICE_CHANGED);
  assert.deepEqual(money((await roomState(dm)).table), money(cut));
  // At the offer now shown (2 cp), the sale goes through.
  await submitCommands({ ...player, tabletopProtocol: EXPECTED_PRICE_PROTOCOL, batchId: "fresh", commands: [sell("fresh-sell", { unit: 2 })] });
  assert.equal(coinsOf((await roomState(dm)).table) - coinsOf(cut), 2);
});

test("Live room: a shop-list swap that reuses the line's ID for another item is refused, nothing charged", async () => {
  const { dm, player } = await liveRoom();
  const host = (await roomState(dm)).table;
  await submitCommands({ ...dm, batchId: "swap", commands: [swap(host)] });
  const swapped = (await roomState(dm)).table;
  // The same line ID is now "Gilded rope" at 40,000 cp.
  const line = swapped.stock.find((l) => l.id === "rope")!;
  assert.deepEqual([line.name, line.copper], ["Gilded rope", 40_000]);
  assert.equal(await refusal(submitCommands({ ...player, tabletopProtocol: EXPECTED_PRICE_PROTOCOL, batchId: "stale", commands: [buy("stale-buy", { unit: 100, name: "Hempen rope" })] })), PRICE_CHANGED);
  assert.deepEqual(money((await roomState(dm)).table), money(swapped));
});

test("a different item at the same price is refused too (the name is part of what was shown)", () => {
  const t = applyCommand(campaign(), dmSeat, { id: "rename", kind: "patch", changes: [{ store: "stock", id: "rope", before: rope, after: { ...rope, name: "Frayed rope" } }] } as Command);
  assert.throws(() => applyCommand(t, ariaSeat, buy("b", { unit: 100, name: "Hempen rope" })), { message: PRICE_CHANGED });
  const ok = applyCommand(t, ariaSeat, buy("b", { unit: 100, name: "Frayed rope" }));
  assert.equal(coinsOf(t) - coinsOf(ok), 100);
});

test("expect is whole, non-negative copper with a bounded name; old commands without it still parse", () => {
  assert.ok(commandSchema.safeParse(buy("a")).success);
  assert.ok(commandSchema.safeParse(sell("a")).success);
  assert.ok(commandSchema.safeParse(buy("a", { unit: 100, name: "Hempen rope" })).success);
  assert.equal(commandSchema.safeParse(buy("a", { unit: 1.5, name: "Hempen rope" })).success, false);
  assert.equal(commandSchema.safeParse(sell("a", { unit: -1 })).success, false);
  assert.equal(commandSchema.safeParse({ ...sell("a"), expect: { unit: 1, extra: 1 } }).success, false);
  assert.equal(commandSchema.safeParse(buy("a", { unit: 100, name: "x".repeat(2001) })).success, false);
});

test("older apps (protocol 33 and below) send no expect and keep today's behaviour", async () => {
  assert.equal(EXPECTED_PRICE_PROTOCOL, 34);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, EXPECTED_PRICE_PROTOCOL);
  const { dm, player } = await liveRoom();
  const host = (await roomState(dm)).table;
  await submitCommands({ ...dm, batchId: "reprice", commands: [reprice(host, 3000)] });
  const repriced = (await roomState(dm)).table;
  await submitCommands({ ...player, tabletopProtocol: SHOP_LISTS_PROTOCOL, batchId: "old-buy", commands: [buy("old-buy")] });
  await submitCommands({ ...player, tabletopProtocol: 11, batchId: "old-sell", commands: [sell("old-sell")] });
  const after = (await roomState(dm)).table;
  assert.equal(coinsOf(repriced) - coinsOf(after), 3000 - 100);
  // A turn-based draft with an expected price reaches an older app: its schema strips the field.
  const draft = JSON.stringify([buy("staged", { unit: 3000, name: "Hempen rope" }), sell("staged-sell", { unit: 100 })]);
  for (const protocol of [11, 19, 31, SHOP_LISTS_PROTOCOL])
    assert.doesNotThrow(() => tabletopResponse({ table: after, draft }, protocol));
});

// The device: the DM's device runs the shared command; the player link runs buyFromShop/sellToShop.
for (const role of ["dm", "player"] as const) {
  const seat = role === "dm" ? DM_SEAT : { role: "player" as const, purseIds: ["aria"], shopIds: ["general"], openedAt: 0 };
  const sharedSeat = role === "dm" ? { ...dmSeat, id: "local" } : ariaSeat;

  test(`device (${role}): a stale buy or sell is refused like the shared engine, nothing charged`, async () => {
    const t = applyCommand(applyCommand(campaign(), dmSeat, reprice(campaign(), 3000)), dmSeat, buyRate(campaign(), 0.01));
    setSeat(DM_SEAT);
    await applyCloudTable(t);
    setSeat(seat);
    const before = money(await economySnapshot());
    const sharedBuy = (() => { try { applyCommand(structuredClone(t), sharedSeat, buy(`dev-buy-${role}`, { unit: 100, name: "Hempen rope" })); return ""; } catch (e) { return (e as Error).message; } })();
    const sharedSell = (() => { try { applyCommand(structuredClone(t), sharedSeat, sell(`dev-sell-${role}`, { unit: 100 })); return ""; } catch (e) { return (e as Error).message; } })();
    assert.equal(sharedBuy, PRICE_CHANGED);
    assert.equal(sharedSell, PRICE_CHANGED);
    assert.equal(await refusal(buyFromShop({ stockId: "rope", purseId: "aria", quantity: 1, expect: { unit: 100, name: "Hempen rope" } }, { commandId: `dev-buy-${role}` })), sharedBuy);
    assert.equal(await refusal(sellToShop({ holdingId: "pelt", shopId: "general", quantity: 1, expect: { unit: 100 } }, { commandId: `dev-sell-${role}` })), sharedSell);
    assert.deepEqual(money(await economySnapshot()), before);
    setSeat(DM_SEAT);
  });

  test(`device (${role}): a matching expect is charged exactly as the shared engine, and once`, async () => {
    const t = applyCommand(campaign(), dmSeat, reprice(campaign(), 3000));
    setSeat(DM_SEAT);
    await applyCloudTable(t);
    setSeat(seat);
    const shared = applyCommand(
      applyCommand(structuredClone(t), sharedSeat, buy(`ok-buy-${role}`, { unit: 3000, name: "Hempen rope" })),
      sharedSeat,
      sell(`ok-sell-${role}`, { unit: 100 }),
    );
    for (let i = 0; i < 2; i++) {
      await buyFromShop({ stockId: "rope", purseId: "aria", quantity: 1, expect: { unit: 3000, name: "Hempen rope" } }, { commandId: `ok-buy-${role}` });
      await sellToShop({ holdingId: "pelt", shopId: "general", quantity: 1, expect: { unit: 100 } }, { commandId: `ok-sell-${role}` });
    }
    assert.deepEqual(money(await economySnapshot()), money(shared));
    setSeat(DM_SEAT);
  });
}

test("market board: a listing changed since it was shown is refused on the player link like the shared engine", async () => {
  const t = campaign();
  const shown = structuredClone(t.listings[0]!);
  const changed = applyCommand(t, dmSeat, { id: "relist", kind: "patch", changes: [{ store: "listings", id: "cart", before: shown, after: { ...shown, copper: 9000 } }] } as Command);
  const shared = (() => { try { applyCommand(structuredClone(changed), ariaSeat, { id: "cart-buy", kind: "listing", listingId: "cart", purseId: "aria", quantity: 1, before: shown } as Command); return ""; } catch (e) { return (e as Error).message; } })();
  assert.match(shared, /This listing changed/);
  setSeat(DM_SEAT);
  await applyCloudTable(changed);
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  const before = money(await economySnapshot());
  assert.equal(await refusal(buyListing({ listingId: "cart", purseId: "aria", quantity: 1, before: shown }, { commandId: "cart-buy" })), shared);
  assert.deepEqual(money(await economySnapshot()), before);
  // As shown now, it is bought once.
  await buyListing({ listingId: "cart", purseId: "aria", quantity: 1, before: (await economySnapshot()).listings[0] }, { commandId: "cart-ok" });
  assert.equal(before.coins - coinsOf(await economySnapshot()), 9000);
  setSeat(DM_SEAT);
});
