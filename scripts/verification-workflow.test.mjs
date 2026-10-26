import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertVerification, requiredJobs } from "./verification-gate.mjs";
import { changesCode } from "./change-scope.mjs";
import { MAP_TILES_WIDTHS, mapTilesPart, phaseNotice } from "./map-tiles-parts.mjs";

test("the aggregate release gate refuses failure, timeout, cancellation, skipped and missing groups", () => {
  const good = Object.fromEntries(requiredJobs.map((job) => [job, { result: "success" }]));
  good.changes.outputs = { code: "true" };
  assertVerification(good);
  for (const job of requiredJobs) {
    // pr-worker runs on pull requests only; a main run skips it but never accepts a failure.
    const event = job === "pr-worker" ? "pull_request" : "push";
    for (const result of ["failure", "cancelled", "skipped", "timed_out", undefined]) {
      assert.throws(() => assertVerification({ ...good, [job]: { result } }, event), new RegExp(job));
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
  assert.match(workflow, /if: always\(\)\n {4}needs: \[changes, build, development, worker, pr-worker, standby\]/);
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
  assert.equal(checks.length, 54);
  // Market and shop counter: Shops here first, Paying from, Sell to, $ defaults, Edit save bar (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-market-shops" && group === "desktop"));
  // Loot review: Desk card and count, three-tap transfer, bulk assign, pool, memory (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-loot-review" && group === "gameplay"));
  // Themed confirmations and prompts replace native dialogs (design audit D7), 1280/390.
  assert.ok(checks.some(([, name, group]) => name === "dev-themed-confirm" && group === "gameplay"));
  // Quest log: DM create/reveal/update/close, player view, privacy, toast, Here (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-quest-log" && group === "world"));
  // Split the party: split, groups panel, players per group, buying per group, merge (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-party-split" && group === "world"));
  // Map controls: Back to the parent map, X Close map, Android Back order, theme (5 sizes, both roles).
  assert.ok(checks.some(([, name, group]) => name === "dev-map-controls" && group === "world"));
  // Community profiles and the Looking for Group directory (docs/COMMUNITY.md).
  assert.ok(checks.some(([, name, group]) => name === "dev-community" && group === "accounts"));
  // Human check stays on the sign-in form after a recovery-key reset and mode switches (2026-10-25).
  assert.ok(checks.some(([, name, group]) => name === "dev-human-check" && group === "accounts"));
  // Even coin split: fund split, refusal keeps the form, Activity row, encounter split (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-coin-split" && group === "gameplay"));
  // Treasure pool: claims, Review Inbox resolution, refusal keeps the form, Activity, encounter (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-loot-claims" && group === "gameplay"));
  // Fairness ledger: DM, party member and away views, breakdown and favour (1280/390/320).
  assert.ok(checks.some(([, name, group]) => name === "dev-loot-fairness" && group === "gameplay"));
  assert.ok(checks.some(([, name, group]) => name === "dev-downtime" && group === "accounts"));
  assert.match(
    workflow,
    /worker-downtime 240 node --experimental-strip-types scripts\/downtime-browser-audit\.mjs/,
  );
  assert.ok(checks.some(([, name, group]) => name === "dev-blacksmith" && group === "desktop"));
  // NPC services in the conversation hub (docs/SERVICES.md), 1280/390/320.
  assert.ok(checks.some(([, name, group]) => name === "dev-services" && group === "desktop"));
  assert.match(
    workflow,
    /worker-blacksmith 240 node --experimental-strip-types scripts\/blacksmith-browser-audit\.mjs/,
  );
  assert.ok(checks.some(([, name, group]) => name === "dev-navigation" && group === "world"));
  // NPC barter conversation: accept, counter and refuse by real clicks (docs/NPC-BARTER.md).
  assert.ok(checks.some(([, name, group]) => name === "dev-npc-barter" && group === "world"));
  // Journey planner: calibrate, draw, review, approve, progress, arrive (docs/MAP-TILES.md).
  assert.ok(checks.some(([, name, group]) => name === "dev-journey-planner" && group === "world"));
  // The development map-tiles audit runs as its two halves in separate jobs; the packaged
  // Worker step runs it whole.
  assert.ok(checks.some(([, name, group]) => name === "dev-map-tiles-1" && group === "desktop"));
  assert.ok(checks.some(([, name, group]) => name === "dev-map-tiles-2" && group === "economy"));
  assert.ok(!checks.some(([, name]) => name === "dev-map-tiles"));
  assert.ok(checks.some(([, name, group]) => name === "dev-split-view" && group === "desktop"));
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
  assert.ok(checks.some(([, name, group]) => name === "dev-sound" && group === "accounts"));
  assert.ok(checks.some(([, name, group]) => name === "dev-guest-chat" && group === "governance"));
  for (const [, name, group] of checks) assert.ok(groups.includes(group), `${name}: ${group}`);
  for (const group of groups) assert.ok(checks.some(([, , assigned]) => assigned === group));
});

test("balanced Worker groups retain every complete audit and run account isolation before campaign fixtures", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const workerGroups = ["accounts", "features", "world", "economy", "library", "interface"];
  assert.match(workflow, new RegExp(`group: \\[${workerGroups.join(", ")}\\]`));
  const checks = [...workflow.matchAll(/- name: (worker-[\w-]+)\n\s+if: matrix.group == '([^']+)'/g)];
  assert.equal(checks.length, 24);
  assert.equal(new Set(checks.map(([, name]) => name)).size, 24);
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
  // The script Content-Security-Policy is checked in a browser against the built artifact.
  assert.ok(inGroup("interface").includes("worker-csp"));
  assert.match(workflow, /- name: Verify title screen on the built artifact\n\s+if: matrix.group == 'interface'/);
  // 15 minutes of audits plus the browser install step's own 12-minute bound.
  assert.match(workflow, /timeout-minutes: 27/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});

test("focused player references run the complete account suite as the two CI shards", () => {
  const workflow = readFileSync(".github/workflows/player-reference-audit.yml", "utf8");
  assert.match(workflow, /runtime: \[development, worker\]\n\s+shard: \[1, 2\]/);
  assert.match(workflow, /ACCOUNT_SHARD: \$\{\{ matrix\.shard \}\}\/2\n\s+run: node scripts\/recovery-step\.mjs focused-account-fixtures-\$\{\{ matrix\.shard \}\} 180 node scripts\/account-browser-audit\.mjs/);
  // The player-reference audit runs once per runtime, in shard 1.
  assert.match(workflow, /- name: Verify player references and Help\n\s+if: matrix\.shard == 1\n/);
  assert.doesNotMatch(workflow, /continue-on-error: true|max-parallel/);
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
  const all = (code, worker = "success", development = "success", prWorker = "skipped") => ({
    changes: { result: "success", outputs: { code } },
    build: { result: "success" },
    development: { result: development },
    worker: { result: worker },
    "pr-worker": { result: prWorker },
    standby: { result: worker },
  });
  assertVerification(all("true", "skipped", "success", "success"), "pull_request");
  assertVerification(all("false", "skipped", "skipped"), "pull_request");
  assert.throws(() => assertVerification(all("true", "skipped", "skipped", "success"), "pull_request"), /development/);
  assert.throws(() => assertVerification(all("true", "failure", "success", "success"), "pull_request"), /worker/);
  // Code pull requests must run the packaged script-policy audit on their own built Worker.
  for (const result of ["skipped", "failure", "cancelled"])
    assert.throws(() => assertVerification(all("true", "skipped", "success", result), "pull_request"), /pr-worker/);
  for (const event of ["push", "workflow_dispatch", "workflow_call"]) {
    assert.throws(() => assertVerification(all("true", "skipped"), event), /worker/);
    assert.throws(() => assertVerification(all("false", "success", "skipped"), event), /development/);
    assert.throws(() => assertVerification(all("true", "success", "success", "failure"), event), /pr-worker/);
    assertVerification(all("true"), event);
  }
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.equal((workflow.match(/if: github\.event_name != 'pull_request'/g) || []).length, 2);
  assert.match(
    workflow,
    /pr-worker:\n(?:.*\n)*?\s+if: github\.event_name == 'pull_request' && needs\.changes\.outputs\.code == 'true'\n(?:.*\n)*?\s+run: node scripts\/recovery-step\.mjs pr-worker-csp 240 node scripts\/csp-browser-audit\.mjs/,
  );
});

test("documentation-only changes are recognized; anything else, or nothing, counts as code", () => {
  assert.equal(changesCode(["README.md", "docs/RECOVERY.md", "performance/x.json", "src/lib/help/x.md"]), false);
  assert.equal(changesCode(["docs/a.md", "src/routes/index.tsx"]), true);
  assert.equal(changesCode(["scripts/verification-gate.mjs"]), true);
  assert.equal(changesCode([]), true);
});

test("the blacksmith audit waits for cross-device sync as long as the room poll can back off", () => {
  const client = readFileSync("src/lib/quire/cloud-client.ts", "utf8");
  const audit = readFileSync("scripts/blacksmith-browser-audit.mjs", "utf8");
  const longest = Number(/Math\.min\((\d+), 2000 \* 2 \*\* pollFailures\)/.exec(client)?.[1]);
  assert.equal(longest, Number(/const ROOM_SYNC_MAX_POLL_MS = (\d+);/.exec(audit)?.[1]));
  assert.match(audit, /timeout: ROOM_SYNC_WAIT_MS,\n\s+\}\)\n\s+\.toBe\("claimed"\)/);
});

