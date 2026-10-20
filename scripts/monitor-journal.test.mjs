import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  INTERVAL,
  DEFAULT_CONFIG,
  compareMetric,
  explanation,
  dayBounds,
  taskView,
  transitionTask,
  diagnostic,
  overall,
} from "../cloudflare/monitor-model.mjs";
import {
  initializeMonitor,
  collectInterval,
  generateReport,
  recordLog,
  scheduledMonitor,
  updateTask,
  monitorHistory,
} from "../cloudflare/monitor-journal.mjs";

const instant = Date.parse("2026-10-20T12:00:00Z");
const source = (data) => ({ state: "ready", checkedAt: instant, data });
const reading = (value = 10) => ({
  checkedAt: instant,
  health: {
    status: "healthy",
    checks: [{ name: "Database", status: "healthy", durationMs: 1 }],
    stats: { accounts: value, sharedCampaigns: 1, active5m: 1, active24h: 2, cloudBackups: 0 },
  },
  analytics: source({ metrics: { sessions: 1, transactionCount: 3 } }),
  development: source({ runs: [], active: [], openPulls: [] }),
  traffic: source({ requests: 10, errors: 0 }),
  release: source({ commit: "a".repeat(40) }),
});
test("comparison respects units, windows, zero baselines, unavailable values and counter resets", () => {
  const metric = (value) => ({ key: "x", label: "X", kind: "cumulative", unit: "count", value });
  assert.equal(compareMetric(metric(100), metric(115)).percent, 15);
  assert.equal(compareMetric(metric(0), metric(4)).percent, null);
  assert.equal(compareMetric(metric(10), metric(null)).change, null);
  assert.match(compareMetric(metric(10), metric(2)).reason, /reset/);
  assert.match(
    compareMetric({ ...metric(10), windowMs: 60 }, { ...metric(20), windowMs: 120 }).reason,
    /window/,
  );
  assert.equal(
    compareMetric({ ...metric(10), kind: "instant" }, { ...metric(2), kind: "instant" }).change,
    -8,
  );
  assert.match(explanation([compareMetric(undefined, metric(4))]), /cannot yet be measured/);
  assert.match(explanation([compareMetric(metric(4), metric(4))]), /No significant changes/);
});
test("calendar reports retain New York DST and non-hour offsets", () => {
  for (const [day, hours] of [
    ["2026-03-08", 23],
    ["2026-11-01", 25],
    ["2026-10-20", 24],
  ]) {
    const b = dayBounds(day, "America/New_York");
    assert.equal(b.end - b.start, hours * 3600000);
  }
  assert.equal(
    new Date(dayBounds("2026-10-20", "Asia/Kathmandu").start).toISOString(),
    "2026-10-19T18:15:00.000Z",
  );
});
test("task timing survives handoffs and does not count disconnected time as measured work", () => {
  let task = transitionTask(
    null,
    {
      id: "development-1",
      title: "Widget",
      objective: "Independent refresh",
      state: "active",
      progress: "Started",
    },
    instant,
  );
  task = transitionTask(
    task,
    { id: task.id, progress: "API verified", state: "testing" },
    instant + 120000,
  );
  assert.equal(task.timings.active, 120000);
  task = transitionTask(
    JSON.parse(JSON.stringify(task)),
    { id: task.id, state: "paused", blocker: "Awaiting runner" },
    instant + 20 * 60000,
  );
  assert.equal(task.timings.testing, 0);
  assert.equal(task.unobservedMs, 18 * 60000);
  assert.equal(taskView(task, instant + 60 * 60000).warning, null);
  const active = transitionTask(
    task,
    { id: task.id, state: "active", progress: "Resumed" },
    instant + 60 * 60000,
  );
  assert.equal(taskView(active, instant + 66 * 60000).warning.kind, "missing-telemetry");
  const recentHeartbeat = { ...active, progressAt: instant, heartbeatAt: instant + 60 * 60000 };
  assert.equal(taskView(recentHeartbeat, instant + 61 * 60000).warning.kind, "possible-stall");
  assert.equal(
    taskView({ ...recentHeartbeat, expectedUntil: instant + 120 * 60000 }, instant + 61 * 60000)
      .warning,
    null,
  );
});
test("diagnostics retain confirmed failures through disconnection and explicitly recover", () => {
  const error = diagnostic(
    null,
    { component: "Build", state: "error", symptom: "Test failed" },
    instant,
  );
  const lost = diagnostic(
    error,
    { component: "Build", state: "unavailable", symptom: "Could not check" },
    instant + 1000,
  );
  assert.equal(lost.color, "red");
  assert.equal(lost.retainedFailure, true);
  assert.equal(overall([lost]).color, "red");
  const recovered = diagnostic(lost, { component: "Build", state: "healthy" }, instant + 2000);
  assert.equal(recovered.recoveredAt, instant + 2000);
  assert.equal(overall([recovered]).color, "green");
});
test("real SQLite interval lease deduplicates retries and preserves comparison history and pagination", async () => {
  const DB = localAccountDb(),
    env = { DB };
  let calls = 0;
  try {
    const options = {
      now: instant,
      integrations: false,
      collector: async () => {
        calls++;
        return reading();
      },
    };
    await Promise.all([
      collectInterval(env, "owner", instant, options),
      collectInterval(env, "owner", instant, options),
    ]);
    assert.equal(calls, 1);
    await collectInterval(env, "owner", instant + INTERVAL, {
      ...options,
      now: instant + INTERVAL,
      collector: async () => reading(12),
    });
    const result = await DB.prepare("SELECT * FROM owner_monitor_intervals WHERE slot=?")
      .bind(instant + INTERVAL)
      .first();
    const body = JSON.parse(result.body);
    assert.equal(body.comparisons.find((c) => c.key === "accounts").change, 2);
    assert.equal(body.comparisons.find((c) => c.key === "accounts").percent, 20);
    assert.equal(body.metrics.find((c) => c.key === "requests").value, null);
    const page = await monitorHistory(
      DB,
      new URL("https://test/history?limit=1&source=monitoring"),
    );
    assert.equal(page.entries.length, 1);
    assert.ok(page.next);
    const older = await monitorHistory(
      DB,
      new URL(`https://test/history?limit=1&source=monitoring&before=${page.next}`),
    );
    assert.equal(older.entries[0].id, `interval:${instant}`);
  } finally {
    DB.close();
  }
});
test("collection failure is explicit and retry recovers without overwriting the failure event", async () => {
  const DB = localAccountDb();
  try {
    const result = await collectInterval({ DB }, "owner", instant, {
      now: instant,
      integrations: false,
      collector: async () => {
        throw Error("PRIVATE secret");
      },
    });
    assert.equal(result.outcome, "failed");
    await collectInterval({ DB }, "owner", instant, {
      now: instant + 60000,
      integrations: false,
      collector: async () => reading(),
    });
    const entries = await monitorHistory(DB, new URL("https://test/history?source=monitoring"));
    assert.equal(entries.entries.length, 2);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE|secret/);
  } finally {
    DB.close();
  }
});
test("registry includes future external logs and reports expose missing data and linked performance", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant - 86400000);
    await DB.prepare(
      "INSERT INTO owner_monitor_registry(id,body,registered_at) VALUES('external-audit',?,?)",
    )
      .bind(
        JSON.stringify({
          id: "external-audit",
          name: "External audit",
          mode: "external",
          expectedMs: 3600000,
        }),
        instant - 86400000,
      )
      .run();
    await recordLog(
      DB,
      {
        id: "slow-1",
        source: "performance",
        observedAt: instant,
        summary: "Equivalent test took 115ms instead of 100ms.",
        kind: "regression",
        baselineMs: 100,
        currentMs: 115,
      },
      instant,
    );
    const report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, instant + 86400000);
    assert.equal(report.performance[0].id, "slow-1");
    assert.match(report.coverage.find((c) => c.id === "external-audit").gap, /No data/);
    assert.match(report.gaps[0], /0\/48/);
    assert.ok(report.recommendations.some((r) => r.includes(">=15%")));
  } finally {
    DB.close();
  }
});
test("task events are idempotent and use optimistic concurrency in the persistent store", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant);
    const input = {
      id: "task-1",
      eventId: "event-1",
      revision: 0,
      title: "Monitoring",
      objective: "Keep observations",
      state: "active",
    };
    const first = await updateTask(DB, input, instant, DEFAULT_CONFIG);
    assert.equal(
      (await updateTask(DB, input, instant + 1000, DEFAULT_CONFIG)).revision,
      first.revision,
    );
    await assert.rejects(
      () => updateTask(DB, { ...input, eventId: "event-2" }, instant + 2000, DEFAULT_CONFIG),
      /Task changed/,
    );
    const updated = await updateTask(
      DB,
      { ...input, eventId: "event-2", revision: 1, state: "testing" },
      instant + 2000,
      DEFAULT_CONFIG,
    );
    assert.equal(updated.timings.active, 2000);
  } finally {
    DB.close();
  }
});
test("scheduler records missed slots, drains interruptions and never invents historical observations", async () => {
  const DB = localAccountDb();
  try {
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('owner','Owner','test@example.com',1,?,?)",
    )
      .bind(instant, instant)
      .run();
    await DB.prepare("INSERT INTO site_roles VALUES('owner','owner',?)").bind(instant).run();
    await DB.prepare(
      "INSERT OR IGNORE INTO member_access(user_id,status) VALUES('owner','active')",
    ).run();
    await initializeMonitor(DB, instant);
    await scheduledMonitor({ DB }, instant + 3 * INTERVAL, {
      now: instant + 3 * INTERVAL,
      integrations: false,
      collector: async () => reading(),
    });
    const intervals = (
      await DB.prepare("SELECT * FROM owner_monitor_intervals ORDER BY slot").all()
    ).results;
    assert.equal(intervals.length, 4);
    assert.deepEqual(
      intervals.map((i) => i.outcome),
      ["missed", "missed", "missed", "partial"],
    );
    assert.equal(JSON.parse(intervals[0].body).observedAt, null);
  } finally {
    DB.close();
  }
});

