import { z } from "zod";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Holding, LedgerLine, StockLine } from "./types.ts";
import type { TradeReceipt } from "./trade-economy-schema.ts";
import { canonicalJson } from "./canonical-json.ts";
import { holdingSchema } from "./validation.ts";
import { readArchivedSnapshot } from "./journal.ts";
import { readEstate } from "./estate-schema.ts";
import { estateCapabilities, storageWeight } from "./estate.ts";
import { isService, stockCategory } from "./merchant.ts";
import { fromCopper, spendCoins, toCopper } from "./money.ts";

export const ledgerVoidCommandSchema = z.object({
  id: z.string().min(1).max(150),
  kind: z.literal("ledger-void"),
  target: z.object({
    kind: z.enum(["ledger", "trade"]),
    id: z.string().min(1),
  }).strict(),
  before: z.string(),
  reason: z.string().trim().min(1).max(2000),
}).strict();
export type LedgerVoidCommand = z.infer<typeof ledgerVoidCommandSchema>;

const compensation = "Record a compensating payment or transfer and correct the exact holding and stock instead.";
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function unsafe(detail = "This trade cannot be reversed safely from the ledger."): never {
  throw Error(detail + " " + compensation);
}

/** Intrinsic guidance only. Current funds, inventory and authority are checked at commit. */
export function tradeReversalGuidance(receipt: TradeReceipt): string | undefined {
  if (receipt.reversalOf) return "This receipt is already a reversal.";
  if (receipt.origin === "shop" && receipt.propertyId)
    return "This supplier delivery has transport obligations. " + compensation;
  if (receipt.origin !== "shop" && !receipt.settlement)
    return "This older exchange receipt has no exact inventory snapshot. " + compensation;
  if (receipt.origin === "shop" && receipt.direction !== "buy")
    return "This shop sale has no complete goods-return receipt. " + compensation;
}

/** Validate a complete snapshot without stripping unknown saved asset metadata. */
export function readTradeSettlementHolding(receipt: TradeReceipt): Holding {
  let raw: unknown;
  try { raw = JSON.parse(receipt.settlement!.holding); } catch {
    unsafe("This exchange receipt has an unreadable inventory snapshot.");
  }
  if (!holdingSchema.safeParse(raw).success)
    unsafe("This exchange receipt has an invalid inventory snapshot.");
  const holding = raw as Holding;
  if (
    !receipt.settlement || receipt.reversalOf ||
    holding.kind !== "item" || holding.purseId !== receipt.purseId ||
    holding.commodityId !== receipt.commodityId ||
    holding.service || holding.reservedFor || holding.custody?.kind === "transit" ||
    holding.quantity < receipt.quantity ||
    (receipt.direction === "buy" &&
      (holding.quantity !== receipt.quantity || holding.unitCopper * receipt.quantity !== receipt.copper)) ||
    (receipt.direction === "sell" && receipt.copper % receipt.quantity !== 0) ||
    (holding.custody?.propertyId ?? undefined) !== receipt.propertyId ||
    (!!holding.custody !== !!receipt.settlement.storageOwnerId)
  ) unsafe("This exchange receipt has conflicting inventory or payment details.");
  return holding;
}

