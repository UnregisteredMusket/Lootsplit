// Regression tests for monitoring noise: orphaned workflow step telemetry, skipped/superseded
// workflow runs and finished branches must not read as attention, while real failures
// (especially on main) and genuine data gaps stay exactly as visible as before.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { DEFAULT_CONFIG, overall } from "../cloudflare/monitor-model.mjs";
import {
  monitorSnapshot,
  initializeMonitor,
  updateTask,
  recordLog,
  decisiveRun,
  recentlyResolved,
  MANUAL_COVERED_BY,
} from "../cloudflare/monitor-journal.mjs";
import { readFileSync, readdirSync } from "node:fs";

const instant = Date.parse("2026-10-21T12:00:00Z");
const HOUR = 3600000;
const source = (data) => ({ state: "ready", checkedAt: instant, data });
const reading = (development) => ({
  checkedAt: instant,
  health: {
    status: "healthy",
    checks: [{ name: "Database", status: "healthy", durationMs: 1 }],
    stats: { accounts: 1, sharedCampaigns: 1, active5m: 1, active24h: 2, cloudBackups: 0 },
  },
  analytics: source({ metrics: { sessions: 1, transactionCount: 3 } }),
  development,
  traffic: source({ requests: 10, errors: 0 }),
  release: source({ commit: "a".repeat(40) }),
});
const github = ({ runs = [], openPulls = [], closedPulls = [] } = {}) =>
  source({ runs, active: [], openPulls, closedPulls });
const unavailable = { state: "unavailable", checkedAt: instant, data: null, errorCode: "HTTP_502" };
let nextId = 1000;
const run = (name, branch, conclusion, fields = {}) => ({
  id: nextId++,
  name,
  branch,
  status: conclusion ? "completed" : "in_progress",
  conclusion,
  url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1",
  startedAt: instant - HOUR,
  updatedAt: instant - HOUR / 2,
  ...fields,
});
const pr = (number, headRef, fields = {}) => ({
  number,
  title: `Change ${number}`,
  draft: false,
  url: `https://github.com/UnregisteredMusket/Lootsplit/pull/${number}`,
  headRef,
  ...fields,
});
const snap = (DB, development, now = instant) =>
  monitorSnapshot({ DB }, "owner", {
    force: true,
    now,
    collector: async () => reading(development),
  });
const find = (result, component) => result.diagnostics.find((d) => d.component === component);
const attention = (result) =>
  overall(result.diagnostics)
    .reason.split(", ")
    .filter((c) => c.startsWith("Workflow:"));
async function workflowTask(DB, id, state, at, branch = "main") {
  await initializeMonitor(DB, at);
  return updateTask(
    DB,
    {
      id,
      eventId: `${id}:0:${state}`,
      revision: 0,
      title: id.split(":").at(-1),
      objective: "Run the existing required verification step.",
      state,
      source: "workflow",
      branch,
      progress: "The actual runner is executing this step.",
    },
    at,
    DEFAULT_CONFIG,
  );
}

test("decisive run ignores skipped runs and cancelled runs that a newer run superseded", () => {
  const a = run("Verify", "main", null);
  const b = run("Verify", "main", "cancelled");
  const c = run("Verify", "main", "failure");
  const s = run("Verify", "main", "skipped");
  assert.equal(decisiveRun([a, b, c]), c);
  assert.equal(decisiveRun([s, b]), b, "A newest cancelled run without a successor still decides");
  assert.equal(decisiveRun([b]), b);
  assert.equal(decisiveRun([a, b]), null);
  assert.equal(decisiveRun([s]), null);
});

test("orphaned step telemetry of a completed run is interrupted, not active, and raises no warning", async () => {
  const DB = localAccountDb();
  try {
    await workflowTask(DB, "run:111:1:development:dev-account", "testing", instant - 15 * HOUR);
    const result = await snap(
      DB,
      github({ runs: [run("Verify preserved functionality", "main", "cancelled", { id: 111 })] }),
    );
    const status = result.developmentStatus;
    assert.equal(status.warning, null);
    assert.equal(status.label, "No development task active");
    assert.equal(status.task.state, "interrupted");
    assert.equal(status.task.storedState, "testing");
    assert.equal(status.task.active, false);
    assert.match(status.task.progress, /Run cancelled before this step reported a result/);
    assert.equal(status.task.endedBy.conclusion, "cancelled");
    // Stored history is untouched.
    const stored = JSON.parse(
      (
        await DB.prepare("SELECT body FROM owner_monitor_tasks WHERE id=?")
          .bind("run:111:1:development:dev-account")
          .first()
      ).body,
    );
    assert.equal(stored.state, "testing");
  } finally {
    DB.close();
  }
});

