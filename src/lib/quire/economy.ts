import { CATALOG_REVISION, PREVIOUS_LIST, starterCatalog } from "./catalog-seed.ts";
import { quireDb, activeDatabaseName } from "./db.ts";
import { guessRarity } from "./extract.ts";
import { charismaOffPercent, emptyCoins, formatCopper, fromCopper, priceAfterCharisma, spendCoins, toCopper } from "./money.ts";
import { inventItemName } from "./names.ts";
import { clampRealm, clampScale, inventedListPrice, scalePrice } from "./scale.ts";
import { loadNotes, postNotes, refreshChat, rememberIncoming, replaceNotes } from "./chat.ts";
import { readCloudTable, type CloudTable } from "./cloud.ts";
import { loadHandouts } from "./handouts.ts";
import { APP_VERSION } from "./version.ts";
import { giftParts, giftSummary, loadGiftSeen, loadGifts, loadRoster, readRoster, type PlayerGift } from "./gift.ts";
import {
  loadListings,
  loadLoans,
  loadSales,
  loadSaleSeen,
  mergeLoanLists,
  readListings,
  readLoans,
  saveListings,
  saveLoans,
  type Listing,
  type LoanAsk,
  type LoanStatus,
} from "./market.ts";
import { charismaScore, loadSheets, mergeSheets, readSheets, saveSheet, type CharacterSheet } from "./sheet.ts";
import { readCharacterSheet } from "./sheet-file.ts";
import { presentReceipt } from "./receipt.ts";
import { lesserQuantity, decodeLinkPayload, setSeat, DM_SEAT, getSeat, type BillFile, type TableFile } from "./table.ts";
import { readSeatLock, type SeatLock } from "./lock.ts";
import type {
  Article,
  Book,
  CatalogItem,
  Coins,
  Holding,
  ItemCategory,
  ItemRarity,
  LedgerLine,
  Lexeme,
  Purse,
  RealmSettings,
  Shop,
  ShopCategory,
  StockLine,
  Wealth,
} from "./types.ts";
import type { RarityFlags, ShelfDraft } from "./compose.ts";

const ECONOMY = ["purses", "holdings", "shops", "stock", "ledger", "meta"] as const;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The ledger could not be read."));
  });
}

function finish(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("The ledger could not be saved."));
    tx.onabort = () => reject(tx.error ?? new Error("The ledger could not be saved."));
  });
}

async function all<T>(store: string): Promise<T[]> {
  const db = await quireDb();
  return request(db.transaction(store).objectStore(store).getAll());
}

export function listPurses() {
  return all<Purse>("purses");
}
export function listHoldings() {
  return all<Holding>("holdings");
}
export function listShops() {
  return all<Shop>("shops").then((rows) => rows.map((shop) => normalizeShop(shop)));
}
export function listStock() {
  return all<StockLine>("stock").then((rows) => rows.map((line) => normalizeStock(line)));
}
export function listLedger() {
  return all<LedgerLine>("ledger").then((lines) => lines.sort((a, b) => b.at - a.at));
}
export function listCatalog() {
  return all<CatalogItem>("catalog").then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
}
export function listLexicon() {
  return all<Lexeme>("lexicon").then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
}

let ensuring: Promise<void> | null = null;
let ensuringName = "";

export function ensureEconomy(): Promise<void> {
  const name = activeDatabaseName();
  if (ensuring && ensuringName === name) return ensuring;
  ensuringName = name;
  ensuring = (async () => {
    await seedEconomy();
    await seedCatalog();
  })().finally(() => {
    if (ensuringName === name) ensuring = null;
  });
  return ensuring;
}

async function seedEconomy(): Promise<void> {
  const db = await quireDb();
  const seeded = await request(db.transaction("meta").objectStore("meta").get("seeded"));
  if (seeded) return;
  const party = crypto.randomUUID();
  const ivo = crypto.randomUUID();
  const shop = crypto.randomUUID();
  const purses: Purse[] = [
    { id: party, name: "The company", kind: "party", coins: { cp: 30, sp: 18, ep: 0, gp: 45, pp: 0 } },
    { id: ivo, name: "Ivo", kind: "character", control: "player", coins: { cp: 0, sp: 6, ep: 0, gp: 8, pp: 0 } },
  ];
  const holdings: Holding[] = [
    {
      id: crypto.randomUUID(),
      purseId: party,
      name: "Rooms above the tannery",
      kind: "property",
      quantity: 1,
      unitCopper: 8000,
      notes: "Two rooms, a lock, and a smell the neighbors already know.",
    },
    {
      id: crypto.randomUUID(),
      purseId: party,
      name: "Pack mule",
      kind: "item",
      quantity: 1,
      unitCopper: 800,
      notes: "",
    },
  ];
  const shops: Shop[] = [
    {
      id: shop,
      name: "Hearth & Nail",
      keeper: "Nedda Pell",
      place: "Lower market",
      notes: "A sample shop. Change the items, the rates, or delete it.",
      sellRate: 1,
      buyRate: 0.5,
      wealth: "modest",
      category: "general",
      priceScale: 1,
    },
  ];
  const goods: Array<[string, number, number | null, ItemRarity]> = [
    ["Day-old loaf", 2, 20, "common"],
    ["Lamp oil, flask", 4, 12, "common"],
    ["Hempen rope, 50 ft", 20, 6, "common"],
    ["Iron pot", 40, 3, "common"],
    ["Wool cloak", 50, 4, "common"],
    ["Healer's kit", 500, 2, "uncommon"],
    ["Night in the common room", 8, null, "common"],
  ];
  const stock: StockLine[] = goods.map(([name, copper, quantity, rarity]) => ({
    id: crypto.randomUUID(),
    shopId: shop,
    name,
    copper,
    quantity,
    notes: "",
    baseCopper: copper,
    rarity,
  }));
  const tx = db.transaction([...ECONOMY], "readwrite");
  const done = finish(tx);
  for (const purse of purses) tx.objectStore("purses").put(purse);
  for (const holding of holdings) tx.objectStore("holdings").put(holding);
  for (const row of shops) tx.objectStore("shops").put(row);
  for (const line of stock) tx.objectStore("stock").put(line);
  tx.objectStore("meta").put({ id: "seeded" });
  await done;
}

