import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubClient, paginate } from "./performance-sync.mjs";
import { localMeasurement } from "./performance-record.mjs";
import { applyResolution, collectRun } from "./performance-history.mjs";

export async function prepareResolution(input, baselines, api) {
  const baseline = Object.values(baselines).find((r) => r.id === input.baselineId);
  if (!baseline)
    throw Error("Unknown/stale baseline ID; sync history and inspect the current trend first");
  let verified;
  if (input.runId) {
    if (!Number.isSafeInteger(input.runId) || input.runId <= 0)
      throw Error("Invalid verification run ID");
    const run = await api(`/actions/runs/${input.runId}`);
    if (run.status !== "completed" || run.conclusion !== "success")
      throw Error("Verification run must be complete and successful");
    const jobs = await paginate(
      api,
      `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      "jobs",
    );
    verified = collectRun(run, jobs).find((r) => r.scope === baseline.scope);
    if (!verified)
      throw Error("Verification does not contain the same comparable operation/environment");
  } else if (input.measurement) verified = localMeasurement(input.measurement);
  else throw Error("Supply a successful GitHub runId or a measured local verification");
  const resolution = {
    schema: 1,
    id: `resolution:${randomUUID()}`,
    scope: baseline.scope,
    expectedBaselineId: baseline.id,
    reason: input.reason,
    confirmedAt: new Date().toISOString(),
    verified,
  };
  applyResolution({ ...baselines }, resolution);
  return resolution;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3)
      throw Error("Usage: npm run performance:resolve -- resolution.json");
    const baselines = JSON.parse(readFileSync("test-results/performance/baselines.json", "utf8"));
    const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const resolution = await prepareResolution(input, baselines, githubClient());
    mkdirSync("performance", { recursive: true });
    appendFileSync("performance/resolutions.jsonl", JSON.stringify(resolution) + "\n");
    console.log(
      "Recorded verified resolution. Commit performance/resolutions.jsonl with the fix; history is retained and the verified duration becomes the new reference after merge.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
