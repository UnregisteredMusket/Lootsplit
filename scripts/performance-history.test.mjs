import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectRun,
  findRegressions,
  recordRegressions,
  summarizeTrends,
  applyResolution,
  jsonLines,
  parseLines,
} from "./performance-history.mjs";
import { syncHistory, paginate } from "./performance-sync.mjs";
import { localMeasurement, shouldRecordLocal } from "./performance-record.mjs";
import { prepareResolution } from "./performance-resolve.mjs";

const sha = "a".repeat(40);
const url = "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1";
const row = (id, durationMs, offset, extra = {}) => ({
  id,
  scope: "same",
  name: "audit",
  kind: "audit",
  environment: "node22-linux-warm",
  commit: sha,
  url,
  outcome: "success",
  durationMs,
  startedAt: new Date(Date.UTC(2026, 9, 4, 19, offset)).toISOString(),
  finishedAt: new Date(Date.UTC(2026, 9, 4, 19, offset) + durationMs).toISOString(),
  ...extra,
});

test("inclusive 15% threshold preserves raw durations and excludes just below it", () => {
  assert.equal(findRegressions([row("a", 100000, 0), row("b", 114999, 10)]).length, 0);
  const [r] = findRegressions([row("a", 100000, 0), row("b", 115000, 10)]);
  assert.equal(r.increasePercent, 15);
  assert.equal(r.addedMs, 15000);
  assert.equal(r.baseline.durationMs, 100000);
  assert.equal(findRegressions([row("a", 100000, 0), row("b", 120000, 10)]).length, 1);
});

test("sub-threshold runs never move the last logged reference; repeated thresholds reveal the trend", () => {
  const measurements = [
    row("base", 100000, 0),
    row("ignore1", 114000, 10),
    row("first", 115000, 20),
    row("ignore2", 132249, 30),
    row("second", 132250, 40),
  ];
  const result = findRegressions(measurements.reverse());
  assert.deepEqual(
    result.map((r) => r.baseline.id),
    ["base", "first"],
  );
  assert.equal(summarizeTrends(result)[0].increasePercent, 32.25);
  assert.equal(summarizeTrends(result)[0].addedMs, 32250);
  const reference = recordRegressions({}, [row("base", 100000, 0)]).baselines;
  assert.equal(shouldRecordLocal(reference, [], row("ignore", 114999, 20)), false);
  assert.equal(shouldRecordLocal(reference, [], row("qualifies", 115000, 20)), true);
  assert.equal(recordRegressions(reference, [row("faster", 50000, 20)]).baselines.same.id, "base");
  assert.equal(
    findRegressions([row("base", 100000, 0), row("fail", 115000, 10, { outcome: "failure" })])[0]
      .outcome,
    "failure",
  );
  assert.equal(
    findRegressions([row("a", 100000, 0), row("b", 200000, 10, { scope: "different-environment" })])
      .length,
    0,
  );
  assert.equal(findRegressions([row("b", 200000, 0)]).length, 0);
});

test("confirmed resolution archives the old trend and restarts from verified duration", () => {
  const previous = recordRegressions({}, [
    row("base", 100000, 0),
    row("slow", 115000, 10),
    row("slower", 132250, 20),
  ]);
  const request = {
    id: "resolution:verified",
    scope: "same",
    expectedBaselineId: "slower",
    reason: "Fixed repeated fixture initialization; verified the same workload",
    confirmedAt: "2026-10-04T20:00:00Z",
    verified: row("fixed", 80000, 30),
  };
  const resolution = applyResolution(previous.baselines, request);
  assert.equal(resolution.status, "resolved");
  assert.equal(summarizeTrends(previous.regressions, [resolution])[0].status, "resolved");
  assert.equal(previous.regressions.length, 2);
  const next = recordRegressions(previous.baselines, [
    row("below", 91999, 40),
    row("new-slow", 92000, 50),
  ]);
  assert.equal(next.regressions.length, 1);
  assert.equal(next.regressions[0].baseline.durationMs, 80000);
  assert.equal(next.regressions[0].trendId, "resolution:verified");
  assert.equal(applyResolution(next.baselines, request).status, "stale_reference");
  assert.equal(next.baselines.same.id, "new-slow");
  assert.throws(
    () =>
      applyResolution(next.baselines, {
        ...request,
        expectedBaselineId: "new-slow",
        verified: row("failed-fix", 50000, 59, { outcome: "failure" }),
      }),
    /successful/,
  );
  assert.equal(
    recordRegressions(previous.baselines, [row("late-prefixed", 200000, 5)]).regressions.length,
    0,
  );
});

const run = {
  id: 1,
  run_attempt: 1,
  name: "Verification",
  path: ".github/workflows/verify.yml",
  event: "push",
  head_branch: "main",
  head_sha: sha,
  head_repository: { full_name: "UnregisteredMusket/Lootsplit" },
  html_url: url,
  status: "completed",
  conclusion: "success",
  created_at: "2026-10-04T19:00:00Z",
};
const jobs = [
  {
    name: "audit",
    labels: ["ubuntu-latest"],
    html_url: url,
    started_at: "2026-10-04T19:00:02Z",
    completed_at: "2026-10-04T19:00:12Z",
    conclusion: "success",
    steps: [
      {
        name: "same action",
        started_at: "2026-10-04T19:00:02Z",
        completed_at: "2026-10-04T19:00:07Z",
        conclusion: "success",
      },
      {
        name: "same action",
        started_at: "2026-10-04T19:00:07Z",
        completed_at: "2026-10-04T19:00:12Z",
        conclusion: "success",
      },
      { name: "skip", conclusion: "skipped" },
    ],
  },
];

