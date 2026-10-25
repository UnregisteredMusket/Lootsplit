// Field monitor widget redesign (owner-approved 2026-10-25): the server data behind the charts,
// the Recently resolved list, the CI/deploy pips and the live-room count. All of it is read from
// rows the minute cron already writes; unmeasured values stay null with coverage counts, never 0.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { INTERVAL, widgetSeverity } from "../cloudflare/monitor-model.mjs";
import {
  initializeMonitor,
  monitorSeries,
  recentlyResolved,
  trackRoomActivity,
  liveRooms,
  monitorWidgetData,
  LIVE_ROOM_MS,
  RESOLVED_LIMIT,
  RESOLVED_WINDOW_MS,
  SERIES_HALF_HOURS,
  SERIES_DAYS,
} from "../cloudflare/monitor-journal.mjs";
import { mainRuns, MAIN_RUN_LIMIT, ownerMonitor, widgetSnapshot } from "../cloudflare/owner-monitor.mjs";

const MIN = 60000;
const HOUR = 60 * MIN;
// 11:12:40 New York time on 2026-10-25 (EDT, UTC-4).
const now = Date.parse("2026-10-25T15:12:40Z");
const boundary = Math.floor(now / INTERVAL) * INTERVAL; // 15:00Z

const metricsBody = (requests, errors, active24h = 2) =>
  JSON.stringify({
    summary: "Interval",
    metrics: [
      { key: "active24h", value: active24h },
      { key: "requests", value: requests },
      { key: "errors", value: errors },
    ],
  });
async function interval(DB, slot, outcome, body) {
  await DB.prepare(
    "INSERT INTO owner_monitor_intervals(slot,outcome,collected_at,body) VALUES(?,?,?,?)",
  )
    .bind(slot, outcome, slot + 1000, body)
    .run();
}

test("half-hour and daily series come from stored intervals and keep every gap explicit", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 9 * 86400000);
    // Eight days of complete half-hours with 100 requests and no errors…
    for (let slot = boundary - 8 * 86400000; slot <= boundary; slot += INTERVAL) {
      const ago = (boundary - slot) / INTERVAL;
      if (ago === 3) await interval(DB, slot, "missed", JSON.stringify({ summary: "Missed" }));
      else if (ago === 4)
        // A partial collection whose traffic reading failed: requests/errors are null.
        await interval(DB, slot, "partial", metricsBody(null, null));
      else if (ago === 5)
        // A missed slot later recovered from provider history.
        await interval(
          DB,
          slot,
          "recovered",
          JSON.stringify({
            summary: "Recovered",
            historicalTraffic: { state: "ready", data: { requests: 40, errors: 1 } },
          }),
        );
      else if (ago === 6) continue; // No row at all.
      else await interval(DB, slot, "complete", metricsBody(100, ago === 1 ? 3 : 0, ago === 2 ? 5 : 2));
    }
    const series = await monitorSeries(DB, now, "America/New_York");
    assert.equal(series.state, "ready");
    const half = series.halfHour;
    assert.equal(half.end, boundary);
    assert.equal(half.requests.length, SERIES_HALF_HOURS);
    assert.equal(half.errors.length, SERIES_HALF_HOURS);
    const at = (ago) => SERIES_HALF_HOURS - 1 - ago;
    assert.equal(half.requests[at(0)], 100);
    assert.equal(half.errors[at(1)], 3);
    for (const ago of [3, 4, 6]) {
      assert.equal(half.requests[at(ago)], null, `slot ${ago} is a gap, not zero`);
      assert.equal(half.errors[at(ago)], null);
    }
    assert.equal(half.requests[at(5)], 40, "recovered provider history fills the slot");
    assert.equal(half.errors[at(5)], 1);
    assert.equal(half.measured, SERIES_HALF_HOURS - 3);
    assert.equal(series.daily.length, SERIES_DAYS);
    assert.deepEqual(
      series.daily.map((d) => d.day),
      ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"],
    );
    const yesterday = series.daily[5];
    assert.equal(yesterday.expected, 48);
    assert.equal(yesterday.measured, 48);
    assert.equal(yesterday.requests, 4800);
    assert.equal(yesterday.errors, 0);
    // Today (local midnight 04:00Z → 15:00Z): 22 slots expected, three of them not measured.
    const today = series.daily[6];
    assert.equal(today.expected, 22);
    assert.equal(today.measured, 19);
    assert.equal(today.requests, 18 * 100 + 40);
    assert.equal(today.errors, 3 + 1);
    assert.equal(today.active24hMax, 5);
  } finally {
    DB.close();
  }
});

