import { isEphemeralCampaign } from "./guest-storage.ts";
import { assertMerchantSale, isService, stockCategory } from "./merchant.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { loanFromRequest, readFinance, assertFinanceAccountRemovable } from "./finance.ts";
import { readLocalEncounters } from "../encounters/local.ts";
import { readJournal, readValidatedJournal, type Journal } from "./journal.ts";
import { blankSheet } from "../characters/model.mjs";
import {
  statsOnly,
  editCharacter,
  editLegacyCharacter,
  characterSheet,
  legacyCharacter,
} from "../characters/campaign-sheet.mjs";
import { getCloudWatch } from "./cloud-turn.ts";
import { verifyReportBase, type ReportBase } from "./local-report.ts";
import { coinsSchema, validateEconomyRows, validateBackupRows, validateBackupReferences } from "./validation.ts";
import { CATALOG_REVISION, PREVIOUS_LIST, starterCatalog } from "./catalog-seed.ts";
import { quireDb, activeDatabaseName } from "./db.ts";
import { guessRarity } from "./extract.ts";
import {
  charismaOffPercent,
  emptyCoins,
  formatCopper,
  fromCopper,
  priceAfterCharisma,
  spendCoins,
  toCopper,
} from "./money.ts";
import { inventItemName } from "./names.ts";
import { clampRealm, clampScale, inventedListPrice, scalePrice } from "./scale.ts";
import {
  readNotes,
  type ChatNote,
  postNotes,
  refreshChat,
  rememberIncoming,
  replaceNotes,
} from "./chat.ts";
import { readCloudTable, applyBillToTable, type CloudTable } from "./cloud.ts";
import { readHandouts, type Handout } from "./handouts.ts";
import { APP_VERSION } from "./version.ts";
import {
  giftParts,
  itemForGift,
  giftSummary,
  loadRoster,
  readRoster,
  readGifts,
  type PlayerGift,
} from "./gift.ts";
import {
  loadListings,
  loadLoans,
  readSales,
  mergeLoanLists,
  readListings,
  readLoans,
  saveListings,
  type Listing,
  type LoanAsk,
  type LoanStatus,
} from "./market.ts";
import {
  charismaScore,
  loadSheets,
  mergeSheets,
  readSheets,
  type CharacterSheet,
} from "./sheet.ts";
import { readCharacterSheet } from "./sheet-file.ts";
import { presentReceipt } from "./receipt.ts";
import {
  decodeLinkPayload,
  setSeat,
  DM_SEAT,
  getSeat,
  type BillFile,
  type TableFile,
} from "./table.ts";
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
  return all<CatalogItem>("catalog").then((rows) =>
    rows.sort((a, b) => a.name.localeCompare(b.name)),
  );
}
export function listLexicon() {
  return all<Lexeme>("lexicon").then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name)));
}

let ensuring: Promise<void> | null = null;
let ensuringName = "";

export function ensureEconomy(): Promise<void> {
  const name = isEphemeralCampaign() ? "guest-memory" : activeDatabaseName();
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
  // Serialize the initialization decision with cloud restoration. Checking in a
  // separate read transaction let sample rows arrive after an authoritative save.
  const tx = db.transaction([...ECONOMY], "readwrite");
  const done = finish(tx);
  const seeded = await request(tx.objectStore("meta").get("seeded"));
  if (seeded) { await done; return; }
  let blank = isEphemeralCampaign();
  if (typeof window !== "undefined") {
    try {
      const registry = JSON.parse(localStorage.getItem("quire.campaigns.v1") || "[]") as { id: string; blank?: boolean }[];
      blank ||= !!registry.find(c => c.id === localStorage.getItem("quire.campaign.v1"))?.blank;
    } catch { /* Original DM campaigns retain their existing initialization. */ }
  }
  if (blank) {
    tx.objectStore("meta").put({ id: "seeded" });
    await done;
    return;
  }
  const party = crypto.randomUUID();
  const shop = crypto.randomUUID();
  const purses: Purse[] = [
    {
      id: party,
      name: "Party fund",
      kind: "party",
      coins: { cp: 30, sp: 18, ep: 0, gp: 45, pp: 0 },
    },
    ...["Drugis Falkson", "Sigurdr Falkson", "Hemi", "Hrogvir", "Kaito"].map((name): Purse => ({
      id: crypto.randomUUID(),
      name,
      kind: "character",
      control: "player",
      coins: emptyCoins(),
    })),
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
  const revisionRequest = request<{ n?: number } | undefined>(
    read.objectStore("meta").get("catalogRevision"),
  );
  const seeded = await seededRequest;
  const revisionRow = await revisionRequest;
  const revision = typeof revisionRow?.n === "number" ? revisionRow.n : 0;
  if (seeded && revision >= CATALOG_REVISION) return;

  const existing = seeded
    ? await request<CatalogItem[]>(db.transaction("catalog").objectStore("catalog").getAll())
    : [];
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
    if (
      (stored.origin === "stock" || !stored.origin) &&
      previous !== undefined &&
      stored.baseCopper === previous
    ) {
      tx.objectStore("catalog").put({ ...stored, baseCopper: item.baseCopper });
    }
  }
  tx.objectStore("meta").put({ id: "catalogSeeded" });
  tx.objectStore("meta").put({ id: "catalogRevision", n: CATALOG_REVISION });
  await done;
}

const ALL_STORES = [
  "books",
  "articles",
  "purses",
  "holdings",
  "shops",
  "stock",
  "ledger",
  "catalog",
  "lexicon",
  "meta",
] as const;

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
  const existing = await request<CatalogItem[]>(
    db.transaction("catalog").objectStore("catalog").getAll(),
  );
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
  const row = await request<Partial<RealmSettings> | undefined>(
    db.transaction("meta").objectStore("meta").get("settings"),
  );
  return clampRealm(row);
}

export async function saveRealm(settings: RealmSettings): Promise<void> {
  const db = await quireDb();
  const next = clampRealm(settings);
  await atomic(["meta"], async (tx) => {
    const before = await request<RealmSettings | undefined>(tx.objectStore("meta").get("settings"));
    tx.objectStore("meta").put({ id: "settings", ...next });
    if (JSON.stringify(clampRealm(before)) !== JSON.stringify(next))
      await audit(
        tx,
        `Economy rules: ${JSON.stringify(clampRealm(before))} → ${JSON.stringify(next)}`.slice(
          0,
          500,
        ),
        "prices",
        undefined,
        { entity: "realm", before: { ...clampRealm(before) }, after: { ...next } },
      );
  });
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
  const existing = await request<CatalogItem[]>(
    db.transaction("catalog").objectStore("catalog").getAll(),
  );
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
  const existing = await request<Lexeme[]>(
    db.transaction("lexicon").objectStore("lexicon").getAll(),
  );
  const keys = new Set(existing.map((row) => `${row.kind}|${row.name.toLowerCase()}`));
  const fresh = rows.filter(
    (row) => row.name.trim() && !keys.has(`${row.kind}|${row.name.trim().toLowerCase()}`),
  );
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
  const rarities = (["common", "uncommon", "rare", "magic"] as const).filter(
    (rarity) => input.flags[rarity],
  );
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
      notes: "Generated on this device.",
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
      service: line.service,
      category: line.category,
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
  const lines = await request<StockLine[]>(
    db.transaction("stock").objectStore("stock").index("shopId").getAll(normalized.id),
  );
  const tx = db.transaction(["shops", "stock", "meta"], "readwrite");
  const done = finish(tx);
  const history: { summary: string; change: NonNullable<Journal["events"][number]["change"]> }[] =
    [];
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
    if (current.copper !== copper)
      history.push({
        summary: `${current.name}: ${current.copper} cp → ${copper} cp`,
        change: {
          entity: "stock",
          entityId: current.id,
          before: { copper: current.copper },
          after: { copper },
        },
      });
    tx.objectStore("stock").put({ ...current, baseCopper: base, rarity, copper });
  }
  for (const change of history)
    await audit(
      tx,
      `${normalized.name}: ${change.summary}`.slice(0, 500),
      "prices",
      undefined,
      change.change,
    );
  await done;
}

export async function repriceAllShops(): Promise<number> {
  const shops = await listShops();
  for (const shop of shops) await repriceShop(shop);
  return shops.length;
}

export async function savePurse(purse: Purse): Promise<void> {
  if (!coinsSchema.safeParse(purse.coins).success)
    throw new Error("Coin balances must be nonnegative whole numbers.");
  const db = await quireDb();
  await atomic(["purses", "meta"], async (tx) => {
    const old = await request<Purse | undefined>(tx.objectStore("purses").get(purse.id));
    tx.objectStore("purses").put(purse);
    await audit(
      tx,
      `${old ? "Updated" : "Created"} account: ${purse.name}`,
      "management",
      purse.id,
      {
        entity: "account",
        entityId: purse.id,
        before: old ? { name: old.name, kind: old.kind } : null,
        after: { name: purse.name, kind: purse.kind },
      },
    );
  });
}

