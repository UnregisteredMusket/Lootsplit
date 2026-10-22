// Status semantics shown by the Field monitor, both Android widgets and the web dashboard:
// coverage limits are distinct from attention, one old Worker error is a recent-error warning
// instead of a 24-hour failure, a workflow step past its own deadline is not shown as running,
// and the compact widget payload drops only lists the widgets never read (with stated counts).
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  DEFAULT_CONFIG,
  INTERVAL,
  STEP_DEADLINE_GRACE_MS,
  diagnostic,
  overall,
  workerErrorCheck,
  workflowTaskEnded,
} from "../cloudflare/monitor-model.mjs";
import { monitorSnapshot, initializeMonitor, updateTask } from "../cloudflare/monitor-journal.mjs";
import { widgetSnapshot } from "../cloudflare/owner-monitor.mjs";

const MIN = 60000;
const HOUR = 60 * MIN;
// The production reading of 2026-10-22 02:45 UTC: one error in 23,674 requests, in the
// 00:00–00:30 window, and four later measured windows without errors.
const now = Date.parse("2026-10-22T02:45:17Z");
const window24 = {
  since: new Date(now - 24 * HOUR).toISOString(),
  until: new Date(now).toISOString(),
};
const slot = (iso) => Date.parse(iso);
const intervalsWith = (errorsBySlot) => {
  const list = [];
  for (let at = slot("2026-10-22T02:30:00Z"); at > now - 25 * HOUR; at -= INTERVAL)
    list.push({ slot: at, errors: errorsBySlot[new Date(at).toISOString()] ?? 0 });
  return list;
};

test("one old Worker error is an amber warning with its window, not a 24-hour failure", () => {
  const check = workerErrorCheck(
    { requests: 23674, errors: 1, ...window24 },
    intervalsWith({ "2026-10-22T00:30:00.000Z": 1 }),
  );
  assert.equal(check.state, "warning");
  assert.equal(check.brief, "1 error in 24h");
  assert.equal(check.lastAt, slot("2026-10-22T00:30:00Z"));
  assert.deepEqual(check.lastErrorWindow, {
    start: slot("2026-10-22T00:00:00Z"),
    end: slot("2026-10-22T00:30:00Z"),
  });
  assert.equal(check.errorCount, 1);
  assert.equal(check.requestCount, 23674);
  // The original sentence and raw counts stay in the symptom.
  assert.match(
    check.symptom,
    /^1 Worker error\(s\) were reported in the measured past-24-hour window/,
  );
  assert.match(check.symptom, /0\.004% of 23674 requests/);
  assert.match(
    check.symptom,
    /None since: the 4 later measured half-hours through 2026-10-22T02:30:00\.000Z/,
  );
});

test("Worker errors stay red when current, unaccounted for, frequent or of unknown rate", () => {
  const traffic = { requests: 23674, errors: 1, ...window24 };
  // In the newest measured half-hour.
  let check = workerErrorCheck(traffic, intervalsWith({ "2026-10-22T02:30:00.000Z": 1 }));
  assert.equal(check.state, "error");
  assert.match(check.symptom, /newest measured half-hour/);
  // Not in any measured half-hour (e.g. after the last scheduled collection): may be current.
  check = workerErrorCheck(traffic, intervalsWith({}));
  assert.equal(check.state, "error");
  assert.match(check.symptom, /1 error is not in any measured half-hour/);
  assert.equal(check.lastAt, null);
  // Unmeasured windows cannot account for errors.
  const gaps = intervalsWith({ "2026-10-22T00:30:00.000Z": 1 }).map((i) =>
    i.slot === slot("2026-10-22T00:30:00Z") ? { ...i, errors: null } : i,
  );
  assert.equal(workerErrorCheck(traffic, gaps).state, "error");
  // A 1% or higher rate is a failure even if the errors stopped.
  check = workerErrorCheck(
    { requests: 100, errors: 1, ...window24 },
    intervalsWith({ "2026-10-22T00:30:00.000Z": 1 }),
  );
  assert.equal(check.state, "error");
  assert.match(check.symptom, /error rate is at least 1%/);
  // Unknown request count: the rate is unknown, so it is not downgraded.
  assert.equal(
    workerErrorCheck({ errors: 1, ...window24 }, intervalsWith({ "2026-10-22T00:30:00.000Z": 1 }))
      .state,
    "error",
  );
  // No reading stays unavailable, never zero; zero errors are healthy with the request count.
  assert.equal(workerErrorCheck(null).state, "unavailable");
  assert.equal(workerErrorCheck({ requests: 5, errors: 0, ...window24 }).state, "healthy");
});

