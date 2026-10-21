import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseResponse, SECURITY_HEADERS } from "../cloudflare/release-assets.mjs";
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
  assert.equal(own.headers.get("Content-Security-Policy"), "default-src 'self'", "never overridden");
});

test("the grok.com extension script is disabled for every Lootsplit build and deployment", () => {
  // The app-builder script would run with signed-in owner sessions (audit S01, 2026-10-21).
  const appEnv = JSON.parse(readFileSync(new URL("../.grok/app-env.json", import.meta.url), "utf8"));
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
      { appName: "Lootsplit" },
    );
    assert.doesNotMatch(html, /grok\.com\/grok-app-builder\/extensions\.js/);
  } finally {
    if (previous === undefined) delete process.env.VITE_GROK_EXTENSIONS;
    else process.env.VITE_GROK_EXTENSIONS = previous;
  }
});