test("the two map-tiles halves are disjoint, together the complete audit, each in its own job", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const full = mapTilesPart("");
  assert.deepEqual(full, { part: null, widths: MAP_TILES_WIDTHS, connected: true });
  const one = mapTilesPart("1/2"),
    two = mapTilesPart("2/2");
  assert.deepEqual([...one.widths, ...two.widths].sort(), [...MAP_TILES_WIDTHS].sort());
  assert.equal(one.widths.filter((w) => two.widths.includes(w)).length, 0);
  assert.equal(Number(one.connected) + Number(two.connected), 1, "connected maps run exactly once");
  for (const bad of ["3/2", "1/3", "all", "2"]) assert.throws(() => mapTilesPart(bad), /MAP_TILES_PART/);
  const steps = [
    ...workflow.matchAll(
      /- name: dev-map-tiles-(\d)\n\s+if: matrix.group == '([^']+)'\n\s+env:\n\s+MAP_TILES_PART: (\d\/2)\n\s+run: node scripts\/recovery-step\.mjs dev-map-tiles-\d 240 node scripts\/map-tiles-browser-audit\.mjs/g,
    ),
  ];
  assert.deepEqual(steps.map(([, n, , part]) => `${n}/2` === part), [true, true]);
  assert.notEqual(steps[0][2], steps[1][2], "halves run in parallel jobs");
  // The packaged Worker step keeps the whole audit, without a part.
  assert.match(workflow, /- name: worker-map-tiles\n\s+if: matrix.group == 'features'\n\s+env:\n\s+AUDIT_ORIGIN: [^\n]+\n\s+run: node scripts\/recovery-step\.mjs worker-map-tiles 240/);
  assert.equal(
    phaseNotice("1/2", [{ name: "width-1280", ms: 101234 }]),
    "::notice title=Map tiles phases part 1/2::width-1280: 101.2s",
  );
});
