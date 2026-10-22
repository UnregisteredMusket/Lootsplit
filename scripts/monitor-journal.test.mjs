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
  monitorApi,
  changeRegistryStatus,
  activeSegments,
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

test("provider rejection does not invent expired authorization and rate limits have specific actions", async () => {
  const { monitorSnapshot } = await import("../cloudflare/monitor-journal.mjs");
  const DB = localAccountDb();
  try {
    for (const code of ["HTTP_403", "HTTP_403_RATE_LIMITED"]) {
      const snapshot = reading();
      snapshot.development = {
        state: "unavailable",
        checkedAt: instant,
        data: null,
        errorCode: code,
      };
      const result = await monitorSnapshot({ DB }, "owner", {
        force: true,
        now: instant,
        collector: async () => snapshot,
      });
      const entry = result.diagnostics.find((d) => d.component === "GitHub workflows");
      assert.equal(entry.color, "yellow");
      assert.doesNotMatch(entry.symptom, /expired|rejected authorization/);
      assert.match(
        entry.symptom,
        code.endsWith("LIMITED") ? /request limit/ : /does not establish why/,
      );
    }
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

// ---- 2026-10-21 reliability audit regressions ----
const { summarizeReport, monitorSnapshot, SNAPSHOT_CACHE_ROWS, REPORT_BYTE_BUDGET } = await import(
  "../cloudflare/monitor-journal.mjs"
);
async function provisionOwner(DB, at) {
  await DB.prepare(
    "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('owner','Owner','test@example.com',1,?,?)",
  )
    .bind(at, at)
    .run();
  await DB.prepare("INSERT INTO site_roles VALUES('owner','owner',?)").bind(at).run();
  await DB.prepare("INSERT OR IGNORE INTO member_access(user_id,status) VALUES('owner','active')").run();
}

test("impossible calendar dates are rejected instead of producing a stretched day", () => {
  assert.throws(() => dayBounds("2026-02-31", "America/New_York"), /calendar date/);
  assert.throws(() => dayBounds("2026-13-01", "America/New_York"), /calendar date/);
  const leap = dayBounds("2028-02-29", "America/New_York");
  assert.equal(leap.end - leap.start, 86400000);
});

test("only a short tail of provider-cache snapshots is retained; IDs keep increasing", async () => {
  const DB = localAccountDb();
  try {
    let last = 0;
    for (let i = 0; i < SNAPSHOT_CACHE_ROWS + 15; i++) {
      const snapshot = await monitorSnapshot({ DB }, "owner", {
        force: true,
        now: instant + i * 61000,
        collector: async () => reading(),
      });
      assert.ok(snapshot.snapshotId > last, "snapshot IDs never move backwards");
      last = snapshot.snapshotId;
    }
    const rows = await DB.prepare(
      "SELECT COUNT(*) AS n, MAX(revision) AS newest FROM owner_monitor_snapshots",
    ).first();
    assert.ok(rows.n <= SNAPSHOT_CACHE_ROWS + 1, `retained ${rows.n} cache rows`);
    assert.equal(rows.newest, last, "the newest snapshot is always kept");
  } finally {
    DB.close();
  }
});

test("oversized reports summarize long lists explicitly without reducing totals", () => {
  const item = (i, failed = false) => ({
    id: `entry-${i}`,
    source: failed ? "diagnostics" : "workflows",
    observedAt: instant + i,
    summary: (failed ? "Workflow failure: " : "Workflow success: ") + "x".repeat(900),
  });
  const evidence = Array.from({ length: 3000 }, (_, i) => item(i, i === 7));
  const report = {
    id: "America/New_York:2026-10-20",
    summary: "2026-10-20: totals.",
    gaps: ["a gap"],
    recommendations: ["a recommendation"],
    coverage: [{ id: "workflows", entries: 3000 }],
    unresolved: [{ component: "Workflow: x", color: "red" }],
    history: { totalEntries: 3000 },
    evidence,
    correlations: [],
    builds: evidence.slice(0, 400),
    performance: [],
    incidents: [],
    trends: [],
  };
  summarizeReport(report, 500_000);
  assert.ok(new TextEncoder().encode(JSON.stringify(report)).length <= 500_000);
  assert.equal(report.summarized.sections.evidence.total, 3000);
  assert.ok(report.summarized.sections.evidence.shown < 3000);
  assert.ok(
    report.evidence.some((e) => e.id === "entry-7"),
    "failures are kept ahead of routine entries",
  );
  assert.deepEqual(
    report.evidence.map((e) => e.observedAt),
    [...report.evidence.map((e) => e.observedAt)].sort((a, b) => a - b),
    "summarized lists stay chronological",
  );
  assert.equal(report.history.totalEntries, 3000, "totals are never reduced");
  assert.deepEqual(report.unresolved, [{ component: "Workflow: x", color: "red" }]);
  assert.match(report.summary, /Long lists are summarized; \d+ more entries are in History/);
  const small = { summary: "s", evidence: [item(1)], builds: [] };
  assert.equal(summarizeReport(small).summarized, undefined, "reports within budget are unchanged");
  assert.ok(REPORT_BYTE_BUDGET < 2_000_000, "budget stays below D1's 2 MB row limit");
  const stuck = { summary: "s", gaps: ["y".repeat(600_000)], evidence: [] };
  assert.throws(() => summarizeReport(stuck, 500_000), /too large/);
});

test("expected intervals start when monitoring began; boundary slots belong to the right day", async () => {
  const DB = localAccountDb();
  try {
    const created = Date.parse("2026-10-20T20:00:00Z"); // 16:00 in New York
    await initializeMonitor(DB, created);
    const { start, end } = dayBounds("2026-10-20", "America/New_York");
    for (const slot of [start, end])
      await recordLog(DB, {
        id: `interval:${slot}`,
        source: "monitoring",
        observedAt: slot,
        summary: `slot ${slot}`,
        outcome: "missed",
      });
    const report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, end + 600000);
    assert.match(report.gaps.join("\n"), /0\/16 scheduled half-hour intervals/);
    assert.match(report.gaps.join("\n"), /Scheduled monitoring began at 2026-10-20T20:00:00\.000Z/);
    const ids = report.evidence.map((e) => e.id);
    assert.ok(ids.includes(`interval:${end}`), "the window ending at midnight is this day's");
    assert.ok(!ids.includes(`interval:${start}`), "the window ending at the day's start is not");
  } finally {
    DB.close();
  }
});

test("failing daily reports back off, then a failed placeholder unblocks later days", async () => {
  const base = localAccountDb();
  let breakReports = true;
  // Fail every attempt to save a real report, as an oversized or erroring report would.
  const DB = {
    ...base,
    prepare(sql) {
      const prepared = base.prepare(sql);
      prepared.sql = sql;
      return prepared;
    },
    async batch(statements) {
      if (breakReports && statements.some((s) => /INSERT INTO owner_monitor_reports VALUES\(\?,\?,\?,\?,\?\) ON CONFLICT/.test(s.sql)))
        throw Error("simulated storage failure");
      return base.batch(statements);
    },
  };
  try {
    const created = Date.parse("2026-10-20T12:00:00Z");
    await provisionOwner(DB, created);
    await initializeMonitor(DB, created);
    const tick = Date.parse("2026-10-21T05:00:00Z"); // after the 00:10 New York report time
    const options = { integrations: false, collector: async () => reading() };
    const failures = async () =>
      (
        await DB.prepare(
          "SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='reports' AND id LIKE 'report-failure:%'",
        ).first()
      ).n;
    await scheduledMonitor({ DB }, tick, { ...options, now: tick });
    assert.equal(await failures(), 1);
    await scheduledMonitor({ DB }, tick + 30000, { ...options, now: tick + 30000 });
    assert.equal(await failures(), 1, "no retry inside the backoff window");
    for (const offset of [60, 180, 420, 900])
      await scheduledMonitor({ DB }, tick + offset * 1000, { ...options, now: tick + offset * 1000 });
    assert.equal(await failures(), 5);
    assert.equal(
      await DB.prepare("SELECT COUNT(*) AS n FROM owner_monitor_reports").first().then((r) => r.n),
      0,
      "no placeholder before the attempt limit",
    );
    const last = tick + 1860000;
    await scheduledMonitor({ DB }, last, { ...options, now: last });
    const placeholder = await DB.prepare("SELECT * FROM owner_monitor_reports").first();
    assert.equal(placeholder.day, "2026-10-20");
    assert.equal(JSON.parse(placeholder.body).failed, true);
    assert.ok(placeholder.generated_at < last, "Daily reporting stays red until a real report");
    breakReports = false;
    const real = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, last + 60000);
    assert.equal(real.failed, undefined);
    assert.equal(
      JSON.parse((await DB.prepare("SELECT body FROM owner_monitor_reports").first()).body).failed,
      undefined,
      "Generate previous day replaces the placeholder",
    );
  } finally {
    base.close();
  }
});

const HOUR = 3600000;
async function ownerSession(DB, id = "owner-1", role = "owner") {
  await DB.prepare(
    'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
  )
    .bind(id, `Owner ${id}`, `${id}@example.com`, "2026-01-01", "2026-01-01")
    .run();
  await DB.prepare(
    'INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)',
  )
    .bind(`s-${id}`, "2999-01-01T00:00:00.000Z", `t-${id}`, "2026-01-01", "2026-01-01", id)
    .run();
  if (role) await DB.prepare("INSERT INTO site_roles VALUES(?,?,?)").bind(id, role, 0).run();
  return (route, body) =>
    monitorApi(
      { DB },
      id,
      `s-${id}`,
      new Request(`https://test/api/account/owner/monitor/${route}`, {
        method: body ? "POST" : "GET",
      }),
      body,
    );
}
const registryOf = async (call, id) => (await call("registry")).logs.find((l) => l.id === id);

test("active segments subtract retired spans, including an open one", () => {
  assert.deepEqual(activeSegments(0, 100, []), [[0, 100]]);
  assert.deepEqual(activeSegments(0, 100, [{ retiredAt: 20, reinstatedAt: 40 }]), [
    [0, 20],
    [40, 100],
  ]);
  assert.deepEqual(activeSegments(0, 100, [{ retiredAt: 60, reinstatedAt: null }]), [[0, 60]]);
  assert.deepEqual(activeSegments(0, 100, [{ retiredAt: -5, reinstatedAt: null }]), []);
});

test("owner retires and reinstates a custom log once per event; built-ins and stale revisions are refused", async () => {
  const DB = localAccountDb();
  try {
    const call = await ownerSession(DB);
    const register = {
      id: "external-feed",
      name: "External feed",
      description: "Disposable",
      mode: "external",
      expectedMs: HOUR,
    };
    await call("registry", register);
    await call("entry", {
      source: "external-feed",
      id: "before-retire",
      summary: "Observed before retirement",
      observedAt: Date.now() - 1000,
    });
    const before = await registryOf(call, "external-feed");
    assert.equal(before.revision, 0);
    assert.equal(before.retired, null);
    await assert.rejects(
      () => call("registry/retire", { id: "monitoring", eventId: "e0", revision: 0 }),
      /Built-in logs/,
    );
    await assert.rejects(
      () => call("registry/retire", { id: "external-feed", eventId: "e1", revision: 5 }),
      /changed/,
    );
    await assert.rejects(
      () => call("registry/retire", { id: "missing", eventId: "e1", revision: 0 }),
      /not registered/,
    );
    await assert.rejects(() => call("registry/retire", { id: "external-feed" }), /event identifier/);
    const retired = await call("registry/retire", {
      id: "external-feed",
      eventId: "e1",
      revision: 0,
      reason: "Feed decommissioned",
    });
    assert.equal(retired.revision, 1);
    assert.equal(retired.retired.retiredBy.name, "Owner owner-1");
    assert.equal(retired.retired.reason, "Feed decommissioned");
    // A retried request is applied once.
    const retry = await call("registry/retire", { id: "external-feed", eventId: "e1", revision: 0 });
    assert.equal(retry.revision, 1);
    await assert.rejects(
      () => call("registry/reinstate", { id: "external-feed", eventId: "e1", revision: 1 }),
      /another registry change/,
    );
    await assert.rejects(
      () => call("registry/retire", { id: "external-feed", eventId: "e2", revision: 1 }),
      /already retired/,
    );
    // Updating the definition keeps the retirement.
    await call("registry", { ...register, name: "External feed (renamed)" });
    const renamed = await registryOf(call, "external-feed");
    assert.equal(renamed.revision, 2);
    assert.ok(renamed.retired, "re-registering does not silently reinstate");
    const reinstated = await call("registry/reinstate", {
      id: "external-feed",
      eventId: "e3",
      revision: 2,
    });
    assert.equal(reinstated.retired, null);
    assert.equal(reinstated.retirements.length, 1);
    assert.ok(reinstated.retirements[0].reinstatedAt >= reinstated.retirements[0].retiredAt);
    // History is retained: the original entry plus both audit entries, all exportable.
    const history = await call("export?source=external-feed");
    const ids = history.entries.map((e) => e.id);
    assert.ok(ids.includes("external:external-feed:before-retire"));
    assert.ok(ids.includes("registry:external-feed:e1"));
    assert.ok(ids.includes("registry:external-feed:e3"));
    assert.equal(
      (await DB.prepare("SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE id LIKE 'registry:%'").first()).n,
      2,
    );
  } finally {
    DB.close();
  }
});

test("only the current owner may retire or reinstate a log", async () => {
  const DB = localAccountDb();
  try {
    const owner = await ownerSession(DB, "owner-2");
    await owner("registry", {
      id: "owned-feed",
      name: "Owned feed",
      description: "",
      mode: "event",
      expectedMs: 0,
    });
    const admin = await ownerSession(DB, "admin-1", "admin");
    const member = await ownerSession(DB, "member-1", null);
    for (const call of [admin, member])
      await assert.rejects(
        () => call("registry/retire", { id: "owned-feed", eventId: "x", revision: 0 }),
        (error) => error.status === 403,
      );
    // The commit guard rejects a write whose session ended between check and commit.
    const settings = await initializeMonitor(DB);
    assert.ok(settings);
    await assert.rejects(
      () =>
        changeRegistryStatus(DB, { id: "owned-feed", eventId: "y", revision: 0 }, "retire", "owner-2", Date.now(), {
          sql: "0",
          binds: [],
        }),
      /authorization changed/,
    );
    assert.equal((await registryOf(owner, "owned-feed")).retired, null);
  } finally {
    DB.close();
  }
});

test("daily reports list retired spans separately and never report them as missing data", async () => {
  const DB = localAccountDb();
  try {
    const { start: d1 } = dayBounds("2026-10-17", "America/New_York");
    await initializeMonitor(DB, d1 - 86400000);
    await DB.prepare("INSERT INTO \"user\"(id,name,email,emailVerified,createdAt,updatedAt) VALUES('o','Olive','o@example.com',1,'x','x')").run();
    await DB.prepare("INSERT INTO owner_monitor_registry(id,body,registered_at) VALUES('feed',?,?)")
      .bind(
        JSON.stringify({ id: "feed", name: "Feed", mode: "external", expectedMs: HOUR, builtin: false }),
        d1 - 86400000,
      )
      .run();
    const hourly = async (from, to) => {
      for (let at = from; at <= to; at += HOUR)
        await recordLog(DB, { id: `feed-${at}`, source: "feed", observedAt: at, summary: "ok" }, at);
    };
    // Day 1: hourly data until noon, then retired.
    await hourly(d1, d1 + 12 * HOUR);
    await changeRegistryStatus(DB, { id: "feed", eventId: "r1", revision: 0 }, "retire", "o", d1 + 12 * HOUR + 1);
    const { start: d2 } = dayBounds("2026-10-18", "America/New_York");
    const { start: d3, end: e3 } = dayBounds("2026-10-19", "America/New_York");
    // Day 3: reinstated at noon, hourly data from then on.
    await changeRegistryStatus(DB, { id: "feed", eventId: "r2", revision: 1 }, "reinstate", "o", d3 + 12 * HOUR);
    await hourly(d3 + 12 * HOUR, e3 - HOUR);
    const after = e3 + 86400000;
    const r1 = await generateReport(DB, "2026-10-17", DEFAULT_CONFIG, after);
    const c1 = r1.coverage.find((c) => c.id === "feed");
    assert.equal(c1.gap, null, "the retired afternoon is not a gap");
    assert.equal(c1.retiredSpans.length, 1);
    assert.equal(r1.retiredLogs[0].retiredBy.name, "Olive");
    assert.doesNotMatch(r1.gaps.join("\n"), /Feed/);
    const r2 = await generateReport(DB, "2026-10-18", DEFAULT_CONFIG, after);
    assert.equal(r2.coverage.find((c) => c.id === "feed"), undefined, "not active coverage");
    assert.equal(r2.retiredLogs.length, 1);
    assert.equal(r2.retiredLogs[0].id, "feed");
    assert.equal(r2.retiredLogs[0].retiredAt, d1 + 12 * HOUR + 1);
    assert.doesNotMatch(r2.gaps.join("\n"), /Feed/);
    assert.match(r2.summary, /1 retired log span is listed separately/);
    const r3 = await generateReport(DB, "2026-10-19", DEFAULT_CONFIG, after);
    const c3 = r3.coverage.find((c) => c.id === "feed");
    assert.equal(c3.gap, null, "coverage resumes at reinstatement; the retired morning is not a gap");
    assert.ok(r3.retiredLogs[0].reinstatedAt === d3 + 12 * HOUR);
    // A reinstated source that then stops reporting is a gap again.
    const { start: d4 } = dayBounds("2026-10-20", "America/New_York");
    const r4 = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, d4 + 2 * 86400000);
    assert.match(r4.coverage.find((c) => c.id === "feed").gap, /No data/);
    assert.equal(r4.retiredLogs.length, 0);
    // Retiring for the rest of a day with no data while active is still a gap for the active part.
    await DB.prepare("INSERT INTO owner_monitor_registry(id,body,registered_at) VALUES('quiet',?,?)")
      .bind(JSON.stringify({ id: "quiet", name: "Quiet", mode: "external", expectedMs: HOUR, builtin: false }), d1 - 86400000)
      .run();
    await changeRegistryStatus(DB, { id: "quiet", eventId: "q1", revision: 0 }, "retire", "o", d4 + 6 * HOUR);
    const r4b = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, d4 + 2 * 86400000);
    assert.match(r4b.coverage.find((c) => c.id === "quiet").gap, /while this source was active/);
    // Every stored entry remains in history, including during and after retirement.
    const history = await monitorHistory(DB, new URL("https://test/export?source=feed&limit=100"));
    assert.ok(history.entries.length >= 26);
  } finally {
    DB.close();
  }
});
