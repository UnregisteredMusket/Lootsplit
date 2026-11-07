// A superseded website release (its commit is no longer the head of main) stops before
// migrations and deploy, ends success, and is never mistaken for a deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CURRENT_MAIN_STEP,
  LIVE_RELEASE_STEP,
  RELEASE_JOB,
  RELEASE_WORKFLOW_PATH,
  releaseRunOutcome,
} from "../src/lib/deployment/release-run.mjs";
import { releaseCurrency } from "./release-current.mjs";

const a = "a".repeat(40);
const b = "b".repeat(40);
const job = (conclusion, steps) => [
  { name: RELEASE_JOB, conclusion, steps: steps.map(([name, c]) => ({ name, conclusion: c })) },
];

test("the release commit check: current continues, an advanced main supersedes, doubt fails", () => {
  assert.equal(releaseCurrency(a, a).superseded, false);
  const stale = releaseCurrency(a, b);
  assert.equal(stale.superseded, true);
  assert.match(stale.message, /not migrated or deployed/);
  assert.throws(() => releaseCurrency(a, undefined));
  assert.throws(() => releaseCurrency("main", a));
});

test("only the live-release step proves a deployment; superseded and failed runs are not", () => {
  assert.equal(
    releaseRunOutcome(
      job("success", [
        [CURRENT_MAIN_STEP, "success"],
        ["Apply pending additive D1 migrations and read back the ledger", "success"],
        [LIVE_RELEASE_STEP, "success"],
      ]),
    ),
    "deployed",
  );
  assert.equal(
    releaseRunOutcome(
      job("success", [
        [CURRENT_MAIN_STEP, "success"],
        ["Apply pending additive D1 migrations and read back the ledger", "skipped"],
        [LIVE_RELEASE_STEP, "skipped"],
      ]),
    ),
    "superseded",
  );
  // A real failure after the check (migrations rejected, deploy or live audit failed).
  assert.equal(
    releaseRunOutcome(
      job("failure", [
        [CURRENT_MAIN_STEP, "success"],
        ["Verify deployed identity and read-only desktop/mobile website behavior", "failure"],
        [LIVE_RELEASE_STEP, "skipped"],
      ]),
    ),
    "not-deployed",
  );
  assert.equal(releaseRunOutcome(job("failure", [[CURRENT_MAIN_STEP, "failure"]])), "not-deployed");
  assert.equal(
    releaseRunOutcome(job("in_progress", [[CURRENT_MAIN_STEP, "success"]])),
    "not-deployed",
  );
  // Runs from before this check existed: success meant deployed.
  assert.equal(
    releaseRunOutcome(job("success", [["Validate the exact verified artifact", "success"]])),
    "deployed",
  );
  assert.equal(releaseRunOutcome(job("failure", [])), "not-deployed");
  // Unknown shapes are unknown, never "deployed".
  assert.equal(releaseRunOutcome(null), null);
  assert.equal(releaseRunOutcome([{ name: "other", conclusion: "success", steps: [] }]), null);
});

test("the workflow checks current main before every production step and marks real deploys last", () => {
  const workflow = readFileSync(RELEASE_WORKFLOW_PATH, "utf8");
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"));
  assert.match(jobs, new RegExp(`\\n  ${RELEASE_JOB}:\\n`));
  const steps = jobs.split("\n      - ").slice(1);
  const index = (pattern) => {
    const i = steps.findIndex((s) => pattern.test(s));
    assert.ok(i >= 0, `missing step ${pattern}`);
    return i;
  };
  const check = index(new RegExp(`^name: ${CURRENT_MAIN_STEP}\\n`));
  assert.match(steps[check], /\n {8}id: current\n/);
  assert.match(steps[check], /node scripts\/release-current\.mjs/);
  assert.doesNotMatch(steps[check], /\n {8}if:/, "the check itself always runs");
  const guard = "\n        if: steps.current.outputs.superseded != 'true'\n";
  const production = [
    /production-migrations\.mjs/,
    /production-preflight\.mjs/,
    /wrangler deploy/,
    /runtime-policy\.mjs/,
    /live-release-audit\.mjs/,
    /website-browser-audit\.mjs/,
  ];
  for (const pattern of production) {
    const i = index(pattern);
    assert.ok(i > check, `${pattern} runs after the current-main check`);
    assert.ok(steps[i].includes(guard), `${pattern} is skipped for a superseded release`);
  }
  // The hard stale-release assertions stay as a backstop.
  for (const file of ["scripts/production-migrations.mjs", "scripts/production-preflight.mjs"])
    assert.match(readFileSync(file, "utf8"), /assertCurrentMain\(releaseSha/);
  const marker = index(new RegExp(`^name: ${LIVE_RELEASE_STEP}\\n`));
  assert.ok(steps[marker].includes(guard));
  assert.doesNotMatch(steps[marker], /always\(\)|continue-on-error/);
  for (const pattern of production)
    assert.ok(index(pattern) < marker, `the live-release marker follows ${pattern}`);
  assert.equal(steps.filter((s) => s.startsWith(`name: ${LIVE_RELEASE_STEP}\n`)).length, 1);
  assert.equal(steps.filter((s) => s.startsWith(`name: ${CURRENT_MAIN_STEP}\n`)).length, 1);
});
