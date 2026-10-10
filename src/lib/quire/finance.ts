import { scheduledMarket } from "./shop-schedule.ts";
import { estateQuoteSchema } from "./estate-schema.ts";
import { estateRuleEligible, previewEstate } from "./estate.ts";
import { tradeSeasonQuoteSchema } from "./trade-economy-schema.ts";
import { applyTradeSeason, previewTradeSeason } from "./trade-economy.ts";
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
  estateOperation: z.enum(["rent", "wage", "upkeep"]).optional(),
  propertyManaged: z.boolean().optional(),
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
export const quoteSchema = z.object({
  tradeSeason: tradeSeasonQuoteSchema.optional(),
  propertyOperations: estateQuoteSchema.optional(),
  market: z
    .array(
      z.object({
        shopId: id,
        before: z.string(),
        closed: z.boolean(),
        lastRestockDay: z.number().int().nonnegative(),
        stock: z.array(z.object({ id, before: money, after: money })),
      }),
    )
    .optional(),
  loans: z.array(debtSchema),
  rules: z.array(scheduleSchema),
  lines: z.array(lineSchema),
  balances: z.array(z.object({ purseId: id, before: money, after: money })),
});
export const financeSchema = z
  .object({
    day: z.number().int().nonnegative().max(1e9).default(0),
    minuteOfDay: z.number().int().min(0).max(1439).optional(),
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
  table: Pick<CloudTable, "purses" | "holdings"> &
    Partial<Pick<CloudTable, "shops" | "stock" | "journal" | "sheets" | "realm">>,
  raw: Finance,
  days: number,
  estateTime?: import("./estate.ts").EstateTime,
  seasonReceiptId?: string,
) {
  z.number().int().min(1).max(3650).parse(days);
  const f = readFinance(raw);
  for (const r of f.rules)
    if (
      r.estateOperation === "rent" &&
      !estateRuleEligible({ ...table, shops: table.shops ?? [], stock: table.stock ?? [] }, r)
    )
      r.active = false;
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
  for (const r of f.rules.filter((r) => r.active && r.holdingId)) {
    if (
      !table.holdings.some((h) => h.id === r.holdingId && h.purseId === r.purseId && h.quantity > 0)
    )
      throw Error(
        `Inventory source for “${r.name}” is missing or belongs to another account. Update or pause this schedule.`,
      );
  }
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
  const market = scheduledMarket(table.shops || [], table.stock || [], f.day + days);
  for (const r of f.rules)
    if (r.estateOperation === "rent") r.active = raw.rules.find((x) => x.id === r.id)!.active;
  const operations = table.journal?.propertyOperations
    ? previewEstate(
        {
          ...table,
          journal: { ...table.journal, finance: f },
          shops: table.shops ?? [],
          stock: table.stock ?? [],
          sheets: table.sheets ?? [],
          listings: [],
          loans: [],
          notes: [],
          ledger: [],
        },
        days,
        balances,
        estateTime,
      )
    : undefined;
  return quoteSchema.parse({
    ...(seasonReceiptId && table.journal?.tradeEconomy?.settings.enabled ? { tradeSeason: previewTradeSeason({
      ...table, journal: { ...table.journal, tradeEconomy: operations?.tradeEconomy ?? table.journal.tradeEconomy },
    }, seasonReceiptId) } : {}),
    ...(operations ? { propertyOperations: operations } : {}),
    ...(market.length ? { market } : {}),
    loans: f.loans,
    rules: operations?.rules ?? f.rules,
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
  const quote = previewDowntime(table, f, d.days, undefined, d.quote.tradeSeason?.id);
  if (JSON.stringify(quote) !== JSON.stringify(d.quote))
    throw Error(
      "Campaign finances changed after this preview. Recalculate downtime before approving.",
    );
  applyFinanceQuote(table, quote, { id: d.id, name: d.name }, at);
  f.day += d.days;
  d.status = "applied";
  d.appliedAt = at;
  d.sessionId = sessionId;
}

/** Shared atomic settlement for approved downtime and within-session clock advances. */
export function applyFinanceQuote(table: CloudTable, quote: z.infer<typeof quoteSchema>, receipt: {id:string;name:string}, at:number) {
  const f = table.journal!.finance!;
  for (const l of quote.lines) {
    const debt = quote.loans.find((x) => x.id === l.id);
    financeMove(
      table,
      l.purseId,
      l.kind === "income" ? l.paid : -l.paid,
      `${receipt.id}-${l.id}`,
      `${receipt.name}: ${l.name}`,
      at,
      !!debt?.lenderId,
    );
    if (debt?.lenderId)
      financeMove(
        table,
        debt.lenderId,
        l.paid,
        `${receipt.id}-${l.id}-lender`,
        `${receipt.name}: ${l.name} repayment`,
        at,
        true,
      );
  }
  const stockBefore = new Map(table.stock.map((line) => [line.id, line.quantity]));
  for (const market of quote.market || []) {
    const shop = table.shops.find((s) => s.id === market.shopId)!;
    shop.closed = market.closed;
    shop.schedule!.lastRestockDay = market.lastRestockDay;
    for (const line of market.stock)
      table.stock.find((s) => s.id === line.id)!.quantity = line.after;
  }
  f.loans = quote.loans;
  f.rules = quote.rules;
  if (quote.propertyOperations) {
    const operations = quote.propertyOperations;
    for (const move of operations.movements) {
      financeMove(table, move.purseId, -move.copper, `${receipt.id}-${move.id}`, move.summary, at);
      const line = table.ledger[table.ledger.length - 1];
      if (move.copper) {
        if (move.shopId) line.shopId = move.shopId;
        if (move.transactionType) line.transactionType = move.transactionType;
        else if (move.shopId) line.transactionType = "purchase";
        if (move.trade) line.trade = move.trade;
      }
    }
    table.holdings = operations.holdings as CloudTable["holdings"];
    for (const after of operations.stock) {
      const line = table.stock.find((s) => s.id === after.id),
        before = stockBefore.get(after.id);
      if (
        line &&
        before !== null &&
        before !== undefined &&
        after.quantity !== null &&
        line.quantity !== null
      )
        line.quantity += after.quantity - before;
    }
    table.journal!.propertyOperations = operations.state;
    if (operations.tradeEconomy) table.journal!.tradeEconomy = operations.tradeEconomy;
    for (const [i, notice] of operations.notices.entries())
      table.journal!.events.push({
        id: `${receipt.id}-property-${i}`,
        at,
        kind: "management",
        propertyId: notice.propertyId,
        purseId: table.holdings.find((h) => h.id === notice.propertyId)?.purseId,
        summary: notice.summary.slice(0, 500),
      });
  }
  if (quote.tradeSeason) applyTradeSeason(table, quote.tradeSeason, at, f.day + (f.downtime.find(d => d.id === receipt.id)?.days ?? 0),
    "downtime", `Approved downtime: ${receipt.name}`);
  for (const trade of table.journal!.tradeEconomy?.receipts ?? []) if (trade.at === 0) trade.at = at;
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
