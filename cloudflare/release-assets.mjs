// Build URLs belong to the asset binding, including URLs not in Nitro's snapshot.
// Keep this behind recoveryGuard: a fenced primary must remain fenced.
export async function serveBuildAsset(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/assets/") || !["GET", "HEAD"].includes(request.method)) return null;
  return releaseResponse(
    await env.ASSETS.fetch(request),
    env,
    path === "/assets/release-identity.json",
  );
}

export function releaseResponse(response, env, identity = false) {
  const result = new Response(response.body, response);
  // An unavailable asset must never inherit the one-year immutable asset policy.
  // HTML must revalidate so a cached document cannot retain obsolete bundle URLs.
  if (identity || response.status >= 400) result.headers.set("Cache-Control", "no-store");
  else if (
    response.headers.get("Content-Type")?.includes("text/html") &&
    !response.headers.get("Cache-Control")?.includes("no-store")
  )
    result.headers.set("Cache-Control", "private, no-cache");
  if (env.CF_VERSION_METADATA?.id)
    result.headers.set("X-Lootsplit-Worker-Version", env.CF_VERSION_METADATA.id);
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    if (!result.headers.has(name)) result.headers.set(name, value);
  return result;
}

/**
 * Baseline protections for every page and build asset. Framing is limited to Lootsplit itself
 * (clickjacking of owner/staff controls); no script policy is imposed here because the app loads
 * OCR workers/WebAssembly and existing integrations that a script policy must be verified against.
 */
export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
});
