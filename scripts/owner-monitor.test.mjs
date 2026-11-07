import test from "node:test";
import assert from "node:assert/strict";
import { developmentActivity, cloudflareTraffic } from "../cloudflare/owner-monitor.mjs";

test("owner development source is opt-in, bounded, cached and returns only safe repository links", async () => {
  let calls = 0;
  const env = { DB: {}, OWNER_MONITOR_GITHUB: "true" };
  const fetcher = async (url, options) => {
    calls++;
    assert.ok(options.signal);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json(
      url.includes("/pulls?")
        ? [
            {
              number: 12,
              title: "A change",
              draft: true,
              html_url: "javascript:bad",
              secret: "PRIVATE",
            },
          ]
        : {
            workflow_runs: [
              {
                id: 123,
                name: "Deploy verified website",
                status: "in_progress",
                head_branch: "main",
                head_sha: "a".repeat(40),
                path: ".github/workflows/website-release.yml",
                html_url: "javascript:bad",
              },
            ],
          },
    );
  };
  assert.equal((await developmentActivity({ DB: {} }, fetcher)).state, "not-connected");
  assert.equal(calls, 0);
  const [first, second] = await Promise.all([
    developmentActivity(env, fetcher),
    developmentActivity(env, fetcher),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls, 3); // Runs, open pull requests and recently closed pull requests.
  assert.equal(first.data.active[0].deployment, true);
  assert.equal(first.data.latestDeployment.status, "in_progress");
  assert.equal(
    first.data.openPulls[0].url,
    "https://github.com/UnregisteredMusket/Lootsplit/pull/12",
  );
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|javascript/);
  const broken = await developmentActivity({ DB: {}, OWNER_MONITOR_GITHUB: "true" }, async () =>
    Response.json({ message: "PRIVATE credential" }, { status: 403 }),
  );
  assert.equal(broken.state, "unavailable");
  assert.equal(broken.data, null);
  assert.doesNotMatch(JSON.stringify(broken), /PRIVATE|credential/);
});

