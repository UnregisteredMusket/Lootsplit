import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { applyCommand } from "./commands.ts";
import { applyCloudTable, buyFromShop, economySnapshot } from "./economy.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readFinance } from "./finance.ts";
import { fromCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import {
  currentPropertyRules,
  currentPurchasedHolding,
  debtForLoanRequest,
  fundingRecordForDebt,
  loanRecordId,
  holdingRecordId,
} from "./finance-record-links.ts";
const dm: CloudSeat = { id: "dm", token: "", name: "DM", role: "dm", purseIds: [] };
const fixture = (): CloudTable => ({
  ...emptyCloudTable(),
  purses: [
    { id: "hero", kind: "character", name: "Hero", coins: fromCopper(1000) },
    { id: "other", kind: "character", name: "Other", coins: fromCopper(1000) },
  ],
});

test("real loan approvals connect only the exact persisted source request and borrower", () => {
  let table = applyCommand(fixture(), dm, {
    id: "request",
    kind: "loan",
    purseId: "hero",
    copper: 100,
    note: "Duplicate loan name",
  });
  table = applyCommand(table, dm, {
    id: "approval",
    kind: "decision",
    loanId: "request",
    status: "approved",
  });
  const debts = readFinance(table.journal!.finance).loans;
  assert.equal(debtForLoanRequest(table.loans[0]!, debts)?.id, "debt-request");
  assert.equal(
    debtForLoanRequest({ ...table.loans[0]!, id: "lookalike-request" }, debts),
    undefined,
  );
  assert.equal(debtForLoanRequest({ ...table.loans[0]!, purseId: "other" }, debts), undefined);
  assert.equal(debtForLoanRequest({ ...table.loans[0]!, status: "pending" }, debts), undefined);
  assert.equal(
    debtForLoanRequest(table.loans[0]!, [...debts, { ...debts[0]!, id: "ambiguous" }]),
    undefined,
  );
  assert.equal(
    fundingRecordForDebt(debts[0]!, table.ledger),
    undefined,
    "legacy approval has no stored request-to-ledger command relation",
  );
  assert.equal(table.ledger[0]!.id, "approval");
});
test("real funded debt retains its exact original funding row after repayments and rejects lookalikes", () => {
  let table = applyCommand(fixture(), dm, {
    id: "funding",
    kind: "finance-loan",
    principal: 100,
    terms: {
      name: "Guild",
      purseId: "hero",
      lenderId: "",
      rateBps: 0,
      periodDays: 30,
      compound: false,
      payment: 0,
    },
  });
  table = applyCommand(table, dm, {
    id: "repay",
    kind: "bank-repay",
    loanId: "funding",
    copper: 20,
  });
  const debt = readFinance(table.journal!.finance).loans[0]!;
  assert.equal(debt.principal, 80);
  assert.equal(fundingRecordForDebt(debt, table.ledger)?.id, "funding-borrower");
  assert.equal(fundingRecordForDebt(debt, table.ledger)?.copper, 100);
  assert.equal(fundingRecordForDebt({ ...debt, purseId: "other" }, table.ledger), undefined);
  assert.equal(fundingRecordForDebt(debt, [{ ...table.ledger[0]!, id: "lookalike" }]), undefined);
});
test("purchase links identify only the original current lot, never same-name or transferred inventory", async () => {
  const table = fixture();
  table.shops = [
    {
      id: "shop",
      name: "Shop",
      keeper: "",
      place: "",
      notes: "",
      sellRate: 1,
      buyRate: 0.5,
      wealth: "modest",
      category: "mixed",
      priceScale: 1,
    },
  ];
  table.stock = [
    {
      id: "stock",
      shopId: "shop",
      name: "Duplicate item",
      copper: 100,
      baseCopper: 100,
      rarity: "common",
      quantity: 2,
      notes: "Original notes",
    },
  ];
  const shared = applyCommand(table, dm, {
    id: "purchase",
    kind: "buy",
    stockId: "stock",
    purseId: "hero",
    quantity: 1,
  });
  assert.equal(currentPurchasedHolding(shared.ledger[0]!, shared.holdings)?.id, "purchase-item");
  assert.equal(
    currentPurchasedHolding(
      { ...shared.ledger[0]!, purchase: { stockId: "stock", quantity: 1, holding: null } },
      shared.holdings,
    ),
    undefined,
    "explicit service/no-item metadata is never overridden by a command-ID lookalike",
  );
  assert.equal(
    currentPurchasedHolding({ ...shared.ledger[0]!, transactionType: "payment" }, shared.holdings),
    undefined,
  );
  assert.equal(
    currentPurchasedHolding(shared.ledger[0]!, [{ ...shared.holdings[0]!, purseId: "other" }]),
    undefined,
  );
  assert.equal(
    currentPurchasedHolding(shared.ledger[0]!, [{ ...shared.holdings[0]!, quantity: 0 }]),
    undefined,
  );
  assert.equal(currentPurchasedHolding(shared.ledger[0]!, []), undefined);
  assert.equal(
    currentPurchasedHolding(shared.ledger[0]!, [...shared.holdings, { ...shared.holdings[0]! }]),
    undefined,
  );
  table.listings = [
    {
      id: "listing",
      name: "Duplicate item",
      kind: "item",
      copper: 100,
      quantity: 1,
      notes: "Listing notes",
    },
  ];
  const listed = applyCommand(table, dm, {
    id: "listing-purchase",
    kind: "listing",
    listingId: "listing",
    purseId: "hero",
    quantity: 1,
  });
  assert.equal(
    currentPurchasedHolding(listed.ledger[0]!, listed.holdings)?.id,
    "listing-purchase-item",
  );
  assert.equal(
    currentPurchasedHolding(listed.ledger[0]!, [
      { ...listed.holdings[0]!, id: "same-name-new-lot" },
    ]),
    undefined,
  );
  await applyCloudTable(table);
  await buyFromShop({ stockId: "stock", purseId: "hero", quantity: 1 });
  const purchased = await economySnapshot();
  const row = purchased.ledger[0]!,
    holding = purchased.holdings[0]!;
  assert.equal(currentPurchasedHolding(row, purchased.holdings)?.id, holding.id);
  assert.equal(currentPurchasedHolding(row, [{ ...holding, id: "same-name-new-lot" }]), undefined);
  assert.equal(currentPurchasedHolding(row, [{ ...holding, purseId: "other" }]), undefined);
  assert.equal(currentPurchasedHolding(row, [{ ...holding, quantity: 0 }]), undefined);
  assert.equal(currentPurchasedHolding(row, []), undefined);
  assert.equal(row.purchase!.holding!.notes, "Original notes");
  assert.equal(holdingRecordId("lot with spaces"), "holding-lot%20with%20spaces");
  assert.equal(loanRecordId("loan/1"), "loan-loan%2F1");
});
test("property readout uses exact current holding/owner rules from the ordinary privacy projection", () => {
  let table = fixture();
  table.holdings = [
    {
      id: "owned-inn",
      purseId: "hero",
      name: "Same inn",
      kind: "property",
      quantity: 1,
      unitCopper: 1000,
      notes: "",
    },
    {
      id: "other-inn",
      purseId: "other",
      name: "Same inn",
      kind: "property",
      quantity: 1,
      unitCopper: 1000,
      notes: "",
    },
  ];
  for (const [id, holdingId, purseId] of [
    ["own-income", "owned-inn", "hero"],
    ["private-expense", "other-inn", "other"],
  ]) {
    table = applyCommand(table, dm, {
      id: `plan-${id}`,
      kind: "finance-rule",
      rule: {
        id: id!,
        holdingId: holdingId!,
        purseId: purseId!,
        name: "Same agreement",
        kind: "income",
        copper: 100,
        periodDays: 7,
        active: true,
      },
    });
  }
  const player = projectRecord(table, { id: "player", role: "player", purseIds: ["hero"] });
  const finance = readFinance(player.journal!.finance);
  const ownRules = currentPropertyRules(table.holdings[0]!, finance.rules);
  assert.deepEqual(
    ownRules.map((rule) => rule.id),
    ["own-income"],
  );
  assert.equal(currentPropertyRules(table.holdings[1]!, finance.rules).length, 0);
  assert.equal(
    currentPropertyRules(
      { ...table.holdings[0]!, purseId: "other" },
      readFinance(table.journal!.finance).rules,
    ).length,
    0,
  );
  assert.equal(finance.downtime.length, 0);
});
