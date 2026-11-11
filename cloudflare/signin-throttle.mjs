// Sign-in throttling (2026-10-21 audit S05). Owner decision 2026-10-22: "slow down, don't lock".
// Repeated failed sign-ins earn progressively longer waits, capped at SIGNIN_THROTTLE.maxDelayMs;
// once a wait ends the correct password always works.
//
// Keys (audit 2026-11-10 H3, owner decision 2026-11-11): the wait is keyed on the email plus the
// network the attempt comes from (the IPv4 address, or the /64 of an IPv6 address). Keyed on the
// email alone, an outsider sending one wrong password as each wait ended kept the real owner out
// indefinitely. A second, email-only counter records failures from every network; past its much
// higher ceiling (SIGNIN_THROTTLE.emailCeiling in 24 hours) the address counts as under attack and
// every network waits from its first failure, up to SIGNIN_THROTTLE.pressedMaxDelayMs. That slows a
// distributed attack without an email-wide wait, which a handful of networks could hold forever:
// a network with no failures for the address is never made to wait, so the owner still signs in.
//
// Enumeration safety: keys are hashes of the normalized email (and network), whether or not an
// account uses it, and every step (reserve, count, wait) is identical for registered and
// unregistered addresses. Only a successful sign-in, which needs the right password, clears the
// network's state early; the email-only count ends a day after its last failure.
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
  /**
   * Failed sign-ins for one email from all networks within resetAfterMs after which the address
   * is under attack. One network alone reaches about 106 a day at the 15-minute cap, and a person
   * mistyping from a few devices reaches a handful, so 200 means several networks are guessing.
   */
  emailCeiling: 200,
  /** Free failures per network while the address is under attack. */
  pressedFreeFailures: 0,
  /** Longest wait per network while the address is under attack. */
  pressedMaxDelayMs: 60 * 60_000,
});

/**
 * Wait imposed after a network's `failures`-th consecutive failed attempt; `pressed` while the
 * address is under attack (more than SIGNIN_THROTTLE.emailCeiling failures from all networks).
 */
export function signinDelay(failures, pressed = false) {
  const free = pressed ? SIGNIN_THROTTLE.pressedFreeFailures : SIGNIN_THROTTLE.freeFailures;
  const cap = pressed ? SIGNIN_THROTTLE.pressedMaxDelayMs : SIGNIN_THROTTLE.maxDelayMs;
  const extra = failures - free;
  if (extra <= 0) return 0;
  return Math.min(cap, SIGNIN_THROTTLE.baseDelayMs * 2 ** (extra - 1));
}

/**
 * The network an address belongs to: an IPv4 address as is, an IPv6 address as its /64 (one
 * household or phone usually holds a whole /64), an IPv4-mapped IPv6 address as its IPv4 address.
 * A missing address (local development) is one network, "unknown".
 */
export function signinNetwork(ip) {
  const value = typeof ip === "string" ? ip.trim().toLowerCase() : "";
  if (!value) return "unknown";
  if (!value.includes(":")) return value;
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const [head, tail] = value.split("::", 2);
  const front = head ? head.split(":") : [];
  const back = tail === undefined ? null : tail ? tail.split(":") : [];
  const groups = back
    ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back]
    : front;
  return (
    groups
      .slice(0, 4)
      .map((g) => (Number.parseInt(g, 16) || 0).toString(16))
      .join(":") + "::/64"
  );
}

/**
 * Throttle key for an email address as submitted, and for one network when `network` is given;
 * null when there is no usable address. The email-only key is the one used before H3, so a
 * deploy carries existing counts over as the email-wide count.
 */
export async function signinKey(email, network) {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return null;
  const input =
    network === undefined ? "signin:" + normalized : "signin-net:" + network + "\n" + normalized;
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether the address is under attack: email-wide failures within a day at or past the ceiling. */
async function emailPressed(db, emailKey, now) {
  const row = await db
    .prepare("SELECT failures,last_attempt_at FROM signin_throttle WHERE key=?")
    .bind(emailKey)
    .first();
  return (
    !!row &&
    now - row.last_attempt_at <= SIGNIN_THROTTLE.resetAfterMs &&
    row.failures >= SIGNIN_THROTTLE.emailCeiling
  );
}

/** Counts one failed sign-in for the email from any network (no wait is stored on this row). */
function recordEmailFailure(db, emailKey, now) {
  return db
    .prepare(
      "INSERT INTO signin_throttle (key,failures,last_attempt_at,blocked_until) VALUES (?,1,?,0) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN excluded.last_attempt_at-signin_throttle.last_attempt_at>? THEN 1 ELSE signin_throttle.failures+1 END,last_attempt_at=excluded.last_attempt_at,blocked_until=0",
    )
    .bind(emailKey, now, SIGNIN_THROTTLE.resetAfterMs)
    .run();
}

/**
 * Counts one attempt for `key` unless a wait is in force.
 * Returns `{ ok: true, ticket }` (pass the ticket to settleSigninAttempt) or
 * `{ ok: false, retryAfterMs }`.
 */
export async function reserveSigninAttempt(db, key, now = Date.now(), pressed = false) {
  for (let tries = 0; tries < 5; tries++) {
    const row = await db
      .prepare("SELECT failures,last_attempt_at,blocked_until FROM signin_throttle WHERE key=?")
      .bind(key)
      .first();
    if (row && row.blocked_until > now) return { ok: false, retryAfterMs: row.blocked_until - now };
    const prior =
      row && now - row.last_attempt_at <= SIGNIN_THROTTLE.resetAfterMs ? row.failures : 0;
    const failures = prior + 1;
    const blocked = now + signinDelay(failures, pressed);
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
  if (status === 401) {
    if (ticket.emailKey) await recordEmailFailure(db, ticket.emailKey, ticket.at);
    return;
  }
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
export function signinWaitMessage(retryAfterMs, pressed = false) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const wait =
    seconds < 90
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${Math.ceil(seconds / 60)} minutes`;
  const cap = (pressed ? SIGNIN_THROTTLE.pressedMaxDelayMs : SIGNIN_THROTTLE.maxDelayMs) / 60_000;
  return `Too many unsuccessful sign-ins for this email from your network. Wait ${wait}, then try again. Waits grow with each wrong password, up to ${cap} minutes; signing in successfully resets them.`;
}

/**
 * Wraps an email sign-in: throttle check, the real handler, then the outcome. `ip` is the
 * request's cf-connecting-ip; the wait applies to that network only (see the top of this file).
 */
export async function throttledSignin(db, email, signIn, now = Date.now, ip = null) {
  const emailKey = await signinKey(email);
  if (!emailKey) return signIn();
  const key = await signinKey(email, signinNetwork(ip));
  const at = now();
  const pressed = await emailPressed(db, emailKey, at);
  const reserved = await reserveSigninAttempt(db, key, at, pressed);
  if (reserved.ok) reserved.ticket.emailKey = emailKey;
  if (!reserved.ok)
    return Response.json(
      { error: signinWaitMessage(reserved.retryAfterMs, pressed) },
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
