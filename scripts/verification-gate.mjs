import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredJobs = ["changes", "build", "development", "worker", "pr-worker", "standby"];

/**
 * Which groups a run must pass. Main pushes, manual runs and release calls require every group.
 * Pull requests (owner-approved 2026-10-21) require the change scope, the build job (unit tests,
 * typecheck, lint, immutable builds) and, when code changed, every development-server audit; the
 * packaged Worker and standby audits run on main before any deployment. When code changed, pull
 * requests also run `pr-worker`: the script-policy audit against the PR's own built Worker, so
 * Worker-only behavior is checked before merge (main covers it in the full Worker groups and
 * skips this job). A group that runs must always succeed: a failed, cancelled or timed-out group
 * is never accepted.
 */
export function expectedGroups(event, code) {
  const pullRequest = event === "pull_request";
  return {
    changes: true,
    build: true,
    development: !pullRequest || code !== false,
    worker: !pullRequest,
    "pr-worker": pullRequest && code !== false,
    standby: !pullRequest,
  };
}

export function assertVerification(results, event = "push") {
  assert.deepEqual(
    Object.keys(results || {}).sort(),
    [...requiredJobs].sort(),
    "Unexpected gate dependency",
  );
  assert.equal(results.changes?.result, "success", "changes must pass; missing/skipped is not success");
  const code = results.changes?.outputs?.code !== "false";
  const expected = expectedGroups(event, code);
  for (const job of requiredJobs) {
    const result = results[job]?.result;
    if (expected[job])
      assert.equal(result, "success", `${job} must pass; missing/skipped is not success`);
    else
      assert.ok(
        result === "skipped" || result === "success",
        `${job} must pass or be skipped for this ${event} run, not ${result}`,
      );
  }
  return expected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = JSON.parse(process.env.VERIFICATION_RESULTS || "{}");
  const event = process.env.GITHUB_EVENT_NAME || "push";
  const code = results.changes?.outputs?.code !== "false";
  const expected = expectedGroups(event, code);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "| Preservation group | Required | Result |\n| --- | --- | --- |\n" +
        requiredJobs
          .map(
            (job) =>
              `| ${job} | ${expected[job] ? "yes" : job === "pr-worker" ? "pull requests only" : "main only"} | ${results[job]?.result || "missing"} |`,
          )
          .join("\n") +
        "\n\nMain requires every group before release. Artifacts are built once and checked before and after packaged audits.\n",
    );
  }
  assertVerification(results, event);
  console.log(
    event === "pull_request"
      ? "Pull-request groups passed. Main verifies every group, including packaged audits, before release."
      : "All preservation groups passed. The verified artifacts may be published.",
  );
}