export async function updatePurseMetadata(input: Purse): Promise<void> {
  await atomic(["purses", "meta"], async (tx) => {
    const current = await request<Purse | undefined>(tx.objectStore("purses").get(input.id));
    if (!current) throw Error("Character no longer exists.");
    // A rename/portrait edit cannot restore an old wallet, sheet or roll history.
    tx.objectStore("purses").put({
      ...current,
      name: input.name,
      portrait: input.portrait,
      control: input.control,
    });
    await audit(tx, `Updated account: ${input.name}`, "management", input.id);
  });
}

export async function saveCampaignCharacter(input: {
  purseId: string;
  before: import("../characters/model.mjs").PlaySheet;
  sheet: import("../characters/model.mjs").PlaySheet;
}) {
  return atomic(["purses", "holdings", "ledger", "meta"], async (tx) => {
    const purses = await request<Purse[]>(tx.objectStore("purses").getAll());
    const holdings = await request<Holding[]>(tx.objectStore("holdings").getAll());
    const legacy = await request<{ sheets: CharacterSheet[] } | undefined>(
      tx.objectStore("meta").get("sheets"),
    );
    const table = { purses, holdings, ledger: [] as LedgerLine[], sheets: legacy?.sheets || [] };
    editCharacter(table, getSeat(), input, crypto.randomUUID());
    validateEconomyRows({ ...table, shops: [], stock: [] });
    const p = table.purses.find((p) => p.id === input.purseId)!;
    tx.objectStore("purses").put(p);
    for (const h of holdings.filter((h) => h.purseId === p.id))
      tx.objectStore("holdings").delete(h.id);
    for (const h of table.holdings.filter((h) => h.purseId === p.id))
      tx.objectStore("holdings").put(h);
    for (const line of table.ledger) tx.objectStore("ledger").put(line);
    await audit(tx, `Character sheet updated: ${p.name}`, "management", p.id);
  });
}

export async function createCampaignCharacter(sheet = blankSheet()): Promise<string> {
  if (getSeat().role !== "dm") throw Error("Ask the DM to add a campaign character.");
  sheet = { ...sheet, equipment: sheet.equipment.map(({ id: _id, ...item }) => item) };
  const p = blankPurse("character");
  p.name = sheet.name;
  p.portrait = sheet.portrait || undefined;
  return atomic(["purses", "holdings", "ledger", "meta"], async (tx) => {
    const table = {
      purses: [p],
      holdings: [] as Holding[],
      ledger: [] as LedgerLine[],
      sheets: [],
    };
    editCharacter(
      table,
      getSeat(),
      { purseId: p.id, before: { ...p.sheet!, name: p.name, portrait: p.portrait || "" }, sheet },
      p.id,
    );
    validateEconomyRows({ ...table, shops: [], stock: [] });
    tx.objectStore("purses").put(p);
    for (const h of table.holdings) tx.objectStore("holdings").put(h);
    for (const l of table.ledger) tx.objectStore("ledger").put(l);
    await audit(tx, `Created character: ${p.name}`, "management", p.id);
    return p.id;
  });
}

/** Adopt an explicitly selected/previously linked profile, never match by name.
 * Private profile money/gear stay in that profile until a DM explicitly awards them. */
export async function bindCampaignProfile(
  purseId: string,
  profileId: string,
  sheet: import("../characters/model.mjs").PlaySheet,
  migration = false,
) {
  if (getSeat().role !== "dm")
    throw Error("Ask the DM to import the character into this campaign.");
  await atomic(["purses", "meta"], async (tx) => {
    const p = await request<Purse | undefined>(tx.objectStore("purses").get(purseId));
    if (!p || p.kind !== "character") throw Error("Character no longer exists.");
    if (migration && p.sheet) return;
    p.sheet = statsOnly(sheet);
    p.name = sheet.name;
    p.portrait = sheet.portrait || undefined;
    p.profileId = profileId;
    p.sheetRevision = (p.sheetRevision || 0) + 1;
    tx.objectStore("purses").put(p);
    await audit(
      tx,
      `Imported character profile: ${p.name}; existing funds and inventory preserved`,
      "management",
      p.id,
    );
  });
}

export async function unbindCampaignProfile(profileId: string) {
  if (getSeat().role !== "dm") throw Error("Ask the DM to detach this account profile.");
  await atomic(["purses"], async (tx) => {
    const purses = await request<Purse[]>(tx.objectStore("purses").getAll());
    for (const p of purses.filter((p) => p.profileId === profileId)) {
      delete p.profileId;
      delete p.sheetReadOnlyForDm;
      tx.objectStore("purses").put(p);
    }
  });
}

export async function saveShop(shop: Shop): Promise<void> {
  const db = await quireDb();
  await atomic(["shops", "meta"], async (tx) => {
    const before = await request<Shop | undefined>(tx.objectStore("shops").get(shop.id));
    if (before?.schedule && before.closed !== shop.closed) delete shop.schedule;
    tx.objectStore("shops").put(normalizeShop(shop));
    await audit(
      tx,
      `${before ? "Updated" : "Created"} shop: ${shop.name}${shop.closed ? " (closed)" : " (open)"}`,
      "management",
      undefined,
      {
        entity: "shop",
        entityId: shop.id,
        before: before
          ? {
              name: before.name,
              closed: !!before.closed,
              buyRate: before.buyRate,
              sellRate: before.sellRate,
            }
          : null,
        after: {
          name: shop.name,
          closed: !!shop.closed,
          buyRate: shop.buyRate,
          sellRate: shop.sellRate,
        },
      },
    );
  });
}

export async function saveStock(line: StockLine): Promise<void> {
  const db = await quireDb();
  await atomic(["stock", "meta"], async (tx) => {
    const before = await request<StockLine | undefined>(tx.objectStore("stock").get(line.id));
    tx.objectStore("stock").put(line);
    if (before && before.copper !== line.copper)
      await audit(
        tx,
        `${line.name}: ${before.copper} cp → ${line.copper} cp`,
        "prices",
        undefined,
        {
          entity: "stock",
          entityId: line.id,
          before: { copper: before.copper },
          after: { copper: line.copper },
        },
      );
  });
}

/** Add a catalog selection atomically; existing prices and quantities stay intact. */
export async function addShelfStock(shopId: string, rows: ShelfDraft[]): Promise<number> {
  if (getSeat().role !== "dm") throw new Error("Only the DM can manage shop stock.");
  const prepared = rows.map(row => ({ ...row, id: crypto.randomUUID(), shopId, name: row.name.trim() }));
  validateEconomyRows({ purses: [], holdings: [], shops: [], stock: prepared, ledger: [] });
  if (prepared.some(row => !row.name || !Number.isSafeInteger(row.baseCopper) || row.baseCopper < 0))
    throw new Error("Choose catalog items with valid names and prices.");
  return atomic(["shops", "stock", "meta"], async tx => {
    const shop = await request<Shop | undefined>(tx.objectStore("shops").get(shopId));
    if (!shop) throw new Error("This shop no longer exists.");
    const store = tx.objectStore("stock");
    const current = await request<StockLine[]>(store.index("shopId").getAll(shopId));
    const names = new Set(current.map(row => row.name.trim().toLowerCase()));
    let added = 0;
    for (const row of prepared) {
      const key = row.name.toLowerCase();
      if (names.has(key)) continue;
      names.add(key);
      store.put(row);
      added++;
    }
    if (added) await audit(tx, `Added ${added} catalog items to ${shop.name}; existing stock preserved`, "management");
    return added;
  });
}

export async function saveHolding(holding: Holding): Promise<void> {
  if (
    !Number.isSafeInteger(holding.quantity) ||
    holding.quantity < 1 ||
    !Number.isSafeInteger(holding.unitCopper) ||
    holding.unitCopper < 0
  )
    throw new Error("Enter a valid quantity and value.");
  const db = await quireDb();
  await atomic(["holdings", "meta"], async (tx) => {
    tx.objectStore("holdings").put(holding);
    await audit(
      tx,
      `Recorded holding: ${holding.name} ×${holding.quantity}`,
      "management",
      holding.purseId,
    );
  });
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
  const base =
    typeof line.baseCopper === "number" && line.baseCopper > 0 ? line.baseCopper : line.copper;
  return { ...line, rarity, baseCopper: base };
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(5, Math.max(0, rate));
}

