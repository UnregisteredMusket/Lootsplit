import { worldCommands, type WorldCommand } from "./world-schema.ts";
import { tradeCommands, type TradeCommand, type TradeExecution } from "./trade-economy-schema.ts";
import { applyTradeCommand, prepareTradeSeason, recordShopTrade, validateTradeEconomy } from "./trade-economy.ts";
import { applyWorldCommand, validateWorld, shopVisible, shopAsking } from "./world.ts";
import { shopScheduleSchema } from "./shop-schedule.ts";
import { estateCommands } from "./estate-schema.ts";
import { estateImportCommand, estateImportFingerprint, previewEstateImport } from "./estate-import.ts";
import { applyEstateCommand, assertCarried, assertEstateDisposable, initializeEstatePurchase, removeEstateSite, validateEstate } from "./estate.ts";
import { marketLocationSchema, readMarketLocations, validateShopLocations } from "./shop-locations.ts";
import { canonicalJson } from "./canonical-json.ts";
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
import { assertMerchantSale, isService, stockCategory } from "./merchant.ts";
import { archiveSession } from "./session-records.ts";
import { readJournal, preserveJournalMetadata, encounterLootProvenanceSchema, encounterLootEntryId } from "./journal.ts";
import { z } from "zod";
import { artworkSchema } from "./artwork.ts";
import { sheetSchema } from "../characters/model.mjs";
import {
  characterSheet,
  editCharacter,
  editLegacyCharacter,
} from "../characters/campaign-sheet.mjs";
import type { CloudTable, CloudSeat } from "./cloud.ts";
import { fromCopper, toCopper, spendCoins, priceAfterCharisma } from "./money.ts";
import { charismaScore, readSheets } from "./sheet.ts";
import { validateEconomyRows } from "./validation.ts";
import { listingSchema, propertyProfileSchema, propertyAvailableHere, validatePropertyLocations } from "./property.ts";
import { transferPropertyDeed } from "./property-deed.ts";
import { locationLabel } from "./shop-locations.ts";
const id = z.string().min(1).max(150),
  amount = z.number().int().nonnegative().max(1e12),
  qty = amount.min(1).max(100000);
