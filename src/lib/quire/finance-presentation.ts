import { isExternalLedgerLine } from "./journal.ts";
import { parsePrice } from "./money.ts";
import type { LedgerLine } from "./types.ts";

export function denominationCopper(raw: string) {
  const amount = parsePrice(raw);
  return amount !== null && Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}
export function repaymentPreview(
  amount: number,
  principal: number,
  interest: number,
  available: number,
) {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > principal + interest ||
    amount > available
  )
    return null;
  const towardInterest = Math.min(interest, amount);
  return {
    towardInterest,
    towardPrincipal: amount - towardInterest,
    remainingDebt: principal + interest - amount,
    remainingCoins: available - amount,
  };
}
export function nextFinancePeriod(
  day: number,
  periodDays: number,
  carryDays: number,
  active: boolean,
) {
  return active ? day + periodDays - carryDays : null;
}
export function financialRows(
  rows: LedgerLine[],
  filter: { account: string; type: string; query: string; from?: number; to?: number },
) {
  const needle = filter.query.trim().toLowerCase();
  return rows
    .filter(
      (row) =>
        (!filter.account || row.purseId === filter.account) &&
        (!filter.type || row.transactionType === filter.type) &&
        (!needle || row.summary.toLowerCase().includes(needle)) &&
        (filter.from === undefined || row.at >= filter.from) &&
        (filter.to === undefined || row.at < filter.to),
    )
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
export function financialTotals(rows: LedgerLine[]) {
  return rows.reduce(
    (sum, row) => ({
      received: sum.received + (isExternalLedgerLine(row) && row.copper > 0 ? row.copper : 0),
      spent: sum.spent + (isExternalLedgerLine(row) && row.copper < 0 ? -row.copper : 0),
      net: sum.net + row.copper,
    }),
    { received: 0, spent: 0, net: 0 },
  );
}