export async function removeShop(id: string): Promise<void> {
  const db = await quireDb();
  const lines = await request(
    db.transaction("stock").objectStore("stock").index("shopId").getAll(id),
  );
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
  await atomic(["holdings", "meta"], async (tx) => {
    const old = await request<Holding | undefined>(tx.objectStore("holdings").get(id));
    tx.objectStore("holdings").delete(id);
    if (old) await audit(tx, `Removed holding: ${old.name}`, "management", old.purseId);
  });
}

export async function removePurse(id: string): Promise<void> {
  await atomic(["purses", "holdings", "meta"], async (tx) => {
    const row = await request<{ value: unknown } | undefined>(
      tx.objectStore("meta").get("journal"),
    );
    assertFinanceAccountRemovable(readJournal(row?.value).finance, id);
    const holdings = await request<Holding[]>(
      tx.objectStore("holdings").index("purseId").getAll(id),
    );
    tx.objectStore("purses").delete(id);
    for (const holding of holdings) tx.objectStore("holdings").delete(holding.id);
    await audit(tx, "Removed account and its holdings", "management", id);
  });
}

export async function addPricedStock(
  shopId: string,
  rows: Array<{ name: string; copper: number; notes: string; rarity?: ItemRarity }>,
): Promise<number> {
  const db = await quireDb();
  const existing = await request(
    db.transaction("stock").objectStore("stock").index("shopId").getAll(shopId),
  );
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

function logLine(
  purseId: string,
  shopId: string | null,
  summary: string,
  copper: number,
  transactionType: LedgerLine["transactionType"] = "adjustment",
): LedgerLine {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    purseId,
    shopId,
    summary,
    copper,
    transactionType,
  };
}

async function charismaOf(purse: Purse, tx: IDBTransaction): Promise<number | null> {
  if (purse.kind === "party") return null;
  if (purse.sheet) return purse.sheet.scores.cha;
  const sheets = readSheets(await request(tx.objectStore("meta").get("sheets")));
  return charismaScore(sheets.find((sheet) => sheet.purseId === purse.id));
}

async function atomic<T>(stores: string[], work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await quireDb();
  const tx = db.transaction(stores, "readwrite");
  const done = finish(tx);
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* A completed transaction cannot be aborted again. */
    }
    await done.catch(() => undefined);
    throw error;
  }
}

export async function buyFromShop(input: {
  stockId: string;
  purseId: string;
  quantity: number;
}): Promise<void> {
  const quantity = Math.floor(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("Choose a valid quantity of at least one.");
  await atomic(["purses", "holdings", "stock", "shops", "ledger", "meta"], async (tx) => {
    const stock = await request<StockLine | undefined>(tx.objectStore("stock").get(input.stockId));
    if (!stock) throw new Error("That item is no longer in the shop.");
    const shop = await request<Shop | undefined>(tx.objectStore("shops").get(stock.shopId));
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(input.purseId));
    if (!shop || !purse) throw new Error("Choose an account and a shop.");
    if (shop.closed) throw new Error("This shop is closed.");
    if (stock.quantity !== null && stock.quantity < quantity)
      throw new Error("The shop does not have that many.");
    const score = await charismaOf(purse, tx);
    const unit = priceAfterCharisma(Math.round(stock.copper * shop.sellRate), score);
    const cost = unit * quantity;
    const coins = spendCoins(purse.coins, cost);
    if (!coins) throw new Error("Insufficient funds.");
    // Each purchase is a separate lot. A matching name does not identify the
    // same valuation, notes, equipment or provenance as previously owned goods.
    const holding: Holding | null = isService(stock)
      ? null
      : {
          id: crypto.randomUUID(),
          purseId: purse.id,
          name: stock.name,
          category: stockCategory(stock, shop),
          kind: "item",
          quantity,
          unitCopper: stock.copper,
          notes: stock.notes,
        };
    tx.objectStore("purses").put({ ...purse, coins });
    if (holding) tx.objectStore("holdings").put(holding);
    if (stock.quantity !== null)
      tx.objectStore("stock").put({
        ...stock,
        quantity: stock.quantity - quantity,
      });
    const percent = score === null ? 0 : charismaOffPercent(score);
    const summary =
      `Bought ${quantity} ${stock.name} from ${shop.name}` +
      (percent ? `, Charisma ${score}, ${percent}% off` : "");
    tx.objectStore("ledger").put({
      ...logLine(purse.id, shop.id, summary, -cost, "purchase"),
      purchase: { stockId: stock.id, quantity, holding },
    });
  });
}

export async function sellToShop(input: {
  holdingId: string;
  shopId: string;
  quantity: number;
}): Promise<void> {
  const quantity = Math.floor(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("Choose a valid quantity of at least one.");
  await atomic(["purses", "holdings", "shops", "ledger"], async (tx) => {
    const holding = await request<Holding | undefined>(
      tx.objectStore("holdings").get(input.holdingId),
    );
    const shop = await request<Shop | undefined>(tx.objectStore("shops").get(input.shopId));
    if (!holding || !shop) throw new Error("That sale cannot be made.");
    if (shop.closed) throw new Error("This shop is closed.");
    assertMerchantSale(holding, shop);
    if (holding.quantity < quantity) throw new Error("You do not have that many.");
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(holding.purseId));
    if (!purse) throw new Error("This account no longer exists.");
    const paid = Math.max(0, Math.round(holding.unitCopper * shop.buyRate)) * quantity;
    if (!Number.isSafeInteger(paid)) throw new Error("That sale amount is invalid.");
    tx.objectStore("purses").put({ ...purse, coins: gain(purse.coins, paid) });
    if (holding.quantity === quantity) tx.objectStore("holdings").delete(holding.id);
    else tx.objectStore("holdings").put({ ...holding, quantity: holding.quantity - quantity });
    tx.objectStore("ledger").put(
      logLine(purse.id, shop.id, `Sold ${quantity} ${holding.name} to ${shop.name}`, paid, "sale"),
    );
  });
}