type LedgerIndex = { lines: LedgerLine[]; conflicting: Set<string> };
function ledgerIndex(table: CloudTable, seat: CloudSeat, ownedDevice = false): LedgerIndex {
  const rows = [...table.ledger];
  for (const record of table.journal?.reports ?? []) {
    if (!ownedDevice && record.seatIds && !record.seatIds.includes(seat.id)) continue;
    try { rows.push(...readArchivedSnapshot(record.snapshot).ledger); } catch {
      // A damaged archive remains intact for recovery. Never infer missing legs.
    }
  }
  const unique = new Map<string, LedgerLine>(), conflicting = new Set<string>();
  for (const line of rows) {
    const previous = unique.get(line.id);
    if (previous && !same(previous, line)) conflicting.add(line.id);
    else unique.set(line.id, line);
  }
  return { lines: [...unique.values()], conflicting };
}
function exactLine(index: LedgerIndex, id: string): LedgerLine | undefined {
  if (index.conflicting.has(id)) unsafe("The current ledger and an archive disagree about this receipt.");
  return index.lines.find(line => line.id === id);
}
function wasVoided(index: LedgerIndex, id: string) {
  return index.lines.some(line => line.reversalOf === id || line.summary.includes("(void:" + id + ")"));
}
function receiptForLine(table: CloudTable, line: LedgerLine): TradeReceipt | undefined {
  const receipts = table.journal?.tradeEconomy?.receipts ?? [];
  if (line.trade) return receipts.find(receipt => receipt.id === line.trade!.receiptId);
  return receipts.find(receipt =>
    receipt.origin === "shop" ? receipt.id === line.id :
      line.id === receipt.id + "-owner" || line.id === receipt.id + "-treasury" ||
      line.id.endsWith("-" + receipt.id + "-owner") || line.id.endsWith("-" + receipt.id + "-treasury"),
  );
}

function changeCoins(table: CloudTable, purseId: string, delta: number, limit = Number.MAX_SAFE_INTEGER) {
  const purse = table.purses.find(p => p.id === purseId);
  if (!purse) throw Error("This account no longer exists. " + compensation);
  const total = toCopper(purse.coins) + delta;
  if (!Number.isSafeInteger(total) || total < 0 || total > limit)
    throw Error("That account cannot cover reversing this line, or its balance would exceed the supported limit.");
  const paid = fromCopper(Math.max(0, delta));
  const coins = delta < 0 ? spendCoins(purse.coins, -delta) :
    limit === Number.MAX_SAFE_INTEGER ? {
      cp: purse.coins.cp + paid.cp, sp: purse.coins.sp + paid.sp,
      ep: purse.coins.ep + paid.ep, gp: purse.coins.gp + paid.gp,
      pp: purse.coins.pp + paid.pp,
    } : fromCopper(total);
  if (!coins) throw Error("That account cannot cover reversing this line.");
  purse.coins = coins;
}
function appendLedgerVoid(
  table: CloudTable, source: LedgerLine, id: string, at: number,
  receiptId?: string,
) {
  if (table.ledger.some(line => line.id === id)) unsafe("This correction identity already exists.");
  table.ledger.push({
    id, at, purseId: source.purseId, shopId: source.shopId,
    copper: -source.copper,
    summary: "Voided " + source.summary + " (void:" + source.id + ")",
    transactionType: "void", reversalOf: source.id,
    ...(receiptId ? { trade: { receiptId, leg: source.trade?.leg ?? "owner" } } : {}),
  });
}
function appendTradeVoid(table: CloudTable, source: TradeReceipt, id: string, command: LedgerVoidCommand, at: number) {
  const economy = table.journal!.tradeEconomy!;
  if (economy.receipts.some(receipt => receipt.id === id)) unsafe("This correction identity already exists.");
  const original = { ...source };
  delete original.settlement;
  economy.receipts.push({
    ...original, id, at, epoch: economy.epoch,
    direction: source.direction === "buy" ? "sell" : "buy",
    reversalOf: source.id, reversalReason: command.reason,
  });
}

