/**
 * Cloudflare Turnstile human check on sign-up, sign-in and recovery-key password reset
 * (owner request 2026-10-23). The widget is "Lootsplitter" (Managed mode) for lootsplitter.com
 * and the legacy workers.dev host; its secret is the Worker secret TURNSTILE_SECRET_KEY.
 *
 * - Without the secret (development, CI, standby) the check is off and the client shows no widget.
 * - Installed Android apps (native origins) are exempt: their pages run on https://localhost, which
 *   the widget does not allow, and apps already in people's hands must keep signing in. The
 *   per-IP limits and the per-email sign-in throttle still apply to them.
 * - Tokens are verified with Siteverify, which also rejects a reused token; the hostname and the
 *   action must match. If Cloudflare cannot be reached the request is refused (fail closed).
 */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAFiT5gN0oltYprws";
export const CAPTCHA_HEADER = "x-captcha-response";
export const CAPTCHA_ACTIONS = Object.freeze({
  "/api/account/auth/sign-up/email": "signup",
  "/api/account/auth/sign-in/email": "signin",
  "/api/account/recover": "recover",
});
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

export function captchaRequired(env) {
  return typeof env?.TURNSTILE_SECRET_KEY === "string" && env.TURNSTILE_SECRET_KEY.length > 0;
}

/** What the sign-in form needs to know (never the secret). */
export function captchaConfig(env) {
  return captchaRequired(env)
    ? { required: true, siteKey: env.TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY }
    : { required: false, siteKey: "" };
}

/**
 * Verifies the Turnstile token on a protected request. Returns why the check was skipped, or
 * "verified". Throws a 400/403/503 account error otherwise.
 */
export async function verifyCaptcha(env, request, { path, native, hostnames, fetchImpl = fetch }) {
  const action = CAPTCHA_ACTIONS[path];
  if (!action || request.method !== "POST") return "not-protected";
  if (!captchaRequired(env)) return "not-configured";
  if (native) return "native-app";
  const token = request.headers.get(CAPTCHA_HEADER) || "";
  if (!token || token.length > 2048) fail("Complete the human check below, then try again.", 400);
  let result;
  try {
    const response = await fetchImpl(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") || "",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = await response.json();
  } catch {
    fail("The human check is unavailable right now. Please try again in a minute.", 503);
  }
  // Cloudflare's published testing secrets (local checks only) always answer "example.com".
  const testing = /^[123]x0+AA$/.test(env.TURNSTILE_SECRET_KEY);
  const hostOk = hostnames.includes(result?.hostname) || (testing && result?.hostname === "example.com");
  const actionOk = result?.action === action || (testing && !result?.action);
  if (!result?.success || !hostOk || !actionOk)
    fail("The human check did not pass. Please try it again.", 403);
  return "verified";
}