function gain(coins: Coins, copper: number): Coins {
  const total = toCopper(coins) + copper;
  if (
    !coinsSchema.safeParse(coins).success ||
    !Number.isSafeInteger(copper) ||
    copper < 0 ||
    !Number.isSafeInteger(total)
  )
    throw new Error(
      "That coin balance cannot be represented exactly in whole copper. Export the original save before repairing it.",
    );
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

export async function giveToPlayer(input: {
  fromId: string;
  toId: string;
  copper: number;
  holdingId: string | null;
  quantity: number;
}): Promise<void> {
  const copper = Math.max(0, Math.round(input.copper));
  if (!Number.isSafeInteger(copper)) throw new Error("Enter a valid coin amount.");
  if (input.fromId === input.toId) throw new Error("Choose another player.");
  const db = await quireDb();
  const purses = await request<Purse[]>(db.transaction("purses").objectStore("purses").getAll());
  const from = purses.find((purse) => purse.id === input.fromId);
  if (!from) throw new Error("This account no longer exists.");
  const sitting = getSeat();
  const roster = sitting.role === "player" ? await loadRoster() : [];
  const to = purses.find((purse) => purse.id === input.toId);
  const known =
    sitting.role === "player" ? roster.some((person) => person.id === input.toId) : Boolean(to);
  if (!known) throw new Error("That player is not on this link.");
  const toName =
    to?.name ?? roster.find((person) => person.id === input.toId)?.name ?? "Another player";
  const holdingRow = input.holdingId
    ? await request<Holding | undefined>(
        db.transaction("holdings").objectStore("holdings").get(input.holdingId),
      )
    : undefined;
  let moved: PlayerGift["holding"] = null;
  if (input.holdingId) {
    const quantity = Math.floor(input.quantity);
    if (!holdingRow || holdingRow.purseId !== from.id)
      throw new Error("That holding is not yours.");
    if (!Number.isSafeInteger(quantity) || quantity < 1 || holdingRow.quantity < quantity)
      throw new Error("You do not have that many.");
    moved = itemForGift(holdingRow, quantity);
  }
  if (copper === 0 && !moved) throw new Error("Give coins, an item, or a holding.");
  const nextCoins = copper > 0 ? spendCoins(from.coins, copper) : from.coins;
  if (!nextCoins) throw new Error("Insufficient funds.");
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
  await atomic(["purses", "holdings", "ledger", "meta"], async (tx) => {
    const from = await request<Purse | undefined>(tx.objectStore("purses").get(input.fromId));
    const to = await request<Purse | undefined>(tx.objectStore("purses").get(input.toId));
    if (!from) throw new Error("This account no longer exists.");
    const nextCoins = copper > 0 ? spendCoins(from.coins, copper) : from.coins;
    if (!nextCoins) throw new Error("Insufficient funds.");
    const holdingRow = input.holdingId
      ? await request<Holding | undefined>(tx.objectStore("holdings").get(input.holdingId))
      : undefined;
    if (
      moved &&
      (!holdingRow || holdingRow.purseId !== from.id || holdingRow.quantity < moved.quantity)
    )
      throw new Error("You do not have that many.");
    if (holdingRow && moved) gift.holding = moved = itemForGift(holdingRow, moved.quantity);
    const pendingRow =
      sitting.role === "player" ? await request(tx.objectStore("meta").get("gifts")) : null;
    const pending =
      sitting.role === "player" ? [...readGifts(pendingRow?.gifts ?? pendingRow), gift] : null;
    tx.objectStore("purses").put({ ...from, coins: nextCoins });
    if (holdingRow && moved) {
      if (holdingRow.quantity === moved.quantity) tx.objectStore("holdings").delete(holdingRow.id);
      else
        tx.objectStore("holdings").put({
          ...holdingRow,
          quantity: holdingRow.quantity - moved.quantity,
        });
    }
    if (sitting.role !== "player" && to) {
      tx.objectStore("purses").put({
        ...to,
        coins: copper > 0 ? gain(to.coins, copper) : to.coins,
      });
      if (moved) {
        tx.objectStore("holdings").put({
          id: crypto.randomUUID(),
          purseId: to.id,
          ...moved,
          notes: moved.notes ?? "",
        });
      }
    }
    if (sitting.role !== "player" && to)
      tx.objectStore("ledger").put(logLine(to.id, null, "Transfer received", copper, "transfer"));
    if (pending) tx.objectStore("meta").put({ id: "gifts", gifts: pending });
    tx.objectStore("ledger").put(
      logLine(
        from.id,
        null,
        sitting.role !== "player" && to ? "Transfer sent" : `Gave ${toName} ${giftParts(gift)}`,
        copper > 0 ? -copper : 0,
        "transfer",
      ),
    );
  });
  await postNotes([{ from: "player", to: "party", purseId: from.id, text: giftSummary(gift) }]);
}

export async function addListing(input: {
  name: string;
  kind: Listing["kind"];
  copper: number;
  quantity: number | null;
  notes: string;
}): Promise<void> {
  const name = input.name.trim();
  const copper = Math.round(input.copper);
  if (!name) throw new Error("Name the listing.");
  if (!Number.isFinite(copper) || copper < 0) throw new Error("Enter a price.");
  if (getSeat().role === "player") throw new Error("Only the DM can edit the market.");
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
  if (getSeat().role === "player") throw new Error("Only the DM can edit the market.");
  await saveListings((await loadListings()).filter((listing) => listing.id !== id));
}

export async function buyListing(input: {
  listingId: string;
  purseId: string;
  quantity: number;
}): Promise<void> {
  const quantity = Math.floor(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1)
    throw new Error("Choose a valid quantity of at least one.");
  await atomic(["purses", "holdings", "ledger", "meta"], async (tx) => {
    const listings = readListings(await request(tx.objectStore("meta").get("listings")));
    const listing = listings.find((item) => item.id === input.listingId);
    if (!listing) throw new Error("That listing is gone.");
    if (listing.quantity !== null && listing.quantity < quantity)
      throw new Error("There are not that many.");
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(input.purseId));
    if (!purse) throw new Error("This account no longer exists.");
    const score = await charismaOf(purse, tx);
    const cost = priceAfterCharisma(listing.copper, score) * quantity;
    const coins = spendCoins(purse.coins, cost);
    if (!coins) throw new Error("Insufficient funds.");
    const sales =
      getSeat().role === "player"
        ? readSales(await request(tx.objectStore("meta").get("sales")))
        : null;
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
    tx.objectStore("meta").put({
      id: "listings",
      listings: listings.map((item) =>
        item.id !== listing.id || item.quantity === null
          ? item
          : { ...item, quantity: item.quantity - quantity },
      ),
    });
    if (sales)
      tx.objectStore("meta").put({
        id: "sales",
        sales: [
          ...sales,
          {
            id: crypto.randomUUID(),
            at: Date.now(),
            listingId: listing.id,
            quantity,
            purseId: purse.id,
          },
        ],
      });
    const percent = score === null ? 0 : charismaOffPercent(score);
    const summary =
      `Bought ${quantity} ${listing.name} from the market` +
      (percent ? `, Charisma ${score}, ${percent}% off` : "");
    tx.objectStore("ledger").put(logLine(purse.id, null, summary, -cost, "purchase"));
  });
}

export async function askLoan(input: {
  purseId: string;
  copper: number;
  note: string;
  requestId?: string;
}): Promise<void> {
  const copper = Math.round(input.copper);
  const note = input.note.trim();
  if (getCloudWatch().joined && !getCloudWatch().mine) throw new Error("It is not your turn.");
  if (!Number.isSafeInteger(copper) || copper <= 0)
    throw new Error("Enter how much to borrow in whole copper.");
  if (!note) throw new Error("Write what the loan is for.");
  const id = input.requestId || crypto.randomUUID();
  await atomic(["purses", "meta"], async (tx) => {
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(input.purseId));
    if (!purse) throw new Error("This account no longer exists.");
    const loans = readLoans(await request(tx.objectStore("meta").get("loans")));
    const prior = loans.find((loan) => loan.id === id);
    if (prior) {
      if (prior.purseId !== purse.id || prior.copper !== copper || prior.note !== note)
        throw new Error("That loan request ID already identifies a different request.");
      return;
    }
    const at = Date.now();
    loans.push({
      id,
      at,
      purseId: purse.id,
      purseName: purse.name,
      copper,
      note,
      status: "pending",
    });
    const notes = readNotes(await request(tx.objectStore("meta").get("chat")));
    tx.objectStore("meta").put({ id: "loans", loans });
    tx.objectStore("meta").put({
      id: "chat",
      notes: readNotes([
        ...notes,
        {
          id: `${id}-request-note`,
          at,
          from: "player",
          to: "dm",
          purseId: purse.id,
          text: `${purse.name} asked for a loan of ${formatCopper(copper)}. ${note}`,
        },
      ]),
    });
  });
  await refreshChat();
}

export async function decideLoan(id: string, status: LoanStatus): Promise<void> {
  if (status === "pending") return;
  if (getSeat().role === "player") throw new Error("Only the DM can approve or deny loans.");
  const decided = await atomic(["purses", "ledger", "meta"], async (tx) => {
    const loans = readLoans(await request(tx.objectStore("meta").get("loans")));
    const loan = loans.find((item) => item.id === id);
    if (!loan || loan.status !== "pending") return null;
    if (status === "approved") {
      const purse = await request<Purse | undefined>(tx.objectStore("purses").get(loan.purseId));
      if (!purse) throw new Error("This account no longer exists.");
      tx.objectStore("purses").put({
        ...purse,
        coins: gain(purse.coins, loan.copper),
      });
      const row = await request<{ value: unknown } | undefined>(
        tx.objectStore("meta").get("journal"),
      );
      const journal = readJournal(row?.value);
      (journal.finance ??= readFinance()).loans.push(loanFromRequest(loan));
      journal.finance = readFinance(journal.finance);
      tx.objectStore("meta").put({ id: "journal", value: journal });
      tx.objectStore("ledger").put(
        logLine(
          purse.id,
          null,
          `Approved a loan of ${formatCopper(loan.copper)}`,
          loan.copper,
          "loan",
        ),
      );
    }
    tx.objectStore("meta").put({
      id: "loans",
      loans: loans.map((item) => (item.id === id ? { ...item, status } : item)),
    });
    const notes = readNotes(await request(tx.objectStore("meta").get("chat")));
    tx.objectStore("meta").put({
      id: "chat",
      notes: readNotes([
        ...notes,
        {
          id: `${loan.id}-decision-note`,
          at: Date.now(),
          from: "dm",
          to: "dm",
          purseId: loan.purseId,
          text: `Loan of ${formatCopper(loan.copper)} ${status}.`,
        },
      ]),
    });
    return loan;
  });
  if (decided) await refreshChat();
}

