import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runStep } from "./recovery-step.mjs";
import { requestJson } from "./recovery-http.mjs";
import { buildReport, emailReport } from "./failure-report.mjs";

test("step records success and failure without retrying assertions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "recovery-test-"));
  try {
    for (const [code, status] of [
      [0, "passed"],
      [1, "failed"],
    ]) {
      const result = await runStep({
        id: "fixture",
        seconds: 2,
        command: process.execPath,
        args: ["-e", `process.exit(${code})`],
        directory,
      });
      assert.equal(result.status, status);
      assert.equal(JSON.parse(readFileSync(join(directory, "fixture.json"))).status, status);
      assert.ok(result.finishedAt);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hung child is terminated and timeout survives in the checkpoint", async () => {
  const directory = mkdtempSync(join(tmpdir(), "recovery-timeout-"));
  try {
    const result = await runStep({
      id: "hung",
      seconds: 0.2,
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      directory,
      heartbeatMs: 50,
    });
    assert.equal(result.status, "timed_out");
    assert.equal(JSON.parse(readFileSync(join(directory, "hung.json"))).status, "timed_out");
    assert.ok(Date.parse(result.heartbeatAt) >= Date.parse(result.startedAt));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("interrupted runner saves an interruption and exits nonzero", async () => {
  const directory = mkdtempSync(join(tmpdir(), "recovery-interrupt-"));
  try {
    const script = new URL("./recovery-step.mjs", import.meta.url).pathname;
    const child = spawn(
      process.execPath,
      [script, "interrupted", "10", process.execPath, "-e", "setInterval(()=>{},1000)"],
      { cwd: directory },
    );
    const exit = new Promise((r) => child.once("exit", (code) => r(code)));
    await new Promise((r) => child.stdout.once("data", r));
    // START is emitted immediately before handlers install; allow startup to finish.
    await new Promise((r) => setTimeout(r, 100));
    child.kill("SIGTERM");
    assert.equal(await exit, 130);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "test-results/recovery/interrupted.json"))).status,
      "interrupted",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("network retries are bounded, stop on authorization failure and refuse unsafe writes", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response("{}", { status: 503 });
  };
  await assert.rejects(
    requestJson("https://example.test", {}, { fetchImpl, pause: async () => {} }),
    /HTTP 503/,
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    requestJson(
      "https://example.test",
      {},
      {
        fetchImpl: async () => {
          calls++;
          return new Response("{}", { status: 401 });
        },
        pause: async () => {},
      },
    ),
    /HTTP 401/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    requestJson("https://example.test", { method: "POST" }),
    /without an idempotency key/,
  );
});

test("failure report identifies the exact stage without adding raw logs or credentials", () => {
  const report = buildReport(
    {
      id: 42,
      run_attempt: 2,
      name: "Verify",
      conclusion: "failure",
      head_sha: "a".repeat(40),
      head_branch: "main",
    },
    [
      {
        id: 10,
        name: "verify",
        conclusion: "failure",
        steps: [{ name: "dev-governance", conclusion: "failure" }],
      },
    ],
  );
  assert.deepEqual(report.failedSteps, ["verify: dev-governance (failure)"]);
  assert.equal(report.liveCommit, "unconfirmed");
  assert.match(report.url, /42\/attempts\/2$/);
});

test("email requires explicit configuration and keeps retries idempotent", async () => {
  const report = {
    runId: 42,
    attempt: 2,
    result: "failure",
    workflow: "Verify",
    text: "Failure details",
  };
  let calls = 0;
  const missing = await emailReport(report, {}, async () => {
    calls++;
  });
  assert.equal(missing.status, "not_configured");
  assert.equal(calls, 0);
  const accepted = await emailReport(
    report,
    {
      FAILURE_REPORT_EMAIL: "owner@example.test",
      FAILURE_REPORT_FROM: "reports@example.test",
      RESEND_API_KEY: "test-secret",
    },
    async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.headers["Idempotency-Key"], "lootsplit-failure/42/2");
      assert.deepEqual(JSON.parse(options.body).to, ["owner@example.test"]);
      return { id: "accepted-123" };
    },
  );
  assert.deepEqual(accepted, { status: "accepted", id: "accepted-123" });
});
