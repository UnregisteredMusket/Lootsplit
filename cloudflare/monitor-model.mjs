/** Pure, shared operational semantics. All durations are milliseconds, all instants UTC epoch ms. */
export const INTERVAL = 30 * 60 * 1000;
export const DEFAULT_CONFIG = Object.freeze({
  timezone: "America/New_York",
  reportTime: "00:10",
  heartbeatMs: 5 * 60000,
  progressMs: 30 * 60000,
  deviceFreshMs: 65 * 60000,
});
export const TASK_STATES = [
  "queued",
  "active",
  "testing",
  "deploying",
  "paused",
  "blocked",
  "completed",
  "failed",
  "idle",
];
export const WORKING = ["active", "testing", "deploying"];
export const TERMINAL = ["completed", "failed", "idle"];
export const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function clean(value, max = 500) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    [...value].some((c) => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t")
  )
    fail("Check the text length and remove control characters.");
  // Operational inputs are deliberately text-only. Never store bearer credentials.
  if (/\b(?:Bearer\s+\S+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/i.test(value))
    fail("Remove credentials from monitoring text.");
  return value.trim();
}
export function links(value = []) {
  if (!Array.isArray(value) || value.length > 20) fail("Use at most 20 evidence links.");
  return value.map((item) => {
    const url = new URL(clean(item.url, 2000));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["github.com", "dash.cloudflare.com", "lootsplit.oliverstorie2017.workers.dev"].includes(
        url.hostname,
      )
    )
      fail("Use a credential-free Lootsplit, GitHub or Cloudflare evidence URL.");
    return { label: clean(item.label, 100), url: url.href };
  });
}
export function config(input) {
  const next = { ...DEFAULT_CONFIG, ...input };
  try {
    new Intl.DateTimeFormat("en", { timeZone: next.timezone }).format();
  } catch {
    fail("Choose a valid IANA timezone.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.reportTime)) fail("Use a 24-hour report time, HH:MM.");
  for (const key of ["heartbeatMs", "progressMs", "deviceFreshMs"])
    if (!Number.isSafeInteger(next[key]) || next[key] < 60000 || next[key] > 7 * 86400000)
      fail("Thresholds must be between one minute and seven days.");
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map((key) => [key, next[key]]));
}
export function localCalendar(at, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}
export function previousDay(day) {
  return new Date(Date.parse(day + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
}
export function dayBounds(day, timezone) {
  // Date.parse accepts impossible dates such as 2026-02-31; require an exact round trip.
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(Date.parse(day)) ||
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day
  )
    fail("Use a calendar date, YYYY-MM-DD.");
  // Binary search local calendar boundaries: 23/25-hour days and non-hour offsets are preserved.
  const center = Date.parse(day + "T12:00:00Z");
  function boundary(target) {
    let lo = center - 2 * 86400000,
      hi = center + 2 * 86400000;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (localCalendar(mid, timezone).day < target) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  const next = new Date(center + 86400000).toISOString().slice(0, 10);
  return { start: boundary(day), end: boundary(next) };
}
export function compareMetric(previous, current) {
  const base = {
    key: current.key,
    label: current.label,
    kind: current.kind,
    unit: current.unit,
    windowMs: current.windowMs ?? null,
    previous: previous?.value ?? null,
    current: current.value ?? null,
    change: null,
    percent: null,
    reason: null,
  };
  if (!Number.isFinite(current.value) || !Number.isFinite(previous?.value))
    return { ...base, reason: "A comparable reading is unavailable." };
  if (
    previous.kind !== current.kind ||
    previous.unit !== current.unit ||
    previous.windowMs !== current.windowMs
  )
    return { ...base, reason: "Measurement scope or window changed." };
  if (current.kind === "cumulative" && current.value < previous.value)
    return {
      ...base,
      reason: "Counter reset or source records removed; no negative activity is inferred.",
    };
  const change = current.value - previous.value;
  return {
    ...base,
    change,
    percent: previous.value === 0 ? null : (change / Math.abs(previous.value)) * 100,
    reason: previous.value === 0 && change !== 0 ? "Zero baseline; percentage is undefined." : null,
  };
}
export function compareMetrics(previous = [], current = []) {
  return current.map((item) =>
    compareMetric(
      previous.find((p) => p.key === item.key),
      item,
    ),
  );
}
export function explanation(comparisons, problems = []) {
  const changed = comparisons.filter((c) => c.change !== null && c.change !== 0);
  const summary = changed.length
    ? changed
        .slice(0, 4)
        .map(
          (c) =>
            `${c.label}: ${c.previous} → ${c.current} ${c.unit} (${c.change > 0 ? "+" : ""}${c.change}${c.percent === null ? "" : `, ${c.percent.toFixed(1)}%`}).`,
        )
        .join(" ")
    : comparisons.some((c) => c.change !== null)
      ? "No significant changes in comparable available readings."
      : "No comparable earlier readings are available; change cannot yet be measured.";
  const missing = comparisons.filter((c) => c.current === null).length;
  const meaning = [
    changed.some((c) => c.key.startsWith("active"))
      ? "Recent sign-in activity changed; this does not count every visitor or prove people are playing now."
      : "",
    changed.some((c) =>
      ["accounts", "campaigns", "backups", "sessions", "transactions"].includes(c.key),
    )
      ? "Stored records changed; these totals describe saved account or campaign data."
      : "",
    changed.some((c) => c.key === "requests")
      ? "Request volume measures traffic handled during equal half-hour windows."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const errors = comparisons.find((c) => c.key === "errors")?.current;
  const action =
    errors > 0
      ? `${errors} Worker errors were observed; inspect invocation logs to identify affected requests and the cause.`
      : "No action indicated by the available checks.";
  return `${summary}${meaning ? ` ${meaning}` : ""} ${problems.length ? `${problems.join(", ")} could not be fully verified; review their diagnostics.` : action}${problems.length && errors > 0 ? ` ${action}` : ""}${missing ? ` ${missing} readings are unavailable; this is incomplete coverage.` : ""}`;
}
// Read-time only: a stored workflow step whose run is known to have ended without the step
// reporting a result. The stored row is never rewritten; `storedState` keeps what it recorded.
export const INTERRUPTED = "interrupted";
// A workflow step older than this, outside the scanned GitHub runs and followed by a newer
// finished step on its branch, is treated as superseded rather than as live development.
export const WORKFLOW_ORPHAN_MS = 6 * 3600000;
export function workflowTaskRun(task) {
  const match = /^run:(\d+):(\d+):/.exec(task?.id || "");
  return task?.source === "workflow" && match
    ? { runId: Number(match[1]), attempt: Number(match[2]) }
    : null;
}
/**
 * Whether GitHub evidence shows that a non-terminal workflow step can no longer report.
 * Returns null (no evidence: keep the stored state and its warnings) or the reason it ended.
 * `development` is the owner monitor's GitHub source; unavailable data never ends a task.
 * `newestFinishedOnBranch` maps branch -> the newest heartbeat of a finished workflow step.
 */
export function workflowTaskEnded(task, development, now, newestFinishedOnBranch = null) {
  if (!task || TERMINAL.includes(task.state)) return null;
  const ref = workflowTaskRun(task);
  if (!ref) return null;
  return (
    workflowRunEnded(task, ref, development, now, newestFinishedOnBranch) ??
    stepDeadlinePassed(task, ref, now)
  );
}
// A workflow step's runner (scripts/recovery-step.mjs) kills its command at the declared deadline
// and reports the result. A step past that deadline, with no heartbeat for this long, can no
// longer be running even when GitHub data is unavailable or the run is older than the scan.
export const STEP_DEADLINE_GRACE_MS = 15 * 60000;
function stepDeadlinePassed(task, ref, now) {
  const deadline = task.expectedUntil;
  if (
    !Number.isSafeInteger(deadline) ||
    now - deadline <= STEP_DEADLINE_GRACE_MS ||
    now - task.heartbeatAt <= STEP_DEADLINE_GRACE_MS
  )
    return null;
  return {
    reason: "deadline-passed",
    runId: ref.runId,
    conclusion: null,
    url: null,
    at: null,
    progress: `The step's declared deadline (${new Date(deadline).toISOString()}) passed without a reported result; its runner stops the step at that deadline, so it is no longer running. Telemetry last arrived ${new Date(task.heartbeatAt).toISOString()}.`,
  };
}
function workflowRunEnded(task, ref, development, now, newestFinishedOnBranch) {
  if (development?.state !== "ready" || !Array.isArray(development.data?.runs)) return null;
  const run = development.data.runs.find((r) => r.id === ref.runId);
  if (run) {
    if (Number.isSafeInteger(run.attempt) && run.attempt > ref.attempt)
      return {
        reason: "rerun",
        runId: run.id,
        conclusion: null,
        url: run.url || null,
        at: run.startedAt || null,
        progress: `Run attempt ${ref.attempt} was replaced by attempt ${run.attempt} before this step reported a result.`,
      };
    if (run.status !== "completed") return null;
    return {
      reason: "run-completed",
      runId: run.id,
      conclusion: run.conclusion || null,
      url: run.url || null,
      at: run.updatedAt || null,
      progress:
        run.conclusion === "cancelled"
          ? "Run cancelled before this step reported a result."
          : `Run ended (${run.conclusion || "no conclusion"}) before this step reported a result.`,
    };
  }
  // Outside the scanned run window: only a stale step with a newer finished step is superseded.
  const newer = newestFinishedOnBranch?.get?.(task.branch || "");
  if (now - task.heartbeatAt > WORKFLOW_ORPHAN_MS && newer > task.heartbeatAt)
    return {
      reason: "superseded",
      runId: ref.runId,
      conclusion: null,
      url: null,
      at: null,
      progress:
        "Superseded: no result was reported, the run is older than the scanned GitHub runs, and a newer workflow step on this branch has since finished.",
    };
  return null;
}
/** The presented (not stored) form of a workflow step that GitHub shows has ended. */
export function interruptedTask(task, ended) {
  return {
    ...task,
    state: INTERRUPTED,
    storedState: task.state,
    progress: ended.progress,
    completedAt: ended.at && ended.at >= task.startedAt ? ended.at : task.heartbeatAt,
    expectedUntil: null,
    endedBy: {
      reason: ended.reason,
      runId: ended.runId,
      conclusion: ended.conclusion,
      url: ended.url,
    },
    nextAction:
      ended.reason === "run-completed" && ended.conclusion === "cancelled"
        ? "No action needed if a newer run replaced it; otherwise re-run the workflow."
        : "Check the linked workflow run for the step's result.",
  };
}
export function taskView(task, now, settings = DEFAULT_CONFIG) {
  if (!task) return { task: null, warning: null, label: "No development task active" };
  const ended = TERMINAL.includes(task.state) || task.state === INTERRUPTED;
  const active = WORKING.includes(task.state);
  const heartbeatAge = now - task.heartbeatAt,
    progressAge = now - task.progressAt;
  const expectedUntil = task.expectedUntil || 0;
  let warning = null;
  if (active && heartbeatAge > settings.heartbeatMs)
    warning = {
      kind: "missing-telemetry",
      thresholdMs: settings.heartbeatMs,
      telemetryArriving: false,
      message: `${task.title}: activity telemetry last arrived ${Math.floor(heartbeatAge / 60000)} minutes ago, exceeding the ${Math.floor(settings.heartbeatMs / 60000)}-minute heartbeat threshold. Development may still be running; a disconnected source does not confirm a stall.`,
    };
  else if (active && now > expectedUntil && progressAge > settings.progressMs)
    warning = {
      kind: "possible-stall",
      thresholdMs: settings.progressMs,
      telemetryArriving: true,
      message: `${task.title}: telemetry is arriving, but meaningful progress was last recorded ${Math.floor(progressAge / 60000)} minutes ago, exceeding the ${Math.floor(settings.progressMs / 60000)}-minute progress threshold. Check the current step before declaring failure.`,
    };
  if (warning)
    Object.assign(warning, {
      taskId: task.id,
      progressAt: task.progressAt,
      heartbeatAt: task.heartbeatAt,
      blocker: task.blocker,
      nextAction:
        task.nextAction || "Check the linked workflow or ask the task owner for a progress update.",
    });
  return {
    task: {
      ...task,
      totalElapsedMs: Math.max(0, (task.completedAt || now) - task.startedAt),
      active: !ended,
    },
    warning,
    label: ended ? "No development task active" : task.title,
  };
}
export function transitionTask(previous, input, now, settings = DEFAULT_CONFIG) {
  const id = clean(input.id, 120);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(id)) fail("Use a stable task identifier.");
  const state = input.state ?? previous?.state;
  if (!TASK_STATES.includes(state)) fail("Choose a supported task state.");
  if (previous && TERMINAL.includes(previous.state))
    fail("This task is finished. Start a new update identifier.", 409);
  const title = input.title === undefined ? previous?.title : clean(input.title, 160);
  const objective =
    input.objective === undefined ? previous?.objective : clean(input.objective, 600);
  if (!title || !objective) fail("A task needs a title and plain-English objective.");
  const progress =
    input.progress === undefined ? previous?.progress || "" : clean(input.progress, 1000);
  const meaningful =
    !previous ||
    progress !== previous.progress ||
    state !== previous.state ||
    (input.phase !== undefined && input.phase !== previous.phase);
  const timings = {
    active: 0,
    testing: 0,
    deploying: 0,
    paused: 0,
    blocked: 0,
    queued: 0,
    ...(previous?.timings || {}),
  };
  let unobservedMs = previous?.unobservedMs || 0;
  if (previous) {
    const duration = Math.max(0, now - previous.heartbeatAt);
    // A telemetry gap is not measured work. Only heartbeat-bounded spans are recorded active time.
    const recorded =
      WORKING.includes(previous.state) && duration > settings.heartbeatMs ? 0 : duration;
    timings[previous.state] = (timings[previous.state] || 0) + recorded;
    unobservedMs += duration - recorded;
  }
  const expectedUntil =
    input.expectedUntil === undefined ? previous?.expectedUntil || null : input.expectedUntil;
  if (
    input.expectedUntil !== undefined &&
    expectedUntil !== null &&
    (!Number.isSafeInteger(expectedUntil) ||
      expectedUntil < now ||
      expectedUntil > now + 7 * 86400000)
  )
    fail("Expected completion must be within the next seven days.");
  return {
    id,
    title,
    objective,
    state,
    source: input.source === "workflow" ? "workflow" : previous?.source || "owner",
    phase: input.phase === undefined ? previous?.phase || state : clean(input.phase, 160),
    progress,
    startedAt: previous?.startedAt || now,
    heartbeatAt: now,
    progressAt: meaningful ? now : previous.progressAt,
    completedAt: TERMINAL.includes(state) ? now : null,
    expectedUntil,
    timings,
    unobservedMs,
    blocker: input.blocker === undefined ? previous?.blocker || "" : clean(input.blocker, 600),
    nextAction:
      input.nextAction === undefined ? previous?.nextAction || "" : clean(input.nextAction, 600),
    branch: input.branch === undefined ? previous?.branch || "" : clean(input.branch, 160),
    commit: input.commit === undefined ? previous?.commit || "" : clean(input.commit, 40),
    links: input.links === undefined ? previous?.links || [] : links(input.links),
    revision: (previous?.revision || 0) + 1,
  };
}
// Neither a success nor a gap: a skipped/superseded result, or a component retired because its
// branch finished. Shown green so it is not attention; it never records a success.
export const NOT_ATTENTION = ["not-applicable", "retired"];
// A confirmed, current reading of a recent problem that is no longer occurring (for example Worker
// errors earlier in the 24-hour window but none in the latest half-hour). Amber, not a failure.
export const WARNING = "warning";
export function diagnostic(previous, check, now) {
  const failed = check.state === "error";
  const settled = NOT_ATTENTION.includes(check.state);
  const warning = check.state === WARNING;
  const unknown = !settled && !warning && !["healthy", "error"].includes(check.state);
  const preserveFailure = unknown && previous?.confirmedFailure === true;
  const bad = failed || unknown || warning;
  return {
    ...check,
    color: failed || preserveFailure ? "red" : unknown || warning ? "yellow" : "green",
    confirmedFailure: failed || preserveFailure,
    firstOccurredAt: bad ? previous?.firstOccurredAt || now : null,
    latestCheckAt: now,
    lastSuccessAt: check.state === "healthy" ? now : previous?.lastSuccessAt || null,
    durationMs: bad ? now - (previous?.firstOccurredAt || now) : 0,
    retainedFailure: preserveFailure,
    confirmedCause: check.confirmedCause || null,
    suspectedCause: check.suspectedCause || null,
    recoveredAt: !bad && previous?.firstOccurredAt ? now : previous?.recoveredAt || null,
    symptom: preserveFailure
      ? `${check.symptom} The previous confirmed failure has not yet been rechecked.`
      : check.symptom,
  };
}
/**
 * Overall status from the required checks. `status` separates the two amber meanings:
 * "attention" (only confirmed recent problems that are not current) and "unverified" (a required
 * check could not be verified). Checks with `required: false` are coverage limits: they never decide
 * the status, are named in `notes` and the reason, and stay listed in the diagnostics.
 */
export function overall(checks) {
  const required = checks.filter((c) => c.required !== false);
  const notes = checks
    .filter((c) => c.required === false && c.color !== "green")
    .map((c) => c.component);
  const color = required.some((c) => c.color === "red")
    ? "red"
    : !required.length || required.some((c) => c.color !== "green")
      ? "yellow"
      : "green";
  const status =
    color === "red"
      ? "failure"
      : color === "green"
        ? "healthy"
        : required.length &&
            required.every(
              (c) => c.color === "green" || (c.color === "yellow" && c.state === WARNING),
            )
          ? "attention"
          : "unverified";
  const note = notes.length ? ` Coverage limit noted (not a failure): ${notes.join(", ")}.` : "";
  return {
    color,
    status,
    label:
      status === "healthy"
        ? "Required checks current and healthy"
        : status === "failure"
          ? "Confirmed error needs attention"
          : status === "attention"
            ? "Recent problem needs review; current checks pass"
            : "Current status cannot be fully verified",
    reason:
      (required
        .filter((c) => c.color === color && color !== "green")
        .map((c) => c.component)
        .join(", ") || "All required checks passed.") + (color === "green" ? note : ""),
    notes,
  };
}
/** An error rate at or above this (1%) over the 24-hour window is a failure even if errors stopped. */
export const WORKER_ERROR_RATE_FAILURE = 0.01;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/**
 * Rate- and recency-aware Worker error check. `traffic` is the rolling 24-hour reading
 * ({requests, errors, since, until}) or null; `intervals` are scheduled half-hour readings
 * ({slot, errors}, window [slot-30m, slot), errors null when unmeasured).
 * - error (red): errors in the newest measured half-hour, errors that no measured half-hour accounts
 *   for (recency not established, e.g. the minutes since the last scheduled collection), or a
 *   24-hour error rate of at least 1%.
 * - warning (amber): every error is in an earlier measured half-hour and none since.
 * Raw counts, rate and the last error window are kept on the check for details and history.
 */
export function workerErrorCheck(traffic, intervals = []) {
  const errors = traffic?.errors,
    requests = traffic?.requests;
  if (!Number.isSafeInteger(errors) || errors < 0)
    return { state: "unavailable", symptom: "The measured Worker error count is unavailable." };
  const base = `${errors} Worker error(s) were reported in the measured past-24-hour window`;
  const fields = {
    errorCount: errors,
    requestCount: Number.isSafeInteger(requests) ? requests : null,
    errorRate: Number.isSafeInteger(requests) && requests > 0 ? errors / requests : null,
    brief: `${plural(errors, "error")} in 24h`,
  };
  if (errors === 0)
    return {
      state: "healthy",
      symptom: `${base}${fields.requestCount === null ? "" : ` (${fields.requestCount} requests)`}.`,
      ...fields,
      lastAt: null,
    };
  const start = Date.parse(traffic.since),
    end = Date.parse(traffic.until);
  const overlapping = (Number.isFinite(start) && Number.isFinite(end) ? intervals : [])
    .filter((i) => Number.isSafeInteger(i?.slot) && i.slot > start && i.slot - INTERVAL < end)
    .sort((a, b) => b.slot - a.slot);
  const measured = overlapping.filter((i) => Number.isSafeInteger(i.errors) && i.errors >= 0);
  const attributed = measured.reduce((sum, i) => sum + i.errors, 0);
  const newest = overlapping[0];
  const lastError = measured.find((i) => i.errors > 0) || null;
  const lastErrorWindow = lastError
    ? { start: lastError.slot - INTERVAL, end: lastError.slot }
    : null;
  const unattributed = Math.max(0, errors - attributed);
  const rate = fields.errorRate;
  const ratio =
    rate === null
      ? ""
      : ` (${(rate * 100).toFixed(rate < 0.001 ? 3 : 1)}% of ${fields.requestCount} requests)`;
  const iso = (at) => new Date(at).toISOString();
  const windowText = lastErrorWindow
    ? ` Last half-hour with errors: ${iso(lastErrorWindow.start)}–${iso(lastErrorWindow.end)} (${lastError.errors}).`
    : "";
  const reasons = [];
  if (newest && Number.isSafeInteger(newest.errors) && newest.errors > 0)
    reasons.push(`errors occurred in the newest measured half-hour (ending ${iso(newest.slot)})`);
  if (unattributed > 0)
    reasons.push(
      `${plural(unattributed, "error")} ${unattributed === 1 ? "is" : "are"} not in any measured half-hour, so ${unattributed === 1 ? "it" : "they"} may be current`,
    );
  if (rate !== null && rate >= WORKER_ERROR_RATE_FAILURE)
    reasons.push(`the error rate is at least ${WORKER_ERROR_RATE_FAILURE * 100}%`);
  if (rate === null) reasons.push("the request count is unavailable, so the error rate is unknown");
  const later = lastError ? measured.filter((i) => i.slot > lastError.slot).length : 0;
  return {
    state: reasons.length ? "error" : WARNING,
    symptom: reasons.length
      ? `${base}${ratio}; ${reasons.join("; ")}.${windowText}`
      : `${base}${ratio}. None since: ${later ? `the ${plural(later, "later measured half-hour")} through ${iso(measured[0].slot)} had no errors` : "the 24-hour total is fully accounted for by earlier measured half-hours"}.${windowText}`,
    ...fields,
    lastAt: lastErrorWindow?.end ?? null,
    lastErrorWindow,
  };
}
