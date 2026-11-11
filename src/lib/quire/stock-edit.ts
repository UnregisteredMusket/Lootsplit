import { formatCopper } from "./money.ts";

const FIELDS = ["quantity", "copper", "name"] as const;

/** The stock fields the DM edits in a shop's Edit mode, one field per save. */
export type StockField = "name" | "copper" | "quantity";
export type StockFields = { name: string; copper: number; quantity: number | null };
/**
 * One field edit: `shown` is what the box showed when the DM started editing it, `value` what
 * they typed. The edit is refused when the stored line no longer has the shown value (sold,
 * repriced or renamed elsewhere), so an old screen never writes old stock or prices back
 * (audit 2026-11-10 D3).
 */
export type StockEdit =
  | { field: "name"; shown: string; value: string }
  | { field: "copper"; shown: number; value: number }
  | { field: "quantity"; shown: number | null; value: number | null };

/** The stock fields a change writes (`before` → `after`). */
export const editedStockFields = (before: StockFields, after: StockFields): StockField[] =>
  FIELDS.filter((f) => before[f] !== after[f]);

export const STOCK_REMOVED = "This item was removed from the shop elsewhere. Nothing was saved.";

const describe = (field: StockField, line: StockFields) =>
  field === "quantity"
    ? `quantity is now ${line.quantity === null ? "unlimited" : line.quantity}`
    : field === "copper"
      ? `price is now ${formatCopper(line.copper)}`
      : `it is now named ${line.name}`;

/**
 * Why a stock edit made against `expected` cannot apply to `current`, or null when those fields
 * still match. The fields being edited are named first. Used by the device (`editStockLine`) and
 * by the room's patch check, so both refuse with the same words.
 */
export function staleStockMessage(
  current: StockFields | null | undefined,
  expected: StockFields,
  edited: readonly StockField[] = [],
): string | null {
  if (!current) return STOCK_REMOVED;
  const field = [...edited, ...FIELDS].find((f) => current[f] !== expected[f]);
  if (!field) return null;
  return `${expected.name} changed while you were editing: ${describe(field, current)}. Nothing was saved; check the new value and edit again.`;
}