test("a day or window with nothing measured is null, and an uncollected newest slot is not a gap", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 86400000);
    await interval(DB, boundary - INTERVAL, "complete", metricsBody(7, 0));
    // The 15:00 boundary passed 12 minutes ago but the slot is still being collected.
    await interval(DB, boundary, "collecting", null);
    const early = await monitorSeries(DB, boundary + 5 * MIN, "America/New_York");
    assert.equal(early.halfHour.end, boundary - INTERVAL, "ends at the last final slot");
    assert.equal(early.halfHour.requests.at(-1), 7);
    const late = await monitorSeries(DB, boundary + 15 * MIN, "America/New_York");
    assert.equal(late.halfHour.end, boundary, "after 10 minutes the missing slot is a real gap");
    assert.equal(late.halfHour.requests.at(-1), null);
    for (const day of late.daily.slice(0, 6)) {
      assert.equal(day.requests, null, `${day.day} was not measured`);
      assert.equal(day.errors, null);
      assert.equal(day.measured, 0);
      assert.equal(day.active24hMax, null);
      assert.ok(day.expected >= 46, "the expected count says what is missing");
    }
  } finally {
    DB.close();
  }
});

async function diagnosticLog(DB, component, at, check) {
  await DB.prepare(
    "INSERT INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) VALUES(?,'diagnostics',?,?,?,?)",
  )
    .bind(
      `diagnostic:${component}:${at}`,
      at,
      at,
      `${component}: ${check.symptom}`,
      JSON.stringify({ diagnostic: { component, required: true, ...check } }),
    )
    .run();
}
const bad = (firstOccurredAt, extra = {}) => ({
  color: "yellow",
  state: "unavailable",
  symptom: "GitHub workflows could not be checked.",
  impact: "Monitoring may be out of date.",
  firstOccurredAt,
  ...extra,
});
const good = (recoveredAt) => ({
  color: "green",
  state: "healthy",
  symptom: "The source returned a validated reading.",
  firstOccurredAt: null,
  recoveredAt,
});

test("recently resolved lists recoveries of the last 24 hours, newest first, with start and end", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 3 * 86400000);
    // 1. A GitHub timeout from 11:00 to 11:01 (both inside the window).
    await diagnosticLog(DB, "GitHub workflows", now - 20 * MIN, bad(now - 20 * MIN, { errorCode: "SOURCE_TIMEOUT" }));
    await diagnosticLog(DB, "GitHub workflows", now - 19 * MIN, good(now - 19 * MIN));
    // 2. A confirmed failure that started 30 hours ago and ended 2 hours ago (lookup before the window).
    await diagnosticLog(DB, "Worker execution errors", now - 30 * HOUR, bad(now - 30 * HOUR, { color: "red", state: "error", confirmedFailure: true, brief: "12 errors in 24h" }));
    await diagnosticLog(DB, "Worker execution errors", now - 2 * HOUR, good(now - 2 * HOUR));
    // 3. Recovered, then failed again: it is a current problem, not resolved.
    await diagnosticLog(DB, "Multiplayer", now - 5 * HOUR, bad(now - 5 * HOUR));
    await diagnosticLog(DB, "Multiplayer", now - 4 * HOUR, good(now - 4 * HOUR));
    await diagnosticLog(DB, "Multiplayer", now - 1 * HOUR, bad(now - 1 * HOUR));
    // 4. Recovered more than 24 hours ago: outside the window.
    await diagnosticLog(DB, "Daily reporting", now - 27 * HOUR, bad(now - 27 * HOUR));
    await diagnosticLog(DB, "Daily reporting", now - 25 * HOUR, good(now - 25 * HOUR));
    // 5. A first observation that was green was never a problem.
    await diagnosticLog(DB, "Backend", now - 3 * HOUR, good(null));
    // 6. Green in the log but red in the current reading: still a problem.
    await diagnosticLog(DB, "Storage", now - 6 * HOUR, bad(now - 6 * HOUR));
    await diagnosticLog(DB, "Storage", now - 5 * HOUR, good(now - 5 * HOUR));
    const result = await recentlyResolved(DB, now, [
      { component: "Storage", color: "red" },
      { component: "GitHub workflows", color: "green" },
    ]);
    assert.equal(result.state, "ready");
    assert.equal(result.windowMs, RESOLVED_WINDOW_MS);
    assert.equal(result.complete, true);
    assert.deepEqual(
      result.items.map((i) => i.component),
      ["GitHub workflows", "Worker execution errors"],
    );
    assert.equal(result.total, 2);
    const [github, worker] = result.items;
    assert.equal(github.startedAt, now - 20 * MIN);
    assert.equal(github.resolvedAt, now - 19 * MIN);
    assert.equal(github.durationMs, MIN);
    assert.equal(github.severity, "warning", "a check that could not be verified is a warning");
    assert.equal(github.resolution, "recovered");
    assert.deepEqual(github.history.map((h) => h.color), ["green", "yellow"]);
    assert.equal(worker.severity, "critical");
    assert.equal(worker.startedAt, now - 30 * HOUR, "the start is kept even before the window");
    assert.equal(worker.resolvedAt, now - 2 * HOUR);
    assert.equal(worker.brief, "12 errors in 24h");
  } finally {
    DB.close();
  }
});

