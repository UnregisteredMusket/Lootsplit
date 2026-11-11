// Keeps the daily database backup and website releases out of each other's way (audit G10).
//
// The two workflows used to share the `lootsplit-production` concurrency group. GitHub keeps only
// one pending run per group, so a queued backup could cancel a pending deploy (or the reverse).
// The backup now has its own group (`lootsplit-backup`), and these two waits replace the
// serialization the shared group gave:
//
// - A D1 export blocks every other request to the database while it runs (Cloudflare D1 docs,
//   "Import and export data", known limitations). A release that applies migrations during an
//   export would stall behind it, and its 300 s migration step could fail. So before anything
//   touches production, a release waits (bounded) while a backup's export step is running.
// - A backup taken while a release is between "migrations applied" and "new Worker live" would
//   hold migrations the live commit does not have, and fail validation. So the backup waits
//   (bounded) while any website release is running, before its export step starts.
//
// The backup only waits for a release in progress and the release only for a running export
// step, so neither can wait on the other forever. The remaining window (both start within the
// same few seconds) cannot corrupt anything: the export is a consistent snapshot, a stalled
// migration fails the release before deploy (the current Worker keeps serving), and a snapshot
// whose migrations match no live commit fails validation (scripts/standby-backup.mjs) instead of
// being stored.
import assert from "node:assert/strict";
import { requestJson } from "./recovery-http.mjs";
import { RELEASE_WORKFLOW_FILE } from "../src/lib/deployment/release-run.mjs";

const repository = "UnregisteredMusket/Lootsplit";
export const BACKUP_WORKFLOW_FILE = "standby-backup.yml";
export const BACKUP_JOB = "backup";
export const BACKUP_EXPORT_STEP = "Export consistently and encrypt before writing to disk";

/** In-progress runs of one workflow (queued and waiting runs have not touched production). */
async function runningRuns(api, workflow) {
  const data = await api(`/actions/workflows/${workflow}/runs?status=in_progress&per_page=20`);
  assert.ok(Array.isArray(data?.workflow_runs), `Unreadable ${workflow} runs`);
  return data.workflow_runs.filter((run) => run.status === "in_progress");
}

/** The website release runs currently in progress (what a backup must not overlap). */
export async function runningReleases(api) {
  return runningRuns(api, RELEASE_WORKFLOW_FILE);
}

/** The backup runs whose export step is running now (what a release must not overlap). */
export async function exportingBackups(api) {
  const exporting = [];
  for (const run of await runningRuns(api, BACKUP_WORKFLOW_FILE)) {
    const { jobs } = await api(
      `/actions/runs/${run.id}/attempts/${run.run_attempt || 1}/jobs?per_page=30`,
    );
    assert.ok(Array.isArray(jobs), `Unreadable jobs of backup run ${run.id}`);
    const job = jobs.find((j) => j?.name === BACKUP_JOB);
    // A job whose steps are not listed yet has not reached the export: it waits for releases first.
    if (job?.steps?.some((s) => s?.name === BACKUP_EXPORT_STEP && s.status === "in_progress"))
      exporting.push(run);
  }
  return exporting;
}

/**
 * Polls `busy` until it returns no runs, or throws `message` after `timeoutMs`. Unreadable GitHub
 * data throws at once: neither side proceeds on a guess.
 */
export async function waitWhileBusy({
  busy,
  message,
  timeoutMs,
  pollMs = 20000,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.log,
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const runs = await busy();
    if (!runs.length) return { waitedMs: timeoutMs - (deadline - now()) };
    if (now() >= deadline)
      throw Error(`${message} (still running: ${runs.map((r) => r.id).join(", ")})`);
    log(`Waiting for run ${runs.map((r) => r.id).join(", ")}…`);
    await pause(Math.min(pollMs, Math.max(0, deadline - now())));
  }
}

if (process.argv[1]?.endsWith("/production-lane.mjs")) {
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.ok(process.env.GH_TOKEN, "GitHub Actions read token is required");
  const api = (path) =>
    requestJson(`https://api.github.com/repos/${repository}${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    });
  const mode = process.argv[2];
  if (mode === "wait-for-release") {
    const { waitedMs } = await waitWhileBusy({
      busy: () => runningReleases(api),
      timeoutMs: 25 * 60_000,
      message:
        "A website release is still running after 25 minutes; nothing was exported. The next scheduled backup runs tomorrow, or re-run this one after the release",
    });
    console.log(`No website release running (waited ${Math.round(waitedMs / 1000)} s).`);
  } else if (mode === "wait-for-backup-export") {
    const { waitedMs } = await waitWhileBusy({
      busy: () => exportingBackups(api),
      timeoutMs: 15 * 60_000,
      message:
        "A database backup export is still running after 15 minutes; nothing was migrated or deployed. Re-run this release after the backup finishes",
    });
    console.log(`No database backup export running (waited ${Math.round(waitedMs / 1000)} s).`);
  } else throw Error("Use wait-for-release or wait-for-backup-export");
}
