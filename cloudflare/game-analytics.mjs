import { notProbeRoom } from "./probe-namespace.mjs";
import {
  ANALYTICS_VERSION,
  addMetrics,
  campaignAnalytics,
  emptyMetrics,
  publicGameMetrics,
} from "../src/lib/quire/analytics.ts";
import { roleOf } from "./members.mjs";
import { hydrateRoomReports } from "./room-reports.mjs";
import { readRoomTables, roomRevisions } from "./room-storage.mjs";

// Bound repeated homepage reads per database/isolate; failures are never cached as zero.
const snapshots = new WeakMap();
export async function siteGameAnalytics(db) {
  const cached = snapshots.get(db);
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = collect(db);
  snapshots.set(db, { until: Date.now() + 60_000, promise });
  try {
    return await promise;
  } catch (error) {
    snapshots.delete(db);
    throw error;
  }
}

/** Campaigns counted in site statistics: not test mode, not a monitoring probe. */
const COUNTED = () => `COALESCE(json_extract(body, '$.testMode'), 0) = 0 AND ${notProbeRoom()}`;
/** Changed campaigns are recounted in groups this size (bound parameters per query). */
const RECOUNT_GROUP = 50;
const metricKeys = Object.keys(emptyMetrics());
/** Cached per-campaign figures, or null when unreadable or from another analytics version. */
function cachedMetrics(row) {
  if (!row || Number(row.analytics_version) !== ANALYTICS_VERSION) return null;
  try {
    const value = JSON.parse(row.metrics);
    return metricKeys.every((key) => Number.isSafeInteger(value?.[key])) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Running totals (footprint rules, owner decision 2026-11-01): each campaign's figures are kept in
 * game_analytics_cache with the revision they were counted at (migration 0031). A collection lists
 * stored revisions, adds cached figures for unchanged campaigns and recounts only changed ones, one
 * room at a time as before (never deserializing room tokens or chats). The totals equal a full
 * recount: every figure is a sum over campaigns. Cache rows of campaigns that no longer count are
 * removed, so the cache never outgrows the rooms.
 */
export async function collect(db, now = Date.now()) {
  const rooms = await roomRevisions(db, { where: COUNTED() });
  const cache = new Map(
    /** @type {any[]} */ (
      (await db.prepare("SELECT code,revision,analytics_version,metrics FROM game_analytics_cache").all()).results
    ).map((row) => [row.code, row]),
  );
  const metrics = emptyMetrics();
  const changed = [];
  for (const room of rooms) {
    const row = cache.get(room.code);
    const known = row && Number(row.revision) === room.revision ? cachedMetrics(row) : null;
    if (known) addMetrics(metrics, known);
    else changed.push(room);
  }
  const writes = [];
  for (let i = 0; i < changed.length; i += RECOUNT_GROUP) {
    const group = changed.slice(i, i + RECOUNT_GROUP);
    const revision = new Map(group.map((room) => [room.code, room.revision]));
    for await (const { code, fields: row } of readRoomTables(db, ["ledger", "purses", "holdings", "journal"], {
      where: `code IN (${group.map(() => "?").join(",")}) AND ${COUNTED()}`,
      whereArgs: group.map((room) => room.code),
    })) {
      const figures = campaignAnalytics({
        ledger: JSON.parse(row.ledger || "[]"),
        purses: JSON.parse(row.purses || "[]"),
        holdings: JSON.parse(row.holdings || "[]"),
        // Archived session snapshots are stored beside the room row (room-reports.mjs).
        journal: (await hydrateRoomReports(db, code, { journal: JSON.parse(row.journal || "null") }))
          .journal,
      });
      addMetrics(metrics, figures);
      // Stored with the revision listed before the read: if the room changed meanwhile, the next
      // collection sees a newer revision and recounts it (never a stale figure kept as current).
      writes.push(
        db
          .prepare(
            "INSERT INTO game_analytics_cache(code,revision,analytics_version,metrics,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET revision=excluded.revision,analytics_version=excluded.analytics_version,metrics=excluded.metrics,updated_at=excluded.updated_at",
          )
          .bind(code, revision.get(code), ANALYTICS_VERSION, JSON.stringify(figures), now),
      );
    }
  }
  const counted = new Set(rooms.map((room) => room.code));
  for (const code of cache.keys())
    if (!counted.has(code)) writes.push(db.prepare("DELETE FROM game_analytics_cache WHERE code=?").bind(code));
  for (let i = 0; i < writes.length; i += 50) await db.batch(writes.slice(i, i + 50));
  return {
    version: ANALYTICS_VERSION,
    asOf: Date.now(),
    scope: "current-shared-campaigns",
    sharedCampaigns: rooms.length,
    metrics,
    recounted: changed.length,
  };
}

export async function publicAnalytics(db) {
  const snapshot = await siteGameAnalytics(db);
  return {
    version: snapshot.version,
    asOf: snapshot.asOf,
    scope: snapshot.scope,
    metrics: publicGameMetrics(snapshot.metrics),
  };
}

export async function ownerAnalytics(db, userId) {
  if ((await roleOf(db, userId)) !== "owner")
    throw Object.assign(Error("Owner access is required."), { status: 403 });
  return siteGameAnalytics(db);
}
