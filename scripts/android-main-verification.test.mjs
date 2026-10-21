import test from "node:test";
import assert from "node:assert/strict";
import { requireMainVerification } from "./android-main-verification.mjs";

const sha = "a".repeat(40);
const passed = {
  id: 100,
  run_attempt: 2,
  head_sha: sha,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/verify.yml",
  head_repository: { full_name: "UnregisteredMusket/Lootsplit" },
  status: "completed",
  conclusion: "success",
};
const gate = { name: "verify", status: "completed", conclusion: "success" };
function fixture({ runs = [passed], head = sha, jobs = [gate] } = {}) {
  let clock = 0;
  const paths = [];
  return {
    sha,
    timeoutMs: 40000,
    now: () => clock,
    pause: async (ms) => {
      clock += ms;
    },
    api: async (path) => {
      paths.push(path);
      if (path === "/git/ref/heads/main") return { object: { sha: head } };
      if (path.includes("/jobs?")) return { jobs };
      return { workflow_runs: typeof runs === "function" ? runs(clock) : runs };
    },
    paths,
  };
}
test("Android waits for the exact independent main run and its latest-attempt gate", async () => {
  const input = fixture({
    runs: (clock) => [{ ...passed, status: clock ? "completed" : "in_progress" }],
  });
  assert.equal(await requireMainVerification(input), 100);
  assert.ok(input.paths.includes("/actions/runs/100/attempts/2/jobs?per_page=100"));
});
test("stale source, failed latest runs and skipped/missing preservation gates refuse signing", async () => {
  await assert.rejects(requireMainVerification(fixture({ head: "b".repeat(40) })), /current main/);
  await assert.rejects(
    requireMainVerification(
      fixture({ runs: [passed, { ...passed, id: 101, conclusion: "failure" }] }),
    ),
    /did not pass/,
  );
  for (const jobs of [
    [],
    [{ ...gate, conclusion: "skipped" }],
    [{ ...gate, conclusion: "failure" }],
  ])
    await assert.rejects(requireMainVerification(fixture({ jobs })), /preservation gate/);
});
test("PR, fork, other-workflow and old-commit passes cannot authorize Android publication", async () => {
  for (const changed of [
    { event: "pull_request" },
    { head_branch: "candidate" },
    { head_sha: "b".repeat(40) },
    { path: ".github/workflows/android-release.yml" },
    { head_repository: { full_name: "someone/Lootsplit" } },
  ])
    await assert.rejects(
      requireMainVerification(fixture({ runs: [{ ...passed, ...changed }] })),
      /ten minutes/,
    );
});
test("missing or unfinished main verification expires without accepting a partial pass", async () => {
  for (const runs of [[], [{ ...passed, status: "in_progress" }]])
    await assert.rejects(requireMainVerification(fixture({ runs })), /ten minutes/);
});