async function seedCatalog(): Promise<void> {
  const db = await quireDb();
  const read = db.transaction("meta");
  const seededRequest = request<unknown>(read.objectStore("meta").get("catalogSeeded"));
  const revisionRequest = request<{ n?: number } | undefined>(read.objectStore("meta").get("catalogRevision"));
  const seeded = await seededRequest;
  const revisionRow = await revisionRequest;
  const revision = typeof revisionRow?.n === "number" ? revisionRow.n : 0;
  if (seeded && revision >= CATALOG_REVISION) return;

  const existing = seeded ? await request<CatalogItem[]>(db.transaction("catalog").objectStore("catalog").getAll()) : [];
  const have = new Map(existing.map((item) => [item.id, item]));
  const tx = db.transaction(["catalog", "meta"], "readwrite");
  const done = finish(tx);
  for (const item of starterCatalog()) {
    const stored = have.get(item.id);
    if (!stored) {
      tx.objectStore("catalog").put(item);
      continue;
    }
    const previous = PREVIOUS_LIST[item.id];
    if ((stored.origin === "stock" || !stored.origin) && previous !== undefined && stored.baseCopper === previous) {
      tx.objectStore("catalog").put({ ...stored, baseCopper: item.baseCopper });
    }
  }
  tx.objectStore("meta").put({ id: "catalogSeeded" });
  tx.objectStore("meta").put({ id: "catalogRevision", n: CATALOG_REVISION });
  await done;
}

const ALL_STORES = ["books", "articles", "purses", "holdings", "shops", "stock", "ledger", "catalog", "lexicon", "meta"] as const;

export async function resetToDefault(): Promise<void> {
  const db = await quireDb();
  const tx = db.transaction([...ALL_STORES], "readwrite");
  const done = finish(tx);
  for (const store of ALL_STORES) tx.objectStore(store).clear();
  await done;
  await seedEconomy();
  await seedCatalog();
}

export async function restoreStarterGoods(): Promise<number> {
  const db = await quireDb();
  const existing = await request<CatalogItem[]>(db.transaction("catalog").objectStore("catalog").getAll());
  const have = new Set(existing.map((item) => item.id));
  const missing = starterCatalog().filter((item) => !have.has(item.id));
  if (missing.length === 0) return 0;
  const tx = db.transaction("catalog", "readwrite");
  const done = finish(tx);
  for (const item of missing) tx.objectStore("catalog").put(item);
  await done;
  return missing.length;
}

export async function loadRealm(): Promise<RealmSettings> {
  const db = await quireDb();
  const row = await request<Partial<RealmSettings> | undefined>(db.transaction("meta").objectStore("meta").get("settings"));
  return clampRealm(row);
}

export async function saveRealm(settings: RealmSettings): Promise<void> {
  const db = await quireDb();
  const next = clampRealm(settings);
  await request(db.transaction("meta", "readwrite").objectStore("meta").put({ id: "settings", ...next }));
}

export async function saveCatalog(item: CatalogItem): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("catalog", "readwrite").objectStore("catalog").put(item));
}

export async function removeCatalog(id: string): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("catalog", "readwrite").objectStore("catalog").delete(id));
}

export async function addCatalogRows(rows: CatalogItem[]): Promise<number> {
  const db = await quireDb();
  const existing = await request<CatalogItem[]>(db.transaction("catalog").objectStore("catalog").getAll());
  const names = new Set(existing.map((item) => item.name.toLowerCase()));
  const fresh = rows.filter((row) => row.name.trim() && !names.has(row.name.trim().toLowerCase()));
  if (fresh.length === 0) return 0;
  const tx = db.transaction("catalog", "readwrite");
  const done = finish(tx);
  for (const row of fresh) tx.objectStore("catalog").put({ ...row, name: row.name.trim() });
  await done;
  return fresh.length;
}

export async function addLexemeRows(rows: Array<Omit<Lexeme, "id">>): Promise<number> {
  const db = await quireDb();
  const existing = await request<Lexeme[]>(db.transaction("lexicon").objectStore("lexicon").getAll());
  const keys = new Set(existing.map((row) => `${row.kind}|${row.name.toLowerCase()}`));
  const fresh = rows.filter((row) => row.name.trim() && !keys.has(`${row.kind}|${row.name.trim().toLowerCase()}`));
  if (fresh.length === 0) return 0;
  const tx = db.transaction("lexicon", "readwrite");
  const done = finish(tx);
  for (const row of fresh) {
    const lexeme: Lexeme = { ...row, id: crypto.randomUUID(), name: row.name.trim() };
    tx.objectStore("lexicon").put(lexeme);
  }
  await done;
  return fresh.length;
}

export async function removeLexeme(id: string): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("lexicon", "readwrite").objectStore("lexicon").delete(id));
}

export async function inventGoods(input: {
  category: ItemCategory;
  flags: RarityFlags;
  count: number;
  rng: () => number;
}): Promise<number> {
  const existing = await listCatalog();
  const taken = new Set(existing.map((item) => item.name.toLowerCase()));
  const rarities = (["common", "uncommon", "rare", "magic"] as const).filter((rarity) => input.flags[rarity]);
  if (rarities.length === 0) return 0;
  const count = Math.min(24, Math.max(1, Math.floor(input.count)));
  const rows: CatalogItem[] = [];
  for (let index = 0; index < count; index += 1) {
    const rarity = rarities[Math.floor(input.rng() * rarities.length)] ?? "common";
    const name = inventItemName(input.category, rarity, taken, input.rng);
    taken.add(name.toLowerCase());
    rows.push({
      id: crypto.randomUUID(),
      name,
      category: input.category,
      rarity,
      baseCopper: inventedListPrice(input.category, rarity, input.rng),
      notes: "Invented on this device.",
      origin: "hand",
      service: false,
    });
  }
  return addCatalogRows(rows);
}

export async function openComposedShop(input: {
  name: string;
  keeper: string;
  place: string;
  notes: string;
  sellRate: number;
  buyRate: number;
  wealth: Wealth;
  category: ShopCategory;
  priceScale: number;
  lines: ShelfDraft[];
}): Promise<string> {
  const shop = normalizeShop({
    id: crypto.randomUUID(),
    name: input.name.trim() || "New shop",
    keeper: input.keeper.trim(),
    place: input.place.trim(),
    notes: input.notes.trim(),
    sellRate: input.sellRate,
    buyRate: input.buyRate,
    wealth: input.wealth,
    category: input.category,
    priceScale: input.priceScale,
  });
  const db = await quireDb();
  const tx = db.transaction(["shops", "stock"], "readwrite");
  const done = finish(tx);
  tx.objectStore("shops").put(shop);
  for (const line of input.lines) {
    const stock: StockLine = {
      id: crypto.randomUUID(),
      shopId: shop.id,
      name: line.name,
      copper: line.copper,
      quantity: line.quantity,
      notes: line.notes,
      baseCopper: line.baseCopper,
      rarity: line.rarity,
    };
    tx.objectStore("stock").put(stock);
  }
  await done;
  return shop.id;
}

