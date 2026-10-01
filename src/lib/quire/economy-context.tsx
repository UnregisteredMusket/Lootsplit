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
  addListing,
  removeListing,
  buyListing,
  askLoan,
  decideLoan as answerLoan,
  importCharacterSheet,
  updateCharacterSheet,
  voidLedgerLine,
  setCoins,
  giveToPlayer,
  snapshot,
  applyBill,
  applyTable,
  applySeatLink,
  type QuireFile,
} from "./economy.ts";
import { subscribeCampaigns } from "./campaigns.ts";
import { getCloudWatch, pushCloudChange, subscribeCloudWatch } from "./cloud-turn.ts";
import { resumeTable } from "./cloud-client.ts";
import { loadNotes } from "./chat.ts";
import { primeNotices } from "./notify.ts";
import { forgetGifts, loadGifts } from "./gift.ts";
import { forgetSales, loadListings, loadLoans, loadSales } from "./market.ts";
import { loadSheets } from "./sheet.ts";
import type { CharacterSheet } from "./sheet.ts";
import type { Listing, LoanAsk, LoanStatus } from "./market.ts";
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
  give: (input: { fromId: string; toId: string; copper: number; holdingId: string | null; quantity: number }) => Promise<void>;
  listings: Listing[];
  loans: LoanAsk[];
  addListing: (input: { name: string; kind: Listing["kind"]; copper: number; quantity: number | null; notes: string }) => Promise<void>;
  removeListing: (id: string) => Promise<void>;
  buyListing: (listingId: string, purseId: string, quantity: number) => Promise<void>;
  askLoan: (purseId: string, copper: number, note: string) => Promise<void>;
  decideLoan: (id: string, status: LoanStatus) => Promise<void>;
  sheets: CharacterSheet[];
  importSheet: (purseId: string, file: File) => Promise<void>;
  updateSheet: (sheet: CharacterSheet) => Promise<void>;
  voidLine: (id: string) => Promise<void>;
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
  const [listings, setListings] = useState<Listing[]>([]);
  const [loans, setLoans] = useState<LoanAsk[]>([]);
  const [sheets, setSheets] = useState<CharacterSheet[]>([]);

  const reload = useCallback(async () => {
    await ensureEconomy();
    const [nextPurses, nextHoldings, nextShops, nextStock, nextLedger, nextCatalog, nextLexicon, nextRealm, nextListings, nextLoans, nextSheets] = await Promise.all([
      listPurses(),
      listHoldings(),
      listShops(),
      listStock(),
      listLedger(),
      listCatalog(),
      listLexicon(),
      loadRealm(),
      loadListings(),
      loadLoans(),
      loadSheets(),
    ]);
    setPurses(nextPurses.sort((a, b) => a.name.localeCompare(b.name)));
    setHoldings(nextHoldings.sort((a, b) => a.name.localeCompare(b.name)));
    setShops(nextShops.sort((a, b) => a.name.localeCompare(b.name)));
    setStock(nextStock.sort((a, b) => a.name.localeCompare(b.name)));
    setLedger(nextLedger);
    setCatalog(nextCatalog);
    setLexicon(nextLexicon);
    setRealmState(nextRealm);
    setListings(nextListings);
    setLoans(nextLoans);
    setSheets(nextSheets);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureEconomy();
        try {
          const opened = await applySeatLink();
          if (cancelled) return;
          if (opened === "player") toast.success("This phone is a player.");
          if (opened === "dm") toast.success("This phone is the dungeon master.");
        } catch (error) {
          if (!cancelled) fault(error, "That link could not be opened.");
        }
        if (!cancelled) await reload();
      } catch (error) {
        if (!cancelled) fault(error, "The ledger on this device could not be opened.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    void loadNotes()
      .then((notes) => primeNotices(notes.map((note) => note.id)))
      .catch(() => primeNotices([]))
      .finally(() => resumeTable());
  }, []);

  useEffect(() => subscribeCloudWatch(() => { void reload(); }), [reload]);

  useEffect(() => subscribeCampaigns(() => {
    setReady(false);
    void reload();
  }), [reload]);

  const run = useCallback(
    async (work: () => Promise<unknown>, ok?: string) => {
      const gate = getCloudWatch();
      if (gate.joined && !gate.mine) {
        toast.error(`It is ${gate.who}'s turn.`);
        return;
      }
      try {
        await work();
        await reload();
        if (ok) toast.success(ok);
        pushCloudChange();
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
      listings,
      loans,
      sheets,
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
      give: (input) => run(async () => { ownPurse(input.fromId); await giveToPlayer(input); }, "Given. The party chat has it."),
      addListing: (input) => run(async () => { dmOnly(); await addListing(input); }, "Listing posted."),
      removeListing: (id) => run(async () => { dmOnly(); await removeListing(id); }, "Listing removed."),
      buyListing: (listingId, purseId, quantity) => run(async () => { ownPurse(purseId); await buyListing({ listingId, purseId, quantity }); }, "Purchase recorded."),
      askLoan: (purseId, copper, note) => run(async () => { ownPurse(purseId); await askLoan({ purseId, copper, note }); }, "Loan requested."),
      decideLoan: (id, status) => run(async () => { dmOnly(); await answerLoan(id, status); }, status === "approved" ? "Loan approved." : "Loan denied."),
      importSheet: async (purseId, file) => {
        ownPurse(purseId);
        const gaps = await importCharacterSheet(purseId, file);
        await reload();
        toast.success(gaps.length > 0 ? `Imported. Still blank: ${gaps.join(", ")}.` : "Character sheet imported.");
      },
      updateSheet: (sheet) => run(async () => { ownPurse(sheet.purseId); await updateCharacterSheet(sheet); }),
      voidLine: (id) => run(async () => { dmOnly(); await voidLedgerLine(id); }, "That line was voided."),
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
        const file = await snapshot();
        const gifts = await loadGifts();
        const loansOnPhone = await loadLoans();
        const sales = await loadSales();
        const bill = buildBill({ ...file, notes: await loadNotes(), gifts, loans: loansOnPhone, sales, sheets: await loadSheets() }, sitting);
        downloadJson(`lootsplit-bill-${new Date().toISOString().slice(0, 10)}.json`, bill);
        await forgetGifts(bill.gifts?.map((gift) => gift.id) ?? []);
        await forgetSales(bill.sales?.map((sale) => sale.id) ?? []);
      },
    };
  },
    [ready, purses, holdings, shops, stock, ledger, catalog, lexicon, realm, listings, loans, sheets, reload, run],
  );

  return <EconomyContext.Provider value={api}>{children}</EconomyContext.Provider>;
}

export function useEconomy() {
  const value = useContext(EconomyContext);
  if (!value) throw new Error("Ledger is unavailable.");
  return value;
}
