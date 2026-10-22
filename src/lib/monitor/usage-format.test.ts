import test from "node:test";
import assert from "node:assert/strict";
import {
  cycleName,
  formatPercent,
  formatUsage,
  ordinal,
  usageRows,
  usageUnavailableText,
} from "./usage-format.ts";
import type { CloudflareUsage } from "./types.ts";

const usage: CloudflareUsage = {
  state: "ready",
  checkedAt: 1,
  data: {
    scope: "account",
    plan: "Workers Paid",
    allowancesVerifiedOn: "2026-10-22",
    sources: [],
    windows: {
      timezone: "UTC",
      end: 1,
      day: { start: 0, end: 1 },
      week: { start: 0, end: 1, days: 7 },
      month: { start: 0, end: 1, days: 31, elapsedPercent: 69.355 },
    },
    complete: false,
    metrics: [
      {
        key: "requests",
        label: "Worker requests",
        unit: "count",
        state: "ready",
        errorCode: null,
        level: "ok",
        monthlyAllowance: 10_000_000,
        day: { value: 12345, share: 322580.645, percent: 3.827 },
        week: { value: 80000, share: 2258064.516, percent: 3.543 },
        month: { value: 300000, share: 10_000_000, percent: 3 },
      },
      {
        key: "cpuMs",
        label: "Worker CPU time",
        unit: "ms",
        state: "unavailable",
        errorCode: "HTTP_400",
        level: "unavailable",
      },
      {
        key: "d1StorageBytes",
        label: "D1 storage",
        unit: "bytes",
        state: "ready",
        errorCode: null,
        level: "ok",
        allowance: 5_000_000_000,
        current: { value: 12_000_000, allowance: 5_000_000_000, percent: 0.24 },
        databases: 1,
      },
    ],
  },
};

test("owner page usage rows show value and share per window; a missing metric is not zero", () => {
  const [requests, cpu, storage] = usageRows(usage);
  assert.deepEqual(requests.cells[0], {
    window: "Today",
    value: "12,345",
    share: "3.8% of daily share",
  });
  assert.equal(requests.cells[2].share, "3.0% of 10,000,000");
  assert.equal(cpu.unavailable, "HTTP_400");
  assert.deepEqual(cpu.cells, []);
  assert.equal(storage.cells[0].share, "0.24% of 5 GB included");
  assert.equal(formatPercent(undefined), "—");
  assert.equal(formatUsage(1500, "ms"), "1,500 ms");
});

test("unavailable usage explains why instead of showing numbers", () => {
  assert.deepEqual(usageRows({ state: "unavailable", checkedAt: null, data: null }), []);
  assert.match(usageUnavailableText(undefined), /Not provided/);
  assert.match(
    usageUnavailableText({ state: "not-connected", checkedAt: null, data: null }),
    /Not connected/,
  );
  assert.match(
    usageUnavailableText({
      state: "unavailable",
      checkedAt: 1,
      data: null,
      errorCode: "STALE_READING",
    }),
    /more than two hours old/,
  );
});

test("the billing-cycle window is labeled by its start; older readings say month", () => {
  const cycle: CloudflareUsage = structuredClone(usage);
  cycle.data!.windows.month = {
    ...cycle.data!.windows.month,
    basis: "billing-cycle",
    renewalDay: 11,
    resetsAt: Date.parse("2026-11-11T00:00:00Z"),
    label: "Cycle since Oct 11",
  };
  const [requests] = usageRows(cycle);
  assert.equal(requests.cells[2].window, "Cycle since Oct 11");
  assert.equal(cycleName(cycle.data!.windows.month), "cycle since Oct 11");
  assert.equal(usageRows(usage)[0].cells[2].window, "Month");
  assert.equal(cycleName(usage.data!.windows.month), "the month");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "23rd",
    "31st",
  ]);
});
