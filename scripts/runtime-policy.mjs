import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function assertRuntimeSettings(actual, expected, path = "runtime") {
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === "object")
      assertRuntimeSettings(actual?.[key], value, `${path}.${key}`);
    else assert.equal(actual?.[key], value, `Runtime policy drift: ${path}.${key}`);
  }
}

/** Check the explicit scalar policy tables; Wrangler still validates the complete TOML. */
export function assertRuntimeConfig(config, expected) {
  const tables = new Map();
  let table = "";
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.replace(/\s*#.*$/, "").trim();
    const heading = line.match(/^\[([\w.]+)\]$/);
    if (heading) {
      table = heading[1];
      if (table === "limits" || table.startsWith("observability")) {
        assert.ok(!tables.has(table), `Repeated runtime policy table: ${table}`);
        tables.set(table, new Map());
      }
    } else if (tables.has(table)) {
      const setting = line.match(/^(\w+)\s*=\s*(true|false|\d+(?:\.\d+)?)$/);
      if (setting) {
        assert.ok(!tables.get(table).has(setting[1]), `Repeated runtime policy field: ${table}.${setting[1]}`);
        tables.get(table).set(setting[1], JSON.parse(setting[2]));
      }
    }
  }
  function check(value, path) {
    for (const [key, entry] of Object.entries(value)) {
      if (entry && typeof entry === "object") check(entry, path ? `${path}.${key}` : key);
      else assert.equal(tables.get(path)?.get(key), entry, `Upload config policy drift: ${path}.${key}`);
    }
  }
  check(expected, "");
}

async function main() {
  const [{ cfRequest }, { verifyArtifact }] = await Promise.all([
    import("./production-preflight.mjs"), import("./release-artifact.mjs"),
  ]);
  const root = "dist/website-release";
  const expectedSha = process.env.EXPECTED_RELEASE_SHA || process.env.RELEASE_SHA;
  assert.match(expectedSha || "", /^[a-f0-9]{40}$/);
  verifyArtifact(root, expectedSha);
  const policy = JSON.parse(readFileSync(join(root, "runtime-policy.json"), "utf8"));
  assertRuntimeConfig(readFileSync(join(root, "wrangler.toml"), "utf8"), policy);
  const actual = await cfRequest("workers/scripts/lootsplit/settings");
  assertRuntimeSettings(actual, policy);
  mkdirSync("test-results", { recursive: true });
  // Deliberately retain only public runtime values, never binding values or secret metadata.
  writeFileSync("test-results/runtime-policy.json", JSON.stringify({
    commit: expectedSha, checkedAt: new Date().toISOString(),
    limits: actual.limits, observability: actual.observability,
  }, null, 2) + "\n");
  console.log("Verified the artifact's CPU, persistent log and query-redaction policy; no settings were changed.");
}
// Do not await dynamic imports during module evaluation: release-artifact imports
// the pure policy checks from this module and otherwise forms a top-level-await cycle.
if (process.argv[1]?.endsWith("/runtime-policy.mjs")) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
