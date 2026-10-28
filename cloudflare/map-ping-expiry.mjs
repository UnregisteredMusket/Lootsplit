// Expires transient map pings (2026-10-28 live-campaign load audit, F6). Pings live 5 seconds and
// are not campaign data, history or backups (migration 0014). Reads already ignore expired rows
// (`expires_at > now`); this only reclaims space. It runs from the minute cron and before a new
// ping is inserted, never on the per-second read path.

/**
 * Deletes pings whose expiry has passed, across rooms; returns the number of rows removed.
 * @param {{ prepare(query: string): { bind(...values: unknown[]): { run(): Promise<{ meta: { changes: number } }> } } }} db
 * @param {number} [now]
 */
export async function expireMapPings(db, now = Date.now()) {
  const result = await db
    .prepare("DELETE FROM campaign_map_pings WHERE expires_at<=?")
    .bind(now)
    .run();
  return result.meta.changes;
}
