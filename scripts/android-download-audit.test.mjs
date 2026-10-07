import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyAndroidDownload } from "./android-download-audit.mjs";

const bytes = new TextEncoder().encode("PK\u0003\u0004synthetic release bytes");
const release = {
  version: "1.5.0",
  versionCode: 7,
  filename: "Lootsplit-1.5.0.apk",
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const headers = {
  "content-type": "application/vnd.android.package-archive",
  "content-disposition": `attachment; filename="${release.filename}"`,
  "content-length": String(bytes.byteLength),
  "x-release-sha256": release.sha256,
};
const origin = "https://release-audit.example";
function response(body = bytes, changes = {}) {
  return new Response(body, { headers: { ...headers, ...changes } });
}

test("live Android audit hashes the actual fixed download with a bounded GET", async () => {
  const result = await verifyAndroidDownload(origin, release, {
    fetcher: async (url, options) => {
      assert.equal(url, `${origin}/download/android`);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return response();
    },
  });
  assert.equal(result.sha256, release.sha256);
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.equal(result.versionCode, 7);
});

test("live Android audit rejects an unavailable proxy", async () => {
  await assert.rejects(
    verifyAndroidDownload(origin, release, {
      fetcher: async () => new Response("Unavailable", { status: 503 }),
    }),
    /must succeed/,
  );
});

test("live Android audit rejects stale metadata, HTML and a different filename", async () => {
  for (const changes of [
    { "x-release-sha256": "0".repeat(64) },
    { "content-type": "text/html" },
    { "content-disposition": 'attachment; filename="old.apk"' },
  ]) {
    await assert.rejects(
      verifyAndroidDownload(origin, release, { fetcher: async () => response(bytes, changes) }),
    );
  }
});

test("live Android audit rejects modified bytes even when headers claim the expected hash", async () => {
  const changed = bytes.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(
    verifyAndroidDownload(origin, release, { fetcher: async () => response(changed) }),
    /checksum mismatch/,
  );
});

test("live Android audit rejects truncation and oversized downloads", async () => {
  await assert.rejects(
    verifyAndroidDownload(origin, release, { fetcher: async () => response(bytes.slice(1)) }),
    /length mismatch/,
  );
  await assert.rejects(
    verifyAndroidDownload(origin, release, {
      maxBytes: 4,
      fetcher: async () => response(),
    }),
  );
  await assert.rejects(
    verifyAndroidDownload(origin, release, {
      maxBytes: 4,
      fetcher: async () => response(bytes, { "content-length": "4" }),
    }),
    /inspection limit/,
  );
});

test("live Android audit propagates a bounded request failure without retrying", async () => {
  let attempts = 0;
  await assert.rejects(
    verifyAndroidDownload(origin, release, {
      fetcher: async () => {
        attempts += 1;
        throw new Error("Request timeout");
      },
    }),
    /Request timeout/,
  );
  assert.equal(attempts, 1);
});
