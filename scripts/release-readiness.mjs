import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function inspectRelease({ origin, manifest, fetchImpl = fetch, signal }) {
  const failures = [];
  const evidence = [];
  async function get(path, inspect) {
    try {
      const response = await fetchImpl(new URL(path, origin), {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      const item = {
        path,
        status: response.status,
        contentType: response.headers.get("content-type"),
        ray: response.headers.get("cf-ray"),
        workerVersion: response.headers.get("x-lootsplit-worker-version"),
      };
      evidence.push(item);
      if (!response.ok) {
        failures.push({ ...item, reason: "HTTP error" });
        await response.body?.cancel();
        return;
      }
      await inspect(response, item);
    } catch (error) {
      failures.push({ path, reason: error.message });
    }
  }
  await get("/assets/release-identity.json", async (response, item) => {
    const identity = await response.json();
    if (identity.commit !== manifest.commit)
      failures.push({
        ...item,
        reason: "Wrong release",
        expected: manifest.commit,
        actual: identity.commit,
      });
  });
  if (failures.length) return { failures, evidence };

  const assets = Object.entries(manifest.files)
    .filter(([path]) => path.startsWith("assets/") && /\.(?:m?js|css)$/.test(path))
    .map(([path, hash]) => [path.slice("assets".length), hash]);
  assert.ok(assets.length, "Artifact has no JavaScript or CSS to verify");
  const pending = [...assets];
  await Promise.all(
    Array.from({ length: Math.min(8, pending.length) }, async () => {
      while (pending.length && !signal.aborted) {
        const [path, hash] = pending.shift();
        await get(path, async (response, item) => {
          const type = path.endsWith(".css") ? /text\/css/ : /(?:javascript|ecmascript)/;
          if (!type.test(item.contentType || ""))
            failures.push({ ...item, reason: "Wrong asset content type" });
          const actual = digest(Buffer.from(await response.arrayBuffer()));
          if (actual !== hash)
            failures.push({
              ...item,
              reason: "Asset bytes differ from verified artifact",
              expected: hash,
              actual,
            });
        });
      }
    }),
  );
  // A correct identity and correct files are insufficient if HTML names old/missing chunks.
  for (const path of ["/", "/welcome"]) {
    await get(path, async (response, item) => {
      assert.match(item.contentType || "", /text\/html/, "Document is not HTML");
      const html = await response.text();
      const references = [
        ...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi),
      ]
        .map((match) => new URL(match[1].replaceAll("&amp;", "&"), origin))
        .filter(
          (url) => url.origin === new URL(origin).origin && /\.(?:m?js|css)$/.test(url.pathname),
        );
      assert.ok(
        references.some((url) => url.pathname.endsWith(".js")),
        "Document has no JavaScript entry",
      );
      for (const url of references) {
        if (!manifest.files[`assets${url.pathname}`])
          failures.push({
            ...item,
            reason: "Document references an asset outside the verified release",
            asset: url.pathname,
          });
      }
    });
  }
  if (signal.aborted) failures.push({ reason: "Readiness deadline exceeded" });
  return { failures, evidence, assetCount: assets.length };
}

export async function waitForRelease({
  origin,
  manifest,
  fetchImpl,
  timeoutMs = 90000,
  intervalMs = 2500,
  maxAttempts = 12,
  onReport = async () => {},
}) {
  const start = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const report = {
    commit: manifest.commit,
    startedAt: new Date(start).toISOString(),
    attempts: [],
  };
  for (let attempt = 1; attempt <= maxAttempts && !signal.aborted; attempt++) {
    const result = await inspectRelease({ origin, manifest, fetchImpl, signal });
    report.attempts.push({ attempt, ...result });
    report.durationMs = Date.now() - start;
    report.ready = result.failures.length === 0;
    await onReport(report);
    if (report.ready) return report;
    // Only repeat read-only readiness probes, never browser tests or deployments.
    if (result.failures.some((failure) => [401, 403].includes(failure.status))) break;
    if (attempt < maxAttempts && !signal.aborted)
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, intervalMs);
        signal.addEventListener("abort", done, { once: true });
      });
  }
  throw new Error(
    `Release assets are not ready: ${JSON.stringify(report.attempts.at(-1)?.failures || [{ reason: "Deadline exceeded" }])}`,
  );
}
