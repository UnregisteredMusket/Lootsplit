// What a "Deploy verified website" run (.github/workflows/website-release.yml) actually did.
//
// A run's conclusion alone does not say that its commit went live: a release whose commit is no
// longer the head of main stops before migrations and deploy and ends `success` as superseded
// (the newer commit's own release deploys it). Only the guarded LIVE_RELEASE_STEP, which runs
// after the deploy and the read-only live audits passed, proves a deployment. Every reader that
// treats a release run as "this commit was deployed" (web changelog stamping, the owner monitor's
// latest deployment and live-audit coverage) classifies the run's jobs with releaseRunOutcome.
// Since audit G6 (2026-11-11, owner decision "stay live, flag it") the marker also runs when the
// deploy succeeded but a live audit did not pass: the commit IS serving, so it is recorded as
// deployed, flagged "live-unaudited", and the run still ends red (the audit step failed).
// scripts/release-run.test.mjs pins these names to the workflow file.

export const RELEASE_WORKFLOW_FILE = "website-release.yml";
export const RELEASE_WORKFLOW_PATH = `.github/workflows/${RELEASE_WORKFLOW_FILE}`;
export const RELEASE_JOB = "deploy";
export const CURRENT_MAIN_STEP = "Check the release commit is still the head of main";
export const LIVE_RELEASE_STEP = "Record live deployment";
export const LIVE_AUDIT_STEP = "Verify deployed identity and read-only desktop/mobile website behavior";

/**
 * Classify one release run attempt from its jobs (GitHub `GET /actions/runs/{id}/attempts/{n}/jobs`).
 * - "deployed": the live-release step succeeded (deployed and live-audited).
 * - "live-unaudited": the live-release step succeeded but the live audit step did not (deployed and
 *   serving, not audited; the run itself failed). Readers count it as a deployment and flag it.
 * - "superseded": the current-main check found a newer main commit; nothing was deployed.
 * - "not-deployed": anything else (failed, cancelled or still running).
 * - null: the jobs do not describe a release run (unknown; callers fail closed).
 * Runs from before the superseded state existed have neither step; for them success meant deployed.
 * @typedef {{ name?: string, conclusion?: string | null }} ReleaseStep
 * @typedef {{ name?: string, conclusion?: string | null, steps?: ReleaseStep[] }} ReleaseJob
 * @param {ReleaseJob[] | null | undefined} jobs
 * @returns {"deployed" | "live-unaudited" | "superseded" | "not-deployed" | null}
 */
export function releaseRunOutcome(jobs) {
  if (!Array.isArray(jobs)) return null;
  const job = jobs.find((j) => j?.name === RELEASE_JOB);
  if (!job) return null;
  /** @type {ReleaseStep[]} */
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const marker = steps.find((s) => s?.name === LIVE_RELEASE_STEP);
  const check = steps.find((s) => s?.name === CURRENT_MAIN_STEP);
  if (marker?.conclusion === "success") {
    // Before G6 the marker only ran after the audit passed, so a missing audit step is a pass.
    const audit = steps.find((s) => s?.name === LIVE_AUDIT_STEP);
    return audit && audit.conclusion !== "success" ? "live-unaudited" : "deployed";
  }
  if (!marker && !check) return job.conclusion === "success" ? "deployed" : "not-deployed";
  if (
    job.conclusion === "success" &&
    check?.conclusion === "success" &&
    marker?.conclusion === "skipped"
  )
    return "superseded";
  return "not-deployed";
}

/** Whether an outcome means the run's commit went live (audited or not). */
export const isDeployedOutcome = (outcome) => outcome === "deployed" || outcome === "live-unaudited";