test("a newer genuinely running step is chosen over interrupted ones and keeps its warnings", async () => {
  const DB = localAccountDb();
  try {
    await workflowTask(DB, "run:111:1:development:dev-account", "testing", instant - 15 * HOUR);
    await workflowTask(DB, "run:222:1:development:dev-ships", "testing", instant - 20 * 60000);
    const result = await snap(
      DB,
      github({
        runs: [
          run("Verify preserved functionality", "main", null, { id: 222 }),
          run("Verify preserved functionality", "main", "cancelled", { id: 111 }),
        ],
      }),
    );
    assert.equal(result.developmentStatus.task.id, "run:222:1:development:dev-ships");
    assert.equal(result.developmentStatus.warning.kind, "missing-telemetry");
  } finally {
    DB.close();
  }
});

test("without GitHub data an orphaned step keeps its honest missing-telemetry warning", async () => {
  const DB = localAccountDb();
  try {
    await workflowTask(DB, "run:111:1:development:dev-account", "testing", instant - 15 * HOUR);
    const result = await snap(DB, unavailable);
    assert.equal(result.developmentStatus.task.state, "testing");
    assert.equal(result.developmentStatus.task.active, true);
    assert.equal(result.developmentStatus.warning.kind, "missing-telemetry");
    assert.match(result.developmentStatus.warning.message, /900 minutes ago/);
  } finally {
    DB.close();
  }
});

test("a stale step outside the scanned runs is superseded only after a newer step finished on its branch", async () => {
  const DB = localAccountDb();
  try {
    await workflowTask(DB, "run:111:1:development:dev-account", "testing", instant - 15 * HOUR);
    const development = github({
      runs: [run("Verify preserved functionality", "main", "success")],
    });
    let result = await snap(DB, development);
    assert.equal(result.developmentStatus.task.state, "testing", "No newer finished step yet");
    assert.equal(result.developmentStatus.warning.kind, "missing-telemetry");
    const done = await workflowTask(
      DB,
      "run:333:1:deploy:website-deploy",
      "deploying",
      instant - 2 * HOUR,
    );
    await updateTask(
      DB,
      {
        id: done.id,
        eventId: `${done.id}:1:success`,
        revision: 1,
        state: "completed",
        progress: "Runner result: success.",
      },
      instant - HOUR,
      DEFAULT_CONFIG,
    );
    result = await snap(DB, development, instant + 60000);
    assert.equal(result.developmentStatus.warning, null);
    assert.equal(result.developmentStatus.task.id, done.id, "The newer finished step is shown");
    // A stale step on another branch is not superseded by main's progress.
    await workflowTask(
      DB,
      "run:444:1:development:dev-loot",
      "testing",
      instant - 10 * HOUR,
      "feature/x",
    );
    result = await snap(DB, development, instant + 120000);
    assert.equal(result.developmentStatus.task.id, "run:444:1:development:dev-loot");
    assert.equal(result.developmentStatus.warning.kind, "missing-telemetry");
  } finally {
    DB.close();
  }
});

test("a re-run attempt supersedes the earlier attempt's step telemetry", async () => {
  const DB = localAccountDb();
  try {
    await workflowTask(DB, "run:111:1:development:dev-account", "testing", instant - HOUR);
    const result = await snap(
      DB,
      github({
        runs: [run("Verify preserved functionality", "main", null, { id: 111, attempt: 2 })],
      }),
    );
    assert.equal(result.developmentStatus.warning, null);
    assert.equal(result.developmentStatus.task.endedBy.reason, "rerun");
  } finally {
    DB.close();
  }
});

