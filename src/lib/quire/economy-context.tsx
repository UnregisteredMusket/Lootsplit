import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  addCatalogRows,
  addLexemeRows,
  addPricedStock,
  blankPurse,
  blankShop,
  buyFromShop,
  ensureEconomy,
  inventGoods,
  listCatalog,
  listHoldings,
  listLedger,
  listLexicon,
  listPurses,
  listShops,
  listStock,
  loadRealm,
  openComposedShop,
  postCopper,
  readQuireFile,
  removeCatalog,
  removeHolding,
  removeLexeme,
  removePurse,
  removeShop,
  removeStock,
  repriceAllShops,
  repriceShop,
  resetToDefault,
  restore,
  restoreStarterGoods,
  saveCatalog,
  saveHolding,
  savePurse,
  saveRealm,
  saveShop,
  saveStock,
  sellToShop,
  setCoins,
  snapshot,
  applyBill,
  applyTable,
  applySeatLink,
  type QuireFile,
} from "./economy.ts";
import { subscribeCampaigns } from "./campaigns.ts";
import { presentReceipt } from "./receipt.ts";
import { DM_SEAT, buildBill, downloadJson, getSeat, readShare, setSeat } from "./table.ts";
import type { RarityFlags, ShelfDraft } from "./compose.ts";
import { DEFAULT_REALM } from "./scale.ts";
import type { CatalogItem, Coins, Holding, ItemCategory, LedgerLine, Lexeme, Purse, RealmSettings, Shop, ShopCategory, StockLine, Wealth } from "./types.ts";

type EconomyApi = {
  ready: boolean;
  purses: Purse[];
  holdings: Holding[];
  shops: Shop[];
  stock: StockLine[];
  ledger: LedgerLine[];
  catalog: CatalogItem[];
  lexicon: Lexeme[];
  realm: RealmSettings;
  reload: () => Promise<void>;
  createShop: (shop?: Partial<Shop>) => Promise<string>;
  updateShop: (shop: Shop) => Promise<void>;
  applyShop: (shop: Shop) => Promise<void>;
  deleteShop: (id: string) => Promise<void>;
  updateStock: (line: StockLine) => Promise<void>;
  addStock: (shopId: string, name: string, copper: number, quantity: number | null) => Promise<void>;
  deleteStock: (id: string) => Promise<void>;
  stockFromPrices: (shopId: string, rows: Array<{ name: string; copper: number; notes: string }>) => Promise<number>;
  openShelf: (input: {
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
  }) => Promise<string>;
  createPurse: (kind: Purse["kind"]) => Promise<void>;
  updatePurse: (purse: Purse) => Promise<void>;
  deletePurse: (id: string) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  addHolding: (purseId: string, name: string, kind: Holding["kind"], quantity: number, unitCopper: number) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  buy: (stockId: string, purseId: string, quantity: number) => Promise<void>;
  sell: (holdingId: string, shopId: string, quantity: number) => Promise<void>;
  setPurseCoins: (purseId: string, coins: Coins) => Promise<void>;
  post: (purseId: string, copper: number, summary: string) => Promise<void>;
  setRealm: (settings: RealmSettings, options?: { reprice?: boolean }) => Promise<void>;
  addGoods: (rows: CatalogItem[]) => Promise<number>;
  saveGood: (item: CatalogItem) => Promise<void>;
  deleteGood: (id: string) => Promise<void>;
  invent: (category: ItemCategory, flags: RarityFlags, count: number) => Promise<number>;
  restoreGoods: () => Promise<void>;
  addNames: (rows: Array<Omit<Lexeme, "id">>) => Promise<number>;
  deleteName: (id: string) => Promise<void>;
  download: () => Promise<void>;
  restoreFile: (file: File) => Promise<void>;
  resetAll: () => Promise<void>;
  openCounter: (file: File) => Promise<void>;
  takeBill: (file: File) => Promise<number>;
  sendBill: () => Promise<void>;
};

const EconomyContext = createContext<EconomyApi | null>(null);

function fault(error: unknown, fallback: string) {
  toast.error(error instanceof Error ? error.message : fallback);
}

