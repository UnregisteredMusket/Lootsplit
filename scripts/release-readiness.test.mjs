import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inspectRelease, waitForRelease } from "./release-readiness.mjs";
import { releaseResponse, serveBuildAsset } from "../cloudflare/release-assets.mjs";

const js = "console.log('verified')";
const css = "body { color: green }";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = {
  commit: "a".repeat(40),
  files: {
    "assets/assets/app-new.js": hash(js),
    "assets/assets/style-new.css": hash(css),
  },
};
const origin = "https://lootsplit.example";
function fixture(overrides = {}) {
  return async (url) => {
    const path = new URL(url).pathname;
    if (overrides[path]) return overrides[path]();
    if (path.endsWith("release-identity.json")) return Response.json({ commit: manifest.commit });
    if (path === "/assets/app-new.js")
      return new Response(js, { headers: { "content-type": "text/javascript" } });
    if (path === "/assets/style-new.css")
      return new Response(css, { headers: { "content-type": "text/css" } });
    return new Response(
      '<script type="module" src="/assets/app-new.js"></script><link rel="stylesheet" href="/assets/style-new.css">',
      { headers: { "content-type": "text/html" } },
    );
  };
}
const inspect = (fetchImpl) =>
  inspectRelease({ origin, manifest, fetchImpl, signal: AbortSignal.timeout(1000) });

test("a matching release identity cannot pass when a new bundle is missing", async () => {
  const result = await inspect(
    fixture({ "/assets/app-new.js": () => new Response(null, { status: 404 }) }),
  );
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].path, "/assets/app-new.js");
  assert.equal(result.failures[0].status, 404);
});
test("readiness requires matching bytes, asset types and current HTML references", async () => {
  const result = await inspect(
    fixture({
      "/assets/app-new.js": () =>
        new Response("<html>fallback</html>", { headers: { "content-type": "text/html" } }),
      "/welcome": () =>
        new Response('<script src="/assets/obsolete.js"></script>', {
          headers: { "content-type": "text/html" },
        }),
    }),
  );
  assert.deepEqual(
    result.failures.map((item) => item.reason),
    [
      "Wrong asset content type",
      "Asset bytes differ from verified artifact",
      "Document references an asset outside the verified release",
    ],
  );
});
test("transient readiness failure is recorded before success; healthy releases need one probe", async () => {
  let requests = 0;
  const reports = [];
  const report = await waitForRelease({
    origin,
    manifest,
    intervalMs: 0,
    fetchImpl: fixture({
      "/assets/app-new.js": () =>
        ++requests === 1
          ? new Response(null, { status: 404 })
          : new Response(js, { headers: { "content-type": "text/javascript" } }),
    }),
    onReport: (value) => reports.push(structuredClone(value)),
  });
  assert.equal(report.attempts.length, 2);
  assert.equal(reports[0].ready, false);
  assert.equal(report.ready, true);
  assert.equal(
    (await waitForRelease({ origin, manifest, fetchImpl: fixture() })).attempts.length,
    1,
  );
});
test("persistent missing assets fail closed with exact URL; auth denial is not retried", async () => {
  const reports = [];
  await assert.rejects(
    waitForRelease({
      origin,
      manifest,
      intervalMs: 0,
      maxAttempts: 2,
      fetchImpl: fixture({ "/assets/app-new.js": () => new Response(null, { status: 404 }) }),
      onReport: (value) => reports.push(structuredClone(value)),
    }),
    /app-new\.js.*404/,
  );
  assert.equal(reports.length, 2);
  let requests = 0;
  await assert.rejects(
    waitForRelease({
      origin,
      manifest,
      intervalMs: 0,
      fetchImpl: async () => {
        requests++;
        return new Response(null, { status: 403 });
      },
    }),
    /403/,
  );
  assert.equal(requests, 1);
});
test("build routing uses ASSETS for an unknown chunk and preserves GET/HEAD semantics", async () => {
  const requests = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        requests.push(request);
        return new Response(null, { status: 200 });
      },
    },
  };
  for (const method of ["GET", "HEAD"]) {
    const request = new Request(`${origin}/assets/newer-than-server.js?q=1`, { method });
    assert.equal((await serveBuildAsset(request, env)).status, 200);
    assert.equal(requests.at(-1), request);
  }
  for (const request of [
    new Request(`${origin}/api/account/library`),
    new Request(`${origin}/assets/app.js`, { method: "POST" }),
  ])
    assert.equal(await serveBuildAsset(request, env), null);
  assert.equal(requests.length, 2);
});
test("missing assets and identity are never cached; successful hashes remain immutable", async () => {
  const env = {
    CF_VERSION_METADATA: { id: "worker-version" },
    ASSETS: {
      fetch: async () =>
        new Response(null, {
          status: 404,
          headers: { "cache-control": "public, max-age=31536000, immutable" },
        }),
    },
  };
  const missing = await serveBuildAsset(new Request(`${origin}/assets/missing.js`), env);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-lootsplit-worker-version"), "worker-version");
  const immutable = new Response(js, {
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
  assert.equal(
    releaseResponse(immutable.clone(), env).headers.get("cache-control"),
    immutable.headers.get("cache-control"),
  );
  assert.equal(releaseResponse(immutable, env, true).headers.get("cache-control"), "no-store");
});
test("HTML revalidates while existing no-store and cookies remain protected", () => {
  for (const cache of ["public, max-age=3600", "no-store"]) {
    const response = releaseResponse(
      new Response("page", {
        headers: {
          "content-type": "text/html",
          "cache-control": cache,
          "set-cookie": "session=value; HttpOnly",
        },
      }),
      {},
    );
    assert.equal(
      response.headers.get("cache-control"),
      cache === "no-store" ? cache : "private, no-cache",
    );
    assert.equal(response.headers.get("set-cookie"), "session=value; HttpOnly");
  }
});
