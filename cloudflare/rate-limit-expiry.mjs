// Expires stale rate-limit rows (2026-10-21 audit M01 remainder). These rows are throttling
// state, not history: each one only matters inside its own short window, and a row that is
// gone behaves exactly like a fresh counter. Campaign and monitoring history are untouched.
//
// - library_limits: account request counters (accounts.mjs rateLimit), keyed by a hashed IP,
//   a hashed account id or a hashed signed-in IP, with `window` = the current minute number.
//   Only the current minute is ever read.
// - rateLimit: Better Auth's own per-IP counter (storage "database", 60 s window), with
//   `lastRequest` in milliseconds.
// - signin_throttle: per-email failed sign-in counter (signin-throttle.mjs), keyed by a hashed
//   email. A row whose last failure is older than SIGNIN_THROTTLE.resetAfterMs (24 h) no longer
//   counts and whose wait has ended changes nothing, so it is deleted.
import { SIGNIN_THROTTLE } from "./signin-throttle.mjs";

const MINUTE = 60_000;
/** Rows are kept this long past their last use; far longer than either 60 s window. */
export const RATE_LIMIT_RETENTION_MS = 60 * MINUTE;

/** The minute cron runs the expiry once an hour, on this minute of the hour. */
export const RATE_LIMIT_EXPIRY_MINUTE = 17;

/** Deletes rate-limit rows unused for RATE_LIMIT_RETENTION_MS; returns rows removed per table. */
export async function expireRateLimits(db, now = Date.now()) {
  const cutoff = now - RATE_LIMIT_RETENTION_MS;
  const [library, auth, signin] = await db.batch([
    db.prepare("DELETE FROM library_limits WHERE window < ?").bind(Math.floor(cutoff / MINUTE)),
    db.prepare('DELETE FROM "rateLimit" WHERE "lastRequest" < ?').bind(cutoff),
    db
      .prepare("DELETE FROM signin_throttle WHERE last_attempt_at < ? AND blocked_until <= ?")
      .bind(now - SIGNIN_THROTTLE.resetAfterMs, now),
  ]);
  return {
    library_limits: library.meta.changes,
    rateLimit: auth.meta.changes,
    signin_throttle: signin.meta.changes,
  };
}

/** Hourly from the minute cron; a missed run is simply caught up by the next one. */
export function rateLimitExpiryDue(scheduledAt) {
  return Math.floor(scheduledAt / MINUTE) % 60 === RATE_LIMIT_EXPIRY_MINUTE;
}
