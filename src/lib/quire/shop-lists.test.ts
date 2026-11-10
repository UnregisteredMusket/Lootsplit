// Alternative shop lists (owner request and answers 2026-11-10): a campaign-wide DM library of
// named stock lists, assigned to any shop by a swap that replaces the shop's stock fresh from the
// list and saves the outgoing stock as a new list. These tests pin the schema (round trip, old
// journals and shops unchanged, later fields ignored), the commands (DM only, checked against what
// the DM saw, all or nothing, replay, one DM-only history line), that a swap never touches money,
// purses, buy lists or anyone's inventory, swap-back restoring the same lines, the player
// projection, older clients (whole-journal writes, drafts), the limits, and the device's parity
// with the shared engine.
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
import { applyCloudTable, economySnapshot, executeLocalCommand } from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";
import { projectRecord, archiveSession } from "./session-records.ts";
import { seatView } from "./player-view.ts";
import { fromCopper } from "./money.ts";
import {
  activeShopList,
  listFingerprint,
  readShopLists,
  savedStockName,
  shopListsOf,
  stockFingerprint,
  swapPlan,
} from "./shop-lists.ts";
import {
  MAX_SHOP_LIST_ITEMS,
  MAX_SHOP_LIST_LIBRARY_BYTES,
  MAX_SHOP_LISTS,
  type ShopListContent,
  type ShopListItem,
} from "./shop-lists-schema.ts";
import { CURRENT_TABLETOP_PROTOCOL, SETTLEMENT_LIMITS_PROTOCOL, SHOP_LISTS_PROTOCOL, tabletopResponse } from "./tabletop-protocol.ts";
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

const shopBase = { keeper: "Mira", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", priceScale: 1, category: "general" } as const;
const general: Shop = { ...shopBase, id: "general", name: "Harbor General", merchantPurse: 5000, merchantPurseRefill: 8000, acceptedCategories: ["general"] };
const smithy: Shop = { ...shopBase, id: "smithy", name: "Anvil & Tongs", category: "smith" };
const line = (id: string, shopId: string, name: string, copper: number, quantity: number | null, extra: Partial<StockLine> = {}): StockLine => ({
  id, shopId, name, copper, baseCopper: copper, quantity, notes: "", rarity: "common", ...extra,
});
const pc = (id: string, name: string) => ({ id, name, kind: "character" as const, coins: fromCopper(10000) });
function campaign(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [pc("aria", "Aria Thorne"), pc("bram", "Bram Ironfoot")],
    shops: [general, smithy],
    stock: [
      line("rope", "general", "Hempen rope (50 ft)", 100, 6),
      line("torch", "general", "Torch", 1, null, { notes: "Burns an hour" }),
      line("lantern", "general", "Hooded lantern", 500, 2, { rarity: "uncommon", baseCopper: 450 }),
      line("sword", "smithy", "Longsword", 1500, 3, { category: "smith" }),
    ],
    holdings: [{ id: "aria-rope", purseId: "aria", name: "Hempen rope (50 ft)", kind: "item", quantity: 1, unitCopper: 100, notes: "" }],
    journal: readJournal({}),
  };
}
const dmSeat: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const ariaSeat: CloudSeat = { id: "a", token: "", name: "Aria", role: "player", purseIds: ["aria"] };
const item = (name: string, copper: number, quantity: number | null, extra: Partial<ShopListItem> = {}): ShopListItem => ({
  name, copper, baseCopper: copper, quantity, notes: "", rarity: "common", ...extra,
});
const winter: ShopListContent = {
  name: "Winter goods",
  note: "From the first snow",
  items: [item("Fur cloak", 800, 4, { notes: "Warm" }), item("Snowshoes", 250, 6), item("Hot cider", 2, null, { service: true })],
};
const run = (t: CloudTable, ...cmds: Command[]) => cmds.reduce((next, c) => applyCommand(next, dmSeat, c), t);
const lists = (t: CloudTable) => shopListsOf(t.journal).lists;
const listNamed = (t: CloudTable, name: string) => lists(t).find((l) => l.name === name)!;
const save = (id: string, listId: string, list: ShopListContent, t?: CloudTable): Command => {
  const current = t && lists(t).find((l) => l.id === listId);
  return { id, kind: "shop-list-save", listId, before: current ? listFingerprint(current) : null, list };
};
const capture = (id: string, t: CloudTable, shopId: string, name: string): Command => ({
  id, kind: "shop-list-capture", shopId, name, before: stockFingerprint(t.stock, shopId),
});
const swap = (id: string, t: CloudTable, shopId: string, listId: string, savedName = "Saved stock"): Command => ({
  id, kind: "shop-list-swap", shopId, listId, savedName,
  before: stockFingerprint(t.stock, shopId),
  listBefore: listFingerprint(lists(t).find((l) => l.id === listId)!),
});
const sold = (t: CloudTable, shopId: string) =>
  t.stock.filter((l) => l.shopId === shopId).map((l) => [l.name, l.copper, l.quantity]).sort();