test("workflow wall time does not sum parallel jobs; queue and repeated actions stay separate", () => {
  const rows = collectRun(run, [...jobs, { ...jobs[0], name: "parallel", steps: [] }]);
  assert.equal(rows.find((r) => r.kind === "workflow").durationMs, 10000);
  assert.equal(rows.find((r) => r.kind === "queue").durationMs, 2000);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(rows.filter((r) => r.kind === "step").length, 2);
  const retry = collectRun({ ...run, run_attempt: 2 }, jobs);
  assert.notEqual(retry[0].scope, rows[0].scope);
});

test("CI resolution reads the actual matching successful operation and refuses failed runs", async () => {
  const current = collectRun(run, jobs).find((r) => r.kind === "job");
  const previous = {
    ...current,
    id: "slow-job",
    durationMs: 20000,
    finishedAt: "2026-10-04T18:00:00Z",
    trendId: "old-trend",
  };
  const baselines = { [previous.scope]: previous };
  const api = async (path) => (path.includes("/jobs?") ? { jobs } : run);
  const request = await prepareResolution(
    { baselineId: "slow-job", reason: "Removed duplicate setup; same job verified", runId: 1 },
    baselines,
    api,
  );
  assert.equal(request.verified.durationMs, 10000);
  assert.equal(request.verified.commit, sha);
  assert.equal(applyResolution(baselines, request).closedTrendId, "old-trend");
  await assert.rejects(
    () =>
      prepareResolution(
        { baselineId: current.id, reason: "claim", runId: 1 },
        baselines,
        async () => ({ ...run, conclusion: "failure" }),
      ),
    /successful/,
  );
});

test("local measurements require real environment, evidence, commit and positive timing", () => {
  const input = { ...row("ignored", 1000, 0), scopeVersion: "v1" };
  const local = localMeasurement(input);
  assert.match(local.id, /^local:/);
  assert.match(local.scope, /node22-linux-warm/);
  for (const patch of [
    { durationMs: 0 },
    { commit: "estimate" },
    { url: "https://example.com" },
    { startedAt: "unknown" },
    { environment: "" },
  ])
    assert.throws(() => localMeasurement({ ...input, ...patch }));
});

test("catch-up paginates, includes old pending runs, persists data only, and is idempotent", async () => {
  const output = mkdtempSync(join(tmpdir(), "lootsplit-performance-test-"));
  const writes = [];
  const files = {};
  let ref = null;
  const api = async (path, options = {}) => {
    if (options.method) {
      writes.push({ path, ...options });
      if (path === "/git/trees") {
        for (const item of options.body.tree) files[item.path] = item.content;
        return { sha: "tree" };
      }
      if (path === "/git/commits") return { sha: "history" };
      if (path === "/git/refs") {
        ref = { object: { sha: "history" } };
        return {};
      }
      if (path === "/git/refs/heads/performance-history") return {};
      throw Error(`Unexpected write ${path}`);
    }
    if (path === "/git/ref/heads/performance-history") return ref;
    if (path === "/git/ref/heads/main") return { object: { sha } };
    if (path === "/git/commits/history") return { tree: { sha: "tree" } };
    if (path === "/git/trees/tree")
      return { tree: Object.keys(files).map((path) => ({ path, sha: path })) };
    if (path.startsWith("/git/blobs/"))
      return { content: Buffer.from(files[path.slice(11)]).toString("base64") };
    if (path.startsWith("/actions/runs?")) return { total_count: 1, workflow_runs: [run] };
    if (path === "/actions/runs/99") return { ...run, id: 99 };
    if (/^\/actions\/runs\/\d+\/attempts\/1\/jobs\?/.test(path)) return { jobs };
    throw Error(`Unexpected read ${path}`);
  };
  try {
    const first = await syncHistory({ api, publish: true, output, now: "2026-10-04T20:00:00Z" });
    assert.equal(first.compared, 5);
    assert.equal(first.addedRegressions, 0);
    assert.ok(
      writes.find((w) => w.path === "/git/refs" && w.body.ref === "refs/heads/performance-history"),
    );
    assert.ok(!writes.some((w) => /refs\/heads\/main/.test(w.path)));
    const writeCount = writes.length;
    const again = await syncHistory({ api, publish: true, output, now: "2026-10-04T21:00:00Z" });
    assert.equal(again.compared, 0);
    assert.equal(writes.length, writeCount);
    files["state.json"] = JSON.stringify({ ...JSON.parse(files["state.json"]), pending: [99] });
    const caught = await syncHistory({ api, publish: true, output });
    assert.equal(caught.compared, 5);
    assert.equal(
      Object.keys(JSON.parse(readFileSync(join(output, "baselines.json"), "utf8"))).length,
      5,
    );
    assert.equal(readFileSync(join(output, "regressions.jsonl"), "utf8"), "");
    assert.equal(writes.at(-1).body.force, false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
  let pages = 0;
  const listed = await paginate(
    async () => ({ jobs: ++pages === 1 ? Array(100).fill({}) : [{}] }),
    "/jobs",
    "jobs",
  );
  assert.equal(listed.length, 101);
  await assert.rejects(
    () =>
      paginate(async () => ({ total_count: 1000, workflow_runs: [] }), "/runs", "workflow_runs"),
    /search limit/,
  );
});

test("logger uses trusted main and never bypasses application release gates", () => {
  const workflow = readFileSync(".github/workflows/performance-log.yml", "utf8");
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /npm ci|download-artifact|workflow_run\.head_sha/);
  assert.match(
    readFileSync("README.md", "utf8"),
    /Every full audit must fetch and analyze this log/,
  );
  assert.deepEqual(parseLines(jsonLines([row("a", 1000, 0)])), [row("a", 1000, 0)]);
});