export async function importCharacterSheet(purseId: string, file: File): Promise<string[]> {
  const body = await readCharacterSheet(file);
  const sheet: CharacterSheet = { ...body, purseId, importedAt: Date.now() };
  await atomic(["purses", "holdings", "ledger", "meta"], async (tx) => {
    const purses = await request<Purse[]>(tx.objectStore("purses").getAll());
    const holdings = await request<Holding[]>(tx.objectStore("holdings").getAll());
    const old = await request<{ sheets: CharacterSheet[] } | undefined>(
      tx.objectStore("meta").get("sheets"),
    );
    const table = { purses, holdings, ledger: [] as LedgerLine[], sheets: old?.sheets || [] };
    editLegacyCharacter(table, getSeat(), sheet);
    const purse = table.purses.find((p) => p.id === purseId)!;
    const before = characterSheet(purse, holdings, sheet);
    const next: import("../characters/model.mjs").PlaySheet = { ...before };
    const imported = legacyCharacter(sheet, sheet.name);
    // Reimporting never duplicates or replaces existing spendable campaign assets.
    if (getSeat().role === "dm") {
      if (!before.equipment.length && imported.equipment.length)
        next.equipment = imported.equipment;
      if (toCopper(before.coins) === 0 && toCopper(sheet.coins) > 0) next.coins = sheet.coins;
    }
    editCharacter(table, getSeat(), { purseId, before, sheet: next }, crypto.randomUUID());
    validateEconomyRows({ ...table, shops: [], stock: [] });
    tx.objectStore("purses").put(purse);
    tx.objectStore("meta").put({ id: "sheets", sheets: table.sheets });
    for (const item of table.holdings.filter((h) => h.purseId === purseId))
      tx.objectStore("holdings").put(item);
    for (const line of table.ledger) tx.objectStore("ledger").put(line);
    await audit(tx, `Imported character sheet: ${purse.name}`, "management", purse.id);
  });
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

export async function updateCharacterSheet(
  sheet: CharacterSheet,
  before?: CharacterSheet,
): Promise<void> {
  await atomic(["purses", "meta"], async (tx) => {
    const p = await request<Purse | undefined>(tx.objectStore("purses").get(sheet.purseId));
    const row = await request<{ sheets: CharacterSheet[] } | undefined>(
      tx.objectStore("meta").get("sheets"),
    );
    const table = { purses: p ? [p] : [], sheets: row?.sheets || [] };
    editLegacyCharacter(table, getSeat(), sheet, before);
    tx.objectStore("purses").put(table.purses[0]);
    tx.objectStore("meta").put({ id: "sheets", sheets: table.sheets });
  });
}

export async function voidLedgerLine(id: string): Promise<void> {
  if (getSeat().role === "player") throw new Error("Only the DM can reverse a ledger line.");
  await atomic(["purses", "holdings", "shops", "stock", "ledger"], async (tx) => {
    const lines = await request<LedgerLine[]>(tx.objectStore("ledger").getAll());
    const line = lines.find((item) => item.id === id);
    if (!line) throw new Error("That line is not in this browser on this device.");
    if (line.reversalOf || line.summary.startsWith("Voided"))
      throw new Error("That line is already a void.");
    // Legacy copies identify reversals in their summary; new copies also retain
    // an explicit source ID. Check both while holding the write transaction.
    if (lines.some((item) => item.reversalOf === id || item.summary.includes(`(void:${id})`)))
      return;
    if (
      line.transactionType === "transfer" ||
      line.transactionType === "loan" ||
      /^(Finance:|Sold |Gave |Transfer (sent|received)|Approved a loan |Bought .* from the market)/.test(
        line.summary,
      )
    )
      throw new Error(
        "This trade cannot be reversed safely from the ledger. Record a compensating payment or transfer and correct the holding instead.",
      );
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(line.purseId));
    if (!purse) throw new Error("This account no longer exists.");
    const bought = /^Bought (\d+) (.+?) from /.exec(line.summary);
    let holding: Holding | undefined;
    let shelf: StockLine | undefined;
    const quantity = line.purchase?.quantity ?? (bought ? Number(bought[1]) : 0);
    if (line.purchase || bought) {
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !line.shopId)
        throw new Error(
          "This purchase receipt is incomplete. Correct the assets with a compensating transaction.",
        );
      if (bought && Number(bought[1]) !== quantity)
        throw new Error(
          "This purchase receipt has conflicting quantities. Correct the assets with a compensating transaction.",
        );
      if (line.purchase) {
        shelf = await request<StockLine | undefined>(
          tx.objectStore("stock").get(line.purchase.stockId),
        );
        if (line.purchase.holding) {
          holding = await request<Holding | undefined>(
            tx.objectStore("holdings").get(line.purchase.holding.id),
          );
          const original = line.purchase.holding;
          const keys = new Set([
            ...Object.keys(holding ?? {}),
            ...Object.keys(original),
          ] as (keyof Holding)[]);
          if (
            !holding ||
            holding.purseId !== purse.id ||
            holding.kind !== "item" ||
            holding.quantity !== quantity ||
            [...keys].some((key) => holding![key] !== original[key])
          )
            throw new Error(
              "The purchased items have changed or left this account. Correct the assets with a compensating transaction.",
            );
        } else if (!shelf || !isService(shelf))
          throw new Error(
            "This purchase is missing its item receipt. Correct the assets with a compensating transaction.",
          );
      } else {
        const name = bought![2].toLowerCase();
        const holdings = await request<Holding[]>(
          tx.objectStore("holdings").index("purseId").getAll(purse.id),
        );
        const stock = await request<StockLine[]>(
          tx.objectStore("stock").index("shopId").getAll(line.shopId),
        );
        const candidates = holdings.filter(
          (item) => item.name.toLowerCase() === name && item.kind === "item",
        );
        const shelves = stock.filter((item) => item.name.toLowerCase() === name);
        if (candidates.length !== 1 || shelves.length !== 1)
          throw new Error(
            "This older purchase has ambiguous item or stock records. Record a compensating payment and correct the exact holding instead.",
          );
        holding = candidates[0];
        shelf = shelves[0];
        const shop = await request<Shop | undefined>(tx.objectStore("shops").get(line.shopId));
        // A sold purchase can leave only an older same-name lot. Without a
        // source ID, all recorded valuation and item metadata must still agree.
        if (
          !shop ||
          holding.unitCopper !== shelf.copper ||
          holding.notes !== shelf.notes ||
          (holding.category && holding.category !== stockCategory(shelf, normalizeShop(shop)))
        )
          throw new Error(
            "This older purchase no longer matches the remaining item and stock records. Record a compensating payment and correct the exact holding instead.",
          );
        if (holding.quantity < quantity)
          throw new Error(
            "The purchased items are no longer in this account. Return them before reversing the purchase.",
          );
      }
      if (
        !shelf ||
        shelf.shopId !== line.shopId ||
        (bought && shelf.name.toLowerCase() !== bought[2].toLowerCase())
      )
        throw new Error(
          "The original shop stock is missing or changed. Correct the assets with a compensating transaction.",
        );
      if (shelf.quantity !== null && !Number.isSafeInteger(shelf.quantity + quantity))
        throw new Error("The returned stock quantity would be too large.");
    }
    const coins =
      line.copper < 0 ? gain(purse.coins, -line.copper) : spendCoins(purse.coins, line.copper);
    if (!coins) throw new Error("That account cannot cover reversing this line.");
    tx.objectStore("purses").put({ ...purse, coins });
    if (holding) {
      const left = holding.quantity - quantity;
      if (left > 0) tx.objectStore("holdings").put({ ...holding, quantity: left });
      else tx.objectStore("holdings").delete(holding.id);
    }
    if (shelf && shelf.quantity !== null)
      tx.objectStore("stock").put({
        ...shelf,
        quantity: shelf.quantity + quantity,
      });
    tx.objectStore("ledger").put({
      ...logLine(
        purse.id,
        line.shopId,
        `Voided ${line.summary} (void:${id})`,
        -line.copper,
        "void",
      ),
      reversalOf: id,
    });
  });
}

export async function setCoins(purseId: string, coins: Coins, summary?: string): Promise<void> {
  if (!coinsSchema.safeParse(coins).success)
    throw new Error(
      "Coin balances must be nonnegative whole numbers with an exactly representable total. Export oversized original saves before repairing them.",
    );
  const next = tidy(coins);
  await atomic(["purses", "ledger"], async (tx) => {
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(purseId));
    if (!purse) throw new Error("This account no longer exists.");
    if (!coinsSchema.safeParse(purse.coins).success)
      throw new Error(
        "The previous coin balance cannot be represented exactly. Export the original save before repairing it.",
      );
    const delta = toCopper(next) - toCopper(purse.coins);
    if (!Number.isSafeInteger(delta))
      throw new Error(
        "The previous coin balance cannot be represented exactly. Export the original save before repairing it.",
      );
    tx.objectStore("purses").put({ ...purse, coins: next });
    if (delta !== 0)
      tx.objectStore("ledger").put(
        logLine(purse.id, null, summary?.trim() || `Adjusted coin in ${purse.name}`, delta),
      );
  });
}

