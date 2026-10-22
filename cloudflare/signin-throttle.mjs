// Per-account sign-in throttling (2026-10-21 audit S05). Owner decision 2026-10-22: "slow down,
// don't lock". Repeated failed sign-ins for one email address earn progressively longer waits,
// capped at SIGNIN_THROTTLE.maxDelayMs; once a wait ends the correct password always works.
//
// Enumeration safety: the key is the normalized email, whether or not an account uses it, and
// every step (reserve, count, wait) is identical for registered and unregistered addresses.
// Only a successful sign-in, which needs the right password, clears the state early.
//
// Each attempt is reserved (counted) before the password is checked, with a compare-and-set
// write, so parallel requests cannot all slip through before a failure is recorded. Attempts
// whose password was never checked (validation errors, the per-IP limiter, server errors) are
// refunded afterwards. The per-IP limits in accounts.mjs still apply first.

export const SIGNIN_THROTTLE = Object.freeze({
  /** Consecutive failures allowed with no wait (typos, a forgotten caps lock). */
  freeFailures: 4,
  /** Wait after the first failure beyond the free ones; doubles per further failure. */
  baseDelayMs: 30_000,
  /** Longest wait, however many failures. */
  maxDelayMs: 15 * 60_000,
  /** Failures older than this are forgotten, so the count starts again. */
  resetAfterMs: 24 * 60 * 60_000,
});

/** Wait imposed after the `failures`-th consecutive failed attempt. */
export function signinDelay(failures) {
  const extra = failures - SIGNIN_THROTTLE.freeFailures;
  if (extra <= 0) return 0;
  return Math.min(SIGNIN_THROTTLE.maxDelayMs, SIGNIN_THROTTLE.baseDelayMs * 2 ** (extra - 1));
}

/** Throttle key for an email address as submitted; null when there is no usable address. */
export async function signinKey(email) {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return null;
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("signin:" + normalized)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Counts one attempt for `key` unless a wait is in force.
 * Returns `{ ok: true, ticket }` (pass the ticket to settleSigninAttempt) or
 * `{ ok: false, retryAfterMs }`.
 */
export async function reserveSigninAttempt(db, key, now = Date.now()) {
  for (let tries = 0; tries < 5; tries++) {
    const row = await db
      .prepare("SELECT failures,last_attempt_at,blocked_until FROM signin_throttle WHERE key=?")
      .bind(key)
      .first();
    if (row && row.blocked_until > now) return { ok: false, retryAfterMs: row.blocked_until - now };
    const prior =
      row && now - row.last_attempt_at <= SIGNIN_THROTTLE.resetAfterMs ? row.failures : 0;
    const failures = prior + 1;
    const blocked = now + signinDelay(failures);
    const write = row
      ? db
          .prepare(
            "UPDATE signin_throttle SET failures=?,last_attempt_at=?,blocked_until=? WHERE key=? AND failures=? AND last_attempt_at=? AND blocked_until=?",
          )
          .bind(failures, now, blocked, key, row.failures, row.last_attempt_at, row.blocked_until)
      : db
          .prepare(
            "INSERT INTO signin_throttle (key,failures,last_attempt_at,blocked_until) VALUES (?,?,?,?) ON CONFLICT(key) DO NOTHING",
          )
          .bind(key, failures, now, blocked);
    const result = await write.run();
    if (result.meta.changes)
      return { ok: true, ticket: { key, failures, at: now, blocked, previous: row ?? null } };
    // Another attempt for the same address changed the row first; read it again.
  }
  return { ok: false, retryAfterMs: 1000 };
}

/**
 * Records the outcome of a reserved attempt from the sign-in response status:
 * success clears the state, 401 (wrong email or password) keeps the counted failure, and
 * anything else means the password was not checked, so the attempt is refunded.
 */
export async function settleSigninAttempt(db, ticket, status) {
  if (status >= 200 && status < 300) {
    await db.prepare("DELETE FROM signin_throttle WHERE key=?").bind(ticket.key).run();
    return;
  }
  if (status === 401) return;
  const { key, failures, at, blocked, previous } = ticket;
  // Only undo our own reservation; a later attempt that already moved the row stays as it is.
  if (previous)
    await db
      .prepare(
        "UPDATE signin_throttle SET failures=?,last_attempt_at=?,blocked_until=? WHERE key=? AND failures=? AND last_attempt_at=? AND blocked_until=?",
      )
      .bind(
        previous.failures,
        previous.last_attempt_at,
        previous.blocked_until,
        key,
        failures,
        at,
        blocked,
      )
      .run();
  else
    await db
      .prepare(
        "DELETE FROM signin_throttle WHERE key=? AND failures=? AND last_attempt_at=? AND blocked_until=?",
      )
      .bind(key, failures, at, blocked)
      .run();
}

/** The same message for every address, so the reply shows nothing about account existence. */
export function signinWaitMessage(retryAfterMs) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const wait =
    seconds < 90
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${Math.ceil(seconds / 60)} minutes`;
  return `Too many unsuccessful sign-ins for this email. Wait ${wait}, then try again. Waits grow with each wrong password, up to ${SIGNIN_THROTTLE.maxDelayMs / 60_000} minutes; signing in successfully resets them.`;
}

/** Wraps an email sign-in: throttle check, the real handler, then the outcome. */
export async function throttledSignin(db, email, signIn, now = Date.now) {
  const key = await signinKey(email);
  if (!key) return signIn();
  const reserved = await reserveSigninAttempt(db, key, now());
  if (!reserved.ok)
    return Response.json(
      { error: signinWaitMessage(reserved.retryAfterMs) },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": String(Math.max(1, Math.ceil(reserved.retryAfterMs / 1000))),
        },
      },
    );
  let response;
  try {
    response = await signIn();
  } catch (error) {
    await settleSigninAttempt(db, reserved.ticket, 500).catch(() => {});
    throw error;
  }
  // A failure to record the outcome must not turn a completed sign-in into an error.
  await settleSigninAttempt(db, reserved.ticket, response.status).catch(() => {});
  return response;
}