const errorOf = (work: () => unknown) => {
  try {
    work();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};
const winterCampaign = () => run(campaign(), save("w1", "winter", winter));

test("schema: old journals and shops load unchanged; the library round-trips and ignores later fields", () => {
  const old = campaign();
  assert.equal("shopLists" in old.journal!, false);
  assert.deepEqual(readShopLists(undefined), { lists: [] });
  assert.equal(activeShopList(old.journal, "general"), undefined);
  assert.deepEqual(projectRecord(old, dmSeat).stock, old.stock);
  const t = run(winterCampaign(), swap("s1", winterCampaign(), "general", "winter"));
  const raw = JSON.parse(JSON.stringify(t.journal));
  assert.deepEqual(readJournal(raw).shopLists, t.journal!.shopLists);
  raw.shopLists.lists[0].colour = "blue";
  raw.shopLists.lists[0].items[0].laterField = 1;
  raw.shopLists.laterThing = true;
  assert.deepEqual(readShopLists(readJournal(raw).shopLists).lists[0], lists(t)[0]);
});

test("library: the DM creates, edits, renames and deletes lists, checked against what they saw", () => {
  let t = winterCampaign();
  assert.deepEqual(lists(t), [{ id: "winter", ...winter }]);
  const renamed = { ...winter, name: "Deep winter", items: winter.items.slice(0, 2) };
  t = run(t, save("w2", "winter", renamed, t));
  assert.equal(listNamed(t, "Deep winter").items.length, 2);
  // Stale: an edit from the original list is refused.
  assert.match(errorOf(() => run(t, save("w3", "winter", winter, winterCampaign()))), /changed elsewhere/);
  // Names are unique (case-insensitive); creating over an existing ID is stale.
  t = run(t, save("w4", "siege", { name: "Post-siege", items: [item("Salvaged arrows", 1, 40)] }));
  assert.match(errorOf(() => run(t, save("w5", "other", { name: "post-SIEGE", items: [] }))), /already called/);
  assert.match(errorOf(() => run(t, save("w6", "siege", { name: "Anything", items: [] }))), /changed elsewhere/);
  const before = listFingerprint(listNamed(t, "Post-siege"));
  t = run(t, { id: "w7", kind: "shop-list-delete", listId: "siege", before });
  assert.deepEqual(lists(t).map((l) => l.name), ["Deep winter"]);
  // Deleting again changes nothing.
  assert.deepEqual(run(t, { id: "w8", kind: "shop-list-delete", listId: "siege", before }).journal!.shopLists, t.journal!.shopLists);
  const logs = t.journal!.events.filter((e) => /Shop list/.test(e.summary));
  assert.deepEqual(logs.map((e) => e.summary), [
    "Shop list created: Winter goods (3 items)",
    "Shop list renamed: Winter goods → Deep winter (2 items)",
    "Shop list created: Post-siege (1 items)",
    "Shop list deleted: Post-siege",
  ]);
  assert.ok(logs.every((e) => e.dmOnly === true && e.kind === "management"));
});

test("save stock as list: the shop's lines become a list; the shop is unchanged", () => {
  const t0 = campaign();
  const t = run(t0, capture("c1", t0, "general", "Harbor basics"));
  const saved = listNamed(t, "Harbor basics");
  assert.equal(saved.id, "c1");
  assert.deepEqual(saved.items.map((i) => [i.name, i.copper, i.baseCopper, i.quantity, i.rarity, i.notes, i.lineId]), [
    ["Hooded lantern", 500, 450, 2, "uncommon", "", "lantern"],
    ["Hempen rope (50 ft)", 100, 100, 6, "common", "", "rope"],
    ["Torch", 1, 1, null, "common", "Burns an hour", "torch"],
  ]);
  assert.deepEqual(t.stock, t0.stock);
  assert.deepEqual(t.shops, t0.shops);
  assert.match(errorOf(() => run(t0, capture("c2", t0, "nowhere", "X"))), /no longer exists/);
  const stale = capture("c3", t0, "general", "Later");
  assert.match(errorOf(() => run(run(t0, { id: "b0", kind: "buy", stockId: "rope", purseId: "aria", quantity: 1 }), stale)), /changed elsewhere/);
  assert.match(errorOf(() => run(t0, capture("c4", t0, "general", "   "))), /name/i);
});

test("swap: fresh from the list, the outgoing stock is saved, and swapping back restores the same lines", () => {
  const t0 = winterCampaign();
  const name = savedStockName("Harbor General", "Winter goods", "10 Nov 2026");
  assert.equal(name, "Harbor General stock before Winter goods, 10 Nov 2026");
  const t1 = run(t0, swap("s1", t0, "general", "winter", name));
  assert.deepEqual(sold(t1, "general"), [["Fur cloak", 800, 4], ["Hot cider", 2, null], ["Snowshoes", 250, 6]]);
  assert.equal(t1.stock.find((l) => l.name === "Hot cider")!.service, true);
  assert.equal(t1.stock.find((l) => l.name === "Fur cloak")!.notes, "Warm");
  assert.deepEqual(sold(t1, "smithy"), sold(t0, "smithy"), "other shops keep their stock");
  const saved = listNamed(t1, name);
  assert.deepEqual(saved.items.map((i) => [i.name, i.quantity, i.lineId]), [["Hooded lantern", 2, "lantern"], ["Hempen rope (50 ft)", 6, "rope"], ["Torch", null, "torch"]]);
  assert.equal(activeShopList(t1.journal, "general")!.name, "Winter goods");
  // The list itself is a template: selling from the shop never changes it.
  const t2 = run(t1, { id: "b1", kind: "buy", stockId: t1.stock.find((l) => l.name === "Fur cloak")!.id, purseId: "aria", quantity: 1 });
  assert.deepEqual(listNamed(t2, "Winter goods").items, winter.items);
  // Swap back: the original lines, with their IDs, prices and quantities.
  const t3 = run(t2, swap("s2", t2, "general", saved.id, "Harbor General stock before saved, 11 Nov 2026"));
  assert.deepEqual(t3.stock.filter((l) => l.shopId === "general").sort((a, b) => a.id.localeCompare(b.id)), t0.stock.filter((l) => l.shopId === "general").sort((a, b) => a.id.localeCompare(b.id)));
  // The winter stock (one cloak sold) was saved in turn; the active list follows the swap.
  assert.deepEqual(listNamed(t3, "Harbor General stock before saved, 11 Nov 2026").items.find((i) => i.name === "Fur cloak")!.quantity, 3);
  assert.equal(activeShopList(t3.journal, "general")!.id, saved.id);
  const swaps = t3.journal!.events.filter((e) => e.summary.includes("stock swapped"));
  assert.deepEqual(swaps.map((e) => e.summary), [
    `Harbor General: stock swapped to Winter goods (3 items); previous stock saved as ${name} (3 items)`,
    "Harbor General: stock swapped to Harbor General stock before Winter goods, 10 Nov 2026 (3 items); previous stock saved as Harbor General stock before saved, 11 Nov 2026 (3 items)",
  ]);
  assert.ok(swaps.every((e) => e.dmOnly === true));
});

test("swap never touches money, purses, buy lists, ledger, the treasure pool or anyone's inventory", () => {
  const t0 = run(winterCampaign(), { id: "b0", kind: "buy", stockId: "rope", purseId: "aria", quantity: 2 });
  const t1 = run(t0, swap("s1", t0, "general", "winter"));
  assert.deepEqual(t1.purses, t0.purses);
  assert.deepEqual(t1.holdings, t0.holdings);
  assert.deepEqual(t1.ledger, t0.ledger);
  assert.deepEqual(t1.shops, t0.shops, "merchant purse, refill, buy list and wealth unchanged");
  assert.deepEqual(t1.listings, t0.listings);
  assert.deepEqual((t1.journal as any).lootPool, (t0.journal as any).lootPool);
});

test("swap is all or nothing: stale stock, stale list, a missing list or a property supplier change nothing", () => {
  const t0 = winterCampaign();
  const stale = swap("s1", t0, "general", "winter");
  const bought = run(t0, { id: "b0", kind: "buy", stockId: "rope", purseId: "aria", quantity: 1 });
  assert.match(errorOf(() => run(bought, stale)), /stock changed elsewhere/);
  const edited = run(t0, save("w2", "winter", { ...winter, items: winter.items.slice(1) }, t0));
  assert.match(errorOf(() => run(edited, { ...stale, before: stockFingerprint(edited.stock, "general") } as Command)), /list changed elsewhere/);
  assert.match(errorOf(() => run(t0, { ...stale, listId: "missing" } as Command)), /no longer exists/);
  // A property supplier buys rope from this shop: the swap is refused.
  const supplied = structuredClone(t0);
  (supplied.journal as any).propertyOperations = {
    suppliers: [{ id: "sup", propertyId: "mill", stockId: "rope", materialKey: "rope", deliveryDays: 1, deliveryCopper: 0, weight: 1 }],
  };
  const before = JSON.stringify(supplied);
  const message = errorOf(() => applyCommand(supplied, dmSeat, swap("s2", supplied, "general", "winter")));
  assert.match(message, /property supplier buys Hempen rope/);
  assert.equal(JSON.stringify(supplied), before, "the caller's table is untouched");
});

test("dedupe: the outgoing stock is not saved twice; an empty shop saves nothing", () => {
  const t0 = winterCampaign();
  const t1 = run(t0, swap("s1", t0, "general", "winter", "First"));
  // Swapping the same list in again (a restock from the list) saves nothing new.
  const t2 = run(t1, swap("s2", t1, "general", "winter", "Second"));
  assert.deepEqual(lists(t2).map((l) => l.name), ["Winter goods", "First"]);
  assert.match(t2.journal!.events.at(-1)!.summary, /already saved as Winter goods/);
  assert.deepEqual(swapPlan(t1, "general", "winter", "Second").keptIn?.name, "Winter goods");
  // An empty shop: nothing saved.
  const empty = { ...t0, stock: t0.stock.filter((l) => l.shopId !== "general") };
  const t3 = run(empty, swap("s3", empty, "general", "winter", "Nothing"));
  assert.deepEqual(lists(t3).map((l) => l.name), ["Winter goods"]);
  assert.match(t3.journal!.events.at(-1)!.summary, /had no stock/);
  // A saved name in use gets a number.
  const t4 = run(t0, save("x", "x", { name: "Saved stock", items: [] }));
  const t5 = run(t4, swap("s4", t4, "general", "winter"));
  assert.ok(lists(t5).some((l) => l.name === "Saved stock (2)"));
});

test("a swapped-in trade link whose exchange is gone is dropped; the item stays", () => {
  const t0 = run(campaign(), save("w1", "w", { name: "Linked", items: [item("Salt", 10, 5, { commodityId: "salt", tradeExchangeId: "gone" })] }));
  const t1 = run(t0, swap("s1", t0, "general", "w"));
  const salt = t1.stock.find((l) => l.name === "Salt")!;
  assert.equal(salt.commodityId, undefined);
  assert.equal(salt.tradeExchangeId, undefined);
});

test("limits: lists, items per list and the library's size are refused with clear errors", () => {
  const many = { name: "Huge", items: Array.from({ length: MAX_SHOP_LIST_ITEMS + 1 }, (_, i) => item(`Thing ${i}`, 1, 1)) };
  assert.match(errorOf(() => run(campaign(), save("h", "h", many))), /at most 200 items/);
  let t = campaign();
  for (let i = 0; i < MAX_SHOP_LISTS; i++) t = run(t, save(`l${i}`, `l${i}`, { name: `List ${i}`, items: [] }));
  assert.match(errorOf(() => run(t, save("over", "over", { name: "One more", items: [] }))), /at most 60 lists/);
  const notes = "n".repeat(3000);
  let big = campaign();
  const bigList = (n: number) => ({ name: `Big ${n}`, items: Array.from({ length: 40 }, (_, i) => item(`Item ${i}`, 1, 1, { notes })) });
  const message = errorOf(() => {
    for (let n = 0; n < 10; n++) big = run(big, save(`b${n}`, `b${n}`, bigList(n)));
  });
  assert.match(message, /library is full/);
  assert.ok(JSON.stringify(big.journal!.shopLists).length <= MAX_SHOP_LIST_LIBRARY_BYTES, "within one feature's share (400 KB)");
});

test("privacy: players never receive the library or which list a shop uses; they see the new stock", () => {
  const t0 = winterCampaign();
  const t = run(t0, swap("s1", t0, "general", "winter", "Harbor General stock before Winter goods, 10 Nov 2026"));
  const player = projectRecord(t, ariaSeat);
  assert.equal("shopLists" in player.journal!, false);
  assert.ok(!JSON.stringify(player).includes("Winter goods"), "no list name, no history line");
  assert.deepEqual(sold(player, "general"), sold(t, "general"));
  assert.equal("shopLists" in seatView(t, { purseIds: ["aria"] }).journal!, false);
  assert.deepEqual(projectRecord(t, dmSeat).journal!.shopLists, t.journal!.shopLists);
  const archived = structuredClone(t);
  archiveSession(archived, "session-1", "Session 1", 1);
  assert.ok(!JSON.stringify(projectRecord(archived, ariaSeat).journal).includes("Winter goods"));
});

test("older clients: whole-journal writes keep the stored library; drafts with shop-list commands ask them to update", () => {
  const t = winterCampaign();
  const { shopLists: _dropped, ...old } = t.journal as Record<string, unknown>;
  assert.deepEqual(preserveJournalMetadata(old, t.journal!).shopLists, t.journal!.shopLists);
  const forged = { ...t.journal, shopLists: { lists: [] } };
  assert.deepEqual(preserveJournalMetadata(forged, t.journal!).shopLists, t.journal!.shopLists);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, SHOP_LISTS_PROTOCOL);
  const draft = JSON.stringify([save("w1", "winter", winter)]);
  const value = { table: t, draft };
  assert.throws(() => tabletopResponse(value, SETTLEMENT_LIMITS_PROTOCOL), /updated website/);
  assert.equal(tabletopResponse(value, SHOP_LISTS_PROTOCOL).draft, draft);
});

