/** Public addresses only. Keep the native endpoint independent of future website moves. */
export const deploymentOrigins = Object.freeze({
  website: "https://lootsplit.oliverstorie2017.workers.dev",
  nativeApi: "https://lootsplit.oliverstorie2017.workers.dev",
  legacy: Object.freeze(["https://lootsplit.oliverstorie2017.workers.dev"]),
});
/** @param {unknown} value @param {boolean} [allowLoopback] */
export function validateOrigin(value, allowLoopback = false) {
  if (typeof value !== "string") throw Error("An explicit origin is required.");
  const u = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (value !== u.origin || u.username || u.password || (u.protocol !== "https:" && !(allowLoopback && loopback && u.protocol === "http:")) || u.hostname.includes("*") || (!allowLoopback && loopback))
    throw Error("Use an exact HTTPS origin without credentials, path, query or fragment.");
  return u.origin;
}
/** Explicitly configured hosts only; forwarded headers never select the auth origin.
 * @param {{ACCOUNT_ORIGIN?: unknown, ACCOUNT_LEGACY_ORIGINS?: unknown}} env
 * @param {string} requestUrl
 */
export function accountRequestOrigin(env, requestUrl) {
  const primary = validateOrigin(env.ACCOUNT_ORIGIN, true);
  const legacy = env.ACCOUNT_LEGACY_ORIGINS === undefined || env.ACCOUNT_LEGACY_ORIGINS === "" ? []
    : typeof env.ACCOUNT_LEGACY_ORIGINS === "string" ? env.ACCOUNT_LEGACY_ORIGINS.split(",").map((v) => validateOrigin(v.trim(), true))
    : (() => { throw Error("Legacy origins must be an explicit comma-separated list."); })();
  const origin = new URL(requestUrl).origin;
  if (![primary, ...legacy].includes(origin)) throw Error("Account request host is not approved.");
  return origin;
}
for (const value of [deploymentOrigins.website, deploymentOrigins.nativeApi, ...deploymentOrigins.legacy]) validateOrigin(value);