test("a warning replaces a rechecked failure but still tracks its first occurrence", () => {
  const red = diagnostic(null, { component: "Worker execution errors", state: "error" }, 1000);
  assert.equal(red.color, "red");
  const amber = diagnostic(red, { component: "Worker execution errors", state: "warning" }, 2000);
  assert.equal(amber.color, "yellow");
  assert.equal(amber.confirmedFailure, false);
  assert.equal(amber.retainedFailure, false);
  assert.equal(amber.firstOccurredAt, 1000);
  assert.equal(amber.recoveredAt, null);
  // An unavailable reading after a confirmed failure still keeps it red.
  assert.equal(diagnostic(red, { component: "x", state: "unavailable" }, 3000).color, "red");
});

test("overall status separates healthy-with-coverage-limit, attention, unverified and failure", () => {
  const green = (component) => ({ component, color: "green", state: "healthy" });
  const multiplayer = {
    component: "Multiplayer",
    color: "yellow",
    state: "unavailable",
    required: false,
    coverageLimit: true,
  };
  let result = overall([green("Backend"), multiplayer]);
  assert.equal(result.color, "green");
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.notes, ["Multiplayer"]);
  assert.equal(
    result.reason,
    "All required checks passed. Coverage limit noted (not a failure): Multiplayer.",
  );
  const warning = { component: "Worker execution errors", color: "yellow", state: "warning" };
  result = overall([green("Backend"), multiplayer, warning]);
  assert.equal(result.color, "yellow");
  assert.equal(result.status, "attention");
  assert.equal(result.label, "Recent problem needs review; current checks pass");
  assert.equal(result.reason, "Worker execution errors");
  const unverified = { component: "Cloudflare analytics", color: "yellow", state: "unavailable" };
  result = overall([warning, unverified]);
  assert.equal(result.status, "unverified");
  assert.equal(result.reason, "Worker execution errors, Cloudflare analytics");
  result = overall([warning, { component: "Storage", color: "red", state: "error" }]);
  assert.equal(result.status, "failure");
  assert.equal(result.reason, "Storage");
  assert.equal(overall([]).status, "unverified");
});

const source = (data, at) => ({ state: "ready", checkedAt: at, data });
const reading = (at, traffic) => ({
  checkedAt: at,
  health: {
    status: "healthy",
    checks: [
      { name: "Database", status: "healthy", durationMs: 1 },
      { name: "Website assets", status: "healthy", durationMs: 1 },
    ],
    stats: { accounts: 3, sharedCampaigns: 12, active5m: 0, active24h: 1, cloudBackups: 2 },
  },
  analytics: source({ metrics: { sessions: 1, transactionCount: 30 } }, at),
  development: source(
    {
      runs: [
        {
          id: 1,
          name: "Verify preserved functionality",
          branch: "main",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1",
          startedAt: at - HOUR,
          updatedAt: at - HOUR / 2,
        },
      ],
      active: [],
      openPulls: [],
      closedPulls: [],
      events: [],
    },
    at,
  ),
  traffic: source(traffic, at),
  release: source({ commit: "a".repeat(40) }, at),
});
/** Everything else current: a recent report and a fresh device report. */
async function seedHealthy(DB) {
  await DB.prepare(
    "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)",
  ).run();
  await DB.prepare(
    "INSERT INTO owner_monitor_reports VALUES('r','2026-10-21','America/New_York',?,'{}')",
  )
    .bind(now - HOUR)
    .run();
  await DB.prepare("INSERT INTO owner_monitor_devices VALUES('d','owner',?,'{}')")
    .bind(now - MIN)
    .run();
}
async function seedIntervals(DB, errorsBySlot) {
  for (const { slot: at, errors } of intervalsWith(errorsBySlot))
    await DB.prepare(
      "INSERT INTO owner_monitor_intervals(slot,outcome,collected_at,body) VALUES(?,?,?,?)",
    )
      .bind(
        at,
        "complete",
        at + 1000,
        JSON.stringify({
          summary: "Interval",
          metrics: [
            { key: "errors", label: "Worker errors in scheduled half-hour", value: errors },
          ],
        }),
      )
      .run();
}

