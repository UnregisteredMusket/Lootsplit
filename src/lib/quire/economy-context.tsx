import { activeCampaignId } from "./campaign-context.ts";
import { currentCampaignBackupKey, noteCampaignDownload } from "../account/campaign-backup-client.ts";
import { announceWorkspaceChange, subscribeWorkspaceChanges } from "./workspace-events.ts";
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
import { type CommandRequest } from "./commands.ts";
import { newCommandId, type CommandOptions } from "./command-id.ts";
import { canonicalJson } from "./canonical-json.ts";
import { purchaseUndoable, showActionReceipt } from "./action-receipt.ts";
import { resultToast } from "./result-toast.ts";
import {
  economyView,
  executeLocalCommand,
  executeFinanceCommand,
  executeFinanceBatch,
} from "./economy.ts";
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
  queueCommandBatch,
  runSharedMutation,
  hasPendingChanges,
  refreshSharedIfChanged,
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
  /** Pass `input.id` (see command-id.ts) to make a retry of the same action a no-op. */
  command: (input: CommandRequest) => Promise<void>;
  commandOutcome: (
    input: CommandRequest,
    expected?: import("./cloud-client.ts").ExpectedMutationScope,
  ) => Promise<EconomyMutationOutcome>;
  /**
   * Finance commands applied as one atomic action (journey "Approve & depart"): the room's
   * `applyCommandBatch` online, the same engine in one IndexedDB transaction on this device.
   * Pass one `batchId` per user action and reuse it on retry.
   */
  commandBatch: (batchId: string, inputs: CommandRequest[]) => Promise<EconomyMutationOutcome>;
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
  /** Resolves `true` when saved; `false` after a shown error. */
  updateStock: (line: StockLine) => Promise<boolean>;
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
  /** Resolves `true` when saved; `false` after a shown error. */
  updatePurse: (purse: Purse) => Promise<boolean>;
  deletePurse: (id: string) => Promise<void>;
  /** Resolves `true` when saved; `false` after a shown error. */
  updateHolding: (holding: Holding) => Promise<boolean>;
  addHolding: (
    purseId: string,
    name: string,
    kind: Holding["kind"],
    quantity: number,
    unitCopper: number,
    metadata?: Pick<Holding, "notes" | "category"> & { pool?: boolean },
  ) => Promise<void>;
  /** Resolves `true` when removed; `false` after a shown error. */
  deleteHolding: (id: string) => Promise<boolean>;
  /**
   * Treasure pool (one `loot-*` command, shared room or this device's engine). Each resolves to
   * null once accepted, or to the refusal text so the form keeps its choices for another try.
   */
  lootClaim: (
    input: Omit<Extract<CommandRequest, { kind: "loot-claim" }>, "kind" | "id">,
    options?: CommandOptions,
  ) => Promise<string | null>;
  lootPoolSet: (holdingId: string, pooled: boolean, options?: CommandOptions) => Promise<string | null>;
  lootResolve: (
    input: Omit<Extract<CommandRequest, { kind: "loot-resolve" }>, "kind" | "id">,
    options?: CommandOptions,
  ) => Promise<string | null>;
  // Money and item actions take `{ commandId }`: one ID per user action, reused
  // on retry, so a repeated submit is applied once (see command-id.ts).
  buy: (
    stockId: string,
    purseId: string,
    quantity: number,
    options?: CommandOptions,
  ) => Promise<EconomyMutationOutcome>;
  sell: (
    holdingId: string,
    shopId: string,
    quantity: number,
    options?: CommandOptions,
  ) => Promise<EconomyMutationOutcome>;
  // These resolve to `true` once the change is accepted and `false` when it
  // was refused (the error is already shown as a toast), so a form can keep
  // its input for a retry instead of clearing it on failure.
  setPurseCoins: (purseId: string, coins: Coins, options?: CommandOptions) => Promise<boolean>;
  post: (
    purseId: string,
    copper: number,
    summary: string,
    options?: CommandOptions,
  ) => Promise<boolean>;
  give: (
    input: {
      fromId: string;
      toId: string;
      copper: number;
      holdingId: string | null;
      quantity: number;
    },
    options?: CommandOptions,
  ) => Promise<boolean>;
  /**
   * Even coin split (one atomic `coin-split` command, shared room or this device's engine).
   * Resolves to null once accepted, or to the refusal text so the dialog can keep its form.
   */
  split: (
    input: Omit<Extract<CommandRequest, { kind: "coin-split" }>, "kind" | "id">,
    options?: CommandOptions,
  ) => Promise<string | null>;
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
    options?: CommandOptions,
  ) => Promise<EconomyMutationOutcome>;
  askLoan: (purseId: string, copper: number, note: string) => Promise<EconomyMutationOutcome>;
  /** Resolves `true` when the decision was recorded; `false` after a shown error. */
  decideLoan: (id: string, status: LoanStatus) => Promise<boolean>;
  sheets: CharacterSheet[];
  /** Resolves `true` when imported; `false` after a shown error. */
  importSheet: (purseId: string, file: File) => Promise<boolean>;
  updateSheet: (sheet: CharacterSheet, before?: CharacterSheet) => Promise<boolean>;
  voidLine: (id: string) => Promise<void>;
  /**
   * Undo a DM's shop purchase from its result toast (design D9): the existing ledger void on the
   * purchase line, with a command ID derived from the purchase's, so a repeated Undo applies once.
   * Resolves `true` when reversed; `false` after a shown refusal.
   */
  undoPurchase: (commandId: string) => Promise<boolean>;
  setRealm: (settings: RealmSettings, options?: { reprice?: boolean }) => Promise<void>;
  addGoods: (
    rows: CatalogItem[],
    expected?: import("./cloud-client.ts").ExpectedMutationScope,
  ) => Promise<number>;
  /** Resolves `true` when saved; `false` after a shown error. */
  saveGood: (item: CatalogItem) => Promise<boolean>;
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

