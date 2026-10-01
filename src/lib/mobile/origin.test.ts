import assert from "node:assert/strict";
import test from "node:test";
import { isAppOrigin, rewriteServerFnUrl } from "./origin.ts";

test("only the packaged app origins may call across hosts", () => {
  assert.equal(isAppOrigin("https://localhost"), true);
  assert.equal(isAppOrigin("capacitor://localhost"), true);
  assert.equal(isAppOrigin("https://evil.example"), false);
  assert.equal(isAppOrigin(null), false);
});

test("server function calls leave the webview and other requests do not", () => {
  assert.equal(
    rewriteServerFnUrl("/_serverFn/abc", "https://localhost"),
    "https://lootsplit.oliverstorie2017.workers.dev/_serverFn/abc",
  );
  assert.equal(
    rewriteServerFnUrl("https://localhost/_serverFn/abc?x=1", "https://localhost"),
    "https://lootsplit.oliverstorie2017.workers.dev/_serverFn/abc?x=1",
  );
  assert.equal(rewriteServerFnUrl("/party", "https://localhost"), null);
  assert.equal(rewriteServerFnUrl("https://localhost/assets/app.js", "https://localhost"), null);
});