test("the production reading reads as attention with a coverage note, not a failure", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 25 * HOUR);
    await seedHealthy(DB);
    await seedIntervals(DB, { "2026-10-22T00:30:00.000Z": 1 });
    const snapshot = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now,
      collector: async () => reading(now, { requests: 23674, errors: 1, ...window24 }),
    });
    const errors = snapshot.diagnostics.find((d) => d.component === "Worker execution errors");
    assert.equal(errors.color, "yellow");
    assert.equal(errors.state, "warning");
    assert.equal(errors.brief, "1 error in 24h");
    assert.equal(errors.lastAt, slot("2026-10-22T00:30:00Z"));
    assert.equal(errors.errorCode, "WORKER_ERRORS_OBSERVED");
    const multiplayer = snapshot.diagnostics.find((d) => d.component === "Multiplayer");
    assert.equal(multiplayer.color, "yellow", "The coverage limit stays visible");
    assert.equal(multiplayer.required, false);
    assert.equal(multiplayer.coverageLimit, true);
    assert.equal(snapshot.overall.status, "attention");
    assert.equal(snapshot.overall.reason, "Worker execution errors");
    assert.deepEqual(snapshot.overall.notes, ["Multiplayer"]);
    // A new error in the newest half-hour makes it a failure again.
    await DB.prepare("DELETE FROM owner_monitor_intervals").run();
    await seedIntervals(DB, { "2026-10-22T02:30:00.000Z": 1 });
    const failing = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now: now + 1000,
      collector: async () => reading(now + 1000, { requests: 23674, errors: 1, ...window24 }),
    });
    assert.equal(failing.overall.status, "failure");
    // Without any errors the same system reads healthy, with Multiplayer as a coverage note.
    const healthy = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now: now + 2000,
      collector: async () => reading(now + 2000, { requests: 23674, errors: 0, ...window24 }),
    });
    assert.equal(healthy.overall.color, "green");
    assert.equal(healthy.overall.status, "healthy");
    assert.match(healthy.overall.reason, /Coverage limit noted \(not a failure\): Multiplayer/);
    // History records each transition.
    const transitions = await DB.prepare(
      "SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='diagnostics' AND json_extract(body,'$.diagnostic.component')='Worker execution errors'",
    ).first();
    assert.equal(transitions.n, 3);
  } finally {
    DB.close();
  }
});

const step = (fields = {}) => ({
  id: "run:39696617175:1:development:dev-library-navigation",
  source: "workflow",
  state: "testing",
  branch: "main",
  startedAt: now - 160 * MIN,
  heartbeatAt: now - 159 * MIN,
  expectedUntil: now - 156 * MIN,
  ...fields,
});