test("shared rooms: players refused on the server, a replayed command ID applies once, players see the new stock", async () => {
  const dm = await openRoom({ name: "Shop lists DM", table: campaign() });
  const aria = await joinRoom({ code: dm.code, purseId: "aria", name: "Aria" });
  const DT = { code: dm.code, token: dm.token, tabletopProtocol: CURRENT_TABLETOP_PROTOCOL };
  const AT = { code: dm.code, token: aria.token, tabletopProtocol: CURRENT_TABLETOP_PROTOCOL };
  await choosePace({ code: dm.code, token: dm.token, live: true });
  const state = async () => (await roomState(DT)).table;
  const create = save("c1", "winter", winter);
  await assert.rejects(submitCommands({ ...AT, batchId: "c0", commands: [{ ...create, id: "c0" }] }), /DM/);
  assert.equal((await state()).journal!.shopLists, undefined);
  await submitCommands({ ...DT, batchId: "c1", commands: [create] });
  await submitCommands({ ...DT, batchId: "c1", commands: [create] });
  const before = await state();
  const command = swap("s1", before, "general", "winter", "Harbor General stock before Winter goods, 10 Nov 2026");
  await assert.rejects(submitCommands({ ...AT, batchId: "s0", commands: [{ ...command, id: "s0" }] }), /DM/);
  await submitCommands({ ...DT, batchId: "s1", commands: [command] });
  await submitCommands({ ...DT, batchId: "s1", commands: [command] });
  const table = await state();
  assert.deepEqual(lists(table).map((l) => l.name), ["Winter goods", "Harbor General stock before Winter goods, 10 Nov 2026"]);
  assert.equal(table.journal!.events.filter((e) => e.id.startsWith("s1-")).length, 1, "a retry changes nothing");
  assert.deepEqual(sold(table, "general"), [["Fur cloak", 800, 4], ["Hot cider", 2, null], ["Snowshoes", 250, 6]]);
  assert.deepEqual(table.purses, before.purses);
  const view = (await roomState(AT)).table;
  assert.equal("shopLists" in view.journal!, false);
  assert.deepEqual(sold(view, "general"), sold(table, "general"));
  assert.ok(!JSON.stringify(view.journal!.events).includes("Winter goods"), "the history line is the DM's");
});

