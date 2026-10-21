import test from "node:test";
import assert from "node:assert/strict";
import {
  activityEvents,
  developmentActivity,
  ACTIVITY_EVENT_LIMIT,
  ACTIVE_CACHE_MS,
} from "../cloudflare/owner-monitor.mjs";

const T = Date.parse("2026-10-21T12:00:00Z");
const iso = (minutesAgo) => new Date(T - minutesAgo * 60000).toISOString();
const run = (id, fields) => ({
  id,
  name: "Verify",
  status: "completed",
  conclusion: "success",
  head_branch: "feature/widget-redesign",
  head_sha: "b".repeat(40),
  event: "pull_request",
  path: ".github/workflows/verify.yml",
  run_started_at: iso(30),
  updated_at: iso(20),
  ...fields,
});
const pull = (number, fields) => ({
  number,
  title: `Change ${number}`,
  draft: false,
  head: { ref: `feature/change-${number}` },
  created_at: iso(600),
  closed_at: null,
  merged_at: null,
  ...fields,
});
function github({ runs = [], open = [], closed = [] } = {}, log = []) {
  return async (url, options) => {
    log.push(url);
    assert.ok(options.signal);
    if (url.includes("/actions/runs?")) return Response.json({ workflow_runs: runs });
    if (url.includes("state=closed")) {
      assert.match(url, /sort=updated&direction=desc&per_page=20$/);
      return Response.json(closed);
    }
    return Response.json(open);
  };
}
const env = () => ({ DB: {}, OWNER_MONITOR_GITHUB: "true" });

test("activity events are newest-first, link runs to pull requests and distinguish merged from closed", async () => {
  const result = await developmentActivity(
    env(),
    github({
      runs: [
        run(1, {
          status: "in_progress",
          conclusion: null,
          run_started_at: iso(4),
          updated_at: iso(1),
        }),
        run(2, { conclusion: "failure", head_branch: "feature/change-140", updated_at: iso(1.5) }),
        run(3, {
          conclusion: "success",
          head_branch: "main",
          event: "push",
          name: "Deploy verified website",
          updated_at: iso(10),
        }),
        run(4, { conclusion: "cancelled", head_branch: "unlinked/branch", updated_at: iso(50) }),
        run(5, { conclusion: "skipped", updated_at: iso(0.5) }),
        run(6, {
          event: "schedule",
          name: "Performance",
          status: "in_progress",
          conclusion: null,
          run_started_at: iso(0.2),
        }),
      ],
      open: [
        pull(140, {
          title: "Agent activity",
          head: { ref: "feature/change-140" },
          created_at: iso(90),
        }),
      ],
      closed: [
        pull(138, {
          title: "Widget redesign",
          head: { ref: "feature/widget-redesign" },
          closed_at: iso(2),
          merged_at: iso(2),
        }),
        pull(137, { title: "Abandoned idea", closed_at: iso(70) }),
      ],
    }),
  );
  assert.equal(result.state, "ready");
  const events = result.data.events;
  assert.deepEqual(
    events.map((e) => [e.kind, e.state, e.text, e.pr]),
    [
      ["run-failed", "fail", "Verify failed on #140", 140],
      ["pr-merged", "ok", "Merged #138", 138],
      ["run-started", "active", "Verify running on #138", 138],
      ["run-succeeded", "ok", "Deploy verified website passed on main", null],
      ["run-cancelled", "attention", "Verify cancelled on unlinked/branch", null],
      ["pr-closed", "attention", "Closed #137 without merging", 137],
      ["pr-opened", "ok", "Opened #140", 140],
      ["pr-opened", "ok", "Opened #137", 137],
      ["pr-opened", "ok", "Opened #138", 138],
    ],
  );
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].at >= events[i].at);
  assert.equal(events[1].title, "Widget redesign");
  assert.equal(events[1].url, "https://github.com/UnregisteredMusket/Lootsplit/pull/138");
  assert.equal(events[0].url, "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/2");
  assert.equal(events[2].at, T - 4 * 60000, "A running workflow is dated by its start");
  assert.ok(
    !events.some((e) => /Performance|skipped/.test(e.text)),
    "Scheduled and skipped runs are not development actions",
  );
  assert.equal(
    result.data.activeActivity,
    1,
    "Scheduled housekeeping does not drive the fast refresh",
  );
  assert.equal(result.data.active.length, 2, "The existing active list is unchanged");
  assert.deepEqual(Object.keys(result.data.openPulls[0]), ["number", "title", "draft", "url"]);
  assert.equal(result.data.scannedClosedPulls, 2);
});

