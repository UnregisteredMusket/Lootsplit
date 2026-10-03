import type { CloudTable } from "./cloud.ts";
import type { LedgerLine } from "./types.ts";

/** Versioned, read-only analytics. Money stays in integer copper until presentation. */
export const ANALYTICS_VERSION = 1;
export function emptyMetrics() {
  return {
    spentCopper: 0,
    purchaseCopper: 0,
    paymentCopper: 0,
    salesCopper: 0,
    purchaseCount: 0,
    paymentCount: 0,
    saleCount: 0,
    loanCopper: 0,
    transactionCount: 0,
    unclassifiedCount: 0,
    sessions: 0,
    completedSessions: 0,
    playerCharacters: 0,
    npcCharacters: 0,
    partyFunds: 0,
    inventoryQuantity: 0,
    inventoryValueCopper: 0,
    debtCopper: 0,
    appliedDowntimeDays: 0,
  };
}
export type GameMetrics = ReturnType<typeof emptyMetrics>;

export function addMetrics(target: GameMetrics, source: GameMetrics) {
  for (const key of Object.keys(target) as (keyof GameMetrics)[]) {
    const value = target[key] + source[key];
    if (!Number.isSafeInteger(value)) throw Error("Analytics exceeds exact numeric range.");
    target[key] = value;
  }
  return target;
}

function classification(line: LedgerLine): LedgerLine["transactionType"] {
  if (line.transactionType) return line.transactionType;
  // Recognize only historical summaries emitted by Lootsplit; arbitrary notes are unknown.
  if (/^Voided .*\(void:.*\)$/.test(line.summary)) return "void";
  if (/^(Transfer (sent|received)$|Gave )/.test(line.summary)) return "transfer";
  if (/^Bought \d+ .+ from /.test(line.summary)) return "purchase";
  if (/^Sold \d+ .+ to /.test(line.summary)) return "sale";
  if (/^Payment approved: /.test(line.summary)) return "payment";
  return undefined;
}

/** Pass an authorized table only. purseIds scopes players by campaign wallets, never profiles. */
export function campaignAnalytics(
  table: Pick<CloudTable, "ledger" | "purses" | "holdings" | "journal">,
  purseIds?: readonly string[],
): GameMetrics {
  const result = emptyMetrics();
  const scope = purseIds ? new Set(purseIds) : null;
  const included = (id: string) => !scope || scope.has(id);
  const rows = [...new Map(table.ledger.map((line) => [line.id, line])).values()];
  const byId = new Map(rows.map((line) => [line.id, line]));
  const voided = new Set<string>();
  for (const row of rows) {
    if (classification(row) !== "void" && classification(row) !== "transfer") continue;
    const id = /^Voided .*\(void:(.+)\)$/.exec(row.summary)?.[1];
    const original = id ? byId.get(id) : null;
    if (original && original.purseId === row.purseId && original.copper === -row.copper)
      voided.add(original.id);
  }
  for (const row of rows) {
    if (!included(row.purseId) || voided.has(row.id)) continue;
    if (!Number.isSafeInteger(row.copper)) throw Error("Invalid analytics ledger amount.");
    const kind = classification(row);
    if (kind === "void" || kind === "transfer") continue;
    result.transactionCount++;
    if (!kind) result.unclassifiedCount++;
    if (kind === "purchase" && row.copper < 0) {
      result.purchaseCopper -= row.copper;
      result.purchaseCount++;
    }
    if (kind === "payment" && row.copper < 0) {
      result.paymentCopper -= row.copper;
      result.paymentCount++;
    }
    if (kind === "sale" && row.copper > 0) {
      result.salesCopper += row.copper;
      result.saleCount++;
    }
    if (kind === "loan" && row.copper > 0) result.loanCopper += row.copper;
  }
  result.spentCopper = result.purchaseCopper + result.paymentCopper;
  for (const purse of table.purses.filter((p) => included(p.id))) {
    if (purse.kind === "party") result.partyFunds++;
    else if (purse.control === "npc") result.npcCharacters++;
    else result.playerCharacters++;
  }
  for (const holding of table.holdings.filter((h) => included(h.purseId))) {
    result.inventoryQuantity += holding.quantity;
    result.inventoryValueCopper += holding.quantity * holding.unitCopper;
  }
  const journal = table.journal;
  result.sessions = journal?.sessions?.length ?? 0;
  result.completedSessions = journal?.sessions?.filter((s) => s.endedAt !== undefined).length ?? 0;
  for (const loan of journal?.finance?.loans ?? [])
    if (included(loan.purseId)) result.debtCopper += loan.principal + loan.interest;
  result.appliedDowntimeDays = (journal?.finance?.downtime ?? [])
    .filter((d) => d.status === "applied")
    .reduce((sum, d) => sum + d.days, 0);
  // Also checks products, sums and malformed imported numeric values.
  return addMetrics(emptyMetrics(), result);
}

/** Explicit allowlist: extending private metrics never expands the public response. */
export function publicGameMetrics(metrics: GameMetrics) {
  return { spentCopper: metrics.spentCopper };
}
