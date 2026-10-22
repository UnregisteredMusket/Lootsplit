// Per-case account audit timings as one GitHub notice annotation. CI artifacts (traces,
// results.json) and job logs can be unreachable from agent sandboxes, but annotations are
// readable through the REST API. WEBSITE-ACCOUNTS.md asks for per-case durations and the
// worker timeline before any account timeout change; this keeps them readable everywhere.

const seconds = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : "?");

/** Flattens a Playwright JSON report into one row per test result, in start order. */
export function accountCaseTimings(report) {
  const rows = [];
  const visit = (suite) => {
    for (const spec of suite?.specs ?? [])
      for (const test of spec.tests ?? [])
        for (const result of test.results ?? []) {
          const annotations = [...(result.annotations ?? []), ...(test.annotations ?? [])];
          const seen = new Set();
          const phases = [];
          for (const a of annotations) {
            if (a?.type !== "phase" || seen.has(a.description)) continue;
            seen.add(a.description);
            phases.push(a.description);
          }
          rows.push({
            title: spec.title,
            status: result.status,
            duration: result.duration,
            worker: result.workerIndex ?? result.parallelIndex,
            start: Date.parse(result.startTime),
            phases,
          });
        }
    for (const child of suite?.suites ?? []) visit(child);
  };
  for (const suite of report?.suites ?? []) visit(suite);
  return rows.sort((a, b) => (a.start || 0) - (b.start || 0));
}

/** "ownership passed 52.3s w0 +0.0s" per case, then each case's recorded phase marks. */
export function accountDurationSummary(report) {
  const rows = accountCaseTimings(report);
  if (!rows.length) return "No account cases were reported (results.json had no results).";
  const first = Math.min(...rows.map((r) => r.start).filter(Number.isFinite));
  const lines = rows.map((r) => {
    const offset = seconds(r.start - first);
    return `${r.title} ${r.status} ${seconds(r.duration)}s w${r.worker ?? "?"} +${offset}s`;
  });
  for (const r of rows)
    if (r.phases.length) lines.push(`${r.title} phases: ${r.phases.join(", ")}`);
  return lines.join("\n");
}

export function noticeAnnotation(title, text) {
  const escape = (value) =>
    String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::notice title=${escape(title).replace(/[:,]/g, " ")}::${escape(text)}`;
}
