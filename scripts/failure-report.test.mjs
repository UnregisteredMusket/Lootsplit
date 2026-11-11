// Audit G11: the failure reporter skips cancelled runs a newer run replaced, and covers the
// code-health and both performance workflows.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { replacingRun } from "./failure-report.mjs";

const run = (id, run_number, extra = {}) => ({
  id,
  run_number,
  workflow_id: 7,
  head_branch: "fix/example",
  conclusion: "cancelled",
  ...extra,
});

test("a cancelled run replaced by a newer run of the same workflow and branch is not reported", () => {
  const cancelled = run(100, 5);
  assert.equal(replacingRun(cancelled, [run(101, 6, { conclusion: null }), cancelled]).id, 101);
  assert.equal(replacingRun(cancelled, [run(101, 6), run(102, 7)]).id, 102);
});

test("failures, lone cancellations and other workflows or branches are still reported", () => {
  const cancelled = run(100, 5);
  assert.equal(replacingRun(cancelled, [cancelled]), null);
  assert.equal(replacingRun(cancelled, [run(99, 4)]), null, "older runs replace nothing");
  assert.equal(replacingRun(cancelled, [run(101, 6, { workflow_id: 8 })]), null);
  assert.equal(replacingRun(cancelled, [run(101, 6, { head_branch: "main" })]), null);
  assert.equal(replacingRun(run(100, 5, { conclusion: "failure" }), [run(101, 6)]), null);
  assert.equal(replacingRun(run(100, 5, { conclusion: "timed_out" }), [run(101, 6)]), null);
  assert.equal(replacingRun(cancelled, null), null);
});

test("the reporter watches every repository workflow that can fail, including code health and performance", () => {
  const workflow = readFileSync(".github/workflows/failure-report.yml", "utf8");
  const watched = /workflows:\s*\[([^\]]*)\]/.exec(workflow)[1].split(",").map((s) => s.trim()).filter(Boolean);
  const names = new Map(
    readdirSync(".github/workflows")
      .filter((f) => f.endsWith(".yml"))
      .map((f) => [f, /^name: (.+)$/m.exec(readFileSync(`.github/workflows/${f}`, "utf8"))[1].trim()]),
  );
  for (const file of ["code-health.yml", "performance-log.yml", "performance-summary.yml"])
    assert.ok(watched.includes(names.get(file)), `${names.get(file)} is reported`);
  for (const name of watched) assert.ok([...names.values()].includes(name), `${name} is a real workflow`);
  // The skip needs the cancelled run's workflow and number, and must not swallow other failures.
  const script = readFileSync("scripts/failure-report.mjs", "utf8");
  assert.match(script, /if \(run\.conclusion === "cancelled"\)/);
});
