import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileHashes, verifyArtifact } from "./release-artifact.mjs";
import { assertCurrentMain, assertMigrations } from "./production-preflight.mjs";
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