test("activity events are bounded but keep running workflows, and reject invalid provider fields", () => {
  const runs = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: "Verify",
    status: "completed",
    conclusion: "success",
    branch: "main",
    event: "push",
    url: `https://github.com/UnregisteredMusket/Lootsplit/actions/runs/${i + 1}`,
    startedAt: T - 60000 * (i + 2),
    updatedAt: T - 60000 * (i + 1),
  }));
  runs.push({
    ...runs[0],
    id: 999,
    status: "in_progress",
    conclusion: null,
    startedAt: T - 86400000,
  });
  const events = activityEvents(runs, [], []);
  assert.equal(events.length, ACTIVITY_EVENT_LIMIT);
  assert.ok(
    events.some((e) => e.state === "active"),
    "An old running workflow stays visible",
  );
  assert.equal(events.at(-1).state, "active", "Still ordered newest-first");
  assert.equal(activityEvents(runs, [], [], 3).length, 3);
  assert.equal(activityEvents(runs, [], [], 500).length, ACTIVITY_EVENT_LIMIT);
  assert.deepEqual(activityEvents([], [], []), []);
});

test("invalid pull request data and failed closed-PR reads make activity explicitly unavailable", async () => {
  for (const closed of [
    [pull(1.5)],
    [pull(-1)],
    [pull(3, { merged_at: 12345 })],
    { message: "not a list" },
  ]) {
    const result = await developmentActivity(env(), github({ closed }));
    assert.equal(result.state, "unavailable");
    assert.equal(result.data, null);
    assert.equal(result.errorCode, "SOURCE_UNAVAILABLE");
  }
  const limited = await developmentActivity(env(), async (url) =>
    url.includes("state=closed")
      ? new Response("PRIVATE", { status: 403, headers: { "x-ratelimit-remaining": "0" } })
      : Response.json(url.includes("/actions/") ? { workflow_runs: [] } : []),
  );
  assert.equal(limited.state, "unavailable");
  assert.equal(limited.errorCode, "HTTP_403_RATE_LIMITED");
  assert.doesNotMatch(JSON.stringify(limited), /PRIVATE/);
  // Unsafe branch names and titles never become links or markup.
  const result = await developmentActivity(
    env(),
    github({
      runs: [run(7, { head_branch: 'x" onload=alert(1)' })],
      closed: [
        pull(9, {
          title: "<b>x</b>",
          head: { ref: 'x" onload=alert(1)' },
          merged_at: iso(1),
          closed_at: iso(1),
        }),
      ],
    }),
  );
  assert.equal(result.state, "ready");
  const linked = result.data.events.find((e) => e.kind === "run-succeeded");
  assert.equal(linked.pr, null, "Invalid head refs are never used to link a run");
  for (const e of result.data.events)
    assert.match(e.url, /^https:\/\/github\.com\/UnregisteredMusket\/Lootsplit\//);
});

test("provider cache shortens while a development workflow runs and stays five minutes otherwise", async (t) => {
  let now = T;
  t.mock.method(Date, "now", () => now);
  const calls = [];
  const activeEnv = env();
  const active = github({ runs: [run(1, { status: "in_progress", conclusion: null })] }, calls);
  await developmentActivity(activeEnv, active);
  assert.equal(calls.length, 3);
  now += ACTIVE_CACHE_MS - 1000;
  await developmentActivity(activeEnv, active);
  assert.equal(calls.length, 3, "Cached inside the short window");
  now += 2000;
  await developmentActivity(activeEnv, active);
  assert.equal(calls.length, 6, "Refreshed after about a minute while active");

  calls.length = 0;
  const idleEnv = env();
  const idle = github({ runs: [run(1, {})] }, calls);
  await developmentActivity(idleEnv, idle);
  now += 120000;
  await developmentActivity(idleEnv, idle);
  assert.equal(calls.length, 3, "Idle activity keeps the five-minute cache");
  now += 200000;
  await developmentActivity(idleEnv, idle);
  assert.equal(calls.length, 6);

  calls.length = 0;
  const failingEnv = env();
  const failing = async (url) => {
    calls.push(url);
    return new Response("", { status: 500 });
  };
  await developmentActivity(failingEnv, failing);
  now += 120000;
  assert.equal((await developmentActivity(failingEnv, failing)).state, "unavailable");
  assert.equal(calls.length, 3, "Failures keep the five-minute backoff");
});