function reverseExchange(
  table: CloudTable, receipt: TradeReceipt, index: LedgerIndex,
  command: LedgerVoidCommand, correctionId: string, sequence: number, at: number,
) {
  const snapshot = readTradeSettlementHolding(receipt);
  const economy = table.journal!.tradeEconomy!;
  const exchange = economy.exchanges.find(e => e.id === receipt.exchangeId);
  const offer = exchange?.offers.find(o => o.commodityId === receipt.commodityId);
  const treasuryId = receipt.settlement!.treasuryPurseId;
  const treasury = table.purses.find(p => p.id === treasuryId);
  if (!offer || exchange?.purseId !== treasuryId || !treasury?.nonParty || treasury.control !== "npc" || treasury.kind !== "character" ||
    treasuryId === receipt.purseId)
    unsafe("The original exchange stock or treasury is missing or changed.");
  const legs = index.lines.filter(line => line.trade?.receiptId === receipt.id);
  for (const line of legs) {
    exactLine(index, line.id);
    if (wasVoided(index, line.id))
      unsafe("A prior ledger void has no complete matching market correction.");
  }
  const owner = legs.filter(line => line.trade?.leg === "owner");
  const treasuryLines = legs.filter(line => line.trade?.leg === "treasury");
  const ownerCopper = receipt.direction === "buy" ? -receipt.copper : receipt.copper;
  if (receipt.copper === 0 ? legs.length !== 0 :
    owner.length !== 1 || treasuryLines.length !== 1 ||
    owner[0].purseId !== receipt.purseId || owner[0].copper !== ownerCopper ||
    treasuryLines[0].purseId !== treasuryId || treasuryLines[0].copper !== -ownerCopper ||
    owner[0].transactionType !== (receipt.direction === "buy" ? "purchase" : "sale") ||
    treasuryLines[0].transactionType !== "transfer")
    unsafe("The exchange receipt is missing complete matching ledger movements.");

  const current = table.holdings.find(h => h.id === snapshot.id);
  const expected = receipt.direction === "buy" ? snapshot :
    snapshot.quantity === receipt.quantity ? undefined :
      { ...snapshot, quantity: snapshot.quantity - receipt.quantity };
  if (!same(current ?? null, expected ?? null))
    unsafe("The traded items have changed or left this account.");
  if (snapshot.custody) {
    const property = table.holdings.find(h => h.id === snapshot.custody!.propertyId && h.kind === "property");
    const estate = readEstate(table.journal?.propertyOperations);
    const site = estate.sites.find(s => s.propertyId === property?.id);
    if (!property || property.purseId !== receipt.settlement!.storageOwnerId || !site)
      unsafe("The original property store or its owner changed.");
    // Removing an exact mistaken purchase is safe from a paused store. Returning
    // sold goods needs current usable storage; DM corrections need no travel or player access.
    if (receipt.direction === "sell" && (!site.enabled || property.property?.condition === "ruin" ||
      !estateCapabilities(estate, site).has("storage")))
      unsafe("Restoring the sold goods needs active usable property storage.");
  }
  const stock = offer.stock + (receipt.direction === "buy" ? receipt.quantity : -receipt.quantity);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > offer.capacity)
    unsafe("The exchange cannot restore this quantity within its current stock and capacity.");
  changeCoins(table, receipt.purseId, -ownerCopper, 1e12);
  changeCoins(table, treasuryId, ownerCopper, 1e12);
  offer.stock = stock;
  table.holdings = table.holdings.filter(h => h.id !== snapshot.id);
  if (receipt.direction === "sell") {
    table.holdings.push(structuredClone(snapshot));
    if (snapshot.custody) {
      const site = readEstate(table.journal?.propertyOperations).sites.find(s => s.propertyId === snapshot.custody!.propertyId)!;
      const used = storageWeight(table, site.propertyId);
      if (site.capacityWeight !== null && (used.unknown || used.weight > site.capacityWeight))
        unsafe("Restoring the sold goods exceeds the current property storage capacity.");
    }
  }
  for (const line of legs)
    appendLedgerVoid(table, line, command.id + "-ledger-" + sequence + "-" + line.trade!.leg, at, correctionId);
  appendTradeVoid(table, receipt, correctionId, command, at);
}

