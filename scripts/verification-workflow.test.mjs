import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertVerification, requiredJobs } from "./verification-gate.mjs";

test("the aggregate release gate refuses failure, timeout, cancellation, skipped and missing groups", () => {
  const good = Object.fromEntries(requiredJobs.map((job) => [job, { result: "success" }]));
  assertVerification(good);
  for (const job of requiredJobs) {
    for (const result of ["failure", "cancelled", "skipped", "timed_out", undefined]) {
      assert.throws(() => assertVerification({ ...good, [job]: { result } }), new RegExp(job));
    }
    const missing = { ...good };
    delete missing[job];
    assert.throws(() => assertVerification(missing), new RegExp(job));
  }
});

test("parallel workflow preserves every bounded release check exactly once", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const baseline = JSON.parse(readFileSync("scripts/verification-baseline.json", "utf8"));
  const actual = [...workflow.matchAll(/^\s+run: (node scripts\/recovery-step\.mjs .+)$/gm)].map(
    (match) => match[1],
  );
  assert.equal(new Set(actual).size, actual.length, "No duplicate preservation check");
  for (const command of baseline) assert.ok(actual.includes(command), `Missing gate: ${command}`);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /if: always\(\)\n {4}needs: \[build, development, worker, standby\]/);
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.build\.outputs\.website_artifact \}\}/);
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.build\.outputs\.standby_artifact \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
  assert.doesNotMatch(workflow, /improvement\/\*\*/);
});

test("each development check belongs to exactly one declared isolated group", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const groups = workflow
    .match(/group: \[([^\]]+)\]/)[1]
    .split(",")
    .map((v) => v.trim());
  assert.equal(new Set(groups).size, groups.length);
  const checks = [...workflow.matchAll(/- name: (dev-[\w-]+)\n\s+if: matrix.group == '([^']+)'/g)];
  assert.equal(checks.length, 31);
  assert.ok(checks.some(([, name, group]) => name === "dev-trade-economy" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-world-features" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-property-operations" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-properties" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-shop-stock" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-market-locations" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-sound" && group === "governance"));
  for (const [, name, group] of checks) assert.ok(groups.includes(group), `${name}: ${group}`);
  for (const group of groups) assert.ok(checks.some(([, , assigned]) => assigned === group));
});
