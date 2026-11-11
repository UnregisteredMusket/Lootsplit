import { shipCommands, type ShipCommand } from "./ships-schema.ts";
import { downtimeActivityCommands, type DowntimeActivityCommand } from "./downtime-activities-schema.ts";
import { applyDowntimeActivity, validateDowntimeActivities } from "./downtime-activities.ts";
import { orderedTable } from "./journey-engine.ts";
import { smithCommands, type SmithCommand } from "./blacksmith-schema.ts";
import { applyShipCommand, validateFleet, assertShipTradingHere } from "./ships.ts";
import { characterVisible, canReadCharacter } from "./character-position.ts";
import { ensureCityExchanges, removeUnusedCityExchange, renameUnusedCityExchange } from "./city-exchanges.ts";
import { worldCommands, readWorld, type WorldCommand } from "./world-schema.ts";
import { journeyCommands, journeyKinds, type JourneyCommand } from "./journey-schema.ts";
import {
  identifyHolding,
  isUnidentified,
  knownUnitCopper,
  presentedHolding,
  identityLineage,
  redactWritten,
  unidentifiedSchema,
  writtenBaseline,
} from "./item-identity.ts";
import {
  applyJourneyCommand,
  prepareJourneyPlan,
  quoteHash,
  travellingJourney,
  validateJourneys,
} from "./journey-engine.ts";
import { npcBarterCommands, npcBarterKinds, type NpcBarterCommand } from "./npc-barter-schema.ts";
import { applyNpcBarterCommand, validateNpcBarter } from "./npc-barter.ts";
import { resourcePackSchema, resourceFingerprint, previewResourcePack } from "./resource-packs.ts";
import { tradeCommands, type TradeCommand, type TradeExecution } from "./trade-economy-schema.ts";
import { applyTradeCommand, prepareTradeSeason, recordShopTrade, validateTradeEconomy } from "./trade-economy.ts";
import { applyWorldCommand, validateWorld, shopVisible } from "./world.ts";
import { cancelStaleZoneRequests } from "./zone-commands.ts";
import { shopScheduleSchema } from "./shop-schedule.ts";
import { estateCommands } from "./estate-schema.ts";
import { estateImportCommand, estateImportFingerprint, previewEstateImport } from "./estate-import.ts";
import { applyEstateCommand, assertCarried, assertEstateDisposable, initializeEstatePurchase, removeEstateSite, validateEstate } from "./estate.ts";
import { marketLocationSchema, readMarketLocations, validateShopLocations } from "./shop-locations.ts";
import { canonicalJson } from "./canonical-json.ts";
import { planSaleSplit, MAX_SALE_LOTS, lotLabel, shopSale } from "./sale-split.ts";
import { creditCoins, isNpc } from "./coin-split.ts";
import { applyFundSplit, planCoinSplit, remainderText, SPLIT_RULES, MAX_SPLIT_RECIPIENTS, partyFunds } from "./coin-split.ts";
import { lootCommands, lootKinds, type LootCommand } from "./loot-claims-schema.ts";
import { applyLootCommand, validateLootPool } from "./loot-claims.ts";
import { applyLootReturn, lootReturnCommand } from "./loot-return.ts";
import { questCommands, questKinds, type QuestCommand } from "./quests-schema.ts";
import { applyXpAward, keepPurseAdvancement, xpAwardCommand, xpAwardSummary } from "./xp.ts";
import { applyQuestCommand, questReadable, questsOf } from "./quests.ts";
import { POOL_GUARD } from "./custody.ts";
import { applyAttunementCommand, attunedBefore, attunementFromNotes, attunementCommands, attunementKinds, settleAttunement, type AttunementCommand } from "./attunement.ts";
import { applyItemUseCommand, itemUseCommands, movedUses } from "./item-uses.ts";
import { applyMarketEventCommand, lineEvents, OLD_CLIENT_EVENT_PRICE, saleEvents, marketEventCommands, marketEventKinds, type MarketEventCommand } from "./market-events.ts";
import { applyFactionCommand, factionCommands, factionEffects, factionKinds, OLD_CLIENT_FACTION_PRICE, type FactionCommand } from "./factions.ts";
import { settlementCommands, settlementKinds, type SettlementCommand } from "./settlements-schema.ts";
import { applySettlementCommand, dropSettlementProfile, newShopDefaults, OLD_CLIENT_SETTLEMENT_PRICE, settlementKind, settlementSaleLimit } from "./settlements.ts";
import { shopListCommands, shopListKinds, type ShopListCommand } from "./shop-lists-schema.ts";
import { applyShopListCommand } from "./shop-lists.ts";
import { applyFavorCommand, favorCommands, favorKinds, type FavorCommand } from "./favor-market.ts";
import { applyLedgerVoid, assertNoPartialTradeVoid, ledgerVoidCommandSchema } from "./ledger-reversal.ts";
import { marketNameRowsSchema, marketNameFingerprint, previewMarketNames } from "./market-name-import.ts";
import {
  characterPermissionSchema,
  canEditCharacterField,
  characterPermissions,
} from "../characters/permissions.mjs";
import {
  assertFinanceAccountRemovable,
  termsSchema,
  ruleSchema,
  readFinance,
  loanFromRequest,
  previewDowntime,
  applyDowntime,
  financeMove,
} from "./finance.ts";
import { assertMerchantSale, creditMerchant, isService, merchantRefill, merchantShortfall, payFromMerchant, revealPurse, stockCategory } from "./merchant.ts";
import { archiveSession, projectRecord } from "./session-records.ts";
import { readJournal, preserveJournalMetadata, encounterLootProvenanceSchema, encounterLootEntryId } from "./journal.ts";
import { z } from "zod";
import { referencePolicySchema, referencePolicy } from "./reference-access.ts";
import { artworkSchema } from "./artwork.ts";
import { sheetSchema } from "../characters/model.mjs";
import {
  characterSheet,
  editCharacter,
  editLegacyCharacter,
} from "../characters/campaign-sheet.mjs";
import type { CloudTable, CloudSeat } from "./cloud.ts";
import { editedStockFields, staleStockMessage, type StockFields } from "./stock-edit.ts";
import { assertCoinEditWithinLimit, formatCopper, fromCopper, toCopper, spendCoins, sameCoins, exchangeSummary } from "./money.ts";
import { charismaFor, listingBreakdown, shopBuyBreakdown, shopSellBreakdown } from "./price-breakdown.ts";
import { readSheets } from "./sheet.ts";
import { coinsSchema, validateEconomyRows } from "./validation.ts";
import { listingSchema, propertyProfileSchema, propertyAvailableToGroups, validatePropertyLocations } from "./property.ts";
import { actingGroups, activeGroups, groupInfo, MAIN_GROUP, partySplit, purseGroup } from "./party-groups.ts";
import { partyGroupCommands, partyGroupKinds, type PartyGroupCommand } from "./party-groups-schema.ts";
import { applyGroupLocation, applyPartyGroupCommand } from "./party-groups-command.ts";
import { transferPropertyDeed } from "./property-deed.ts";
import { locationLabel } from "./shop-locations.ts";
import { applySmithCommand } from "./blacksmith-command.ts";
import { validateBlacksmith } from "./blacksmith-validation.ts";
import { serviceCommands, type ServiceCommand } from "./services-schema.ts";
import { applyServiceCommand } from "./services-command.ts";
// After services-command: finance must load after journal here (see services-lessons.ts).
import { chargeLesson } from "./services-lessons.ts";
import { validateServices } from "./services-validation.ts";
import { isRecapEntryId, recapEntryId } from "./session-recap.ts";
import { diffJournal, journalChangeId, journalChangePath, LEGACY_JOURNAL_CHANGE_ID, writeJournalPath } from "./journal-patch.ts";
const id = z.string().min(1).max(150),
  amount = z.number().int().nonnegative().max(1e12),
  qty = amount.min(1).max(100000);