test("large performance import uses bounded bulk queries and late evidence refreshes its original report", async () => {
  const { collectPerformance } = await import("../cloudflare/monitor-journal.mjs");
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant - 86400000);
    const data = Array.from({ length: 1300 }, (_, id) =>
      JSON.stringify({
        id: String(id),
        name: "Equivalent workload",
        recordedAt: new Date(instant).toISOString(),
        current: {
          finishedAt: new Date(instant).toISOString(),
          durationMs: 115,
          url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1",
        },
        baseline: { durationMs: 100 },
        increasePercent: 15,
      }),
    ).join("\n");
    const fetcher = async (url) =>
      new Response(
        url.endsWith("regressions.jsonl")
          ? data
          : url.endsWith("resolutions.jsonl")
            ? ""
            : JSON.stringify({ scanAfter: new Date(instant).toISOString(), pending: [] }),
      );
    const result = await collectPerformance(DB, instant, fetcher);
    assert.equal(result.count, 1300);
    await collectPerformance(DB, instant, fetcher);
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE id LIKE 'performance:%'",
        ).first()
      ).n,
      1300,
    );
    const report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, instant + 86400000);
    assert.equal(report.performance.length, 1300);
    await recordLog(
      DB,
      {
        id: "late-observation",
        source: "development",
        observedAt: instant,
        summary: "Late recorded evidence",
      },
      instant + 86400000 + 1000,
    );
    assert.ok(
      await DB.prepare("SELECT * FROM owner_monitor_report_refresh WHERE report_id=?")
        .bind(report.id)
        .first(),
    );
    const corrected = await generateReport(
      DB,
      "2026-10-20",
      DEFAULT_CONFIG,
      instant + 86400000 + 2000,
    );
    assert.ok(corrected.evidence.find((e) => e.id === "late-observation"));
    assert.equal(
      await DB.prepare("SELECT * FROM owner_monitor_report_refresh WHERE report_id=?")
        .bind(report.id)
        .first(),
      null,
    );
  } finally {
    DB.close();
  }
});

