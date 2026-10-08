import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignAnalytics, emptyMetrics } from "./analytics.ts";
import { emptyCloudTable } from "./cloud.ts";
import { ownerAnalyticsGroups, type OwnerAnalyticsSnapshot } from "./owner-analytics-view.ts";

const snapshot = (metrics = emptyMetrics()): OwnerAnalyticsSnapshot => ({
  version: 1,
  scope: "current-shared-campaigns",
  asOf: 1700000000000,
  sharedCampaigns: 1,
  metrics,
});

test("owner presentation preserves exact purchase/payment accounting and separate sales", () => {
  const table = emptyCloudTable();
  table.ledger = [
    {
      id: "purchase",
      at: 1,
      purseId: "p",
      shopId: null,
      copper: -101,
      summary: "Private shop",
      transactionType: "purchase",
    },
    {
      id: "payment",
      at: 1,
      purseId: "p",
      shopId: null,
      copper: -20,
      summary: "Private reason",
      transactionType: "payment",
    },
    {
      id: "transfer",
      at: 1,
      purseId: "p",
      shopId: null,
      copper: -900,
      summary: "Private recipient",
      transactionType: "transfer",
    },
    {
      id: "sale",
      at: 1,
      purseId: "p",
      shopId: null,
      copper: 150,
      summary: "Private sale",
      transactionType: "sale",
    },
  ];
  const data = snapshot(campaignAnalytics(table));
  const before = JSON.stringify(data);
  const rows = ownerAnalyticsGroups(data).flatMap((group) => group.metrics);
  assert.equal(rows.find((row) => row.key === "spentCopper")?.value, "1 gp, 2 sp, 1 cp");
  assert.equal(rows.find((row) => row.key === "salesCopper")?.value, "1 gp, 5 sp");
  assert.equal(rows.find((row) => row.key === "transactionCount")?.value, "3");
  assert.equal(JSON.stringify(data), before);
  assert.equal(JSON.stringify(rows).includes("Private"), false);
});

test("all existing private metrics remain available and a genuine empty snapshot is zero", () => {
  const rows = ownerAnalyticsGroups(snapshot()).flatMap((group) => group.metrics);
  assert.deepEqual(rows.map((row) => row.key).sort(), Object.keys(emptyMetrics()).sort());
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.equal(rows.find((row) => row.key === "partyFunds")?.label, "Party fund wallets");
  assert.equal(rows.find((row) => row.key === "spentCopper")?.value, "0 cp");
  assert.equal(rows.find((row) => row.key === "sessions")?.value, "0");
});

test("missing, rounded, incompatible or undated analytics are unavailable rather than partial zero", () => {
  const data = snapshot();
  for (const value of [undefined, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        ownerAnalyticsGroups({
          ...data,
          metrics: { ...data.metrics, spentCopper: value as number },
        }),
      /unavailable or inexact/,
    );
  }
  for (const patch of [
    { scope: "all-installations" },
    { version: 2 },
    { asOf: 0 },
    { asOf: Number.MAX_SAFE_INTEGER },
    { sharedCampaigns: -1 },
  ])
    assert.throws(() => ownerAnalyticsGroups({ ...data, ...patch }), /unsupported format/);
  const exact = ownerAnalyticsGroups(
    snapshot({ ...emptyMetrics(), spentCopper: Number.MAX_SAFE_INTEGER }),
  );
  assert.equal(exact[0]?.metrics[0]?.value, "90071992547409 gp, 9 sp, 1 cp");
});
