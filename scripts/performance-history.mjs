import { createHash } from "node:crypto";

export const HISTORY_BRANCH = "performance-history";
export const CAPTURE_START = "2026-10-04T20:46:00Z";
export const THRESHOLD_PERCENT = 15;
export const jsonLines = (rows) =>
  rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
export const parseLines = (text) =>
  text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validTime = (value) => Number.isFinite(Date.parse(value));

export function validateMeasurement(row) {
  for (const key of ["id", "scope", "name", "environment", "commit", "url", "outcome"])
    if (typeof row[key] !== "string" || !row[key].trim()) throw Error(`Missing measurement ${key}`);
  if (
    !validTime(row.startedAt) ||
    !validTime(row.finishedAt) ||
    Date.parse(row.finishedAt) < Date.parse(row.startedAt)
  )
    throw Error("Invalid measurement timestamps");
  if (!Number.isFinite(row.durationMs) || row.durationMs <= 0)
    throw Error("Duration must be positive");
  if (!/^[a-f0-9]{40}$/.test(row.commit)) throw Error("Measurement needs the full commit SHA");
  if (!/^https:\/\/github\.com\/UnregisteredMusket\/Lootsplit\//.test(row.url))
    throw Error("Evidence must link to Lootsplit on GitHub");
  return row;
}

export function collectRun(run, jobs) {
  const rows = [];
  const attempt = run.run_attempt || 1;
  const context = [
    run.path,
    run.event,
    run.event === "pull_request" ? "pull-request" : run.head_branch,
  ];
  const add = (kind, name, environment, start, end, outcome, discriminator, url) => {
    const durationMs = Date.parse(end) - Date.parse(start);
    if (!(durationMs > 0) || ["skipped", "neutral"].includes(outcome) || !outcome) return;
    const scope = JSON.stringify([...context, kind, name, environment, discriminator]);
    rows.push(
      validateMeasurement({
        schema: 1,
        id: `${run.id}:${attempt}:${hash(scope)}`,
        scope,
        kind,
        name,
        environment,
        commit: run.head_sha,
        runId: run.id,
        attempt,
        url: url || run.html_url,
        outcome,
        startedAt: start,
        finishedAt: end,
        durationMs,
      }),
    );
  };
  const timed = jobs.filter(
    (j) => validTime(j.started_at) && validTime(j.completed_at) && j.conclusion !== "skipped",
  );
  if (timed.length) {
    const start = new Date(Math.min(...timed.map((j) => Date.parse(j.started_at)))).toISOString();
    const end = new Date(Math.max(...timed.map((j) => Date.parse(j.completed_at)))).toISOString();
    const environment = [...new Set(timed.map((j) => [...(j.labels || [])].sort().join(",")))]
      .sort()
      .join(";");
    // Retry attempts can contain only a subset of jobs: never compare their total to a full run.
    add(
      "workflow",
      run.name,
      environment,
      start,
      end,
      run.conclusion,
      attempt === 1 ? "full" : "retry",
      run.html_url,
    );
    add(
      "queue",
      `${run.name} / initial queue`,
      environment,
      attempt === 1 ? run.created_at : run.run_started_at,
      start,
      run.conclusion,
      attempt === 1 ? "full" : "retry",
      run.html_url,
    );
  }
  for (const job of jobs) {
    const environment = [...(job.labels || [])].sort().join(",") || "unknown-runner";
    add(
      "job",
      job.name,
      environment,
      job.started_at,
      job.completed_at,
      job.conclusion,
      "",
      job.html_url,
    );
    const occurrences = new Map();
    for (const step of job.steps || []) {
      const occurrence = (occurrences.get(step.name) || 0) + 1;
      occurrences.set(step.name, occurrence);
      add(
        "step",
        `${job.name} / ${step.name}`,
        environment,
        step.started_at,
        step.completed_at,
        step.conclusion,
        occurrence,
        job.html_url,
      );
    }
  }
  return rows;
}

export function recordRegressions(existingBaselines, measurements) {
  const baselines = { ...existingBaselines };
  const rows = [...new Map(measurements.map((r) => [validateMeasurement(r).id, r])).values()].sort(
    (a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt) || a.id.localeCompare(b.id),
  );
  const regressions = [];
  for (const row of rows) {
    const baseline = baselines[row.scope];
    if (!baseline) {
      // One initial reference is necessary. It is not a slowdown log entry.
      baselines[row.scope] = { ...row, trendId: row.id };
      continue;
    }
    if (row.id === baseline.id) continue;
    // Delayed pre-fix evidence must not reopen a newly resolved trend.
    if (
      baseline.trendId?.startsWith("resolution:") &&
      Date.parse(row.finishedAt) <= Date.parse(baseline.finishedAt)
    )
      continue;
    if (row.durationMs * 100 >= baseline.durationMs * (100 + THRESHOLD_PERCENT)) {
      regressions.push({
        schema: 1,
        id: row.id,
        trendId: baseline.trendId || baseline.id,
        recordedAt: row.finishedAt,
        kind: row.kind,
        name: row.name,
        scope: row.scope,
        environment: row.environment,
        commit: row.commit,
        outcome: row.outcome,
        baseline: {
          id: baseline.id,
          durationMs: baseline.durationMs,
          commit: baseline.commit,
          url: baseline.url,
          finishedAt: baseline.finishedAt,
          outcome: baseline.outcome,
        },
        current: {
          id: row.id,
          durationMs: row.durationMs,
          url: row.url,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
        },
        addedMs: row.durationMs - baseline.durationMs,
        increasePercent: Math.round((row.durationMs / baseline.durationMs - 1) * 10000) / 100,
        assessment: "unreviewed",
      });
      // Only a logged >=15% slowdown moves the reference. Faster and 1–14% slower
      // runs do not get duration records and cannot cause baseline drift.
      baselines[row.scope] = { ...row, trendId: baseline.trendId || baseline.id };
    }
  }
  return { baselines, regressions };
}

export function findRegressions(measurements) {
  return recordRegressions({}, measurements).regressions;
}

export function applyResolution(baselines, resolution) {
  const previous = baselines[resolution.scope];
  const verified = validateMeasurement(resolution.verified);
  if (!resolution.id || !resolution.reason?.trim())
    throw Error("Resolution needs an ID and evidence-backed explanation");
  if (verified.scope !== resolution.scope || verified.outcome !== "success")
    throw Error("Resolution must contain a successful comparable verification");
  if (!previous || previous.id !== resolution.expectedBaselineId)
    return {
      ...resolution,
      status: "stale_reference",
      message: "New timing evidence changed the reference; investigate before resetting",
    };
  if (
    verified.durationMs >= previous.durationMs ||
    Date.parse(verified.finishedAt) <= Date.parse(previous.finishedAt)
  )
    throw Error("Resolution verification must be later and faster than the recorded slowdown");
  baselines[resolution.scope] = { ...verified, trendId: resolution.id };
  return { ...resolution, status: "resolved", closedTrendId: previous.trendId || previous.id };
}

export function summarizeTrends(rows, resolutions = []) {
  const closed = new Map(
    resolutions.filter((r) => r.status === "resolved").map((r) => [r.closedTrendId, r]),
  );
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.scope}:${row.trendId}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const first = group[0],
        last = group.at(-1);
      return {
        name: last.name,
        scope: last.scope,
        trendId: last.trendId,
        status: closed.has(last.trendId) ? "resolved" : "open",
        increases: group.length,
        initialMs: first.baseline.durationMs,
        latestMs: last.current.durationMs,
        addedMs: last.current.durationMs - first.baseline.durationMs,
        increasePercent:
          Math.round((last.current.durationMs / first.baseline.durationMs - 1) * 10000) / 100,
      };
    });
}

