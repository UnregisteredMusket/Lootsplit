import assert from "node:assert/strict";
import { requestJson } from "./recovery-http.mjs";

const repository = "UnregisteredMusket/Lootsplit";

export async function requireMainVerification({
  sha,
  api,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 600000,
}) {
  assert.match(sha || "", /^[a-f0-9]{40}$/);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const main = await api("/git/ref/heads/main");
    assert.equal(main.object.sha, sha, "Android source is no longer current main");
    const listing = await api(
      `/actions/workflows/verify.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=100`,
    );
    const run = listing.workflow_runs
      .filter(
        (entry) =>
          entry.head_sha === sha &&
          entry.head_branch === "main" &&
          entry.event === "push" &&
          entry.path === ".github/workflows/verify.yml" &&
          entry.head_repository?.full_name === repository,
      )
      .sort((a, b) => b.id - a.id)[0];
    if (run?.status === "completed") {
      assert.equal(run.conclusion, "success", "Independent main verification did not pass");
      const { jobs } = await api(
        `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
      );
      assert.ok(
        jobs.some(
          (job) =>
            job.name === "verify" && job.status === "completed" && job.conclusion === "success",
        ),
        "Main verification is missing its successful preservation gate",
      );
      return run.id;
    }
    await pause(Math.min(20000, Math.max(0, deadline - now())));
  }
  throw Error("Independent main verification did not complete within ten minutes");
}

if (process.argv[1]?.endsWith("/android-main-verification.mjs")) {
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.ok(process.env.GH_TOKEN, "GitHub Actions read token is required");
  const run = await requireMainVerification({
    sha: process.env.GITHUB_SHA,
    api: (path) =>
      requestJson(`https://api.github.com/repos/${repository}${path}`, {
        headers: {
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }),
  });
  console.log(`Independent main preservation verification passed: run ${run}`);
}
