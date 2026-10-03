import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignAnalytics, publicGameMetrics } from "./analytics.ts";
import { emptyCloudTable } from "./cloud.ts";
import type { LedgerLine } from "./types.ts";

const row = (
  id: string,
  copper: number,
  transactionType?: LedgerLine["transactionType"],
  summary = id,
  purseId = "p",
): LedgerLine => ({ id, at: 1, copper, transactionType, summary, purseId, shopId: null });

test("spending counts purchases/payments exactly once, with voids and internal movements excluded", () => {
  const table = emptyCloudTable();
  table.ledger = [
    row("buy", -101, "purchase"),
    row("buy", -101, "purchase"),
    row("payment", -200, "payment"),
    row("transfer", -900, "transfer"),
    row("adjust", -900, "adjustment"),
    row("loan", 500, "loan"),
    row("sale", 300, "sale"),
    row("voided", -400, "purchase"),
    row("undo", 400, "void", "Voided purchase (void:voided)"),
    row("revenue", 250, "payment"),
  ];
  const metrics = campaignAnalytics(table);
  assert.equal(metrics.spentCopper, 301);
  assert.equal(metrics.purchaseCount, 1);
  assert.equal(metrics.salesCopper, 300);
  assert.equal(metrics.loanCopper, 500);
  assert.deepEqual(publicGameMetrics(metrics), { spentCopper: 301 });
  assert.deepEqual(campaignAnalytics(table), metrics);
});

test("old ledger classification is conservative and wallet scoping stays campaign-specific", () => {
  const table = emptyCloudTable();
  table.ledger = [
    row("a", -100, undefined, "Bought 1 Sword from Smith"),
    row("b", -50, undefined, "Payment approved: Inn"),
    row("c", -999, undefined, "Gave funds"),
    row("d", -999, undefined, "Custom legacy adjustment"),
    row("e", -75, "purchase", "other", "other"),
  ];
  assert.equal(campaignAnalytics(table).spentCopper, 225);
  assert.equal(campaignAnalytics(table, ["p"]).spentCopper, 150);
  assert.equal(campaignAnalytics(table).unclassifiedCount, 1);
  assert.equal(campaignAnalytics(table, []).spentCopper, 0);
});

test("a mismatched reversal cannot erase spending; unsafe totals fail visibly", () => {
  const table = emptyCloudTable();
  table.ledger = [row("a", -100, "purchase"), row("v", 100, "void", "Voided x (void:a)", "other")];
  assert.equal(campaignAnalytics(table).spentCopper, 100);
  table.ledger.push(row("b", -Number.MAX_SAFE_INTEGER, "purchase"));
  assert.throws(() => campaignAnalytics(table), /exact numeric range/);
});

test("inventory and character counts use existing records without mutating them", () => {
  const table = emptyCloudTable();
  table.purses = [
    {
      id: "p",
      name: "Private name",
      kind: "character",
      coins: { cp: 0, sp: 0, ep: 0, gp: 2, pp: 0 },
    },
  ];
  table.holdings = [
    {
      id: "h",
      purseId: "p",
      name: "Sword",
      kind: "item",
      quantity: 2,
      unitCopper: 75,
      notes: "private",
    },
  ];
  const before = JSON.stringify(table);
  const metrics = campaignAnalytics(table);
  assert.equal(metrics.playerCharacters, 1);
  assert.equal(metrics.inventoryValueCopper, 150);
  assert.equal(JSON.stringify(table), before);
  assert.equal(JSON.stringify(metrics).includes("Private"), false);
});