test("an unrelated successful workflow cannot clear a confirmed failure or its disconnected history", async () => {
  const { monitorSnapshot } = await import("../cloudflare/monitor-journal.mjs");
  const DB = localAccountDb();
  try {
    const run = (name, conclusion) => ({
      id: name,
      name,
      branch: "main",
      status: "completed",
      conclusion,
      url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1",
    });
    const snapshot = reading();
    snapshot.development.data.runs = [run("Required tests", "failure"), run("Website", "success")];
    let result = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now: instant,
      collector: async () => snapshot,
    });
    assert.equal(
      result.diagnostics.find((d) => d.component === "Workflow: Required tests (main)").color,
      "red",
    );
    snapshot.development.data.runs = [run("Website", "success")];
    result = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now: instant + 1000,
      collector: async () => snapshot,
    });
    assert.equal(
      result.diagnostics.find((d) => d.component === "Workflow: Required tests (main)")
        .retainedFailure,
      true,
    );
    snapshot.development.data.runs = [run("Required tests", "success")];
    result = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now: instant + 2000,
      collector: async () => snapshot,
    });
    assert.equal(
      result.diagnostics.find((d) => d.component === "Workflow: Required tests (main)").color,
      "green",
    );
  } finally {
    DB.close();
  }
});

test("daily report carries unresolved incidents from earlier days until recovery is observed", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant - 2 * 86400000);
    const error = diagnostic(
      null,
      {
        component: "Storage",
        state: "error",
        symptom: "Write failed",
        action: "Inspect storage errors",
        required: true,
      },
      instant - 86400000,
    );
    await recordLog(
      DB,
      {
        id: "prior-storage",
        source: "diagnostics",
        observedAt: instant - 86400000,
        summary: "Storage error",
        diagnostic: error,
      },
      instant - 86400000,
    );
    let report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, instant + 86400000);
    assert.equal(report.unresolved[0].component, "Storage");
    assert.ok(report.recommendations.some((r) => r.includes("Storage")));
    const recovered = diagnostic(
      error,
      {
        component: "Storage",
        state: "healthy",
        symptom: "Storage responded",
        action: "No action required",
      },
      instant,
    );
    await recordLog(
      DB,
      {
        id: "storage-recovery",
        source: "diagnostics",
        observedAt: instant,
        summary: "Storage recovered",
        diagnostic: recovered,
      },
      instant,
    );
    report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, instant + 86400000 + 1);
    assert.equal(report.unresolved.length, 0);
    assert.equal(report.incidents[0].id, "storage-recovery");
  } finally {
    DB.close();
  }
});

