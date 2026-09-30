import type { BillFile } from "./table.ts";

export type ReceiptLine = { summary: string; copper: number };
export type ReceiptBuyer = { name: string; lines: ReceiptLine[] };
export type BillReceipt = { bought: ReceiptBuyer[]; sold: ReceiptBuyer[] };

const listeners = new Set<() => void>();
let current: BillReceipt | null = null;

export function receiptFromBill(file: BillFile): BillReceipt {
  const names = new Map(file.purses.map((purse) => [purse.id, purse.kind === "party" ? `Party · ${purse.name}` : purse.name]));
  return {
    bought: group(file, names, (copper) => copper < 0),
    sold: group(file, names, (copper) => copper > 0),
  };
}

export function presentReceipt(file: BillFile) {
  current = receiptFromBill(file);
  for (const listener of listeners) listener();
}

export function dismissReceipt() {
  current = null;
  for (const listener of listeners) listener();
}

export function getReceipt(): BillReceipt | null {
  return current;
}

export function subscribeReceipt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function group(file: BillFile, names: Map<string, string>, keep: (copper: number) => boolean): ReceiptBuyer[] {
  const groups = new Map<string, ReceiptBuyer>();
  for (const line of file.ledger) {
    if (!keep(line.copper)) continue;
    let buyer = groups.get(line.purseId);
    if (!buyer) {
      buyer = { name: names.get(line.purseId) ?? "Unknown", lines: [] };
      groups.set(line.purseId, buyer);
    }
    buyer.lines.push({ summary: line.summary, copper: line.copper });
  }
  return [...groups.values()];
}
