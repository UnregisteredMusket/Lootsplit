import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseResponse, SECURITY_HEADERS, SCRIPT_POLICY } from "../cloudflare/release-assets.mjs";
import { injectGrokPwaHead } from "./grok-pwa-shared.mjs";

test("every released page and asset carries baseline security headers", () => {
  const page = releaseResponse(
    new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
    {},
  );
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    assert.equal(page.headers.get(name), value, name);
  assert.match(page.headers.get("Content-Security-Policy"), /frame-ancestors 'self'/);
  assert.equal(page.headers.get("Cache-Control"), "private, no-cache", "HTML cache rule kept");
  const missing = releaseResponse(new Response("gone", { status: 404 }), {});
  assert.equal(missing.headers.get("Cache-Control"), "no-store", "error cache rule kept");
  assert.equal(missing.headers.get("X-Content-Type-Options"), "nosniff");
  const own = releaseResponse(
    new Response("x", { headers: { "Content-Security-Policy": "default-src 'self'" } }),
    {},
  );
  assert.equal(
    own.headers.get("Content-Security-Policy"),
    "default-src 'self'",
    "never overridden",
  );
});

test("scripts are limited to same-origin files, the app's inline hydration and WebAssembly", () => {
  const csp = SECURITY_HEADERS["Content-Security-Policy"];
  const directives = Object.fromEntries(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
  assert.ok(csp.endsWith(SCRIPT_POLICY));
  assert.deepEqual(directives["frame-ancestors"], ["'self'"], "earlier protections kept");
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'self'"]);
  assert.deepEqual(directives["script-src"], [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    "https://challenges.cloudflare.com",
  ]);
  assert.deepEqual(directives["script-src-attr"], ["'none'"]);
  // Tesseract starts its OCR worker from a blob: URL; every worker script is same-origin.
  assert.deepEqual(directives["worker-src"], ["'self'", "blob:"]);
  for (const values of Object.values(directives)) {
    assert.ok(!values.includes("'unsafe-eval'"), "string eval stays blocked");
    // The only external script host is Cloudflare Turnstile (the sign-in human check).
    assert.ok(
      !values.some((v) => /grok|\*/.test(v) || (/https?:/.test(v) && v !== "https://challenges.cloudflare.com")),
      "no other external script host",
    );
  }
});

test("the grok.com extension script is disabled for every Lootsplit build and deployment", () => {
  // The app-builder script would run with signed-in owner sessions (audit S01, 2026-10-21).
  const appEnv = JSON.parse(
    readFileSync(new URL("../.grok/app-env.json", import.meta.url), "utf8"),
  );
  assert.equal(appEnv.VITE_GROK_EXTENSIONS, "0", "dev/build/preview/mobile builds");
  const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(wrangler, /^VITE_GROK_EXTENSIONS = "0"$/m, "Worker runtime middleware");
  const render = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(render, /key: VITE_GROK_EXTENSIONS\n\s+value: '0'/, "standby runtime");
  const previous = process.env.VITE_GROK_EXTENSIONS;
  process.env.VITE_GROK_EXTENSIONS = "0";
  try {
    const html = injectGrokPwaHead(
      '<html><head><script src="https://grok.com/grok-app-builder/extensions.js"></script></head></html>',
      { appName: "Lootsplitter" },
    );
    assert.doesNotMatch(html, /grok\.com\/grok-app-builder\/extensions\.js/);
  } finally {
    if (previous === undefined) delete process.env.VITE_GROK_EXTENSIONS;
    else process.env.VITE_GROK_EXTENSIONS = previous;
  }
});
