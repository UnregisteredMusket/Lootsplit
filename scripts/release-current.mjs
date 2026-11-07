// Step "Check the release commit is still the head of main" (website-release.yml, id `current`).
//
// When main has advanced past the release commit, this release must not migrate or deploy (the
// newer commit's own release does). That is expected, not a failure: the step writes
// `superseded=true` to its step outputs, a notice and a summary, and every later production step
// is guarded on it, so the run ends `success` WITHOUT the "Record live deployment" step. Readers
// tell deployments apart with src/lib/deployment/release-run.mjs. Anything uncertain (no main
// reading, a malformed commit) fails the step, which stops the release as before.
// production-migrations.mjs and production-preflight.mjs still assert current main themselves,
// so a merge landing between this check and those steps still stops the release (as a failure).
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const SHA = /^[a-f0-9]{40}$/;

/** { superseded, message } for a release commit and the current head of main; throws if unsure. */
export function releaseCurrency(sha, head) {
  assert.match(sha || "", SHA, "Release commit must be a full commit SHA");
  assert.match(head || "", SHA, "Current main must be a full commit SHA");
  return sha === head
    ? { superseded: false, message: `Release commit ${sha} is the head of main; continuing.` }
    : {
        superseded: true,
        message:
          `Superseded: main has advanced to ${head}, so ${sha} is not migrated or deployed. ` +
          "The newer commit's own release deploys it. This run is not a deployment.",
      };
}

if (process.argv[1]?.endsWith("/release-current.mjs")) {
  const sha = process.env.RELEASE_SHA;
  assert.equal(process.env.GITHUB_REPOSITORY, "UnregisteredMusket/Lootsplit");
  assert.ok(process.env.GH_TOKEN, "Missing GH_TOKEN");
  assert.ok(process.env.GITHUB_OUTPUT, "Runs only as a GitHub Actions step (GITHUB_OUTPUT)");
  const response = await fetch(
    "https://api.github.com/repos/UnregisteredMusket/Lootsplit/git/ref/heads/main",
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.ok(response.ok, `Unable to verify current main (HTTP ${response.status})`);
  const head = (await response.json())?.object?.sha;
  const result = releaseCurrency(sha, head);
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/release-current.json",
    JSON.stringify(
      { commit: sha, main: head, ...result, checkedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `superseded=${result.superseded}\n`);
  if (result.superseded) {
    console.log(`::notice title=Release superseded (not deployed)::${result.message}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `**Release superseded, not deployed.** ${result.message}\n\n`,
      );
  } else console.log(result.message);
}
