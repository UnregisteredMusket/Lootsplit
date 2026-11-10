/**
 * Alternative shop lists (owner request and answers 2026-11-10; shapes and commands in
 * shop-lists-schema.ts).
 *
 * - Reusable library: the DM builds named stock lists once, campaign-wide, and can assign any list
 *   to any shop.
 * - Swap, fresh from the list: the shop's stock lines become the list's items and quantities, in
 *   one command. The outgoing stock is saved as a new list ("<Shop> stock before <list>, <date>"),
 *   so nothing is lost and the DM can swap back; it is not saved again when it is empty or when a
 *   list already holds exactly those items (swapping a list in twice saves nothing new).
 * - Only the shop's stock lines and the library change: coins, merchant purses, buy lists, shop
 *   wealth, ledger and receipts, the treasure pool and items in anyone's inventory never do. A
 *   swap is refused (nothing changes) when a property supplier buys from a line it would remove.
 * - Swapping a saved stock back reuses its original line IDs where they are free, so undoing an
 *   earlier purchase and the shop's suppliers keep working.
 * - DM-only: every command needs the DM's seat, players' copies never contain the library or
 *   which list a shop uses (`projectRecord` deletes the key), and each change writes one DM-only
 *   history line.
 */
import { canonicalJson } from "./canonical-json.ts";
import { hashText } from "./journey-engine.ts";
import { readEstate } from "./estate-schema.ts";
import {
  MAX_SHOP_LIST_ITEM_NAME,
  MAX_SHOP_LIST_ITEM_NOTES,
  MAX_SHOP_LIST_ITEMS,
  MAX_SHOP_LIST_LIBRARY_BYTES,
  MAX_SHOP_LIST_LIBRARY_ITEMS,
  MAX_SHOP_LIST_NAME,
  MAX_SHOP_LISTS,
  shopListsSchema,
  type ShopList,
  type ShopListCommand,
  type ShopListItem,
  type ShopLists,
} from "./shop-lists-schema.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { ItemRarity, StockLine } from "./types.ts";

const RARITIES: readonly ItemRarity[] = ["common", "uncommon", "rare", "magic"];
const STALE_LIST = "This shop list changed elsewhere. Refresh; nothing was saved.";
const STALE_STOCK = "This shop's stock changed elsewhere. Review it again; nothing was changed.";

type JournalLike = { shopLists?: unknown } | undefined | null;

/** The stored library, read leniently: a campaign without one has no lists. */
export function readShopLists(value: unknown): ShopLists {
  const parsed = shopListsSchema.parse(value ?? {});
  return { lists: [...parsed.lists], ...(parsed.active ? { active: { ...parsed.active } } : {}) };
}
/** For views: never throws (a damaged library reads as empty). */
export function shopListsOf(journal: JournalLike): ShopLists {
  try {
    return readShopLists(journal?.shopLists);
  } catch {
    return { lists: [] };
  }
}