const base = { id };
export const commandSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("reference-policy"), before: referencePolicySchema, policy: referencePolicySchema }).strict(),
  ledgerVoidCommandSchema,
  ...tradeCommands,
  ...worldCommands,
  ...npcBarterCommands,
  ...journeyCommands,
  ...partyGroupCommands,
  ...estateCommands,
  ...shipCommands,
  ...smithCommands,
  ...serviceCommands,
  ...downtimeActivityCommands,
  estateImportCommand,
  z.object({ ...base, kind: z.literal("resource-pack-import"), before: z.string().max(30000), pack: resourcePackSchema }).strict(),
  z.object({ ...base, kind: z.literal("listing-edit"), listingId: id, before: listingSchema.nullable(), after: listingSchema.nullable() }),
  z.object({ ...base, kind: z.literal("property-profile"), holdingId: id,
    before: z.object({ locationId: id.nullable(), property: propertyProfileSchema.nullable() }),
    locationId: id.nullable(), property: propertyProfileSchema.nullable() }),
  z.object({ ...base, kind: z.literal("market-name-import"), before: z.string(), rows: marketNameRowsSchema }),
  z.object({ ...base, kind: z.literal("shop-location"), shopId: id,
    before: z.object({ locationId: id.nullable(), image: artworkSchema.nullable() }),
    locationId: id.nullable(), image: artworkSchema.nullable() }),
  z.object({ ...base, kind: z.literal("market-location"), locationId: id, before: marketLocationSchema.nullable(), after: marketLocationSchema.nullable() }),
  z.object({ ...base, kind: z.literal("party-location"), before: id.nullable(), locationId: id.nullable(), beforePosition: z.string().optional(),
    /** Journey planner: "Move party here" on arrival completes this journey. */
    journeyId: id.optional(),
    /** Split the party: move this group (absent or "main" = the main group, as before). */
    groupId: id.optional() }),
  z.object({ ...base, kind: z.literal("bank-repay"), loanId: id, copper: amount.min(1) }),
  /** Make change (loot phase 4): coins exchanged inside one purse at book rates; the worth never changes. */
  z.object({ ...base, kind: z.literal("coin-exchange"), purseId: id, before: coinsSchema, after: coinsSchema }).strict(),
  /** XP and milestones (loot phase 6): the DM awards experience to chosen party characters (xp.ts). */
  xpAwardCommand,
  // DM coin postings and direct coin edits (audit 2026-10-21, finding 3): shared rooms record them
  // as commands, so a retried command ID applies once. The device runs the same commands.
  z
    .object({
      ...base,
      kind: z.literal("post"),
      purseId: id,
      copper: z.number().int().min(-1e12).max(1e12).refine((n) => n !== 0, "Enter a valid amount in whole copper."),
      summary: z.string().trim().min(1, "Write what the money was for.").max(500),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("set-coins"),
      purseId: id,
      // The coins the DM edited from; a purse that changed meanwhile is refused.
      before: coinsSchema,
      coins: coinsSchema,
      summary: z.string().max(500).optional(),
    })
    .strict(),
  z.object({ ...base, kind: z.literal("property-details"), holdingId: id, before: z.object({name:z.string(),notes:z.string()}), name: z.string().trim().min(1).max(160), notes: z.string().max(4000) }),
  z.object({ ...base, kind: z.literal("shop-schedule"), shopId: id, schedule: shopScheduleSchema.nullable() }),
  /**
   * Item identification (phase 5, DM only): set or edit what players are told about an item
   * (`before` is the presented record the DM edited from, null for an identified item)...
   */
  z.object({ ...base, kind: z.literal("item-unidentify"), holdingId: id, before: unidentifiedSchema.nullable(), unidentified: unidentifiedSchema }).strict(),
  /** ...and reveal it: one logged event, after which everyone sees the true item. */
  z.object({ ...base, kind: z.literal("item-identify"), holdingId: id, before: unidentifiedSchema }).strict(),
  z.object({ ...base, kind: z.literal("property-plan"), holdingId: id, income: amount, upkeep: amount, periodDays: z.number().int().min(1).max(3650), active: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("downtime-preference"),
    days: z.number().int().min(0).max(3650),
  }),
  z.object({
    ...base,
    kind: z.literal("character-permission"),
    purseId: id,
    permission: characterPermissionSchema,
    allowed: z.boolean(),
  }),
  z.object({
    ...base,
    kind: z.literal("finance-loan"),
    terms: termsSchema,
    principal: amount.min(1),
    sourceLoanId: id.optional(),
  }),
  z.object({ ...base, kind: z.literal("finance-terms"), loanId: id, terms: termsSchema }),
  z.object({ ...base, kind: z.literal("finance-repay"), loanId: id, copper: amount.min(1) }),
  z.object({ ...base, kind: z.literal("finance-rule"), rule: ruleSchema }),
  z.object({
    ...base,
    kind: z.literal("downtime-plan"),
    advanceSeason: z.boolean().optional(),
    name: z.string().trim().min(1).max(100),
    days: z.number().int().min(1).max(3650),
    /** Journey planner: price and move a party journey in this downtime. */
    journeyId: id.optional(),
    /**
     * Split the party: other groups' journeys under way that also travel in this window (the
     * DM ticks them; one campaign clock). Each moves its own group.
     */
    journeyIds: z.array(id).max(5).optional(),
    /** One-click inbox approval: refuse if the quote differs from the one the DM was shown. */
    expectedQuoteHash: z.string().max(100).optional(),
  }),
  z.object({ ...base, kind: z.literal("downtime-cancel"), downtimeId: id }),
  z.object({ ...base, kind: z.literal("downtime-apply"), downtimeId: id, endSession: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("journal-note"),
    title: z.string().trim().min(1).max(100),
    text: z.string().max(12000),
    visibility: z.enum(["dm", "party", "player"]),
    purseId: z.string(),
    reportIds: z.array(id).default([]),
    provenance: encounterLootProvenanceSchema.optional(),
    /** A note about one quest the writer can read (players' private "My notes"). */
    questId: id.optional(),
  }),
  z.object({ ...base, kind: z.literal("character-editing"), purseId: id, allowed: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("character"),
    purseId: id,
    before: sheetSchema,
    sheet: sheetSchema,
  }),
  z.object({
    ...base,
    kind: z.literal("session"),
    name: z.string().trim().min(1).max(100),
    end: z.boolean(),
    downtimeId: id.optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("payment-request"),
    purseId: id,
    copper: amount.min(1),
    note: z.string().trim().min(1).max(1000),
  }),
  z.object({
    ...base,
    kind: z.literal("payment-decision"),
    requestId: id,
    status: z.enum(["approved", "denied"]),
  }),
  z.object({ ...base, kind: z.literal("restock"), shopId: id, quantity: qty }),
  z.object({
    ...base,
    kind: z.literal("portrait"),
    purseId: id,
    portrait: z
      .string()
      .max(100000)
      .regex(/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|\/art\/[a-z0-9-]+\.webp)$/),
  }),
  z.object({ ...base, kind: z.literal("buy"), stockId: id, purseId: id, quantity: qty }),
  z.object({ ...base, kind: z.literal("sell"), holdingId: id, shopId: id, quantity: qty }),
  z.object({ ...base, kind: z.literal("listing"), listingId: id, purseId: id, quantity: qty, before: listingSchema.optional() }),
  z.object({
    ...base,
    kind: z.literal("give"),
    fromId: id,
    toId: id,
    copper: amount,
    holdingId: id.nullable(),
    quantity: amount,
  }),
  z
    .object({
      ...base,
      kind: z.literal("coin-split"),
      sourceId: id,
      copper: amount.min(1),
      recipientIds: z.array(id).min(1).max(MAX_SPLIT_RECIPIENTS),
      remainder: z
        .object({ rule: z.enum(SPLIT_RULES), purseId: id.optional() })
        .strict(),
      // What the reviewed preview showed; a split that would now differ is refused.
      expect: z.object({ share: amount.min(1), remainderTo: id.nullable() }).strict(),
      makeDefault: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("sale-split"),
      fundId: id,
      shopId: id,
      lots: z.array(z.object({ holdingId: id, quantity: qty }).strict()).min(1).max(MAX_SALE_LOTS),
      recipientIds: z.array(id).min(1).max(MAX_SPLIT_RECIPIENTS),
      remainder: z
        .object({ rule: z.enum(SPLIT_RULES), purseId: id.optional() })
        .strict(),
      // What the reviewed preview showed; a sale or split that would now differ is refused.
      expect: z.object({ proceeds: amount.min(1), share: amount.min(1), remainderTo: id.nullable() }).strict(),
    })
    .strict(),
  z.object({
    ...base,
    kind: z.literal("loan"),
    purseId: id,
    copper: amount.min(1),
    note: z.string().trim().min(1).max(1000),
  }),
  z.object({
    ...base,
    kind: z.literal("decision"),
    loanId: id,
    status: z.enum(["approved", "denied"]),
  }),
  z.object({
    ...base,
    kind: z.literal("message"),
    to: z.enum(["party", "dm", "player"]),
    recipientId: id.optional(),
    purseId: z.string().max(150),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({
    ...base,
    kind: z.literal("sheet"),
    sheet: z.unknown(),
    before: z.unknown().optional(),
  }),
  z.object({
    ...base,
    kind: z.literal("patch"),
    changes: z
      .array(
        z.object({
          store: z.enum([
            "purses",
            "holdings",
            "shops",
            "stock",
            "ledger",
            "listings",
            "loans",
            "sheets",
            "handouts",
            "realm",
            "journal",
          ]),
          id: z.string(),
          before: z.unknown(),
          after: z.unknown(),
        }),
      )
      .max(10000),
  }),
  ...lootCommands,
  // Return to party (loot-return.ts): a departed character's items and coins back to the party.
  lootReturnCommand,
  ...questCommands,
  // Attunement (loot phase 5, attunement.ts): attune or end it, and the DM's per-character limit.
  ...attunementCommands,
  // Charges and consumables (loot phase 5, item-uses.ts): Use and the DM's Recharge.
  ...itemUseCommands,
  // Named market events (market-events.ts; tabletop protocol 26): the DM's timed price multipliers.
  ...marketEventCommands,
  // Factions, Renown and Favor (factions.ts; tabletop protocol 29): DM-only.
  ...factionCommands,
  // The favor market (favor-market.ts; tabletop protocol 30): players ask, the DM decides.
  ...favorCommands,
  // Settlement tiers (settlements.ts, phase S1): DM-only; outside every strict schema, no protocol bump.
  ...settlementCommands,
  // Alternative shop lists (shop-lists.ts; tabletop protocol 33): DM-only library and stock swaps.
  ...shopListCommands,
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = Command extends infer C
  ? C extends Command
    ? Omit<C, "id">
    : never
  : never;
/**
 * A command as a caller submits it. `id` is optional: pass one command ID per
 * user action and reuse it when the same action is retried, so the device
 * (local receipts) and the room (seen command IDs) apply it at most once.
 * Without an `id` a fresh one is generated and no duplicate check is possible.
 */
export type CommandRequest = CommandInput & { id?: string };
/**
 * True when a player's own view (projectRecord with the party directory, as roomState sends it)
 * lists this purse under its real name. `projected` is a player's client previewing on the
 * table it already received. The ledger, chat and archived sessions name no purse the view
 * lists, so they are left out of the copy that is projected.
 */
function recipientListed(t: CloudTable, seat: CloudSeat, purseId: string, projected: boolean) {
  const listed = (table: CloudTable) => {
    const p = table.purses.find((x) => x.id === purseId);
    return !!p && characterVisible(table, p);
  };
  if (projected) return listed(t);
  const journal = t.journal ? { ...t.journal, reports: [], editReports: [], entries: [] } : t.journal;
  const view = projectRecord({ ...t, ledger: [], notes: [], journal }, seat, { directory: true });
  return listed(view) && view.purses.find((x) => x.id === purseId)!.name === t.purses.find((x) => x.id === purseId)?.name;
}
/** Players never read this account's balance or name it in chat: NPCs, exchange treasuries, hidden characters. */
function recipientPrivate(t: CloudTable, p: import("./types.ts").Purse) {
  return isNpc(t, p) || !!t.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id) || !characterVisible(t, p);
}
export function applyCommand(input: CloudTable, seat: CloudSeat, raw: Command, execution: TradeExecution = {}): CloudTable {
  return applyOwnedCommand(structuredClone(input), seat, raw, execution);
}
/** One private working copy per atomic batch. Every command retains its full validation. */
export function applyCommandBatch(input: CloudTable, seat: CloudSeat, commands: Command[], executionFor: (command: Command) => TradeExecution = () => ({})): CloudTable {
  let table = structuredClone(input);
  // Hidden merchant purses: refused last, after every other command in the batch validated.
  const merchantShortfalls: string[] = [];
  for (const command of commands)
    table = applyOwnedCommand(table, seat, command, { ...executionFor(command), merchantShortfalls });
  if (merchantShortfalls.length) throw Error(merchantShortfalls[0]);
  return table;
}
function applyOwnedCommand(t: CloudTable, seat: CloudSeat, raw: Command, execution: TradeExecution): CloudTable {
  const originalLocations = structuredClone(t.journal?.market?.locations);
  const cmd = commandSchema.parse(raw);
  const at = Date.now();
  // `let`: archiveSession replaces t.journal, and everything after it must write to the new one.
  let journal = (t.journal = readJournal(t.journal));
  // Item identification: what this command writes names unidentified items as presented.
  const written = t.holdings.some(isUnidentified) ? writtenBaseline(t) : null;
  // Attunement ends when an attuned item leaves its character in this command (settleAttunement).
  const attuned = attunedBefore(t.holdings);
  // Exchange editors can address a legacy city's default before its first save.
  // Other commands retain their original financial/patch preview baselines.
  if (cmd.kind.startsWith("trade-")) ensureCityExchanges(t);
  if (seat.role !== "dm")
    seat = {
      ...seat,
      purseIds: seat.purseIds.filter((id) => {
        const p = t.purses.find((p) => p.id === id);
        return p && characterVisible(t, p);
      }),
    };
  const event = (
    summary: string,
    kind: "management" | "prices" | "request" | "session" = "management",
    purseId?: string,
    change?: NonNullable<CloudTable["journal"]>["events"][number]["change"],
  ) => {
    if (cmd.kind === "patch" && cmd.changes.some((c) => c.store === "journal")) return;
    journal.events.push({
      id: cmd.id + "-event-" + journal.events.length,
      at,
      summary,
      kind,
      ...(purseId ? { purseId } : {}),
      ...(change ? { change } : {}),
    });
  };
  if (seat.role !== "dm" && cmd.kind === "character") {
    const p = t.purses.find((p) => p.id === cmd.purseId);
    if (p && (!characterVisible(t, p) || (p.control === "npc" && !canReadCharacter(t, p, seat))))
      throw Error("This character sheet is unavailable.");
  }
  const own = (purseId: string) => {
    if (seat.role !== "dm" && !seat.purseIds.includes(purseId))
      throw new Error("You do not have permission to spend from this account.");
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw new Error("Account no longer exists.");
    return p;
  };
  // Merchant purse (merchant.ts). A seat that can't read the purse never learns from the order of
  // errors whether a sale fit: in a batch the shortfall is refused only after every other command
  // validated (applyCommandBatch), and a staged batch is checked again at final submit.
  const merchantPays = (shop: import("./types.ts").Shop, copper: number) => {
    const reveal = revealPurse(shop, seat.role);
    if (!reveal && (execution.staged || execution.merchantShortfalls)) {
      const short = merchantShortfall(shop, copper, false);
      if (short) {
        if (!execution.staged) execution.merchantShortfalls!.push(short);
        return;
      }
    }
    payFromMerchant(shop, copper, reveal);
  };
  const dm = () => {
    if (seat.role !== "dm") throw new Error("Only the DM can perform this action.");
  };
  // Split the party: name the acting character's group; whole party: today's wording.
  const notHere = (purseId: string, what: string) => {
    const group = purseGroup(t, purseId);
    return partySplit(t) && group
      ? `${what} isn't where ${t.purses.find((p) => p.id === purseId)?.name ?? "this character"}'s group (${groupInfo(t, group).name}) is.`
      : `${what} is not available at the party's current location.`;
  };
  const coins = (purseId: string, delta: number) => {
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw new Error("Account no longer exists.");
    const total = toCopper(p.coins) + delta;
    if (!Number.isSafeInteger(total) || total < 0 || total > 1e12)
      throw new Error("Insufficient funds or invalid amount.");
    // A credit adds coins on top of those held (as `post` and coin splits do); it never
    // changes the purse's platinum or electrum into other coins.
    p.coins = delta < 0 ? spendCoins(p.coins, -delta)! : creditCoins(p.coins, delta);
  };
  const log = (
    purseId: string,
    summary: string,
    copper: number,
    shopId: string | null = null,
    suffix = "",
  ) =>
    t.ledger.push({
      id: cmd.id + suffix,
      at,
      purseId,
      shopId,
      summary,
      copper,
      transactionType:
        cmd.kind === "give"
          ? "transfer"
          : cmd.kind === "buy" || cmd.kind === "listing"
            ? "purchase"
            : cmd.kind === "sell"
              ? "sale"
              : cmd.kind === "decision"
                ? "loan"
                : "payment",
    });
  const score = (purseId: string) =>
    charismaFor(t.purses.find((p) => p.id === purseId) ?? { id: purseId, kind: "character" }, t.sheets);
  const finance = () => (journal.finance ??= readFinance());
  const editableFinance = () => {
    dm();
    const f = finance();
    if (f.downtime.some((d) => d.status === "pending"))
      throw Error("Cancel the pending downtime before changing finance agreements.");
    return f;
  };
  if (seat.role === "player" && ["buy", "sell", "listing"].includes(cmd.kind)) {
    const payerId = "purseId" in cmd ? cmd.purseId : "holdingId" in cmd ? t.holdings.find(h=>h.id===cmd.holdingId)?.purseId : undefined;
    if (payerId) assertShipTradingHere(t, payerId);
  }
  if (cmd.kind === "ledger-void") {
    applyLedgerVoid(t, seat, cmd, at, execution.source === "local");
  } else if (downtimeActivityCommands.some(schema => schema.shape.kind.value === cmd.kind)) {
    applyDowntimeActivity(t, seat, cmd as DowntimeActivityCommand, at, execution.preview === true, { chargeLesson });
  } else if (tradeCommands.some((schema) => schema.shape.kind.value === cmd.kind)) {
    applyTradeCommand(t, seat, cmd as TradeCommand, at, execution);
  } else if (lootKinds.has(cmd.kind)) {
    applyLootCommand(t, seat, cmd as LootCommand, at, execution, event);
  } else if (cmd.kind === "loot-return") {
    applyLootReturn(t, seat, cmd, at, event);
  } else if (questKinds.has(cmd.kind)) {
    applyQuestCommand(t, seat, cmd as QuestCommand, at);
  } else if (journeyKinds.has(cmd.kind)) {
    journal.world = readWorld(journal.world);
    applyJourneyCommand(t, seat, cmd as JourneyCommand, at, (summary, purseId) =>
      event(summary, "management", purseId),
    );
  } else if (partyGroupKinds.has(cmd.kind)) {
    applyPartyGroupCommand(t, seat, cmd as PartyGroupCommand, at, (summary, purseId, dmOnly) =>
      journal.events.push({
        id: cmd.id + "-event-" + journal.events.length,
        at,
        summary,
        kind: "management",
        ...(purseId ? { purseId } : {}),
        ...(dmOnly ? { dmOnly: true } : {}),
      }),
    );
  } else if (npcBarterKinds.has(cmd.kind)) {
    applyNpcBarterCommand(t, seat, cmd as NpcBarterCommand, at, execution);
  } else if (worldCommands.some((schema) => schema.shape.kind.value === cmd.kind)) {
    applyWorldCommand(t, seat, cmd as WorldCommand, at, execution);
  } else if (cmd.kind === "estate-import") {
    dm();
    if (finance().downtime.some((d) => d.status === "pending"))
      throw Error("Cancel pending downtime before importing properties.");
    if (estateImportFingerprint(t) !== cmd.before)
      throw Error("The campaign changed. Review a fresh property import preview.");
    const next = previewEstateImport(t, cmd.document, cmd.owners, cmd.locations, cmd.id);
    t.holdings = next.holdings;
    t.listings = next.listings;
    t.journal!.market = next.journal!.market;
    t.journal!.propertyOperations = next.journal!.propertyOperations;
    event(
      `Imported property configurations: ${cmd.document.properties.length} records awaiting DM review.`,
    );
  } else if (cmd.kind.startsWith("smith-")) {
    applySmithCommand(t, seat, cmd as SmithCommand, at);
  } else if (cmd.kind.startsWith("service-")) {
    applyServiceCommand(t, seat, cmd as ServiceCommand, at);
  } else if (cmd.kind.startsWith("ship-")) {
    applyShipCommand(t, seat, cmd as ShipCommand, at);
  } else if (cmd.kind.startsWith("estate-")) {
    finance();
    if ((execution.marketEventsUnsupported || execution.factionsUnsupported) && cmd.kind === "estate-delivery") {
      // An older app quoted the supplier's price without market events or factions (estate.ts `delivery`).
      const line = t.stock.find((x) => x.id === cmd.stockId),
        vendor = line && t.shops.find((x) => x.id === line.shopId),
        payer = t.purses.find((p) => p.id === cmd.purseId);
      if (line && vendor && payer) {
        const events = lineEvents(journal, vendor, line),
          factions = factionEffects(journal, t.purses, vendor),
          cha = charismaFor(payer, t.sheets);
        const unit = shopBuyBreakdown(vendor, line.copper, cha, 1, { events, factions }).unit;
        if (execution.marketEventsUnsupported && events.length && unit !== shopBuyBreakdown(vendor, line.copper, cha, 1, { factions }).unit)
          throw Error(OLD_CLIENT_EVENT_PRICE);
        const seen = execution.marketEventsUnsupported ? [] : events;
        if (execution.factionsUnsupported && factions.length && unit !== shopBuyBreakdown(vendor, line.copper, cha, 1, { events: seen }).unit)
          throw Error(OLD_CLIENT_FACTION_PRICE);
      }
    }
    applyEstateCommand(t, seat, cmd as import("./estate-schema.ts").EstateCommand, at);
  } else if (cmd.kind === "listing-edit") {
    dm();
    const current = t.listings.find((listing) => listing.id === cmd.listingId) ?? null;
    if (!same(current, cmd.before))
      throw Error("This listing changed elsewhere. Reload before saving; your draft is retained.");
    if (
      cmd.after &&
      (cmd.after.id !== cmd.listingId || (current && current.kind !== cmd.after.kind))
    )
      throw Error("Listing identity and kind cannot change.");
    t.listings = [
      ...t.listings.filter((listing) => listing.id !== cmd.listingId),
      ...(cmd.after ? [cmd.after] : []),
    ];
    event(
      cmd.after
        ? `Listing saved: ${cmd.after.name}`
        : `Listing removed: ${current?.name || cmd.listingId}`,
    );
  } else if (cmd.kind === "property-profile") {
    dm();
    const h = t.holdings.find(
      (h) => h.id === cmd.holdingId && h.kind === "property" && h.quantity > 0,
    );
    if (!h) throw Error("Property no longer exists.");
    if (!same({ locationId: h.locationId ?? null, property: h.property ?? null }, cmd.before))
      throw Error("Property location or features changed elsewhere. Reload before saving.");
    if (journal.fleet?.vessels.some(v=>v.propertyId===h.id) && cmd.locationId!==(h.locationId??null)) throw Error("Use ship travel or DM Teleport Ship to move this vessel and its occupants.");
    if (cmd.locationId) h.locationId = cmd.locationId; else delete h.locationId;
    if (cmd.property) h.property = cmd.property; else delete h.property;
    event(`Property location and features saved: ${h.name}`, "management", h.purseId);
  } else if (cmd.kind === "resource-pack-import") {
    dm();
    if (resourceFingerprint(journal.resourceLibrary) !== cmd.before)
      throw Error("Resource packs changed elsewhere. Review a fresh preview.");
    const plan = previewResourcePack(journal.resourceLibrary, cmd.pack);
    if (plan.status === "Import") {
      journal.resourceLibrary = { packs: [...(journal.resourceLibrary?.packs ?? []), plan.pack] };
      event(`Resource pack imported: ${plan.pack.title}`);
      journal.events[journal.events.length - 1].dmOnly = true;
    }
  } else if (cmd.kind === "market-name-import") {
    dm();
    const market = readMarketLocations(journal.market);
    if (marketNameFingerprint(market, t.shops) !== cmd.before) throw Error("Location or shop names changed elsewhere. Review a fresh import preview.");
    // Settlement tiers: a new shop at a place with a profile (or in an area of one, including an
    // area this import adds) starts with its defaults. New cities and towns have no profile yet.
    const plan = previewMarketNames(market, t.shops, cmd.rows, cmd.id, (locationId, names) =>
      newShopDefaults({ settlements: journal.settlements, market: names }, locationId),
    );
    if (plan.locations.length || plan.shops.length) {
      journal.market = readMarketLocations({ ...market, locations: [...market.locations, ...plan.locations] });
      t.shops.push(...plan.shops);
      event(`Names imported: ${plan.locations.length} locations, ${plan.shops.length} shops`);
    }
  } else if (cmd.kind === "shop-location") {
    dm();
    const shop = t.shops.find((shop) => shop.id === cmd.shopId);
    if (!shop) throw Error("This shop no longer exists.");
    if (!same({ locationId: shop.locationId ?? null, image: shop.image ?? null }, cmd.before)) throw Error("This shop's location or image changed elsewhere. Refresh before saving.");
    if (cmd.locationId) shop.locationId = cmd.locationId; else delete shop.locationId;
    if (cmd.image) shop.image = cmd.image; else delete shop.image;
    event(`Shop location and image saved: ${shop.name}`);
  } else if (cmd.kind === "market-location") {
    dm();
    const market = readMarketLocations(journal.market);
    const current = market.locations.find((location) => location.id === cmd.locationId) ?? null;
    if (!same(current, cmd.before))
      throw Error("This location changed elsewhere. Refresh before saving.");
    if (cmd.after && cmd.after.id !== cmd.locationId)
      throw Error("Location identity cannot change.");
    if (
      !cmd.after &&
      (market.currentLocationId === cmd.locationId ||
        market.locations.some((location) => location.parentId === cmd.locationId) ||
        t.shops.some((shop) => shop.locationId === cmd.locationId) ||
        journal.world?.characterPositions.some(
          (s) => s.locationId === cmd.locationId || s.downtime?.returnLocationId === cmd.locationId,
        ) ||
        activeGroups(t).some((g) => g.locationId === cmd.locationId) ||
        journal.world?.groupRequests?.some((r) => r.status === "pending" && r.locationId === cmd.locationId) ||
        journal.fleet?.facilities.some(y=>y.locationId===cmd.locationId) ||
        journal.fleet?.voyages.some(v=>!["arrived","cancelled","dm-overridden","denied"].includes(v.status)&&(v.originId===cmd.locationId||v.destinationId===cmd.locationId)) ||
        journal.world?.npcs.some((n) => n.locationId === cmd.locationId) ||
        journal.world?.maps.some(
          (m) =>
            m.locationId === cmd.locationId ||
            m.anchors.some((a) => a.locationId === cmd.locationId),
        ) ||
        [...t.listings, ...t.holdings].some((property) => property.locationId === cmd.locationId))
    )
      throw Error(
        "Move the party, child locations, assigned shops and properties before removing this location.",
      );
    if (current?.kind === "city" && cmd.after?.kind !== "city") removeUnusedCityExchange(t, current);
    if (current?.kind === "city" && cmd.after?.kind === "city") renameUnusedCityExchange(t, current, cmd.after);
    market.locations = [
      ...market.locations.filter((location) => location.id !== cmd.locationId),
      ...(cmd.after ? [cmd.after] : []),
    ];
    journal.market = readMarketLocations(market);
    // Settlement tiers: a removed place, or one that is no longer a city or town, keeps no profile.
    if ((!cmd.after || !settlementKind(cmd.after)) && dropSettlementProfile(journal, cmd.locationId))
      journal.events.push({ id: cmd.id + "-event-" + journal.events.length, at, summary: `Settlement profile cleared: ${current?.name ?? "a removed place"}`, kind: "management", dmOnly: true });
    event(cmd.after ? `Location saved: ${cmd.after.name}` : "Location removed");
  } else if (cmd.kind === "party-location" && cmd.groupId && cmd.groupId !== MAIN_GROUP) {
    dm();
    applyGroupLocation(
      t,
      { ...cmd, groupId: cmd.groupId },
      (summary, purseId, dmOnly) =>
        journal.events.push({
          id: cmd.id + "-event-" + journal.events.length,
          at,
          summary,
          kind: "management",
          ...(purseId ? { purseId } : {}),
          ...(dmOnly ? { dmOnly: true } : {}),
        }),
      at,
    );
  } else if (cmd.kind === "party-location") {
    dm();
    const market = readMarketLocations(journal.market);
    if (market.currentLocationId !== cmd.before) throw Error("The party moved elsewhere. Refresh before changing location.");
    if (journal.world?.partyPosition && canonicalJson(journal.world.partyPosition) !== cmd.beforePosition) throw Error("The party travel position changed. Refresh before choosing a location.");
    if (journal.finance?.downtime.some(d=>d.status==="pending")) throw Error("Approve or cancel pending downtime before moving the party.");
    const travelling = travellingJourney(t, MAIN_GROUP);
    if (cmd.journeyId) {
      // "Move party here" on arrival: no time passes and nothing is charged.
      if (!travelling || travelling.id !== cmd.journeyId || travelling.status !== "arrived")
        throw Error("This journey hasn't arrived. Refresh before moving the party.");
      if (!cmd.locationId || (travelling.destinationLocationId && travelling.destinationLocationId !== cmd.locationId))
        throw Error("Move the party to the journey's destination, or stop the journey first.");
      travelling.status = "completed";
      travelling.decidedAt = at;
    } else if (travelling)
      throw Error(
        travelling.status === "arrived"
          ? "The party has arrived on a journey. Confirm Move party here, or stop the journey first."
          : "The party is on a journey. Stop it on the road before moving the party.",
      );
    if (journal.world) delete journal.world.partyPosition;
    journal.market = readMarketLocations({ ...market, currentLocationId: cmd.locationId });
    event(
      cmd.locationId
        ? `Party location: ${market.locations.find((location) => location.id === cmd.locationId)?.name}${cmd.journeyId ? " (journey arrived)" : ""}`
        : "Party location cleared; all shops available",
    );
  } else if (cmd.kind === "item-unidentify") {
    dm();
    const h = t.holdings.find((x) => x.id === cmd.holdingId);
    if (!h) throw Error("This item no longer exists.");
    if (h.kind !== "item" || h.deed || h.property || h.service) throw Error("Only an item can be unidentified.");
    if (!same(h.unidentified ?? null, cmd.before)) throw Error("What players are told about this item changed. Review it again.");
    if (same(h.unidentified ?? null, cmd.unidentified)) return t;
    // The server's lineage IDs stay with the item (identityLineage).
    h.unidentified = { ...cmd.unidentified, ...(h.unidentified?.ids ? { ids: h.unidentified.ids } : {}) };
    event(`${cmd.before ? "Unidentified item updated" : "Marked unidentified"}: ${h.name} (players see ${cmd.unidentified.name})`, "management", h.purseId);
    journal.events[journal.events.length - 1]!.dmOnly = true;
  } else if (cmd.kind === "item-identify") {
    dm();
    const h = t.holdings.find((x) => x.id === cmd.holdingId);
    if (!h) throw Error("This item no longer exists.");
    if (!isUnidentified(h)) throw Error("This item is already identified.");
    if (!same(h.unidentified, cmd.before)) throw Error("What players are told about this item changed. Review it again.");
    identifyHolding(t, h, cmd.id, at);
  } else if (cmd.kind === "property-details") {
    const h = t.holdings.find(
      (h) => h.id === cmd.holdingId && h.kind === "property" && h.quantity > 0,
    );
    if (!h) throw Error("Property no longer exists.");
    own(h.purseId);
    if (h.name !== cmd.before.name || h.notes !== cmd.before.notes) throw Error("Property details changed. Reload before saving.");
    h.name = cmd.name; h.notes = cmd.notes;
    event(`Property details updated: ${h.name}`, "management", h.purseId);
  } else if (cmd.kind === "shop-schedule") {
    const f = editableFinance();
    const shop = t.shops.find((s) => s.id === cmd.shopId);
    if (!shop) throw Error("Shop no longer exists.");
    if (cmd.schedule) {
      shop.schedule = { ...cmd.schedule, lastRestockDay: f.day };
      shop.closed = !shop.schedule.openDays.includes(f.day % shop.schedule.cycleDays);
    } else delete shop.schedule;
    event(`Shop schedule ${cmd.schedule ? "updated" : "disabled"}: ${shop.name}`);
  } else if (cmd.kind === "property-plan") {
    const f = editableFinance();
    const holding = t.holdings.find((h) => h.id === cmd.holdingId && h.kind === "property" && h.quantity > 0);
    if (!holding) throw Error("Choose an owned campaign property.");
    own(holding.purseId);
    if (f.rules.some((r) => r.holdingId === holding.id && r.estateOperation))
      throw Error(
        "This property has reviewed tenancy or staff contracts. Edit their terms in its Rent & operating finances or Staff & managers sections; generic property plans remain available for other holdings.",
      );
    for (const kind of ["income", "expense"] as const) {
      const copper = kind === "income" ? cmd.income : cmd.upkeep;
      const existing = f.rules.filter((r) => r.holdingId === holding.id && r.kind === kind);
      if (existing.length > 1) throw Error("This property has multiple schedules of the same type. Review them in Recurring revenue & expenses before using a property plan.");
      const prior = existing[0];
      if (prior && prior.purseId !== holding.purseId) throw Error("Settle the former owner's property agreements before transferring this plan.");
      if (prior?.carryDays && prior.periodDays !== cmd.periodDays) throw Error("Finish the current property period before changing its length.");
      if (!prior && !copper) continue;
      const next = {
        id: prior?.id || `${cmd.id}-${kind}`,
        propertyManaged: true,
        name: `${holding.name.slice(0, 80)}: ${kind === "income" ? "revenue" : "upkeep"}`,
        purseId: holding.purseId,
        kind,
        copper: copper || prior!.copper,
        periodDays: cmd.periodDays,
        holdingId: holding.id,
        active: cmd.active && copper > 0,
        carryDays: prior?.carryDays || 0,
        arrears: prior?.arrears || 0,
      };
      if (prior) Object.assign(prior, next);
      else f.rules.push(next);
    }
    event(`Property plan updated: ${holding.name}`, "management", holding.purseId);
  } else if (cmd.kind === "finance-loan") {
    const f = editableFinance();
    own(cmd.terms.purseId);
    if (cmd.terms.lenderId === cmd.terms.purseId)
      throw Error("Borrower and lender must be different accounts.");
    if (cmd.terms.lenderId) own(cmd.terms.lenderId);
    if (cmd.sourceLoanId) {
      const request = t.loans.find((l) => l.id === cmd.sourceLoanId && l.status === "approved");
      if (
        !request ||
        request.purseId !== cmd.terms.purseId ||
        request.copper !== cmd.principal ||
        cmd.terms.lenderId
      )
        throw Error(
          "Choose an approved legacy loan with the original borrower and amount, and an external lender.",
        );
      if (f.loans.some((l) => l.sourceLoanId === cmd.sourceLoanId))
        throw Error("This loan is already tracked.");
    } else {
      if (cmd.terms.lenderId)
        financeMove(
          t,
          cmd.terms.lenderId,
          -cmd.principal,
          cmd.id + "-lender",
          `${cmd.terms.name}: loan advanced`,
          at,
          true,
        );
      financeMove(
        t,
        cmd.terms.purseId,
        cmd.principal,
        cmd.id + "-borrower",
        `${cmd.terms.name}: loan received`,
        at,
        !!cmd.terms.lenderId,
      );
      if (!cmd.terms.lenderId) t.ledger[t.ledger.length - 1].transactionType = "loan";
    }
    f.loans.push({
      ...loanFromRequest({
        id: cmd.id,
        purseId: cmd.terms.purseId,
        note: cmd.terms.name,
        copper: cmd.principal,
      }),
      ...cmd.terms,
      id: cmd.id,
      sourceLoanId: cmd.sourceLoanId,
    });
    event(`Loan recorded: ${cmd.terms.name}`, "management", cmd.terms.purseId);
  } else if (cmd.kind === "finance-terms") {
    const f = editableFinance(),
      l = f.loans.find((l) => l.id === cmd.loanId);
    if (!l) throw Error("Loan not found.");
    if (l.purseId !== cmd.terms.purseId || l.lenderId !== cmd.terms.lenderId)
      throw Error("Borrower and lender cannot change after a loan is recorded.");
    if (l.carryDays && l.periodDays !== cmd.terms.periodDays)
      throw Error("Finish the current interest period before changing its length.");
    Object.assign(l, cmd.terms);
    event(`Loan terms updated: ${l.name}`, "management", l.purseId);
  } else if (cmd.kind === "finance-repay" || cmd.kind === "bank-repay") {
    const f = cmd.kind === "finance-repay" ? editableFinance() : finance(),
      l = f.loans.find((l) => l.id === cmd.loanId);
    if (!l || cmd.copper > l.principal + l.interest)
      throw Error("Repayment exceeds the outstanding debt.");
    own(l.purseId);
    if (f.downtime.some((d) => d.status === "pending"))
      throw Error("The DM must settle or cancel pending downtime before repayment.");
    financeMove(t, l.purseId, -cmd.copper, cmd.id, `${l.name}: manual repayment`, at, !!l.lenderId);
    if (l.lenderId)
      financeMove(
        t,
        l.lenderId,
        cmd.copper,
        cmd.id + "-lender",
        `${l.name}: repayment received`,
        at,
        true,
      );
    const interest = Math.min(l.interest, cmd.copper);
    l.interest -= interest;
    l.principal -= cmd.copper - interest;
    l.due = Math.max(0, l.due - cmd.copper);
    l.paid += cmd.copper;
    event(`Loan repaid: ${l.name}`, "management", l.purseId);
  } else if (cmd.kind === "finance-rule") {
    const f = editableFinance();
    own(cmd.rule.purseId);
    if (
      cmd.rule.holdingId &&
      !t.holdings.some((h) => h.id === cmd.rule.holdingId && h.purseId === cmd.rule.purseId)
    )
      throw Error("Choose inventory owned by this campaign account.");
    const prior = f.rules.find((r) => r.id === cmd.rule.id);
    if (prior?.estateOperation || cmd.rule.estateOperation) throw Error("Reviewed property schedules follow their tenancy or staff contract. Edit that contract in Property Management, or use Settle arrears for an outstanding expense.");
    if (prior && prior.purseId !== cmd.rule.purseId)
      throw Error("Keep the original account; create a new schedule to use another account.");
    if (prior && prior.kind !== cmd.rule.kind)
      throw Error("Create a new schedule to change between income and expense.");
    if (prior?.carryDays && prior.periodDays !== cmd.rule.periodDays)
      throw Error("Finish the current period before changing its length.");
    const next = { ...cmd.rule, carryDays: prior?.carryDays ?? 0, arrears: prior?.arrears ?? 0 };
    if (prior) Object.assign(prior, next);
    else f.rules.push(next);
    event(`Finance schedule updated: ${cmd.rule.name}`, "management", cmd.rule.purseId);
  } else if (cmd.kind === "reference-policy") {
    dm();
    if (canonicalJson(referencePolicy(journal.referenceAccess)) !== canonicalJson(cmd.before))
      throw Error("Reference access changed. Review the current controls before saving.");
    journal.referenceAccess = cmd.policy;
    event("Player reference access updated", "management");
  } else if (cmd.kind === "downtime-preference") {
    dm();
    journal.downtimePrompt = { enabled: cmd.days > 0, days: cmd.days };
  } else if (cmd.kind === "downtime-plan") {
    dm();
    const f = finance();
    if (cmd.advanceSeason) {
      if (journal.tradeEconomy?.pendingSeason) throw Error("Cancel the manual seasonal preview before preparing seasonal downtime.");
      if (journal.tradeEconomy?.settings.enabled) prepareTradeSeason(t, execution);
    }
    // The one-click approval hashes its quote from the table in ID order (screens sort by name).
    const ordered = cmd.expectedQuoteHash ? orderedTable(structuredClone(t)) : undefined;
    // A journey is frozen (route, scale, duration, travellers, prices) when it is reviewed.
    const moving = [...(cmd.journeyId ? [cmd.journeyId] : []), ...(cmd.journeyIds ?? [])];
    if (new Set(moving).size !== moving.length) throw Error("Choose each journey once.");
    if (cmd.journeyIds?.length && !cmd.journeyId) throw Error("Choose the journey to review first.");
    for (const journeyId of moving) prepareJourneyPlan(t, journeyId);
    const quote = previewDowntime(t, f, cmd.days, undefined, cmd.advanceSeason ? cmd.id : undefined, cmd.journeyId, cmd.journeyIds);
    if (cmd.expectedQuoteHash && quoteHash(quote) !== cmd.expectedQuoteHash) {
      for (const journeyId of moving) prepareJourneyPlan(ordered!, journeyId);
      const same = previewDowntime(ordered!, readFinance(ordered!.journal?.finance), cmd.days, undefined, cmd.advanceSeason ? cmd.id : undefined, cmd.journeyId, cmd.journeyIds);
      if (quoteHash(same) !== cmd.expectedQuoteHash)
        throw Error("Something changed since this request was drawn up (balances, the route's map or a pending preview). Open the full review.");
    }
    journal.downtimePrompt = { enabled: true, days: cmd.days };
    for (const d of f.downtime) if (d.status === "pending") d.status = "cancelled";
    f.downtime.push({
      id: cmd.id,
      name: cmd.name,
      days: cmd.days,
      fromDay: f.day,
      at,
      status: "pending",
      quote,
    });
    event(`Prepared ${cmd.days} in-game downtime days for DM review`);
  } else if (cmd.kind === "downtime-cancel") {
    dm();
    const d = finance().downtime.find((d) => d.id === cmd.downtimeId);
    if (!d || d.status !== "pending") throw Error("This downtime is already decided.");
    d.status = "cancelled";
    event("Cancelled pending downtime; no funds moved");
  } else if (cmd.kind === "downtime-apply") {
    dm();
    const active = journal.sessions.find((s) => !s.endedAt);
    if (cmd.endSession && !active) throw Error("There is no recorded session to end.");
    applyDowntime(t, cmd.downtimeId, active?.id ?? cmd.id, at);
    event("Applied approved downtime and seasonal settlement once", "session");
    if (cmd.endSession && active) {
      active.endedAt = at;
      active.endLedgerIds = t.ledger.map((l) => l.id);
      archiveSession(t, active.id, active.name, at);
      journal = t.journal!;
    }
  } else if (cmd.kind === "post") {
    // The DM's ledger posting (Party → Record a payment, Activity adjustments): one payment line.
    dm();
    const p = t.purses.find((x) => x.id === cmd.purseId);
    if (!p) throw new Error("This account no longer exists.");
    const next = toCopper(p.coins) + cmd.copper;
    if (!Number.isSafeInteger(next) || next < 0 || next > 1e12) throw new Error("Insufficient funds.");
    const add = fromCopper(Math.max(0, cmd.copper));
    p.coins =
      cmd.copper < 0
        ? spendCoins(p.coins, -cmd.copper)!
        : { cp: p.coins.cp + add.cp, sp: p.coins.sp + add.sp, ep: p.coins.ep + add.ep, gp: p.coins.gp + add.gp, pp: p.coins.pp + add.pp };
    t.ledger.push({ id: cmd.id, at, purseId: p.id, shopId: null, summary: cmd.summary, copper: cmd.copper, transactionType: "payment" });
  } else if (cmd.kind === "set-coins") {
    // The DM's direct coin edit: the new coins, and one adjustment line for any change of worth.
    dm();
    const p = t.purses.find((x) => x.id === cmd.purseId);
    if (!p) throw new Error("This account no longer exists.");
    if (!sameCoins(p.coins, cmd.before)) throw new Error("These coins changed. Review the purse and try again.");
    assertCoinEditWithinLimit(p.coins, cmd.coins);
    const delta = toCopper(cmd.coins) - toCopper(p.coins);
    p.coins = { cp: cmd.coins.cp, sp: cmd.coins.sp, ep: cmd.coins.ep, gp: cmd.coins.gp, pp: cmd.coins.pp };
    if (delta !== 0)
      t.ledger.push({
        id: cmd.id,
        at,
        purseId: p.id,
        shopId: null,
        summary: cmd.summary?.trim() || `Adjusted coin in ${p.name}`,
        copper: delta,
        transactionType: "adjustment",
      });
  } else if (attunementKinds.has(cmd.kind)) {
    // The controlling player or the DM; past the limit and the limit itself: the DM. One journal
    // event for the character's purse, which players see only for purses they hold (projectRecord).
    applyAttunementCommand(t, cmd as AttunementCommand, seat, { dm, own, assertCarried }, event);
  } else if (cmd.kind === "xp-award") {
    // DM only (checked in applyXpAward). One journal entry lists who got what; like a coin split,
    // it is DM-only text when an NPC is among the recipients.
    const plan = applyXpAward(t, seat, cmd);
    event(xpAwardSummary(plan, cmd.reason), "management");
    if (plan.npc) journal.events[journal.events.length - 1]!.dmOnly = true;
  } else if (cmd.kind === "coin-exchange") {
    // Owner or DM; the same rule as spending from the purse. Recorded as the purse's own activity,
    // which players see only for purses they hold (projectRecord).
    const p = own(cmd.purseId);
    if (!sameCoins(p.coins, cmd.before)) throw Error("These coins changed. Review the purse and try again.");
    if (toCopper(cmd.after) !== toCopper(cmd.before)) throw Error("Making change can't change what the coins are worth.");
    if (sameCoins(cmd.before, cmd.after)) throw Error("Choose coins to exchange.");
    p.coins = { cp: cmd.after.cp, sp: cmd.after.sp, ep: cmd.after.ep, gp: cmd.after.gp, pp: cmd.after.pp };
    event(`${p.name} made change: ${exchangeSummary(cmd.before, cmd.after)}`, "management", p.id);
  } else if (factionKinds.has(cmd.kind)) {
    // DM only; definitions are revision-checked; one history event per character changed.
    applyFactionCommand(t, seat, cmd as FactionCommand, (summary, options) =>
      journal.events.push({
        id: cmd.id + "-event-" + journal.events.length,
        at,
        summary,
        kind: "management",
        ...(options.purseId ? { purseId: options.purseId } : {}),
        ...(options.dmOnly ? { dmOnly: true } : {}),
        ...(options.factionId ? { factionId: options.factionId } : {}),
      }),
    );
  } else if (settlementKinds.has(cmd.kind)) {
    // DM only; checked against what the DM saw; one DM-only history line. Shops are never touched.
    applySettlementCommand(t, seat, cmd as SettlementCommand, (summary) =>
      journal.events.push({ id: cmd.id + "-event-" + journal.events.length, at, summary, kind: "management", dmOnly: true }),
    );
  } else if (shopListKinds.has(cmd.kind)) {
    // DM only; checked against the stock and list the DM saw; one DM-only history line. A swap
    // replaces only the shop's stock lines (and saves the outgoing stock) — never coins or purses.
    applyShopListCommand(t, seat, cmd as ShopListCommand, (summary) =>
      journal.events.push({ id: cmd.id + "-event-" + journal.events.length, at, summary, kind: "management", dmOnly: true }),
    );
  } else if (favorKinds.has(cmd.kind)) {
    // Spending Favor: players ask for their own characters; the DM approves (spends once, never
    // below 0), declines or records a purchase. One history event on the character's purse.
    applyFavorCommand(t, seat, cmd as FavorCommand, at, (summary, options) =>
      journal.events.push({
        id: cmd.id + "-event-" + journal.events.length,
        at,
        summary,
        kind: options.purseId ? "request" : "management",
        ...(options.purseId ? { purseId: options.purseId } : {}),
        ...(options.dmOnly ? { dmOnly: true } : {}),
        ...(options.factionId ? { factionId: options.factionId } : {}),
      }),
    );
  } else if (marketEventKinds.has(cmd.kind)) {
    // DM only; stale-checked; one DM-only journal event (upcoming events are not spoiled).
    applyMarketEventCommand(t, cmd as MarketEventCommand, dm, (summary) =>
      journal.events.push({ id: cmd.id + "-event-" + journal.events.length, at, summary, kind: "prices", dmOnly: true }),
    );
  } else if (cmd.kind === "item-use" || cmd.kind === "item-recharge") {
    // The controlling player or the DM (pooled items and Recharge: the DM); one journal event
    // keyed by the command ID, which players see only for purses they hold (projectRecord).
    applyItemUseCommand(t, cmd, { dm, own, assertCarried }, event);
  } else if (cmd.kind === "journal-note") {
    if (cmd.provenance || cmd.visibility === "dm") dm();
    // A shared session recap (session-recap.ts): the DM's own words, posted once per session.
    if (isRecapEntryId(cmd.id)) {
      dm();
      if (cmd.visibility !== "party" || cmd.purseId || cmd.reportIds.length || cmd.questId || cmd.provenance)
        throw Error("A session recap is shared as a party journal entry.");
      if (!journal.sessions.some((session) => recapEntryId(session.id) === cmd.id))
        throw Error("Choose an existing campaign session for this recap.");
      if (journal.entries?.some((entry) => entry.id === cmd.id))
        throw Error("This session's recap is already shared.");
    }
    if (seat.role !== "dm" || cmd.visibility === "player") {
      const p = own(cmd.purseId);
      if (p.kind !== "character") throw Error("Choose your character.");
    }
    if (cmd.reportIds.some((id) => !journal.reports?.some((r) => r.id === id)))
      throw Error("Session report not found.");
    if (cmd.questId) {
      const quest = questsOf(t).find((q) => q.id === cmd.questId);
      if (!quest || !questReadable(t, quest, seat)) throw Error("This quest is not in your quest log.");
      if (cmd.provenance) throw Error("A loot summary cannot be a quest note.");
    }
    if (cmd.provenance) {
      dm();
      if (cmd.visibility !== "party" || cmd.purseId || cmd.reportIds.length)
        throw Error("A loot summary must be a party journal entry without private attachments.");
      if (
        cmd.provenance.sessionId &&
        !journal.sessions.some((session) => session.id === cmd.provenance!.sessionId)
      )
        throw Error("Choose an existing campaign session for this loot summary.");
      const existing = journal.entries?.find(
        (entry) => entry.provenance?.receiptId === cmd.provenance!.receiptId,
      );
      if (existing) {
        if (existing.provenance?.encounterId !== cmd.provenance.encounterId)
          throw Error("This award receipt already belongs to another encounter summary.");
        return t;
      }
      const entryId = encounterLootEntryId(cmd.provenance.receiptId);
      if (journal.entries?.some((entry) => entry.id === entryId))
        throw Error("This journal entry identity already exists.");
      (journal.entries ??= []).push({ ...cmd, id: entryId, at, authorId: seat.id });
    } else (journal.entries ??= []).push({ ...cmd, at, authorId: seat.id });
  } else if (cmd.kind === "character-permission") {
    dm();
    const p = own(cmd.purseId);
    if (p.kind !== "character") throw Error("Choose a character.");
    (p.permissions ??= {})[cmd.permission] = cmd.allowed;
    event(
      `${p.name}: ${characterPermissions[cmd.permission]} ${cmd.allowed ? "allowed" : "restricted"}`,
      "management",
      p.id,
    );
  } else if (cmd.kind === "character-editing") {
    dm();
    const p = own(cmd.purseId);
    if (p.kind !== "character") throw Error("Choose a character.");
    if (p.editingAllowed === cmd.allowed) return t;
    const sheet = characterSheet(
      p,
      t.holdings,
      t.sheets.find((s) => s.purseId === p.id),
    );
    if (cmd.allowed) p.editBaseline = sheet;
    else {
      const before = p.editBaseline || sheet;
      (journal.editReports ??= []).push({
        id: cmd.id,
        purseId: p.id,
        name: p.name,
        at,
        before,
        after: sheet,
      });
      delete p.editBaseline;
    }
    p.editingAllowed = cmd.allowed;
    event(
      `${p.name}: character editing ${cmd.allowed ? "opened" : "closed; change report saved"}`,
      "management",
      p.id,
    );
  } else if (cmd.kind === "character") {
    editCharacter(t, seat, cmd, cmd.id, at);
    event(
      `Character sheet updated: ${t.purses.find((p) => p.id === cmd.purseId)?.name}`,
      "management",
      cmd.purseId,
    );
  } else if (cmd.kind === "portrait") {
    const p = own(cmd.purseId);
    if (seat.role !== "dm" && !canEditCharacterField(p, "portrait"))
      throw Error("Character editing is locked. Ask the DM to open editing.");
    p.portrait = cmd.portrait;
    if (p.sheet) p.sheet.portrait = cmd.portrait;
    p.sheetRevision = (p.sheetRevision || 0) + 1;
  } else if (cmd.kind === "session") {
    dm();
    const active = journal.sessions.find((x) => !x.endedAt);
    if (active) {
      active.endedAt = at;
      active.endLedgerIds = t.ledger.map((x) => x.id);
      archiveSession(t, active.id, active.name, at);
      journal = t.journal!;
    }
    if (
      !cmd.end &&
      journal.finance?.downtime.some((d) => d.status === "pending") &&
      !cmd.downtimeId
    )
      throw Error(
        "Review and approve or cancel pending downtime before starting the next session.",
      );
    if (cmd.end && cmd.downtimeId) throw Error("Approve downtime when starting the next session.");
    if (!cmd.end)
      journal.sessions.push({
        id: cmd.id,
        name: cmd.name,
        startedAt: at,
        startLedgerIds: t.ledger.map((x) => x.id),
      });
    if (!cmd.end && cmd.downtimeId) {
      applyDowntime(t, cmd.downtimeId, cmd.id, at);
      event("Applied approved downtime finances once", "session");
    }
    event(
      cmd.end ? `Ended session: ${active?.name ?? cmd.name}` : `Started session: ${cmd.name}`,
      "session",
    );
  } else if (cmd.kind === "payment-request") {
    const p = own(cmd.purseId);
    // One row per ID: a duplicate would stay pending for good (decisions find the first; audit A2).
    if (journal.requests.some((r) => r.id === cmd.id))
      throw new Error("That payment request ID already identifies a different request.");
    journal.requests.push({
      id: cmd.id,
      at,
      purseId: p.id,
      copper: cmd.copper,
      note: cmd.note,
      status: "pending",
    });
    event(`${p.name} submitted a payment request`, "request", p.id);
  } else if (cmd.kind === "payment-decision") {
    dm();
    const r = journal.requests.find((x) => x.id === cmd.requestId);
    if (!r || r.status !== "pending")
      throw new Error("This request is missing or already decided.");
    if (cmd.status === "approved") {
      coins(r.purseId, -r.copper);
      log(r.purseId, `Payment approved: ${r.note}`, -r.copper);
    }
    r.status = cmd.status;
    event(`Payment request ${cmd.status}`, "request", r.purseId);
  } else if (cmd.kind === "restock") {
    dm();
    const shop = t.shops.find((x) => x.id === cmd.shopId);
    if (!shop) throw new Error("Shop no longer exists.");
    for (const line of t.stock.filter((x) => x.shopId === shop.id && x.quantity !== null)) {
      if (line.quantity! + cmd.quantity > 100000) throw new Error("Stock quantity is too large.");
      line.quantity! += cmd.quantity;
    }
    event(`Restocked ${shop.name}: +${cmd.quantity} per finite stock line`);
    // The DM's Restock also refills a merchant purse to its refill amount (DM-only event).
    const refill = merchantRefill(shop);
    if (refill) {
      shop.merchantPurse = refill.after;
      journal.events.push({
        id: `${cmd.id}-purse`,
        at,
        kind: "management",
        dmOnly: true,
        summary: `${shop.name}: merchant purse refilled ${formatCopper(refill.before)} → ${formatCopper(refill.after)}`,
      });
    }
  } else if (cmd.kind === "buy") {
    own(cmd.purseId);
    const s = t.stock.find((x) => x.id === cmd.stockId),
      shop = t.shops.find((x) => x.id === s?.shopId);
    if (!s || !shop) throw new Error("Item or shop no longer exists.");
    if (seat.role === "player" && !shopVisible(shop, t, actingGroups(t, cmd.purseId, seat.purseIds))) throw Error(notHere(cmd.purseId, "This shop"));
    if (shop.blackMarket && !journal.world?.blackMarketActive) throw Error("This black-market vendor is hidden.");
    if (shop.closed) throw new Error("This shop is closed.");
    if (s.quantity !== null && s.quantity < cmd.quantity)
      throw new Error("Not enough stock. Refresh and choose a smaller quantity.");
    // Named market events apply at read time, exactly as the shop's Why this price? shows them.
    const events = lineEvents(journal, shop, s);
    // Factions controlling the shop, by the party's tier (factions.ts), in the same pipeline.
    const factions = factionEffects(journal, t.purses, shop);
    const cost = shopBuyBreakdown(shop, s.copper, score(cmd.purseId), cmd.quantity, { events, factions }).total;
    // An older app showed the price without them: refused rather than charged a price it never saw.
    if (execution.marketEventsUnsupported && events.length && cost !== shopBuyBreakdown(shop, s.copper, score(cmd.purseId), cmd.quantity, { factions }).total)
      throw Error(OLD_CLIENT_EVENT_PRICE);
    if (
      execution.factionsUnsupported &&
      factions.length &&
      cost !== shopBuyBreakdown(shop, s.copper, score(cmd.purseId), cmd.quantity, { events: execution.marketEventsUnsupported ? [] : events }).total
    )
      throw Error(OLD_CLIENT_FACTION_PRICE);
    coins(cmd.purseId, -cost);
    creditMerchant(shop, cost);
    if (s.quantity !== null) s.quantity -= cmd.quantity;
    const purchasedHolding: import("./types.ts").Holding | null = isService(s)
      ? null
      : {
          id: cmd.id + "-item",
          purseId: cmd.purseId,
          category: stockCategory(s, shop),
          name: s.name,
          kind: "item",
          quantity: cmd.quantity,
          unitCopper: s.copper,
          notes: s.notes,
          // Open5e goods carry "Requires attunement" in their notes (attunement.ts).
          ...attunementFromNotes(s.notes),
          ...(s.commodityId
            ? {
                commodityId: s.commodityId,
                weight: journal.tradeEconomy?.commodities.find((c) => c.id === s.commodityId)
                  ?.weight,
                ...(journal.tradeEconomy?.commodities.find((c) => c.id === s.commodityId)
                  ?.materialKey
                  ? {
                      materialKey: journal.tradeEconomy!.commodities.find(
                        (c) => c.id === s.commodityId,
                      )!.materialKey,
                    }
                  : {}),
              }
            : {}),
        };
    if (purchasedHolding) t.holdings.push(purchasedHolding);
    log(cmd.purseId, `Bought ${cmd.quantity} ${s.name} from ${shop.name}`, -cost, shop.id);
    const purchase = t.ledger[t.ledger.length - 1];
    purchase.purchase = { stockId: s.id, quantity: cmd.quantity, holding: structuredClone(purchasedHolding) };
    const receipt = recordShopTrade(t, { id: cmd.id, at, stockId: s.id, purseId: cmd.purseId, direction: "buy", quantity: cmd.quantity, copper: cost });
    if (receipt) purchase.trade = { receiptId: receipt.id, leg: "owner" };
  } else if (cmd.kind === "listing") {
    own(cmd.purseId);
    const l = t.listings.find((x) => x.id === cmd.listingId);
    if (!l) throw new Error("Listing no longer exists.");
    if (cmd.before && !same(l, cmd.before)) throw Error("This listing changed. Review its current price and details before buying.");
    if (l.kind === "property" && l.status && l.status !== "available") throw Error("This property is not currently for sale.");
    if (seat.role === "player" && !propertyAvailableToGroups(l, t, actingGroups(t, cmd.purseId, seat.purseIds)))
      throw Error(notHere(cmd.purseId, "This property"));
    if (l.quantity !== null && l.quantity < cmd.quantity)
      throw new Error("Not enough listing stock.");
    const cost = listingBreakdown(l.copper, score(cmd.purseId), cmd.quantity).total;
    coins(cmd.purseId, -cost);
    if (l.quantity !== null) l.quantity -= cmd.quantity;
    const holding: import("./types.ts").Holding = {
      id: cmd.id + "-item",
      purseId: cmd.purseId,
      name: l.name,
      kind: l.kind,
      quantity: cmd.quantity,
      unitCopper: l.copper,
      notes: l.notes,
      ...(l.locationId ? { locationId: l.locationId } : {}),
      ...(l.property
        ? {
            property: structuredClone(l.property),
            ...(l.property.images?.[0] ? { image: l.property.images[0] } : {}),
          }
        : {}),
      ...(l.kind === "property"
        ? {
            deed: {
              id: cmd.id + "-deed",
              transactionId: cmd.id,
              listingId: l.id,
              propertyName: l.name,
              location: locationLabel(readMarketLocations(journal.market), l.locationId),
              buyerId: cmd.purseId,
              buyerName: t.purses.find((p) => p.id === cmd.purseId)!.name,
              ownerId: cmd.purseId,
              ownerName: t.purses.find((p) => p.id === cmd.purseId)!.name,
              purchasedAt: at,
              campaignDay: readFinance(journal.finance).day,
              unitCopper: cost / cmd.quantity,
              totalCopper: cost,
              purchasedQuantity: cmd.quantity,
            },
          }
        : {}),
    };
    t.holdings.push(holding);
    if (holding.kind === "property") initializeEstatePurchase(t, holding, l.estateTemplateKey, l.estateAttachments);
    log(cmd.purseId, `Bought ${cmd.quantity} ${l.name} from the market`, -cost);
    t.ledger[t.ledger.length - 1].listingPurchase = { listingId: l.id, quantity: cmd.quantity, holding: structuredClone(holding) };
  } else if (cmd.kind === "sell") {
    const h = t.holdings.find((x) => x.id === cmd.holdingId),
      s = t.shops.find((x) => x.id === cmd.shopId);
    if (!h || !s) throw new Error("Item or shop no longer exists.");
    if (seat.role === "player" && !shopVisible(s, t, actingGroups(t, h.purseId, seat.purseIds))) throw Error(notHere(h.purseId, "This shop"));
    if (s.blackMarket && !journal.world?.blackMarketActive) throw Error("This black-market vendor is hidden.");
    if (s.closed) throw new Error("This shop is closed.");
    own(h.purseId);
    assertCarried(h);
    if (h.kind === "property") assertEstateDisposable(t, h.id);
    assertMerchantSale(h, s);
    if (h.quantity < cmd.quantity) throw new Error("Not enough items to sell.");
    // An unidentified item sells at its presented value and category (shopSellBreakdown), with
    // today's market events for that category, exactly as the shop's Why this payout? shows.
    const shown = presentedHolding(h);
    const events = saleEvents(journal, s, h);
    const factions = factionEffects(journal, t.purses, s);
    // Settlement limits (settlements.ts, S2): refused above the place's per-item limit, or paid at it.
    // The DM's seat is exempt (owner decision 2026-11-10): full payout, decided by the seat's role,
    // never by a command field. The shop's own per-item limit and merchant purse still apply.
    // For the DM the cap changes no payout, so an older DM app shows the right price and the
    // old-client checks below compare without it.
    const seller = seat.role === "dm" ? "dm" : "player";
    const settlementLimit = seller === "dm" ? undefined : settlementSaleLimit(journal, s);
    const priced = shopSale(h, s, cmd.quantity, journal, t.purses, seller, t.sheets);
    if (priced.refused) throw Error(priced.refused);
    const paid = priced.total;
    if (execution.settlementLimitsUnsupported && settlementLimit && paid !== shopSellBreakdown(s, h.unitCopper, cmd.quantity, h, { events, factions }).total)
      throw Error(OLD_CLIENT_SETTLEMENT_PRICE);
    if (execution.marketEventsUnsupported && events.length && paid !== shopSellBreakdown(s, h.unitCopper, cmd.quantity, h, { factions, settlementLimit }).total)
      throw Error(OLD_CLIENT_EVENT_PRICE);
    if (
      execution.factionsUnsupported &&
      factions.length &&
      paid !== shopSellBreakdown(s, h.unitCopper, cmd.quantity, h, { events: execution.marketEventsUnsupported ? [] : events, settlementLimit }).total
    )
      throw Error(OLD_CLIENT_FACTION_PRICE);
    // Merchant purse: the shop pays from it, or the whole sale is refused.
    merchantPays(s, paid);
    coins(h.purseId, paid);
    h.quantity -= cmd.quantity;
    t.holdings = t.holdings.filter((x) => x.quantity > 0);
    log(h.purseId, `Sold ${cmd.quantity} ${shown.name} to ${s.name}`, paid, s.id);
    const linked = t.stock.find(
      (line) => line.shopId === s.id && line.commodityId === shown.commodityId && shown.commodityId,
    );
    if (linked) {
      const receipt = recordShopTrade(t, { id: cmd.id, at, stockId: linked.id, purseId: h.purseId, direction: "sell", quantity: cmd.quantity, copper: paid });
      if (receipt) t.ledger[t.ledger.length - 1].trade = { receiptId: receipt.id, leg: "owner" };
    }
    if (h.kind === "property" && h.quantity === 0) removeEstateSite(t, h.id);
  } else if (cmd.kind === "give") {
    own(cmd.fromId);
    // A player may pay only a purse their own view lists (audit 2026-11-10, B2): a hidden NPC or
    // exchange treasury is refused exactly as an unknown ID, before anything moves.
    if (
      cmd.fromId === cmd.toId ||
      !t.purses.some((x) => x.id === cmd.toId) ||
      (seat.role !== "dm" && !recipientListed(t, seat, cmd.toId, execution.preview === true))
    )
      throw new Error("Choose a different recipient.");
    if (!cmd.copper && !cmd.holdingId) throw new Error("Choose coins or an item to transfer.");
    coins(cmd.fromId, -cmd.copper);
    coins(cmd.toId, cmd.copper);
    if (cmd.holdingId) {
      const h = t.holdings.find((x) => x.id === cmd.holdingId && x.purseId === cmd.fromId);
      if (!h || cmd.quantity < 1 || h.quantity < cmd.quantity)
        throw new Error("Not enough items to transfer.");
      assertCarried(h);
      if (h.kind === "property") assertEstateDisposable(t, h.id);
      h.quantity -= cmd.quantity;
      t.holdings.push({
        ...h,
        id: cmd.id + "-item",
        purseId: cmd.toId,
        quantity: cmd.quantity,
        // Charges: a partly used current item stays with the giver while any of the stack stays.
        ...movedUses(h, h.quantity),
        ...(h.deed
          ? {
              deed: transferPropertyDeed(
                h.deed,
                t.purses.find((p) => p.id === cmd.toId)!,
                cmd.id,
                at,
              ),
            }
          : {}),
      });
      t.holdings = t.holdings.filter((x) => x.quantity > 0);
      if (h.kind === "property" && t.journal?.propertyOperations) {
        const site = t.journal.propertyOperations.sites.find((s) => s.propertyId === h.id);
        if (site && h.quantity === 0) site.propertyId = cmd.id + "-item";
        if (h.quantity === 0 && journal.fleet) {
          for(const v of journal.fleet.vessels) if(v.propertyId===h.id)v.propertyId=cmd.id+"-item";
          for(const y of journal.fleet.facilities) if(y.propertyId===h.id)y.propertyId=cmd.id+"-item";
        }
      }
    }
    log(cmd.fromId, "Transfer sent", -cmd.copper);
    log(cmd.toId, "Transfer received", cmd.copper, null, "-received");
    // A transfer to an NPC, an exchange treasury or a hidden character posts its note to the DM
    // only, filed under that account, as coin-split and sale-split do (audit 2026-11-10, B2).
    const recipient = t.purses.find((p) => p.id === cmd.toId)!;
    const private_ = recipientPrivate(t, recipient);
    t.notes.push({
      id: cmd.id + "-note",
      at,
      from: seat.role,
      to: private_ ? "dm" : "party",
      purseId: private_ ? recipient.id : cmd.fromId,
      text: `${seat.name} transferred ${cmd.copper} cp${cmd.holdingId ? " and items" : ""} to ${t.purses.find((p) => p.id === cmd.toId)?.name}.`,
    });
  } else if (cmd.kind === "coin-split") {
    // Whoever may give from the source may split it (DM, controller or shared-fund permission).
    const source = own(cmd.sourceId);
    if (cmd.makeDefault) dm();
    const plan = planCoinSplit(
      t,
      {
        sourceId: source.id,
        copper: cmd.copper,
        recipientIds: cmd.recipientIds,
        rule: cmd.remainder.rule,
        ...(cmd.remainder.purseId ? { purseId: cmd.remainder.purseId } : {}),
      },
      // A player's client previews pending commands on its projected table (cloud-client.ts).
      { actor: seat.role === "dm" ? "dm" : "player", projected: execution.preview === true && seat.role !== "dm" },
    );
    if (plan.share !== cmd.expect.share || plan.remainderTo !== cmd.expect.remainderTo)
      throw Error(
        "The split changed (the party fund, rotation or recipients moved). Review it again.",
      );
    applyFundSplit(t, plan, cmd.id, at, execution.preview === true && seat.role !== "dm");
    const settings = (journal.coinSplit ??= {});
    if (plan.rotation) settings.rotation = { lastPurseId: plan.rotation };
    if (cmd.makeDefault) {
      settings.remainderRule = cmd.remainder.rule;
      if (
        cmd.remainder.rule === "party-fund" &&
        cmd.remainder.purseId &&
        partyFunds(t).some((p) => p.id === cmd.remainder.purseId)
      )
        settings.partyFundId = cmd.remainder.purseId;
    }
    if (!Object.keys(settings).length) delete journal.coinSplit;
    const name = (purseId: string) => t.purses.find((p) => p.id === purseId)?.name ?? "an account";
    const names = plan.recipientIds.map(name);
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    event(
      `Coin split from ${source.name}: ${formatCopper(plan.copper)} among ${plan.n}`,
      "management",
      source.id,
    );
    const receipt = journal.events[journal.events.length - 1]!;
    receipt.split = {
      id: cmd.id,
      sourceId: source.id,
      copper: plan.copper,
      share: plan.share,
      n: plan.n,
      remainder: plan.remainder,
      remainderTo: plan.remainderTo,
      rule: plan.rule,
      recipientIds: plan.recipientIds,
    };
    // A split that pays an NPC is DM-only text; party members still see their own lines.
    if (plan.npc) receipt.dmOnly = true;
    // Chat keeps 500 characters; a long roster is summarized by count rather than cut off.
    const leftover = remainderText(plan, name);
    const full = [`Split ${formatCopper(plan.copper)} from ${source.name}: ${formatCopper(plan.share)} each to ${list}.`, leftover]
      .filter(Boolean)
      .join(" ");
    const text =
      full.length <= 500
        ? full
        : [`Split ${formatCopper(plan.copper)} from ${source.name}: ${formatCopper(plan.share)} each to ${plan.n} characters.`, leftover]
            .filter(Boolean)
            .join(" ")
            .slice(0, 500);
    // A split that pays an NPC posts its note to the DM only (filed under that NPC's account).
    const npcId = plan.recipientIds.find((purseId) => {
      const p = t.purses.find((p) => p.id === purseId);
      return p?.kind === "character" && (p.control === "npc" || !!journal.world?.npcs.some((n) => n.id === p.id));
    });
    t.notes.push({
      id: cmd.id + "-note",
      at,
      from: seat.role,
      to: plan.npc ? "dm" : "party",
      purseId: plan.npc && npcId ? npcId : source.id,
      text,
    });
  } else if (cmd.kind === "sale-split") {
    // One atomic action: the fund sells the items, then pays the proceeds out evenly. Whoever may
    // spend from the fund may sell its items; pooled items stay the DM's (saleProblem).
    const fund = own(cmd.fundId);
    const shop = t.shops.find((x) => x.id === cmd.shopId);
    if (!shop) throw new Error("Item or shop no longer exists.");
    if (seat.role === "player") {
      if (!shopVisible(shop, t, actingGroups(t, fund.id, seat.purseIds))) throw Error(notHere(fund.id, "This shop"));
      assertShipTradingHere(t, fund.id);
    }
    if (shop.blackMarket && !journal.world?.blackMarketActive) throw Error("This black-market vendor is hidden.");
    const projected = execution.preview === true && seat.role !== "dm";
    const plan = planSaleSplit(
      t,
      {
        fundId: fund.id,
        shopId: shop.id,
        lots: cmd.lots,
        recipientIds: cmd.recipientIds,
        rule: cmd.remainder.rule,
        ...(cmd.remainder.purseId ? { purseId: cmd.remainder.purseId } : {}),
      },
      // The purse is checked below (merchantPays), in the batch order that keeps a hidden purse hidden.
      { actor: seat.role === "dm" ? "dm" : "player", projected, skipPurse: true },
    );
    // An older app planned the sale without market events: refused with a reason, never paid.
    if (
      execution.marketEventsUnsupported &&
      plan.proceeds !== cmd.expect.proceeds &&
      plan.lots.some((lot) => {
        const h = t.holdings.find((x) => x.id === lot.holdingId)!;
        return saleEvents(journal, shop, h).length > 0;
      })
    )
      throw Error(OLD_CLIENT_EVENT_PRICE);
    // An older app (protocol < 32) planned it without the settlement's per-item limit. The DM is
    // exempt from the cap (owner decision 2026-11-10), so a DM's older app planned the right payout.
    if (execution.settlementLimitsUnsupported && seat.role !== "dm" && plan.proceeds !== cmd.expect.proceeds && settlementSaleLimit(journal, shop))
      throw Error(OLD_CLIENT_SETTLEMENT_PRICE);
    // An older app (protocol < 29) planned it without factions: refused with a reason, never paid.
    if (execution.factionsUnsupported && plan.proceeds !== cmd.expect.proceeds && factionEffects(journal, t.purses, shop).length > 0)
      throw Error(OLD_CLIENT_FACTION_PRICE);
    if (
      plan.proceeds !== cmd.expect.proceeds ||
      plan.split.share !== cmd.expect.share ||
      plan.split.remainderTo !== cmd.expect.remainderTo
    )
      throw Error("The sale or split changed (prices, items, the party fund or recipients moved). Review it again.");
    // Merchant purse: the whole sale is paid from it or nothing is sold (never half a sale).
    merchantPays(shop, plan.proceeds);
    // The sale: the fund receives each lot's price (keeping its own coins), one sale line per lot.
    fund.coins = creditCoins(fund.coins, plan.proceeds);
    for (const [i, lot] of plan.lots.entries()) {
      const h = t.holdings.find((x) => x.id === lot.holdingId)!;
      h.quantity -= lot.quantity;
      const lineId = `${cmd.id}-sale-${i}`;
      t.ledger.push({
        id: lineId,
        at,
        purseId: fund.id,
        shopId: shop.id,
        summary: `Sold ${lot.quantity} ${lot.name} to ${shop.name}`,
        copper: lot.paid,
        transactionType: "sale",
      });
      const shown = presentedHolding(h);
      const linked = t.stock.find((line) => line.shopId === shop.id && line.commodityId === shown.commodityId && shown.commodityId);
      if (linked) {
        const receipt = recordShopTrade(t, { id: lineId, at, stockId: linked.id, purseId: fund.id, direction: "sell", quantity: lot.quantity, copper: lot.paid });
        if (receipt) t.ledger[t.ledger.length - 1].trade = { receiptId: receipt.id, leg: "owner" };
      }
    }
    const sold = new Set(t.holdings.filter((h) => h.quantity <= 0).map((h) => h.id));
    t.holdings = t.holdings.filter((h) => !sold.has(h.id));
    const loot = (journal as { lootClaims?: { claims: Array<{ holdingId: string }> } }).lootClaims;
    if (loot?.claims.some((c) => sold.has(c.holdingId))) loot.claims = loot.claims.filter((c) => !sold.has(c.holdingId));
    // The split, exactly as Split coins pays from a party fund.
    applyFundSplit(t, plan.split, cmd.id, at, projected);
    const settings = (journal.coinSplit ??= {});
    if (plan.split.rotation) settings.rotation = { lastPurseId: plan.split.rotation };
    if (!Object.keys(settings).length) delete journal.coinSplit;
    const name = (purseId: string) => t.purses.find((p) => p.id === purseId)?.name ?? "an account";
    const items = plan.lots.length === 1 ? lotLabel(plan.lots[0]!) : `${plan.lots.length} items`;
    event(
      `Sold ${items} to ${shop.name} and split ${formatCopper(plan.proceeds)} from ${fund.name} among ${plan.split.n}`,
      "management",
      fund.id,
    );
    const receipt = journal.events[journal.events.length - 1]!;
    receipt.split = {
      id: cmd.id,
      sourceId: fund.id,
      copper: plan.split.copper,
      share: plan.split.share,
      n: plan.split.n,
      remainder: plan.split.remainder,
      remainderTo: plan.split.remainderTo,
      rule: plan.split.rule,
      recipientIds: plan.split.recipientIds,
    };
    if (plan.split.npc) receipt.dmOnly = true;
    const leftover = remainderText(plan.split, name);
    const names = plan.split.recipientIds.map(name);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    // Party chat reaches players who can't read the fund (or are away): no item or shop names.
    const count = plan.lots.reduce((sum, l) => sum + l.quantity, 0);
    const head = `${fund.name} sold ${count} item${count === 1 ? "" : "s"} for ${formatCopper(plan.proceeds)} and split it:`;
    const full = [`${head} ${formatCopper(plan.split.share)} each to ${list}.`, leftover].filter(Boolean).join(" ");
    const text =
      full.length <= 500
        ? full
        : [`${head} ${formatCopper(plan.split.share)} each to ${plan.split.n} characters.`, leftover].filter(Boolean).join(" ").slice(0, 500);
    const npcId = plan.split.recipientIds.find((purseId) => {
      const p = t.purses.find((p) => p.id === purseId);
      return p?.kind === "character" && (p.control === "npc" || !!journal.world?.npcs.some((n) => n.id === p.id));
    });
    t.notes.push({
      id: cmd.id + "-note",
      at,
      from: seat.role,
      to: plan.split.npc ? "dm" : "party",
      purseId: plan.split.npc && npcId ? npcId : fund.id,
      text,
    });
  } else if (cmd.kind === "loan") {
    const p = own(cmd.purseId);
    // One row per ID, as the device's askLoan already requires (audit A2).
    if (t.loans.some((l) => l.id === cmd.id))
      throw new Error("That loan request ID already identifies a different request.");
    t.loans.push({
      id: cmd.id,
      at,
      purseId: p.id,
      purseName: p.name,
      copper: cmd.copper,
      note: cmd.note,
      status: "pending",
    });
  } else if (cmd.kind === "decision") {
    dm();
    const l = t.loans.find((x) => x.id === cmd.loanId);
    if (!l) throw new Error("Loan request not found.");
    if (l.status !== "pending") throw new Error("This loan has already been decided.");
    l.status = cmd.status;
    if (cmd.status === "approved") {
      coins(l.purseId, l.copper);
      log(l.purseId, "Finance: Loan approved", l.copper);
      finance().loans.push(loanFromRequest(l));
    }
  } else if (cmd.kind === "message") {
    if (seat.role === "player") {
      const sender = own(cmd.purseId);
      if (sender.kind !== "character") throw new Error("Send as your character.");
    }
    if (cmd.to === "player") {
      if (
        seat.role !== "player" ||
        cmd.recipientId === cmd.purseId ||
        !t.purses.some(
          (p) => p.id === cmd.recipientId && p.kind === "character" && p.control !== "npc",
        )
      )
        throw new Error("Choose another player character.");
    } else if (cmd.to === "dm" && !t.purses.some((p) => p.id === cmd.purseId))
      throw new Error("Choose a recipient.");
    t.notes.push({
      id: cmd.id,
      at,
      from: seat.role,
      to: cmd.to,
      ...(cmd.to === "player" ? { recipientId: cmd.recipientId } : {}),
      purseId: cmd.purseId,
      text: cmd.text,
    });
  } else if (cmd.kind === "sheet") {
    const s = readSheets([cmd.sheet])[0];
    if (!s) throw new Error("Invalid character sheet.");
    const before = cmd.before === undefined ? undefined : readSheets([cmd.before])[0];
    if (cmd.before !== undefined && !before) throw Error("Invalid character baseline.");
    editLegacyCharacter(t, seat, s, before);
  } else if (cmd.kind === "patch") {
    dm();
    assertNoPartialTradeVoid(t, seat, cmd.changes, execution.source === "local");
    for (const change of cmd.changes) {
      if (change.store === "purses" && change.after === null)
        assertFinanceAccountRemovable(t.journal?.finance, change.id);
      if (change.store === "journal") {
        const currentJournal = readJournal(t.journal);
        // A part of the journal (journal-patch.ts) is checked and applied exactly like the whole
        // journal: the rest of `before`/`after` is the current journal itself.
        let before = change.before,
          after = change.after;
        if (change.id !== LEGACY_JOURNAL_CHANGE_ID) {
          const path = journalChangePath(change.id);
          if (!path) throw new Error("Invalid journal change.");
          before = writeJournalPath(currentJournal, path, change.before);
          after = writeJournalPath(currentJournal, path, change.after);
        }
        if (!currentJournal.tradeEconomy && readJournal(after).tradeEconomy)
          throw Error("Configure a new trade economy with reviewed economy commands; seasonal rolls require DM authority.");
        if (!same(currentJournal, preserveJournalMetadata(before, currentJournal)))
          throw new Error("Activity changed elsewhere. Refresh and retry.");
        t.journal = preserveJournalMetadata(after, currentJournal);
        continue;
      }
      if (change.store === "realm") {
        if (!same(t.realm ?? null, change.before))
          throw new Error("Economy settings changed elsewhere. Review your pending changes.");
        t.realm = change.after as CloudTable["realm"];
        event(
          `Economy rules changed: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`.slice(
            0,
            500,
          ),
          "prices",
          undefined,
          {
            entity: "realm",
            before: change.before as Record<string, number> | null,
            after: change.after as Record<string, number> | null,
          },
        );
        continue;
      }
      if (change.store === "shops")
        event(
          change.after === null
            ? "Shop removed"
            : `Shop updated: ${(change.after as { name: string }).name}`,
        );
      if (
        change.store === "stock" &&
        change.before &&
        change.after &&
        (change.before as { copper: number }).copper !== (change.after as { copper: number }).copper
      )
        event(
          `${(change.after as { name: string }).name}: ${(change.before as { copper: number }).copper} cp → ${(change.after as { copper: number }).copper} cp`,
          "prices",
          undefined,
          {
            entity: "stock",
            entityId: change.id,
            before: { copper: (change.before as { copper: number }).copper },
            after: { copper: (change.after as { copper: number }).copper },
          },
        );
      const rows = (t[change.store] ?? []) as any[];
      const rowId = (x: any) => (change.store === "sheets" ? x.purseId : x.id);
      const current = rows.find((x) => rowId(x) === change.id) ?? null;
      // XP and milestones (protocol 21): an older client's purse rows lack them; keep the stored values.
      if (change.store === "purses" && current) Object.assign(change, keepPurseAdvancement(current, change.before, change.after));
      if (!same(current, change.before)) {
        // A shop's stock edited from an old screen (sold, repriced or renamed meanwhile; audit
        // 2026-11-10 D3): say what changed. The device refuses with the same words (editStockLine).
        const stale =
          change.store === "stock" && change.before && change.after
            ? staleStockMessage(
                current,
                change.before as StockFields,
                editedStockFields(change.before as StockFields, change.after as StockFields),
              )
            : null;
        throw new Error(
          stale ?? `Conflict in ${change.store}. Export your pending changes, then refresh and retry.`,
        );
      }
      // A pooled lot stays in its party fund until the DM resolves it or takes it out of the
      // pool (loot-pool-set). An older client that drops the marker keeps it pooled.
      if (change.store === "holdings" && current?.pool && change.after !== null) {
        const after = change.after as import("./types.ts").Holding;
        if (after.purseId !== current.purseId) throw Error(POOL_GUARD);
        if (!after.pool) change.after = { ...after, pool: current.pool };
      }
      // Item identification: revealing is logged, so only `item-identify` clears the presented
      // record; a holding saved without it (an older client) stays unidentified.
      if (change.store === "holdings" && isUnidentified(current) && change.after !== null) {
        const after = change.after as import("./types.ts").Holding;
        if (!after.unidentified) change.after = { ...after, unidentified: current.unidentified };
      }
      // Attunement changes through item-attune. An edit that keeps an attuned item with its
      // character keeps the attunement and its requirement (an older client may drop them).
      if (change.store === "holdings" && current?.attuned && change.after !== null) {
        const after = change.after as import("./types.ts").Holding;
        if (after.purseId === current.purseId && after.kind === "item")
          change.after = {
            ...after,
            attuned: true,
            requiresAttunement: after.requiresAttunement ?? current.requiresAttunement,
          };
      }
      if (change.store === "purses" && current?.sheetReadOnlyForDm && change.after !== null) {
        const after = change.after as import("./types.ts").Purse;
        if (
          !same(current.sheet, after.sheet) ||
          current.profileId !== after.profileId ||
          !after.sheetReadOnlyForDm
        )
          throw Error("Only the profile owner can edit this character sheet.");
      }
      (t as any)[change.store] = [
        ...rows.filter((x) => rowId(x) !== change.id),
        ...(change.after === null ? [] : [change.after]),
      ];
    }
  }
  // Pushed straight to the table's journal: `event()` skips patches that change the journal, and
  // such a patch replaces `t.journal`, yet an attunement it ends still needs its history entry.
  settleAttunement(t, attuned, cmd.kind === "item-attune" && cmd.attuned ? cmd.holdingId : null, (summary, kind, purseId, change) => {
    const events = (t.journal ??= readJournal(undefined)).events;
    events.push({ id: cmd.id + "-event-" + events.length, at, summary, kind, purseId, change });
  });
  if (journal.finance) journal.finance = readFinance(journal.finance);
  if (written) {
    identityLineage(written.holdings, t as { holdings: typeof t.holdings; journal: { events: object[] } }, cmd.id, at);
    redactWritten(written, t);
  }
  if (cmd.kind === "market-location" || cmd.kind === "market-name-import" || cmd.kind === "trade-exchange" ||
    !same(originalLocations, t.journal?.market?.locations))
    ensureCityExchanges(t);
  validateEconomyRows(t);
  validateShopLocations(t.shops, t.journal?.market);
  for (const listing of t.listings) listingSchema.parse(listing);
  validatePropertyLocations(t.listings, t.holdings, t.journal?.market);
  validateEstate(t);
  validateTradeEconomy(t);
  if (cmd.kind === "patch" && journal.world) {
    if (
      journal.world.characterPositions.some(
        (s) => s.downtime && !t.purses.some((p) => p.id === s.purseId),
      )
    )
      throw Error("Cancel character downtime before deleting its account.");
    journal.world.characterPositions = journal.world.characterPositions.filter((s) =>
      t.purses.some((p) => p.id === s.purseId),
    );
  }
  for (const n of journal.world?.npcs ?? []) {
    const p = t.purses.find((p) => p.id === n.id);
    if (p) {
      n.name = p.name;
      n.portrait = p.portrait;
    }
  }
  // Open party-split requests that no longer fit are cancelled (zones, privacy review 2026-10-29).
  cancelStaleZoneRequests(t, at, cmd.id, execution.playerSeats);
  // A shared-play preview runs on the seat's projected table (a private map's party position and
  // journey are redacted); the room re-validates the full table.
  validateWorld(t, execution.preview === true);
  validateJourneys(t);
  validateNpcBarter(t);
  validateFleet(t);
  validateBlacksmith(t);
  validateServices(t, execution.preview === true);
  validateDowntimeActivities(t, execution.preview === true);
  validateLootPool(t, execution.preview === true);
  return t;
}
export function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
export function tablePatch(before: CloudTable, after: CloudTable): CommandInput {
  const changes: Extract<Command, { kind: "patch" }>["changes"] = [];
  for (const store of [
    "purses",
    "holdings",
    "shops",
    "stock",
    "ledger",
    "listings",
    "loans",
    "sheets",
    "handouts",
  ] as const) {
    const a = new Map((before[store] ?? []).map((x) => ["id" in x ? x.id : x.purseId, x]));
    const b = new Map((after[store] ?? []).map((x) => ["id" in x ? x.id : x.purseId, x]));
    for (const id of new Set([...a.keys(), ...b.keys()]))
      if (!same(a.get(id) ?? null, b.get(id) ?? null))
        changes.push({ store, id, before: a.get(id) ?? null, after: b.get(id) ?? null });
  }
  if (!same(before.realm ?? null, after.realm ?? null))
    changes.push({
      store: "realm",
      id: "realm",
      before: before.realm ?? null,
      after: after.realm ?? null,
    });
  // Only the parts of the journal that changed (journal-patch.ts): a whole journal with its
  // inline map artwork can exceed the batch limit and the device's storage for pending actions.
  for (const part of diffJournal(before.journal ?? readJournal(null), after.journal ?? readJournal(null)))
    changes.push({ store: "journal", id: journalChangeId(part.path), before: part.before, after: part.after });
  return { kind: "patch", changes };
}

/**
 * The same patch with any whole-journal change (older drafts and clients) split into the parts
 * that changed. Applying either form gives the same table.
 */
export function compactPatch<C extends { kind: string }>(command: C): C {
  if (command.kind !== "patch") return command;
  const patch = command as unknown as Extract<Command, { kind: "patch" }>;
  if (!patch.changes.some((c) => c.store === "journal" && c.id === LEGACY_JOURNAL_CHANGE_ID)) return command;
  return {
    ...command,
    changes: patch.changes.flatMap((c) =>
      c.store === "journal" && c.id === LEGACY_JOURNAL_CHANGE_ID
        ? diffJournal(c.before ?? readJournal(null), c.after ?? readJournal(null)).map((part) => ({
            store: "journal" as const,
            id: journalChangeId(part.path),
            before: part.before,
            after: part.after,
          }))
        : [c],
    ),
  } as C;
}