/** Existing safe standalone/ordinary-shop reversals, now used by both authorities. */
function reverseOrdinary(
  table: CloudTable, line: LedgerLine, command: LedgerVoidCommand,
  at: number, receipt?: TradeReceipt,
) {
  if (line.transactionType === "transfer" || line.transactionType === "loan" || line.transactionType === "sale" ||
    line.listingPurchase ||
    /^(Finance:|Sold |Gave |Transfer (sent|received)|Approved a loan |Bought .* from the market)/.test(line.summary))
    unsafe();
  const bought = /^Bought (\d+) (.+?) from /.exec(line.summary);
  let holding: Holding | undefined, shelf: StockLine | undefined;
  const quantity = line.purchase?.quantity ?? (bought ? Number(bought[1]) : 0);
  if (line.purchase || bought) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !line.shopId || line.copper > 0)
      unsafe("This purchase receipt is incomplete.");
    if (bought && Number(bought[1]) !== quantity)
      unsafe("This purchase receipt has conflicting quantities.");
    if (line.purchase) {
      shelf = table.stock.find(stock => stock.id === line.purchase!.stockId);
      if (line.purchase.holding) {
        const original = line.purchase.holding;
        holding = table.holdings.find(h => h.id === original.id);
        if (!holding || holding.purseId !== line.purseId || holding.kind !== "item" ||
          holding.quantity !== quantity || !same(holding, original))
          unsafe("The purchased items have changed or left this account.");
      } else if (!shelf || !isService(shelf)) unsafe("This purchase is missing its item receipt.");
    } else {
      const name = bought![2].toLowerCase();
      const candidates = table.holdings.filter(h => h.purseId === line.purseId && h.name.toLowerCase() === name && h.kind === "item");
      const shelves = table.stock.filter(stock => stock.shopId === line.shopId && stock.name.toLowerCase() === name);
      if (candidates.length !== 1 || shelves.length !== 1)
        unsafe("This older purchase has ambiguous item or stock records.");
      holding = candidates[0]; shelf = shelves[0];
      const shop = table.shops.find(s => s.id === line.shopId);
      if (!shop || holding.unitCopper !== shelf.copper || holding.notes !== shelf.notes ||
        (holding.category && holding.category !== stockCategory(shelf, shop)))
        unsafe("This older purchase no longer matches the remaining item and stock records.");
      if (holding.quantity < quantity)
        unsafe("The purchased items are no longer in this account.");
    }
    if (holding?.custody || holding?.reservedFor)
      unsafe("The purchased items have changed or left carried inventory.");
    if (!shelf || shelf.shopId !== line.shopId ||
      (bought && shelf.name.toLowerCase() !== bought[2].toLowerCase()))
      unsafe("The original shop stock is missing or changed.");
    if (shelf.quantity !== null && !Number.isSafeInteger(shelf.quantity + quantity))
      throw Error("The returned stock quantity would be too large.");
  } else if (line.transactionType === "purchase" || line.trade || receipt) {
    unsafe("This purchase has no complete inventory receipt.");
  }
  if (receipt && (receipt.origin !== "shop" || receipt.direction !== "buy" || receipt.propertyId ||
    receipt.purseId !== line.purseId || receipt.quantity !== quantity || receipt.copper !== -line.copper ||
    shelf?.commodityId !== receipt.commodityId || shelf.tradeExchangeId !== receipt.exchangeId))
    unsafe("This shop receipt no longer matches the original linked purchase.");
  changeCoins(table, line.purseId, -line.copper);
  if (holding) {
    if (holding.quantity === quantity) table.holdings = table.holdings.filter(h => h.id !== holding!.id);
    else holding.quantity -= quantity;
  }
  if (shelf && shelf.quantity !== null) shelf.quantity += quantity;
  const correctionId = receipt ? command.id + "-trade-0" : undefined;
  appendLedgerVoid(table, line, command.id + "-ledger", at, correctionId);
  if (receipt) appendTradeVoid(table, receipt, correctionId!, command, at);
}

