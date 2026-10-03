import { z } from "zod";
import type { CloudTable } from "./cloud.ts";
import { toCopper, fromCopper, spendCoins } from "./money.ts";
const id = z.string().min(1).max(150);
const money = z.number().int().min(0).max(1e12);
export const termsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  purseId: id,
  lenderId: z.string().max(150).default(""),
  rateBps: z.number().int().min(0).max(100000),
  periodDays: z.number().int().min(1).max(3650),
  compound: z.boolean(),
  payment: money,
});
const debtSchema = termsSchema.extend({
  id,
  sourceLoanId: id.optional(),
  principal: money,
  interest: money,
  due: money,
  carryDays: z.number().int().min(0).max(3649),
  interestRemainder: z.number().int().min(0).max(9999),
  paid: money,
});
export const ruleSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  purseId: id,
  kind: z.enum(["income", "expense"]),
  copper: money.min(1),
  periodDays: z.number().int().min(1).max(3650),
  holdingId: z.string().max(150).default(""),
  active: z.boolean(),
});
const scheduleSchema = ruleSchema.extend({
  carryDays: z.number().int().min(0).max(3649),
  arrears: money,
});
const lineSchema = z.object({
  id,
  name: z.string(),
  purseId: id,
  kind: z.enum(["income", "expense", "loan"]),
  periods: z.number().int().nonnegative(),
  interest: money,
  due: money,
  paid: money,
  unpaid: money,
  balance: money,
});
const quoteSchema = z.object({
  loans: z.array(debtSchema),
  rules: z.array(scheduleSchema),
  lines: z.array(lineSchema),
  balances: z.array(z.object({ purseId: id, before: money, after: money })),
});
export const financeSchema = z
  .object({
    day: z.number().int().nonnegative().max(1e9).default(0),
    loans: z.array(debtSchema).max(1000).default([]),
    rules: z.array(scheduleSchema).max(1000).default([]),
    downtime: z
      .array(
        z.object({
          id,
          days: z.number().int().min(1).max(3650),
          fromDay: z.number().int().nonnegative(),
          name: z.string().trim().min(1).max(100),
          status: z.enum(["pending", "applied", "cancelled"]),
          quote: quoteSchema,
          at: z.number(),
          appliedAt: z.number().optional(),
          sessionId: id.optional(),
        }),
      )
      .default([]),
  })
  .superRefine((f, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
    const ids = [...f.loans, ...f.rules].map((x) => x.id);
    if (new Set(ids).size !== ids.length) invalid("Finance agreement IDs must be unique.");
    const sources = f.loans.flatMap((l) => (l.sourceLoanId ? [l.sourceLoanId] : []));
    if (new Set(sources).size !== sources.length)
      invalid("A loan request cannot be tracked twice.");
    if (new Set(f.downtime.map((d) => d.id)).size !== f.downtime.length)
      invalid("Downtime receipt IDs must be unique.");
    if (f.downtime.filter((d) => d.status === "pending").length > 1)
      invalid("Only one downtime preview may be pending.");
    for (const l of f.loans) {
      if (l.principal + l.interest > 1e12 || l.due > l.principal + l.interest)
        invalid("Invalid debt balance.");
      if (l.purseId === l.lenderId) invalid("Borrower and lender must be different accounts.");
    }
    for (const r of [...f.loans, ...f.rules])
      if (r.carryDays >= r.periodDays)
        invalid("Carried days must be shorter than the finance period.");
  });
