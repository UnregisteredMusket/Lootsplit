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
  assert.equal(calls, 2);
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
