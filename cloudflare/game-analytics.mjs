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
import { readRoomTables } from "./room-storage.mjs";

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

async function collect(db) {
  const metrics = emptyMetrics();
  let sharedCampaigns = 0;
  // One room at a time, projecting table data only; never deserialize room tokens or chats. A
  // sectioned room reads only the sections holding these fields (room-storage.mjs).
  for await (const { code, fields: row } of readRoomTables(db, ["ledger", "purses", "holdings", "journal"], {
    where: `COALESCE(json_extract(body, '$.testMode'), 0) = 0 AND ${notProbeRoom()}`,
  })) {
    addMetrics(
      metrics,
      campaignAnalytics({
        ledger: JSON.parse(row.ledger || "[]"),
        purses: JSON.parse(row.purses || "[]"),
        holdings: JSON.parse(row.holdings || "[]"),
        // Archived session snapshots are stored beside the room row (room-reports.mjs).
        journal: (await hydrateRoomReports(db, code, { journal: JSON.parse(row.journal || "null") }))
          .journal,
      }),
    );
    sharedCampaigns++;
  }
  return {
    version: ANALYTICS_VERSION,
    asOf: Date.now(),
    scope: "current-shared-campaigns",
    sharedCampaigns,
    metrics,
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