test("recently resolved keeps at most five, counts the rest and states a capped scan", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 86400000);
    for (let i = 0; i < 8; i++) {
      const component = `Workflow: Verify (${i})`;
      await diagnosticLog(DB, component, now - (10 + i) * HOUR, bad(now - (10 + i) * HOUR));
      await diagnosticLog(DB, component, now - (2 + i) * HOUR, { ...good(now - (2 + i) * HOUR), state: i === 0 ? "retired" : "healthy" });
    }
    const result = await recentlyResolved(DB, now, []);
    assert.equal(result.items.length, RESOLVED_LIMIT);
    assert.equal(result.total, 8);
    assert.deepEqual(
      result.items.map((i) => i.resolvedAt),
      [...result.items.map((i) => i.resolvedAt)].sort((a, b) => b - a),
      "newest first",
    );
    assert.equal(result.items[0].resolution, "retired", "a retired branch says so");
    assert.equal(result.complete, true);
    // A flapping component fills the bounded scan: the list says it is incomplete.
    for (let i = 0; i < 400; i++)
      await diagnosticLog(DB, "Flapping", now - 60 * MIN + i * 1000, i % 2 ? good(now - 60 * MIN + i * 1000) : bad(now - 61 * MIN));
    assert.equal((await recentlyResolved(DB, now, [])).complete, false);
  } finally {
    DB.close();
  }
});

test("severity: confirmed failure is critical, unverifiable is a warning, a coverage limit is info", () => {
  assert.equal(widgetSeverity({ color: "red", state: "error", confirmedFailure: true }), "critical");
  assert.equal(widgetSeverity({ color: "red", state: "unavailable", retainedFailure: true, confirmedFailure: true }), "critical");
  assert.equal(widgetSeverity({ color: "yellow", state: "warning" }), "warning");
  assert.equal(widgetSeverity({ color: "yellow", state: "unavailable", required: true }), "warning");
  assert.equal(widgetSeverity({ color: "yellow", state: "unavailable", required: false, coverageLimit: true }), "info");
  assert.equal(widgetSeverity({ color: "green", state: "healthy" }), null);
  const compact = widgetSnapshot({ diagnostics: [{ component: "A", color: "red", state: "error" }, { component: "B", color: "green" }] });
  assert.deepEqual(compact.diagnostics.map((d) => d.severity), ["critical", null]);
});

