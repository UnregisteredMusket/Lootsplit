import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticCopy,
  needsAttention,
  resolvedCopy,
  sanitizeForCopy,
  severityCounts,
  sparkline,
  statusWord,
  usageGauges,
} from "./field-summary.ts";
import type { CloudflareUsage, MonitorDiagnostic } from "./types.ts";

const check = (over: Partial<MonitorDiagnostic> & { severity?: string | null }) =>
  ({
    component: "Worker",
    color: "green",
    state: "healthy",
    symptom: "",
    impact: "",
    action: "",
    firstOccurredAt: null,
    latestCheckAt: 0,
    lastSuccessAt: null,
    durationMs: 0,
    errorCode: null,
    confirmedCause: null,
    suspectedCause: null,
    retainedFailure: false,
    ...over,
  }) as MonitorDiagnostic & { severity?: string | null };

test("the status word mirrors the widget face", () => {
  assert.equal(statusWord({ status: "healthy", color: "green" }, false), "HEALTHY");
  assert.equal(statusWord({ status: "attention", color: "yellow" }, false), "ATTENTION");
  assert.equal(statusWord({ status: "failure", color: "red" }, false), "FAILURE");
  assert.equal(statusWord({ color: "yellow" }, false), "UNVERIFIED");
  assert.equal(statusWord({ status: "healthy" }, true), "STALE");
  assert.equal(statusWord(undefined, false), "UNVERIFIED");
});

test("counts and Needs attention follow the widget severity rule, most severe first", () => {
  const diagnostics = [
    check({ component: "Ok", color: "green" }),
    check({ component: "Limit", color: "yellow", coverageLimit: true }),
    check({ component: "Old", color: "yellow", durationMs: 10 }),
    check({ component: "Down", color: "red" }),
    check({ component: "Older", color: "yellow", durationMs: 50 }),
  ];
  assert.deepEqual(severityCounts(diagnostics), { critical: 1, warning: 2, info: 1 });
  assert.deepEqual(
    needsAttention(diagnostics).map((i) => i.check.component),
    ["Down", "Older", "Old", "Limit"],
  );
  assert.deepEqual(severityCounts(undefined), { critical: 0, warning: 0, info: 0 });
});

test("copied diagnostics never carry emails, tokens or join codes", () => {
  const owner = "private.owner@example.test";
  const text = sanitizeForCopy(
    `Owner ${owner} saw Authorization: Bearer abc.def.ghi with token=s3cr3tvalue on https://lootsplitter.com/share?join=MMVX5G2Q&t=xyz room MMVX5G2Q key ${"a".repeat(40)}`,
  );
  assert.doesNotMatch(text, /@/);
  assert.doesNotMatch(text, /private\.owner/);
  assert.doesNotMatch(text, /abc\.def\.ghi/);
  assert.doesNotMatch(text, /s3cr3tvalue/);
  assert.doesNotMatch(text, /MMVX5G2Q/);
  assert.doesNotMatch(text, /join=/);
  assert.doesNotMatch(text, /a{24}/);
  assert.match(text, /https:\/\/lootsplitter\.com\/share/);
  // Ordinary diagnostic wording survives.
  assert.equal(
    sanitizeForCopy("Session checks failed · READ_FAILED · HTTP 503 · Worker version 1.13.0"),
    "Session checks failed · READ_FAILED · HTTP 503 · Worker version 1.13.0",
  );
});

test("a copied diagnostic and a resolved item read as plain sanitized summaries", () => {
  const copy = diagnosticCopy(
    check({
      component: "Multiplayer",
      color: "red",
      state: "error",
      symptom: "Room round trip failed for room AB12CD34",
      firstOccurredAt: Date.UTC(2026, 9, 26, 10),
      durationMs: 31 * 60000,
      impact: "Players cannot join.",
      action: "Email owner@example.com",
    }),
    Date.UTC(2026, 9, 26, 11),
  );
  assert.match(copy, /^Lootsplitter Field monitor · CRIT · Multiplayer/);
  assert.match(copy, /Duration: 31m/);
  assert.match(copy, /2026-10-26T10:00:00.000Z/);
  assert.doesNotMatch(copy, /AB12CD34|@/);
  const resolved = resolvedCopy({
    component: "Worker errors",
    severity: "warning",
    startedAt: Date.UTC(2026, 9, 26, 8),
    resolvedAt: Date.UTC(2026, 9, 26, 9, 30),
    durationMs: 90 * 60000,
    symptom: "1 Worker error",
  });
  assert.match(resolved, /resolved WARN · Worker errors/);
  assert.match(resolved, /lasted 1h 30m/);
});

test("the sparkline breaks at missing readings instead of drawing zero", () => {
  const { runs, max, measured } = sparkline([1, 2, null, 4, 2], 40, 10);
  assert.equal(runs.length, 2);
  assert.equal(max, 4);
  assert.equal(measured, 4);
  assert.equal(sparkline([null, null], 40, 10).max, null);
});

test("plan-usage gauges use the billing cycle, or current storage, and keep gaps", () => {
  const usage = {
    state: "ready",
    checkedAt: 1,
    data: {
      metrics: [
        {
          key: "requests",
          label: "Worker requests",
          unit: "count",
          state: "ready",
          errorCode: null,
          level: "attention",
          month: { value: 1, share: 1, percent: 82 },
        },
        {
          key: "d1StorageBytes",
          label: "D1 storage",
          unit: "bytes",
          state: "ready",
          errorCode: null,
          level: "ok",
          current: { value: 1, allowance: 5, percent: 3 },
        },
        {
          key: "cpuMs",
          label: "Worker CPU",
          unit: "ms",
          state: "unavailable",
          errorCode: "READ_FAILED",
          level: "unavailable",
        },
      ],
    },
  } as unknown as CloudflareUsage;
  assert.deepEqual(
    usageGauges(usage).map((g) => [g.key, g.percent, g.unavailable]),
    [
      ["requests", 82, null],
      ["d1StorageBytes", 3, null],
      ["cpuMs", null, "READ_FAILED"],
    ],
  );
  assert.deepEqual(usageGauges(undefined), []);
});