test("skipped failure reports and skipped-only workflows are not attention", async () => {
  const DB = localAccountDb();
  try {
    const result = await snap(
      DB,
      github({
        runs: [
          run("Report workflow failure", "main", "skipped"),
          run("Conditional audit", "main", "skipped"),
          run("Verify preserved functionality", "main", "success"),
          run("Neutral check", "main", "neutral"),
        ],
      }),
    );
    assert.equal(find(result, "Workflow: Report workflow failure (main)"), undefined);
    assert.equal(
      find(result, "Workflow: Conditional audit (main)"),
      undefined,
      "Skipped-only runs add no component",
    );
    assert.equal(find(result, "Workflow: Neutral check (main)").color, "green");
    assert.equal(find(result, "Workflow: available results"), undefined);
    assert.deepEqual(attention(result), []);
  } finally {
    DB.close();
  }
});

test("a previously stored failure-report component and placeholder are retired once, with history", async () => {
  const DB = localAccountDb();
  try {
    await snap(DB, unavailable);
    const seeded = await snap(DB, unavailable, instant + 1000);
    assert.equal(find(seeded, "Workflow: available results").color, "yellow");
    await DB.prepare("INSERT INTO owner_monitor_incidents VALUES(?,?)")
      .bind(
        "Workflow: Report workflow failure (main)",
        JSON.stringify({
          component: "Workflow: Report workflow failure (main)",
          state: "unavailable",
          color: "yellow",
          latestCheckAt: instant,
        }),
      )
      .run();
    let result = await snap(
      DB,
      github({ runs: [run("Verify preserved functionality", "main", "success")] }),
      instant + 2000,
    );
    assert.equal(find(result, "Workflow: available results").state, "retired");
    assert.equal(find(result, "Workflow: Report workflow failure (main)").state, "retired");
    assert.deepEqual(attention(result), []);
    result = await snap(
      DB,
      github({ runs: [run("Verify preserved functionality", "main", "success")] }),
      instant + 3000,
    );
    assert.equal(
      find(result, "Workflow: available results"),
      undefined,
      "Retired once, then quiet",
    );
    const logged = await DB.prepare(
      "SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='diagnostics' AND id LIKE 'diagnostic:Workflow: available results:%'",
    ).first();
    assert.equal(logged.n, 2, "The gap and its retirement are both in history");
  } finally {
    DB.close();
  }
});

test("GitHub returning no runs still shows the explicit placeholder gap", async () => {
  const DB = localAccountDb();
  try {
    const result = await snap(DB, github({ runs: [] }));
    assert.equal(find(result, "Workflow: available results").color, "yellow");
    assert.match(find(result, "Workflow: available results").symptom, /no workflow runs/);
  } finally {
    DB.close();
  }
});

