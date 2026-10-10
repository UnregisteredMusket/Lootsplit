import {
  captureMutationScope,
  assertMutationScope,
  type ExpectedMutationScope,
} from "./cloud-client.ts";
import {
  acceptedMutation,
  mutationNotice,
  type EconomyMutationOutcome,
} from "./mutation-outcome.ts";
import { playSound } from "./sound.ts";
import { rememberSave, listSaves } from "./saves.ts";
import { subscribeSheetChanges, readPartySheetLinks } from "./party-sheet-links.ts";
import { type Journal } from "./journal.ts";
import { type CommandInput } from "./commands.ts";
import { canonicalJson } from "./canonical-json.ts";
import { economyView, executeLocalCommand, executeFinanceCommand } from "./economy.ts";
import { loadSeatLock, passwordMatches } from "./lock.ts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  addCatalogRows,
  addLexemeRows,
  addPricedStock,
  addShelfStock,
  blankPurse,
  blankShop,
  buyFromShop,
  ensureEconomy,
  inventGoods,
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
  updatePurseMetadata,
  bindCampaignProfile,
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
  setCoins,
  giveToPlayer,
  snapshot,
  applyBill,
  applyTable,
  applySeatLink,
  type QuireFile,
} from "./economy.ts";
import { subscribeCampaigns } from "./campaigns.ts";
import { getCloudWatch, subscribeCloudWatch } from "./cloud-turn.ts";
import {
  captureDeviceBackup,
  resumeTable,
  queueCommand,
  runSharedMutation,
  hasPendingChanges,
} from "./cloud-client.ts";
import { loadNotes } from "./chat.ts";
import { primeNotices } from "./notify.ts";
import { loadGifts } from "./gift.ts";
import { loadLoans, loadSales } from "./market.ts";
import { loadSheets } from "./sheet.ts";
import type { CharacterSheet } from "./sheet.ts";
import type { Listing, LoanAsk, LoanStatus } from "./market.ts";
import { presentReceipt } from "./receipt.ts";
import { DM_SEAT, buildBill, downloadJson, getSeat, readShare, setSeat } from "./table.ts";
import type { RarityFlags, ShelfDraft } from "./compose.ts";
import { DEFAULT_REALM } from "./scale.ts";
import type {
  CatalogItem,
  Coins,
  Holding,
  ItemCategory,
  LedgerLine,
  Lexeme,
  Purse,
  RealmSettings,
  Shop,
  ShopCategory,
  StockLine,
  Wealth,
} from "./types.ts";

