// What a "Deploy verified website" run (.github/workflows/website-release.yml) actually did.
//
// A run's conclusion alone does not say that its commit went live: a release whose commit is no
// longer the head of main stops before migrations and deploy and ends `success` as superseded
// (the newer commit's own release deploys it). Only the guarded LIVE_RELEASE_STEP, which runs
// after the deploy and the read-only live audits passed, proves a deployment. Every reader that
// treats a release run as "this commit was deployed" (web changelog stamping, the owner monitor's
// latest deployment and live-audit coverage) classifies the run's jobs with releaseRunOutcome.
// scripts/release-run.test.mjs pins these names to the workflow file.

export const RELEASE_WORKFLOW_FILE = "website-release.yml";
export const RELEASE_WORKFLOW_PATH = `.github/workflows/${RELEASE_WORKFLOW_FILE}`;
export const RELEASE_JOB = "deploy";
export const CURRENT_MAIN_STEP = "Check the release commit is still the head of main";
export const LIVE_RELEASE_STEP = "Record live deployment";

/**
 * Classify one release run attempt from its jobs (GitHub `GET /actions/runs/{id}/attempts/{n}/jobs`).
 * - "deployed": the live-release step succeeded (deployed and live-audited).
 * - "superseded": the current-main check found a newer main commit; nothing was deployed.
 * - "not-deployed": anything else (failed, cancelled or still running).
 * - null: the jobs do not describe a release run (unknown; callers fail closed).
 * Runs from before the superseded state existed have neither step; for them success meant deployed.
 */
export function releaseRunOutcome(jobs) {
  if (!Array.isArray(jobs)) return null;
  const job = jobs.find((j) => j?.name === RELEASE_JOB);
  if (!job) return null;
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const marker = steps.find((s) => s?.name === LIVE_RELEASE_STEP);
  const check = steps.find((s) => s?.name === CURRENT_MAIN_STEP);
  if (marker?.conclusion === "success") return "deployed";
  if (!marker && !check) return job.conclusion === "success" ? "deployed" : "not-deployed";
  if (
    job.conclusion === "success" &&
    check?.conclusion === "success" &&
    marker?.conclusion === "skipped"
  )
    return "superseded";
  return "not-deployed";
}
