import type { Purse, Holding } from "./types.ts";
export type ReportBase = {
  purses: Purse[];
  holdings: Holding[];
  stock: { id: string; quantity: number | null }[];
  listings?: { id: string; quantity: number | null }[];
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function verifyReportBase(
  base: ReportBase | undefined,
  current: ReportBase,
  incoming: ReportBase,
): void {
  if (
    base &&
    (!Array.isArray(base.purses) || !Array.isArray(base.holdings) || !Array.isArray(base.stock))
  )
    throw new Error("Invalid report baseline.");
  if (!base)
    throw new Error(
      "This report uses an older format without conflict protection. Export a backup, then ask the DM for a fresh player link. Reconcile older activity manually.",
    );
  for (const p of incoming.purses) {
    const original = base.purses.find((x) => x.id === p.id),
      now = current.purses.find((x) => x.id === p.id);
    if (!original || !now || !equal(original, now))
      throw new Error(
        `Conflict: ${p.name}'s funds or account changed since this player copy was created. Review with the player before importing.`,
      );
  }
  for (const p of incoming.purses) {
    const rows = (list: Holding[]) =>
      list.filter((x) => x.purseId === p.id).sort((a, b) => a.id.localeCompare(b.id));
    if (!equal(rows(base.holdings), rows(current.holdings)))
      throw new Error(`Conflict: ${p.name}'s inventory changed. No report changes were imported.`);
  }
  for (const line of incoming.stock) {
    const original = base.stock.find((x) => x.id === line.id);
    if (!original) throw new Error("Report references unknown stock.");
    if (line.quantity === original.quantity) continue;
    const now = current.stock.find((x) => x.id === line.id);
    if (!now || now.quantity !== original.quantity)
      throw new Error(
        "Conflict: shop stock changed since this player copy. Review purchases with the player.",
      );
    if (original.quantity !== null && (line.quantity === null || line.quantity > original.quantity))
      throw new Error("A player report cannot increase shop stock.");
  }
}