type EconomyApi = {
  journal: Journal;
  command: (input: CommandInput) => Promise<void>;
  commandOutcome: (
    input: CommandInput,
    expected?: import("./cloud-client.ts").ExpectedMutationScope,
  ) => Promise<EconomyMutationOutcome>;
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
  addStock: (
    shopId: string,
    name: string,
    copper: number,
    quantity: number | null,
  ) => Promise<EconomyMutationOutcome>;
  deleteStock: (id: string) => Promise<void>;
  addCatalogStock: (shopId: string, rows: ShelfDraft[]) => Promise<number>;
  stockFromPrices: (
    shopId: string,
    rows: Array<{ name: string; copper: number; notes: string }>,
  ) => Promise<number>;
  openShelf: (input: {
    locationId?: string;
    image?: string;
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
  openShelfOutcome: (
    input: Parameters<EconomyApi["openShelf"]>[0],
  ) => Promise<{ id: string } & EconomyMutationOutcome>;
  createPurse: (kind: Purse["kind"]) => Promise<void>;
  updatePurse: (purse: Purse) => Promise<void>;
  deletePurse: (id: string) => Promise<void>;
  updateHolding: (holding: Holding) => Promise<void>;
  addHolding: (
    purseId: string,
    name: string,
    kind: Holding["kind"],
    quantity: number,
    unitCopper: number,
    metadata?: Pick<Holding, "notes" | "category">,
  ) => Promise<void>;
  deleteHolding: (id: string) => Promise<void>;
  buy: (stockId: string, purseId: string, quantity: number) => Promise<EconomyMutationOutcome>;
  sell: (holdingId: string, shopId: string, quantity: number) => Promise<EconomyMutationOutcome>;
  setPurseCoins: (purseId: string, coins: Coins) => Promise<void>;
  post: (purseId: string, copper: number, summary: string) => Promise<void>;
  give: (input: {
    fromId: string;
    toId: string;
    copper: number;
    holdingId: string | null;
    quantity: number;
  }) => Promise<void>;
  listings: Listing[];
  loans: LoanAsk[];
  addListing: (input: {
    name: string;
    kind: Listing["kind"];
    copper: number;
    quantity: number | null;
    notes: string;
  }) => Promise<EconomyMutationOutcome>;
  removeListing: (id: string) => Promise<void>;
  buyListing: (
    listingId: string,
    purseId: string,
    quantity: number,
  ) => Promise<EconomyMutationOutcome>;
  askLoan: (purseId: string, copper: number, note: string) => Promise<EconomyMutationOutcome>;
  decideLoan: (id: string, status: LoanStatus) => Promise<void>;
  sheets: CharacterSheet[];
  importSheet: (purseId: string, file: File) => Promise<void>;
  updateSheet: (sheet: CharacterSheet, before?: CharacterSheet) => Promise<void>;
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
  restoreFile: (file: File, password?: string) => Promise<void>;
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
  const [journal, setJournal] = useState<Journal>({ sessions: [], requests: [], events: [] });
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

  const reloadSequence = useRef(0);
  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    const campaignKey = localStorage.getItem("quire.campaign.v1");
    await ensureEconomy();
    // A once-per-campaign safety copy. Never bypass an existing password-protected-save policy.
    if (
      !getCloudWatch().joined &&
      getSeat().role === "dm" &&
      !(await loadSeatLock())?.protectSaves
    ) {
      const campaignId = localStorage.getItem("quire.campaign.v1") || "main";
      const marker = `lootsplit.before-illustrated.${campaignId}`;
      if (!localStorage.getItem(marker)) {
        const name = "Before illustrated UI update";
        if (!(await listSaves(campaignId)).some((s) => s.name === name))
          await rememberSave({ name, campaignId, file: await snapshot() });
        localStorage.setItem(marker, "1");
      }
    }
    const {
      purses: nextPurses,
      holdings: nextHoldings,
      shops: nextShops,
      stock: nextStock,
      ledger: nextLedger,
      catalog: nextCatalog,
      lexicon: nextLexicon,
      realm: nextRealm,
      listings: nextListings,
      loans: nextLoans,
      sheets: nextSheets,
      journal: nextJournal,
    } = await economyView();
    if (
      sequence !== reloadSequence.current ||
      campaignKey !== localStorage.getItem("quire.campaign.v1")
    )
      return;
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
    setJournal(nextJournal);
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
          if (opened === "player") toast.success("Player mode enabled.");
          if (opened === "dm" || opened === "bill") toast.success("Player activity imported.");
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

  useEffect(
    () =>
      subscribeCloudWatch(() => {
        void reload();
      }),
    [reload],
  );
  useEffect(
    () =>
      subscribeSheetChanges(() => {
        void reload();
      }),
    [reload],
  );
  useEffect(() => {
    let cancelled = false;
    const campaignId = localStorage.getItem("quire.campaign.v1") || "main";
    if (
      !ready ||
      getCloudWatch().joined ||
      getSeat().role !== "dm" ||
      !purses.some((p) => p.kind === "character" && !p.nonParty && !p.sheet)
    )
      return;
    void import("../account/client")
      .then(async ({ accountRequest }) => {
        const own = await accountRequest<{
          userId: string;
          characters: {
            id: string;
            campaign_code: string;
            body: import("../characters/model.mjs").PlaySheet;
          }[];
        }>("sheets");
        if (
          cancelled ||
          getCloudWatch().joined ||
          (localStorage.getItem("quire.campaign.v1") || "main") !== campaignId
        )
          return;
        let changed = false;
        for (const link of readPartySheetLinks(own.userId, campaignId)) {
          const profile = own.characters.find((r) => r.id === link.sheetId && !r.campaign_code);
          if (profile && purses.some((p) => p.id === link.purseId && !p.sheet)) {
            await bindCampaignProfile(link.purseId, profile.id, profile.body, true);
            changed = true;
          }
        }
        if (changed && !cancelled) await reload();
      })
      .catch(() => {
        /* Guest campaigns already have complete local sheets; account profiles remain untouched. */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, purses, reload]);

  useEffect(
    () =>
      subscribeCampaigns(() => {
        setReady(false);
        void reload();
      }),
    [reload],
  );

  const run = useCallback(
    async (work: () => Promise<unknown>, ok?: string, rethrow = false) => {
      const gate = getCloudWatch();
      if (gate.joined && !gate.mine) {
        if (rethrow) throw new Error(`It is ${gate.who}'s turn.`);
        toast.error(`It is ${gate.who}'s turn.`);
        return;
      }
      try {
        if (gate.joined) await runSharedMutation(work);
        else await work();
        await reload();
        if (
          ok &&
          !hasPendingChanges() &&
          [
            "Purchase recorded.",
            "Sale recorded.",
            "Coin updated.",
            "Ledger updated.",
            "Transfer recorded and added to party messages.",
          ].includes(ok)
        )
          void playSound("coins");
        if (ok)
          toast.success(
            gate.joined && hasPendingChanges() ? "Action saved as pending. Check sync status." : ok,
          );
      } catch (error) {
        if (rethrow) throw error;
        fault(error, "That change could not be saved.");
      }
    },
    [reload],
  );

  const api = useMemo<EconomyApi>(() => {
    const dmOnly = () => {
      if (getSeat().role === "player") throw new Error("Only the DM can change this setting.");
    };
    const ownPurse = (purseId: string) => {
      const sitting = getSeat();
      if (sitting.role === "player" && !sitting.purseIds.includes(purseId))
        throw new Error("That character is not yours at this table.");
    };
    const ownShop = (shopId: string) => {
      const sitting = getSeat();
      if (sitting.role === "player" && !sitting.shopIds.includes(shopId))
        throw new Error("That shop was not included in your link.");
    };
    const shared = async (command: import("./commands.ts").CommandInput) => {
      try {
        await queueCommand(command);
        await reload();
        if (!hasPendingChanges() && ["buy", "sell", "listing", "give"].includes(command.kind))
          void playSound("coins");
      } catch (error) {
        fault(error, "Action failed. Check sync status.");
      }
    };
    const refreshAccepted = async () => {
      await reload().catch(() =>
        toast.error(
          "Action accepted, but this view could not refresh. Check sync before repeating it.",
        ),
      );
    };
    const accept = async (
      work: (assertScope: () => void) => Promise<unknown>,
      ok?: string,
    ): Promise<EconomyMutationOutcome> => {
      const invoked = captureMutationScope();
      const guard = () => assertMutationScope(invoked);
      guard();
      const gate = getCloudWatch();
      if (gate.joined && !gate.mine) throw new Error(`It is ${gate.who}'s turn.`);
      const outcome =
        invoked.code !== "device"
          ? await runSharedMutation(() => work(guard), invoked)
          : await acceptedMutation(
              () => work(guard),
              () => false,
            );
      await refreshAccepted();
      if (
        outcome.status === "committed" &&
        ok &&
        ["Purchase recorded.", "Sale recorded."].includes(ok)
      )
        void playSound("coins");
      if (ok) toast.success(mutationNotice(outcome, ok));
      return outcome;
    };
    const acceptCommand = async (
      input: CommandInput,
      expected?: ExpectedMutationScope,
    ): Promise<EconomyMutationOutcome> => {
      const invoked = captureMutationScope();
      const guard = () => {
        assertMutationScope(invoked);
        if (expected) assertMutationScope(expected);
      };
      guard();
      const outcome =
        invoked.code !== "device"
          ? await queueCommand(input, expected || invoked)
          : await acceptedMutation(
              async () => {
                guard();
                if (
                  input.kind.startsWith("finance-") ||
                  [
                    "shop-schedule",
                    "property-plan",
                    "property-details",
                    "bank-repay",
                    "session",
                  ].includes(input.kind) ||
                  input.kind.startsWith("downtime-")
                )
                  await executeFinanceCommand(input, guard);
                else await executeLocalCommand(input, guard);
              },
              () => false,
            );
      await refreshAccepted();
      if (outcome.status === "committed" && ["buy", "sell", "listing"].includes(input.kind))
        void playSound("coins");
      return outcome;
    };
    const mutation = async <T,>(work: () => Promise<T>): Promise<T> => {
      if (!getCloudWatch().joined) return work();
      let result!: T;
      await runSharedMutation(async () => {
        result = await work();
      });
      return result;
    };
    return {
      journal,
      commandOutcome: acceptCommand,
      command: async (input) => {
        if (getCloudWatch().joined) {
          await queueCommand(input);
          await reload();
          return;
        }
        if (
          input.kind.startsWith("finance-") ||
          input.kind === "shop-schedule" ||
          input.kind === "property-plan" ||
          input.kind === "property-details" ||
          input.kind === "bank-repay" ||
          input.kind.startsWith("downtime-") ||
          input.kind === "session"
        ) {
          await executeFinanceCommand(input);
          await reload();
          return;
        }
        await executeLocalCommand(input);
        await reload();
      },
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
        await mutation(() => saveShop(shop));
        await reload();
        return shop.id;
      },
      updateShop: (shop) =>
        run(async () => {
          dmOnly();
          await saveShop(shop);
        }),
      applyShop: (shop) =>
        run(async () => {
          dmOnly();
          await repriceShop(shop);
        }, "Shop prices updated."),
      deleteShop: (id) =>
        run(async () => {
          dmOnly();
          await removeShop(id);
        }, "Shop removed."),
      updateStock: (line) =>
        run(async () => {
          dmOnly();
          await saveStock(line);
        }),
      addStock: (shopId, name, copper, quantity) =>
        accept(async (guard) => {
          dmOnly();
          await saveStock(
            {
              id: crypto.randomUUID(),
              shopId,
              name,
              copper,
              quantity,
              notes: "",
              baseCopper: copper,
              rarity: "common",
            },
            guard,
          );
        }, "Item added."),
      deleteStock: (id) =>
        run(async () => {
          dmOnly();
          await removeStock(id);
        }),
      addCatalogStock: async (shopId, rows) => {
        dmOnly();
        const added = await mutation(() => addShelfStock(shopId, rows));
        await reload();
        return added;
      },
      stockFromPrices: async (shopId, rows) => {
        dmOnly();
        const added = await mutation(() => addPricedStock(shopId, rows));
        await reload();
        return added;
      },
      openShelf: async (input) => {
        dmOnly();
        const id = await mutation(() => openComposedShop(input));
        await reload();
        return id;
      },
      openShelfOutcome: async (input) => {
        dmOnly();
        let id = "";
        const result = await accept(async () => {
          id = await openComposedShop(input);
        });
        return { id, ...result };
      },
      createPurse: (kind) =>
        run(async () => {
          dmOnly();
          await savePurse(blankPurse(kind));
        }, "Account created."),
      updatePurse: (purse) =>
        run(async () => {
          dmOnly();
          await updatePurseMetadata(purse);
        }),
      deletePurse: (id) =>
        run(async () => {
          dmOnly();
          await removePurse(id);
        }, "Account removed."),
      updateHolding: (holding) =>
        run(async () => {
          dmOnly();
          await saveHolding(holding);
        }),
      addHolding: (purseId, name, kind, quantity, unitCopper, metadata) =>
        run(
          async () => {
            dmOnly();
            await saveHolding({
              id: crypto.randomUUID(),
              purseId,
              name,
              kind,
              quantity,
              unitCopper,
              notes: metadata?.notes ?? "",
              ...(metadata?.category ? { category: metadata.category } : {}),
            });
          },
          "Holding added.",
          true,
        ),
      deleteHolding: (id) =>
        run(async () => {
          dmOnly();
          await removeHolding(id);
        }),
      buy: (stockId, purseId, quantity) =>
        getCloudWatch().joined
          ? acceptCommand({ kind: "buy", stockId, purseId, quantity })
          : accept(async () => {
              ownPurse(purseId);
              const line = stock.find((item) => item.id === stockId);
              if (line) ownShop(line.shopId);
              await buyFromShop({ stockId, purseId, quantity });
            }, "Purchase recorded."),
      sell: (holdingId, shopId, quantity) =>
        getCloudWatch().joined || holdings.some(h => h.id === holdingId && (h.custody || h.reservedFor || journal.propertyOperations?.sites.some(s => s.propertyId === h.id)))
          ? acceptCommand({ kind: "sell", holdingId, shopId, quantity })
          : accept(async () => {
              ownShop(shopId);
              const holding = holdings.find((item) => item.id === holdingId);
              if (holding) ownPurse(holding.purseId);
              await sellToShop({ holdingId, shopId, quantity });
            }, "Sale recorded."),
      setPurseCoins: (purseId, coins) =>
        run(async () => {
          dmOnly();
          await setCoins(purseId, coins);
        }, "Coin updated."),
      post: (purseId, copper, summary) =>
        run(async () => {
          dmOnly();
          await postCopper(purseId, copper, summary);
        }, "Ledger updated."),
      give: (input) =>
        getCloudWatch().joined
          ? shared({ kind: "give", ...input })
          : holdings.some(h => h.id === input.holdingId && (h.custody || h.reservedFor || journal.propertyOperations?.sites.some(s => s.propertyId === h.id))) ? acceptCommand({ kind: "give", ...input }).then(() => {}) : run(async () => {
              ownPurse(input.fromId);
              await giveToPlayer(input);
            }, "Transfer recorded and added to party messages."),
      addListing: (input) =>
        accept(async (guard) => {
          dmOnly();
          await addListing(input, guard);
        }, "Listing posted."),
      removeListing: (id) =>
        run(async () => {
          dmOnly();
          await removeListing(id);
        }, "Listing removed."),
      buyListing: (listingId, purseId, quantity) =>
        getCloudWatch().joined || listings.some(l => l.id === listingId && l.estateTemplateKey)
          ? acceptCommand({ kind: "listing", listingId, purseId, quantity })
          : accept(async () => {
              ownPurse(purseId);
              await buyListing({ listingId, purseId, quantity });
            }, "Purchase recorded."),
      askLoan: (purseId, copper, note) =>
        getCloudWatch().joined
          ? acceptCommand({ kind: "loan", purseId, copper, note })
          : accept(async (guard) => {
              ownPurse(purseId);
              await askLoan({ purseId, copper, note }, guard);
            }, "Loan requested."),
      decideLoan: (id, status) =>
        getCloudWatch().joined
          ? status === "pending"
            ? Promise.resolve()
            : shared({ kind: "decision", loanId: id, status })
          : run(
              async () => {
                dmOnly();
                await answerLoan(id, status);
              },
              status === "approved" ? "Loan approved." : "Loan denied.",
            ),
      importSheet: async (purseId, file) => {
        ownPurse(purseId);
        const gaps = await mutation(() => importCharacterSheet(purseId, file));
        await reload();
        toast.success(
          gaps.length > 0
            ? `Imported. Still blank: ${gaps.join(", ")}.`
            : "Character sheet imported.",
        );
      },
      updateSheet: (sheet, before) =>
        getCloudWatch().joined
          ? shared({ kind: "sheet", sheet, before })
          : run(async () => {
              ownPurse(sheet.purseId);
              await updateCharacterSheet(sheet, before);
            }),
      voidLine: async (id) => {
        try {
          dmOnly();
          const line = ledger.find(entry => entry.id === id);
          if (!line) throw new Error("That ledger line is no longer available.");
          const outcome = await acceptCommand({
            kind: "ledger-void", target: { kind: "ledger", id },
            before: canonicalJson(line), reason: "DM ledger correction.",
          });
          toast.success(mutationNotice(outcome, "That line was voided."));
        } catch (error) {
          fault(error, "That line could not be reversed.");
        }
      },
      setRealm: (settings, options) =>
        run(async () => {
          dmOnly();
          await saveRealm(settings);
          if (!options?.reprice) return;
          const count = await repriceAllShops();
          toast.success(
            count === 0
              ? "Economy settings saved. No shops to update."
              : `Repriced ${count === 1 ? "1 shop" : `${count} shops`}.`,
          );
        }),
      addGoods: async (rows) => {
        dmOnly();
        const added = await addCatalogRows(rows);
        await reload();
        return added;
      },
      saveGood: (item) =>
        run(async () => {
          dmOnly();
          await saveCatalog(item);
        }),
      deleteGood: (id) =>
        run(async () => {
          dmOnly();
          await removeCatalog(id);
        }),
      invent: async (category, flags, count) => {
        dmOnly();
        const added = await inventGoods({ category, flags, count, rng: Math.random });
        await reload();
        if (added === 0) toast("Nothing new to add.");
        else toast.success(`Added ${added} to the catalog.`);
        return added;
      },
      restoreGoods: () =>
        run(async () => {
          dmOnly();
          await restoreStarterGoods();
        }, "Starter items restored."),
      addNames: async (rows) => {
        dmOnly();
        const added = await addLexemeRows(rows);
        await reload();
        return added;
      },
      deleteName: (id) =>
        run(async () => {
          dmOnly();
          await removeLexeme(id);
        }),
      download: async () => {
        const lock = await loadSeatLock();
        if (lock?.protectSaves)
          throw new Error("Use Settings → Device backups to export with password protection.");
        const file: QuireFile = await captureDeviceBackup();
        const saved = await downloadJson(
          `lootsplit-${new Date().toISOString().slice(0, 10)}.json`,
          file,
        );
        if (!saved) throw new Error("Share was dismissed. The backup file was not saved.");
      },
      restoreFile: async (file, password) => {
        const lock = await loadSeatLock();
        if (lock?.protectSaves && (!password || !(await passwordMatches(password, lock))))
          throw new Error("Use Settings → Device backups to restore with the campaign password.");
        if (getCloudWatch().joined)
          throw new Error("Return to Local Mode before importing or replacing campaign data.");
        dmOnly();
        const parsed = readQuireFile(JSON.parse(await file.text()) as unknown);
        await restore(parsed);
        await reload();
        toast.success("Copy restored on this device.");
      },
      resetAll: async () => {
        if (getCloudWatch().joined)
          throw new Error("Return to Local Mode before importing or replacing campaign data.");
        dmOnly();
        await resetToDefault();
        setSeat(DM_SEAT);
        await reload();
      },
      openCounter: async (file) => {
        if (getCloudWatch().joined)
          throw new Error("Return to Local Mode before importing or replacing campaign data.");
        const parsed = readShare(JSON.parse(await file.text()) as unknown);
        if (parsed.kind !== "quire-table")
          throw new Error(
            "That file is an activity report. Open it on the dungeon master's device.",
          );
        await applyTable(parsed);
        setSeat({
          role: "player",
          purseIds: parsed.purses.map((purse) => purse.id),
          shopIds: parsed.shops.map((shop) => shop.id),
          openedAt: parsed.exportedAt,
        });
        await reload();
        toast.success("Player mode enabled.");
      },
      takeBill: async (file) => {
        if (getCloudWatch().joined)
          throw new Error("Return to Local Mode before importing or replacing campaign data.");
        dmOnly();
        const parsed = readShare(JSON.parse(await file.text()) as unknown);
        if (parsed.kind !== "quire-bill")
          throw new Error("That file is a player file, not an activity report.");
        const added = await applyBill(parsed);
        presentReceipt(parsed);
        await reload();
        if (added === 0) toast("Activity report taken. Nothing new was purchased.");
        return added;
      },
      sendBill: async () => {
        const sitting = getSeat();
        if (sitting.role !== "player")
          throw new Error("An activity report is sent from the player's device.");
        const file = await snapshot();
        const gifts = await loadGifts();
        const loansOnPhone = await loadLoans();
        const sales = await loadSales();
        const bill = buildBill(
          {
            ...file,
            notes: await loadNotes(),
            gifts,
            loans: loansOnPhone,
            sales,
            sheets: await loadSheets(),
          },
          sitting,
        );
        const saved = await downloadJson(
          `lootsplit-bill-${new Date().toISOString().slice(0, 10)}.json`,
          bill,
        );
        if (!saved) throw new Error("Share was dismissed. The activity report was not saved.");
      },
    };
  }, [
    journal,
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
    run,
  ]);

  return <EconomyContext.Provider value={api}>{children}</EconomyContext.Provider>;
}

export function useEconomy() {
  const value = useContext(EconomyContext);
  if (!value) throw new Error("Ledger is unavailable.");
  return value;
}