export async function postCopper(purseId: string, copper: number, summary: string): Promise<void> {
  if (!summary.trim()) throw new Error("Write what the money was for.");
  if (!Number.isSafeInteger(copper) || copper === 0)
    throw new Error("Enter a valid amount in whole copper.");
  await atomic(["purses", "ledger"], async (tx) => {
    const purse = await request<Purse | undefined>(tx.objectStore("purses").get(purseId));
    if (!purse) throw new Error("This account no longer exists.");
    if (!coinsSchema.safeParse(purse.coins).success)
      throw new Error(
        "The previous coin balance cannot be represented exactly. Export the original save before repairing it.",
      );
    const nextTotal = toCopper(purse.coins) + copper;
    if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) throw new Error("Insufficient funds.");
    tx.objectStore("purses").put({
      ...purse,
      coins: copper < 0 ? spendCoins(purse.coins, -copper)! : gain(purse.coins, copper),
    });
    tx.objectStore("ledger").put(logLine(purse.id, null, summary.trim(), copper, "payment"));
  });
}

export type QuireFile = {
  /** Supplemental account recovery history is preserved even in a device-only copy. */
  campaignRecovery?: unknown;
  recoveryDiagnostics?: string[];
  localEncounters?: ReturnType<typeof readLocalEncounters>;
  journal?: Journal;
  gifts?: import("./gift.ts").PlayerGift[];
  sales?: import("./market.ts").ListingSale[];
  shareBase?: ReportBase;
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
  notes?: ChatNote[];
  handouts?: Handout[];
};

