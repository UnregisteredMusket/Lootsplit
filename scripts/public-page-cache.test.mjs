import test from "node:test";
import assert from "node:assert/strict";
import { cachedPublicPage, publicPageCacheable, publicPageCacheKey } from "../cloudflare/public-page-cache.mjs";

const html = { accept: "text/html,application/xhtml+xml" };
const req = (path, headers = html, method = "GET") => new Request("https://lootsplitter.com" + path, { method, headers });

function memoryCache() {
  const store = new Map();
  return {
    store,
    default: {
      async match(key) {
        const hit = store.get(key.url);
        return hit ? hit.clone() : undefined;
      },
      async put(key, response) {
        store.set(key.url, new Response(await response.text(), response));
      },
    },
  };
}

test("only anonymous HTML GETs of public pages are cacheable", () => {
  assert.equal(publicPageCacheable(req("/welcome")), true);
  assert.equal(publicPageCacheable(req("/downloads")), true);
  for (const [path, headers, method] of [
    ["/welcome", { ...html, cookie: "lootsplit-app=1" }, "GET"],
    ["/welcome", { ...html, authorization: "Bearer x" }, "GET"],
    ["/welcome?x=1", html, "GET"],
    ["/welcome/", html, "GET"],
    ["/welcome", html, "POST"],
    ["/welcome", { accept: "application/json" }, "GET"],
    ["/", html, "GET"],
    ["/account", html, "GET"],
    ["/share", html, "GET"],
  ])
    assert.equal(publicPageCacheable(req(path, headers, method)), false, `${method} ${path} ${JSON.stringify(headers)}`);
});

test("cache key carries the deployed version, so a release never serves an older page", () => {
  assert.notEqual(publicPageCacheKey(req("/welcome"), "v1").url, publicPageCacheKey(req("/welcome"), "v2").url);
});

test("renders once, then serves the stored copy until the version changes", async () => {
  const caches = memoryCache();
  const waits = [];
  const context = { waitUntil: (p) => waits.push(p) };
  let renders = 0;
  const render = async () => {
    renders++;
    return new Response(`<html>page ${renders}</html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache" } });
  };
  const env = { CF_VERSION_METADATA: { id: "v1" } };
  const first = await cachedPublicPage(req("/welcome"), env, context, render, caches);
  assert.equal(await first.text(), "<html>page 1</html>");
  await Promise.all(waits);
  const second = await cachedPublicPage(req("/welcome"), env, context, render, caches);
  assert.equal(await second.text(), "<html>page 1</html>");
  assert.equal(second.headers.get("x-lootsplit-page-cache"), "hit");
  assert.equal(second.headers.get("cache-control"), null, "browser caching is left to releaseResponse");
  assert.equal(renders, 1);
  const next = await cachedPublicPage(req("/welcome"), { CF_VERSION_METADATA: { id: "v2" } }, context, render, caches);
  assert.equal(await next.text(), "<html>page 2</html>");
  const signedIn = await cachedPublicPage(req("/welcome", { ...html, cookie: "a=b" }), env, context, render, caches);
  assert.equal(await signedIn.text(), "<html>page 3</html>");
});

test("errors, non-HTML and responses that set cookies are never stored", async () => {
  for (const response of [
    new Response("x", { status: 500, headers: { "content-type": "text/html" } }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("x", { headers: { "content-type": "text/html", "set-cookie": "a=b" } }),
  ]) {
    const caches = memoryCache();
    const waits = [];
    await cachedPublicPage(req("/help"), { CF_VERSION_METADATA: { id: "v1" } }, { waitUntil: (p) => waits.push(p) }, async () => response, caches);
    await Promise.all(waits);
    assert.equal(caches.store.size, 0);
  }
  // No version or no Cache API (workers.dev, tests): always renders.
  let rendered = 0;
  await cachedPublicPage(req("/help"), {}, { waitUntil() {} }, async () => (rendered++, new Response("x")), memoryCache());
  await cachedPublicPage(req("/help"), { CF_VERSION_METADATA: { id: "v1" } }, { waitUntil() {} }, async () => (rendered++, new Response("x")), {});
  assert.equal(rendered, 2);
});