/** Mutates only the command's private candidate table; callers commit it atomically. */
export function applyLedgerVoid(
  table: CloudTable, seat: CloudSeat, command: LedgerVoidCommand, at: number, ownedDevice = false,
): boolean {
  if (seat.role !== "dm") throw Error("Only the DM can reverse a ledger line or trade.");
  const index = ledgerIndex(table, seat, ownedDevice);
  const source = command.target.kind === "ledger" ? exactLine(index, command.target.id) :
    table.journal?.tradeEconomy?.receipts.find(r => r.id === command.target.id);
  if (!source) throw Error("That receipt is not available in this campaign or its readable archives. " + compensation);
  if (canonicalJson(source) !== command.before)
    throw Error("This receipt changed. Review its current details before reversing it.");
  if (source.reversalOf || ("summary" in source && source.summary.startsWith("Voided")))
    throw Error("That receipt is already a void.");
  const receipt = command.target.kind === "trade" ? source as TradeReceipt : receiptForLine(table, source as LedgerLine);
  if (command.target.kind === "ledger" && (source as LedgerLine).trade && !receipt)
    unsafe("The linked market receipt is missing.");
  if (receipt) {
    const receipts = table.journal!.tradeEconomy!.receipts;
    const group = receipt.operationId ?
      receipts.filter(r => !r.reversalOf && r.operationId === receipt.operationId) : [receipt];
    const reversed = group.filter(original => receipts.some(r => r.reversalOf === original.id));
    if (reversed.length === group.length) return false;
    if (reversed.length) unsafe("This manager operation has only a partial prior correction.");
    for (const original of group) {
      const guidance = tradeReversalGuidance(original);
      if (guidance) throw Error(guidance);
      if (group.length > 1 && (original.origin !== "manager" ||
        original.purseId !== receipt.purseId || original.propertyId !== receipt.propertyId ||
        original.exchangeId !== receipt.exchangeId))
        unsafe("This operation contains incompatible trade receipts.");
    }
    if (receipt.origin === "shop") {
      const matching = index.lines.filter(line =>
        line.trade?.receiptId === receipt.id && line.trade.leg === "owner" ||
        !line.trade && line.id === receipt.id,
      );
      if (matching.length !== 1) unsafe("The original shop ledger receipt is missing or ambiguous.");
      const line = exactLine(index, matching[0].id)!;
      if (wasVoided(index, line.id)) unsafe("A prior ledger void has no complete matching market correction.");
      reverseOrdinary(table, line, command, at, receipt);
    } else {
      // Undo a manager's component trades together, reversing their execution order.
      group.slice().reverse().forEach((original, i) =>
        reverseExchange(table, original, index, command, command.id + "-trade-" + i, i, at),
      );
    }
  } else {
    const line = source as LedgerLine;
    if (wasVoided(index, line.id)) return false;
    reverseOrdinary(table, line, command, at);
  }
  table.journal!.events.push({
    id: command.id + "-event", at, kind: "management", dmOnly: true,
    summary: ("Ledger correction: " + command.reason).slice(0, 500),
  });
  return true;
}

/** Older clients must not commit asset-only voids while metadata preserves market activity. */
export function assertNoPartialTradeVoid(
  table: CloudTable, seat: CloudSeat,
  changes: { store: string; before: unknown; after: unknown }[], ownedDevice = false,
) {
  // Archive-and-clear removes current rows but retains their immutable evidence.
  // Block partial corrections, not that existing journal workflow.
  const candidates = changes.filter(change => change.store === "ledger" && change.after);
  if (!candidates.length || !table.journal?.tradeEconomy) return;
  const index = ledgerIndex(table, seat, ownedDevice);
  for (const change of candidates) {
    const after = change.after as LedgerLine;
    const sourceId = after.reversalOf ?? /\(void:(.+)\)/.exec(after.summary ?? "")?.[1];
    const source = sourceId && exactLine(index, sourceId);
    if (source && (source.trade || receiptForLine(table, source)))
      throw Error("Use the reviewed ledger or market trade reversal action for this linked transaction. Its money, goods and seasonal activity must be corrected together.");
    if (change.before && (change.before as LedgerLine).trade && !same(change.before, change.after))
      throw Error("Recorded trade ledger movements are immutable. Use the reviewed reversal action.");
  }
}