export async function snapshot(): Promise<QuireFile> {
  const db = await quireDb();
  const tx = db.transaction(
    [
      "books",
      "articles",
      "purses",
      "holdings",
      "shops",
      "stock",
      "ledger",
      "catalog",
      "lexicon",
      "meta",
    ],
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
  const settingsRow = request<Partial<RealmSettings> | undefined>(
    tx.objectStore("meta").get("settings"),
  );
  const baseRow = request<{ value: ReportBase } | undefined>(
    tx.objectStore("meta").get("shareBase"),
  );
  const diagnosticsRow = request<{ value: string[] } | undefined>(tx.objectStore("meta").get("recoveryDiagnostics"));
  const recoveryRow = request<{ value: unknown } | undefined>(tx.objectStore("meta").get("campaignRecovery"));
  const encountersRow = request<{ rows: unknown } | undefined>(
    tx.objectStore("meta").get("localEncounters"),
  );
  const lockRow = request<unknown>(tx.objectStore("meta").get("seatLock"));
  const metadata = readCampaignMetadata(tx);
  const gifts = request<{ gifts: unknown } | undefined>(tx.objectStore("meta").get("gifts"));
  const sales = request(tx.objectStore("meta").get("sales"));
  const done = finish(tx);
  const seatLock = readSeatLock(await lockRow);
  const file: QuireFile = {
    kind: "quire",
    campaignRecovery: (await recoveryRow)?.value,
    recoveryDiagnostics: (await diagnosticsRow)?.value,
    localEncounters: readLocalEncounters((await encountersRow)?.rows),
    shareBase: (await baseRow)?.value,
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
  const shared = await metadata;
  Object.assign(file, {
    listings: shared.listings, loans: shared.loans, sheets: shared.sheets,
    notes: shared.notes, handouts: shared.handouts, journal: shared.journal,
    gifts: readGifts((await gifts)?.gifts), sales: readSales(await sales),
  });
  await done;
  return file;
}

export async function applyTable(file: TableFile): Promise<void> {
  if (getCloudWatch().joined)
    throw new Error("Return to Local Mode before importing or restoring campaign data.");
  const db = await quireDb();
  const shopIds = new Set(file.shops.map((shop) => shop.id));
  const purseIds = new Set(file.purses.map((purse) => purse.id));
  const existingStock = await request<StockLine[]>(
    db.transaction("stock").objectStore("stock").getAll(),
  );
  const existingHoldings = await request<Holding[]>(
    db.transaction("holdings").objectStore("holdings").getAll(),
  );
  const loans = mergeLoanLists(await loadLoans(), readLoans(file.loans), false);
  const sheets = mergeSheets(await loadSheets(), readSheets(file.sheets));
  const tx = db.transaction(["shops", "stock", "purses", "holdings", "meta"], "readwrite");
  const done = finish(tx);
  tx.objectStore("meta").put({
    id: "shareBase",
    value: {
      purses: file.purses,
      holdings: file.holdings,
      stock: file.stock.map((s) => ({ id: s.id, quantity: s.quantity })),
      listings: (file.listings ?? []).map((l) => ({ id: l.id, quantity: l.quantity })),
    },
  });
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
  if (Array.isArray(file.listings))
    tx.objectStore("meta").put({ id: "listings", listings: readListings(file.listings) });
  tx.objectStore("meta").put({ id: "loans", loans });
  tx.objectStore("meta").put({ id: "sheets", sheets });
  tx.objectStore("meta").put({ id: "handouts", handouts: file.handouts ?? [] });
  await done;
  await rememberIncoming(file.notes ?? []);
}

export async function applyBill(file: BillFile): Promise<number> {
  if (getCloudWatch().joined)
    throw new Error("Return to Local Mode before importing or restoring campaign data.");
  if (getSeat().role !== "dm") throw new Error("Only the DM can approve a player activity report.");
  // Manual/offline files cannot prove that a player did not edit their device.
  // Require explicit DM approval of actual resulting assets, not claimed receipts.
  if (typeof window !== "undefined") {
    const campaign = activeDatabaseName();
    const current = await listPurses();
    const changes = file.purses.map((p) => {
      const before = current.find((x) => x.id === p.id);
      const inventory =
        file.holdings
          .filter((h) => h.purseId === p.id)
          .map((h) => `${h.quantity} × ${h.name} (${formatCopper(h.unitCopper)} each)`)
          .join("; ") || "empty";
      return `${p.name}: ${formatCopper(toCopper(before?.coins || emptyCoins()))} → ${formatCopper(toCopper(p.coins))}\nInventory after import: ${inventory}`;
    });
    for (const gift of readGifts(file.gifts)) {
      changes.push(
        `Transfer from ${gift.fromName} to ${gift.toName}: ${formatCopper(gift.copper)}${gift.holding ? `; ${gift.holding.quantity} × ${gift.holding.name} (${formatCopper(gift.holding.unitCopper)} each)` : ""}`,
      );
    }
    if (
      !window.confirm(
        `Approve this manual player report? These changes are not server-verified.\n\n${changes.join("\n\n")}\n\nOnly approve funds and items authorized by your campaign.`,
      )
    )
      throw new Error("Player report was not approved. No campaign data changed.");
    if (campaign !== activeDatabaseName() || getSeat().role !== "dm")
      throw new Error("Campaign changed during review. Reopen the report in the correct campaign.");
  }
  const db = await quireDb();
  // Read and apply inside one transaction: a second import cannot pass the same baseline concurrently.
  const tx = db.transaction(
    ["purses", "holdings", "shops", "stock", "ledger", "meta"],
    "readwrite",
  );
  const done = finish(tx);
  try {
    const read = <T>(store: string) => request<T[]>(tx.objectStore(store).getAll());
    const [purses, holdings, shops, stock, ledger, meta] = await Promise.all([
      read<Purse>("purses"),
      read<Holding>("holdings"),
      read<Shop>("shops"),
      read<StockLine>("stock"),
      read<LedgerLine>("ledger"),
      read<any>("meta"),
    ]);
    const get = (id: string) => meta.find((x) => x.id === id);
    const seen: string[] = get("reportSeen")?.ids ?? [];
    if (file.reportId && seen.includes(file.reportId)) {
      await done;
      return 0;
    }
    verifyReportBase(
      file.base,
      { purses, holdings, stock },
      { purses: file.purses, holdings: file.holdings, stock: file.stock },
    );
    const listings = readListings(get("listings"));
    const sold = new Map<string, number>();
    for (const sale of file.sales ?? [])
      sold.set(sale.listingId, (sold.get(sale.listingId) ?? 0) + sale.quantity);
    for (const [id, count] of sold) {
      const before = file.base?.listings?.find((l) => l.id === id),
        now = listings.find((l) => l.id === id);
      if (
        !before ||
        !now ||
        before.quantity !== now.quantity ||
        (now.quantity !== null && now.quantity < count)
      )
        throw new Error("Conflict: market listing stock changed. No report changes were imported.");
    }
    const current: CloudTable = {
      purses,
      holdings,
      shops,
      stock,
      ledger,
      listings,
      loans: readLoans(get("loans")),
      sheets: readSheets(get("sheets")),
      notes: readNotes(get("chat")),
      handouts: readHandouts(get("handouts")),
    };
    const safe = {
      ...file,
      notes: readNotes(file.notes).filter(
        (n) => n.from === "player" && file.purseIds.includes(n.purseId),
      ),
      loans: readLoans(file.loans)
        .filter((l) => file.purseIds.includes(l.purseId))
        .map((l) => ({ ...l, status: "pending" as const })),
    };
    const next = applyBillToTable(current, safe, {
      gifts: get("localSeen")?.gifts ?? [],
      sales: get("localSeen")?.sales ?? [],
    });
    validateEconomyRows(next.table);
    for (const store of ["purses", "holdings", "stock", "ledger"] as const) {
      tx.objectStore(store).clear();
      for (const row of next.table[store]) tx.objectStore(store).put(row);
    }
    for (const id of ["listings", "loans", "sheets"] as const)
      tx.objectStore("meta").put({ id, [id]: next.table[id] });
    tx.objectStore("meta").put({ id: "chat", notes: next.table.notes });
    tx.objectStore("meta").put({ id: "localSeen", ...next.seen });
    if (file.reportId)
      tx.objectStore("meta").put({ id: "reportSeen", ids: [...seen, file.reportId] });
    await done;
    await refreshChat();
    return next.table.ledger.length - ledger.length;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* The transaction may already have finished. */
    }
    await done.catch(() => undefined);
    throw error;
  }
}

let seatLinkClaimed = false;

export async function applySeatLink(): Promise<"player" | "dm" | "bill" | null> {
  if (typeof window === "undefined" || seatLinkClaimed) return null;
  const role = new URLSearchParams(window.location.search).get("as");
  if (role !== "dm" && role !== "player") return null;
  if (["player"].includes(role)) throw new Error("Offline player links have retired. Ask the DM for the current session invitation. Existing saves are preserved.");
  seatLinkClaimed = true;
  const hash = window.location.hash;
  let result: "player" | "dm" | "bill" = role;
  if (role === "player" && hash.startsWith("#t.")) {
    const table = await decodeLinkPayload(hash);
    if (!table || table.kind !== "quire-table")
      throw new Error("That player link could not be read.");
    await applyTable(table);
    setSeat({
      role: "player",
      purseIds: table.purses.map((purse) => purse.id),
      shopIds: table.shops.map((shop) => shop.id),
      openedAt: table.exportedAt,
    });
  } else if (role === "dm" && hash.startsWith("#b.")) {
    if (getSeat().role === "player")
      throw new Error("Only the dungeon master can import an activity report.");
    const bill = await decodeLinkPayload(hash);
    if (!bill || bill.kind !== "quire-bill")
      throw new Error("That activity report link could not be read.");
    await applyBill(bill);
    presentReceipt(bill);
    setSeat(DM_SEAT);
    result = "bill";
  } else {
    throw new Error("That role link is incomplete. Ask the dungeon master for a new link.");
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("as");
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  return result;
}

export function readQuireFile(value: unknown): QuireFile {
  if (typeof value !== "object" || value === null)
    throw new Error("That file is not a Lootsplit copy.");
  const file = value as Partial<QuireFile>;
  if (file.kind !== "quire" || (file.version !== 1 && file.version !== 2))
    throw new Error("That file is not a Lootsplit copy.");
  for (const key of [
    "books",
    "articles",
    "purses",
    "holdings",
    "shops",
    "stock",
    "ledger",
  ] as const) {
    if (!Array.isArray(file[key])) throw new Error("That file is missing part of the ledger.");
  }
  validateEconomyRows(file as QuireFile);
  validateBackupRows(file as unknown as Record<string, unknown>);
  const journal = readValidatedJournal(file.journal);
  readLocalEncounters(file.localEncounters);
  const metadata = { listings: readListings(file.listings), loans: readLoans(file.loans),
    sheets: readSheets(file.sheets), notes: readNotes(file.notes), handouts: readHandouts(file.handouts),
    gifts: readGifts(file.gifts), sales: readSales(file.sales) };
  for (const [key, rows] of Object.entries(metadata)) {
    const source = file[key as keyof typeof metadata];
    if (source !== undefined && (!Array.isArray(source) || source.length !== rows.length))
      throw Error(`The ${key} contain invalid or duplicate data. The current campaign was not changed.`);
  }
  const diagnostics = validateBackupReferences({ ...(file as QuireFile), ...metadata, journal });
  // A clone error must occur before the destructive transaction, including non-JSON callers.
  structuredClone(file);
  return { ...file, recoveryDiagnostics: diagnostics } as QuireFile;
}

export async function restore(file: QuireFile): Promise<void> {
  if (getCloudWatch().joined)
    throw new Error("Return to Local Mode before importing or restoring campaign data.");
  file = structuredClone(readQuireFile(file));
  // Compute all readers/normalizers before opening the replacement transaction.
  const prepared = { encounters: readLocalEncounters(file.localEncounters), shops: file.shops.map(normalizeShop),
    stock: file.stock.map(normalizeStock), gifts: readGifts(file.gifts), sales: readSales(file.sales),
    listings: readListings(file.listings), loans: readLoans(file.loans), sheets: readSheets(file.sheets),
    notes: readNotes(file.notes), handouts: readHandouts(file.handouts), journal: readJournal(file.journal),
    lock: readSeatLock(file.seatLock), settings: file.settings ? clampRealm(file.settings) : undefined };
  const db = await quireDb();
  const stores = [
    "books",
    "articles",
    "purses",
    "holdings",
    "shops",
    "stock",
    "ledger",
    "catalog",
    "lexicon",
    "meta",
  ] as const;
  const tx = db.transaction([...stores], "readwrite");
  const done = finish(tx);
  try {
    for (const store of stores) tx.objectStore(store).clear();
    tx.objectStore("meta").put({
      id: "localEncounters",
      rows: prepared.encounters,
    });
    for (const purse of file.purses) tx.objectStore("purses").put(purse);
    for (const holding of file.holdings) tx.objectStore("holdings").put(holding);
    for (const shop of prepared.shops) tx.objectStore("shops").put(shop);
    for (const line of prepared.stock) tx.objectStore("stock").put(line);
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
    tx.objectStore("meta").put({ id: "gifts", gifts: prepared.gifts });
    tx.objectStore("meta").put({ id: "sales", sales: prepared.sales });
    if (file.shareBase) tx.objectStore("meta").put({ id: "shareBase", value: file.shareBase });
    if (file.settings) tx.objectStore("meta").put({ id: "settings", ...prepared.settings });
    if (Array.isArray(file.listings))
      tx.objectStore("meta").put({ id: "listings", listings: prepared.listings });
    if (Array.isArray(file.loans))
      tx.objectStore("meta").put({ id: "loans", loans: prepared.loans });
    if (Array.isArray(file.sheets))
      tx.objectStore("meta").put({ id: "sheets", sheets: prepared.sheets });
    tx.objectStore("meta").put({ id: "chat", notes: prepared.notes });
    tx.objectStore("meta").put({ id: "handouts", handouts: prepared.handouts });
    tx.objectStore("meta").put({ id: "journal", value: prepared.journal });
    const lock = prepared.lock;
    if (lock) tx.objectStore("meta").put({ id: "seatLock", ...lock });
    else tx.objectStore("meta").delete("seatLock");
    tx.objectStore("meta").put({ id: "seeded" });
    tx.objectStore("meta").put({ id: "catalogSeeded" });
    if (file.campaignRecovery !== undefined)
      tx.objectStore("meta").put({ id: "campaignRecovery", value: file.campaignRecovery });
    tx.objectStore("meta").put({ id: "recoveryDiagnostics", value: file.recoveryDiagnostics ?? [] });
    await done;
  } catch (error) {
    try { tx.abort(); } catch { /* It may already have aborted. */ }
    await done.catch(() => undefined);
    throw error;
  }
}

export function blankPurse(kind: Purse["kind"]): Purse {
  return {
    id: crypto.randomUUID(),
    name: kind === "party" ? "New account" : "New character",
    kind,
    control: kind === "character" ? "player" : undefined,
    coins: emptyCoins(),
    ...(kind === "character"
      ? { sheet: statsOnly({ ...blankSheet(), name: "New character" }), sheetRevision: 0 }
      : {}),
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

// Enqueue every request before yielding: financial rows and their metadata must
// describe the same committed state, including during another tab's save.
function readCampaignMetadata(tx: IDBTransaction, includeReferences = true) {
  const meta = tx.objectStore("meta");
  return Promise.all([
    request<Partial<RealmSettings> | undefined>(meta.get("settings")),
    request(meta.get("listings")), request(meta.get("loans")),
    request(meta.get("sheets")),
    includeReferences ? request(meta.get("chat")) : Promise.resolve([]),
    includeReferences ? request(meta.get("handouts")) : Promise.resolve([]),
    request<{ value: unknown } | undefined>(meta.get("journal")),
  ]).then(([realm, listings, loans, sheets, notes, handouts, journal]) => ({
    realm: clampRealm(realm), listings: readListings(listings), loans: readLoans(loans),
    sheets: readSheets(sheets), notes: readNotes(notes), handouts: readHandouts(handouts),
    journal: readJournal(journal?.value),
  }));
}

function readEconomyTransaction(tx: IDBTransaction, includeReferences = true): Promise<CloudTable & { realm: RealmSettings; journal: Journal }> {
  return Promise.all([
    request<Purse[]>(tx.objectStore("purses").getAll()),
    request<Holding[]>(tx.objectStore("holdings").getAll()),
    request<Shop[]>(tx.objectStore("shops").getAll()),
    request<StockLine[]>(tx.objectStore("stock").getAll()),
    request<LedgerLine[]>(tx.objectStore("ledger").getAll()),
    readCampaignMetadata(tx, includeReferences),
  ]).then(([purses, holdings, shops, stock, ledger, metadata]) => ({
    purses, holdings, shops: shops.map(normalizeShop), stock: stock.map(normalizeStock),
    ledger, ...metadata,
  }));
}

export async function economySnapshot(): Promise<CloudTable> {
  const db = await quireDb();
  const tx = db.transaction([...ECONOMY], "readonly");
  const [table] = await Promise.all([readEconomyTransaction(tx), finish(tx)]);
  return table;
}

/** One coherent read for all financial views, without copying private books. */
export async function economyView() {
  const db = await quireDb();
  const tx = db.transaction([...ECONOMY, "catalog", "lexicon"], "readonly");
  const [table, catalog, lexicon] = await Promise.all([
    readEconomyTransaction(tx, false),
    request<CatalogItem[]>(tx.objectStore("catalog").getAll()),
    request<Lexeme[]>(tx.objectStore("lexicon").getAll()),
    finish(tx),
  ]);
  return {
    ...table,
    ledger: table.ledger.sort((a, b) => b.at - a.at),
    catalog: catalog.sort((a, b) => a.name.localeCompare(b.name)),
    lexicon: lexicon.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function applyCloudTable(table: CloudTable): Promise<void> {
  const next = readCloudTable(table);
  if (!next) throw new Error("That table could not be read.");
  const db = await quireDb();
  const tx = db.transaction(
    ["purses", "holdings", "shops", "stock", "ledger", "meta"],
    "readwrite",
  );
  const done = finish(tx);
  tx.objectStore("meta").put({ id: "seeded" });
  for (const store of ["purses", "holdings", "shops", "stock", "ledger"] as const)
    tx.objectStore(store).clear();
  for (const purse of next.purses) tx.objectStore("purses").put(purse);
  for (const holding of next.holdings) tx.objectStore("holdings").put(holding);
  for (const shop of next.shops) tx.objectStore("shops").put(normalizeShop(shop));
  for (const line of next.stock) tx.objectStore("stock").put(normalizeStock(line));
  for (const entry of next.ledger) tx.objectStore("ledger").put(entry);
  if (next.realm) tx.objectStore("meta").put({ id: "settings", ...clampRealm(next.realm) });
  tx.objectStore("meta").put({ id: "listings", listings: next.listings });
  tx.objectStore("meta").put({ id: "loans", loans: next.loans });
  tx.objectStore("meta").put({ id: "sheets", sheets: next.sheets });
  tx.objectStore("meta").put({ id: "handouts", handouts: next.handouts ?? [] });
  tx.objectStore("meta").put({ id: "journal", value: readJournal(next.journal) });
  await done;
  await replaceNotes(next.notes);
  await refreshChat();
}

async function audit(
  tx: IDBTransaction,
  summary: string,
  kind: "prices" | "management",
  purseId?: string,
  change?: Journal["events"][number]["change"],
) {
  const store = tx.objectStore("meta");
  const row = await request<{ value: unknown } | undefined>(store.get("journal"));
  const journal = readJournal(row?.value);
  journal.events.push({
    id: crypto.randomUUID(),
    at: Date.now(),
    summary,
    kind,
    ...(purseId ? { purseId } : {}),
    ...(change ? { change } : {}),
  });
  store.put({ id: "journal", value: journal });
}

/** Execute a local command against the latest campaign under one write lock. */
export async function executeLocalCommand(input: CommandInput): Promise<void> {
  let changedChat = false;
  await atomic([...ECONOMY], async (tx) => {
    const source = await readEconomyTransaction(tx);
    const seat = getSeat();
    const next = applyCommand(
      source,
      {
        id: "local",
        token: "",
        name: "Local",
        role: seat.role,
        purseIds: seat.purseIds,
      },
      { ...input, id: crypto.randomUUID() },
    );
    for (const store of ["purses", "holdings", "shops", "stock", "ledger"] as const) {
      const prior = new Map(source[store].map((row) => [row.id, JSON.stringify(row)]));
      const retained = new Set(next[store].map((row) => row.id));
      for (const row of next[store]) {
        if (prior.get(row.id) !== JSON.stringify(row)) tx.objectStore(store).put(row);
      }
      for (const id of prior.keys()) if (!retained.has(id)) tx.objectStore(store).delete(id);
    }
    const meta = tx.objectStore("meta");
    if (JSON.stringify(source.realm) !== JSON.stringify(next.realm))
      meta.put({ id: "settings", ...clampRealm(next.realm) });
    for (const id of ["listings", "loans", "sheets", "handouts"] as const) {
      if (JSON.stringify(source[id]) !== JSON.stringify(next[id])) meta.put({ id, [id]: next[id] });
    }
    if (JSON.stringify(source.journal) !== JSON.stringify(next.journal))
      meta.put({ id: "journal", value: next.journal });
    changedChat = JSON.stringify(source.notes) !== JSON.stringify(next.notes);
    if (changedChat) meta.put({ id: "chat", notes: next.notes });
  });
  if (changedChat) await refreshChat();
}

/** Read, calculate and commit campaign finances under one IndexedDB write lock. */
export async function executeFinanceCommand(input: CommandInput): Promise<void> {
  if (!(
    input.kind.startsWith("finance-") ||
    input.kind === "shop-schedule" || input.kind === "property-plan" || input.kind === "property-details" || input.kind === "bank-repay" ||
    input.kind.startsWith("downtime-") ||
    input.kind === "session"
  ))
    throw Error("Not a finance command.");
  const market = input.kind === "shop-schedule" || input.kind === "downtime-plan" || input.kind === "session";
  const stores: Parameters<typeof atomic>[0] = ["purses", "holdings", "ledger", "meta"];
  if (market) stores.push("shops", "stock");
  await atomic(stores, async (tx) => {
    const source: CloudTable = market ? await readEconomyTransaction(tx, input.kind === "session") : await Promise.all([
      request<Purse[]>(tx.objectStore("purses").getAll()),
      request<Holding[]>(tx.objectStore("holdings").getAll()),
      request<LedgerLine[]>(tx.objectStore("ledger").getAll()),
      readCampaignMetadata(tx, false),
    ]).then(([purses, holdings, ledger, metadata]) => ({ purses, holdings, ledger, shops: [], stock: [], ...metadata }));
    const seat = getSeat();
    const next = applyCommand(source,
      { id: "local", token: "", name: "Local", role: seat.role, purseIds: seat.purseIds },
      { ...input, id: crypto.randomUUID() },
    );
    const priorShops = new Map(source.shops.map((s) => [s.id, JSON.stringify(s)]));
    const priorStock = new Map(source.stock.map((s) => [s.id, s.quantity]));
    for (const shop of next.shops) if (priorShops.get(shop.id) !== JSON.stringify(shop)) tx.objectStore("shops").put(shop);
    for (const line of next.stock) if (priorStock.get(line.id) !== line.quantity) tx.objectStore("stock").put(line);
    for (const p of next.purses) tx.objectStore("purses").put(p);
    if (input.kind === "property-details") for (const h of next.holdings) tx.objectStore("holdings").put(h);
    if (input.kind === "session") {
      tx.objectStore("ledger").clear();
      tx.objectStore("meta").put({ id: "chat", notes: next.notes });
    }
    for (const l of next.ledger) tx.objectStore("ledger").put(l);
    tx.objectStore("meta").put({ id: "journal", value: next.journal });
  });
  if (input.kind === "session") await refreshChat();
}