export async function repriceShop(shop: Shop): Promise<void> {
  const normalized = normalizeShop(shop);
  const db = await quireDb();
  const realm = await loadRealm();
  const catalog = await listCatalog();
  const lines = await request<StockLine[]>(db.transaction("stock").objectStore("stock").index("shopId").getAll(normalized.id));
  const tx = db.transaction(["shops", "stock"], "readwrite");
  const done = finish(tx);
  tx.objectStore("shops").put(normalized);
  for (const line of lines) {
    const current = normalizeStock(line);
    const match = catalog.find((item) => item.name.toLowerCase() === current.name.toLowerCase());
    const storedBase = typeof line.baseCopper === "number" && line.baseCopper > 0;
    let base = storedBase ? line.baseCopper : (match?.baseCopper ?? current.copper);
    if (match && PREVIOUS_LIST[match.id] === base) base = match.baseCopper;
    const rarity = (line.rarity || match?.rarity || "common") as ItemRarity;
    const category = match?.category ?? "general";
    const copper = scalePrice(base, {
      wealth: normalized.wealth,
      rarity,
      priceScale: normalized.priceScale,
      category,
      realm,
    });
    tx.objectStore("stock").put({ ...current, baseCopper: base, rarity, copper });
  }
  await done;
}

export async function repriceAllShops(): Promise<number> {
  const shops = await listShops();
  for (const shop of shops) await repriceShop(shop);
  return shops.length;
}

export async function savePurse(purse: Purse): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("purses", "readwrite").objectStore("purses").put(purse));
}

export async function saveShop(shop: Shop): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("shops", "readwrite").objectStore("shops").put(normalizeShop(shop)));
}

export async function saveStock(line: StockLine): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("stock", "readwrite").objectStore("stock").put(line));
}

export async function saveHolding(holding: Holding): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("holdings", "readwrite").objectStore("holdings").put(holding));
}

function normalizeShop(shop: Shop): Shop {
  const wealths: Wealth[] = ["poor", "modest", "rich", "princely"];
  const categories: ShopCategory[] = [
    "mixed",
    "provisions",
    "smith",
    "cloth",
    "apothecary",
    "inn",
    "general",
    "curios",
    "stable",
    "scribe",
    "jewels",
  ];
  const wealth = wealths.includes(shop.wealth) ? shop.wealth : "modest";
  const category = categories.includes(shop.category) ? shop.category : "general";
  return {
    ...shop,
    wealth,
    category,
    priceScale: clampScale(shop.priceScale ?? 1),
    sellRate: clampRate(shop.sellRate),
    buyRate: clampRate(shop.buyRate),
  };
}

function normalizeStock(line: StockLine): StockLine {
  const rarities: ItemRarity[] = ["common", "uncommon", "rare", "magic"];
  const rarity = rarities.includes(line.rarity) ? line.rarity : "common";
  const base = typeof line.baseCopper === "number" && line.baseCopper > 0 ? line.baseCopper : line.copper;
  return { ...line, rarity, baseCopper: base };
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(5, Math.max(0, rate));
}

export async function removeShop(id: string): Promise<void> {
  const db = await quireDb();
  const lines = await request(db.transaction("stock").objectStore("stock").index("shopId").getAll(id));
  const tx = db.transaction(["shops", "stock"], "readwrite");
  const done = finish(tx);
  tx.objectStore("shops").delete(id);
  for (const line of lines) tx.objectStore("stock").delete(line.id);
  await done;
}

export async function removeStock(id: string): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("stock", "readwrite").objectStore("stock").delete(id));
}

export async function removeHolding(id: string): Promise<void> {
  const db = await quireDb();
  await request(db.transaction("holdings", "readwrite").objectStore("holdings").delete(id));
}

