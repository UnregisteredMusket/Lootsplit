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
 * (clickjacking of owner/staff controls).
 *
 * Script policy (audit S04 remainder, 2026-10-22). Inline script audit of the served app:
 * - TanStack Start's <Scripts/> writes per-request inline hydration/stream scripts
 *   (`$_TSR` router state). Their content differs per response, so hashes cannot list them,
 *   and the server renderer gives the Worker no nonce hook; 'unsafe-inline' keeps them running.
 * - No other inline scripts or inline event handlers ship: React renders none, the app has no
 *   dangerouslySetInnerHTML, and the PWA head middleware adds only meta/link tags. The Grok
 *   extension script is the only script tag it can add, it stays off (VITE_GROK_EXTENSIONS=0),
 *   and grok.com is not an allowed script source, so it could not run even if re-enabled.
 * - Every script file is same-origin: Vite bundles in /assets, the pdf.js module worker,
 *   the self-hosted OCR worker and cores in /ocr/v7, and the notification service worker.
 * - Tesseract starts its worker from a blob: URL and compiles WebAssembly, so workers allow
 *   blob: and scripts allow 'wasm-unsafe-eval' (WebAssembly only, not string eval).
 * So `script-src` blocks every third-party or injected external script, string eval
 * (libraries such as pdf.js and Zod probe for it and fall back), and `script-src-attr 'none'`
 * blocks inline event-handler attributes. Android bundles its own files and is unaffected.
 */
// challenges.cloudflare.com serves the Turnstile human check on the sign-in form (owner request
// 2026-10-23); it is the only external script host.
export const TURNSTILE_SCRIPT_ORIGIN = "https://challenges.cloudflare.com";
export const SCRIPT_POLICY =
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${TURNSTILE_SCRIPT_ORIGIN}; script-src-attr 'none'; worker-src 'self' blob:`;
export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": `frame-ancestors 'self'; object-src 'none'; base-uri 'self'; ${SCRIPT_POLICY}`,
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
});
