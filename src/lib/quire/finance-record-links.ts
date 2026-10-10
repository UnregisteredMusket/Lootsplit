import type { Debt, Finance } from "./finance.ts";
import type { Holding, LedgerLine } from "./types.ts";

export const loanRecordId = (id: string) => `loan-${encodeURIComponent(id)}`;
export const loanRequestRecordId = (id: string) => `loan-request-${encodeURIComponent(id)}`;
export const propertyRecordId = (id: string) => `property-${encodeURIComponent(id)}`;
export const holdingRecordId = (id: string) => `holding-${encodeURIComponent(id)}`;

/** The persisted source request ID is the only request/debt association. */
export function debtForLoanRequest(
  request: { id: string; purseId: string; status: string },
  debts: Debt[],
): Debt | undefined {
  if (request.status !== "approved") return;
  const matches = debts.filter(
    (debt) => debt.sourceLoanId === request.id && debt.purseId === request.purseId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Finance-loan commands store the same command ID in the debt and borrower row. */
export function fundingRecordForDebt(debt: Debt, records: LedgerLine[]): LedgerLine | undefined {
  const matches = records.filter(
    (record) =>
      record.id === `${debt.id}-borrower` && record.purseId === debt.purseId && record.copper > 0,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Never redirect a historical purchase to a renamed lookalike or a new owner. */
export function currentPurchasedHolding(
  record: LedgerLine,
  holdings: Holding[],
): Holding | undefined {
  if (record.transactionType && record.transactionType !== "purchase") return;
  const original = record.purchase?.holding;
  if (record.purchase && !original) return;
  if (original && original.purseId !== record.purseId) return;
  // Shared buy/listing commands persist their command ID in both records.
  // Older rows without a snapshot or this exact counterpart stay unlinked.
  const id =
    original?.id ?? (record.transactionType === "purchase" ? `${record.id}-item` : undefined);
  if (!id) return;
  const matches = holdings.filter(
    (holding) => holding.id === id && holding.purseId === record.purseId && holding.quantity > 0,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** A player sees only current-owner rules already included in their financial projection. */
export function currentPropertyRules(holding: Holding, rules: Finance["rules"]): Finance["rules"] {
  return rules.filter((rule) => rule.holdingId === holding.id && rule.purseId === holding.purseId);
}