const cell = (s) =>
  String(s)
    .replaceAll("|", "\\|")
    .replace(/[\r\n]/g, " ")
    .replaceAll("<", "&lt;");
export function renderRegressions(rows, resolutions = []) {
  const closed = new Map(
    resolutions.filter((r) => r.status === "resolved").map((r) => [r.closedTrendId, r]),
  );
  let text =
    "# Performance regression log\n\nMeasured slowdowns of **15% or more** against the last logged comparable duration (or the initial reference). Faster and sub-15% runs are not logged and do not change the reference. Entries are signals for analysis, not proof of a code regression. Raw evidence is preserved in `regressions.jsonl`; current references are in `baselines.json`.\n\n";
  text +=
    "GitHub step timestamps have one-second resolution. Queue time is separate; overlapping jobs are not added together. Full audits must review this log and the measurement policy in main's `docs/PERFORMANCE.md`.\n\n";
  const trends = summarizeTrends(rows, resolutions);
  if (trends.length) {
    text +=
      "## Repeated increases\n\nOpen trends require investigation. Resolved trends retain their history; each verified reset begins a separate trend.\n\n| Operation | State | Logged increases | Original → latest | Total added | Cumulative increase |\n| --- | --- | ---: | ---: | ---: | ---: |\n";
    for (const t of trends)
      text += `| ${cell(t.name)} | ${t.status} | ${t.increases} | ${t.initialMs / 1000}s → ${t.latestMs / 1000}s | +${t.addedMs / 1000}s | +${t.increasePercent}% |\n`;
    text += "\n";
  }
  text += "## Recorded slowdowns\n\n";
  text +=
    "| Date (UTC) | Operation | Before → after | Added | Increase | Result | State | Evidence |\n| --- | --- | ---: | ---: | ---: | --- | --- | --- |\n";
  for (const r of [...rows].reverse())
    text += `| ${cell(r.recordedAt)} | ${cell(r.kind)}: ${cell(r.name)} | ${r.baseline.durationMs / 1000}s → ${r.current.durationMs / 1000}s | +${r.addedMs / 1000}s | +${r.increasePercent}% | ${cell(r.outcome)} | ${closed.has(r.trendId) ? "resolved" : "open"} | [Before](${r.baseline.url}) · [After](${r.current.url}) |\n`;
  if (resolutions.length) {
    text +=
      "\n## Verified resolutions and reset requests\n\n| Recorded | State | Reason | New reference | Verification |\n| --- | --- | --- | ---: | --- |\n";
    for (const r of resolutions)
      text += `| ${cell(r.confirmedAt)} | ${cell(r.status)} | ${cell(r.reason)} | ${r.verified.durationMs / 1000}s | [Evidence](${r.verified.url}) |\n`;
  }
  return text;
}
