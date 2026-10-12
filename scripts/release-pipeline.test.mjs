import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileHashes, verifyArtifact } from "./release-artifact.mjs";
import { assertCurrentMain, assertMigrations } from "./production-preflight.mjs";
import { readFileSync } from "node:fs";
import { assertRuntimeSettings, assertRuntimeConfig } from "./runtime-policy.mjs";
const sha = "a".repeat(40);
test("release verification rejects changed, added, missing files and wrong commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "release-test-"));
  try {
    writeFileSync(join(directory, "worker.js"), "verified");
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ commit: sha, files: fileHashes(directory) }));
    verifyArtifact(directory, sha);
    assert.throws(() => verifyArtifact(directory, "b".repeat(40)));
    writeFileSync(join(directory, "worker.js"), "changed");
    assert.throws(() => verifyArtifact(directory, sha));
    writeFileSync(join(directory, "worker.js"), "verified");
    writeFileSync(join(directory, "extra"), "extra");
    assert.throws(() => verifyArtifact(directory, sha));
    rmSync(join(directory, "extra"));
    rmSync(join(directory, "worker.js"));
    assert.throws(() => verifyArtifact(directory, sha));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("stale releases and pending or divergent migrations fail closed", () => {
  assertCurrentMain(sha, sha);
  assert.throws(() => assertCurrentMain(sha, "b".repeat(40)));
  assertMigrations(["0001.sql", "0002.sql"], ["0002.sql", "0001.sql"]);
  assert.throws(() => assertMigrations(["0001.sql", "0002.sql"], ["0001.sql"]));
  assert.throws(() => assertMigrations(["0001.sql"], ["0001.sql", "0002.sql"]));
});
test("the verified upload pins Paid CPU and private persistent logs; runtime drift fails closed", () => {
  const policy = JSON.parse(readFileSync("cloudflare/runtime-policy.json", "utf8"));
  const config = readFileSync("wrangler.toml", "utf8");
  assertRuntimeConfig(config, policy);
  assertRuntimeSettings(structuredClone(policy), policy);
  for (const replacement of [config.replace("cpu_ms = 10000", "cpu_ms = 10"), config.replace("redact_query_string = true", "redact_query_string = false")])
    assert.throws(() => assertRuntimeConfig(replacement, policy), /policy drift/);
  assert.throws(() => assertRuntimeSettings({ ...policy, limits: { cpu_ms: 30 } }, policy), /policy drift/);
  assert.throws(() => assertRuntimeSettings({ ...policy, observability: { ...policy.observability, logs: { ...policy.observability.logs, persist: false } } }, policy), /policy drift/);
  assert.throws(() => assertRuntimeConfig(config + "\n[limits]\ncpu_ms = 10", policy), /Repeated/);
});