export async function removePurse(id: string): Promise<void> {
  const db = await quireDb();
  const holdings = await request(db.transaction("holdings").objectStore("holdings").index("purseId").getAll(id));
  const tx = db.transaction(["purses", "holdings"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").delete(id);
  for (const holding of holdings) tx.objectStore("holdings").delete(holding.id);
  await done;
}

export async function addPricedStock(
  shopId: string,
  rows: Array<{ name: string; copper: number; notes: string; rarity?: ItemRarity }>,
): Promise<number> {
  const db = await quireDb();
  const existing = await request(db.transaction("stock").objectStore("stock").index("shopId").getAll(shopId));
  const names = new Set(existing.map((line) => line.name.toLowerCase()));
  const fresh = rows.filter((row) => row.name.trim() && !names.has(row.name.trim().toLowerCase()));
  if (fresh.length === 0) return 0;
  const tx = db.transaction("stock", "readwrite");
  const done = finish(tx);
  const store = tx.objectStore("stock");
  for (const row of fresh) {
    const line: StockLine = {
      id: crypto.randomUUID(),
      shopId,
      name: row.name.trim(),
      copper: row.copper,
      quantity: null,
      notes: row.notes,
      baseCopper: row.copper,
      rarity: row.rarity ?? guessRarity(row.copper),
    };
    store.put(line);
  }
  await done;
  return fresh.length;
}

function logLine(purseId: string, shopId: string | null, summary: string, copper: number): LedgerLine {
  return { id: crypto.randomUUID(), at: Date.now(), purseId, shopId, summary, copper };
}

async function charismaOf(purseId: string): Promise<number | null> {
  const sheets = await loadSheets();
  return charismaScore(sheets.find((sheet) => sheet.purseId === purseId));
}

async function purchaseSummary(purseId: string, summary: string): Promise<string> {
  const score = await charismaOf(purseId);
  const percent = score === null ? 0 : charismaOffPercent(score);
  if (!percent) return summary;
  return `${summary}, Charisma ${score}, ${percent}% off`;
}

export async function buyFromShop(input: { stockId: string; purseId: string; quantity: number }): Promise<void> {
  const quantity = Math.floor(input.quantity);
  if (quantity < 1) throw new Error("Choose at least one.");
  const db = await quireDb();
  const stock = await request<StockLine | undefined>(db.transaction("stock").objectStore("stock").get(input.stockId));
  if (!stock) throw new Error("That item is no longer in the shop.");
  const shop = await request<Shop | undefined>(db.transaction("shops").objectStore("shops").get(stock.shopId));
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(input.purseId));
  if (!shop || !purse) throw new Error("Choose a purse and a shop.");
  if (stock.quantity !== null && stock.quantity < quantity) throw new Error("The shop does not have that many.");
  const unit = priceAfterCharisma(Math.round(stock.copper * shop.sellRate), await charismaOf(purse.id));
  const cost = unit * quantity;
  const coins = spendCoins(purse.coins, cost);
  if (!coins) throw new Error("Not enough coin in that purse.");
  const holdings = await request<Holding[]>(db.transaction("holdings").objectStore("holdings").index("purseId").getAll(purse.id));
  const existing = holdings.find((holding) => holding.name.toLowerCase() === stock.name.toLowerCase() && holding.kind === "item");
  const tx = db.transaction(["purses", "holdings", "stock", "ledger"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({ ...purse, coins });
  if (existing) {
    tx.objectStore("holdings").put({ ...existing, quantity: existing.quantity + quantity, unitCopper: stock.copper });
  } else {
    const holding: Holding = {
      id: crypto.randomUUID(),
      purseId: purse.id,
      name: stock.name,
      kind: "item",
      quantity,
      unitCopper: stock.copper,
      notes: "",
    };
    tx.objectStore("holdings").put(holding);
  }
  if (stock.quantity !== null) tx.objectStore("stock").put({ ...stock, quantity: stock.quantity - quantity });
  tx.objectStore("ledger").put(logLine(purse.id, shop.id, await purchaseSummary(purse.id, `Bought ${quantity} ${stock.name} from ${shop.name}`), -cost));
  await done;
}

export async function sellToShop(input: { holdingId: string; shopId: string; quantity: number }): Promise<void> {
  const quantity = Math.floor(input.quantity);
  if (quantity < 1) throw new Error("Choose at least one.");
  const db = await quireDb();
  const holding = await request<Holding | undefined>(db.transaction("holdings").objectStore("holdings").get(input.holdingId));
  const shop = await request<Shop | undefined>(db.transaction("shops").objectStore("shops").get(input.shopId));
  if (!holding || !shop) throw new Error("That sale cannot be made.");
  if (holding.quantity < quantity) throw new Error("You do not have that many.");
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(holding.purseId));
  if (!purse) throw new Error("That purse is gone.");
  const unit = Math.max(0, Math.round(holding.unitCopper * shop.buyRate));
  const paid = unit * quantity;
  const tx = db.transaction(["purses", "holdings", "ledger"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({ ...purse, coins: gain(purse.coins, paid) });
  if (holding.quantity === quantity) tx.objectStore("holdings").delete(holding.id);
  else tx.objectStore("holdings").put({ ...holding, quantity: holding.quantity - quantity });
  tx.objectStore("ledger").put(logLine(purse.id, shop.id, `Sold ${quantity} ${holding.name} to ${shop.name}`, paid));
  await done;
}

function gain(coins: Coins, copper: number): Coins {
  const paid = fromCopper(Math.max(0, copper));
  return tidy({
    cp: coins.cp + paid.cp,
    sp: coins.sp + paid.sp,
    ep: coins.ep + paid.ep,
    gp: coins.gp + paid.gp,
    pp: coins.pp + paid.pp,
  });
}

function tidy(coins: Coins): Coins {
  return {
    cp: Math.max(0, Math.floor(coins.cp)),
    sp: Math.max(0, Math.floor(coins.sp)),
    ep: Math.max(0, Math.floor(coins.ep)),
    gp: Math.max(0, Math.floor(coins.gp)),
    pp: Math.max(0, Math.floor(coins.pp)),
  };
}

export async function giveToPlayer(input: { fromId: string; toId: string; copper: number; holdingId: string | null; quantity: number }): Promise<void> {
  const copper = Math.max(0, Math.round(input.copper));
  if (input.fromId === input.toId) throw new Error("Choose another player.");
  const db = await quireDb();
  const purses = await request<Purse[]>(db.transaction("purses").objectStore("purses").getAll());
  const from = purses.find((purse) => purse.id === input.fromId);
  if (!from) throw new Error("That purse is gone.");
  const sitting = getSeat();
  const roster = sitting.role === "player" ? await loadRoster() : [];
  const to = purses.find((purse) => purse.id === input.toId);
  const known = sitting.role === "player" ? roster.some((person) => person.id === input.toId) : Boolean(to);
  if (!known) throw new Error("That player is not on this link.");
  const toName = to?.name ?? roster.find((person) => person.id === input.toId)?.name ?? "Another player";
  const holdingRow = input.holdingId
    ? await request<Holding | undefined>(db.transaction("holdings").objectStore("holdings").get(input.holdingId))
    : undefined;
  let moved: PlayerGift["holding"] = null;
  if (input.holdingId) {
    const quantity = Math.floor(input.quantity);
    if (!holdingRow || holdingRow.purseId !== from.id) throw new Error("That holding is not yours.");
    if (quantity < 1 || holdingRow.quantity < quantity) throw new Error("You do not have that many.");
    moved = { name: holdingRow.name, kind: holdingRow.kind, quantity, unitCopper: holdingRow.unitCopper };
  }
  if (copper === 0 && !moved) throw new Error("Give coins, an item, or a holding.");
  const nextCoins = copper > 0 ? spendCoins(from.coins, copper) : from.coins;
  if (!nextCoins) throw new Error("That purse cannot cover it.");
  const gift: PlayerGift = {
    id: crypto.randomUUID(),
    at: Date.now(),
    fromId: from.id,
    toId: input.toId,
    fromName: from.name,
    toName,
    copper,
    holding: moved,
  };
  const pending = sitting.role === "player" ? [...(await loadGifts()), gift] : null;
  const tx = db.transaction(["purses", "holdings", "ledger", "meta"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({ ...from, coins: nextCoins });
  if (holdingRow && moved) {
    if (holdingRow.quantity === moved.quantity) tx.objectStore("holdings").delete(holdingRow.id);
    else tx.objectStore("holdings").put({ ...holdingRow, quantity: holdingRow.quantity - moved.quantity });
  }
  if (sitting.role !== "player" && to) {
    tx.objectStore("purses").put({ ...to, coins: copper > 0 ? gain(to.coins, copper) : to.coins });
    if (moved) {
      tx.objectStore("holdings").put({
        id: crypto.randomUUID(),
        purseId: to.id,
        name: moved.name,
        kind: moved.kind,
        quantity: moved.quantity,
        unitCopper: moved.unitCopper,
        notes: "",
      });
    }
  }
  if (pending) tx.objectStore("meta").put({ id: "gifts", gifts: pending });
  tx.objectStore("ledger").put(logLine(from.id, null, `Gave ${toName} ${giftParts(gift)}`, copper > 0 ? -copper : 0));
  await done;
  await postNotes([{ from: "player", to: "party", purseId: from.id, text: giftSummary(gift) }]);
}

async function settleGifts(gifts: PlayerGift[] | undefined): Promise<void> {
  const incoming = (gifts ?? []).filter((gift) => gift.copper > 0 || gift.holding);
  if (incoming.length === 0) return;
  const seen = new Set(await loadGiftSeen());
  const fresh = incoming.filter((gift) => !seen.has(gift.id));
  if (fresh.length === 0) return;
  const db = await quireDb();
  const purses = await request<Purse[]>(db.transaction("purses").objectStore("purses").getAll());
  const tx = db.transaction(["purses", "holdings", "meta"], "readwrite");
  const done = finish(tx);
  const byId = new Map(purses.map((purse) => [purse.id, { ...purse }]));
  for (const gift of fresh) {
    const purse = byId.get(gift.toId);
    if (!purse) continue;
    const next = { ...purse, coins: gift.copper > 0 ? gain(purse.coins, gift.copper) : purse.coins };
    byId.set(purse.id, next);
    tx.objectStore("purses").put(next);
    if (gift.holding) {
      tx.objectStore("holdings").put({
        id: crypto.randomUUID(),
        purseId: purse.id,
        name: gift.holding.name,
        kind: gift.holding.kind,
        quantity: gift.holding.quantity,
        unitCopper: gift.holding.unitCopper,
        notes: "",
      });
    }
    seen.add(gift.id);
  }
  tx.objectStore("meta").put({ id: "giftSeen", ids: [...seen] });
  await done;
}

export async function addListing(input: { name: string; kind: Listing["kind"]; copper: number; quantity: number | null; notes: string }): Promise<void> {
  const name = input.name.trim();
  const copper = Math.round(input.copper);
  if (!name) throw new Error("Name the listing.");
  if (!Number.isFinite(copper) || copper < 0) throw new Error("Enter a price.");
  if (getSeat().role === "player") throw new Error("The dungeon master keeps the market.");
  const listings = await loadListings();
  listings.push({
    id: crypto.randomUUID(),
    name,
    kind: input.kind,
    copper,
    quantity: input.quantity === null ? null : Math.max(0, Math.floor(input.quantity)),
    notes: input.notes.trim(),
  });
  await saveListings(listings);
}

export async function removeListing(id: string): Promise<void> {
  if (getSeat().role === "player") throw new Error("The dungeon master keeps the market.");
  await saveListings((await loadListings()).filter((listing) => listing.id !== id));
}

export async function buyListing(input: { listingId: string; purseId: string; quantity: number }): Promise<void> {
  const quantity = Math.floor(input.quantity);
  if (quantity < 1) throw new Error("Choose at least one.");
  const listings = await loadListings();
  const listing = listings.find((item) => item.id === input.listingId);
  if (!listing) throw new Error("That listing is gone.");
  if (listing.quantity !== null && listing.quantity < quantity) throw new Error("There are not that many.");
  const db = await quireDb();
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(input.purseId));
  if (!purse) throw new Error("That purse is gone.");
  const score = await charismaOf(purse.id);
  const unit = priceAfterCharisma(listing.copper, score);
  const cost = unit * quantity;
  const coins = cost > 0 ? spendCoins(purse.coins, cost) : purse.coins;
  if (!coins) throw new Error("Not enough coin in that purse.");
  const nextListings = listings.map((item) =>
    item.id !== listing.id || item.quantity === null ? item : { ...item, quantity: item.quantity - quantity },
  );
  const sale = { id: crypto.randomUUID(), at: Date.now(), listingId: listing.id, quantity, purseId: purse.id };
  const sales = getSeat().role === "player" ? [...(await loadSales()), sale] : null;
  const tx = db.transaction(["purses", "holdings", "ledger", "meta"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({ ...purse, coins });
  tx.objectStore("holdings").put({
    id: crypto.randomUUID(),
    purseId: purse.id,
    name: listing.name,
    kind: listing.kind,
    quantity,
    unitCopper: listing.copper,
    notes: listing.notes,
  });
  tx.objectStore("meta").put({ id: "listings", listings: nextListings });
  if (sales) tx.objectStore("meta").put({ id: "sales", sales });
  tx.objectStore("ledger").put(logLine(purse.id, null, await purchaseSummary(purse.id, `Bought ${quantity} ${listing.name} from the market`), cost > 0 ? -cost : 0));
  await done;
}

export async function askLoan(input: { purseId: string; copper: number; note: string }): Promise<void> {
  const copper = Math.round(input.copper);
  const note = input.note.trim();
  if (!Number.isFinite(copper) || copper <= 0) throw new Error("Enter how much to borrow.");
  if (!note) throw new Error("Write what the loan is for.");
  const db = await quireDb();
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(input.purseId));
  if (!purse) throw new Error("That purse is gone.");
  const loans = await loadLoans();
  loans.push({ id: crypto.randomUUID(), at: Date.now(), purseId: purse.id, purseName: purse.name, copper, note, status: "pending" });
  await saveLoans(loans);
  await postNotes([{ from: "player", to: "dm", purseId: purse.id, text: `${purse.name} asked for a loan of ${formatCopper(copper)}. ${note}` }]);
}

export async function decideLoan(id: string, status: LoanStatus): Promise<void> {
  if (status === "pending") return;
  if (getSeat().role === "player") throw new Error("The dungeon master answers loans.");
  const loans = await loadLoans();
  const loan = loans.find((item) => item.id === id);
  if (!loan || loan.status !== "pending") return;
  if (status === "approved") {
    const db = await quireDb();
    const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(loan.purseId));
    if (!purse) throw new Error("That purse is gone.");
    const tx = db.transaction(["purses", "ledger"], "readwrite");
    const done = finish(tx);
    tx.objectStore("purses").put({ ...purse, coins: gain(purse.coins, loan.copper) });
    tx.objectStore("ledger").put(logLine(purse.id, null, `Approved a loan of ${formatCopper(loan.copper)}`, loan.copper));
    await done;
  }
  await saveLoans(loans.map((item) => (item.id === id ? { ...item, status } : item)));
  await postNotes([
    {
      from: "dm",
      to: "dm",
      purseId: loan.purseId,
      text: status === "approved" ? `Loan of ${formatCopper(loan.copper)} approved.` : `Loan of ${formatCopper(loan.copper)} denied.`,
    },
  ]);
}

async function settleSales(sales: BillFile["sales"]): Promise<void> {
  const incoming = sales ?? [];
  if (incoming.length === 0) return;
  const seen = new Set(await loadSaleSeen());
  const fresh = incoming.filter((sale) => !seen.has(sale.id));
  if (fresh.length === 0) return;
  const listings = await loadListings();
  const txSeen = [...seen];
  for (const sale of fresh) {
    const listing = listings.find((item) => item.id === sale.listingId);
    if (listing && listing.quantity !== null) listing.quantity = Math.max(0, listing.quantity - sale.quantity);
    txSeen.push(sale.id);
  }
  await saveListings(listings);
  const db = await quireDb();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ id: "saleSeen", ids: txSeen });
  await finish(tx);
}

export async function importCharacterSheet(purseId: string, file: File): Promise<string[]> {
  const body = await readCharacterSheet(file);
  const sheet: CharacterSheet = { ...body, purseId, importedAt: Date.now() };
  await saveSheet(sheet);
  const db = await quireDb();
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(purseId));
  if (!purse || purse.kind !== "character") return sheetGaps(sheet);
  if ((purse.name === "New character" || !purse.name.trim()) && sheet.name) await savePurse({ ...purse, name: sheet.name });
  const fresh = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(purseId));
  if (!fresh || toCopper(fresh.coins) > 0 || toCopper(sheet.coins) === 0) return sheetGaps(sheet);
  await setCoins(fresh.id, sheet.coins, "Brought from the character sheet");
  return sheetGaps(sheet);
}

export function sheetGaps(sheet: CharacterSheet): string[] {
  const gaps: string[] = [];
  if (!sheet.name.trim()) gaps.push("Name");
  if (!sheet.classLevel.trim()) gaps.push("Class");
  if (!sheet.race.trim()) gaps.push("Race");
  if (!sheet.armorClass.trim()) gaps.push("Armor class");
  if (!sheet.hitPoints.trim()) gaps.push("Hit points");
  const abilities: Array<[keyof CharacterSheet["abilities"], string]> = [
    ["str", "Strength"],
    ["dex", "Dexterity"],
    ["con", "Constitution"],
    ["int", "Intelligence"],
    ["wis", "Wisdom"],
    ["cha", "Charisma"],
  ];
  for (const [key, label] of abilities) {
    if (!sheet.abilities[key].score.trim()) gaps.push(label);
  }
  return gaps;
}

export async function updateCharacterSheet(sheet: CharacterSheet): Promise<void> {
  await saveSheet(sheet);
}

export async function voidLedgerLine(id: string): Promise<void> {
  const db = await quireDb();
  const lines = await request<LedgerLine[]>(db.transaction("ledger").objectStore("ledger").getAll());
  const line = lines.find((item) => item.id === id);
  if (!line) throw new Error("That line is not on this phone.");
  if (line.summary.startsWith("Voided")) throw new Error("That line is already a void.");
  if (lines.some((item) => item.summary.includes(`(void:${line.id})`))) throw new Error("That line was already voided.");
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(line.purseId));
  if (!purse) throw new Error("That purse is gone.");
  const coins = line.copper < 0 ? gain(purse.coins, -line.copper) : spendCoins(purse.coins, line.copper);
  if (!coins) throw new Error("That purse cannot cover reversing this line.");
  const bought = /^Bought (\d+) (.+?) from /.exec(line.summary);
  const holdings = await request<Holding[]>(db.transaction("holdings").objectStore("holdings").index("purseId").getAll(purse.id));
  const stock = line.shopId
    ? await request<StockLine[]>(db.transaction("stock").objectStore("stock").index("shopId").getAll(line.shopId))
    : [];
  const tx = db.transaction(["purses", "holdings", "stock", "ledger"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({ ...purse, coins });
  if (bought) {
    const quantity = Number(bought[1]);
    const name = bought[2].toLowerCase();
    const holding = holdings.find((item) => item.name.toLowerCase() === name && item.kind === "item");
    if (holding) {
      const left = holding.quantity - quantity;
      if (left > 0) tx.objectStore("holdings").put({ ...holding, quantity: left });
      else tx.objectStore("holdings").delete(holding.id);
    }
    const shelf = stock.find((item) => item.name.toLowerCase() === name);
    if (shelf && shelf.quantity !== null) tx.objectStore("stock").put({ ...shelf, quantity: shelf.quantity + quantity });
  }
  tx.objectStore("ledger").put(logLine(purse.id, line.shopId, `Voided ${line.summary} (void:${line.id})`, -line.copper));
  await done;
}

export async function setCoins(purseId: string, coins: Coins, summary?: string): Promise<void> {
  const db = await quireDb();
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(purseId));
  if (!purse) throw new Error("That purse is gone.");
  const next = tidy(coins);
  const delta = toCopper(next) - toCopper(purse.coins);
  const tx = db.transaction(["purses", "ledger"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({ ...purse, coins: next });
  if (delta !== 0) tx.objectStore("ledger").put(logLine(purse.id, null, summary?.trim() || `Adjusted coin in ${purse.name}`, delta));
  await done;
}

export async function postCopper(purseId: string, copper: number, summary: string): Promise<void> {
  if (!summary.trim()) throw new Error("Write what the money was for.");
  if (!Number.isFinite(copper) || copper === 0) throw new Error("Enter an amount.");
  const db = await quireDb();
  const purse = await request<Purse | undefined>(db.transaction("purses").objectStore("purses").get(purseId));
  if (!purse) throw new Error("That purse is gone.");
  const nextTotal = toCopper(purse.coins) + copper;
  if (nextTotal < 0) throw new Error("That purse cannot cover it.");
  const tx = db.transaction(["purses", "ledger"], "readwrite");
  const done = finish(tx);
  tx.objectStore("purses").put({
    ...purse,
    coins: copper < 0 ? spendCoins(purse.coins, -copper)! : gain(purse.coins, copper),
  });
  tx.objectStore("ledger").put(logLine(purse.id, null, summary.trim(), copper));
  await done;
}

export type QuireFile = {
  kind: "quire";
  version: 1 | 2;
  exportedAt: number;
  books: Book[];
  articles: Article[];
  purses: Purse[];
  holdings: Holding[];
  shops: Shop[];
  stock: StockLine[];
  ledger: LedgerLine[];
  catalog?: CatalogItem[];
  lexicon?: Lexeme[];
  settings?: RealmSettings;
  seatLock?: SeatLock;
  listings?: Listing[];
  loans?: LoanAsk[];
  sheets?: CharacterSheet[];
  appVersion?: string;
};

export async function snapshot(): Promise<QuireFile> {
  const db = await quireDb();
  const tx = db.transaction(
    ["books", "articles", "purses", "holdings", "shops", "stock", "ledger", "catalog", "lexicon", "meta"],
    "readonly",
  );
  const books = request<Book[]>(tx.objectStore("books").getAll());
  const articles = request<Article[]>(tx.objectStore("articles").getAll());
  const purses = request<Purse[]>(tx.objectStore("purses").getAll());
  const holdings = request<Holding[]>(tx.objectStore("holdings").getAll());
  const shops = request<Shop[]>(tx.objectStore("shops").getAll());
  const stock = request<StockLine[]>(tx.objectStore("stock").getAll());
  const ledger = request<LedgerLine[]>(tx.objectStore("ledger").getAll());
  const catalog = request<CatalogItem[]>(tx.objectStore("catalog").getAll());
  const lexicon = request<Lexeme[]>(tx.objectStore("lexicon").getAll());
  const settingsRow = request<Partial<RealmSettings> | undefined>(tx.objectStore("meta").get("settings"));
  const lockRow = request<unknown>(tx.objectStore("meta").get("seatLock"));
  const seatLock = readSeatLock(await lockRow);
  const file: QuireFile = {
    kind: "quire",
    version: 2,
    exportedAt: Date.now(),
    books: await books,
    articles: await articles,
    purses: await purses,
    holdings: await holdings,
    shops: (await shops).map((shop) => normalizeShop(shop)),
    stock: (await stock).map((line) => normalizeStock(line)),
    ledger: await ledger,
    catalog: await catalog,
    lexicon: await lexicon,
    settings: clampRealm(await settingsRow),
    seatLock: seatLock ?? undefined,
    appVersion: APP_VERSION,
  };
  await finish(tx);
  file.listings = await loadListings();
  file.loans = await loadLoans();
  file.sheets = await loadSheets();
  return file;
}

export async function applyTable(file: TableFile): Promise<void> {
  const db = await quireDb();
  const shopIds = new Set(file.shops.map((shop) => shop.id));
  const purseIds = new Set(file.purses.map((purse) => purse.id));
  const existingStock = await request<StockLine[]>(db.transaction("stock").objectStore("stock").getAll());
  const existingHoldings = await request<Holding[]>(db.transaction("holdings").objectStore("holdings").getAll());
  const loans = mergeLoanLists(await loadLoans(), readLoans(file.loans), false);
  const sheets = mergeSheets(await loadSheets(), readSheets(file.sheets));
  const tx = db.transaction(["shops", "stock", "purses", "holdings", "meta"], "readwrite");
  const done = finish(tx);
  for (const shop of file.shops) tx.objectStore("shops").put(normalizeShop(shop));
  for (const line of existingStock) {
    if (shopIds.has(line.shopId)) tx.objectStore("stock").delete(line.id);
  }
  for (const line of file.stock) tx.objectStore("stock").put(normalizeStock(line));
  for (const purse of file.purses) tx.objectStore("purses").put(purse);
  for (const holding of existingHoldings) {
    if (purseIds.has(holding.purseId)) tx.objectStore("holdings").delete(holding.id);
  }
  for (const holding of file.holdings) tx.objectStore("holdings").put(holding);
  tx.objectStore("meta").put({ id: "settings", ...clampRealm(file.realm) });
  const lock = readSeatLock(file.seatLock);
  if (lock) tx.objectStore("meta").put({ id: "seatLock", ...lock });
  tx.objectStore("meta").put({ id: "roster", people: readRoster(file.roster) });
  if (Array.isArray(file.listings)) tx.objectStore("meta").put({ id: "listings", listings: readListings(file.listings) });
  tx.objectStore("meta").put({ id: "loans", loans });
  tx.objectStore("meta").put({ id: "sheets", sheets });
  tx.objectStore("meta").put({ id: "handouts", handouts: file.handouts ?? [] });
  await done;
  await rememberIncoming(file.notes ?? []);
}

export async function applyBill(file: BillFile): Promise<number> {
  const db = await quireDb();
  const purseIds = new Set(file.purseIds);
  const existingHoldings = await request<Holding[]>(db.transaction("holdings").objectStore("holdings").getAll());
  const existingStock = await request<StockLine[]>(db.transaction("stock").objectStore("stock").getAll());
  const existingLedger = await request<LedgerLine[]>(db.transaction("ledger").objectStore("ledger").getAll());
  const haveLedger = new Set(existingLedger.map((line) => line.id));
  const stockById = new Map(existingStock.map((line) => [line.id, line]));
  const loans = mergeLoanLists(await loadLoans(), readLoans(file.loans), true);
  const sheets = mergeSheets(await loadSheets(), readSheets(file.sheets).filter((sheet) => purseIds.has(sheet.purseId)));
  const tx = db.transaction(["purses", "holdings", "stock", "ledger", "meta"], "readwrite");
  const done = finish(tx);
  for (const purse of file.purses) {
    if (!purseIds.has(purse.id)) continue;
    tx.objectStore("purses").put(purse);
  }
  for (const holding of existingHoldings) {
    if (purseIds.has(holding.purseId)) tx.objectStore("holdings").delete(holding.id);
  }
  for (const holding of file.holdings) {
    if (purseIds.has(holding.purseId)) tx.objectStore("holdings").put(holding);
  }
  for (const line of file.stock) {
    const current = stockById.get(line.id);
    if (!current) continue;
    const quantity = lesserQuantity(current.quantity, line.quantity);
    if (quantity !== current.quantity) tx.objectStore("stock").put({ ...current, quantity });
  }
  let added = 0;
  for (const entry of file.ledger) {
    if (haveLedger.has(entry.id)) continue;
    tx.objectStore("ledger").put(entry);
    added += 1;
  }
  tx.objectStore("meta").put({ id: "loans", loans });
  tx.objectStore("meta").put({ id: "sheets", sheets });
  await done;
  await rememberIncoming(file.notes ?? []);
  await settleGifts(file.gifts);
  await settleSales(file.sales);
  return added;
}

let seatLinkClaimed = false;

export async function applySeatLink(): Promise<"player" | "dm" | "bill" | null> {
  if (typeof window === "undefined" || seatLinkClaimed) return null;
  const role = new URLSearchParams(window.location.search).get("as");
  if (role !== "dm" && role !== "player") return null;
  seatLinkClaimed = true;
  const hash = window.location.hash;
  let result: "player" | "dm" | "bill" = role;
  if (role === "player" && hash.startsWith("#t.")) {
    const table = await decodeLinkPayload(hash);
    if (!table || table.kind !== "quire-table") throw new Error("That player link could not be read.");
    await applyTable(table);
    setSeat({
      role: "player",
      purseIds: table.purses.map((purse) => purse.id),
      shopIds: table.shops.map((shop) => shop.id),
      openedAt: table.exportedAt,
    });
  } else if (role === "dm" && hash.startsWith("#b.")) {
    const bill = await decodeLinkPayload(hash);
    if (!bill || bill.kind !== "quire-bill") throw new Error("That bill link could not be read.");
    await applyBill(bill);
    presentReceipt(bill);
    setSeat(DM_SEAT);
    result = "bill";
  } else {
    setSeat(DM_SEAT);
    result = "dm";
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("as");
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  return result;
}

export function readQuireFile(value: unknown): QuireFile {
  if (typeof value !== "object" || value === null) throw new Error("That file is not a Lootsplit copy.");
  const file = value as Partial<QuireFile>;
  if (file.kind !== "quire" || (file.version !== 1 && file.version !== 2)) throw new Error("That file is not a Lootsplit copy.");
  for (const key of ["books", "articles", "purses", "holdings", "shops", "stock", "ledger"] as const) {
    if (!Array.isArray(file[key])) throw new Error("That file is missing part of the ledger.");
  }
  return file as QuireFile;
}

export async function restore(file: QuireFile): Promise<void> {
  const db = await quireDb();
  const stores = ["books", "articles", "purses", "holdings", "shops", "stock", "ledger", "catalog", "lexicon", "meta"] as const;
  const tx = db.transaction([...stores], "readwrite");
  const done = finish(tx);
  for (const store of ["purses", "holdings", "shops", "stock", "ledger"] as const) tx.objectStore(store).clear();
  for (const purse of file.purses) tx.objectStore("purses").put(purse);
  for (const holding of file.holdings) tx.objectStore("holdings").put(holding);
  for (const shop of file.shops) tx.objectStore("shops").put(normalizeShop(shop));
  for (const line of file.stock) tx.objectStore("stock").put(normalizeStock(line));
  for (const entry of file.ledger) tx.objectStore("ledger").put(entry);
  for (const book of file.books) tx.objectStore("books").put(book);
  for (const article of file.articles) tx.objectStore("articles").put(article);
  if (Array.isArray(file.catalog)) {
    tx.objectStore("catalog").clear();
    for (const item of file.catalog) tx.objectStore("catalog").put(item);
    tx.objectStore("meta").put({ id: "catalogRevision", n: CATALOG_REVISION });
  }
  if (Array.isArray(file.lexicon)) {
    tx.objectStore("lexicon").clear();
    for (const lexeme of file.lexicon) tx.objectStore("lexicon").put(lexeme);
  }
  if (file.settings) tx.objectStore("meta").put({ id: "settings", ...clampRealm(file.settings) });
  if (Array.isArray(file.listings)) tx.objectStore("meta").put({ id: "listings", listings: readListings(file.listings) });
  if (Array.isArray(file.loans)) tx.objectStore("meta").put({ id: "loans", loans: readLoans(file.loans) });
  if (Array.isArray(file.sheets)) tx.objectStore("meta").put({ id: "sheets", sheets: readSheets(file.sheets) });
  const lock = readSeatLock(file.seatLock);
  if (lock) tx.objectStore("meta").put({ id: "seatLock", ...lock });
  else tx.objectStore("meta").delete("seatLock");
  tx.objectStore("meta").put({ id: "seeded" });
  tx.objectStore("meta").put({ id: "catalogSeeded" });
  await done;
}

export function blankPurse(kind: Purse["kind"]): Purse {
  return {
    id: crypto.randomUUID(),
    name: kind === "party" ? "New purse" : "New character",
    kind,
    control: kind === "character" ? "player" : undefined,
    coins: emptyCoins(),
  };
}

export function blankShop(): Shop {
  return {
    id: crypto.randomUUID(),
    name: "New shop",
    keeper: "",
    place: "",
    notes: "",
    sellRate: 1,
    buyRate: 0.5,
    wealth: "modest",
    category: "general",
    priceScale: 1,
  };
}

export async function economySnapshot(): Promise<CloudTable> {
  const db = await quireDb();
  const tx = db.transaction(["purses", "holdings", "shops", "stock", "ledger"], "readonly");
  const purses = request<Purse[]>(tx.objectStore("purses").getAll());
  const holdings = request<Holding[]>(tx.objectStore("holdings").getAll());
  const shops = request<Shop[]>(tx.objectStore("shops").getAll());
  const stock = request<StockLine[]>(tx.objectStore("stock").getAll());
  const ledger = request<LedgerLine[]>(tx.objectStore("ledger").getAll());
  const table: CloudTable = {
    purses: await purses,
    holdings: await holdings,
    shops: (await shops).map((shop) => normalizeShop(shop)),
    stock: (await stock).map((line) => normalizeStock(line)),
    ledger: await ledger,
    listings: [],
    loans: [],
    sheets: [],
    notes: [],
  };
  await finish(tx);
  table.listings = await loadListings();
  table.loans = await loadLoans();
  table.sheets = await loadSheets();
  table.notes = await loadNotes();
  table.handouts = await loadHandouts();
  return table;
}

export async function applyCloudTable(table: CloudTable): Promise<void> {
  const next = readCloudTable(table);
  if (!next) throw new Error("That table could not be read.");
  const db = await quireDb();
  const tx = db.transaction(["purses", "holdings", "shops", "stock", "ledger", "meta"], "readwrite");
  const done = finish(tx);
  for (const store of ["purses", "holdings", "shops", "stock", "ledger"] as const) tx.objectStore(store).clear();
  for (const purse of next.purses) tx.objectStore("purses").put(purse);
  for (const holding of next.holdings) tx.objectStore("holdings").put(holding);
  for (const shop of next.shops) tx.objectStore("shops").put(normalizeShop(shop));
  for (const line of next.stock) tx.objectStore("stock").put(normalizeStock(line));
  for (const entry of next.ledger) tx.objectStore("ledger").put(entry);
  tx.objectStore("meta").put({ id: "listings", listings: next.listings });
  tx.objectStore("meta").put({ id: "loans", loans: next.loans });
  tx.objectStore("meta").put({ id: "sheets", sheets: next.sheets });
  tx.objectStore("meta").put({ id: "handouts", handouts: next.handouts ?? [] });
  await done;
  await replaceNotes(next.notes);
  await refreshChat();
}
