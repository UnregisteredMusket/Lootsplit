import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubClient, paginate } from "./performance-sync.mjs";

// Weekly development-speed summary (owner-approved 2026-10-21). It replaces the per-change
// reporting duty: one report a week of verification wall time, job and step medians, failures
// and the slowest steps, compared with the week before. Raw regression history is unchanged.
const DAY = 86400000;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const seconds = (start, end) => (Date.parse(end) - Date.parse(start)) / 1000;
const change = (before, after) =>
  before && after ? `${after >= before ? "+" : ""}${Math.round(((after - before) / before) * 100)}%` : "—";
const fmt = (value) =>
  value === null ? "—" : value >= 90 ? `${(value / 60).toFixed(1)} min` : `${Math.round(value)}s`;

/** Summarize verification runs (each with its jobs and their steps) for one week. */
export function summarizeWeek(runs) {
  const finished = runs.filter((r) => r.status === "completed");
  const byEvent = (event) =>
    finished.filter((r) => r.event === event && r.conclusion === "success").map((r) => r.wall);
  const steps = {};
  const jobs = {};
  for (const run of finished)
    for (const job of run.jobs || []) {
      if (job.conclusion === "success" && job.started_at && job.completed_at)
        (jobs[job.name] ||= []).push(seconds(job.started_at, job.completed_at));
      for (const step of job.steps || [])
        if (step.conclusion === "success" && step.started_at && step.completed_at)
          (steps[step.name] ||= []).push(seconds(step.started_at, step.completed_at));
    }
  const conclusions = {};
  for (const run of finished) conclusions[run.conclusion] = (conclusions[run.conclusion] || 0) + 1;
  return {
    runs: finished.length,
    conclusions,
    pullRequest: median(byEvent("pull_request")),
    main: median(byEvent("push")),
    jobs: Object.fromEntries(Object.entries(jobs).map(([name, v]) => [name, median(v)])),
    steps: Object.fromEntries(Object.entries(steps).map(([name, v]) => [name, median(v)])),
  };
}

export function renderSummary(current, previous, until) {
  const lines = [
    `# Development speed — week ending ${until.slice(0, 10)}`,
    "",
    "| Measure | Previous week | This week | Change |",
    "| --- | --- | --- | --- |",
    `| PR verification (median, successful) | ${fmt(previous.pullRequest)} | ${fmt(current.pullRequest)} | ${change(previous.pullRequest, current.pullRequest)} |`,
    `| Main verification (median, successful) | ${fmt(previous.main)} | ${fmt(current.main)} | ${change(previous.main, current.main)} |`,
    `| Verification runs | ${previous.runs} | ${current.runs} | |`,
    `| Failed / cancelled | ${previous.conclusions.failure || 0} / ${previous.conclusions.cancelled || 0} | ${current.conclusions.failure || 0} / ${current.conclusions.cancelled || 0} | |`,
    "",
    "## Slowest jobs (median)",
    "",
    "| Job | Previous | This week | Change |",
    "| --- | --- | --- | --- |",
  ];
  const top = (table, count) =>
    Object.entries(table)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count);
  for (const [name, value] of top(current.jobs, 10))
    lines.push(`| ${name} | ${fmt(previous.jobs[name] ?? null)} | ${fmt(value)} | ${change(previous.jobs[name], value)} |`);
  lines.push("", "## Slowest steps (median)", "", "| Step | Previous | This week | Change |", "| --- | --- | --- | --- |");
  for (const [name, value] of top(current.steps, 12))
    lines.push(`| ${name} | ${fmt(previous.steps[name] ?? null)} | ${fmt(value)} | ${change(previous.steps[name], value)} |`);
  const grew = Object.entries(current.steps)
    .filter(([name, value]) => previous.steps[name] && value >= 30 && value / previous.steps[name] >= 1.15)
    .sort((a, b) => b[1] / previous.steps[b[0]] - a[1] / previous.steps[a[0]]);
  lines.push("", "## Needs attention", "");
  if (grew.length)
    for (const [name, value] of grew.slice(0, 8))
      lines.push(`- **${name}**: ${fmt(previous.steps[name])} → ${fmt(value)} (${change(previous.steps[name], value)}). Investigate before the next release.`);
  else lines.push("- No step of 30s or more slowed by 15% or more week over week.");
  return lines.join("\n") + "\n";
}

/** Runs `work` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimited(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}
/**
 * Job reads run six at a time: 790 verification runs in two weeks (2026-10-30) took longer than
 * the job's 15 minutes when read one by one. Six stays far below GitHub's concurrency limits.
 */
export const JOB_READ_CONCURRENCY = 6;
export async function collect(api, since, until) {
  const runs = await paginate(
    api,
    `/actions/workflows/verify.yml/runs?created=${since.slice(0, 10)}..${until.slice(0, 10)}`,
    "workflow_runs",
  );
  const completed = runs.filter((r) => r.status === "completed");
  return mapLimited(completed, JOB_READ_CONCURRENCY, async (run) => {
    const jobs = (await api(`/actions/runs/${run.id}/attempts/${run.run_attempt || 1}/jobs?per_page=100`)).jobs;
    const timed = jobs.filter((j) => j.started_at && j.completed_at);
    const wall = timed.length
      ? (Math.max(...timed.map((j) => Date.parse(j.completed_at))) -
          Math.min(...timed.map((j) => Date.parse(j.started_at)))) /
        1000
      : null;
    return { ...run, jobs, wall };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const api = githubClient();
  const until = new Date().toISOString();
  const runs = await collect(api, new Date(Date.now() - 14 * DAY).toISOString(), until);
  const cutoff = Date.now() - 7 * DAY;
  const current = summarizeWeek(runs.filter((r) => Date.parse(r.created_at) >= cutoff));
  const previous = summarizeWeek(runs.filter((r) => Date.parse(r.created_at) < cutoff));
  const markdown = renderSummary(current, previous, until);
  mkdirSync("test-results/performance", { recursive: true });
  writeFileSync("test-results/performance/weekly-summary.md", markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(markdown);
}
