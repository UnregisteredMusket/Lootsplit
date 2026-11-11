// Credential allowances beyond the per-minute account limits (audit 2026-11-10 H1 and H5,
// owner decisions 2026-11-11). Both count per network (signin-throttle.mjs signinNetwork: an IPv4
// address, or the /64 of an IPv6 address) in the existing library_limits counters.
//
// H1 — installed-app credential requests. The Turnstile human check cannot run in the Android app
// (its pages are https://localhost, which the widget does not allow), so a request claiming an app
// origin skips it, and a script can send that header. App-origin sign-ups and sign-ins therefore
// get a much smaller allowance per network than the website's 60 requests a minute:
//
// - Sign-ups: APP_CREDENTIAL_LIMITS.signUpsPerDay (5) per network per UTC day. One person signs up
//   once; five covers a table of players creating accounts on one home Wi-Fi in an evening. A
//   script needs a new network for every five accounts.
// - Sign-ins and recovery-key resets: APP_CREDENTIAL_LIMITS.signInsPerHour (20) per network per
//   hour. App sessions last 30 days and the owner widget has its own year-long session (it never
//   signs in with a password), so normal use is a few a month; twenty leaves room for a household
//   and typing mistakes, while a script gets 480 guesses a day per network instead of 86,400.
//
// The website (with the human check) is unchanged. Refused requests answer 429 with Retry-After.
//
// H5 — sign-up told anyone whether an email was registered (Better Auth answers 422
// USER_ALREADY_EXISTS…). Each network may receive DUPLICATE_SIGNUP_REPLIES_PER_DAY (3) such replies
// per UTC day, from the website or the app; after that every sign-up from that network is refused
// with the same generic message until the day ends, whether or not the email is registered, so
// further probing learns nothing.
//
// Counters live in library_limits (key, window, hits). `window` is the minute number at which the
// counting window ends, so rate-limit-expiry.mjs (which deletes rows whose window is more than an
// hour in the past) only removes a row an hour after its window has closed.
import { keyedDigest, signinNetwork } from "./signin-throttle.mjs";

export const APP_CREDENTIAL_LIMITS = Object.freeze({ signUpsPerDay: 5, signInsPerHour: 20 });
export const DUPLICATE_SIGNUP_REPLIES_PER_DAY = 3;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SIGN_UP = "/api/account/auth/sign-up/email";
const SIGN_IN = "/api/account/auth/sign-in/email";
const RECOVER = "/api/account/recover";

// Keys are HMAC-SHA-256 of the network with the server secret (ACCOUNT_SECRET), never the network
// itself, so stored counters do not reveal which networks signed up or signed in.
const networkKey = (secret, ip) => keyedDigest(secret, "credential-net:" + signinNetwork(ip));
/** The window containing `now` of length `size`: its end, as a minute number and in ms. */
const windowEnd = (now, size) => {
  const end = (Math.floor(now / size) + 1) * size;
  return { minute: end / MINUTE, at: end };
};
const refuse = (message, retryAfterMs) => {
  throw Object.assign(new Error(message), {
    status: 429,
    retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  });
};
function hit(db, key, window) {
  return db
    .prepare(
      "INSERT INTO library_limits (key, window, hits) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window=excluded.window, hits=CASE WHEN library_limits.window=excluded.window THEN library_limits.hits+1 ELSE 1 END RETURNING hits",
    )
    .bind(key, window)
    .first();
}

/**
 * Counts an app-origin (no human check) sign-up, sign-in or recovery-key reset against its
 * network's allowance; throws a 429 account error past it. Other paths are not counted.
 */
export async function appCredentialAllowance(db, path, ip, now = Date.now(), secret) {
  const signUp = path === SIGN_UP;
  if (!signUp && path !== SIGN_IN && path !== RECOVER) return;
  const network = await networkKey(secret, ip);
  const window = windowEnd(now, signUp ? DAY : HOUR);
  const row = await hit(db, `${signUp ? "app-signup" : "app-signin"}:${network}`, window.minute);
  if (signUp && row.hits > APP_CREDENTIAL_LIMITS.signUpsPerDay)
    refuse(
      `This network has created ${APP_CREDENTIAL_LIMITS.signUpsPerDay} accounts in the app today. Try again tomorrow, or sign up on lootsplitter.com.`,
      window.at - now,
    );
  if (!signUp && row.hits > APP_CREDENTIAL_LIMITS.signInsPerHour)
    refuse(
      "Too many sign-ins from this network in the app. Wait an hour, or sign in on lootsplitter.com.",
      window.at - now,
    );
}

const duplicateKey = async (secret, ip) => `signup-duplicate:${await networkKey(secret, ip)}`;
const SIGNUP_PAUSED =
  "Too many sign-up attempts from this network today. If you already have an account, sign in instead; otherwise try again tomorrow.";

/**
 * Wraps an email sign-up (website or app): refuses it once its network has had its share of
 * "already registered" replies today, otherwise runs it. Each sign-up is counted before it runs,
 * so parallel requests cannot all slip past the cap, and refunded (refused ones included) unless
 * the reply said the email was already registered. During a burst, sign-ups still in flight
 * count, so some of the burst may be asked to wait; nothing stays counted afterwards.
 */
export async function limitedSignup(db, email, ip, signUp, now = Date.now, secret) {
  const at = now();
  const window = windowEnd(at, DAY);
  const key = await duplicateKey(secret, ip);
  const row = await hit(db, key, window.minute);
  let duplicate = false;
  try {
    // A refused attempt is refunded too (finally below): only replies that said "already
    // registered" stay counted, so a burst of new sign-ups cannot leave the network refused.
    if (row.hits > DUPLICATE_SIGNUP_REPLIES_PER_DAY) refuse(SIGNUP_PAUSED, window.at - at);
    const response = await signUp();
    // Better Auth answers an existing email with 422 USER_ALREADY_EXISTS…; the user row confirms
    // it whatever the reply's wording (Better Auth stores emails lower-cased).
    duplicate =
      response.status === 422 &&
      typeof email === "string" &&
      !!(await db
        .prepare("SELECT 1 FROM user WHERE email=?")
        .bind(email.trim().toLowerCase())
        .first());
    return response;
  } finally {
    if (!duplicate)
      await db
        .prepare("UPDATE library_limits SET hits=hits-1 WHERE key=? AND window=? AND hits>0")
        .bind(key, window.minute)
        .run()
        .catch(() => {});
  }
}
