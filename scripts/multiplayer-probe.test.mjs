// The owner monitor's synthetic multiplayer probe: a real round trip through the room path, an
// isolated namespace excluded from every total and listing, no leftovers, bounded failures and
// timeouts, no concurrent duplicates, and a real (required) Multiplayer diagnostic with history.
import test from "node:test";
import { readStoredRoom } from "../cloudflare/room-storage.mjs";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { INTERVAL } from "../cloudflare/monitor-model.mjs";
import {
  PROBE_FRESH_MS,
  probeCode,
  runMultiplayerProbe,
} from "../cloudflare/multiplayer-probe.mjs";
import { isProbeRoomCode, notProbeRoom } from "../cloudflare/probe-namespace.mjs";
import {
  collectInterval,
  generateReport,
  initializeMonitor,
  multiplayerCheck,
} from "../cloudflare/monitor-journal.mjs";
import { siteGameAnalytics } from "../cloudflare/game-analytics.mjs";
import { serverMonitor } from "../cloudflare/monitoring.mjs";
import { ownerOverview } from "../cloudflare/site-owner.mjs";
import { DEFAULT_CONFIG } from "../cloudflare/monitor-model.mjs";
import * as realRooms from "../src/lib/quire/cloud.server.ts";
import * as realStore from "../src/lib/quire/room-store.server.ts";
import { emptyCloudTable } from "../src/lib/quire/cloud.ts";
import { fromCopper } from "../src/lib/quire/money.ts";

const MIN = 60000;
const slot = Date.parse("2026-10-22T12:00:00Z");

function freshDb() {
  const DB = localAccountDb();
  globalThis.__env__ = { DB };
  return DB;
}
/** Every row in any table keyed by a room code, so leftovers anywhere are caught (`except`:
 * tables left out, such as a live room's own stored sections). */
async function probeRows(DB, except = []) {
  const tables = (await DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())
    .results;
  let count = 0;
  for (const { name } of tables) {
    if (except.includes(name)) continue;
    const columns = (await DB.prepare(`PRAGMA table_info("${name}")`).all()).results;
    for (const { name: column } of columns)
      if (["code", "room_code", "campaign_code"].includes(column))
        count += (
          await DB.prepare(
            `SELECT COUNT(*) AS n FROM "${name}" WHERE "${column}" GLOB 'MONITOR-PROBE-*'`,
          ).first()
        ).n;
  }
  return count;
}
async function syncFirst(stmt) {
  return await stmt.first();
}
async function realRoom(code) {
  await realStore.createRoom({
    code,
    revision: 1,
    turn: 0,
    live: false,
    seats: [{ id: "dm", token: "dm-" + code, role: "dm", name: "DM", purseIds: [] }],
    seen: { gifts: [], sales: [] },
    table: {
      ...emptyCloudTable(),
      purses: [{ id: "hero", kind: "character", name: "Hero", coins: fromCopper(500) }],
    },
  });
}

test("the namespace cannot match a real room code", () => {
  assert.equal(probeCode(slot), "MONITOR-PROBE-" + slot);
  assert.ok(isProbeRoomCode(probeCode(slot)));
  assert.ok(isProbeRoomCode(" monitor-probe-1 "));
  for (const code of ["ABCDEFGH", "T1A2B3C4", "0123456789", "MONITORP"])
    assert.equal(isProbeRoomCode(code), false, code);
  assert.equal(notProbeRoom("r.code"), "r.code NOT GLOB 'MONITOR-PROBE-*'");
});