test("offline parity: the device runs the same commands with the same results, retries and errors", async () => {
  setSeat(DM_SEAT);
  await applyCloudTable(campaign());
  const shared0 = campaign();
  const s1 = save("d1", "winter", winter);
  const after1 = run(shared0, s1);
  const s2 = capture("d2", after1, "smithy", "Smithy basics");
  const after2 = run(after1, s2);
  const s3 = swap("d3", after2, "general", "winter", "Harbor General stock before Winter goods, 10 Nov 2026");
  const shared = run(after2, s3);
  for (const s of [s1, s2, s3]) await executeLocalCommand(s);
  const once = await economySnapshot();
  for (const s of [s1, s2, s3]) await executeLocalCommand(s);
  const twice = await economySnapshot();
  assert.deepEqual(once.journal!.shopLists, shared.journal!.shopLists);
  assert.deepEqual(twice.journal!.shopLists, once.journal!.shopLists, "retries change nothing");
  const byId = (rows: StockLine[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(once.stock), byId(shared.stock));
  assert.deepEqual(byId(twice.stock), byId(once.stock));
  const logs = (t: CloudTable) => t.journal!.events.filter((e) => /Shop list|stock swapped/.test(e.summary)).map((e) => [e.id, e.summary, e.dmOnly]);
  assert.deepEqual(logs(once), logs(shared));
  assert.deepEqual(logs(twice), logs(once));
  assert.deepEqual(once.purses.map((p) => [p.id, p.coins]), shared.purses.map((p) => [p.id, p.coins]));
  const bad = swap("d4", after2, "general", "winter");
  const sharedError = errorOf(() => run(shared, bad));
  assert.ok(sharedError);
  assert.equal(await executeLocalCommand(bad).catch((e: Error) => e.message), sharedError);
  assert.deepEqual(byId((await economySnapshot()).stock), byId(once.stock), "a refused swap changes nothing");
  // DM only on the device too.
  setSeat({ role: "player", purseIds: ["aria"], shopIds: [], openedAt: 0 });
  assert.match(String(await executeLocalCommand(save("d5", "y", { name: "Y", items: [] })).catch((e: Error) => e.message)), /DM/);
  setSeat(DM_SEAT);
});
