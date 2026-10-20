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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))
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
    : "No significant changes in comparable available readings.";
  const missing = comparisons.filter((c) => c.current === null).length;
  return `${summary} ${problems.length ? `${problems.length} component(s) need attention; review diagnostics.` : "No action indicated by the available checks."}${missing ? ` ${missing} readings are unavailable; this is incomplete coverage.` : ""}`;
}
export function taskView(task, now, settings = DEFAULT_CONFIG) {
  if (!task) return { task: null, warning: null, label: "No development task active" };
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
      active: !TERMINAL.includes(task.state),
    },
    warning,
    label: TERMINAL.includes(task.state) ? "No development task active" : task.title,
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
export function diagnostic(previous, check, now) {
  const failed = check.state === "error";
  const unknown = !["healthy", "error"].includes(check.state);
  const preserveFailure = unknown && previous?.confirmedFailure === true;
  const bad = failed || unknown;
  return {
    ...check,
    color: failed || preserveFailure ? "red" : unknown ? "yellow" : "green",
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
export function overall(checks) {
  const required = checks.filter((c) => c.required !== false);
  const color = required.some((c) => c.color === "red")
    ? "red"
    : !required.length || required.some((c) => c.color !== "green")
      ? "yellow"
      : "green";
  return {
    color,
    label:
      color === "green"
        ? "Required checks current and healthy"
        : color === "red"
          ? "Confirmed error needs attention"
          : "Current status cannot be fully verified",
    reason:
      required
        .filter((c) => c.color === color && color !== "green")
        .map((c) => c.component)
        .join(", ") || "All required checks passed.",
  };
}
