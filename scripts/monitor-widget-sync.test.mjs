// Widget synchronization (owner decision 2026-10-22): only installations that reported in the last
// seven days count; older ones are listed as inactive information, never deleted, and count again
// as soon as they report.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { DEFAULT_CONFIG } from "../cloudflare/monitor-model.mjs";
import {
  DEVICE_ACTIVE_MS,
  initializeMonitor,
  monitorSnapshot,
  widgetSyncCheck,
} from "../cloudflare/monitor-journal.mjs";

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.parse("2026-10-22T12:00:00Z");
const fresh = DEFAULT_CONFIG.deviceFreshMs;

test("a retired phone is inactive information, not attention", () => {
  const [state, symptom, , , , extra] = widgetSyncCheck(
    [
      { id: "phone-current", reported_at: now - 10 * MIN },
      { id: "phone-retired", reported_at: Date.parse("2026-10-01T09:00:00Z") },
    ],
    now,
    fresh,
  );
  assert.equal(state, "healthy");
  assert.match(symptom, /^1 active device\(s\); oldest report 2026-10-22T11:50:00\.000Z\./);
  assert.match(symptom, /1 inactive device\(s\) not counted: inactive since 2026-10-01\./);
  assert.equal(extra.activeDevices, 1);
  assert.deepEqual(extra.inactiveDevices, [
    { id: "phone-retired", lastReportAt: Date.parse("2026-10-01T09:00:00Z") },
  ]);
});

test("an active device that missed its window still needs attention", () => {
  const [state, symptom] = widgetSyncCheck(
    [
      { id: "a", reported_at: now - 5 * MIN },
      { id: "b", reported_at: now - 3 * HOUR },
    ],
    now,
    fresh,
  );
  assert.equal(state, "unavailable");
  assert.match(symptom, /2 active device\(s\).*1 not reported within 65 minutes/);
});

test("the seven-day boundary, no devices and only inactive devices", () => {
  assert.equal(
    widgetSyncCheck([{ id: "edge", reported_at: now - DEVICE_ACTIVE_MS }], now, fresh)[0],
    "unavailable",
    "Exactly seven days old still counts (and is late)",
  );
  const none = widgetSyncCheck([], now, fresh);
  assert.equal(none[0], "unavailable");
  assert.equal(none[1], "No Android installation has reported yet.");
  const onlyOld = widgetSyncCheck([{ id: "x", reported_at: now - 8 * DAY }], now, fresh);
  assert.equal(onlyOld[0], "unavailable", "Silence from every device is never healthy");
  assert.match(onlyOld[1], /No Android installation has reported in the last 7 days\./);
  assert.match(onlyOld[1], /inactive since 2026-10-14/);
  const many = Array.from({ length: 7 }, (_, i) => ({
    id: `old-${i}`,
    reported_at: now - (10 + i) * DAY,
  }));
  assert.match(widgetSyncCheck(many, now, fresh)[1], /7 inactive device\(s\).*; 2 more\.$/);
});

const reading = (at) => ({
  checkedAt: at,
  health: {
    status: "healthy",
    checks: [
      { name: "Database", status: "healthy", durationMs: 1 },
      { name: "Website assets", status: "healthy", durationMs: 1 },
    ],
    stats: { accounts: 3, sharedCampaigns: 12, active5m: 0, active24h: 1, cloudBackups: 2 },
  },
  analytics: { state: "ready", checkedAt: at, data: { metrics: {} } },
  development: { state: "unavailable", checkedAt: at, data: null },
  traffic: { state: "unavailable", checkedAt: at, data: null },
  release: { state: "ready", checkedAt: at, data: { commit: "a".repeat(40) } },
});

test("the snapshot ignores the retired phone, keeps its row and counts it again when it reports", async () => {
  const DB = localAccountDb();
  try {
    await initializeMonitor(DB, now - 2 * DAY);
    await DB.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)",
    ).run();
    await DB.prepare("INSERT INTO owner_monitor_devices VALUES('phone-current','owner',?,'{}')")
      .bind(now - MIN)
      .run();
    await DB.prepare("INSERT INTO owner_monitor_devices VALUES('phone-retired','owner',?,'{}')")
      .bind(now - 20 * DAY)
      .run();
    const sync = async (at) =>
      (
        await monitorSnapshot({ DB }, "owner", {
          force: true,
          now: at,
          collector: async () => reading(at),
        })
      ).diagnostics.find((d) => d.component === "Widget synchronization");
    let check = await sync(now);
    assert.equal(check.color, "green");
    assert.equal(check.inactiveDevices.length, 1);
    assert.match(check.symptom, /inactive since 2026-10-02/);
    // The retired phone reports again: it counts immediately (and is fresh, so still green).
    await DB.prepare("UPDATE owner_monitor_devices SET reported_at=? WHERE id='phone-retired'")
      .bind(now + MIN)
      .run();
    check = await sync(now + 2 * MIN);
    assert.equal(check.activeDevices, 2);
    assert.deepEqual(check.inactiveDevices, []);
    const rows = await DB.prepare("SELECT COUNT(*) AS n FROM owner_monitor_devices").first();
    assert.equal(rows.n, 2, "Device rows are never deleted");
  } finally {
    DB.close();
  }
});