export function EconomyProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [purses, setPurses] = useState<Purse[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [stock, setStock] = useState<StockLine[]>([]);
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [lexicon, setLexicon] = useState<Lexeme[]>([]);
  const [realm, setRealmState] = useState<RealmSettings>(DEFAULT_REALM);

  const reload = useCallback(async () => {
    await ensureEconomy();
    const [nextPurses, nextHoldings, nextShops, nextStock, nextLedger, nextCatalog, nextLexicon, nextRealm] = await Promise.all([
      listPurses(),
      listHoldings(),
      listShops(),
      listStock(),
      listLedger(),
      listCatalog(),
      listLexicon(),
      loadRealm(),
    ]);
    setPurses(nextPurses.sort((a, b) => a.name.localeCompare(b.name)));
    setHoldings(nextHoldings.sort((a, b) => a.name.localeCompare(b.name)));
    setShops(nextShops.sort((a, b) => a.name.localeCompare(b.name)));
    setStock(nextStock.sort((a, b) => a.name.localeCompare(b.name)));
    setLedger(nextLedger);
    setCatalog(nextCatalog);
    setLexicon(nextLexicon);
    setRealmState(nextRealm);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureEconomy();
        const opened = await applySeatLink();
        if (cancelled) return;
        if (opened === "player") toast.success("This phone is a player.");
        if (opened === "dm") toast.success("This phone is the dungeon master.");
        await reload();
      } catch (error) {
        if (!cancelled) fault(error, "The ledger on this device could not be opened.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => subscribeCampaigns(() => {
    setReady(false);
    void reload();
  }), [reload]);

  const run = useCallback(
    async (work: () => Promise<unknown>, ok?: string) => {
      try {
        await work();
        await reload();
        if (ok) toast.success(ok);
      } catch (error) {
        fault(error, "That change could not be saved.");
      }
    },
    [reload],
  );

  const api = useMemo<EconomyApi>(() => {
    const dmOnly = () => {
      if (getSeat().role === "player") throw new Error("The dungeon master keeps that.");
    };
    const ownPurse = (purseId: string) => {
      const sitting = getSeat();
      if (sitting.role === "player" && !sitting.purseIds.includes(purseId)) throw new Error("That character is not yours at this table.");
    };
    const ownShop = (shopId: string) => {
      const sitting = getSeat();
      if (sitting.role === "player" && !sitting.shopIds.includes(shopId)) throw new Error("That shop was not included in your link.");
    };
    return {
      ready,
      purses,
      holdings,
      shops,
      stock,
      ledger,
      catalog,
      lexicon,
      realm,
      reload,
      createShop: async (partial) => {
        dmOnly();
        const shop = { ...blankShop(), ...partial, id: crypto.randomUUID() };
        await saveShop(shop);
        await reload();
        return shop.id;
      },
      updateShop: (shop) => run(async () => { dmOnly(); await saveShop(shop); }),
      applyShop: (shop) => run(async () => { dmOnly(); await repriceShop(shop); }, "Shelf repriced."),
      deleteShop: (id) => run(async () => { dmOnly(); await removeShop(id); }, "Shop removed."),
      updateStock: (line) => run(async () => { dmOnly(); await saveStock(line); }),
      addStock: (shopId, name, copper, quantity) =>
        run(async () => {
          dmOnly();
          await saveStock({
            id: crypto.randomUUID(),
            shopId,
            name,
            copper,
            quantity,
            notes: "",
            baseCopper: copper,
            rarity: "common",
          });
        }, "Good added."),
      deleteStock: (id) => run(async () => { dmOnly(); await removeStock(id); }),
      stockFromPrices: async (shopId, rows) => {
        dmOnly();
        const added = await addPricedStock(shopId, rows);
        await reload();
        return added;
      },
      openShelf: async (input) => {
        dmOnly();
        const id = await openComposedShop(input);
        await reload();
        return id;
      },
      createPurse: (kind) => run(async () => { dmOnly(); await savePurse(blankPurse(kind)); }, "Purse added."),
      updatePurse: (purse) => run(async () => { ownPurse(purse.id); await savePurse(purse); }),
      deletePurse: (id) => run(async () => { dmOnly(); await removePurse(id); }, "Purse removed."),
      updateHolding: (holding) => run(async () => { ownPurse(holding.purseId); await saveHolding(holding); }),
      addHolding: (purseId, name, kind, quantity, unitCopper) =>
        run(async () => {
          ownPurse(purseId);
          await saveHolding({ id: crypto.randomUUID(), purseId, name, kind, quantity, unitCopper, notes: "" });
        }, "Holding added."),
      deleteHolding: (id) =>
        run(async () => {
          dmOnly();
          await removeHolding(id);
        }),
      buy: (stockId, purseId, quantity) =>
        run(async () => {
          ownPurse(purseId);
          const line = stock.find((item) => item.id === stockId);
          if (line) ownShop(line.shopId);
          await buyFromShop({ stockId, purseId, quantity });
        }, "Purchase recorded."),
      sell: (holdingId, shopId, quantity) =>
        run(async () => {
          ownShop(shopId);
          const holding = holdings.find((item) => item.id === holdingId);
          if (holding) ownPurse(holding.purseId);
          await sellToShop({ holdingId, shopId, quantity });
        }, "Sale recorded."),
      setPurseCoins: (purseId, coins) => run(async () => { ownPurse(purseId); await setCoins(purseId, coins); }, "Coin updated."),
      post: (purseId, copper, summary) => run(async () => { ownPurse(purseId); await postCopper(purseId, copper, summary); }, "Ledger updated."),
      setRealm: (settings, options) =>
        run(async () => {
          dmOnly();
          await saveRealm(settings);
          if (!options?.reprice) return;
          const count = await repriceAllShops();
          toast.success(count === 0 ? "Realm kept. No shops are open." : `Repriced ${count === 1 ? "1 shop" : `${count} shops`}.`);
        }),
      addGoods: async (rows) => {
        dmOnly();
        const added = await addCatalogRows(rows);
        await reload();
        return added;
      },
      saveGood: (item) => run(async () => { dmOnly(); await saveCatalog(item); }),
      deleteGood: (id) => run(async () => { dmOnly(); await removeCatalog(id); }),
      invent: async (category, flags, count) => {
        dmOnly();
        const added = await inventGoods({ category, flags, count, rng: Math.random });
        await reload();
        if (added === 0) toast("Nothing new to add.");
        else toast.success(`Added ${added} to the index.`);
        return added;
      },
      restoreGoods: () => run(async () => { dmOnly(); await restoreStarterGoods(); }, "Starter goods restored."),
      addNames: async (rows) => {
        dmOnly();
        const added = await addLexemeRows(rows);
        await reload();
        return added;
      },
      deleteName: (id) => run(async () => { dmOnly(); await removeLexeme(id); }),
      download: async () => {
        const file: QuireFile = await snapshot();
        const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `lootsplit-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },
      restoreFile: async (file) => {
        dmOnly();
        const parsed = readQuireFile(JSON.parse(await file.text()) as unknown);
        await restore(parsed);
        await reload();
        toast.success("Copy restored on this device.");
      },
      resetAll: async () => {
        dmOnly();
        await resetToDefault();
        setSeat(DM_SEAT);
        await reload();
      },
      openCounter: async (file) => {
        const parsed = readShare(JSON.parse(await file.text()) as unknown);
        if (parsed.kind !== "quire-table") throw new Error("That file is a bill. Open it on the dungeon master's phone.");
        await applyTable(parsed);
        setSeat({
          role: "player",
          purseIds: parsed.purses.map((purse) => purse.id),
          shopIds: parsed.shops.map((shop) => shop.id),
          openedAt: parsed.exportedAt,
        });
        await reload();
        toast.success("This phone is a player.");
      },
      takeBill: async (file) => {
        dmOnly();
        const parsed = readShare(JSON.parse(await file.text()) as unknown);
        if (parsed.kind !== "quire-bill") throw new Error("That file is a player file, not a bill.");
        const added = await applyBill(parsed);
        presentReceipt(parsed);
        await reload();
        if (added === 0) toast("Bill taken. Nothing new was purchased.");
        return added;
      },
      sendBill: async () => {
        const sitting = getSeat();
        if (sitting.role !== "player") throw new Error("A bill is sent from the player's phone.");
        downloadJson(`lootsplit-bill-${new Date().toISOString().slice(0, 10)}.json`, buildBill(await snapshot(), sitting));
      },
    };
  },
    [ready, purses, holdings, shops, stock, ledger, catalog, lexicon, realm, reload, run],
  );

  return <EconomyContext.Provider value={api}>{children}</EconomyContext.Provider>;
}

export function useEconomy() {
  const value = useContext(EconomyContext);
  if (!value) throw new Error("Ledger is unavailable.");
  return value;
}
