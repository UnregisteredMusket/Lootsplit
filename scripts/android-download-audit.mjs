import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** Read-only verification of the actual fixed website APK proxy, not just its link. */
export async function verifyAndroidDownload(
  origin,
  release,
  { fetcher = fetch, timeoutMs = 60000, maxBytes = 100 * 1024 * 1024 } = {},
) {
  assert.match(release.sha256, /^[a-f0-9]{64}$/);
  assert.equal(release.filename, `Lootsplit-${release.version}.apk`);
  const response = await fetcher(new URL("/download/android", origin).href, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  let reader;
  try {
    assert.equal(response.status, 200, "The live Android download must succeed");
    assert.equal(
      response.headers.get("content-type")?.split(";")[0].trim(),
      "application/vnd.android.package-archive",
    );
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="${release.filename}"`,
    );
    assert.equal(response.headers.get("x-release-sha256"), release.sha256);
    const length = Number(response.headers.get("content-length"));
    assert.ok(Number.isSafeInteger(length) && length > 0 && length <= maxBytes);
    assert.ok(response.body, "The live Android download must contain bytes");
    reader = response.body.getReader();
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      assert.ok(sizeBytes <= maxBytes, "Android download exceeded the inspection limit");
      hash.update(value);
    }
    assert.equal(sizeBytes, length, "Android download length mismatch");
    const sha256 = hash.digest("hex");
    assert.equal(sha256, release.sha256, "Live Android APK checksum mismatch");
    return {
      version: release.version,
      versionCode: release.versionCode,
      filename: release.filename,
      sizeBytes,
      sha256,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (reader) await reader.cancel().catch(() => undefined);
    else await response.body?.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
