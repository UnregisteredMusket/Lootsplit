import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWeek, renderSummary } from "./performance-summary.mjs";

const at = (s) => new Date(Date.parse("2026-10-20T00:00:00Z") + s * 1000).toISOString();
const run = (event, conclusion, wall, stepSeconds) => ({
  status: "completed",
  event,
  conclusion,
  wall,
  jobs: [
    {
      name: "build",
      conclusion: "success",
      started_at: at(0),
      completed_at: at(wall),
      steps: [{ name: "dev-account-1", conclusion: "success", started_at: at(0), completed_at: at(stepSeconds) }],
    },
  ],
});

test("weekly summary reports medians, failures and steps that slowed by 15% or more", () => {
  const previous = summarizeWeek([run("pull_request", "success", 600, 100), run("push", "success", 700, 100)]);
  const current = summarizeWeek([
    run("pull_request", "success", 360, 130),
    run("pull_request", "success", 380, 130),
    run("pull_request", "failure", 900, 130),
    run("push", "cancelled", 200, 130),
  ]);
  assert.equal(current.pullRequest, 370, "median of successful PR runs only");
  assert.equal(current.main, null, "no successful main run this week");
  assert.deepEqual(current.conclusions, { success: 2, failure: 1, cancelled: 1 });
  const markdown = renderSummary(current, previous, "2026-10-27T00:00:00Z");
  assert.match(markdown, /PR verification \(median, successful\) \| 10\.0 min \| 6\.2 min \| -38%/);
  assert.match(markdown, /\*\*dev-account-1\*\*: 1\.7 min → 2\.2 min \(\+30%\)/);
  assert.match(markdown, /\| Failed \/ cancelled \| 0 \/ 0 \| 1 \/ 1 \|/);
});

test("a quiet week reports that nothing needs attention", () => {
  const week = summarizeWeek([run("push", "success", 400, 50)]);
  assert.match(renderSummary(week, week, "2026-10-27T00:00:00Z"), /No step of 30s or more slowed/);
});
