import assert from "node:assert/strict";
import test from "node:test";
import "fake-indexeddb/auto";
import { applyCommand, type CommandInput, tablePatch } from "./commands.ts";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { fromCopper, toCopper } from "./money.ts";
import { previewDowntime, readFinance, type Terms } from "./finance.ts";
import { sessionSummary } from "./journal.ts";
import {
  applyCloudTable,
  economySnapshot,
  executeFinanceCommand,
  snapshot,
  restore,
  decideLoan,
  voidLedgerLine,
  removePurse,
} from "./economy.ts";
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { ...dm, role: "player", purseIds: ["a"] };
const terms: Terms = {
  name: "Guild loan",
  purseId: "a",
  lenderId: "",
  rateBps: 1000,
  periodDays: 10,
  compound: false,
  payment: 200,
};
const fixture = (): CloudTable => ({
  ...emptyCloudTable(),
  purses: [
    { id: "a", name: "A", kind: "character", coins: fromCopper(1000) },
    { id: "b", name: "Party", kind: "party", coins: fromCopper(5000) },
  ],
  holdings: [
    {
      id: "inn",
      name: "Inn",
      purseId: "a",
      kind: "item",
      quantity: 1,
      unitCopper: 10000,
      notes: "Original notes",
    },
  ],
});
let seq = 0;
function act(t: CloudTable, cmd: CommandInput) {
  return applyCommand(t, dm, { ...cmd, id: `c${++seq}` });
}
function funded(overrides: Partial<Terms> = {}) {
  return act(fixture(), {
    kind: "finance-loan",
    terms: { ...terms, ...overrides },
    principal: 1000,
  });
}
function settle(t: CloudTable, days: number) {
  const plan = act(t, { kind: "downtime-plan", days, name: "Travel" });
  return act(plan, {
    kind: "session",
    name: "Return",
    end: false,
    downtimeId: plan.journal!.finance!.downtime.at(-1)!.id,
  });
}
test("downtime previews have no writes; interest and installments apply once with session accounting", () => {
  const t = funded();
  const before = structuredClone(t);
  const quote = previewDowntime(t, t.journal!.finance!, 20);
  assert.deepEqual(t, before);
  assert.equal(quote.lines[0].interest, 190);
  assert.equal(quote.lines[0].paid, 400);
  assert.equal(quote.loans[0].principal, 790);
  const plan = act(t, { kind: "downtime-plan", days: 20, name: "Travel" });
  assert.deepEqual(plan.purses, t.purses);
  assert.deepEqual(plan.holdings, t.holdings);
  const id = plan.journal!.finance!.downtime[0].id;
  assert.throws(
    () => act(plan, { kind: "session", name: "Return", end: false }),
    /Review and approve/,
  );
  const applied = act(plan, { kind: "session", name: "Return", end: false, downtimeId: id });
  assert.equal(toCopper(applied.purses[0].coins), 1600);
  assert.equal(applied.journal!.finance!.day, 20);
  assert.equal(sessionSummary(applied.ledger, applied.journal!.sessions[0]).spent, 400);
  assert.throws(
    () => act(applied, { kind: "session", name: "Again", end: false, downtimeId: id }),
    /already been decided/,
  );
  assert.deepEqual(applied.holdings, before.holdings);
});
test("split downtime retains partial periods and fractional interest", () => {
  const a = funded({ rateBps: 333, payment: 0 });
  const once = settle(a, 30),
    split = settle(settle(a, 13), 17);
  assert.deepEqual(split.journal!.finance!.loans, once.journal!.finance!.loans);
  assert.equal(once.journal!.finance!.loans[0].interest, 99);
  assert.equal(once.journal!.finance!.loans[0].interestRemainder, 9000);
});
test("simple versus compound interest and principal caps are deterministic", () => {
  assert.equal(settle(funded({ payment: 0 }), 20).journal!.finance!.loans[0].interest, 200);
  assert.equal(
    settle(funded({ payment: 0, compound: true }), 20).journal!.finance!.loans[0].interest,
    210,
  );
  const paid = settle(funded({ payment: 5000 }), 30).journal!.finance!.loans[0];
  assert.equal(paid.principal + paid.interest, 0);
  assert.equal(paid.paid, 1100);
});
test("revenue precedes payments; expenses and debt preserve shortfalls without negative balances", () => {
  let t = funded({ payment: 500, rateBps: 0 });
  t.purses[0].coins = fromCopper(0);
  t = act(t, {
    kind: "finance-rule",
    rule: {
      id: "rent",
      name: "Rent",
      purseId: "a",
      kind: "expense",
      copper: 200,
      periodDays: 10,
      holdingId: "",
      active: true,
    },
  });
  t = act(t, {
    kind: "finance-rule",
    rule: {
      id: "income",
      name: "Inn revenue",
      purseId: "a",
      kind: "income",
      copper: 100,
      periodDays: 10,
      holdingId: "inn",
      active: true,
    },
  });
  const next = settle(t, 10),
    f = next.journal!.finance!;
  assert.equal(toCopper(next.purses[0].coins), 0);
  assert.equal(f.loans[0].principal, 900);
  assert.equal(f.loans[0].due, 400);
  assert.equal(f.rules[0].arrears, 200);
  next.purses[0].coins = fromCopper(1500);
  const later = settle(next, 10).journal!.finance!;
  assert.equal(later.loans[0].principal, 0);
  assert.equal(later.rules[0].arrears, 0);
});
test("inventory ownership and stale financial previews block approval without touching input", () => {
  let t = act(fixture(), {
    kind: "finance-rule",
    rule: {
      id: "r",
      name: "Inn revenue",
      purseId: "a",
      kind: "income",
      copper: 100,
      periodDays: 1,
      holdingId: "inn",
      active: true,
    },
  });
  t = act(t, { kind: "downtime-plan", name: "Travel", days: 7 });
  const pending = t.journal!.finance!.downtime[0];
  const changed = structuredClone(t);
  changed.purses[0].coins = fromCopper(999);
  assert.throws(
    () => act(changed, { kind: "session", name: "Return", end: false, downtimeId: pending.id }),
    /changed after this preview/,
  );
  assert.equal(changed.journal!.finance!.day, 0);
  t.holdings[0].purseId = "b";
  assert.throws(
    () => act(t, { kind: "session", name: "Return", end: false, downtimeId: pending.id }),
    /Inventory source/,
  );
});
test("new loans conserve internal campaign money; manual repayments reduce interest first", () => {
  let t = funded({ lenderId: "b", payment: 0 });
  assert.equal(
    t.purses.reduce((n, p) => n + toCopper(p.coins), 0),
    6000,
  );
  t = settle(t, 10);
  const loanId = t.journal!.finance!.loans[0].id;
  t = act(t, { kind: "finance-repay", loanId, copper: 150 });
  assert.equal(t.journal!.finance!.loans[0].principal, 950);
  assert.equal(t.journal!.finance!.loans[0].interest, 0);
  assert.equal(
    t.purses.reduce((n, p) => n + toCopper(p.coins), 0),
    6000,
  );
  assert.throws(() => act(t, { kind: "finance-repay", loanId, copper: 951 }), /exceeds/);
});
test("legacy loans can be tracked once without new money; newly approved loans automatically track debt", () => {
  let t = fixture();
  t.loans = [
    {
      id: "old",
      at: 1,
      purseId: "a",
      purseName: "A",
      copper: 1000,
      note: "Old loan",
      status: "approved",
    },
  ];
  t = act(t, { kind: "finance-loan", sourceLoanId: "old", principal: 1000, terms });
  assert.equal(toCopper(t.purses[0].coins), 1000);
  assert.throws(
    () => act(t, { kind: "finance-loan", sourceLoanId: "old", principal: 1000, terms }),
    /already tracked/,
  );
  t = act(t, { kind: "loan", purseId: "a", copper: 100, note: "New loan" });
  t = act(t, { kind: "decision", loanId: t.loans.at(-1)!.id, status: "approved" });
  assert.equal(t.journal!.finance!.loans.length, 2);
});
test("players cannot create finance commands, approve downtime, repay or alter terms", () => {
  const t = funded(),
    loanId = t.journal!.finance!.loans[0].id;
  const commands: CommandInput[] = [
    { kind: "finance-loan", terms, principal: 1000 },
    { kind: "finance-terms", terms, loanId },
    { kind: "finance-repay", loanId, copper: 1 },
    { kind: "downtime-plan", name: "Travel", days: 7 },
    { kind: "downtime-cancel", downtimeId: "x" },
    { kind: "session", name: "Return", end: false },
    {
      kind: "finance-rule",
      rule: {
        id: "r",
        name: "Revenue",
        purseId: "a",
        kind: "income",
        copper: 1,
        periodDays: 1,
        active: true,
        holdingId: "",
      },
    },
  ];
  for (const cmd of commands)
    assert.throws(() => applyCommand(t, player, { ...cmd, id: "bad" }), /Only the DM/);
});
test("cancel, pause, overflow and old-client journal patches preserve financial state", () => {
  let t = funded();
  t = act(t, { kind: "downtime-plan", name: "Travel", days: 7 });
  const before = structuredClone(t);
  assert.throws(
    () => act(t, { kind: "finance-terms", loanId: t.journal!.finance!.loans[0].id, terms }),
    /Cancel the pending/,
  );
  t = act(t, { kind: "downtime-cancel", downtimeId: t.journal!.finance!.downtime[0].id });
  assert.deepEqual(t.purses, before.purses);
  assert.equal(t.journal!.finance!.day, 0);
  const old = structuredClone(t);
  delete old.journal!.finance;
  const after = structuredClone(old);
  after.journal!.events.push({ id: "old-client", at: 1, summary: "Old edit", kind: "management" });
  const patched = act(t, tablePatch(old, after));
  assert.deepEqual(patched.journal!.finance, t.journal!.finance);
  const huge = funded({ rateBps: 100000, compound: true, payment: 0 });
  assert.throws(() => previewDowntime(huge, huge.journal!.finance!, 3650), /limit/);
  assert.equal(readCloudTable(fixture())!.journal!.finance, undefined);
});
test("local atomic approvals, backups, and legacy loan decisions retain campaign finance", async () => {
  const t = act(funded(), { kind: "downtime-plan", name: "Travel", days: 10 });
  await applyCloudTable(t);
  const downtimeId = t.journal!.finance!.downtime[0].id;
  const outcomes = await Promise.allSettled([
    executeFinanceCommand({ kind: "session", name: "Return", end: false, downtimeId }),
    executeFinanceCommand({ kind: "session", name: "Return", end: false, downtimeId }),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const saved = await economySnapshot();
  assert.equal(toCopper(saved.purses[0].coins), 1800);
  const backup = await snapshot();
  await applyCloudTable(fixture());
  await restore(backup);
  assert.deepEqual((await economySnapshot()).journal!.finance, saved.journal!.finance);
  const line = saved.ledger.find((l) => l.summary.startsWith("Finance:"))!;
  await assert.rejects(voidLedgerLine(line.id), /cannot be reversed/);
  const legacy = fixture();
  legacy.loans = [
    { id: "new", at: 1, purseId: "a", purseName: "A", copper: 50, note: "Loan", status: "pending" },
  ];
  await applyCloudTable(legacy);
  await decideLoan("new", "approved");
  assert.equal((await economySnapshot()).journal!.finance!.loans[0].principal, 50);
  assert.deepEqual(readFinance().loans, []);
});

test("account deletion cannot orphan an outstanding loan in local or shared play", async () => {
  const table = funded();
  const removed = structuredClone(table);
  removed.purses = removed.purses.filter((p) => p.id !== "a");
  assert.throws(() => act(table, tablePatch(table, removed)), /Settle this account/);
  await applyCloudTable(table);
  await assert.rejects(removePurse("a"), /Settle this account/);
  assert.equal((await economySnapshot()).purses.length, 2);
});

test("property plans and shop schedules settle atomically with approved downtime and preserve stock", () => {
  let t = fixture();
  t.holdings[0].kind = "property";
  t.shops = [{ id: "shop", name: "Shop", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "mixed", priceScale: 1 }];
  t.stock = [0, 20, null].map((quantity, i) => ({ id: `stock${i}`, shopId: "shop", name: "Goods", copper: 1, baseCopper: 1, rarity: "common", quantity, notes: "" }));
  const schedule = { cycleDays: 7, openDays: [0,1,2,3,4], restockEveryDays: 3, restockQuantity: 5, lastRestockDay: 0 };
  assert.throws(() => applyCommand(t, player, { id: "unauthorized", kind: "shop-schedule", shopId: "shop", schedule }), /DM/);
  assert.throws(() => applyCommand(t, player, { id: "unauthorized", kind: "property-plan", holdingId: "inn", income: 100, upkeep: 20, periodDays: 1, active: true }), /DM/);
  t = act(t, { kind: "shop-schedule", shopId: "shop", schedule });
  t = act(t, { kind: "property-plan", holdingId: "inn", income: 100, upkeep: 20, periodDays: 1, active: true });
  assert.equal(t.journal!.finance!.rules.length, 2);
  const plan = act(t, { kind: "downtime-plan", days: 5, name: "Property week" });
  assert.equal(plan.stock[0].quantity, 0);
  assert.equal(toCopper(plan.purses[0].coins), 1000);
  const downtimeId = plan.journal!.finance!.downtime.at(-1)!.id;
  const changed = structuredClone(plan); changed.stock[0].quantity = 1;
  assert.throws(() => act(changed, { kind: "session", name: "Return", end: false, downtimeId }), /changed after this preview/);
  const applied = act(plan, { kind: "session", name: "Return", end: false, downtimeId });
  assert.equal(toCopper(applied.purses[0].coins), 1400);
  assert.equal(applied.shops[0].closed, true);
  assert.deepEqual(applied.stock.map((s) => s.quantity), [5,20,null]);
  assert.equal(applied.shops[0].schedule!.lastRestockDay, 3);
  assert.throws(() => act(applied, { kind: "buy", stockId: "stock0", purseId: "a", quantity: 1 }), /closed/);
  assert.throws(() => act(applied, { kind: "session", name: "Again", end: false, downtimeId }), /already been decided/);
  assert.deepEqual(readCloudTable(applied)?.shops, applied.shops);
  const next = settle(applied, 2);
  assert.equal(next.shops[0].closed, false);
  assert.equal(next.shops[0].schedule!.lastRestockDay, 6);
  assert.equal(toCopper(next.purses[0].coins), 1560);
});

test("atomic local session closure archives complete records and clears only active logs", async () => {
  let t = fixture();
  t.notes = [{ id: "note", at: 1, from: "dm", to: "party", purseId: "a", text: "Preserve the chronicle" }];
  t.handouts = [];
  t = act(t, { kind: "session", name: "Archive me", end: false });
  t.ledger = [{ id: "old-ledger", at: 2, purseId: "a", shopId: null, summary: "History", copper: 10 }];
  await applyCloudTable(t);
  await executeFinanceCommand({ kind: "session", name: "Archive me", end: true });
  const saved = await economySnapshot();
  const record = JSON.parse(saved.journal!.reports!.at(-1)!.snapshot);
  assert.deepEqual(record.notes, t.notes);
  assert.deepEqual(record.ledger, t.ledger);
  assert.deepEqual(record.holdings, t.holdings);
  assert.deepEqual(saved.notes, []);
  assert.deepEqual(saved.ledger, []);
});

test("property plans reuse linked recurring rules instead of duplicating income", () => {
  let t = fixture(); t.holdings[0].kind = "property";
  t = act(t, { kind: "finance-rule", rule: { id: "legacy-property", name: "Rent", purseId: "a", kind: "income", copper: 100, periodDays: 7, holdingId: "inn", active: true } });
  t = act(t, { kind: "property-plan", holdingId: "inn", income: 200, upkeep: 0, periodDays: 7, active: true });
  assert.equal(t.journal!.finance!.rules.length, 1);
  assert.equal(t.journal!.finance!.rules[0].id, "legacy-property");
  assert.equal(toCopper(settle(t, 7).purses[0].coins), 1200);
});
