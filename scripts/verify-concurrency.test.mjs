import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Only a completed main verification triggers website-release.yml. If main runs cancelled each
// other, a burst of merges would leave production undeployed (2026-10-22).
test("main verification is never cancelled by a later merge; PR runs still restart", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const block = workflow.match(/^concurrency:\n((?: {2}.*\n)+)/m)?.[1] ?? "";
  assert.match(block, /group: verify-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(block, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  const release = readFileSync(".github/workflows/website-release.yml", "utf8");
  assert.match(release, /workflows: \[Verify preserved functionality\]/);
  assert.match(release, /github\.event\.workflow_run\.conclusion == 'success'/);
});
