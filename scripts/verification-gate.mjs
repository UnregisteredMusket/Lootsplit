import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredJobs = ["build", "development", "worker", "standby"];

export function assertVerification(results) {
  for (const job of requiredJobs) {
    assert.equal(
      results?.[job]?.result,
      "success",
      `${job} must pass; missing/skipped is not success`,
    );
  }
  assert.deepEqual(
    Object.keys(results).sort(),
    [...requiredJobs].sort(),
    "Unexpected gate dependency",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = JSON.parse(process.env.VERIFICATION_RESULTS || "{}");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "| Preservation group | Result |\n| --- | --- |\n" +
        requiredJobs.map((job) => `| ${job} | ${results[job]?.result || "missing"} |`).join("\n") +
        "\n\nRelease requires every group. Artifacts are built once and checked before and after packaged audits.\n",
    );
  }
  assertVerification(results);
  console.log("All preservation groups passed. The verified artifacts may be published.");
}
