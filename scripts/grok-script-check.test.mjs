import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  grokScriptAssetReferences,
  grokScriptReferences,
  isGrokScriptUrl,
} from "./grok-script-check.mjs";
import { GROK_EXTENSIONS_SCRIPT_SRC, grokExtensionsHeadTags } from "./grok-pwa-shared.mjs";

test("the template extension tag is detected", () => {
  const previous = process.env.VITE_GROK_EXTENSIONS;
  process.env.VITE_GROK_EXTENSIONS = "1";
  try {
    const html = `<head>${grokExtensionsHeadTags("p1").join("")}</head>`;
    assert.deepEqual(grokScriptReferences(html), [GROK_EXTENSIONS_SCRIPT_SRC]);
  } finally {
    if (previous === undefined) delete process.env.VITE_GROK_EXTENSIONS;
    else process.env.VITE_GROK_EXTENSIONS = previous;
  }
});

test("the shipped setting emits no extension tag", () => {
  const previous = process.env.VITE_GROK_EXTENSIONS;
  process.env.VITE_GROK_EXTENSIONS = "0";
  try {
    assert.deepEqual(grokScriptReferences(grokExtensionsHeadTags("p1").join("")), []);
  } finally {
    if (previous === undefined) delete process.env.VITE_GROK_EXTENSIONS;
    else process.env.VITE_GROK_EXTENSIONS = previous;
  }
});

test("grok and x.ai script hosts are flagged; Lootsplit's own are not", () => {
  assert.equal(isGrokScriptUrl("https://grok.com/x.js"), true);
  assert.equal(isGrokScriptUrl("https://cdn.x.ai/a.js"), true);
  assert.equal(isGrokScriptUrl("/assets/main.js"), false);
  assert.equal(isGrokScriptUrl("https://notgrok.com/a.js"), false);
  assert.deepEqual(
    grokScriptReferences(`<script src="/assets/a.js"></script><script src='https://api.x.ai/s.js' defer></script>`),
    ["https://api.x.ai/s.js"],
  );
  assert.deepEqual(grokScriptReferences(`const u="https://grok.com/grok-app-builder/extensions.js"`), [
    "grok-app-builder/extensions.js",
  ]);
});

test("asset scan reports only files that reference the script", () => {
  const root = mkdtempSync(join(tmpdir(), "grok-assets-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "ok.js"), "console.log('lootsplit')");
  writeFileSync(join(root, "assets", "bad.js"), `s.src="${GROK_EXTENSIONS_SCRIPT_SRC}"`);
  writeFileSync(join(root, "image.png"), GROK_EXTENSIONS_SCRIPT_SRC);
  const hits = grokScriptAssetReferences(root);
  assert.equal(hits.length, 1);
  assert.match(hits[0].path, /bad\.js$/);
});
