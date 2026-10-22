// Expires stale rate-limit rows (2026-10-21 audit M01 remainder). These rows are throttling
// state, not history: each one only matters inside its own short window, and a row that is
// gone behaves exactly like a fresh counter. Campaign and monitoring history are untouched.
//
// - library_limits: per-IP account request counter (accounts.mjs rateLimit), keyed by a hashed
//   IP with `window` = the current minute number. Only the current minute is ever read.
// - rateLimit: Better Auth's own per-IP counter (storage "database", 60 s window), with
//   `lastRequest` in milliseconds.

const MINUTE = 60_000;
/** Rows are kept this long past their last use; far longer than either 60 s window. */
export const RATE_LIMIT_RETENTION_MS = 60 * MINUTE;

/** The minute cron runs the expiry once an hour, on this minute of the hour. */
export const RATE_LIMIT_EXPIRY_MINUTE = 17;

/** Deletes rate-limit rows unused for RATE_LIMIT_RETENTION_MS; returns rows removed per table. */
export async function expireRateLimits(db, now = Date.now()) {
  const cutoff = now - RATE_LIMIT_RETENTION_MS;
  const [library, auth] = await db.batch([
    db.prepare("DELETE FROM library_limits WHERE window < ?").bind(Math.floor(cutoff / MINUTE)),
    db.prepare('DELETE FROM "rateLimit" WHERE "lastRequest" < ?').bind(cutoff),
  ]);
  return { library_limits: library.meta.changes, rateLimit: auth.meta.changes };
}

/** Hourly from the minute cron; a missed run is simply caught up by the next one. */
export function rateLimitExpiryDue(scheduledAt) {
  return Math.floor(scheduledAt / MINUTE) % 60 === RATE_LIMIT_EXPIRY_MINUTE;
}