test("a workflow step past its own deadline with no heartbeat has ended, even without GitHub data", () => {
  const ended = workflowTaskEnded(step(), { state: "unavailable", data: null }, now);
  assert.equal(ended.reason, "deadline-passed");
  assert.equal(ended.runId, 39696617175);
  assert.match(ended.progress, /declared deadline .* passed without a reported result/);
  // Outside the scanned GitHub runs (the production case) the same applies.
  assert.equal(
    workflowTaskEnded(step(), { state: "ready", data: { runs: [] } }, now).reason,
    "deadline-passed",
  );
  // GitHub evidence, when present, is preferred.
  assert.equal(
    workflowTaskEnded(
      step(),
      {
        state: "ready",
        data: {
          runs: [{ id: 39696617175, attempt: 1, status: "completed", conclusion: "success" }],
        },
      },
      now,
    ).reason,
    "run-completed",
  );
  // Still heartbeating, within the grace, without a deadline, or an owner task: unchanged.
  assert.equal(workflowTaskEnded(step({ heartbeatAt: now - MIN }), null, now), null);
  assert.equal(
    workflowTaskEnded(step({ expectedUntil: now - STEP_DEADLINE_GRACE_MS + MIN }), null, now),
    null,
  );
  assert.equal(workflowTaskEnded(step({ expectedUntil: null }), null, now), null);
  assert.equal(workflowTaskEnded(step({ id: "owner-task", source: "owner" }), null, now), null);
});

test("the stale TESTING card from production is presented as interrupted, stored row unchanged", async () => {
  const DB = localAccountDb();
  try {
    const start = now - 160 * MIN;
    await initializeMonitor(DB, start);
    const id = "run:39696617175:1:development:dev-library-navigation";
    await updateTask(
      DB,
      {
        id,
        eventId: `${id}:0:testing`,
        revision: 0,
        title: "dev-library-navigation",
        objective: "Run the existing required verification step.",
        state: "testing",
        source: "workflow",
        branch: "main",
        progress: "The actual runner is executing this step.",
        expectedUntil: start + 4 * MIN,
      },
      start,
      DEFAULT_CONFIG,
    );
    const snapshot = await monitorSnapshot({ DB }, "owner", {
      force: true,
      now,
      collector: async () => reading(now, { requests: 1, errors: 0, ...window24 }),
    });
    const status = snapshot.developmentStatus;
    assert.equal(status.warning, null, "No missing-telemetry warning for an ended step");
    assert.equal(status.task.state, "interrupted");
    assert.equal(status.task.storedState, "testing");
    assert.equal(status.task.active, false);
    assert.equal(status.task.endedBy.reason, "deadline-passed");
    const stored = JSON.parse(
      (await DB.prepare("SELECT body FROM owner_monitor_tasks WHERE id=?").bind(id).first()).body,
    );
    assert.equal(stored.state, "testing");
  } finally {
    DB.close();
  }
});

test("the compact widget view drops only unread bulky lists and states each omission", () => {
  const full = {
    checkedAt: now,
    overall: { color: "green", status: "healthy" },
    development: {
      state: "ready",
      checkedAt: now,
      data: {
        scannedRuns: 2,
        runs: [{ id: 1 }, { id: 2 }],
        active: [{ id: 2 }],
        activeActivity: 1,
        openPulls: [{ number: 5 }],
        closedPulls: [{ number: 4 }],
        latestDeployment: { id: 1 },
        events: [{ id: "run:2" }],
      },
    },
    devices: [{ id: "a" }, { id: "b" }],
    account: { name: "Owner", email: "owner@example.com" },
  };
  const compact = widgetSnapshot(full);
  assert.equal(compact.view, "widget");
  assert.equal(compact.development.data.runs, undefined);
  assert.equal(compact.development.data.closedPulls, undefined);
  assert.deepEqual(compact.development.data.omitted, { runs: 2, closedPulls: 1 });
  for (const key of [
    "active",
    "activeActivity",
    "openPulls",
    "latestDeployment",
    "events",
    "scannedRuns",
  ])
    assert.deepEqual(compact.development.data[key], full.development.data[key], key);
  assert.equal(compact.devices, undefined);
  assert.deepEqual(compact.omitted, { devices: 2 });
  assert.deepEqual(compact.account, full.account);
  assert.equal(full.development.data.runs.length, 2, "The full snapshot is not modified");
  // Unavailable sources pass through unchanged.
  const offline = widgetSnapshot({ development: { state: "unavailable", data: null } });
  assert.deepEqual(offline.development, { state: "unavailable", data: null });
});
