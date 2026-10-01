import type { ChatNote } from "./chat.ts";
import type { LoanAsk } from "./market.ts";
import type { BillFile } from "./table.ts";

export type ReceiptLine = { summary: string; copper: number };
export type ReceiptBuyer = { name: string; lines: ReceiptLine[] };
export type ReceiptEntry = { id: string; at: number; name: string; summary: string; copper: number };
export type ReceiptTotal = { name: string; copper: number };
export type ReceiptNote = ChatNote & { label: string };
export type BillReceipt = {
  who: string[];
  entries: ReceiptEntry[];
  totals: ReceiptTotal[];
  bought: ReceiptBuyer[];
  sold: ReceiptBuyer[];
  switchedToDm: boolean;
  notes: ReceiptNote[];
  loans: LoanAsk[];
  sheets: { name: string }[];
};

const listeners = new Set<() => void>();
let current: BillReceipt | null = null;

export function receiptFromBill(file: BillFile): BillReceipt {
  const names = new Map(file.purses.map((purse) => [purse.id, purse.kind === "party" ? `Party · ${purse.name}` : purse.name]));
  const entries = file.ledger
    .map((line) => ({
      id: line.id,
      at: line.at,
      name: names.get(line.purseId) ?? "Unknown",
      summary: line.summary,
      copper: line.copper,
    }))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return {
    who: file.purses.map((purse) => names.get(purse.id) ?? purse.name),
    entries,
    totals: totals(entries),
    bought: group(file, names, (copper) => copper < 0),
    sold: group(file, names, (copper) => copper > 0),
    switchedToDm: file.switchedToDm === true,
    notes: (file.notes ?? []).map((note) => ({
      ...note,
      label:
        note.to === "party"
          ? `Party · ${note.from === "dm" ? "Dungeon master" : (names.get(note.purseId) ?? "Player")}`
          : note.from === "dm"
            ? "Dungeon master"
            : (names.get(note.purseId) ?? "Player"),
    })),
    loans: file.loans ?? [],
    sheets: (file.sheets ?? []).map((sheet) => ({ name: sheet.name || "A character" })),
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

function totals(entries: ReceiptEntry[]): ReceiptTotal[] {
  const sums = new Map<string, number>();
  for (const entry of entries) sums.set(entry.name, (sums.get(entry.name) ?? 0) + entry.copper);
  return [...sums.entries()].map(([name, copper]) => ({ name, copper }));
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
