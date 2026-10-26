import type { Holding, LedgerLine } from "./types.ts";

/**
 * "View receipt" for a result toast (design D9 / dm #15): the ledger lines one action wrote
 * (keyed by its command ID: `id`, or `id-<suffix>` for its other legs), any void of them, and the
 * item it created. Lines come from the viewer's own projected ledger, so a player sees only what
 * they could already read.
 */
export type ActionReceiptRequest = { title: string; commandId?: string; holdingId?: string };

const listeners = new Set<() => void>();
let current: ActionReceiptRequest | null = null;

export function showActionReceipt(request: ActionReceiptRequest) {
  current = request;
  for (const listener of listeners) listener();
}
export function dismissActionReceipt() {
  current = null;
  for (const listener of listeners) listener();
}
export function getActionReceipt(): ActionReceiptRequest | null {
  return current;
}
export function subscribeActionReceipt(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The lines one command wrote, then any voids of them, oldest first. */
export function receiptLines(ledger: LedgerLine[], commandId: string): LedgerLine[] {
  const own = ledger.filter((l) => l.id === commandId || l.id.startsWith(commandId + "-"));
  const ids = new Set(own.map((l) => l.id));
  const voids = ledger.filter((l) => !ids.has(l.id) && l.reversalOf && ids.has(l.reversalOf));
  return [...own, ...voids].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

/**
 * Whether a result toast may offer Undo for a shop purchase. Undo runs the existing DM ledger
 * void (`ledger-void`, ledger-reversal.ts) on the purchase line; that command re-checks the
 * receipt, the purchased items and the shop stock, and refuses if anything changed since.
 * This check only hides the button where the void could never apply.
 */
export function purchaseUndoable(
  ledger: LedgerLine[],
  commandId: string,
  role: "dm" | "player",
): LedgerLine | undefined {
  if (role !== "dm") return undefined;
  const line = ledger.find((l) => l.id === commandId);
  if (!line?.purchase || line.copper > 0 || line.reversalOf) return undefined;
  if (ledger.some((l) => l.reversalOf === line.id || l.summary.includes("(void:" + line.id + ")")))
    return undefined;
  return line;
}

/** The item an action created, if it still exists unchanged in the same account. */
export function receiptHolding(holdings: Holding[], id: string | undefined): Holding | undefined {
  return id ? holdings.find((h) => h.id === id && h.quantity > 0) : undefined;
}