const base = { id };
export const commandSchema = z.discriminatedUnion("kind", [
  ledgerVoidCommandSchema,
  ...tradeCommands,
  ...worldCommands,
  ...estateCommands,
  estateImportCommand,
  z.object({ ...base, kind: z.literal("listing-edit"), listingId: id, before: listingSchema.nullable(), after: listingSchema.nullable() }),
  z.object({ ...base, kind: z.literal("property-profile"), holdingId: id,
    before: z.object({ locationId: id.nullable(), property: propertyProfileSchema.nullable() }),
    locationId: id.nullable(), property: propertyProfileSchema.nullable() }),
  z.object({ ...base, kind: z.literal("market-name-import"), before: z.string(), rows: marketNameRowsSchema }),
  z.object({ ...base, kind: z.literal("shop-location"), shopId: id,
    before: z.object({ locationId: id.nullable(), image: artworkSchema.nullable() }),
    locationId: id.nullable(), image: artworkSchema.nullable() }),
  z.object({ ...base, kind: z.literal("market-location"), locationId: id, before: marketLocationSchema.nullable(), after: marketLocationSchema.nullable() }),
  z.object({ ...base, kind: z.literal("party-location"), before: id.nullable(), locationId: id.nullable() }),
  z.object({ ...base, kind: z.literal("bank-repay"), loanId: id, copper: amount.min(1) }),
  z.object({ ...base, kind: z.literal("property-details"), holdingId: id, before: z.object({name:z.string(),notes:z.string()}), name: z.string().trim().min(1).max(160), notes: z.string().max(4000) }),
  z.object({ ...base, kind: z.literal("shop-schedule"), shopId: id, schedule: shopScheduleSchema.nullable() }),
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
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = Command extends infer C
  ? C extends Command
    ? Omit<C, "id">
    : never
  : never;
export function applyCommand(input: CloudTable, seat: CloudSeat, raw: Command, execution: TradeExecution = {}): CloudTable {
  const cmd = commandSchema.parse(raw);
  const t = structuredClone(input);
  const at = Date.now();
  const journal = (t.journal = readJournal(t.journal));
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
  const own = (purseId: string) => {
    if (seat.role !== "dm" && !seat.purseIds.includes(purseId))
      throw new Error("You do not have permission to spend from this account.");
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw new Error("Account no longer exists.");
    return p;
  };
  const dm = () => {
    if (seat.role !== "dm") throw new Error("Only the DM can perform this action.");
  };
  const coins = (purseId: string, delta: number) => {
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw new Error("Account no longer exists.");
    const total = toCopper(p.coins) + delta;
    if (!Number.isSafeInteger(total) || total < 0 || total > 1e12)
      throw new Error("Insufficient funds or invalid amount.");
    p.coins = delta < 0 ? spendCoins(p.coins, -delta)! : fromCopper(total);
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
    t.purses.find((p) => p.id === purseId)?.kind === "party"
      ? null
      : (t.purses.find((p) => p.id === purseId)?.sheet?.scores.cha ??
        charismaScore(t.sheets.find((s) => s.purseId === purseId)));
  const finance = () => (journal.finance ??= readFinance());
  const editableFinance = () => {
    dm();
    const f = finance();
    if (f.downtime.some((d) => d.status === "pending"))
      throw Error("Cancel the pending downtime before changing finance agreements.");
    return f;
  };
  if (cmd.kind === "ledger-void") {
    applyLedgerVoid(t, seat, cmd, at, execution.source === "local");
  } else if (tradeCommands.some(schema => schema.shape.kind.value === cmd.kind)) {
    applyTradeCommand(t, seat, cmd as TradeCommand, at, execution);
  } else if (worldCommands.some(schema => schema.shape.kind.value === cmd.kind)) {
    applyWorldCommand(t, seat, cmd as WorldCommand, at);
  } else if (cmd.kind === "estate-import") {
    dm();
    if (finance().downtime.some(d => d.status === "pending")) throw Error("Cancel pending downtime before importing properties.");
    if (estateImportFingerprint(t) !== cmd.before) throw Error("The campaign changed. Review a fresh property import preview.");
    const next = previewEstateImport(t, cmd.document, cmd.owners, cmd.locations, cmd.id);
    t.holdings = next.holdings; t.listings = next.listings; t.journal!.market = next.journal!.market; t.journal!.propertyOperations = next.journal!.propertyOperations;
    event(`Imported property configurations: ${cmd.document.properties.length} records awaiting DM review.`);
  } else if (cmd.kind.startsWith("estate-")) {
    finance();
    applyEstateCommand(t, seat, cmd as import("./estate-schema.ts").EstateCommand, at);
  } else if (cmd.kind === "listing-edit") {
    dm();
    const current = t.listings.find(listing => listing.id === cmd.listingId) ?? null;
    if (!same(current, cmd.before)) throw Error("This listing changed elsewhere. Reload before saving; your draft is retained.");
    if (cmd.after && (cmd.after.id !== cmd.listingId || (current && current.kind !== cmd.after.kind)))
      throw Error("Listing identity and kind cannot change.");
    t.listings = [...t.listings.filter(listing => listing.id !== cmd.listingId), ...(cmd.after ? [cmd.after] : [])];
    event(cmd.after ? `Listing saved: ${cmd.after.name}` : `Listing removed: ${current?.name || cmd.listingId}`);
  } else if (cmd.kind === "property-profile") {
    dm();
    const h = t.holdings.find(h => h.id === cmd.holdingId && h.kind === "property" && h.quantity > 0);
    if (!h) throw Error("Property no longer exists.");
    if (!same({ locationId: h.locationId ?? null, property: h.property ?? null }, cmd.before))
      throw Error("Property location or features changed elsewhere. Reload before saving.");
    if (cmd.locationId) h.locationId = cmd.locationId; else delete h.locationId;
    if (cmd.property) h.property = cmd.property; else delete h.property;
    event(`Property location and features saved: ${h.name}`, "management", h.purseId);
  } else if (cmd.kind === "market-name-import") {
    dm();
    const market = readMarketLocations(journal.market);
    if (marketNameFingerprint(market, t.shops) !== cmd.before) throw Error("Location or shop names changed elsewhere. Review a fresh import preview.");
    const plan = previewMarketNames(market, t.shops, cmd.rows, cmd.id);
    if (plan.locations.length || plan.shops.length) {
      journal.market = readMarketLocations({ ...market, locations: [...market.locations, ...plan.locations] });
      t.shops.push(...plan.shops);
      event(`Names imported: ${plan.locations.length} locations, ${plan.shops.length} shops`);
    }
  } else if (cmd.kind === "shop-location") {
    dm();
    const shop = t.shops.find(shop => shop.id === cmd.shopId);
    if (!shop) throw Error("This shop no longer exists.");
    if (!same({ locationId: shop.locationId ?? null, image: shop.image ?? null }, cmd.before)) throw Error("This shop's location or image changed elsewhere. Refresh before saving.");
    if (cmd.locationId) shop.locationId = cmd.locationId; else delete shop.locationId;
    if (cmd.image) shop.image = cmd.image; else delete shop.image;
    event(`Shop location and image saved: ${shop.name}`);
  } else if (cmd.kind === "market-location") {
    dm();
    const market = readMarketLocations(journal.market);
    const current = market.locations.find(location => location.id === cmd.locationId) ?? null;
    if (!same(current, cmd.before)) throw Error("This location changed elsewhere. Refresh before saving.");
    if (cmd.after && cmd.after.id !== cmd.locationId) throw Error("Location identity cannot change.");
    if (!cmd.after && (market.currentLocationId === cmd.locationId || market.locations.some(location => location.parentId === cmd.locationId) || t.shops.some(shop => shop.locationId === cmd.locationId) || journal.world?.npcs.some(n => n.locationId === cmd.locationId) || journal.world?.maps.some(m => m.locationId === cmd.locationId || m.anchors.some(a => a.locationId === cmd.locationId)) || [...t.listings, ...t.holdings].some(property => property.locationId === cmd.locationId)))
      throw Error("Move the party, child locations, assigned shops and properties before removing this location.");
    market.locations = [...market.locations.filter(location => location.id !== cmd.locationId), ...(cmd.after ? [cmd.after] : [])];
    journal.market = readMarketLocations(market);
    event(cmd.after ? `Location saved: ${cmd.after.name}` : "Location removed");
  } else if (cmd.kind === "party-location") {
    dm();
    const market = readMarketLocations(journal.market);
    if (market.currentLocationId !== cmd.before) throw Error("The party moved elsewhere. Refresh before changing location.");
    journal.market = readMarketLocations({ ...market, currentLocationId: cmd.locationId });
    event(cmd.locationId ? `Party location: ${market.locations.find(location => location.id === cmd.locationId)?.name}` : "Party location cleared; all shops available");
  } else if (cmd.kind === "property-details") {
    const h = t.holdings.find(h => h.id === cmd.holdingId && h.kind === "property" && h.quantity > 0);
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
    if (f.rules.some(r => r.holdingId === holding.id && r.estateOperation)) throw Error("This property has reviewed tenancy or staff contracts. Edit their terms in its Rent & operating finances or Staff & managers sections; generic property plans remain available for other holdings.");
    for (const kind of ["income", "expense"] as const) {
      const copper = kind === "income" ? cmd.income : cmd.upkeep;
      const existing = f.rules.filter((r) => r.holdingId === holding.id && r.kind === kind);
      if (existing.length > 1) throw Error("This property has multiple schedules of the same type. Review them in Recurring revenue & expenses before using a property plan.");
      const prior = existing[0];
      if (prior && prior.purseId !== holding.purseId) throw Error("Settle the former owner's property agreements before transferring this plan.");
      if (prior?.carryDays && prior.periodDays !== cmd.periodDays) throw Error("Finish the current property period before changing its length.");
      if (!prior && !copper) continue;
      const next = { id: prior?.id || `${cmd.id}-${kind}`, propertyManaged: true, name: `${holding.name.slice(0,80)}: ${kind === "income" ? "revenue" : "upkeep"}`, purseId: holding.purseId, kind, copper: copper || prior!.copper, periodDays: cmd.periodDays, holdingId: holding.id, active: cmd.active && copper > 0, carryDays: prior?.carryDays || 0, arrears: prior?.arrears || 0 };
      if (prior) Object.assign(prior, next); else f.rules.push(next);
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
    if (f.downtime.some(d => d.status === "pending")) throw Error("The DM must settle or cancel pending downtime before repayment.");
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
    const quote = previewDowntime(t, f, cmd.days, undefined, cmd.advanceSeason ? cmd.id : undefined);
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
    const active = journal.sessions.find(s => !s.endedAt);
    if (cmd.endSession && !active) throw Error("There is no recorded session to end.");
    applyDowntime(t, cmd.downtimeId, active?.id ?? cmd.id, at);
    event("Applied approved downtime and seasonal settlement once", "session");
    if (cmd.endSession && active) {
      active.endedAt = at;
      active.endLedgerIds = t.ledger.map(l => l.id);
      archiveSession(t, active.id, active.name, at);
    }
  } else if (cmd.kind === "journal-note") {
    if (cmd.provenance || cmd.visibility === "dm") dm();
    if (seat.role !== "dm" || cmd.visibility === "player") {
      const p = own(cmd.purseId);
      if (p.kind !== "character") throw Error("Choose your character.");
    }
    if (cmd.reportIds.some((id) => !journal.reports?.some((r) => r.id === id)))
      throw Error("Session report not found.");
    if (cmd.provenance) {
      dm();
      if (cmd.visibility !== "party" || cmd.purseId || cmd.reportIds.length)
        throw Error("A loot summary must be a party journal entry without private attachments.");
      if (cmd.provenance.sessionId && !journal.sessions.some(session => session.id === cmd.provenance!.sessionId))
        throw Error("Choose an existing campaign session for this loot summary.");
      const existing = journal.entries?.find(entry => entry.provenance?.receiptId === cmd.provenance!.receiptId);
      if (existing) {
        if (existing.provenance?.encounterId !== cmd.provenance.encounterId)
          throw Error("This award receipt already belongs to another encounter summary.");
        return t;
      }
      const entryId = encounterLootEntryId(cmd.provenance.receiptId);
      if (journal.entries?.some(entry => entry.id === entryId))
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
  } else if (cmd.kind === "buy") {
    own(cmd.purseId);
    const s = t.stock.find((x) => x.id === cmd.stockId),
      shop = t.shops.find((x) => x.id === s?.shopId);
    if (!s || !shop) throw new Error("Item or shop no longer exists.");
    if (seat.role === "player" && !shopVisible(shop, t)) throw Error("This shop is not available at the party's current location.");
    if (shop.blackMarket && !journal.world?.blackMarketActive) throw Error("This black-market vendor is hidden.");
    if (shop.closed) throw new Error("This shop is closed.");
    if (s.quantity !== null && s.quantity < cmd.quantity)
      throw new Error("Not enough stock. Refresh and choose a smaller quantity.");
    const cost =
      priceAfterCharisma(shopAsking(shop, s.copper), score(cmd.purseId)) * cmd.quantity;
    coins(cmd.purseId, -cost);
    if (s.quantity !== null) s.quantity -= cmd.quantity;
    const purchasedHolding: import("./types.ts").Holding | null = isService(s) ? null : {
        id: cmd.id + "-item",
        purseId: cmd.purseId,
        category: stockCategory(s, shop),
        name: s.name,
        kind: "item",
        quantity: cmd.quantity,
        unitCopper: s.copper,
        notes: s.notes,
        ...(s.commodityId ? { commodityId: s.commodityId,
          weight: journal.tradeEconomy?.commodities.find(c => c.id === s.commodityId)?.weight,
          ...((journal.tradeEconomy?.commodities.find(c => c.id === s.commodityId)?.materialKey) ? { materialKey: journal.tradeEconomy!.commodities.find(c => c.id === s.commodityId)!.materialKey } : {}) } : {}),
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
    if (seat.role === "player" && !propertyAvailableHere(l, readMarketLocations(journal.market)))
      throw Error("This property is not available at the party's current location.");
    if (l.quantity !== null && l.quantity < cmd.quantity)
      throw new Error("Not enough listing stock.");
    const cost = priceAfterCharisma(l.copper, score(cmd.purseId)) * cmd.quantity;
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
      ...(l.property ? { property: structuredClone(l.property), ...(l.property.images?.[0] ? { image: l.property.images[0] } : {}) } : {}),
      ...(l.kind === "property" ? { deed: {
        id: cmd.id + "-deed", transactionId: cmd.id, listingId: l.id, propertyName: l.name,
        location: locationLabel(readMarketLocations(journal.market), l.locationId),
        buyerId: cmd.purseId, buyerName: t.purses.find(p => p.id === cmd.purseId)!.name,
        ownerId: cmd.purseId, ownerName: t.purses.find(p => p.id === cmd.purseId)!.name,
        purchasedAt: at, campaignDay: readFinance(journal.finance).day, unitCopper: cost / cmd.quantity,
        totalCopper: cost, purchasedQuantity: cmd.quantity,
      } } : {}),
    };
    t.holdings.push(holding);
    if (holding.kind === "property") initializeEstatePurchase(t, holding, l.estateTemplateKey, l.estateAttachments);
    log(cmd.purseId, `Bought ${cmd.quantity} ${l.name} from the market`, -cost);
    t.ledger[t.ledger.length - 1].listingPurchase = { listingId: l.id, quantity: cmd.quantity, holding: structuredClone(holding) };
  } else if (cmd.kind === "sell") {
    const h = t.holdings.find((x) => x.id === cmd.holdingId),
      s = t.shops.find((x) => x.id === cmd.shopId);
    if (!h || !s) throw new Error("Item or shop no longer exists.");
    if (seat.role === "player" && !shopVisible(s, t)) throw Error("This shop is not available at the party's current location.");
    if (s.blackMarket && !journal.world?.blackMarketActive) throw Error("This black-market vendor is hidden.");
    if (s.closed) throw new Error("This shop is closed.");
    own(h.purseId);
    assertCarried(h);
    if (h.kind === "property") assertEstateDisposable(t, h.id);
    assertMerchantSale(h, s);
    if (h.quantity < cmd.quantity) throw new Error("Not enough items to sell.");
    const paid = Math.round(h.unitCopper * s.buyRate) * cmd.quantity;
    coins(h.purseId, paid);
    h.quantity -= cmd.quantity;
    t.holdings = t.holdings.filter((x) => x.quantity > 0);
    log(h.purseId, `Sold ${cmd.quantity} ${h.name} to ${s.name}`, paid, s.id);
    const linked = t.stock.find(line => line.shopId === s.id && line.commodityId === h.commodityId && h.commodityId);
    if (linked) {
      const receipt = recordShopTrade(t, { id: cmd.id, at, stockId: linked.id, purseId: h.purseId, direction: "sell", quantity: cmd.quantity, copper: paid });
      if (receipt) t.ledger[t.ledger.length - 1].trade = { receiptId: receipt.id, leg: "owner" };
    }
    if (h.kind === "property" && h.quantity === 0) removeEstateSite(t, h.id);
  } else if (cmd.kind === "give") {
    own(cmd.fromId);
    if (cmd.fromId === cmd.toId || !t.purses.some((x) => x.id === cmd.toId))
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
      t.holdings.push({ ...h, id: cmd.id + "-item", purseId: cmd.toId, quantity: cmd.quantity,
        ...(h.deed ? { deed: transferPropertyDeed(h.deed, t.purses.find(p => p.id === cmd.toId)!, cmd.id, at) } : {}) });
      t.holdings = t.holdings.filter((x) => x.quantity > 0);
      if (h.kind === "property" && t.journal?.propertyOperations) {
        const site = t.journal.propertyOperations.sites.find(s => s.propertyId === h.id);
        if (site && h.quantity === 0) site.propertyId = cmd.id + "-item";
      }
    }
    log(cmd.fromId, "Transfer sent", -cmd.copper);
    log(cmd.toId, "Transfer received", cmd.copper, null, "-received");
    t.notes.push({
      id: cmd.id + "-note",
      at,
      from: seat.role,
      to: "party",
      purseId: cmd.fromId,
      text: `${seat.name} transferred ${cmd.copper} cp${cmd.holdingId ? " and items" : ""} to ${t.purses.find((p) => p.id === cmd.toId)?.name}.`,
    });
  } else if (cmd.kind === "loan") {
    const p = own(cmd.purseId);
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
        if (!currentJournal.tradeEconomy && readJournal(change.after).tradeEconomy)
          throw Error("Configure a new trade economy with reviewed economy commands; seasonal rolls require DM authority.");
        if (!same(currentJournal, preserveJournalMetadata(change.before, currentJournal)))
          throw new Error("Activity changed elsewhere. Refresh and retry.");
        t.journal = preserveJournalMetadata(change.after, currentJournal);
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
      if (!same(current, change.before))
        throw new Error(
          `Conflict in ${change.store}. Export your pending changes, then refresh and retry.`,
        );
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
  if (journal.finance) journal.finance = readFinance(journal.finance);
  validateEconomyRows(t);
  validateShopLocations(t.shops, t.journal?.market);
  for (const listing of t.listings) listingSchema.parse(listing);
  validatePropertyLocations(t.listings, t.holdings, t.journal?.market);
  validateEstate(t);
  validateTradeEconomy(t);
  validateWorld(t);
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
  if (!same(before.journal ?? readJournal(null), after.journal ?? readJournal(null)))
    changes.push({
      store: "journal",
      id: "journal",
      before: before.journal ?? readJournal(null),
      after: after.journal ?? readJournal(null),
    });
  return { kind: "patch", changes };
}