test("main runs: completed runs on main only, scheduled excluded, newest first, bounded", () => {
  const runs = [];
  for (let i = 0; i < 30; i++)
    runs.push({
      id: i,
      name: i % 2 ? "Verify preserved functionality" : "Deploy verified website",
      branch: i % 5 === 4 ? "feature/x" : "main",
      status: i === 0 ? "in_progress" : "completed",
      conclusion: i === 0 ? null : i === 3 ? "failure" : "success",
      event: i === 6 ? "schedule" : "push",
      deployment: i % 2 === 0,
      url: `https://github.com/UnregisteredMusket/Lootsplit/actions/runs/${i}`,
      startedAt: now - i * HOUR - MIN,
      updatedAt: now - i * HOUR,
    });
  const list = mainRuns(runs);
  assert.equal(list.length, MAIN_RUN_LIMIT);
  assert.ok(list.every((r) => r.conclusion), "running runs are in `active`, not here");
  assert.equal(list[0].at, now - HOUR);
  assert.equal(list.find((r) => r.at === now - 3 * HOUR).conclusion, "failure");
  assert.ok(!list.some((r) => r.at === now - 6 * HOUR), "scheduled housekeeping is not a deploy");
  assert.ok(!list.some((r) => r.at === now - 4 * HOUR), "branches other than main are excluded");
  assert.ok(!JSON.stringify(list).includes("https://"), "no URLs in the compact list");
  assert.equal(mainRuns(undefined), null);
  const compact = widgetSnapshot({ development: { state: "ready", data: { runs, active: [] } } });
  assert.equal(compact.development.data.mainRuns.length, MAIN_RUN_LIMIT);
  assert.equal(compact.development.data.runs, undefined);
  assert.deepEqual(compact.development.data.omitted, { runs: 30, closedPulls: 0 });
});

async function room(DB, code, revision) {
  await DB.prepare(
    "INSERT INTO campaign_rooms(code,revision,body) VALUES(?,?,'{}') ON CONFLICT(code) DO UPDATE SET revision=excluded.revision",
  )
    .bind(code, revision)
    .run();
}

test("live rooms: rooms changed in the last five minutes, probes excluded, gaps explicit", async () => {
  const DB = localAccountDb();
  try {
    assert.equal((await liveRooms(DB, now)).errorCode, "NOT_COLLECTED");
    await room(DB, "ABCDEFGH", 1);
    await room(DB, "JKLMNPQR", 4);
    await room(DB, "MONITOR-PROBE-1", 1);
    const start = now - 20 * MIN;
    await trackRoomActivity(DB, start);
    const warming = await liveRooms(DB, start + MIN);
    assert.equal(warming.state, "unavailable");
    assert.equal(warming.errorCode, "WARMING_UP");
    assert.equal(warming.live, null, "unknown, not zero");
    // Existing idle rooms are recorded without a change time: never counted as live.
    await trackRoomActivity(DB, start + 6 * MIN);
    assert.equal((await liveRooms(DB, start + 6 * MIN)).live, 0);
    // A write to one room (and to the probe, which never counts) and a new room.
    await room(DB, "ABCDEFGH", 2);
    await room(DB, "MONITOR-PROBE-1", 2);
    await room(DB, "STUVWXYZ", 1);
    await trackRoomActivity(DB, start + 7 * MIN);
    const live = await liveRooms(DB, start + 8 * MIN);
    assert.equal(live.state, "ready");
    assert.equal(live.live, 2);
    assert.equal(live.windowMs, LIVE_ROOM_MS);
    // Five minutes later with no further change, the rooms are no longer live.
    await trackRoomActivity(DB, start + 13 * MIN);
    assert.equal((await liveRooms(DB, start + 13 * MIN)).live, 0);
    // The minute cron stopped: the count is a stale gap.
    const stale = await liveRooms(DB, start + 17 * MIN);
    assert.equal(stale.errorCode, "STALE_READING");
    assert.equal(stale.live, null);
    const stored = await DB.prepare("SELECT * FROM owner_monitor_room_activity").all();
    assert.ok(
      !JSON.stringify(stored.results).includes("ABCDEFGH"),
      "the tracker stores row ids, never room codes",
    );
  } finally {
    DB.close();
  }
});

test("one failed part stays an explicit gap without hiding the others", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 86400000);
    const broken = {
      prepare(sql) {
        if (sql.includes("owner_monitor_room_activity")) throw new Error("no such table");
        return DB.prepare(sql);
      },
      batch: (s) => DB.batch(s),
    };
    const data = await monitorWidgetData(broken, { settings: { timezone: "America/New_York" }, diagnostics: [] }, now);
    assert.deepEqual(data.rooms, { state: "unavailable", errorCode: "READ_FAILED" });
    assert.equal(data.series.state, "ready");
    assert.equal(data.recentlyResolved.state, "ready");
  } finally {
    DB.close();
  }
});