test("historical traffic recovery preserves the original partial observation and retries idempotently", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant);
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('partial-owner','Owner','partial@example.invalid',1,?,?)",
    )
      .bind(new Date(instant).toISOString(), new Date(instant).toISOString())
      .run();
    await DB.prepare("INSERT INTO site_roles VALUES('partial-owner','owner',?)")
      .bind(instant)
      .run();
    await DB.prepare(
      "INSERT OR IGNORE INTO member_access(user_id,status) VALUES('partial-owner','active')",
    ).run();
    await collectInterval({ DB }, "partial-owner", instant, {
      now: instant,
      integrations: false,
      collector: async () => reading(),
    });
    const before = await DB.prepare("SELECT body FROM owner_monitor_intervals WHERE slot=?")
      .bind(instant)
      .first();
    let requests = 0;
    const fetcher = async () => {
      requests++;
      return Response.json({
        data: {
          viewer: {
            accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 8, errors: 0 } }] }],
          },
        },
      });
    };
    const env = {
      DB,
      OWNER_MONITOR_CLOUDFLARE_TOKEN: "synthetic-read-token",
      OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    };
    await scheduledMonitor(env, instant + 60000, {
      now: instant + 60000,
      fetcher,
      collector: async () => reading(),
    });
    const saved = await DB.prepare("SELECT outcome,body FROM owner_monitor_intervals WHERE slot=?")
      .bind(instant)
      .first();
    assert.equal(saved.outcome, "partial");
    assert.equal(JSON.parse(saved.body).summary, JSON.parse(before.body).summary);
    assert.equal(JSON.parse(saved.body).historicalTraffic.data.requests, 8);
    await scheduledMonitor(env, instant + 120000, {
      now: instant + 120000,
      fetcher,
      collector: async () => reading(),
    });
    assert.equal(requests, 1);
    const report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, instant + 86400000);
    const observed = report.trends.find((trend) => !trend.recovered);
    const recovered = report.trends.find((trend) => trend.recovered);
    assert.equal(observed.collectedAt, instant);
    assert.equal(observed.comparisons.find((metric) => metric.key === "requests").current, null);
    assert.equal(recovered.collectedAt, instant + 60000);
    assert.equal(recovered.comparisons.find((metric) => metric.key === "requests").current, 8);
    assert.ok(
      report.evidence.some((entry) => /Recovered 8 requests and 0 errors/.test(entry.summary)),
    );
  } finally {
    DB.close();
  }
});