test("a cancelled run superseded by a newer run is not attention; a lone cancelled latest run is", async () => {
  const DB = localAccountDb();
  try {
    let result = await snap(
      DB,
      github({
        runs: [
          run("Verify preserved functionality", "main", null),
          run("Verify preserved functionality", "main", "cancelled"),
          run("Verify preserved functionality", "main", "success"),
          run("Android native widget verification", "main", null),
          run("Android native widget verification", "main", "cancelled"),
          run("Encrypted offsite database backup", "main", "cancelled"),
        ],
      }),
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (main)").color, "green");
    assert.equal(
      find(result, "Workflow: Android native widget verification (main)"),
      undefined,
      "Nothing decisive yet: no component, exactly as for a first running run",
    );
    assert.equal(
      find(result, "Workflow: Encrypted offsite database backup (main)").color,
      "yellow",
    );
    assert.deepEqual(attention(result), ["Workflow: Encrypted offsite database backup (main)"]);
    // A newer run in progress does not hide an older failure.
    result = await snap(
      DB,
      github({
        runs: [
          run("Verify preserved functionality", "main", null),
          run("Verify preserved functionality", "main", "cancelled"),
          run("Verify preserved functionality", "main", "failure"),
        ],
      }),
      instant + 1000,
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (main)").color, "red");
  } finally {
    DB.close();
  }
});

test("finished branches are retired with a recorded reason; main and open pull request failures stay", async () => {
  const DB = localAccountDb();
  try {
    const open = [pr(150, "feature/open"), pr(151, "feature/merged")];
    let result = await snap(
      DB,
      github({
        runs: [
          run("Verify preserved functionality", "feature/merged", "failure"),
          run("Verify preserved functionality", "feature/open", "failure"),
          run("Verify preserved functionality", "main", "failure"),
          run("Verify preserved functionality", "feature/old", "success"),
        ],
        openPulls: open,
        closedPulls: [pr(149, "feature/old", { closedAt: instant - HOUR, mergedAt: null })],
      }),
    );
    assert.equal(
      find(result, "Workflow: Verify preserved functionality (feature/merged)").color,
      "red",
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (main)").color, "red");
    assert.equal(
      find(result, "Workflow: Verify preserved functionality (feature/old)").state,
      "retired",
      "A closed pull request's runs in the window are retired too",
    );
    // Later: #151 merged, every earlier run aged out of the scanned window.
    const later = {
      runs: [run("Deploy verified website", "main", "success")],
      openPulls: [pr(150, "feature/open")],
      closedPulls: [pr(151, "feature/merged", { closedAt: instant, mergedAt: instant })],
    };
    result = await snap(DB, github(later), instant + 1000);
    const merged = find(result, "Workflow: Verify preserved functionality (feature/merged)");
    assert.equal(merged.state, "retired");
    assert.equal(merged.color, "green");
    assert.match(merged.symptom, /#151 for feature\/merged was merged/);
    assert.match(merged.symptom, /Last result: Verify preserved functionality: failure/);
    assert.equal(
      find(result, "Workflow: Verify preserved functionality (feature/open)").color,
      "red",
      "An open pull request's failure stays visible after leaving the window",
    );
    const main = find(result, "Workflow: Verify preserved functionality (main)");
    assert.equal(main.color, "red", "A main failure is never retired");
    result = await snap(DB, github(later), instant + 2000);
    assert.equal(
      find(result, "Workflow: Verify preserved functionality (feature/merged)"),
      undefined,
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (main)").color, "red");
    const history = await DB.prepare(
      "SELECT summary FROM owner_monitor_logs WHERE source='diagnostics' AND summary LIKE 'Workflow: Verify preserved functionality (feature/merged)%' ORDER BY observed_at",
    ).all();
    assert.equal(history.results.length, 2, "The failure and its retirement are both retained");
    assert.match(history.results[1].summary, /merged/);
    // A later main success recovers main.
    result = await snap(
      DB,
      github({ ...later, runs: [run("Verify preserved functionality", "main", "success")] }),
      instant + 3000,
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (main)").color, "green");
  } finally {
    DB.close();
  }
});

test("readings without head branches never retire a branch", async () => {
  const DB = localAccountDb();
  try {
    // The pull request listing cached before head branches were recorded.
    const legacy = [{ number: 1, title: "x", draft: false, url: "https://github.com/x" }];
    let result = await snap(
      DB,
      github({
        runs: [run("Verify preserved functionality", "feature/a", "failure")],
        openPulls: legacy,
      }),
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (feature/a)").color, "red");
    result = await snap(
      DB,
      github({ runs: [run("Deploy verified website", "main", "success")], openPulls: legacy }),
      instant + 1000,
    );
    assert.equal(find(result, "Workflow: Verify preserved functionality (feature/a)").color, "red");
  } finally {
    DB.close();
  }
});

test("a pushed branch without a pull request is not monitored; opening one brings it back", async () => {
  const DB = localAccountDb();
  try {
    const failing = run("Product screenshots", "screenshots/x", "failure");
    let result = await snap(DB, github({ runs: [failing] }));
    const entry = find(result, "Workflow: Product screenshots (screenshots/x)");
    assert.equal(entry.state, "retired");
    assert.match(entry.symptom, /screenshots\/x has no open pull request;/);
    assert.match(entry.symptom, /Last result: Product screenshots: failure/);
    result = await snap(
      DB,
      github({ runs: [failing], openPulls: [pr(160, "screenshots/x")] }),
      instant + 1000,
    );
    assert.equal(find(result, "Workflow: Product screenshots (screenshots/x)").color, "red");
  } finally {
    DB.close();
  }
});

test("a main workflow older than the scanned runs keeps its last logged result", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, instant - 2 * 86400000);
    await DB.prepare("INSERT INTO owner_monitor_incidents VALUES(?,?)")
      .bind(
        "Workflow: Encrypted offsite database backup (main)",
        JSON.stringify({
          component: "Workflow: Encrypted offsite database backup (main)",
          state: "unavailable",
          color: "yellow",
          latestCheckAt: instant - 1000,
          firstOccurredAt: instant - HOUR,
        }),
      )
      .run();
    const logged = run("Encrypted offsite database backup", "main", "success", {
      startedAt: instant - 20 * HOUR,
      updatedAt: instant - 19 * HOUR,
    });
    await recordLog(
      DB,
      {
        id: `workflow:${logged.id}`,
        source: "recovery",
        observedAt: logged.updatedAt,
        summary: "Encrypted offsite database backup: success.",
        workflow: logged,
      },
      logged.updatedAt,
    );
    const result = await snap(
      DB,
      github({ runs: [run("Verify preserved functionality", "main", "success")] }),
    );
    const backup = find(result, "Workflow: Encrypted offsite database backup (main)");
    assert.equal(backup.color, "green");
    assert.match(backup.symptom, /older than the scanned GitHub runs/);
  } finally {
    DB.close();
  }
});

const LIVE = "Verify existing live website (read only)";
const LIVE_C = `Workflow: ${LIVE} (main)`;
const DEPLOY = "Deploy verified website";
const DEPLOY_C = `Workflow: ${DEPLOY} (main)`;
const manual = (conclusion, fields = {}) =>
  run(LIVE, "main", conclusion, {
    event: "workflow_dispatch",
    startedAt: instant - 60 * HOUR,
    updatedAt: instant - 59 * HOUR,
    ...fields,
  });

test("covered manual workflows only run by hand; the covering workflow runs the same live audits", () => {
  const files = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
  const byName = new Map(
    files.map((f) => {
      const text = readFileSync(`.github/workflows/${f}`, "utf8");
      return [/^name:\s*(.+)$/m.exec(text)[1].trim(), text];
    }),
  );
  for (const [manualName, cover] of MANUAL_COVERED_BY) {
    const text = byName.get(manualName);
    assert.ok(text, `${manualName} exists`);
    const on = /^on:\n((?:[ \t].*\n)+)/m.exec(text)[1];
    const triggers = on.split("\n").filter((l) => /^ {2}[a-z_]+:/.test(l));
    assert.deepEqual(
      triggers.map((l) => l.trim().replace(":", "")),
      ["workflow_dispatch"],
      `${manualName} must stay manual-only for its cancelled run to be superseded`,
    );
    const covering = byName.get(cover);
    assert.ok(covering, `${cover} exists`);
    for (const audit of ["live-release-audit.mjs", "website-browser-audit.mjs"]) {
      assert.match(text, new RegExp(audit.replace(".", "\\.")));
      assert.match(covering, new RegExp(audit.replace(".", "\\.")), `${cover} runs ${audit}`);
    }
  }
});

test("a cancelled manual live audit superseded by a newer successful deploy is not attention", async () => {
  const DB = localAccountDb();
  try {
    const result = await snap(
      DB,
      github({
        runs: [run(DEPLOY, "main", "success", { event: "workflow_run" }), manual("cancelled")],
      }),
    );
    const live = find(result, LIVE_C);
    assert.equal(live.state, "not-applicable");
    assert.equal(live.color, "green");
    assert.equal(live.lastSuccessAt, null, "Superseded is never recorded as a success");
    assert.match(
      live.symptom,
      /cancelled \(manual run.*superseded by Deploy verified website: success/,
    );
    assert.equal(live.evidence.length, 2);
    assert.deepEqual(attention(result), []);
  } finally {
    DB.close();
  }
});

test("a remembered cancelled manual run older than the scan resolves and is listed as recently resolved", async () => {
  const DB = localAccountDb();
  try {
    // 2026-10-23: the cancelled manual run is the newest decisive run; no deploy since.
    const cancelled = manual("cancelled", { event: undefined });
    delete cancelled.event; // stored incidents from before this change carry no trigger
    const deploy = run(DEPLOY, "main", "success", { updatedAt: instant - 70 * HOUR });
    let result = await snap(DB, github({ runs: [cancelled, deploy] }), instant - 50 * HOUR);
    assert.equal(
      find(result, LIVE_C).color,
      "yellow",
      "An older deploy does not cover a newer cancel",
    );
    assert.deepEqual(attention(result), [LIVE_C]);
    // Later: the manual run aged out of the scanned runs; only the deploy's remembered result
    // (its component is healthy) shows a newer successful live audit.
    const newDeploy = run(DEPLOY, "main", "success", {
      startedAt: instant - 2 * HOUR,
      updatedAt: instant - HOUR,
    });
    result = await snap(DB, github({ runs: [newDeploy] }), instant - 30 * 60000);
    assert.equal(find(result, DEPLOY_C).state, "healthy");
    result = await snap(
      DB,
      github({ runs: [run("Verify preserved functionality", "main", "success")] }),
      instant,
    );
    const live = find(result, LIVE_C);
    assert.equal(live.state, "not-applicable");
    assert.equal(live.color, "green");
    assert.deepEqual(attention(result), []);
    const resolved = await recentlyResolved(DB, instant, result.diagnostics);
    const item = resolved.items.find((i) => i.component === LIVE_C);
    assert.ok(item, "The warning is listed as recently resolved");
    assert.equal(item.resolvedAt, live.recoveredAt);
    assert.ok(item.resolvedAt > item.startedAt);
  } finally {
    DB.close();
  }
});

test("real problems stay visible: failed or cancelled deploys, failed or non-manual live audits", async () => {
  const DB = localAccountDb();
  try {
    let result = await snap(
      DB,
      github({
        runs: [
          run(DEPLOY, "main", "failure"),
          // A failed manual audit is never superseded, even by a later deploy.
          manual("failure", { updatedAt: instant - 2 * HOUR }),
        ],
      }),
    );
    assert.equal(find(result, DEPLOY_C).color, "red", "A failed deploy still warns");
    assert.equal(find(result, LIVE_C).color, "red", "A failed manual audit still warns");
  } finally {
    DB.close();
  }
  const DB3 = localAccountDb();
  try {
    let result = await snap(
      DB3,
      github({
        runs: [
          run(DEPLOY, "main", "cancelled"),
          run(DEPLOY, "main", "success", { updatedAt: instant - 3 * HOUR }),
          manual("cancelled", { updatedAt: instant - 4 * HOUR }),
        ],
      }),
    );
    assert.equal(
      find(result, DEPLOY_C).color,
      "yellow",
      "A lone cancelled deploy still needs attention",
    );
    assert.equal(
      find(result, LIVE_C).color,
      "green",
      "The older successful deploy covers the cancel",
    );
    // The same workflow name run by another trigger is not a manual audit.
    const DB2 = localAccountDb();
    try {
      result = await snap(
        DB2,
        github({
          runs: [run(DEPLOY, "main", "success"), manual("cancelled", { event: "push" })],
        }),
      );
      assert.equal(find(result, LIVE_C).color, "yellow");
    } finally {
      DB2.close();
    }
  } finally {
    DB3.close();
  }
});

test("a cancelled scheduled run keeps the existing rules despite a newer successful deploy", async () => {
  const DB = localAccountDb();
  try {
    const result = await snap(
      DB,
      github({
        runs: [
          run(DEPLOY, "main", "success"),
          run("Encrypted offsite database backup", "main", "cancelled", {
            event: "schedule",
            updatedAt: instant - 5 * HOUR,
          }),
        ],
      }),
    );
    assert.equal(
      find(result, "Workflow: Encrypted offsite database backup (main)").color,
      "yellow",
    );
    assert.deepEqual(attention(result), ["Workflow: Encrypted offsite database backup (main)"]);
  } finally {
    DB.close();
  }
});

test("without GitHub data or deploy evidence a cancelled manual run stays a gap, never green", async () => {
  const DB = localAccountDb();
  try {
    let result = await snap(DB, github({ runs: [manual("cancelled")] }));
    assert.equal(find(result, LIVE_C).color, "yellow", "No deploy evidence: still unverified");
    result = await snap(DB, unavailable, instant + 1000);
    const live = find(result, LIVE_C);
    assert.equal(live.state, "unavailable");
    assert.equal(live.color, "yellow");
    assert.match(live.symptom, /No completed build or test result was returned/);
  } finally {
    DB.close();
  }
});
