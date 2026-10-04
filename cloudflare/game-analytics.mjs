import {
  ANALYTICS_VERSION,
  addMetrics,
  campaignAnalytics,
  emptyMetrics,
  publicGameMetrics,
} from "../src/lib/quire/analytics.ts";
import { roleOf } from "./members.mjs";

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
  let after = "",
    sharedCampaigns = 0;
  // Keyset pagination, projecting table data only; never deserialize room tokens or chats.
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT code,
      json_extract(body, '$.table.ledger') AS ledger,
      json_extract(body, '$.table.purses') AS purses,
      json_extract(body, '$.table.holdings') AS holdings,
      json_extract(body, '$.table.journal') AS journal
      FROM campaign_rooms WHERE code > ? AND COALESCE(json_extract(body, '$.testMode'), 0) = 0 ORDER BY code LIMIT 100`,
      )
      .bind(after)
      .all();
    for (const row of results) {
      addMetrics(
        metrics,
        campaignAnalytics({
          ledger: JSON.parse(row.ledger || "[]"),
          purses: JSON.parse(row.purses || "[]"),
          holdings: JSON.parse(row.holdings || "[]"),
          journal: JSON.parse(row.journal || "null"),
        }),
      );
      sharedCampaigns++;
      after = row.code;
    }
    if (results.length < 100) break;
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