async function seedOwner(DB) {
  await DB.prepare(
    "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)",
  ).run();
  await DB.prepare(
    'INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,?,?,?)',
  )
    .bind("s-owner", "2999-01-01T00:00:00.000Z", "t-owner", "2026-01-01", "2026-01-01", "owner")
    .run();
  await DB.prepare("INSERT INTO site_roles VALUES('owner','owner',0)").run();
  await DB.prepare("INSERT OR IGNORE INTO member_access(user_id,status) VALUES('owner','active')").run();
}
const widgetRequest = () => new Request("https://test/api/account/owner/monitor?view=widget");

test("the widget payload stays under 64 kB at production size and carries the new parts", async () => {
  const DB = localAccountDb();
  try {
    const at = Date.now();
    await seedOwner(DB);
    await initializeMonitor(DB, at - 8 * 86400000);
    // 393 incident rows as in production: mostly retired branch workflows, each with history.
    for (let i = 0; i < 393; i++) {
      const component = `Workflow: Verify preserved functionality (feature/branch-${i})`;
      const check = { component, color: "green", state: "retired", symptom: `Pull request #${i} for feature/branch-${i} was merged; this branch is no longer monitored.`, latestCheckAt: at - HOUR };
      await DB.prepare("INSERT INTO owner_monitor_incidents VALUES(?,?)").bind(component, JSON.stringify(check)).run();
      await diagnosticLog(DB, component, at - (2 + (i % 20)) * HOUR, bad(at - 23 * HOUR));
      await diagnosticLog(DB, component, at - (1 + (i % 20)) * HOUR, { ...good(at - (1 + (i % 20)) * HOUR), state: "retired" });
    }
    for (let slot = Math.floor(at / INTERVAL) * INTERVAL - 7 * 86400000; slot <= at; slot += INTERVAL)
      await interval(DB, slot, "complete", metricsBody(321, 1));
    const payload = await ownerMonitor({ DB, ACCOUNT_ORIGIN: "https://test" }, "owner", "s-owner", widgetRequest());
    const size = Buffer.byteLength(JSON.stringify(payload));
    assert.ok(size < 64 * 1024, `widget payload ${size} bytes`);
    assert.equal(payload.view, "widget");
    assert.equal(payload.series.state, "ready");
    assert.equal(payload.series.halfHour.requests.length, SERIES_HALF_HOURS);
    assert.equal(payload.recentlyResolved.items.length, RESOLVED_LIMIT);
    assert.ok(payload.recentlyResolved.total > RESOLVED_LIMIT);
    assert.equal(payload.rooms.errorCode, "NOT_COLLECTED");
    assert.ok(payload.diagnostics.every((d) => "severity" in d));
    // The dashboard (full view) is unchanged: none of the widget-only parts.
    const full = await ownerMonitor({ DB, ACCOUNT_ORIGIN: "https://test" }, "owner", "s-owner", new Request("https://test/api/account/owner/monitor"));
    for (const key of ["series", "recentlyResolved", "rooms"]) assert.equal(full[key], undefined, key);
  } finally {
    DB.close();
  }
});

test("the owner authorization re-check still runs after the widget reads", async () => {
  const DB = localAccountDb();
  try {
    await seedOwner(DB);
    await initializeMonitor(DB, Date.now() - 86400000);
    const revoking = {
      prepare(sql) {
        // The live-room read is the last widget read; the role is revoked while it runs.
        if (sql.startsWith("SELECT first_seen_at,changed_at FROM owner_monitor_room_activity"))
          DB.prepare("DELETE FROM site_roles WHERE user_id='owner'").run();
        return DB.prepare(sql);
      },
      batch: (s) => DB.batch(s),
    };
    await assert.rejects(
      ownerMonitor({ DB: revoking, ACCOUNT_ORIGIN: "https://test" }, "owner", "s-owner", widgetRequest()),
      (error) => error.status === 403,
    );
  } finally {
    DB.close();
  }
});

test("the room activity migration passes the release job's additive check", async () => {
  const { assertAdditiveSql } = await import("./production-migrations.mjs");
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../cloudflare/migrations/0023_owner_monitor_room_activity.sql", import.meta.url), "utf8");
  assert.equal(assertAdditiveSql("0023_owner_monitor_room_activity.sql", sql), 2);
});
