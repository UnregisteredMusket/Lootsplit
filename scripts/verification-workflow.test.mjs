import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertVerification, requiredJobs } from "./verification-gate.mjs";
import { changesCode } from "./change-scope.mjs";

test("the aggregate release gate refuses failure, timeout, cancellation, skipped and missing groups", () => {
  const good = Object.fromEntries(requiredJobs.map((job) => [job, { result: "success" }]));
  good.changes.outputs = { code: "true" };
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
  assert.match(workflow, /if: always\(\)\n {4}needs: \[changes, build, development, worker, standby\]/);
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
  assert.equal(checks.length, 38);
  assert.ok(checks.some(([, name, group]) => name === "dev-downtime" && group === "accounts"));
  assert.match(
    workflow,
    /worker-downtime 240 node --experimental-strip-types scripts\/downtime-browser-audit\.mjs/,
  );
  assert.ok(checks.some(([, name, group]) => name === "dev-blacksmith" && group === "desktop"));
  assert.match(
    workflow,
    /worker-blacksmith 240 node --experimental-strip-types scripts\/blacksmith-browser-audit\.mjs/,
  );
  assert.ok(checks.some(([, name, group]) => name === "dev-navigation" && group === "world"));
  assert.ok(checks.some(([, name, group]) => name === "dev-map-tiles" && group === "desktop"));
  assert.match(workflow, /worker-map-tiles 240 node scripts\/map-tiles-browser-audit\.mjs/);
  assert.ok(checks.some(([, name, group]) => name === "dev-ships" && group === "accounts-2"));
  assert.match(workflow, /worker-ships 240 node scripts\/ships-browser-audit\.mjs/);
  assert.ok(checks.some(([, name, group]) => name === "dev-trade-economy" && group === "economy"));
  assert.ok(
    checks.some(([, name, group]) => name === "dev-world-features" && group === "world"),
  );
  assert.ok(
    checks.some(([, name, group]) => name === "dev-property-operations" && group === "economy"),
  );
  assert.ok(checks.some(([, name, group]) => name === "dev-properties" && group === "economy"));
  assert.ok(checks.some(([, name, group]) => name === "dev-shop-stock" && group === "gameplay"));
  assert.ok(
    checks.some(([, name, group]) => name === "dev-market-locations" && group === "gameplay"),
  );
  assert.ok(checks.some(([, name, group]) => name === "dev-sound" && group === "economy"));
  assert.ok(checks.some(([, name, group]) => name === "dev-guest-chat" && group === "governance"));
  for (const [, name, group] of checks) assert.ok(groups.includes(group), `${name}: ${group}`);
  for (const group of groups) assert.ok(checks.some(([, , assigned]) => assigned === group));
});

test("balanced Worker groups retain every complete audit and run account isolation before campaign fixtures", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const workerGroups = ["accounts", "features", "world", "economy", "library", "interface"];
  assert.match(workflow, new RegExp(`group: \\[${workerGroups.join(", ")}\\]`));
  const checks = [...workflow.matchAll(/- name: (worker-[\w-]+)\n\s+if: matrix.group == '([^']+)'/g)];
  assert.equal(checks.length, 23);
  assert.equal(new Set(checks.map(([, name]) => name)).size, 23);
  for (const [, , group] of checks) assert.ok(workerGroups.includes(group), group);
  for (const group of workerGroups) assert.ok(checks.some(([, , assigned]) => assigned === group), group);
  const inGroup = (group) => checks.filter(([, , g]) => g === group).map(([, name]) => name);
  // Each account shard runs first in its group, before any campaign fixtures.
  assert.deepEqual(inGroup("accounts").slice(0, 3), ["worker-account-1", "worker-monitor", "worker-finance"]);
  assert.equal(inGroup("features")[0], "worker-account-2");
  assert.ok(inGroup("accounts").includes("worker-ships"));
  assert.ok(inGroup("features").includes("worker-map-tiles"));
  for (const name of ["downtime", "world-features"]) assert.ok(inGroup("world").includes(`worker-${name}`));
  for (const name of ["trade-economy", "properties", "property-operations"])
    assert.ok(inGroup("economy").includes(`worker-${name}`));
  for (const name of ["blacksmith", "market-locations"]) assert.ok(inGroup("library").includes(`worker-${name}`));
  assert.match(workflow, /- name: Verify title screen on the built artifact\n\s+if: matrix.group == 'interface'/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});

test("development account shards run first in their jobs, before campaign fixtures", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const checks = [...workflow.matchAll(/- name: (dev-[\w-]+)\n\s+if: matrix.group == '([^']+)'/g)];
  const first = (group) => checks.find(([, , g]) => g === group)[1];
  assert.equal(first("accounts"), "dev-account-1");
  assert.equal(first("accounts-2"), "dev-account-2");
});

test("both account shards run in development and packaged Worker groups, each in its own job", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  for (const prefix of ["dev", "worker"]) {
    const shards = [...workflow.matchAll(new RegExp(`- name: ${prefix}-account-(\\d)\\n\\s+if: matrix.group == '([^']+)'\\n(?:\\s+env:\\n(?:\\s+\\w+: .+\\n)*)`, "g"))];
    assert.deepEqual(shards.map(([, n]) => n), ["1", "2"], prefix);
    assert.notEqual(shards[0][2], shards[1][2], `${prefix} shards run in parallel jobs`);
    assert.match(shards[0][0], /ACCOUNT_SHARD: 1\/2/);
    assert.match(shards[1][0], /ACCOUNT_SHARD: 2\/2/);
  }
  assert.doesNotMatch(workflow, /max-parallel/);
});

test("pull requests skip packaged audits; main and manual runs require every group", () => {
  const all = (code, worker = "success", development = "success") => ({
    changes: { result: "success", outputs: { code } },
    build: { result: "success" },
    development: { result: development },
    worker: { result: worker },
    standby: { result: worker },
  });
  assertVerification(all("true", "skipped"), "pull_request");
  assertVerification(all("false", "skipped", "skipped"), "pull_request");
  assert.throws(() => assertVerification(all("true", "skipped", "skipped"), "pull_request"), /development/);
  assert.throws(() => assertVerification(all("true", "failure"), "pull_request"), /worker/);
  for (const event of ["push", "workflow_dispatch", "workflow_call"]) {
    assert.throws(() => assertVerification(all("true", "skipped"), event), /worker/);
    assert.throws(() => assertVerification(all("false", "success", "skipped"), event), /development/);
    assertVerification(all("true"), event);
  }
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.equal((workflow.match(/if: github\.event_name != 'pull_request'/g) || []).length, 2);
});

test("documentation-only changes are recognized; anything else, or nothing, counts as code", () => {
  assert.equal(changesCode(["README.md", "docs/RECOVERY.md", "performance/x.json", "src/lib/help/x.md"]), false);
  assert.equal(changesCode(["docs/a.md", "src/routes/index.tsx"]), true);
  assert.equal(changesCode(["scripts/verification-gate.mjs"]), true);
  assert.equal(changesCode([]), true);
});