test("latest collection/report failures and observed Worker errors override earlier successful checks", async () => {
  const { monitorSnapshot } = await import("../cloudflare/monitor-journal.mjs");
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant);
    await DB.prepare(
      "INSERT INTO owner_monitor_intervals(slot,outcome,collected_at,body) VALUES(?,'complete',?,'{}'),(?,'failed',?,'{}')",
    )
      .bind(instant - INTERVAL, instant - INTERVAL, instant, instant)
      .run();
    const reportId = "America/New_York:2026-10-19";
    await DB.prepare("INSERT INTO owner_monitor_reports VALUES(?,?,?,?,?)")
      .bind(reportId, "2026-10-19", "America/New_York", instant - 1000, "{}")
      .run();
    await recordLog(
      DB,
      {
        id: "report-failure-test",
        source: "reports",
        observedAt: instant,
        outcome: "failed",
        reportId,
        summary: "Daily report regeneration failed.",
      },
      instant,
    );
    const snapshot = reading();
    snapshot.traffic.data.errors = 2;
    const check = async (now) =>
      (
        await monitorSnapshot({ DB }, "owner", {
          now,
          force: true,
          collector: async () => snapshot,
        })
      ).diagnostics;
    let diagnostics = await check(instant + 1);
    for (const component of ["Scheduled collection", "Daily reporting", "Worker execution errors"])
      assert.equal(
        diagnostics.find((entry) => entry.component === component).color,
        "red",
        component,
      );
    await DB.prepare("UPDATE owner_monitor_intervals SET outcome='collecting' WHERE slot=?")
      .bind(instant)
      .run();
    snapshot.traffic = { state: "unavailable", checkedAt: instant + 2, data: null };
    diagnostics = await check(instant + 2);
    assert.equal(
      diagnostics.find((entry) => entry.component === "Scheduled collection").retainedFailure,
      true,
    );
    assert.equal(
      diagnostics.find((entry) => entry.component === "Worker execution errors").retainedFailure,
      true,
    );
    await DB.prepare(
      "INSERT INTO owner_monitor_reports VALUES('unrelated','2026-10-18','America/New_York',?,'{}')",
    )
      .bind(instant + 3)
      .run();
    diagnostics = await check(instant + 3);
    assert.equal(
      diagnostics.find((entry) => entry.component === "Daily reporting").color,
      "red",
      "A different report cannot resolve a failed regeneration",
    );
    await DB.prepare("UPDATE owner_monitor_intervals SET outcome='complete' WHERE slot=?")
      .bind(instant)
      .run();
    await DB.prepare("UPDATE owner_monitor_reports SET generated_at=? WHERE id=?")
      .bind(instant + 4, reportId)
      .run();
    snapshot.traffic = source({ requests: 10, errors: 0 });
    diagnostics = await check(instant + 4);
    for (const component of ["Scheduled collection", "Daily reporting", "Worker execution errors"])
      assert.equal(
        diagnostics.find((entry) => entry.component === component).color,
        "green",
        component,
      );
    await assert.rejects(generateReport(DB, "2026-10-22", DEFAULT_CONFIG, instant));
    assert.equal(
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='reports' AND json_extract(body,'$.outcome')='failed'",
        ).first()
      ).n,
      1,
      "Invalid user input is not a failed scheduled report",
    );
  } finally {
    DB.close();
  }
});
