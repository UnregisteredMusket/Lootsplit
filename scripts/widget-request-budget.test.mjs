// The Field monitor's request path (GET /api/account/owner/monitor?view=widget) must answer inside
// the installed widgets' 3 s read timeout. Diagnosis 2026-10-25: a widget request more than 60 s
// after the last stored snapshot ran a full live collection (GitHub alone took 1.7–4.6 s), so most
// taps and background checks timed out, and a timed-out "Connect owner account" cleared the
// widget's connection.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  withinBudget,
  REQUEST_PROVIDER_BUDGET_MS,
  REUSE_MAX_AGE_MS,
} from "../cloudflare/owner-monitor.mjs";
import { monitorSnapshot } from "../cloudflare/monitor-journal.mjs";

const instant = Date.parse("2026-10-25T11:11:39Z");
const HOUR = 3600000;
const ready = (data, checkedAt = instant) => ({ state: "ready", checkedAt, data });
const slow = (value, ms) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test("the request budget stays well inside the installed widgets' 3 s read timeout", () => {
  // 2026-10-30: at 1.2 s a widget refresh took 4.1 s on the server, past the phone's 4 s limit.
  assert.ok(REQUEST_PROVIDER_BUDGET_MS > 0 && REQUEST_PROVIDER_BUDGET_MS <= 500);
  assert.equal(REUSE_MAX_AGE_MS, 35 * 60000);
});

test("a late provider keeps its previous validated reading, dated and marked reused", async () => {
  const earlier = ready({ runs: [] }, instant - 10 * 60000);
  const deferred = [];
  const started = Date.now();
  const result = await withinBudget(slow(ready({ runs: [1] }), 400), earlier, {
    budgetMs: 50,
    defer: (p) => deferred.push(p),
    now: instant,
  });
  assert.ok(Date.now() - started < 300, "answered at the budget, not when the provider finished");
  assert.equal(result.reused, true);
  assert.equal(result.checkedAt, earlier.checkedAt, "the reading keeps its own original time");
  assert.deepEqual(result.data, earlier.data);
  assert.equal(deferred.length, 1, "the live read continues through waitUntil");
  assert.deepEqual((await deferred[0]).data, { runs: [1] });
});

test("a provider inside the budget is used live", async () => {
  const live = ready({ runs: [1] });
  const result = await withinBudget(slow(live, 5), ready({ runs: [] }, instant - 60000), {
    budgetMs: 200,
    now: instant,
  });
  assert.equal(result, live);
});

test("no budget, a stale reading or an unavailable reading never replaces the live read", async () => {
  const live = ready({ runs: [1] });
  for (const [earlier, options] of [
    [ready({ runs: [] }, instant - 60000), {}],
    [ready({ runs: [] }, instant - REUSE_MAX_AGE_MS - 1), { budgetMs: 20 }],
    [{ state: "unavailable", checkedAt: instant, data: null, errorCode: "SOURCE_TIMEOUT" }, { budgetMs: 20 }],
    [{ state: "not-connected", checkedAt: null, data: null }, { budgetMs: 20 }],
    [undefined, { budgetMs: 20 }],
  ]) {
    const result = await withinBudget(slow(live, 60), earlier, { ...options, now: instant });
    assert.equal(result, live);
  }
});

const reading = (development, traffic = ready({ requests: 10, errors: 0 })) => ({
  checkedAt: instant,
  health: {
    status: "healthy",
    checks: [{ name: "Database", status: "healthy", durationMs: 1 }],
    stats: { accounts: 1, sharedCampaigns: 1, active5m: 1, active24h: 2, cloudBackups: 0 },
  },
  analytics: ready({ metrics: { sessions: 1, transactionCount: 3 } }),
  development,
  traffic,
  release: ready({ commit: "a".repeat(40) }),
});
const github = (runs = [], closedPulls = []) =>
  ready({ runs, active: [], openPulls: [], closedPulls });
let nextId = 5000;
const run = (branch) => ({
  id: nextId++,
  name: "Verify preserved functionality",
  branch,
  status: "completed",
  conclusion: "success",
  url: "https://github.com/UnregisteredMusket/Lootsplit/actions/runs/1",
  startedAt: instant - HOUR,
  updatedAt: instant - HOUR / 2,
});

test("monitorSnapshot passes the budget and the previous reading to the collector, never when forced", async () => {
  const DB = localAccountDb();
  try {
    const seen = [];
    const collector = async (_env, _user, options) => {
      seen.push(options);
      return reading(github());
    };
    await monitorSnapshot({ DB }, "owner", { force: true, now: instant, collector });
    assert.equal(seen[0].budgetMs, 0);
    const defer = () => {};
    await monitorSnapshot({ DB }, "owner", {
      now: instant + 120000,
      collector,
      budgetMs: 900,
      defer,
    });
    assert.equal(seen[1].budgetMs, 900);
    assert.equal(seen[1].defer, defer);
    assert.equal(seen[1].previous.development.state, "ready", "the stored snapshot's readings");
    await monitorSnapshot({ DB }, "owner", { force: true, now: instant + 240000, collector, budgetMs: 900 });
    assert.equal(seen[2].budgetMs, 0, "a forced (scheduled) collection always waits for providers");
  } finally {
    DB.close?.();
  }
});

test("slow game statistics keep their previous reading on the request path, never when forced", async () => {
  const { collectOwnerMonitor } = await import("../cloudflare/owner-monitor.mjs");
  const DB = localAccountDb();
  try {
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)",
    ).run();
    await DB.prepare("INSERT INTO site_roles VALUES('owner','owner',0)").run();
    await DB.prepare("INSERT OR IGNORE INTO member_access(user_id,status) VALUES('owner','active')").run();
    // Every campaign-room read is slow, as on a cold isolate (9.4 s widget refresh, 2026-10-30).
    const slowRooms = {
      prepare(sql) {
        const statement = DB.prepare(sql);
        if (!/testMode/.test(sql)) return statement; // the statistics room scan only
        const delay = (p) => new Promise((r) => setTimeout(r, 600)).then(() => p);
        const wrap = (st) => ({
          bind: (...a) => wrap(st.bind(...a)),
          first: (...a) => delay(st.first(...a)),
          all: (...a) => delay(st.all(...a)),
          raw: (...a) => delay(st.raw(...a)),
          run: (...a) => delay(st.run(...a)),
        });
        return wrap(statement);
      },
      batch: (s) => DB.batch(s),
    };
    const now = Date.now();
    const earlier = { analytics: ready({ version: 1, metrics: { sessions: 3 } }, now - 10 * 60000) };
    const deferred = [];
    const started = Date.now();
    const result = await collectOwnerMonitor({ DB: slowRooms }, "owner", {
      budgetMs: REQUEST_PROVIDER_BUDGET_MS,
      defer: (p) => deferred.push(p),
      now,
      previous: earlier,
    });
    assert.ok(Date.now() - started < 590, `answered in ${Date.now() - started} ms`);
    assert.equal(result.analytics.reused, true);
    assert.equal(result.analytics.checkedAt, now - 10 * 60000, "dated with its own time");
    assert.equal(deferred.length, 1, "the live read keeps running in the background");
    await Promise.all(deferred);
    // A scheduled (forced) collection has no budget and waits for the live statistics.
    const forced = await collectOwnerMonitor({ DB: slowRooms }, "owner", { previous: earlier });
    assert.equal(forced.analytics.state, "ready");
    assert.notEqual(forced.analytics.reused, true);
  } finally {
    DB.close?.();
  }
});
