// Database storage warning (docs/FOOTPRINT.md, owner decision 2026-11-01): amber at 1 GB, review
// note at 2.5 GB; an unavailable reading is a coverage gap that never sets the status by itself.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { storageCheck, STORAGE_ATTENTION_BYTES, STORAGE_REVIEW_BYTES } from "../cloudflare/monitor-model.mjs";

const reading = (bytes, extra = {}) => ({
  state: "ready",
  checkedAt: 1_793_570_000_000,
  data: { metrics: [{ key: "d1StorageBytes", state: "ready", current: { value: bytes, allowance: 5e9 } }] },
  ...extra,
});

test("storage levels: healthy below 1 GB, attention from 1 GB, review from 2.5 GB", () => {
  const today = storageCheck(reading(173_645_824));
  assert.equal(today.state, "healthy");
  assert.equal(today.symptom, "The database is 174 MB of the 5 GB included.");
  assert.equal(today.extra.storageBytes, 173_645_824);
  const attention = storageCheck(reading(STORAGE_ATTENTION_BYTES));
  assert.equal(attention.state, "warning");
  assert.equal(attention.errorCode, "STORAGE_ATTENTION");
  assert.match(attention.symptom, /1\.00 GB, past the 1 GB attention level/);
  const review = storageCheck(reading(STORAGE_REVIEW_BYTES + 1));
  assert.equal(review.errorCode, "STORAGE_REVIEW");
  assert.match(review.symptom, /past the 2\.5 GB review level/);
});

test("a missing or stale size is an explicit gap that does not set the status", () => {
  for (const usage of [
    null,
    { state: "unavailable", errorCode: "STALE_READING", checkedAt: 1 },
    reading(5, { data: { metrics: [{ key: "d1StorageBytes", state: "unavailable", errorCode: "HTTP_500" }] } }),
  ]) {
    const check = storageCheck(usage);
    assert.equal(check.state, "unavailable");
    assert.equal(check.extra.required, false);
    assert.equal(check.extra.coverageLimit, true);
    assert.equal(check.extra.storageBytes, null, "never shown as zero");
  }
});

test("the Field monitor lists Database storage from the newest usage reading", async () => {
  const { monitorSnapshot } = await import("../cloudflare/monitor-journal.mjs");
  const DB = localAccountDb();
  try {
    const now = Date.parse("2026-11-01T21:05:00Z");
    const source = (data) => ({ state: "ready", checkedAt: now, data });
    await DB.prepare("INSERT OR IGNORE INTO owner_monitor_registry(id,name,kind,required,description) VALUES('cloudflare-usage','Cloudflare plan usage','interval',0,'')").run().catch(() => undefined);
    const collector = async () => ({
      checkedAt: now,
      health: { status: "healthy", checks: [{ name: "Database", status: "healthy", durationMs: 1 }], stats: {} },
      analytics: source({ metrics: {} }),
      development: source({ runs: [], active: [], openPulls: [] }),
      traffic: source({ requests: 1, errors: 0 }),
      release: source({ commit: "a".repeat(40) }),
    });
    const first = await monitorSnapshot({ DB }, "owner", { force: true, now, collector });
    const gap = first.diagnostics.find((d) => d.component === "Database storage");
    assert.ok(gap, "listed even before a usage reading exists");
    assert.equal(gap.required, false);
    await DB.prepare(
      "INSERT INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) VALUES('usage:test','cloudflare-usage',?,?,'usage',?)",
    )
      .bind(now - 60000, now - 60000, JSON.stringify({ usage: reading(1_200_000_000, { checkedAt: now - 60000 }) }))
      .run();
    const second = await monitorSnapshot({ DB }, "owner", { force: true, now: now + 1000, collector });
    const storage = second.diagnostics.find((d) => d.component === "Database storage");
    assert.equal(storage.color, "yellow");
    assert.equal(storage.errorCode, "STORAGE_ATTENTION");
    assert.equal(storage.storageBytes, 1_200_000_000);
  } finally {
    DB.close?.();
  }
});
