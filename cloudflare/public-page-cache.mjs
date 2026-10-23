// Edge cache for the public website pages (website design review W6).
// The public pages render the same HTML for every visitor without cookies, but the app server
// rebuilds them on each request (about 780 ms before the first byte on 2026-10-23). This keeps a
// copy at Cloudflare's edge for a few minutes. It is used only when:
// - the request is a GET for one of the public pages, with no query string and an HTML Accept;
// - the visitor sends no cookies, so a signed-in or returning browser always gets a fresh render;
// - the Worker runs on a custom domain (the Cache API does nothing on workers.dev).
// The cache key includes the deployed Worker version, so a release never serves an older page.
import { publicPageMeta } from "../src/lib/deployment/public-urls.mjs";

export const PUBLIC_PAGE_CACHE_SECONDS = 300;

/** @param {Request} request */
export function publicPageCacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.search || !publicPageMeta(url.pathname)) return false;
  if (url.pathname !== url.pathname.replace(/\/+$/, "") && url.pathname !== "/") return false;
  if (request.headers.get("cookie")) return false;
  if (request.headers.get("authorization")) return false;
  return String(request.headers.get("accept") ?? "").includes("text/html");
}

/** @param {Request} request @param {string} version */
export function publicPageCacheKey(request, version) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}?__lootsplit_release=${encodeURIComponent(version || "unknown")}`, {
    method: "GET",
  });
}

/**
 * Serve a cached public page, or render it and store a copy.
 * @param {Request} request
 * @param {{ CF_VERSION_METADATA?: { id?: string } }} env
 * @param {{ waitUntil(p: Promise<unknown>): void }} context
 * @param {() => Promise<Response>} render
 * @param {{ default: Cache } | undefined} [cacheStorage]
 * @returns {Promise<Response>}
 */
export async function cachedPublicPage(request, env, context, render, cacheStorage = globalThis.caches) {
  const cache = cacheStorage?.default;
  const version = env.CF_VERSION_METADATA?.id;
  if (!cache || !version || !publicPageCacheable(request)) return render();
  const key = publicPageCacheKey(request, version);
  const hit = await cache.match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set("X-Lootsplit-Page-Cache", "hit");
    response.headers.delete("Cache-Control");
    return response;
  }
  const response = await render();
  if (
    response.status === 200 &&
    String(response.headers.get("content-type") ?? "").includes("text/html") &&
    !response.headers.has("set-cookie")
  ) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set("Cache-Control", `public, max-age=${PUBLIC_PAGE_CACHE_SECONDS}`);
    context.waitUntil(cache.put(key, copy));
  }
  return response;
}