test("a probe passes the real round trip and leaves no rows anywhere", async () => {
  const DB = freshDb();
  try {
    await realRoom("REALROOM");
    const before = await syncFirst(
      DB.prepare("SELECT body FROM campaign_rooms WHERE code='REALROOM'"),
    );
    const result = await runMultiplayerProbe({ DB }, slot);
    assert.equal(result.outcome, "passed", result.summary);
    assert.deepEqual(
      result.steps.map((s) => s.step),
      ["sweep", "open", "join", "authorization", "send", "read", "revision", "cleanup"],
    );
    assert.equal(result.cleanup, "complete");
    assert.match(result.summary, /^Multiplayer round trip passed in \d+ ms/);
    assert.equal(await probeRows(DB), 0, "no probe rows remain in any table");
    for (const table of ["library_members", "play_rolls", "push_subscriptions"])
      assert.equal(
        (await syncFirst(DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`))).n,
        0,
        `${table} untouched`,
      );
    const after = await syncFirst(
      DB.prepare("SELECT body FROM campaign_rooms WHERE code='REALROOM'"),
    );
    assert.equal(after.body, before.body, "a real campaign is never touched");
  } finally {
    DB.close();
  }
});

test("probe rooms are excluded from counts, analytics, owner overview, preview and join", async () => {
  const DB = freshDb();
  try {
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)",
    ).run();
    await DB.prepare(
      "INSERT INTO site_roles(user_id,role,granted_at) VALUES('owner','owner',0)",
    ).run();
    await realRoom("REALROOM");
    const code = probeCode(slot);
    // A probe room that exists (as during a run) with a ledger entry that would change totals.
    await realRooms.openRoom(
      {
        name: "Monitor probe DM",
        table: {
          ...emptyCloudTable(),
          purses: [{ id: "c", kind: "character", name: "Probe", coins: fromCopper(999999) }],
        },
      },
      { monitorProbe: true, code },
    );
    const stored = (await readStoredRoom(DB, code)).room;
    assert.equal(stored.monitorProbe, true);
    assert.equal((await siteGameAnalytics(DB)).sharedCampaigns, 1, "analytics/gold totals");
    const health = await serverMonitor({ DB }, "owner");
    assert.equal(health.stats.sharedCampaigns, 1, "campaigns tile and daily-report counts");
    assert.equal((await ownerOverview(DB, "owner")).stats.sharedCampaigns, 1, "owner overview");
    // Players cannot discover or join it, even with the exact code; it reads as missing.
    await assert.rejects(realRooms.previewRoom(code), /No table uses that code/);
    await assert.rejects(
      realRooms.joinRoom({ code, purseId: "c", name: "Intruder" }),
      /No table uses that code/,
    );
    await assert.rejects(
      realRooms.joinRoom(
        { code, purseId: "c", name: "Intruder" },
        { monitorProbe: true, code: "ABCDEFGH" },
      ),
      /No table uses that code/,
      "probe access for another code does not open this one",
    );
    // A probe room can only be opened for a probe code, and never with an account.
    await assert.rejects(
      realRooms.openRoom(
        { name: "x", table: stored.table },
        { monitorProbe: true, code: "ABCDEFGH" },
      ),
      /probe code/,
    );
    await assert.rejects(
      realRooms.openRoom(
        { name: "x", table: stored.table, userId: "owner" },
        { monitorProbe: true, code: probeCode(slot + INTERVAL) },
      ),
      /no account/,
    );
    // An ordinary open never lands in the namespace.
    const ordinary = await realRooms.openRoom({ name: "DM", table: stored.table });
    assert.equal(isProbeRoomCode(ordinary.code), false);
  } finally {
    DB.close();
  }
});

test("leftovers from an interrupted earlier run are swept; the current slot's room is not", async () => {
  const DB = freshDb();
  try {
    await realRoom("REALROOM");
    const table = {
      ...emptyCloudTable(),
      purses: [{ id: "c", kind: "character", name: "P", coins: fromCopper(0) }],
    };
    await realRooms.openRoom(
      { name: "old", table },
      { monitorProbe: true, code: probeCode(slot - 2 * INTERVAL) },
    );
    let result = await runMultiplayerProbe({ DB }, slot);
    assert.equal(result.outcome, "passed");
    assert.equal(result.swept, 1);
    assert.equal(await probeRows(DB), 0);
    // Another run owns this slot (its room exists): skip without touching it.
    await realRooms.openRoom(
      { name: "other", table },
      { monitorProbe: true, code: probeCode(slot) },
    );
    result = await runMultiplayerProbe({ DB }, slot);
    assert.equal(result.outcome, "skipped");
    assert.equal(
      await probeRows(DB, ["campaign_room_sections"]),
      1,
      "the owning run's room is left to that run",
    );
    assert.ok(await realStore.readRoomAccess("REALROOM"));
  } finally {
    DB.close();
  }
});

test("two concurrent probes for one slot never both run the round trip", async () => {
  const DB = freshDb();
  try {
    const results = await Promise.all([
      runMultiplayerProbe({ DB }, slot),
      runMultiplayerProbe({ DB }, slot),
    ]);
    const outcomes = results.map((r) => r.outcome).sort();
    assert.ok(outcomes.includes("passed"), JSON.stringify(results.map((r) => r.summary)));
    assert.ok(!outcomes.includes("failed"), JSON.stringify(results.map((r) => r.summary)));
    assert.equal(await probeRows(DB), 0);
  } finally {
    DB.close();
  }
});

test("failures name the step and symptom, never leave the room behind and never throw", async () => {
  const DB = freshDb();
  try {
    // A server that applies a retried batch twice.
    let calls = 0;
    const doubled = {
      ...realRooms,
      submitCommands: async (input) => {
        const view = await realRooms.submitCommands(input);
        return ++calls === 2 ? { ...view, revision: view.revision + 1 } : view;
      },
    };
    let result = await runMultiplayerProbe({ DB }, slot, { rooms: doubled });
    assert.equal(result.outcome, "failed");
    assert.equal(result.failedStep, "send");
    assert.equal(result.errorCode, "MULTIPLAYER_PROBE_FAILED");
    assert.match(result.summary, /send: a retried command batch was applied twice/);
    assert.equal(result.cleanup, "deleted-after-failure");
    assert.equal(await probeRows(DB), 0);
    // A reader that loses the message.
    const lossy = {
      ...realRooms,
      pollRoom: async (input) => {
        const view = await realRooms.pollRoom(input);
        return "table" in view ? { ...view, table: { ...view.table, notes: [] } } : view;
      },
    };
    result = await runMultiplayerProbe({ DB }, slot + INTERVAL, { rooms: lossy });
    assert.match(result.summary, /read: the DM's poll did not return the guest's message/);
    assert.equal(await probeRows(DB), 0);
    // An unexpected storage error is reported generically (raw errors can contain SQL).
    const broken = {
      ...realRooms,
      joinRoom: async () => {
        throw new Error("D1_ERROR: SELECT secret FROM somewhere");
      },
    };
    result = await runMultiplayerProbe({ DB }, slot + 2 * INTERVAL, { rooms: broken });
    assert.equal(result.failedStep, "join");
    assert.match(result.summary, /join: the room service returned an unexpected error/);
    assert.doesNotMatch(result.summary, /SELECT|secret/);
    assert.equal(await probeRows(DB), 0);
    // A security regression: an outsider can join a probe room.
    const open = {
      ...realRooms,
      joinRoom: (input, probe) =>
        realRooms.joinRoom(input, probe ?? { monitorProbe: true, code: input.code }),
    };
    result = await runMultiplayerProbe({ DB }, slot + 3 * INTERVAL, { rooms: open });
    assert.match(result.summary, /authorization: a probe room accepted an outside join/);
    assert.equal(await probeRows(DB), 0);
  } finally {
    DB.close();
  }
});

test("a hung step times out within the bound and the room is still removed", async () => {
  const DB = freshDb();
  try {
    const hung = { ...realRooms, joinRoom: () => new Promise(() => {}) };
    const started = Date.now();
    const result = await runMultiplayerProbe({ DB }, slot, { rooms: hung, timeoutMs: 200 });
    assert.ok(Date.now() - started < 5000, "bounded: timeout plus at most two seconds of grace");
    assert.equal(result.outcome, "failed");
    assert.equal(result.errorCode, "MULTIPLAYER_PROBE_TIMEOUT");
    assert.match(result.summary, /timed out after 200 ms during join/);
    assert.equal(await probeRows(DB), 0);
  } finally {
    DB.close();
  }
});

test("the Multiplayer check: none, fresh pass, stale pass and a failure that stays red", () => {
  const now = slot + 5 * MIN;
  const entry = (outcome, at, extra = {}) => ({
    observed_at: at,
    summary:
      outcome === "passed"
        ? "Multiplayer round trip passed in 40 ms."
        : "Multiplayer round trip failed (send: x).",
    body: JSON.stringify({ outcome, durationMs: 40, ...extra }),
  });
  assert.equal(multiplayerCheck(null, now)[0], "unavailable");
  const healthy = multiplayerCheck(entry("passed", slot), now);
  assert.equal(healthy[0], "healthy");
  assert.match(healthy[1], /passed in 40 ms\. Probe at 2026-10-22T12:00:00\.000Z\./);
  const stale = multiplayerCheck(entry("passed", now - PROBE_FRESH_MS - 1), now);
  assert.equal(stale[0], "unavailable");
  assert.match(stale[1], /no newer probe has run/);
  const failed = multiplayerCheck(
    entry("failed", now - 3 * 3600000, {
      errorCode: "MULTIPLAYER_PROBE_TIMEOUT",
      failedStep: "join",
    }),
    now,
  );
  assert.equal(failed[0], "error", "an old failure is not forgotten");
  assert.equal(failed[4], "MULTIPLAYER_PROBE_TIMEOUT");
  assert.equal(failed[5].brief, "round trip failed");
  assert.equal(failed[5].probe.failedStep, "join");
});

const source = (data, at) => ({ state: "ready", checkedAt: at, data });
const reading = (at) => ({
  checkedAt: at,
  health: {
    status: "healthy",
    checks: [
      { name: "Database", status: "healthy", durationMs: 1 },
      { name: "Website assets", status: "healthy", durationMs: 1 },
    ],
    stats: { accounts: 1, sharedCampaigns: 0, active5m: 0, active24h: 0, cloudBackups: 0 },
  },
  analytics: source({ metrics: {} }, at),
  development: source({ runs: [], active: [], openPulls: [], closedPulls: [], events: [] }, at),
  traffic: { state: "not-connected", checkedAt: at, data: null },
  release: source({ commit: "a".repeat(40) }, at),
});

test("collection records each probe as history and decides the required Multiplayer check", async () => {
  const DB = freshDb();
  try {
    await initializeMonitor(DB, slot - 86400000);
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)",
    ).run();
    const options = (at, probe) => ({
      now: at,
      integrations: false,
      collector: async () => reading(at),
      multiplayerProbe: probe,
    });
    const diag = async () =>
      JSON.parse(
        (
          await syncFirst(
            DB.prepare("SELECT body FROM owner_monitor_incidents WHERE component='Multiplayer'"),
          )
        ).body,
      );
    await collectInterval({ DB }, "owner", slot, options(slot + MIN, runMultiplayerProbe));
    let check = await diag();
    assert.equal(check.color, "green");
    assert.equal(check.required, true);
    assert.equal(check.coverageLimit, undefined, "no longer a coverage limit");
    assert.match(check.symptom, /round trip passed/);
    // A failing probe in the next slot turns it red with the symptom.
    const broken = (env, s) =>
      runMultiplayerProbe(env, s, {
        rooms: {
          ...realRooms,
          joinRoom: async () => {
            throw new Error("down");
          },
        },
      });
    await collectInterval({ DB }, "owner", slot + INTERVAL, options(slot + INTERVAL + MIN, broken));
    check = await diag();
    assert.equal(check.color, "red");
    assert.equal(check.errorCode, "MULTIPLAYER_PROBE_FAILED");
    assert.match(check.symptom, /join: the room service returned an unexpected error/);
    // A slot without a probe (for example local development) keeps the failure red.
    await collectInterval(
      { DB },
      "owner",
      slot + 2 * INTERVAL,
      options(slot + 2 * INTERVAL + MIN, null),
    );
    assert.equal((await diag()).color, "red");
    // History keeps every probe, passed and failed, one entry per slot.
    const history = await DB.prepare(
      "SELECT id,json_extract(body,'$.outcome') AS outcome FROM owner_monitor_logs WHERE source='multiplayer' ORDER BY observed_at",
    ).all();
    assert.deepEqual(
      history.results.map((r) => [r.id, r.outcome]),
      [
        [`multiplayer:${slot}`, "passed"],
        [`multiplayer:${slot + INTERVAL}`, "failed"],
      ],
    );
    assert.equal(await probeRows(DB), 0);
    // Without ASSETS (tests, tools) the default is not to probe.
    await collectInterval({ DB }, "owner", slot + 3 * INTERVAL, {
      now: slot + 3 * INTERVAL + MIN,
      integrations: false,
      collector: async () => reading(slot + 3 * INTERVAL + MIN),
    });
    assert.equal(
      (
        await syncFirst(
          DB.prepare("SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='multiplayer'"),
        )
      ).n,
      2,
    );
  } finally {
    DB.close();
  }
});

test("the multiplayer log is a registered source with explicit missing-data coverage", async () => {
  const DB = freshDb();
  try {
    const instant = Date.parse("2026-10-21T04:00:00Z");
    await initializeMonitor(DB, instant - 86400000);
    const report = await generateReport(DB, "2026-10-20", DEFAULT_CONFIG, instant + 86400000);
    const coverage = report.coverage.find((c) => c.id === "multiplayer");
    assert.ok(coverage, "included in the daily report");
    assert.match(coverage.gap, /No data/);
  } finally {
    DB.close();
  }
});