test("Cloudflare traffic distinguishes disconnected, failure, real zero and valid aggregates", async () => {
  const env = () => ({
    DB: {},
    OWNER_MONITOR_CLOUDFLARE_TOKEN: "SECRET",
    OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  });
  assert.equal(
    (
      await cloudflareTraffic({ DB: {} }, () => {
        throw Error("Should not fetch");
      })
    ).state,
    "not-connected",
  );
  for (const [rows, expected] of [
    [[], { requests: 0, errors: 0 }],
    [[{ sum: { requests: 120, errors: 3 } }], { requests: 120, errors: 3 }],
  ]) {
    const result = await cloudflareTraffic(env(), async (url, options) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/graphql");
      assert.equal(options.headers.Authorization, "Bearer SECRET");
      const query = JSON.parse(options.body);
      assert.match(query.query, /scriptName: "lootsplit"/);
      assert.doesNotMatch(query.query, /dimensions/); // Aggregate the whole window, not one truncated group.
      return Response.json({
        data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } },
      });
    });
    assert.equal(result.state, "ready");
    assert.equal(result.data.requests, expected.requests);
    assert.equal(result.data.errors, expected.errors);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
  for (const body of [
    { errors: [{ message: "SECRET" }] },
    { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { errors: 0 } }] }] } } },
  ]) {
    const result = await cloudflareTraffic(env(), async () => Response.json(body));
    assert.equal(result.state, "unavailable");
    assert.equal(result.data, null);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test("GitHub diagnostics distinguish request limits from unexplained rejection and keep optional credentials private", async () => {
  for (const [status, headers, expected] of [
    [403, {}, "HTTP_403"],
    [401, {}, "HTTP_401"],
    [403, { "x-ratelimit-remaining": "0" }, "HTTP_403_RATE_LIMITED"],
    [403, { "retry-after": "60" }, "HTTP_403_RATE_LIMITED"],
    [429, {}, "HTTP_429_RATE_LIMITED"],
  ]) {
    const result = await developmentActivity(
      { DB: {}, OWNER_MONITOR_GITHUB: "true", OWNER_MONITOR_GITHUB_TOKEN: "PRIVATE_TOKEN" },
      async (url, options) => {
        assert.match(url, /^https:\/\/api.github.com\/repos\/UnregisteredMusket\/Lootsplit\//);
        assert.equal(options.headers.Authorization, "Bearer PRIVATE_TOKEN");
        return new Response("PRIVATE_PROVIDER_BODY", { status, headers });
      },
    );
    assert.equal(result.state, "unavailable");
    assert.equal(result.errorCode, expected);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("adjacent traffic windows use inclusive start and exclusive end without boundary double-counting", async () => {
  const { cloudflareTraffic } = await import("../cloudflare/owner-monitor.mjs");
  const end = Date.now(),
    start = end - 1800000;
  const value = await cloudflareTraffic(
    {
      DB: {},
      OWNER_MONITOR_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      OWNER_MONITOR_CLOUDFLARE_TOKEN: "synthetic",
    },
    async (_url, options) => {
      const query = JSON.parse(options.body);
      assert.match(query.query, /datetime_geq: \$since, datetime_lt: \$until/);
      assert.equal(Date.parse(query.variables.until) - Date.parse(query.variables.since), 1800000);
      return Response.json({
        data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } },
      });
    },
    { start, end },
  );
  assert.equal(value.state, "ready");
  assert.equal(value.data.requests, 0);
});

test("a superseded website release is not reported as a deployment anywhere in the activity", async () => {
  const { mainRuns } = await import("../cloudflare/owner-monitor.mjs");
  const { CURRENT_MAIN_STEP, LIVE_RELEASE_STEP } =
    await import("../src/lib/deployment/release-run.mjs");
  const release = (id, sha, minutesAgo) => ({
    id,
    name: "Deploy verified website",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    head_branch: "main",
    head_sha: sha.repeat(40),
    event: "workflow_run",
    path: ".github/workflows/website-release.yml",
    run_started_at: new Date(Date.now() - (minutesAgo + 5) * 60000).toISOString(),
    updated_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  });
  const jobs = (deployed) => ({
    jobs: [
      {
        name: "deploy",
        conclusion: "success",
        steps: [
          { name: CURRENT_MAIN_STEP, conclusion: "success" },
          { name: LIVE_RELEASE_STEP, conclusion: deployed ? "success" : "skipped" },
        ],
      },
    ],
  });
  const asked = [];
  // Newest first: 9002 (commit b) superseded, 9001 (commit a) deployed.
  const fetcher = async (url) => {
    const lookup = /\/actions\/runs\/(\d+)\/attempts\/1\/jobs/.exec(url);
    if (lookup) {
      asked.push(Number(lookup[1]));
      return Response.json(jobs(lookup[1] === "9001"));
    }
    if (url.includes("/actions/runs?"))
      return Response.json({ workflow_runs: [release(9002, "b", 1), release(9001, "a", 10)] });
    return Response.json([]);
  };
  const result = await developmentActivity(
    { DB: { superseded: true }, OWNER_MONITOR_GITHUB: "true" },
    fetcher,
  );
  assert.equal(result.state, "ready");
  assert.deepEqual(asked.sort(), [9001, 9002]);
  const [superseded, deployed] = result.data.runs;
  assert.equal(superseded.superseded, true);
  assert.equal(superseded.deployed, false);
  assert.equal(superseded.deployment, false);
  assert.equal(deployed.deployed, true);
  assert.equal(result.data.latestDeployment.commit, "a".repeat(40));
  const tiles = mainRuns(result.data.runs);
  assert.deepEqual(
    tiles.map((r) => [r.conclusion, r.deployment, r.superseded === true]),
    [
      ["skipped", false, true],
      ["success", true, false],
    ],
  );
  assert.deepEqual(
    result.data.events.map((e) => [e.kind, e.text]),
    [
      [
        "run-superseded",
        "Deploy verified website superseded by a newer commit, not deployed, on main",
      ],
      ["run-succeeded", "Deploy verified website passed on main"],
    ],
  );
  // Remembered per run attempt: a later collection reads no jobs again.
  asked.length = 0;
  const again = await developmentActivity(
    { DB: { again: true }, OWNER_MONITOR_GITHUB: "true" },
    fetcher,
  );
  assert.equal(again.data.runs[0].superseded, true);
  assert.deepEqual(asked, []);
  // Jobs that do not describe a release are an explicit gap, never a guessed deployment.
  const unknown = await developmentActivity(
    { DB: { unknown: true }, OWNER_MONITOR_GITHUB: "true" },
    async (url) =>
      url.includes("/jobs")
        ? Response.json({ jobs: [] })
        : url.includes("/actions/runs?")
          ? Response.json({ workflow_runs: [release(9003, "c", 1)] })
          : Response.json([]),
  );
  assert.equal(unknown.state, "unavailable");
});