/** A command's caller-supplied ID, when there is one. */
function idOf(options: CommandOptions): { id?: string } {
  return options.commandId ? { id: options.commandId } : {};
}

/**
 * One command ID for the action a component is preparing (see command-id.ts).
 * Pass `commandId` to the economy action on every attempt and call `renew()`
 * once the action was accepted. `inputs` names what the action does (for
 * example `${purseId}|${quantity}`): when it changes, so does the ID, because
 * an ID identifies one exact action and is refused for a different one.
 */
export function useCommandId(inputs = ""): { commandId: string; renew: () => void } {
  const [state, setState] = useState(() => ({ inputs, commandId: newCommandId() }));
  const renew = useCallback(
    () => setState((current) => ({ inputs: current.inputs, commandId: newCommandId() })),
    [],
  );
  if (state.inputs !== inputs) {
    // Derived state: adopt the new action's ID during this render.
    const next = { inputs, commandId: newCommandId() };
    setState(next);
    return { commandId: next.commandId, renew };
  }
  return { commandId: state.commandId, renew };
}

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

  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const reloadSequence = useRef(0);
  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    const campaignKey = activeCampaignId();
    await ensureEconomy();
    // A once-per-campaign safety copy. Never bypass an existing password-protected-save policy.
    if (
      !getCloudWatch().joined &&
      getSeat().role === "dm" &&
      !(await loadSeatLock())?.protectSaves
    ) {
      const campaignId = activeCampaignId();
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
    if (sequence !== reloadSequence.current || campaignKey !== activeCampaignId()) return;
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void (async () => {
          // Conditional: focus on an unchanged room costs the light "unchanged" answer (F7).
          if (getCloudWatch().joined) await refreshSharedIfChanged();
          await reload();
        })().catch((error) =>
          fault(error, "This window could not refresh. Your draft is retained."),
        );
      }, 100);
    };
    const unsubscribe = subscribeWorkspaceChanges((change) => {
      if (change.kind === "data") refresh();
    });
    window.addEventListener("focus", refresh);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refresh);
      if (timer) clearTimeout(timer);
    };
  }, [reload]);
  useEffect(() => {
    let cancelled = false;
    const campaignId = activeCampaignId();
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
        if (cancelled || getCloudWatch().joined || activeCampaignId() !== campaignId) return;
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

  const attempt = useCallback(
    // Resolves `true` when the work was accepted and `false` when it was
    // refused and the error shown (unless `rethrow`, which throws instead).
    async (work: () => Promise<unknown>, ok?: string, rethrow = false): Promise<boolean> => {
      const gate = getCloudWatch();
      if (gate.joined && !gate.mine) {
        if (rethrow) throw new Error(`It is ${gate.who}'s turn.`);
        toast.error(`It is ${gate.who}'s turn.`);
        return false;
      }
      try {
        if (gate.joined) await runSharedMutation(work);
        else await work();
        announceWorkspaceChange();
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
        return true;
      } catch (error) {
        if (rethrow) throw error;
        fault(error, "That change could not be saved.");
        return false;
      }
    },
    [reload],
  );

  const api = useMemo<EconomyApi>(() => {
    // For actions whose callers only need the toast, not the outcome.
    const run = async (work: () => Promise<unknown>, ok?: string, rethrow = false) => {
      await attempt(work, ok, rethrow);
    };
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
    const shared = async (command: CommandRequest): Promise<boolean> => {
      try {
        await queueCommand(command);
        await reload();
        if (!hasPendingChanges() && ["buy", "sell", "listing", "give"].includes(command.kind))
          void playSound("coins");
        return true;
      } catch (error) {
        fault(error, "Action failed. Check sync status.");
        return false;
      }
    };
    const refreshAccepted = async () => {
      announceWorkspaceChange();
      await reload().catch(() =>
        toast.error(
          "Action accepted, but this view could not refresh. Check sync before repeating it.",
        ),
      );
    };
    const accept = async (
      work: (assertScope: () => void) => Promise<unknown>,
      ok?: string,
      // The caller shows its own result toast (Buy and Sell, with View receipt / Undo).
      quiet = false,
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
      if (ok && !quiet) toast.success(mutationNotice(outcome, ok));
      return outcome;
    };
    const acceptCommand = async (
      input: CommandRequest,
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
    const lootCommand = async (
      command: CommandRequest,
      ok?: string,
      coins = false,
    ): Promise<string | null> => {
      try {
        if (getCloudWatch().joined) {
          await queueCommand(command);
          await reload();
          announceWorkspaceChange();
        } else {
          // A player-only device link holds part of the party: its pool is read-only.
          if (getSeat().role === "player")
            throw Error("The treasure pool is read-only on a player link. Ask the DM to mark claims at the table.");
          await acceptCommand(command);
        }
        if (coins) void playSound("coins");
        if (ok) toast.success(ok);
        return null;
      } catch (error) {
        // Show the pool that refused it; the form keeps its choices for another review.
        await reload().catch(() => undefined);
        return error instanceof Error && error.message ? error.message : "The treasure pool could not be saved.";
      }
    };
    const mutation = async <T,>(work: () => Promise<T>): Promise<T> => {
      if (!getCloudWatch().joined) {
        const result = await work();
        announceWorkspaceChange();
        return result;
      }
      let result!: T;
      await runSharedMutation(async () => {
        result = await work();
      });
      announceWorkspaceChange();
      return result;
    };
    return {
      journal,
      commandOutcome: acceptCommand,
      commandBatch: async (batchId, inputs) => {
        const invoked = captureMutationScope();
        const outcome =
          invoked.code !== "device"
            ? await queueCommandBatch(batchId, inputs, invoked)
            : await acceptedMutation(
                () => executeFinanceBatch(batchId, inputs, () => assertMutationScope(invoked)),
                () => false,
              );
        announceWorkspaceChange();
        await refreshAccepted();
        return outcome;
      },
      command: async (input) => {
        if (getCloudWatch().joined) {
          await queueCommand(input);
          announceWorkspaceChange();
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
          announceWorkspaceChange();
          await reload();
          return;
        }
        await executeLocalCommand(input);
        announceWorkspaceChange();
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
        attempt(async () => {
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
        attempt(async () => {
          dmOnly();
          await updatePurseMetadata(purse);
        }),
      deletePurse: (id) =>
        run(async () => {
          dmOnly();
          await removePurse(id);
        }, "Account removed."),
      updateHolding: (holding) =>
        attempt(async () => {
          dmOnly();
          await saveHolding(holding);
        }),
      addHolding: (purseId, name, kind, quantity, unitCopper, metadata) => {
        const id = crypto.randomUUID();
        return attempt(
          async () => {
            dmOnly();
            await saveHolding({
              id,
              purseId,
              name,
              kind,
              quantity,
              unitCopper,
              notes: metadata?.notes ?? "",
              ...(metadata?.category ? { category: metadata.category } : {}),
              ...(metadata?.pool ? { pool: { at: Date.now(), source: "add-loot" as const } } : {}),
            });
          },
          undefined,
          true,
        ).then((ok) => {
          if (ok)
            resultToast(
              getCloudWatch().joined && hasPendingChanges()
                ? "Action saved as pending. Check sync status."
                : "Holding added.",
              { receipt: () => showActionReceipt({ title: "Loot added", holdingId: id }) },
            );
        });
      },
      lootClaim: (input, options = {}) =>
        lootCommand({ kind: "loot-claim", ...input, ...idOf(options) }),
      lootPoolSet: (holdingId, pooled, options = {}) =>
        lootCommand(
          { kind: "loot-pool-set", holdingId, pooled, ...idOf(options) },
          pooled ? "Put in the treasure pool." : "Taken out of the treasure pool. It stays in the party fund.",
        ),
      lootResolve: (input, options = {}) =>
        lootCommand(
          { kind: "loot-resolve", ...input, ...idOf(options) },
          "Treasure pool resolved. It appears once in Activity and the party chat.",
          true,
        ),
      deleteHolding: (id) =>
        attempt(async () => {
          dmOnly();
          await removeHolding(id);
        }),
      buy: (stockId, purseId, quantity, options = {}) =>
        getCloudWatch().joined
          ? acceptCommand({ kind: "buy", stockId, purseId, quantity, ...idOf(options) })
          : accept(async () => {
              ownPurse(purseId);
              const line = stock.find((item) => item.id === stockId);
              if (line) ownShop(line.shopId);
              await buyFromShop({ stockId, purseId, quantity }, options);
            }, "Purchase recorded.", true),
      sell: (holdingId, shopId, quantity, options = {}) =>
        getCloudWatch().joined ||
        holdings.some(
          (h) =>
            h.id === holdingId &&
            (h.custody ||
              h.reservedFor ||
              journal.propertyOperations?.sites.some((s) => s.propertyId === h.id)),
        )
          ? acceptCommand({ kind: "sell", holdingId, shopId, quantity, ...idOf(options) })
          : accept(async () => {
              ownShop(shopId);
              const holding = holdings.find((item) => item.id === holdingId);
              if (holding) ownPurse(holding.purseId);
              await sellToShop({ holdingId, shopId, quantity }, options);
            }, "Sale recorded.", true),
      // A shared room records these as a reviewed table patch; the device
      // receipt only guards offline retries, so the ID is used offline only.
      setPurseCoins: (purseId, coins, options = {}) =>
        attempt(async () => {
          dmOnly();
          await setCoins(purseId, coins, undefined, getCloudWatch().joined ? {} : options);
        }, "Coin updated."),
      post: (purseId, copper, summary, options = {}) =>
        attempt(async () => {
          dmOnly();
          await postCopper(purseId, copper, summary, getCloudWatch().joined ? {} : options);
        }, "Ledger updated."),
      give: (input, options = {}) => {
        // One ID per transfer (the caller's, reused on retry), so its receipt can be shown.
        const commandId = options.commandId ?? newCommandId();
        const done = "Transfer recorded and added to party messages.";
        // A player link's gift waits for the DM's activity report: there is no receipt yet.
        const receipt =
          getCloudWatch().joined || getSeat().role === "dm"
            ? () =>
                showActionReceipt({
                  title: "Transfer receipt",
                  commandId,
                  ...(input.holdingId ? { holdingId: commandId + "-item" } : {}),
                })
            : undefined;
        const shown = (outcome?: EconomyMutationOutcome) =>
          resultToast(outcome ? mutationNotice(outcome, done) : done, { receipt });
        return getCloudWatch().joined
          ? shared({ kind: "give", ...input, id: commandId }).then((ok) => {
              if (ok) resultToast(hasPendingChanges() ? "Action saved as pending. Check sync status." : done, { receipt });
              return ok;
            })
          : holdings.some(
                (h) =>
                  h.id === input.holdingId &&
                  (h.custody ||
                    h.reservedFor ||
                    journal.propertyOperations?.sites.some((s) => s.propertyId === h.id)),
              )
            ? acceptCommand({ kind: "give", ...input, id: commandId }).then(
                (outcome) => {
                  shown(outcome);
                  return true;
                },
                (error: unknown) => {
                  fault(error, "That transfer could not be saved.");
                  return false;
                },
              )
            : attempt(async () => {
                ownPurse(input.fromId);
                await giveToPlayer(input, { ...options, commandId });
              }).then((ok) => {
                if (ok) {
                  void playSound("coins");
                  shown();
                }
                return ok;
              });
      },
      split: async (input, options = {}) => {
        const command = { kind: "coin-split" as const, ...input, ...idOf(options) };
        try {
          const joined = getCloudWatch().joined;
          if (joined) {
            await queueCommand(command);
            await reload();
            announceWorkspaceChange();
          } else {
            // A player link holds only some of the party; the DM's device or a room splits.
            if (getSeat().role === "player")
              throw Error(
                "Splitting coins isn't available on a player link. Ask the DM to split, or use Give.",
              );
            await acceptCommand(command);
          }
          const pending = joined && hasPendingChanges();
          if (!pending) void playSound("coins");
          toast.success(
            pending
              ? "Split saved as pending. Check sync status."
              : "Coins split. It appears once in Activity and the party chat.",
          );
          return null;
        } catch (error) {
          // Show the balances that refused it; the dialog keeps its choices for another review.
          await reload().catch(() => undefined);
          return error instanceof Error && error.message
            ? error.message
            : "The split could not be saved.";
        }
      },
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
      buyListing: (listingId, purseId, quantity, options = {}) =>
        getCloudWatch().joined || listings.some((l) => l.id === listingId && l.estateTemplateKey)
          ? acceptCommand({ kind: "listing", listingId, purseId, quantity, ...idOf(options) })
          : accept(async () => {
              ownPurse(purseId);
              await buyListing({ listingId, purseId, quantity }, options);
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
            ? Promise.resolve(true)
            : shared({ kind: "decision", loanId: id, status })
          : attempt(
              async () => {
                dmOnly();
                await answerLoan(id, status);
              },
              status === "approved" ? "Loan approved." : "Loan denied.",
            ),
      importSheet: async (purseId, file) => {
        try {
          ownPurse(purseId);
          const gaps = await mutation(() => importCharacterSheet(purseId, file));
          await reload();
          toast.success(
            gaps.length > 0
              ? `Imported. Still blank: ${gaps.join(", ")}.`
              : "Character sheet imported.",
          );
          return true;
        } catch (error) {
          fault(error, "That character sheet could not be imported.");
          return false;
        }
      },
      updateSheet: (sheet, before) =>
        getCloudWatch().joined
          ? shared({ kind: "sheet", sheet, before })
          : attempt(async () => {
              ownPurse(sheet.purseId);
              await updateCharacterSheet(sheet, before);
            }),
      voidLine: async (id) => {
        try {
          dmOnly();
          const line = ledger.find((entry) => entry.id === id);
          if (!line) throw new Error("That ledger line is no longer available.");
          const outcome = await acceptCommand({
            kind: "ledger-void",
            target: { kind: "ledger", id },
            before: canonicalJson(line),
            reason: "DM ledger correction.",
          });
          toast.success(mutationNotice(outcome, "That line was voided."));
        } catch (error) {
          fault(error, "That line could not be reversed.");
        }
      },
      undoPurchase: async (commandId) => {
        try {
          // The latest ledger: the toast outlives the render that created it.
          const line = purchaseUndoable(
            ledgerRef.current,
            commandId,
            getSeat().role === "dm" ? "dm" : "player",
          );
          if (!line)
            throw Error(
              "This purchase can no longer be undone here. Correct it from its receipt in Activity.",
            );
          const outcome = await acceptCommand({
            id: commandId + "-undo",
            kind: "ledger-void",
            target: { kind: "ledger", id: line.id },
            before: canonicalJson(line),
            reason: "Purchase undone from its result.",
          });
          toast.success(
            mutationNotice(outcome, "Purchase undone. The coins and the shop stock are back."),
          );
          return true;
        } catch (error) {
          fault(error, "That purchase could not be undone.");
          return false;
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
      addGoods: async (rows, expected) => {
        dmOnly();
        const invoked = captureMutationScope();
        const added = await addCatalogRows(rows, () => {
          dmOnly();
          assertMutationScope(invoked);
          if (expected) assertMutationScope(expected);
        });
        await reload();
        return added;
      },
      saveGood: (item) =>
        attempt(async () => {
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
        // For the Backups reminder in My account (device-only; never blocks anything).
        noteCampaignDownload(currentCampaignBackupKey());
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
    attempt,
  ]);

  return <EconomyContext.Provider value={api}>{children}</EconomyContext.Provider>;
}

export function useEconomy() {
  const value = useContext(EconomyContext);
  if (!value) throw new Error("Ledger is unavailable.");
  return value;
}