/** One stock line as a list item (missing rarity and base price as economy.ts normalizes them). */
export function itemFromLine(line: StockLine): ShopListItem {
  const rarity = RARITIES.includes(line.rarity) ? line.rarity : "common";
  const baseCopper = typeof line.baseCopper === "number" && line.baseCopper > 0 ? line.baseCopper : line.copper;
  return {
    name: String(line.name ?? "").trim().slice(0, MAX_SHOP_LIST_ITEM_NAME) || "Unnamed item",
    copper: line.copper,
    baseCopper,
    quantity: line.quantity,
    notes: line.notes ?? "",
    rarity,
    ...(line.category !== undefined ? { category: line.category } : {}),
    ...(line.service !== undefined ? { service: line.service } : {}),
    ...(line.commodityId !== undefined ? { commodityId: line.commodityId } : {}),
    ...(line.tradeExchangeId !== undefined ? { tradeExchangeId: line.tradeExchangeId } : {}),
    lineId: line.id,
  };
}
/** A shop's lines in a stable order (by ID). */
function shopLines(stock: readonly StockLine[], shopId: string): StockLine[] {
  return stock.filter((l) => l.shopId === shopId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** What the DM saw of a shop's stock: client and server compute it the same way. */
export function stockFingerprint(stock: readonly StockLine[], shopId: string): string {
  return hashText(canonicalJson(shopLines(stock, shopId).map(itemFromLine)));
}
export function listFingerprint(list: ShopList): string {
  return hashText(canonicalJson(list));
}
/** Items compared by what a shop sells (not where they came from). */
function contentKey(items: readonly ShopListItem[]): string {
  return canonicalJson(items.map(({ lineId: _lineId, ...rest }) => rest));
}

/** The list a shop last had swapped in, if it still exists. DM-only. */
export function activeShopList(journal: JournalLike, shopId: string): ShopList | undefined {
  const lists = shopListsOf(journal);
  const listId = lists.active?.[shopId];
  return listId ? lists.lists.find((l) => l.id === listId) : undefined;
}

/** The default name of the outgoing stock's list: "<Shop> stock before <list>, <date>". */
export function savedStockName(shopName: string, listName: string, date: string): string {
  const tail = ` stock before ${listName}, ${date}`;
  const room = Math.max(1, MAX_SHOP_LIST_NAME - tail.length);
  const name = `${shopName.trim().slice(0, room) || "Shop"}${tail}`;
  return name.length <= MAX_SHOP_LIST_NAME ? name : name.slice(0, MAX_SHOP_LIST_NAME).trimEnd();
}

/** A name not used by another list: "Name", then "Name (2)", "Name (3)"… */
function uniqueName(lists: readonly ShopList[], wanted: string, exceptId?: string): string {
  const taken = new Set(lists.filter((l) => l.id !== exceptId).map((l) => l.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = wanted.slice(0, MAX_SHOP_LIST_NAME - suffix.length).trimEnd() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * What a swap will do, for the DM's confirmation and the command alike: the stock that leaves
 * (as items), whether it is saved and under which name, or which list already holds it.
 */
export function swapPlan(
  t: Pick<CloudTable, "stock" | "journal">,
  shopId: string,
  listId: string,
  savedName: string,
): { list: ShopList | undefined; outgoing: ShopListItem[]; save: string | null; keptIn: ShopList | null } {
  const lists = shopListsOf(t.journal);
  const list = lists.lists.find((l) => l.id === listId);
  const outgoing = shopLines(t.stock, shopId).map(itemFromLine);
  if (!outgoing.length) return { list, outgoing, save: null, keptIn: null };
  const key = contentKey(outgoing);
  const keptIn = lists.lists.find((l) => contentKey(l.items) === key) ?? null;
  return { list, outgoing, save: keptIn ? null : uniqueName(lists.lists, savedName.trim()), keptIn };
}

function checkLibrary(lists: ShopLists): void {
  if (lists.lists.length > MAX_SHOP_LISTS)
    throw Error(`The shop list library holds at most ${MAX_SHOP_LISTS} lists. Delete lists you no longer need; nothing was changed.`);
  for (const l of lists.lists)
    if (l.items.length > MAX_SHOP_LIST_ITEMS)
      throw Error(`A shop list holds at most ${MAX_SHOP_LIST_ITEMS} items ("${l.name}" would have ${l.items.length}); nothing was changed.`);
  const items = lists.lists.reduce((n, l) => n + l.items.length, 0);
  if (items > MAX_SHOP_LIST_LIBRARY_ITEMS)
    throw Error(`All shop lists together hold at most ${MAX_SHOP_LIST_LIBRARY_ITEMS} items. Delete lists you no longer need; nothing was changed.`);
  if (JSON.stringify(lists).length > MAX_SHOP_LIST_LIBRARY_BYTES)
    throw Error("The shop list library is full. Delete lists you no longer need or shorten item notes; nothing was changed.");
}

/** Saved stock must fit a list (long notes, too many lines): a clear refusal, nothing changes. */
function checkItems(items: readonly ShopListItem[]): void {
  if (items.length > MAX_SHOP_LIST_ITEMS)
    throw Error(`This shop has ${items.length} stock lines; a shop list holds at most ${MAX_SHOP_LIST_ITEMS}. Nothing was changed.`);
  for (const item of items)
    if (item.notes.length > MAX_SHOP_LIST_ITEM_NOTES)
      throw Error(`${item.name}'s notes are too long to save in a list (over ${MAX_SHOP_LIST_ITEM_NOTES} characters). Shorten them first; nothing was changed.`);
}

function store(journal: { shopLists?: unknown }, lists: ShopLists, shopIds: ReadonlySet<string>): void {
  // A deleted shop or list no longer names an active list.
  const listIds = new Set(lists.lists.map((l) => l.id));
  const active = Object.fromEntries(
    Object.entries(lists.active ?? {}).filter(([shopId, listId]) => shopIds.has(shopId) && listIds.has(listId)),
  );
  const next = readShopLists({ lists: lists.lists, ...(Object.keys(active).length ? { active } : {}) });
  checkLibrary(next);
  if (!next.lists.length && !next.active) delete journal.shopLists;
  else journal.shopLists = next;
}

/**
 * Shared rooms and the device: DM only, checked against what the DM saw, one DM-only history line
 * per change (`log`). Mutates `t` (applyCommand's private copy); a throw changes nothing.
 */
export function applyShopListCommand(
  t: Pick<CloudTable, "journal" | "shops" | "stock">,
  seat: Pick<CloudSeat, "role">,
  cmd: ShopListCommand,
  log: (summary: string) => void,
): void {
  if (seat.role !== "dm") throw Error("Only the DM can manage shop lists.");
  const journal = t.journal as { shopLists?: unknown; propertyOperations?: unknown };
  const lists = readShopLists(journal.shopLists);
  const shopIds = new Set(t.shops.map((s) => s.id));
  if (cmd.kind === "shop-list-save") {
    const index = lists.lists.findIndex((l) => l.id === cmd.listId);
    const current = index < 0 ? null : lists.lists[index];
    if ((current ? listFingerprint(current) : null) !== cmd.before) throw Error(STALE_LIST);
    const name = cmd.list.name.trim();
    if (lists.lists.some((l) => l.id !== cmd.listId && l.name.toLowerCase() === name.toLowerCase()))
      throw Error(`Another shop list is already called "${name}". Choose another name; nothing was saved.`);
    const note = cmd.list.note?.trim();
    const next: ShopList = { id: cmd.listId, name, ...(note ? { note } : {}), items: cmd.list.items };
    if (current) lists.lists[index] = next;
    else lists.lists.push(next);
    store(journal, lists, shopIds);
    log(
      current
        ? current.name !== name
          ? `Shop list renamed: ${current.name} → ${name} (${next.items.length} items)`
          : `Shop list edited: ${name} (${next.items.length} items)`
        : `Shop list created: ${name} (${next.items.length} items)`,
    );
    return;
  }
  if (cmd.kind === "shop-list-delete") {
    const current = lists.lists.find((l) => l.id === cmd.listId);
    if (!current) return; // already gone: nothing to do
    if (listFingerprint(current) !== cmd.before) throw Error(STALE_LIST);
    lists.lists = lists.lists.filter((l) => l.id !== cmd.listId);
    store(journal, lists, shopIds);
    log(`Shop list deleted: ${current.name}`);
    return;
  }
  const shop = t.shops.find((s) => s.id === cmd.shopId);
  if (!shop) throw Error("This shop no longer exists. Refresh.");
  if (stockFingerprint(t.stock, shop.id) !== cmd.before) throw Error(STALE_STOCK);
  if (cmd.kind === "shop-list-capture") {
    if (lists.lists.some((l) => l.id === cmd.id)) return;
    const items = shopLines(t.stock, shop.id).map(itemFromLine);
    if (!items.length) throw Error(`${shop.name} has no stock to save.`);
    checkItems(items);
    const name = cmd.name.trim();
    if (lists.lists.some((l) => l.name.toLowerCase() === name.toLowerCase()))
      throw Error(`Another shop list is already called "${name}". Choose another name; nothing was saved.`);
    lists.lists.push({ id: cmd.id, name, items });
    store(journal, lists, shopIds);
    log(`Shop list saved from ${shop.name}: ${name} (${items.length} items)`);
    return;
  }
  // shop-list-swap
  const plan = swapPlan(t, shop.id, cmd.listId, cmd.savedName);
  const list = plan.list;
  if (!list) throw Error("This shop list no longer exists. Refresh; nothing was changed.");
  if (listFingerprint(list) !== cmd.listBefore) throw Error(STALE_LIST);
  checkItems(plan.outgoing);
  const leaving = new Set(plan.outgoing.map((i) => i.lineId!));
  const remaining = t.stock.filter((l) => l.shopId !== shop.id);
  const used = new Set(remaining.map((l) => l.id));
  const economy = (t.journal as { tradeEconomy?: { commodities?: { id: string }[]; exchanges?: { id: string }[] } } | undefined)?.tradeEconomy;
  const incoming: StockLine[] = list.items.map((item, i) => {
    const lineId = item.lineId && !used.has(item.lineId) ? item.lineId : `${cmd.id.slice(0, 120)}-${i}`;
    used.add(lineId);
    // A trade link whose commodity or exchange no longer exists is dropped (the item stays), and
    // so is a link on a service: trade-stock-link refuses services (review of PR 472).
    const linked =
      !item.service &&
      !!item.commodityId &&
      !!item.tradeExchangeId &&
      !!economy?.commodities?.some((c) => c.id === item.commodityId) &&
      !!economy?.exchanges?.some((e) => e.id === item.tradeExchangeId);
    return {
      id: lineId,
      shopId: shop.id,
      name: item.name,
      copper: item.copper,
      baseCopper: item.baseCopper,
      quantity: item.quantity,
      notes: item.notes,
      rarity: item.rarity,
      ...(item.category !== undefined ? { category: item.category } : {}),
      ...(item.service !== undefined ? { service: item.service } : {}),
      ...(linked ? { commodityId: item.commodityId, tradeExchangeId: item.tradeExchangeId } : {}),
    };
  });
  // A property supplier buying from a line that would leave: refuse (nothing changes).
  const kept = new Set(incoming.map((l) => l.id));
  const estate = readEstate(journal.propertyOperations);
  const stranded = [
    ...estate.suppliers.map((s) => s.stockId),
    ...estate.standingOrders.filter((o) => o.active && o.order.kind === "supply").map((o) => (o.order as { stockId: string }).stockId),
  ].find((stockId) => leaving.has(stockId) && !kept.has(stockId));
  if (stranded) {
    const item = plan.outgoing.find((i) => i.lineId === stranded);
    throw Error(
      `A property supplier buys ${item?.name ?? "an item"} from ${shop.name}. Remove that supplier (Properties) before swapping its stock; nothing was changed.`,
    );
  }
  t.stock = [...remaining, ...incoming];
  if (plan.save) lists.lists.push({ id: `${cmd.id.slice(0, 140)}-saved`, name: plan.save, items: plan.outgoing });
  lists.active = { ...(lists.active ?? {}), [shop.id]: list.id };
  store(journal, lists, shopIds);
  log(
    `${shop.name}: stock swapped to ${list.name} (${incoming.length} items)` +
      (plan.save
        ? `; previous stock saved as ${plan.save} (${plan.outgoing.length} items)`
        : plan.keptIn
          ? `; previous stock is already saved as ${plan.keptIn.name}`
          : "; the shop had no stock"),
  );
}