export type Finance = z.infer<typeof financeSchema>;
export type Debt = Finance["loans"][number];
export type Terms = z.infer<typeof termsSchema>;
export function readFinance(value?: unknown): Finance {
  return financeSchema.parse(value ?? {});
}
export function loanFromRequest(request: {
  id: string;
  purseId: string;
  note: string;
  copper: number;
}): Debt {
  return {
    id: `debt-${request.id}`,
    sourceLoanId: request.id,
    name: request.note.slice(0, 100),
    purseId: request.purseId,
    lenderId: "",
    principal: request.copper,
    interest: 0,
    due: 0,
    carryDays: 0,
    interestRemainder: 0,
    paid: 0,
    rateBps: 0,
    periodDays: 30,
    compound: false,
    payment: 0,
  };
}
function safe(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12)
    throw Error("Finance amount exceeds the supported coin limit.");
  return n;
}
export function previewDowntime(
  table: Pick<CloudTable, "purses" | "holdings">,
  raw: Finance,
  days: number,
) {
  z.number().int().min(1).max(3650).parse(days);
  const f = readFinance(raw);
  const balances = new Map(table.purses.map((p) => [p.id, safe(toCopper(p.coins))]));
  const lines: z.infer<typeof lineSchema>[] = [];
  const balance = (id: string) => {
    const n = balances.get(id);
    if (n === undefined)
      throw Error("A finance account is missing. Restore it or update the agreement first.");
    return n;
  };
  const change = (id: string, n: number) => balances.set(id, safe(balance(id) + n));
  const periods = (x: { periodDays: number; carryDays: number }) => {
    const n = Math.floor((x.carryDays + days) / x.periodDays);
    x.carryDays = (x.carryDays + days) % x.periodDays;
    return n;
  };
  // Settlement order is intentional: income, loans in creation order, then expenses.
  for (const r of f.rules.filter((r) => r.active && r.kind === "income")) {
    balance(r.purseId);
    if (
      r.holdingId &&
      !table.holdings.some((h) => h.id === r.holdingId && h.purseId === r.purseId && h.quantity > 0)
    )
      throw Error(
        `Inventory source for “${r.name}” is missing or belongs to another account. Update or pause this schedule.`,
      );
    const count = periods(r),
      due = safe(count * r.copper);
    change(r.purseId, due);
    lines.push({
      id: r.id,
      name: r.name,
      purseId: r.purseId,
      kind: r.kind,
      periods: count,
      interest: 0,
      due,
      paid: due,
      unpaid: 0,
      balance: 0,
    });
  }
  for (const l of f.loans.filter((l) => l.principal + l.interest > 0)) {
    balance(l.purseId);
    if (l.lenderId) balance(l.lenderId);
    const count = periods(l);
    let interest = 0,
      paid = 0,
      due = l.due;
    const pay = () => {
      const payment = Math.min(l.due, balance(l.purseId));
      change(l.purseId, -payment);
      if (l.lenderId) change(l.lenderId, payment);
      const towardInterest = Math.min(l.interest, payment);
      l.interest -= towardInterest;
      l.principal -= payment - towardInterest;
      l.due -= payment;
      l.paid = safe(l.paid + payment);
      paid = safe(paid + payment);
    };
    pay();
    for (let i = 0; i < count; i++) {
      const numerator =
        BigInt(l.principal + (l.compound ? l.interest : 0)) * BigInt(l.rateBps) +
        BigInt(l.interestRemainder);
      const accrued = safe(Number(numerator / 10000n));
      l.interestRemainder = Number(numerator % 10000n);
      l.interest = safe(l.interest + accrued);
      safe(l.principal + l.interest);
      interest = safe(interest + accrued);
      const installment = Math.min(l.payment, l.principal + l.interest - l.due);
      l.due = safe(l.due + installment);
      due = safe(due + installment);
      pay();
    }
    lines.push({
      id: l.id,
      name: l.name,
      purseId: l.purseId,
      kind: "loan",
      periods: count,
      interest,
      due,
      paid,
      unpaid: l.due,
      balance: l.principal + l.interest,
    });
  }
  for (const r of f.rules.filter((r) => r.active && r.kind === "expense")) {
    const count = periods(r),
      due = safe(r.arrears + count * r.copper),
      paid = Math.min(due, balance(r.purseId));
    change(r.purseId, -paid);
    r.arrears = due - paid;
    lines.push({
      id: r.id,
      name: r.name,
      purseId: r.purseId,
      kind: r.kind,
      periods: count,
      interest: 0,
      due,
      paid,
      unpaid: r.arrears,
      balance: r.arrears,
    });
  }
  return quoteSchema.parse({
    loans: f.loans,
    rules: f.rules,
    lines,
    balances: [...balances]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([purseId, after]) => ({
        purseId,
        before: toCopper(table.purses.find((p) => p.id === purseId)!.coins),
        after,
      })),
  });
}
export function financeMove(
  table: CloudTable,
  purseId: string,
  delta: number,
  id: string,
  summary: string,
  at: number,
  transfer = false,
) {
  const p = table.purses.find((p) => p.id === purseId);
  if (!p) throw Error("Finance account no longer exists.");
  safe(toCopper(p.coins) + delta);
  p.coins = delta < 0 ? spendCoins(p.coins, -delta)! : fromCopper(toCopper(p.coins) + delta);
  if (delta)
    table.ledger.push({
      id,
      at,
      purseId,
      shopId: null,
      summary: `Finance: ${summary}`,
      copper: delta,
      transactionType: transfer ? "transfer" : "payment",
    });
}
export function applyDowntime(
  table: CloudTable,
  downtimeId: string,
  sessionId: string,
  at: number,
) {
  const f = table.journal!.finance!;
  const d = f.downtime.find((d) => d.id === downtimeId);
  if (!d || d.status !== "pending") throw Error("Downtime is missing or has already been decided.");
  const quote = previewDowntime(table, f, d.days);
  if (JSON.stringify(quote) !== JSON.stringify(d.quote))
    throw Error(
      "Campaign finances changed after this preview. Recalculate downtime before approving.",
    );
  for (const l of quote.lines) {
    const debt = quote.loans.find((x) => x.id === l.id);
    financeMove(
      table,
      l.purseId,
      l.kind === "income" ? l.paid : -l.paid,
      `${d.id}-${l.id}`,
      `${d.name}: ${l.name}`,
      at,
      !!debt?.lenderId,
    );
    if (debt?.lenderId)
      financeMove(
        table,
        debt.lenderId,
        l.paid,
        `${d.id}-${l.id}-lender`,
        `${d.name}: ${l.name} repayment`,
        at,
        true,
      );
  }
  f.loans = quote.loans;
  f.rules = quote.rules;
  f.day += d.days;
  d.status = "applied";
  d.appliedAt = at;
  d.sessionId = sessionId;
}

export function assertFinanceAccountRemovable(value: unknown, purseId: string) {
  const f = readFinance(value);
  if (f.downtime.some((d) => d.status === "pending"))
    throw Error("Cancel the pending downtime before removing a campaign account.");
  if (
    f.loans.some(
      (l) => (l.purseId === purseId || l.lenderId === purseId) && l.principal + l.interest > 0,
    )
  )
    throw Error("Settle this account's loans before removing it.");
  if (f.rules.some((r) => r.purseId === purseId && (r.active || r.arrears > 0)))
    throw Error(
      "Settle unpaid expenses and pause this account's finance schedules before removing it.",
    );
}
