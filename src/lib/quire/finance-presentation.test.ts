import { selectSessionLedgerRows, sessionSummary } from "./journal.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  denominationCopper,
  repaymentPreview,
  nextFinancePeriod,
  financialRows,
  financialTotals,
} from "./finance-presentation.ts";
import { acceptedMutation } from "./mutation-outcome.ts";
test("finance entry and previews retain integer copper and interest-first rules", () => {
  assert.equal(denominationCopper("1 gp 5 sp"), 150);
  assert.equal(denominationCopper("2 ep 4 cp"), 104);
  assert.equal(denominationCopper("-1 gp"), null);
  assert.deepEqual(repaymentPreview(150, 1000, 100, 500), {
    towardInterest: 100,
    towardPrincipal: 50,
    remainingDebt: 950,
    remainingCoins: 350,
  });
  assert.equal(repaymentPreview(501, 1000, 100, 500), null);
  assert.equal(repaymentPreview(0.5, 1000, 100, 500), null);
  assert.equal(nextFinancePeriod(20, 7, 3, true), 24);
  assert.equal(nextFinancePeriod(20, 7, 3, false), null);
});
test("rejected mutations stay rejected while accepted queues are distinct", async () => {
  await assert.rejects(
    acceptedMutation(
      async () => {
        throw Error("Rejected loan");
      },
      () => true,
    ),
    /Rejected loan/,
  );
  assert.deepEqual(
    await acceptedMutation(
      async () => undefined,
      () => false,
    ),
    { status: "committed" },
  );
  assert.deepEqual(
    await acceptedMutation(
      async () => undefined,
      () => true,
    ),
    { status: "pending" },
  );
  let pending = false;
  let reject!: (reason: Error) => void;
  const rejected = acceptedMutation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    () => pending,
  );
  pending = true; // A different concurrent valid action must not make this one succeed.
  reject(Error("Invalid concurrent command"));
  await assert.rejects(rejected, /Invalid concurrent command/);
});
test("financial filters preserve every original row and transfer-aware totals", () => {
  const rows = [
    {
      id: "a",
      at: 1,
      purseId: "p",
      shopId: null,
      summary: "Inn bill",
      copper: -100,
      transactionType: "payment" as const,
    },
    {
      id: "b",
      at: 2,
      purseId: "p",
      shopId: null,
      summary: "Transfer",
      copper: 500,
      transactionType: "transfer" as const,
    },
    { id: "c", at: 3, purseId: "other", shopId: null, summary: "Gift", copper: 30 },
  ];
  assert.equal(financialRows(rows, { account: "", type: "", query: "" }).length, 3);
  assert.deepEqual(financialTotals(financialRows(rows, { account: "p", type: "", query: "" })), {
    received: 0,
    spent: 100,
    net: 400,
  });
  assert.deepEqual(
    financialRows(rows, { account: "p", type: "payment", query: "inn", from: 1, to: 2 }).map(
      (r) => r.id,
    ),
    ["a"],
  );
});

test("personal reports share exact canonical legacy transfer and session boundaries", () => {
  const rows = [
    { id: "before", at: 10, purseId: "p", shopId: null, summary: "Old purchase", copper: -30 },
    { id: "sent", at: 10, purseId: "p", shopId: null, summary: "Transfer sent", copper: -100 },
    {
      id: "received",
      at: 10,
      purseId: "p",
      shopId: null,
      summary: "Transfer received",
      copper: 100,
    },
    { id: "income", at: 11, purseId: "p", shopId: null, summary: "Loot", copper: 50 },
    { id: "next", at: 12, purseId: "p", shopId: null, summary: "Next session", copper: 500 },
  ];
  const session = {
    id: "s",
    name: "Same millisecond",
    startedAt: 10,
    endedAt: 12,
    startLedgerIds: ["before"],
    endLedgerIds: ["before", "sent", "received", "income"],
  };
  const selected = selectSessionLedgerRows(rows, session, ["p"]);
  assert.deepEqual(
    selected.map((r) => r.id),
    ["sent", "received", "income"],
  );
  assert.deepEqual(
    financialTotals(financialRows(selected, { account: "", type: "", query: "" })),
    sessionSummary(rows, session, ["p"]),
  );
  assert.deepEqual(
    selectSessionLedgerRows(rows, { id: "old", name: "Legacy", startedAt: 10, endedAt: 12 }).map(
      (r) => r.id,
    ),
    ["before", "sent", "received", "income"],
  );
});
