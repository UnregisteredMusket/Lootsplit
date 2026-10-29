import {
  authorizeOwner,
  collectOwnerMonitor,
  cloudflareTraffic,
  providerFailure,
  providerErrorCode,
} from "./owner-monitor.mjs";
import { staffCommitGuard } from "./members.mjs";
import { PROBE_FRESH_MS, runMultiplayerProbe } from "./multiplayer-probe.mjs";
import {
  cloudflareUsage,
  usageSummary,
  usageLines,
  USAGE_HOUR,
  USAGE_STALE_MS,
  USAGE_ATTENTION_PERCENT,
  formatPercent,
} from "./cloudflare-usage.mjs";
import {
  INTERVAL,
  DEFAULT_CONFIG,
  config,
  clean,
  links,
  fail,
  localCalendar,
  previousDay,
  dayBounds,
  compareMetrics,
  explanation,
  taskView,
  transitionTask,
  diagnostic,
  overall,
  workflowTaskRun,
  workflowTaskEnded,
  interruptedTask,
  WORKFLOW_ORPHAN_MS,
  workerErrorCheck,
  widgetSeverity,
} from "./monitor-model.mjs";
import { notProbeRoom } from "./probe-namespace.mjs";

const REPO = "https://github.com/UnregisteredMusket/Lootsplit";
// Recent provider-cache snapshots retained; older cache rows are deleted (never history).
export const SNAPSHOT_CACHE_ROWS = 48;
// D1 rejects any row above 2,000,000 bytes. Reports above this budget summarize long lists.
export const REPORT_BYTE_BUDGET = 1_500_000;
// Minimum items kept per summarized section before a report is declared too large.
const REPORT_SECTION_FLOOR = 25;
// Failed report generation backs off 1, 2, 4 … 32 minutes; after this many attempts an
// explicitly failed placeholder lets later days continue. Generate previous day retries it.
const REPORT_MAX_ATTEMPTS = 6;
// Custom (non-built-in) registry entries; each adds work to every daily report.
const REGISTRY_CUSTOM_LIMIT = 50;
// Log rows stamped with a half-hour slot (window end) rather than an observation instant.
const SLOT_LOG = "source='monitoring' AND (id LIKE 'interval:%' OR id LIKE 'recovered:%')";
export const BUILTIN_LOGS = [
  [
    "monitoring",
    "Half-hour monitoring",
    "interval",
    INTERVAL * 2,
    "Authoritative scheduled observations, missing intervals and collection failures.",
  ],
  [
    "performance",
    "Performance regression history",
    "poll",
    2 * 3600000,
    "Inclusive 15% regressions and verified resolutions; original comparable scopes retained.",
  ],
  [
    "workflows",
    "Build, test, audit and deployment results",
    "poll",
    INTERVAL * 2,
    "GitHub workflow metadata; bounded history coverage is explicit.",
  ],
  [
    "development",
    "Development task and timing events",
    "event",
    0,
    "Explicit owner/workflow events; silence is not evidence of active development.",
  ],
  [
    "diagnostics",
    "Incidents and recovery events",
    "event",
    0,
    "Component observations, preserved failures and verified recovery.",
  ],
  [
    "devices",
    "Widget synchronization reports",
    "event",
    0,
    "Last report from each registered installation; no claim to observe sleeping devices.",
  ],
  [
    "reports",
    "Daily reports",
    "interval",
    26 * 3600000,
    "Calendar-day cross-reference and coverage evidence.",
  ],
  [
    "moderation",
    "Site administration audit",
    "poll",
    INTERVAL * 2,
    "Counts/actions only; excludes affected member identities.",
  ],
  [
    "bug-reports",
    "Application issue reports",
    "poll",
    INTERVAL * 2,
    "Aggregate report counts only; report content remains in its existing permission-controlled interface.",
  ],
  [
    "recovery",
    "Release recovery and failure reports",
    "poll",
    INTERVAL * 2,
    "GitHub recovery/failure workflows; their linked artifacts remain the original evidence.",
  ],
  [
    "multiplayer",
    "Multiplayer round-trip probe",
    "interval",
    INTERVAL * 2,
    "Synthetic open/join/message/read-back/cleanup through the real room path, once per half-hour collection; probe rooms are isolated from campaigns and totals.",
  ],
  [
    "cloudflare-usage",
    "Cloudflare plan usage",
    "interval",
    2 * USAGE_HOUR,
    "Hourly account-wide Worker requests and CPU time and D1 rows read, rows written and storage against the Workers Paid included allowance (daily and weekly shares and billing cycle to date, from the renewal day). An unavailable metric is an explicit gap, never zero.",
  ],
  [
    "room-storage",
    "Shared room size refusals and warnings",
    "event",
    0,
    "Room writes refused before D1's row limit, and warnings (nothing refused) when an archived session takes a campaign past the total size at which whole-campaign operations fit comfortably (one entry per room, kind and half-hour, with a size breakdown); silence means nothing was recorded, checked every half-hour.",
  ],
  [
    "campaign-limit",
    "Online campaign limit refusals",
    "event",
    0,
    "Accounts refused a new hosted online campaign at the per-account limit (one entry per account and path per half-hour, with a one-way account tag, the path and the live count); silence means no refusal was recorded, checked every half-hour.",
  ],
  [
    "runtime",
    "Worker invocation and application timing logs",
    "external",
    INTERVAL * 2,
    "Cloudflare retained runtime logs need a registered export/ingestion feed; request/error aggregates alone are not raw-log coverage.",
  ],
];
const decode = (row) => (row ? JSON.parse(row.body) : null);
/**
 * Retired spans of a registry entry, oldest first. `retirements` holds closed spans; `retired`
 * is the open one. Both live in the registry row's JSON body (no schema change).
 */
export function retiredSpans(source) {
  return [
    ...(source?.retirements || []),
    ...(source?.retired ? [{ ...source.retired, reinstatedAt: null, reinstatedBy: null }] : []),
  ];
}
/** [from, to] minus every retired span; what remains is the time a source was expected to report. */
export function activeSegments(from, to, spans) {
  let segments = from < to ? [[from, to]] : [];
  for (const span of spans) {
    const a = span.retiredAt,
      b = span.reinstatedAt ?? Infinity;
    segments = segments.flatMap(([x, y]) =>
      b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a]] : []), ...(b < y ? [[b, y]] : [])],
    );
  }
  return segments;
}
const registryView = (r) => {
  const source = decode(r);
  return {
    ...source,
    revision: source.revision || 0,
    retired: source.retired || null,
    retirements: source.retirements || [],
    registeredAt: r.registered_at,
    lastSuccessAt: r.last_success,
  };
};
const rows = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
const run = (db, sql, ...args) => statement(db, sql, ...args).run();
async function batches(db, statements) {
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40));
}
export async function initializeMonitor(db, now = Date.now()) {
  await run(
    db,
    "INSERT OR IGNORE INTO owner_monitor_config VALUES(1,?,?)",
    JSON.stringify(DEFAULT_CONFIG),
    now,
  );
  await batches(
    db,
    BUILTIN_LOGS.map(([id, name, mode, expectedMs, description]) =>
      statement(
        db,
        "INSERT OR IGNORE INTO owner_monitor_registry(id,body,registered_at) VALUES(?,?,?)",
        id,
        JSON.stringify({
          id,
          name,
          mode,
          expectedMs,
          description,
          url: `${REPO}/blob/main/docs/OWNER-MONITORING.md`,
          builtin: true,
        }),
        now,
      ),
    ),
  );
  return config(
    decode(await db.prepare("SELECT body FROM owner_monitor_config WHERE id=1").first()),
  );
}
export function logStatement(
  db,
  { id, source, observedAt, summary, ...body },
  collectedAt = Date.now(),
) {
  return statement(
    db,
    "INSERT OR IGNORE INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) VALUES(?,?,?,?,?,?)",
    id,
    source,
    observedAt,
    collectedAt,
    summary,
    JSON.stringify(body),
  );
}
export async function recordLog(db, entry, now = Date.now()) {
  await logStatement(db, entry, now).run();
}
async function bulkLogs(db, entries, now) {
  for (let i = 0; i < entries.length; i += 50) {
    const page = entries.slice(i, i + 50).map(({ id, source, observedAt, summary, ...body }) => ({
      id,
      source,
      observedAt,
      summary,
      body,
    }));
    await run(
      db,
      `INSERT OR IGNORE INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.source'),json_extract(value,'$.observedAt'),?,json_extract(value,'$.summary'),json_extract(value,'$.body') FROM json_each(?)`,
      now,
      JSON.stringify(page),
    );
  }
}
async function sourceSuccess(db, id, at) {
  await run(
    db,
    "UPDATE owner_monitor_registry SET last_success=MAX(COALESCE(last_success,0),?) WHERE id=?",
    at,
    id,
  );
}
async function attest(db, source, at, summary, now = at, coverageGap = null) {
  await recordLog(
    db,
    {
      id: `coverage:${source}:${Math.floor(now / INTERVAL)}`,
      source,
      observedAt: now,
      summary,
      coverage: true,
      sourceFreshAt: at,
      coverageGap,
    },
    now,
  );
  await sourceSuccess(db, source, at);
}
export function snapshotMetrics(snapshot, traffic) {
  const stats = snapshot.health?.stats,
    games = snapshot.analytics?.state === "ready" ? snapshot.analytics.data.metrics : null;
  const metric = (key, label, value, kind = "instant", windowMs) => ({
    key,
    label,
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
    kind,
    unit: "count",
    ...(windowMs === undefined ? {} : { windowMs }),
  });
  return [
    metric("accounts", "Accounts", stats?.accounts),
    metric("campaigns", "Stored campaigns", stats?.sharedCampaigns),
    metric("active5m", "Signed-in accounts in 5 minutes", stats?.active5m, "rolling", 300000),
    metric("active24h", "Signed-in accounts in 24 hours", stats?.active24h, "rolling", 86400000),
    metric("backups", "Cloud backups", stats?.cloudBackups),
    metric("sessions", "Recorded sessions in current campaigns", games?.sessions, "cumulative"),
    metric(
      "transactions",
      "Transactions in current campaigns",
      games?.transactionCount,
      "cumulative",
    ),
    metric(
      "requests",
      "Worker requests in scheduled half-hour",
      traffic?.state === "ready" ? traffic.data.requests : null,
      "interval",
      INTERVAL,
    ),
    metric(
      "errors",
      "Worker errors in scheduled half-hour",
      traffic?.state === "ready" ? traffic.data.errors : null,
      "interval",
      INTERVAL,
    ),
  ];
}
const TASK_ORDER = "(json_extract(body,'$.source')='owner') DESC,updated_at DESC,id DESC";
const TERMINAL_SQL = "json_extract(body,'$.state') IN ('completed','failed','idle')";
async function latestDevelopment(db) {
  const row = await db
    .prepare(
      "SELECT json_extract(body,'$.development') AS development FROM owner_monitor_snapshots ORDER BY revision DESC LIMIT 1",
    )
    .first();
  return row?.development ? JSON.parse(row.development) : null;
}
/**
 * The displayed development task. Stored rows are never rewritten here: a workflow step that
 * GitHub shows can no longer report (its run completed, was re-run, or was superseded) is
 * presented as interrupted and skipped when choosing the active task. Without GitHub data the
 * stored state, and any heartbeat warning, is shown unchanged.
 */
async function currentTask(db, now, settings, development) {
  if (development === undefined) development = await latestDevelopment(db);
  const live = await rows(
    db,
    `SELECT body FROM owner_monitor_tasks WHERE NOT ${TERMINAL_SQL} ORDER BY ${TASK_ORDER} LIMIT 200`,
  );
  const ended = [];
  let finishedByBranch = null;
  for (const row of live) {
    const task = decode(row);
    let end = workflowTaskEnded(task, development, now);
    const ref = workflowTaskRun(task);
    if (
      !end &&
      ref &&
      development?.state === "ready" &&
      now - task.heartbeatAt > WORKFLOW_ORPHAN_MS &&
      !(development.data?.runs || []).some((r) => r.id === ref.runId)
    ) {
      finishedByBranch ??= new Map(
        (
          await rows(
            db,
            `SELECT json_extract(body,'$.branch') AS branch,MAX(json_extract(body,'$.heartbeatAt')) AS at FROM owner_monitor_tasks WHERE json_extract(body,'$.source')='workflow' AND ${TERMINAL_SQL} GROUP BY 1`,
          )
        ).map((r) => [r.branch || "", r.at]),
      );
      end = workflowTaskEnded(task, development, now, finishedByBranch);
    }
    if (!end) return taskView(task, now, settings);
    ended.push(interruptedTask(task, end));
  }
  const terminal = decode(
    await db
      .prepare(
        `SELECT body FROM owner_monitor_tasks WHERE ${TERMINAL_SQL} ORDER BY ${TASK_ORDER} LIMIT 1`,
      )
      .first(),
  );
  const interrupted = ended.sort((a, b) => b.heartbeatAt - a.heartbeatAt)[0];
  return taskView(
    interrupted && (!terminal || interrupted.heartbeatAt > terminal.heartbeatAt)
      ? interrupted
      : terminal,
    now,
    settings,
  );
}
// Not build/test evidence: the failure reporter and the performance logger have their own logs.
const WORKFLOW_EXCLUDED = /performance|failure report|report workflow failure/i;
const WORKFLOW_FAILED = ["failure", "timed_out", "action_required", "startup_failure"];
const WORKFLOW_PASSED = ["success", "neutral"];
const workflowComponent = (name, branch) => `Workflow: ${name} (${branch})`;
const parseWorkflowComponent = (component) => {
  const match = /^Workflow: (.+) \(([^()]+)\)$/.exec(component);
  return match ? { name: match[1], branch: match[2] } : null;
};
/**
 * The run that decides a workflow's status, from its runs newest first. Skipped runs decide
 * nothing; a cancelled run followed by a newer (not skipped) run of the same workflow and
 * branch was superseded. A cancelled newest run with no successor is still returned (needs attention).
 */
export function decisiveRun(runs) {
  let newer = false; // a newer run that actually ran (or is running) exists
  for (const run of runs) {
    if (run.conclusion === "skipped") continue;
    if (run.status === "completed" && !(run.conclusion === "cancelled" && newer)) return run;
    newer = true;
  }
  return null;
}
/**
 * Manual, one-off audits (workflow_dispatch is their only trigger, enforced by a test against the
 * workflow files) whose subject another workflow re-checks on every release. Their cancelled run is
 * superseded once a newer successful run of the covering workflow on the same branch exists, because
 * nothing else will ever rerun them. Failed runs are not superseded and stay red. Owner-reviewed
 * rule (2026-10-25): `Deploy verified website` runs the same read-only live audits
 * (live-release-audit + website-browser-audit on every approved origin) after each deployment.
 */
export const MANUAL_COVERED_BY = new Map([
  ["Verify existing live website (read only)", "Deploy verified website"],
]);
/** The newest successful covering run newer than a cancelled manual run, or null. */
export function supersedingRun(run, runs, previous) {
  const cover = MANUAL_COVERED_BY.get(run?.name);
  if (!cover || run.conclusion !== "cancelled" || !Number.isSafeInteger(run.updatedAt)) return null;
  // A run recorded with its trigger must have been manual; older records carry no trigger.
  if (run.event && run.event !== "workflow_dispatch") return null;
  const remembered = previous?.get?.(workflowComponent(cover, run.branch));
  const candidates = [
    ...runs.filter((r) => r.name === cover && r.branch === run.branch),
    ...(remembered?.state === "healthy" && remembered.lastRun ? [remembered.lastRun] : []),
  ];
  let best = null;
  for (const r of candidates)
    if (
      r.status === "completed" &&
      r.conclusion === "success" &&
      Number.isSafeInteger(r.updatedAt) &&
      r.updatedAt > run.updatedAt &&
      (!best || r.updatedAt > best.updatedAt)
    )
      best = r;
  return best;
}
const runSummary = (run) =>
  run
    ? {
        id: run.id,
        name: run.name,
        branch: run.branch,
        status: run.status,
        conclusion: run.conclusion,
        event: run.event || null,
        url: run.url,
        startedAt: run.startedAt || null,
        updatedAt: run.updatedAt || null,
      }
    : null;
/** Last decisive run recorded in the retained workflow log (bounded window, used once). */
async function loggedDecisiveRun(db, name, branch, now) {
  const logged = await rows(
    db,
    "SELECT body FROM owner_monitor_logs WHERE source IN ('workflows','recovery') AND observed_at>=? AND json_extract(body,'$.workflow.name')=? AND json_extract(body,'$.workflow.branch')=? ORDER BY observed_at DESC LIMIT 60",
    now - 14 * 86400000,
    name,
    branch,
  );
  const byId = new Map();
  for (const row of logged) {
    const run = decode(row).workflow;
    if (run && !byId.has(run.id)) byId.set(run.id, run); // newest observation of each run
  }
  return decisiveRun(
    [...byId.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || b.id - a.id),
  );
}
/**
 * One component per workflow and branch. Main failures stay visible until a newer main run of
 * that workflow succeeds. A branch whose pull request finished is retired once, with the reason
 * recorded in its diagnostic and history entry; stored history rows are never deleted.
 */
async function workflowDiagnostics(db, development, previous, now, add) {
  const ready = development?.state === "ready";
  const data = (ready && development.data) || {};
  const runs = ready && Array.isArray(data.runs) ? data.runs : [];
  const open = Array.isArray(data.openPulls) ? data.openPulls : [];
  // Older cached readings carry no head branch; without it no branch is retired.
  const branchesKnown = ready && open.every((pr) => typeof pr.headRef === "string");
  const openBranches = new Set(open.map((pr) => pr.headRef).filter(Boolean));
  const closedByBranch = new Map();
  for (const pr of Array.isArray(data.closedPulls) ? data.closedPulls : [])
    if (pr.headRef && !closedByBranch.has(pr.headRef)) closedByBranch.set(pr.headRef, pr);
  const finished = (branch, seen) => {
    const pr = closedByBranch.get(branch);
    const at = pr?.mergedAt || pr?.closedAt;
    return pr
      ? `Pull request #${pr.number} for ${branch} was ${pr.mergedAt ? "merged" : "closed"}${at ? ` at ${new Date(at).toISOString()}` : ""}`
      : `${branch} has no open pull request${seen ? "" : " and no runs in the scanned GitHub history"}`;
  };
  const groups = new Map();
  for (const run of runs) {
    if (WORKFLOW_EXCLUDED.test(run.name)) continue;
    const component = workflowComponent(run.name, run.branch);
    if (!groups.has(component)) groups.set(component, []);
    groups.get(component).push(run); // GitHub lists runs newest first
  }
  let reported = 0;
  // A cancelled manual audit that a newer successful covering run superseded (MANUAL_COVERED_BY).
  const superseded = (component, decided) => {
    const cover = supersedingRun(decided, runs, previous);
    if (!cover) return false;
    const at = (t) => new Date(t).toISOString();
    report(
      component,
      "not-applicable",
      `${decided.name}: cancelled (manual run, last updated ${at(decided.updatedAt)}); superseded by ${cover.name}: success at ${at(cover.updatedAt)}, whose own read-only live audit passed. This manual audit never reruns on its own.`,
      decided,
      {
        historyChecked: true,
        supersededBy: runSummary(cover),
        evidence: [decided, cover].filter((r) => r.url).map((r) => ({ label: r.name, url: r.url })),
      },
    );
    return true;
  };
  const report = (component, state, symptom, run, extra = {}) => {
    if (state !== "retired") reported++;
    add(
      component,
      state,
      symptom,
      state === "retired"
        ? "This branch or workflow no longer affects the deployed version; its history is retained."
        : "A failed candidate does not replace the deployed version; review the linked run.",
      ["healthy", "retired", "not-applicable"].includes(state)
        ? "No action required."
        : "Inspect failed job evidence before retrying.",
      run?.conclusion || null,
      {
        evidence: run?.url ? [{ label: run.name, url: run.url }] : [],
        lastRun: runSummary(run),
        ...extra,
      },
    );
  };
  const fromRun = (run, previousCheck, note = "") => [
    WORKFLOW_FAILED.includes(run.conclusion)
      ? "error"
      : WORKFLOW_PASSED.includes(run.conclusion)
        ? // A remembered result older than a confirmed failure cannot clear that failure.
          previousCheck?.confirmedFailure &&
          (run.updatedAt || 0) < (previousCheck.firstOccurredAt || 0)
          ? "unavailable"
          : "healthy"
        : "unavailable",
    `${run.name}: ${run.conclusion}${note}.`,
  ];
  const placeholder = "Workflow: available results";
  const components = [
    ...groups.keys(),
    ...[...previous.keys()].filter(
      (c) => c.startsWith("Workflow:") && c !== placeholder && !groups.has(c),
    ),
  ];
  for (const component of components) {
    const list = groups.get(component) || [];
    const seen = list.length > 0;
    const previousCheck = previous.get(component);
    const retired = previousCheck?.state === "retired";
    const parsed = seen
      ? { name: list[0].name, branch: list[0].branch }
      : parseWorkflowComponent(component);
    if (!parsed || WORKFLOW_EXCLUDED.test(parsed.name)) {
      if (!retired)
        report(
          component,
          "retired",
          "This workflow reports failures or performance; it is not a build or test result.",
          null,
          { retiredAt: now },
        );
      continue;
    }
    if (!ready) {
      // Unchanged honest uncertainty: nothing is decided without GitHub data.
      // The remembered decisive run is kept for when GitHub data returns.
      if (!retired)
        report(component, "unavailable", "No completed build or test result was returned.", null, {
          lastRun: previousCheck?.lastRun || null,
          historyChecked: previousCheck?.historyChecked || false,
        });
      continue;
    }
    const { name, branch } = parsed;
    const run = decisiveRun(list);
    if (
      branch !== "main" &&
      branchesKnown &&
      // Only main and branches with an open pull request are monitored; opening a pull
      // request for the branch brings it back.
      !openBranches.has(branch)
    ) {
      if (!retired) {
        const last = run || previousCheck?.lastRun || null;
        report(
          component,
          "retired",
          `${finished(branch, seen)}; this branch is no longer monitored. Last result: ${last ? `${last.name}: ${last.conclusion}` : previousCheck?.symptom ? `not recorded (last check: ${previousCheck.symptom})` : "none recorded"}.`,
          last,
          { retiredAt: now, retiredBranch: branch, historyChecked: true },
        );
      }
      continue;
    }
    if (run) {
      if (superseded(component, run)) continue;
      const [state, symptom] = fromRun(run, null);
      report(component, state, symptom, run, { historyChecked: true });
      continue;
    }
    // Nothing decisive in the scanned runs: no newer result exists, so the last decisive run
    // (remembered, or found once in the retained workflow log) still decides.
    // A first sighting with nothing decisive (only running or skipped runs) adds no component,
    // as before: there is nothing to report yet.
    if (!previousCheck) continue;
    let known = previousCheck.lastRun || null;
    if (!known && !previousCheck.historyChecked)
      known = await loggedDecisiveRun(db, name, branch, now);
    if (known && superseded(component, known)) continue;
    if (known) {
      let [state, symptom] = fromRun(
        known,
        previousCheck,
        !seen
          ? "; latest run, older than the scanned GitHub runs"
          : list.some((r) => r.status !== "completed")
            ? "; a newer run is in progress"
            : "; newer runs were skipped or superseded",
      );
      // A confirmed failure that was not rechecked stays the retained (red) failure it was.
      if (state === "error" && previousCheck?.confirmedFailure) state = "unavailable";
      report(component, state, symptom, known, { historyChecked: true });
    } else if (seen && !previousCheck.confirmedFailure)
      report(
        component,
        "not-applicable",
        list.some((r) => r.status !== "completed")
          ? "A run is in progress; no completed result is recorded yet."
          : "Recent runs were skipped or superseded; there is no result to verify.",
        null,
        { historyChecked: true },
      );
    else
      report(component, "unavailable", "No completed build or test result was returned.", null, {
        historyChecked: true,
      });
  }
  // The placeholder means GitHub returned nothing usable, never that every result was filtered.
  if (!ready ? !reported : !runs.length)
    report(
      placeholder,
      "unavailable",
      ready
        ? "GitHub returned no workflow runs."
        : "No completed build or test result was returned.",
      null,
    );
  else if (ready && previous.has(placeholder) && previous.get(placeholder).state !== "retired")
    report(
      placeholder,
      "retired",
      "GitHub workflow results are available; each workflow is listed separately.",
      null,
      { retiredAt: now },
    );
}
/**
 * Widget synchronization (owner decision 2026-10-22): only installations that reported within
 * DEVICE_ACTIVE_MS count toward the check, so a retired phone cannot keep it amber forever. Older
 * installations are listed as inactive (information, not attention) and count again as soon as they
 * report. Device rows and their history are never deleted.
 */
export const DEVICE_ACTIVE_MS = 7 * 86400000;
export function widgetSyncCheck(devices, now, freshMs) {
  const active = devices.filter((d) => now - d.reported_at <= DEVICE_ACTIVE_MS);
  const inactive = devices
    .filter((d) => now - d.reported_at > DEVICE_ACTIVE_MS)
    .map((d) => ({ id: d.id ?? null, lastReportAt: d.reported_at }));
  const date = (at) => new Date(at).toISOString().slice(0, 10);
  const inactiveText = inactive.length
    ? ` ${inactive.length} inactive device(s) not counted: ${inactive
        .slice(0, 5)
        .map((d) => `inactive since ${date(d.lastReportAt)}`)
        .join("; ")}${inactive.length > 5 ? `; ${inactive.length - 5} more` : ""}.`
    : "";
  const late = active.filter((d) => now - d.reported_at > freshMs);
  const symptom = active.length
    ? `${active.length} active device(s); oldest report ${new Date(Math.min(...active.map((d) => d.reported_at))).toISOString()}${late.length ? `; ${late.length} not reported within ${Math.round(freshMs / 60000)} minutes` : ""}.${inactiveText}`
    : devices.length
      ? `No Android installation has reported in the last 7 days.${inactiveText}`
      : "No Android installation has reported yet.";
  return [
    active.length && !late.length ? "healthy" : "unavailable",
    symptom,
    "Android may delay delivery while asleep, offline or battery restricted. Backend collection continues.",
    "Open widget diagnostics, check connectivity and tap Refresh. Sign in only if authorization was rejected.",
    null,
    { activeDevices: active.length, inactiveDevices: inactive },
  ];
}
async function latestProbe(db) {
  return db
    .prepare(
      "SELECT observed_at,summary,body FROM owner_monitor_logs WHERE source='multiplayer' ORDER BY observed_at DESC,sequence DESC LIMIT 1",
    )
    .first();
}
/**
 * Multiplayer is a real, required check (owner-approved 2026-10-22): the newest synthetic round
 * trip decides it. A failed probe stays red until a newer probe passes; no probe, or only an old
 * pass, is unverified (amber), never healthy.
 */
export function multiplayerCheck(latest, now) {
  const impact = "Players may be unable to open, join or synchronize shared campaigns.";
  if (!latest)
    return [
      "unavailable",
      "No multiplayer round-trip probe has run yet; it runs with each half-hour collection.",
      impact,
      "Wait for the next scheduled collection; check Cron Triggers if none arrives.",
    ];
  const body = decode(latest),
    at = latest.observed_at,
    when = new Date(at).toISOString();
  if (body.outcome === "failed")
    return [
      "error",
      `${latest.summary} Probe at ${when}.`,
      impact,
      "Open a shared campaign to confirm, inspect Worker errors and D1 health, then wait for the next probe; the failure stays until a newer probe passes.",
      body.errorCode || "MULTIPLAYER_PROBE_FAILED",
      {
        brief: "round trip failed",
        lastAt: at,
        probe: { at, failedStep: body.failedStep ?? null },
      },
    ];
  if (now - at > PROBE_FRESH_MS)
    return [
      "unavailable",
      `The last multiplayer probe passed at ${when}; no newer probe has run.`,
      impact,
      "Check that half-hour collections are completing; the probe runs with each one.",
    ];
  return [
    "healthy",
    `${latest.summary} Probe at ${when}.`,
    "Opening, joining, messaging and polling a shared room worked end to end.",
    "No action required.",
    null,
    { probe: { at, durationMs: body.durationMs ?? null } },
  ];
}
/** Stores one probe result as history (one entry per slot) and marks the source as reporting. */
export async function recordProbe(db, result, now) {
  if (!result || result.outcome === "skipped") return false;
  const { summary, ...body } = result;
  await recordLog(
    db,
    { id: `multiplayer:${result.slot}`, source: "multiplayer", observedAt: now, summary, ...body },
    now,
  );
  await sourceSuccess(db, "multiplayer", now);
  return true;
}
/**
 * Hourly Cloudflare plan usage (`usage:<hour>` in the `cloudflare-usage` log). One attempt per
 * UTC hour: the id is claimed by the stored entry, so the minute dispatcher does not repeat the
 * four provider requests. Not connected or unavailable readings are stored too, each with an
 * explicit coverage gap, so a missing reading is never counted as data or as zero.
 */
export async function collectUsage(env, now, reader = cloudflareUsage, fetcher = fetch) {
  const db = env.DB,
    hour = Math.floor(now / USAGE_HOUR) * USAGE_HOUR,
    id = `usage:${hour}`;
  if (await db.prepare("SELECT 1 FROM owner_monitor_logs WHERE id=?").bind(id).first()) return null;
  let usage;
  try {
    usage = await reader(env, fetcher, now);
  } catch (error) {
    usage = {
      state: "unavailable",
      checkedAt: now,
      data: null,
      errorCode: providerErrorCode(error),
    };
  }
  const missing =
    usage.state === "ready"
      ? usage.data.metrics
          .filter((m) => m.state !== "ready")
          .map((m) => `${m.label} (${m.errorCode})`)
      : [];
  const coverageGap =
    usage.state === "not-connected"
      ? "Cloudflare usage is not connected (account ID and Account Analytics Read token)."
      : usage.state !== "ready"
        ? `Cloudflare usage could not be read (${usage.errorCode || "SOURCE_UNAVAILABLE"}).`
        : missing.length
          ? `Unavailable Cloudflare usage metrics: ${missing.join(", ")}.`
          : null;
  await recordLog(
    db,
    {
      id,
      source: "cloudflare-usage",
      observedAt: now,
      summary: usageSummary(usage),
      usage,
      coverageGap,
    },
    now,
  );
  if (usage.state === "ready") await sourceSuccess(db, "cloudflare-usage", now);
  return usage;
}
/** The newest usage reading for the snapshot; none, or one older than two hours, is a gap. */
export async function latestUsage(db, now) {
  const row = await db
    .prepare(
      "SELECT body FROM owner_monitor_logs WHERE source='cloudflare-usage' ORDER BY observed_at DESC,sequence DESC LIMIT 1",
    )
    .first();
  const usage = decode(row)?.usage;
  if (!usage)
    return { state: "unavailable", checkedAt: null, data: null, errorCode: "NOT_COLLECTED" };
  if (usage.state === "ready" && now - usage.checkedAt > USAGE_STALE_MS)
    return {
      state: "unavailable",
      checkedAt: usage.checkedAt,
      data: null,
      errorCode: "STALE_READING",
    };
  return usage;
}
async function updateDiagnostics(db, snapshot, now, settings) {
  const previous = new Map(
    (await rows(db, "SELECT component,body FROM owner_monitor_incidents")).map((r) => [
      r.component,
      decode(r),
    ]),
  );
  const checks = [];
  const add = (component, state, symptom, impact, action, errorCode = null, extra = {}) =>
    checks.push({ component, state, symptom, impact, action, errorCode, required: true, ...extra });
  add(
    "Backend",
    "healthy",
    "The Worker completed this check.",
    "Owner API is reachable from the collector.",
    "No action required.",
  );
  for (const check of snapshot.health.checks)
    add(
      check.name === "Database" ? "Storage" : check.name,
      check.status === "healthy" ? "healthy" : "unavailable",
      check.status === "healthy"
        ? `${check.name} responded in ${check.durationMs} ms.`
        : `${check.name} did not return a verified response.`,
      check.name === "Database"
        ? "Account saves and campaign synchronization depend on this storage."
        : "Website files may be unavailable.",
      check.status === "healthy"
        ? "No action required."
        : "Check the service dashboard and retry; the cause has not been confirmed.",
    );
  add(
    "Authentication",
    "healthy",
    "The collector verified the configured owner's current account role.",
    "Every owner API request also checks its own live session.",
    "Sign in again if your device reports an expired session.",
  );
  add("Multiplayer", ...multiplayerCheck(await latestProbe(db), now));
  for (const [key, name] of [
    ["development", "GitHub workflows"],
    ["traffic", "Cloudflare analytics"],
    ["analytics", "App statistics"],
    ["release", "Cloudflare deployment"],
  ]) {
    const source = snapshot[key],
      ready = source?.state === "ready" && now - source.checkedAt <= 6 * 60000,
      code = source?.errorCode;
    const unauthorized = code === "HTTP_401";
    const limited = code?.endsWith("_RATE_LIMITED");
    add(
      name,
      ready ? "healthy" : "unavailable",
      ready
        ? "The source returned a validated reading."
        : source?.state === "not-connected"
          ? `${name} is not connected.`
          : limited
            ? `${name} reached a provider request limit (${code}).`
            : unauthorized
              ? `${name} rejected authorization (${code}).`
              : code === "HTTP_403"
                ? `${name} rejected the request (HTTP_403); the response does not establish why.`
                : `${name} could not be checked.`,
      `The corresponding monitoring information ${ready ? "is available" : "may be out of date"}; this alone does not prove the app failed.`,
      ready
        ? "No action required."
        : limited
          ? "Wait for the provider limit to reset; review request volume and integration access."
          : unauthorized
            ? "Review the integration's authorization and permissions; reconnect if expired."
            : "Check the connection, provider status and access permissions, then retry.",
      code || null,
      { sourceCheckedAt: source?.checkedAt || null },
    );
  }
  const traffic = snapshot.traffic;
  const trafficCurrent = traffic?.state === "ready" && now - traffic.checkedAt <= 6 * 60000;
  // Half-hour readings let one old error read as a recent warning instead of a current failure.
  const intervals = trafficCurrent
    ? (
        await rows(
          db,
          "SELECT slot,(SELECT json_extract(m.value,'$.value') FROM json_each(json_extract(body,'$.metrics')) m WHERE json_extract(m.value,'$.key')='errors') AS errors FROM owner_monitor_intervals WHERE slot>? AND slot<=? AND body IS NOT NULL ORDER BY slot DESC LIMIT 60",
          now - 86400000 - INTERVAL,
          now + INTERVAL,
        )
      ).map((r) => ({ slot: r.slot, errors: r.errors === null ? null : Number(r.errors) }))
    : [];
  const errorCheck = workerErrorCheck(trafficCurrent ? traffic.data : null, intervals);
  add(
    "Worker execution errors",
    errorCheck.state,
    errorCheck.symptom,
    "Reported invocation errors may have interrupted requests; the affected requests and cause require log evidence.",
    errorCheck.state === "error" || errorCheck.state === "warning"
      ? "Inspect Cloudflare invocation logs for this window and correlate deployments before assigning a cause."
      : "Review the dated source window; an unavailable count does not establish recovery.",
    errorCheck.errorCount > 0 ? "WORKER_ERRORS_OBSERVED" : null,
    Object.fromEntries(
      Object.entries(errorCheck).filter(([key]) => !["state", "symptom"].includes(key)),
    ),
  );
  await workflowDiagnostics(db, snapshot.development, previous, now, add);
  const last = await db
    .prepare(
      "SELECT slot,collected_at,outcome FROM owner_monitor_intervals WHERE outcome IN ('complete','partial','recovered') ORDER BY slot DESC LIMIT 1",
    )
    .first();
  const latestInterval = await db
    .prepare("SELECT slot,outcome FROM owner_monitor_intervals ORDER BY slot DESC LIMIT 1")
    .first();
  const collectionFailed = latestInterval?.outcome === "failed";
  add(
    "Scheduled collection",
    collectionFailed
      ? "error"
      : last && last.slot === latestInterval?.slot && now - last.slot <= INTERVAL * 2
        ? "healthy"
        : "unavailable",
    collectionFailed
      ? `Collection for ${new Date(latestInterval.slot).toISOString()} failed; the previous successful entry does not verify this interval.`
      : last
        ? `Latest collected interval: ${new Date(last.slot).toISOString()} (${last.outcome}).`
        : "No scheduled collection has completed yet.",
    "A missing interval leaves a gap in the monitoring history.",
    "Inspect Cron Triggers and missed intervals; the scheduler records catch-up without inventing observations.",
    collectionFailed ? "COLLECTION_FAILED" : null,
  );
  const report = await db
    .prepare("SELECT generated_at FROM owner_monitor_reports ORDER BY generated_at DESC LIMIT 1")
    .first();
  const reportFailure = await db
    .prepare(
      "SELECT l.observed_at,l.summary FROM owner_monitor_logs l WHERE l.source='reports' AND json_extract(l.body,'$.outcome')='failed' AND NOT EXISTS(SELECT 1 FROM owner_monitor_reports r WHERE r.id=json_extract(l.body,'$.reportId') AND r.generated_at>=l.observed_at) ORDER BY l.observed_at DESC LIMIT 1",
    )
    .first();
  add(
    "Daily reporting",
    reportFailure
      ? "error"
      : report && now - report.generated_at <= 26 * 3600000
        ? "healthy"
        : "unavailable",
    reportFailure
      ? reportFailure.summary
      : report
        ? `Last report generated ${new Date(report.generated_at).toISOString()}.`
        : "The first calendar-day report is pending.",
    "Daily coverage is unverified until a report is generated.",
    "Inspect the report schedule and coverage; use Generate previous day to recover.",
    reportFailure ? "REPORT_GENERATION_FAILED" : null,
  );
  const devices = await rows(
    db,
    "SELECT id,reported_at,body FROM owner_monitor_devices ORDER BY reported_at DESC LIMIT 100",
  );
  add("Widget synchronization", ...widgetSyncCheck(devices, now, settings.deviceFreshMs));
  const result = checks.map((check) => diagnostic(previous.get(check.component), check, now));
  const writes = result.map((check) =>
    statement(
      db,
      "INSERT INTO owner_monitor_incidents VALUES(?,?) ON CONFLICT(component) DO UPDATE SET body=excluded.body WHERE json_extract(owner_monitor_incidents.body,'$.latestCheckAt')<=json_extract(excluded.body,'$.latestCheckAt')",
      check.component,
      JSON.stringify(check),
    ),
  );
  for (const check of result)
    if (previous.get(check.component)?.color !== check.color)
      writes.push(
        logStatement(
          db,
          {
            id: `diagnostic:${check.component}:${now}`,
            source: "diagnostics",
            observedAt: now,
            summary: `${check.component}: ${check.symptom}`,
            diagnostic: check,
          },
          now,
        ),
      );
  await batches(db, writes);
  return result.sort(
    (a, b) =>
      Number(a.component.startsWith("Workflow:")) - Number(b.component.startsWith("Workflow:")),
  );
}
export async function monitorSnapshot(
  env,
  userId,
  {
    force = false,
    now = Date.now(),
    collector = collectOwnerMonitor,
    budgetMs = 0,
    defer = null,
  } = {},
) {
  const db = env.DB,
    settings = await initializeMonitor(db, now);
  const previous = await db
    .prepare("SELECT * FROM owner_monitor_snapshots ORDER BY revision DESC LIMIT 1")
    .first();
  let snapshot;
  if (!force && previous && now - previous.collected_at < 60000)
    snapshot = { ...decode(previous), snapshotId: previous.revision };
  else {
    // A request-path collection (budgetMs) keeps a slow provider's previous validated reading
    // instead of holding the response; see withinBudget in owner-monitor.mjs.
    const observed = await collector(env, userId, {
      budgetMs: force ? 0 : budgetMs,
      defer,
      now,
      previous: decode(previous),
    });
    const diagnostics = await updateDiagnostics(db, observed, now, settings);
    const task = await currentTask(db, now, settings, observed.development ?? null);
    const interval = await db
      .prepare("SELECT * FROM owner_monitor_intervals ORDER BY slot DESC LIMIT 1")
      .first();
    const fullReport = decode(
      await db
        .prepare(
          "SELECT body FROM owner_monitor_reports ORDER BY day DESC,generated_at DESC LIMIT 1",
        )
        .first(),
    );
    const latestReport = fullReport
      ? {
          id: fullReport.id,
          day: fullReport.day,
          timezone: fullReport.timezone,
          generatedAt: fullReport.generatedAt,
          summary: fullReport.summary,
          gaps: fullReport.gaps,
          recommendations: fullReport.recommendations,
        }
      : null;
    snapshot = {
      ...observed,
      checkedAt: now,
      schemaVersion: 2,
      diagnostics,
      overall: overall(diagnostics),
      developmentStatus: task,
      monitoring: interval
        ? {
            scheduledAt: interval.slot,
            collectedAt: interval.collected_at,
            outcome: interval.outcome,
            ...decode(interval),
          }
        : null,
      dailyReport: latestReport,
      recentEntries: (
        await rows(
          db,
          "SELECT id,sequence,observed_at,collected_at,summary FROM owner_monitor_logs WHERE source='monitoring' ORDER BY observed_at DESC,sequence DESC LIMIT 3",
        )
      ).map((r) => ({
        id: r.id,
        sequence: r.sequence,
        source: "monitoring",
        observedAt: r.observed_at,
        collectedAt: r.collected_at,
        summary: r.summary,
      })),
      settings,
    };
    const result = await run(
      db,
      "INSERT INTO owner_monitor_snapshots(collected_at,body) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM owner_monitor_snapshots WHERE collected_at>?)",
      now,
      JSON.stringify(snapshot),
      now,
    );
    if (!result.meta.changes) {
      const newest = await db
        .prepare("SELECT * FROM owner_monitor_snapshots ORDER BY revision DESC LIMIT 1")
        .first();
      snapshot = { ...decode(newest), snapshotId: newest.revision };
    } else {
      snapshot.snapshotId = result.meta.last_row_id;
      // Snapshots are a provider-read cache: only the newest row is ever served. History lives in
      // intervals/logs/reports, which are never pruned. Owner-approved 2026-10-21: keep a short
      // tail of recent snapshots and delete older cache rows. AUTOINCREMENT prevents ID reuse.
      await run(
        db,
        "DELETE FROM owner_monitor_snapshots WHERE revision<=(SELECT revision FROM owner_monitor_snapshots ORDER BY revision DESC LIMIT 1 OFFSET ?)",
        SNAPSHOT_CACHE_ROWS,
      );
    }
  }
  // Every refresh reads task state, even when provider snapshot is reused; the task has its own revision.
  snapshot.developmentStatus = await currentTask(db, now, settings, snapshot.development ?? null);
  // Hourly plan usage is read from its log on every serve, so a reused snapshot is never staler.
  snapshot.usage = await latestUsage(db, now);
  snapshot.servedAt = now;
  snapshot.devices = (
    await rows(
      db,
      "SELECT id,reported_at,body FROM owner_monitor_devices WHERE user_id=? ORDER BY reported_at DESC LIMIT 100",
      userId,
    )
  ).map((r) => ({ id: r.id, lastReportedAt: r.reported_at, ...decode(r) }));
  return snapshot;
}

/*
 * Field monitor widget data (owner-approved redesign, 2026-10-25). Everything here is read from
 * rows the minute cron already writes (half-hour intervals, the diagnostics log and the room
 * activity tracker); none of it calls GitHub or Cloudflare. A value that was not measured stays
 * null with its coverage count, never 0.
 */
export const SERIES_HALF_HOURS = 48;
export const SERIES_DAYS = 7;
const metricValue = (key) =>
  `(SELECT json_extract(m.value,'$.value') FROM json_each(json_extract(body,'$.metrics')) m WHERE json_extract(m.value,'$.key')='${key}')`;
const whole = (value) => {
  const n = value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
/** Requests and errors of one stored half-hour: its own reading, else recovered provider history. */
function slotTraffic(row) {
  const own = [whole(row.requests), whole(row.errors)];
  if (own[0] !== null && own[1] !== null) return { requests: own[0], errors: own[1] };
  const recovered = [whole(row.historicalRequests), whole(row.historicalErrors)];
  return row.historicalState === "ready" && recovered[0] !== null && recovered[1] !== null
    ? { requests: recovered[0], errors: recovered[1] }
    : null;
}
/**
 * Requests and errors per half-hour (the last 48 window ends) and per local calendar day (the last
 * 7, oldest first), from owner_monitor_intervals. A slot without a measured reading (missed,
 * failed, partial without traffic, or not yet collected) is null in `halfHour` and is left out of
 * the day's sums; each day states `measured` of `expected` slots so a partial day never reads as a
 * quiet one. `active24hMax` is the largest "signed-in accounts in 24 hours" reading of the day.
 */
export async function monitorSeries(db, now, timezone = DEFAULT_CONFIG.timezone) {
  const boundary = Math.floor(now / INTERVAL) * INTERVAL;
  const days = [];
  let day = localCalendar(now, timezone).day;
  for (let i = 0; i < SERIES_DAYS; i++) {
    days.unshift({ day, ...dayBounds(day, timezone) });
    day = previousDay(day);
  }
  const from = Math.min(days[0].start, boundary - SERIES_HALF_HOURS * INTERVAL);
  const found = await rows(
    db,
    `SELECT slot,outcome,${metricValue("requests")} AS requests,${metricValue("errors")} AS errors,${metricValue("active24h")} AS active24h,json_extract(body,'$.historicalTraffic.state') AS historicalState,json_extract(body,'$.historicalTraffic.data.requests') AS historicalRequests,json_extract(body,'$.historicalTraffic.data.errors') AS historicalErrors FROM owner_monitor_intervals WHERE slot>? AND slot<=? ORDER BY slot`,
    from,
    boundary,
  );
  const bySlot = new Map(found.map((row) => [row.slot, row]));
  // The newest boundary is collected a minute or so after it passes; until its collection is
  // final the series ends at the previous slot instead of showing a gap that is only "not yet".
  const newest = bySlot.get(boundary);
  const end =
    (!newest || ["pending", "collecting", "failed"].includes(newest.outcome)) &&
    now - boundary < 10 * 60000
      ? boundary - INTERVAL
      : boundary;
  const requests = [],
    errors = [];
  let measured = 0;
  for (let i = SERIES_HALF_HOURS - 1; i >= 0; i--) {
    const reading = bySlot.has(end - i * INTERVAL)
      ? slotTraffic(bySlot.get(end - i * INTERVAL))
      : null;
    requests.push(reading ? reading.requests : null);
    errors.push(reading ? reading.errors : null);
    if (reading) measured++;
  }
  const daily = days.map(({ day: date, start, end: dayEnd }) => {
    const limit = Math.min(dayEnd, end);
    const expected = Math.max(0, Math.floor(limit / INTERVAL) - Math.floor(start / INTERVAL));
    let count = 0,
      sumRequests = 0,
      sumErrors = 0,
      active = null;
    for (const row of found) {
      if (row.slot <= start || row.slot > limit) continue;
      const reading = slotTraffic(row);
      if (reading) {
        count++;
        sumRequests += reading.requests;
        sumErrors += reading.errors;
      }
      const accounts = whole(row.active24h);
      if (accounts !== null) active = Math.max(active ?? 0, accounts);
    }
    return {
      day: date,
      start,
      end: dayEnd,
      requests: count ? sumRequests : null,
      errors: count ? sumErrors : null,
      measured: count,
      expected,
      active24hMax: active,
    };
  });
  return {
    state: "ready",
    timezone,
    halfHour: {
      intervalMs: INTERVAL,
      end,
      requests,
      errors,
      measured,
      expected: SERIES_HALF_HOURS,
    },
    daily,
  };
}

export const RESOLVED_WINDOW_MS = 86400000;
export const RESOLVED_LIMIT = 5;
/** Diagnostics transitions read for the window; above it the list says it is incomplete. */
export const RESOLVED_SCAN = 400;
const RESOLVED_HISTORY = 3;
// Indexed reads for problems that began before the window, per request.
const RESOLVED_LOOKUPS = 30;
const clip = (value, size) =>
  typeof value === "string" ? (value.length > size ? `${value.slice(0, size - 1)}…` : value) : "";
/**
 * Components that went from a problem back to green in the last 24 hours (owner decision 2), newest
 * first, at most five, from the `diagnostics` log (one entry per colour change). A component whose
 * newest entry, or current diagnostic, is not green is still a problem and is never listed. The
 * start is the problem's firstOccurredAt; the end is its recoveredAt. `total` counts every resolved
 * component found, so a list cut to five says how many more there were.
 */
export async function recentlyResolved(db, now, current = []) {
  const found = await rows(
    db,
    "SELECT id,observed_at,body FROM owner_monitor_logs WHERE source='diagnostics' AND observed_at>? AND observed_at<=? ORDER BY observed_at DESC,sequence DESC LIMIT ?",
    now - RESOLVED_WINDOW_MS,
    now + 60000,
    RESOLVED_SCAN,
  );
  const currentColor = new Map(
    (Array.isArray(current) ? current : []).map((check) => [check.component, check.color]),
  );
  const byComponent = new Map();
  for (const row of found) {
    let check;
    try {
      check = decode(row).diagnostic;
    } catch {
      continue;
    }
    if (!check || typeof check.component !== "string") continue;
    if (!byComponent.has(check.component)) byComponent.set(check.component, []);
    byComponent.get(check.component).push({ at: row.observed_at, check });
  }
  const candidates = [];
  for (const [component, list] of byComponent) {
    const newest = list[0];
    if (newest.check.color !== "green") continue;
    if (currentColor.has(component) && currentColor.get(component) !== "green") continue;
    candidates.push({ component, list, resolvedAt: newest.check.recoveredAt || newest.at });
  }
  candidates.sort((a, b) => b.resolvedAt - a.resolvedAt || (a.component < b.component ? -1 : 1));
  const items = [];
  let total = 0,
    lookups = 0,
    complete = found.length < RESOLVED_SCAN;
  for (const { component, list, resolvedAt } of candidates) {
    let bad = list.slice(1).find((entry) => entry.check.color !== "green");
    if (!bad && lookups >= RESOLVED_LOOKUPS) {
      complete = false; // Not checked: the count says so rather than guessing.
      continue;
    }
    if (!bad) {
      lookups++;
      // The problem began before the window: its last entry is the one just before the recovery.
      const prefix = `diagnostic:${component}:`;
      const earlier = await db
        .prepare(
          "SELECT observed_at,body FROM owner_monitor_logs WHERE source='diagnostics' AND id>=? AND id<? AND observed_at<? ORDER BY observed_at DESC LIMIT 1",
        )
        .bind(prefix, `diagnostic:${component};`, list[0].at)
        .first();
      const check = earlier ? decode(earlier).diagnostic : null;
      if (check && check.color !== "green") bad = { at: earlier.observed_at, check };
    }
    if (!bad) continue; // A first observation that was green: never a problem.
    total++;
    if (items.length >= RESOLVED_LIMIT) continue;
    const startedAt = bad.check.firstOccurredAt || bad.at;
    const state = list[0].check.state;
    items.push({
      component,
      severity: widgetSeverity(bad.check) || "warning",
      startedAt,
      resolvedAt,
      durationMs: Math.max(0, resolvedAt - startedAt),
      resolution: state === "healthy" ? "recovered" : clip(state, 40) || "recovered",
      brief: clip(bad.check.brief, 80),
      symptom: clip(bad.check.symptom, 240),
      impact: clip(bad.check.impact, 200),
      history: list.slice(0, RESOLVED_HISTORY).map((entry) => ({
        at: entry.at,
        color: entry.check.color,
        state: clip(entry.check.state, 40),
        symptom: clip(entry.check.symptom, 200),
      })),
    });
  }
  return {
    state: "ready",
    windowMs: RESOLVED_WINDOW_MS,
    limit: RESOLVED_LIMIT,
    total,
    complete,
    items,
  };
}

/** A live room had activity (a stored change) in this window (owner decision 4). */
export const LIVE_ROOM_MS = 5 * 60000;
// Row 0 of the tracker is its own run record: first_seen_at = first run, changed_at = latest run.
const TRACKER_ROW = 0;
/**
 * Called every minute by the scheduler. Records each shared room's stored revision (by row id; no
 * room code or body is copied) and when it last changed. Probe rooms are excluded. Only rooms whose
 * revision changed are written. On the first run every existing room is recorded without a change
 * time, so rooms that were idle are never counted as live.
 */
export async function trackRoomActivity(db, now) {
  const tracker = await db
    .prepare("SELECT first_seen_at FROM owner_monitor_room_activity WHERE room=?")
    .bind(TRACKER_ROW)
    .first();
  await db.batch([
    statement(
      db,
      `INSERT INTO owner_monitor_room_activity(room,revision,changed_at,first_seen_at) SELECT rowid,revision,?,? FROM campaign_rooms WHERE ${notProbeRoom()} AND rowid>0 ON CONFLICT(room) DO UPDATE SET revision=excluded.revision,changed_at=? WHERE owner_monitor_room_activity.revision<>excluded.revision`,
      tracker ? now : null,
      now,
      now,
    ),
    statement(
      db,
      "INSERT INTO owner_monitor_room_activity(room,revision,changed_at,first_seen_at) VALUES(?,0,?,?) ON CONFLICT(room) DO UPDATE SET changed_at=excluded.changed_at",
      TRACKER_ROW,
      now,
      now,
    ),
  ]);
}
/**
 * Live rooms now, or an explicit gap: before the tracker has watched a full window, or when its
 * latest run is more than three minutes old (the minute cron stopped), the count is unknown.
 */
export async function liveRooms(db, now) {
  const tracker = await db
    .prepare("SELECT first_seen_at,changed_at FROM owner_monitor_room_activity WHERE room=?")
    .bind(TRACKER_ROW)
    .first();
  const base = { windowMs: LIVE_ROOM_MS, checkedAt: tracker?.changed_at ?? null };
  if (!tracker) return { ...base, state: "unavailable", live: null, errorCode: "NOT_COLLECTED" };
  if (now - tracker.changed_at > 3 * 60000)
    return { ...base, state: "unavailable", live: null, errorCode: "STALE_READING" };
  if (now - tracker.first_seen_at < LIVE_ROOM_MS)
    return { ...base, state: "unavailable", live: null, errorCode: "WARMING_UP" };
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS live FROM owner_monitor_room_activity WHERE room>? AND changed_at>=?",
    )
    .bind(TRACKER_ROW, now - LIVE_ROOM_MS)
    .first();
  return { ...base, state: "ready", live: Number(row?.live ?? 0) };
}
/**
 * The widget view's extra data. Each part fails on its own into an explicit unavailable state, so
 * one failed read never hides the others or reads as zero.
 */
export async function monitorWidgetData(db, snapshot, now = Date.now()) {
  const part = async (read) => {
    try {
      return await read();
    } catch {
      return { state: "unavailable", errorCode: "READ_FAILED" };
    }
  };
  const [series, resolved, rooms] = await Promise.all([
    part(() => monitorSeries(db, now, snapshot?.settings?.timezone || DEFAULT_CONFIG.timezone)),
    part(() => recentlyResolved(db, now, snapshot?.diagnostics)),
    part(() => liveRooms(db, now)),
  ]);
  return { series, recentlyResolved: resolved, rooms };
}

async function textFetch(url, fetcher) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(8000),
    // Workers supports manual/follow, not the browser's error redirect mode.
    redirect: "manual",
    headers: { "User-Agent": "Lootsplit-monitoring", Accept: "application/json" },
  });
  if (!response.ok) throw providerFailure(response);
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw Error("Source exceeds bounded collection size");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function collectPerformance(db, now, fetcher = fetch) {
  const base =
    "https://raw.githubusercontent.com/UnregisteredMusket/Lootsplit/performance-history/";
  const [regressions, resolutions, cursor] = await Promise.all([
    textFetch(base + "regressions.jsonl", fetcher),
    textFetch(base + "resolutions.jsonl", fetcher),
    textFetch(base + "state.json", fetcher),
  ]);
  const state = JSON.parse(cursor),
    captureAt = Date.parse(state.scanAfter);
  if (!Number.isFinite(captureAt)) throw Error("Missing performance capture cursor");
  const all = [];
  for (const [kind, text] of [
    ["regression", regressions],
    ["resolution", resolutions],
  ])
    for (const line of text.split("\n").filter(Boolean)) {
      const item = JSON.parse(line),
        at = Date.parse(
          kind === "regression" ? item.current?.finishedAt || item.recordedAt : item.confirmedAt,
        );
      if (!item.id || !Number.isFinite(at)) throw Error("Invalid performance entry");
      const summary =
        kind === "regression"
          ? `${item.name}: ${item.baseline?.durationMs} → ${item.current?.durationMs} ms (${item.increasePercent}% slower). Investigate equivalent workload and environment; this is not confirmed causation.`
          : `Verified performance resolution: ${item.verified?.name || item.id}. ${item.reason || "See the retained resolution."}`;
      all.push({
        id: `performance:${item.id}`,
        source: "performance",
        observedAt: at,
        summary: summary.slice(0, 4000),
        kind,
        baselineMs: item.baseline?.durationMs ?? null,
        currentMs: item.current?.durationMs ?? item.verified?.durationMs ?? null,
        scope: item.scope,
        environment: item.environment || item.verified?.environment,
        trendId: item.trendId || item.closedTrendId,
        outcome: item.outcome || item.status,
        evidence: [
          {
            label: "Original performance evidence",
            url: kind === "regression" ? item.current?.url : item.verified?.url,
          },
        ],
        recovered: at < now - INTERVAL,
      });
    }
  await bulkLogs(db, all, now);
  await attest(
    db,
    "performance",
    captureAt,
    `Performance history checked: ${all.length} retained regressions/resolutions; capture cursor ${new Date(captureAt).toISOString()}. No baseline or resolved trend was reset.`,
    now,
  );
  return {
    count: all.length,
    cursor: captureAt,
    pendingRuns: Array.isArray(state.pending) ? state.pending.length : null,
  };
}
async function collectOtherLogs(env, snapshot, now) {
  const db = env.DB;
  for (const id of ["development", "diagnostics", "devices", "room-storage", "campaign-limit"])
    await attest(
      db,
      id,
      now,
      `The persistent ${id} log was checked. Only explicitly recorded events are reported; no new events does not imply activity or device connectivity.`,
    );
  const source = snapshot.development;
  if (source?.state === "ready") {
    const runs = source.data.runs || [];
    await bulkLogs(
      db,
      runs
        .filter((r) => r.updatedAt)
        .map((r) => ({
          id: `workflow:${r.id}:${r.status}:${r.conclusion || ""}:${r.updatedAt}`,
          source: /recover|failure|backup/i.test(r.name) ? "recovery" : "workflows",
          observedAt: r.updatedAt,
          summary: `${r.name}: ${r.conclusion || r.status}.`,
          workflow: r,
          evidence: [{ label: r.name, url: r.url }],
        })),
      now,
    );
    const summary = `Checked ${runs.length} recent GitHub workflow runs. ${runs.length >= 100 ? "History is bounded to 100 runs; older event coverage may be incomplete." : "Available recent run metadata was collected."}`;
    await attest(
      db,
      "workflows",
      source.checkedAt,
      summary,
      now,
      runs.length >= 100
        ? "GitHub history reached the 100-run collection bound; older events may be missing."
        : null,
    );
    await attest(
      db,
      "recovery",
      source.checkedAt,
      summary,
      now,
      runs.length >= 100
        ? "GitHub history reached the 100-run collection bound; older recovery events may be missing."
        : null,
    );
  }
  const moderation = await rows(
    db,
    "SELECT action,created_at,id FROM moderation_audit WHERE created_at>=? ORDER BY created_at,id LIMIT 500",
    now - 86400000,
  );
  await bulkLogs(
    db,
    moderation.map((r) => ({
      id: `moderation:${r.id}`,
      source: "moderation",
      observedAt: r.created_at,
      summary: `Administration action: ${r.action}. Member details remain in the existing staff audit.`,
    })),
    now,
  );
  const siteAudit = await rows(
    db,
    "SELECT action,created_at,id FROM site_audit WHERE created_at>=? ORDER BY created_at,id LIMIT 500",
    now - 86400000,
  );
  await bulkLogs(
    db,
    siteAudit.map((r) => ({
      id: `site-audit:${r.id}`,
      source: "moderation",
      observedAt: r.created_at,
      summary: `Owner settings action: ${r.action}.`,
    })),
    now,
  );
  await attest(
    db,
    "moderation",
    now,
    `Administration audits checked: ${moderation.length} member actions and ${siteAudit.length} site settings actions in the preceding day.${moderation.length === 500 || siteAudit.length === 500 ? " Coverage reached the 500-record collection limit; export the original audit for complete detail." : ""}`,
    now,
    moderation.length === 500 || siteAudit.length === 500
      ? "Administration audit reached its collection bound."
      : null,
  );
  const bugs = await db.prepare("SELECT COUNT(*) AS total FROM bug_reports").first();
  await recordLog(
    db,
    {
      id: `bugs:${Math.floor(now / INTERVAL)}`,
      source: "bug-reports",
      observedAt: now,
      summary: `${bugs.total} application issue reports retained. Open the existing Reports panel for permission-controlled details.`,
      total: bugs.total,
    },
    now,
  );
  await sourceSuccess(db, "bug-reports", now);
}
export async function collectInterval(
  env,
  userId,
  slot,
  {
    now = Date.now(),
    collector = collectOwnerMonitor,
    fetcher = fetch,
    integrations = true,
    // The deployed Worker (ASSETS bound) probes by default; tests and tools opt in explicitly.
    multiplayerProbe = env.ASSETS ? runMultiplayerProbe : null,
  } = {},
) {
  const db = env.DB;
  await initializeMonitor(db, now);
  const lease = crypto.randomUUID();
  await run(
    db,
    "INSERT OR IGNORE INTO owner_monitor_intervals(slot,outcome) VALUES(?,'pending')",
    slot,
  );
  const lock = await run(
    db,
    // A failed slot retries with exponential backoff (1, 2, 4 … 32 minutes) and at most six
    // attempts, so a provider outage cannot multiply GitHub/Cloudflare calls every minute.
    "UPDATE owner_monitor_intervals SET outcome='collecting',started_at=?,lease=?,lease_until=?,attempts=attempts+1 WHERE slot=? AND outcome NOT IN ('complete','partial','recovered','missed') AND (lease_until IS NULL OR lease_until<?) AND (outcome<>'failed' OR (attempts<6 AND ?-COALESCE(collected_at,0)>=60000*(1<<MIN(MAX(attempts-1,0),5))))",
    now,
    lease,
    now + 120000,
    slot,
    now,
    now,
  );
  if (!lock.meta.changes) return { duplicate: true };
  let committed;
  try {
    const snapshot = await collector(env, userId);
    const traffic = integrations
      ? await cloudflareTraffic(env, fetcher, { start: slot - INTERVAL, end: slot })
      : { state: "not-connected", data: null, checkedAt: null };
    const previous = decode(
      await db
        .prepare(
          "SELECT body FROM owner_monitor_intervals WHERE slot<? AND outcome IN ('complete','partial') ORDER BY slot DESC LIMIT 1",
        )
        .bind(slot)
        .first(),
    );
    const metrics = snapshotMetrics(snapshot, traffic),
      comparisons = compareMetrics(previous?.metrics, metrics);
    const sources = Object.fromEntries(
      ["analytics", "development", "traffic", "release"].map((key) => [
        key,
        key === "traffic"
          ? traffic
          : {
              state: snapshot[key]?.state,
              checkedAt: snapshot[key]?.checkedAt,
              errorCode: snapshot[key]?.errorCode,
            },
      ]),
    );
    const problems = Object.entries(sources)
      .filter(([, source]) => source?.state !== "ready" || now - source.checkedAt > 6 * 60000)
      .map(([key]) => key);
    if (snapshot.health.status !== "healthy") problems.push("storage/assets");
    const integrationOutcomes = [];
    if (integrations) {
      const results = await Promise.allSettled([
        collectOtherLogs(env, snapshot, now),
        env.OWNER_MONITOR_GITHUB === "true"
          ? collectPerformance(db, now, fetcher)
          : Promise.reject(Error("GitHub not connected")),
      ]);
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          problems.push(i === 0 ? "operational logs" : "performance history");
          integrationOutcomes.push({
            source: i === 0 ? "operational" : "performance",
            state: "unavailable",
            errorCode: providerErrorCode(result.reason),
          });
        } else
          integrationOutcomes.push({
            source: i === 0 ? "operational" : "performance",
            state: "ready",
          });
      });
    }
    const outcome = problems.length ? "partial" : "complete";
    const summary = explanation(comparisons, problems);
    const body = {
      summary,
      metrics,
      comparisons,
      sources,
      integrationOutcomes,
      observedAt: now,
      window: { start: slot - INTERVAL, end: slot },
      previousScheduledAt: previous?.scheduledAt ?? null,
      scheduledAt: slot,
      evidence: (snapshot.development?.data?.runs || [])
        .filter((r) => r.updatedAt >= slot - INTERVAL && r.updatedAt <= now)
        .slice(0, 20)
        .map((r) => ({ label: r.name, url: r.url })),
    };
    await db.batch([
      statement(
        db,
        "UPDATE owner_monitor_intervals SET outcome=?,collected_at=?,body=?,lease_until=NULL WHERE slot=? AND lease=?",
        outcome,
        now,
        JSON.stringify(body),
        slot,
        lease,
      ),
      statement(
        db,
        "INSERT OR IGNORE INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) SELECT ?,'monitoring',?,?,?,? WHERE EXISTS(SELECT 1 FROM owner_monitor_intervals WHERE slot=? AND lease=?)",
        `interval:${slot}`,
        slot,
        now,
        summary,
        JSON.stringify({ ...body, outcome }),
        slot,
        lease,
      ),
    ]);
    committed = { outcome, body, snapshot };
  } catch {
    const summary =
      "Scheduled collection failed. No healthy status or zero measurements were substituted. The next scheduler invocation will retry this interval.";
    await run(
      db,
      "UPDATE owner_monitor_intervals SET outcome='failed',collected_at=?,lease_until=NULL,body=? WHERE slot=? AND lease=?",
      now,
      JSON.stringify({ summary }),
      slot,
      lease,
    );
    await recordLog(
      db,
      {
        id: `collection-failure:${slot}:${lease}`,
        source: "monitoring",
        observedAt: now,
        summary,
        scheduledAt: slot,
        outcome: "failed",
      },
      now,
    );
    return { outcome: "failed", summary };
  }
  // The interval is committed. Later bookkeeping must not relabel a saved observation as failed.
  try {
    await sourceSuccess(db, "monitoring", now);
  } catch {
    /* Freshness is retried on the next successful collection. */
  }
  // Runs once per committed slot: a committed slot is never collected again, so the probe can
  // never run concurrently with itself. It is bounded (PROBE_TIMEOUT_MS) and never throws.
  if (multiplayerProbe)
    try {
      await recordProbe(db, await multiplayerProbe(env, slot), now);
    } catch {
      /* A missing probe result stays an explicit coverage gap; the interval stays as saved. */
    }
  try {
    await monitorSnapshot(env, userId, {
      force: true,
      now,
      collector: async () => committed.snapshot,
    });
  } catch {
    /* The dashboard snapshot refreshes on its next read; the interval stays as saved. */
  }
  return { outcome: committed.outcome, ...committed.body };
}

const SUMMARIZED_SECTIONS = [
  "evidence",
  "correlations",
  "builds",
  "performance",
  "incidents",
  "trends",
  // Development task views (one per task active or finished that day). A CI step is a task, so a
  // busy day holds thousands; on 2026-10-21 they alone were about 1.8 MB, above the budget.
  "development",
];
const reportBytes = (report) => new TextEncoder().encode(JSON.stringify(report)).length;
// Failures, errors and regressions are kept first; then the most recent entries. A development
// task view needs attention when it failed, is blocked or carries a telemetry warning.
const attention = (item) =>
  item?.task
    ? ["failed", "blocked"].includes(item.task.state) || item.warning
      ? 1
      : 0
    : /fail|error|regression|red|unavailable|missed/i.test(
          `${item?.summary ?? ""} ${item?.outcome ?? ""} ${item?.kind ?? ""} ${item?.color ?? ""}`,
        )
      ? 1
      : 0;
const itemTime = (item) =>
  item?.observedAt ?? item?.scheduledAt ?? item?.task?.completedAt ?? item?.task?.heartbeatAt ?? 0;
function keepImportant(items, count) {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        attention(b.item) - attention(a.item) ||
        itemTime(b.item) - itemTime(a.item) ||
        a.index - b.index,
    )
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map(({ item }) => item);
}
/**
 * Keeps a report under D1's row limit (owner-approved 2026-10-21). Counts, coverage, gaps,
 * recommendations and unresolved diagnostics are never reduced; long lists keep their most
 * important entries and record exactly how many were shown. Every source entry remains in
 * paginated history, which the report points to. Throws (explicit failure) if it cannot fit.
 */
export function summarizeReport(report, budget = REPORT_BYTE_BUDGET) {
  if (reportBytes(report) <= budget) return report;
  const original = Object.fromEntries(SUMMARIZED_SECTIONS.map((s) => [s, report[s] || []]));
  const caps = Object.fromEntries(SUMMARIZED_SECTIONS.map((s) => [s, original[s].length]));
  for (const section of SUMMARIZED_SECTIONS) {
    while (caps[section] > REPORT_SECTION_FLOOR && reportBytes(report) > budget) {
      caps[section] = Math.max(REPORT_SECTION_FLOOR, Math.floor(caps[section] / 2));
      report[section] = keepImportant(original[section], caps[section]);
    }
    if (reportBytes(report) <= budget) break;
  }
  const sections = Object.fromEntries(
    SUMMARIZED_SECTIONS.filter((s) => (report[s] || []).length < original[s].length).map((s) => [
      s,
      { shown: report[s].length, total: original[s].length },
    ]),
  );
  const hidden = Object.values(sections).reduce((sum, s) => sum + s.total - s.shown, 0);
  report.summarized = {
    budgetBytes: budget,
    sections,
    note: "Long lists were summarized to fit storage limits: failures, errors and regressions first, then the most recent entries. Every entry remains in History for this day.",
  };
  report.summary += ` Long lists are summarized; ${hidden} more entries are in History for this day.`;
  if (reportBytes(report) > budget)
    fail(
      "Daily report remains too large after summarizing long lists; export and review the day's source logs.",
      503,
    );
  return report;
}

export async function generateReport(db, day, settings, now = Date.now()) {
  try {
    return await buildReport(db, day, settings, now);
  } catch (error) {
    if (error.status && error.status < 500) throw error;
    await recordLog(
      db,
      {
        id: `report-failure:${settings.timezone}:${day}:${Math.floor(now / 60000)}`,
        source: "reports",
        observedAt: now,
        outcome: "failed",
        reportId: `${settings.timezone}:${day}`,
        // The thrown message (no stack) so a repeating failure can be diagnosed from History.
        error: String(error?.message ?? error).slice(0, 500),
        summary: `Daily report for ${day} (${settings.timezone}) could not be generated. The previous report and source entries are retained. Inspect collector logs and retry; cause is not confirmed.`,
      },
      now,
    );
    throw error;
  }
}
async function buildReport(db, day, settings, now) {
  const { start, end } = dayBounds(day, settings.timezone);
  if (end > now) fail("Generate a report only after that calendar day has ended.");
  const registry = await rows(db, "SELECT * FROM owner_monitor_registry ORDER BY id");
  const entries = [];
  // Bounded pages, without truncating the report. A failed page leaves the previous report intact.
  // Interval logs are stamped with their slot (the window END). The window ending at the day's
  // start belongs to the previous day and the one ending at the day's end belongs to this day,
  // matching the interval query below.
  // Pages follow the chronology index (observed_at, sequence) from a keyset cursor, so each page
  // reads about 200 rows. Paging by sequence alone made every page scan and sort the whole day
  // (about 20,000 rows read per page on 2026-10-22, about 1M per report attempt).
  let cursor = [start, -1];
  for (;;) {
    const page = await rows(
      db,
      `SELECT * FROM owner_monitor_logs WHERE (observed_at,sequence)>(?,?) AND observed_at<? AND NOT (observed_at=? AND ${SLOT_LOG}) ORDER BY observed_at,sequence LIMIT 200`,
      cursor[0],
      cursor[1],
      end,
      start,
    );
    entries.push(...page);
    if (page.length < 200) break;
    cursor = [page.at(-1).observed_at, page.at(-1).sequence];
    if (entries.length > 20000)
      fail(
        "Daily report exceeds the safe aggregation bound; export and review the day's source logs.",
        503,
      );
  }
  entries.push(
    ...(await rows(
      db,
      `SELECT * FROM owner_monitor_logs WHERE observed_at=? AND ${SLOT_LOG}`,
      end,
    )),
  );
  // Same order as before: insertion (sequence) order.
  entries.sort((a, b) => a.sequence - b.sequence);
  const intervals = await rows(
    db,
    "SELECT slot,outcome,collected_at,body FROM owner_monitor_intervals WHERE slot>? AND slot<=? ORDER BY slot",
    start,
    end,
  );
  // Slots before monitoring was installed were never scheduled; count only slots after it began.
  const monitorCreated =
    (await db.prepare("SELECT created_at FROM owner_monitor_config WHERE id=1").first())
      ?.created_at ?? start;
  const scheduledFrom = Math.min(end, Math.max(start, monitorCreated));
  const expected = Math.floor(end / INTERVAL) - Math.floor(scheduledFrom / INTERVAL);
  const collected = intervals.filter(
    (i) => i.slot > scheduledFrom && ["complete", "partial"].includes(i.outcome),
  ).length;
  const coverage = [],
    retiredLogs = [];
  for (const r of registry) {
    const source = decode(r);
    // Retire/reinstate audit entries stay in history but are not evidence that the source reported.
    const observations = entries.filter((e) => e.source === r.id && !decode(e).registryChange);
    const spans = retiredSpans(source).filter(
      (s) => s.retiredAt < end && (s.reinstatedAt ?? Infinity) > start,
    );
    const coverageStart = Math.max(start, r.registered_at);
    const segments = activeSegments(coverageStart, end, spans);
    for (const span of spans) retiredLogs.push({ id: r.id, name: source.name, ...span });
    // Retired for the whole day: listed under retired logs, not as active coverage or a gap.
    if (spans.length && r.registered_at < end && !segments.length) continue;
    const freshAt = (e) => decode(e).sourceFreshAt ?? e.observed_at;
    const active = spans.length
      ? observations.filter((e) =>
          segments.some(([a, b]) => e.observed_at >= a && e.observed_at <= b),
        )
      : observations;
    const count = active.length;
    // A current heartbeat cannot prove yesterday's coverage; use dated observations/attestations.
    const observedTimes = active.map(freshAt).sort((a, b) => a - b);
    const freshness = observedTimes.length ? observedTimes.at(-1) : null;
    const widest = (from, to, times) =>
      Math.max(...[from, ...times, to].slice(1).map((at, i) => at - [from, ...times][i]));
    const widestGap = spans.length
      ? Math.max(
          0,
          ...segments.map(([a, b]) =>
            widest(
              a,
              b,
              observedTimes.filter((t) => t >= a && t <= b),
            ),
          ),
        )
      : widest(coverageStart, end, observedTimes);
    const explicitGap = active.map((e) => decode(e).coverageGap).find(Boolean);
    const gap =
      (r.registered_at >= end
        ? "This source was registered after this day; earlier coverage is not verified."
        : null) ||
      explicitGap ||
      (!count
        ? spans.length
          ? "No data or coverage attestation while this source was active; it was retired for part of this day."
          : "No data or coverage attestation for this day."
        : source.expectedMs && widestGap > source.expectedMs
          ? "One or more expected source checks are missing or stale."
          : null);
    coverage.push({
      id: r.id,
      name: source.name,
      mode: source.mode,
      entries: count,
      lastObservationAt: freshness,
      gap,
      registrationAt: r.registered_at,
      ...(spans.length ? { retiredSpans: spans } : {}),
    });
  }
  const evidence = entries.map((e) => ({
    id: e.id,
    sequence: e.sequence,
    source: e.source,
    observedAt: e.observed_at,
    collectedAt: e.collected_at,
    summary: e.summary,
    ...decode(e),
  }));
  const trends = intervals.flatMap((interval, index) => {
    const body = decode(interval);
    const result = body?.comparisons
      ? [
          {
            scheduledAt: interval.slot,
            collectedAt: interval.collected_at,
            comparisons: body.comparisons,
          },
        ]
      : [];
    if (body?.historicalTraffic?.state === "ready") {
      const previous = index > 0 ? decode(intervals[index - 1]) : null;
      const previousMetrics =
        previous?.historicalTraffic?.state === "ready"
          ? snapshotMetrics({}, previous.historicalTraffic)
          : previous?.metrics || [];
      const recovered = snapshotMetrics({}, body.historicalTraffic).filter((metric) =>
        ["requests", "errors"].includes(metric.key),
      );
      result.push({
        scheduledAt: interval.slot,
        collectedAt: body.historyAttemptAt,
        recovered: true,
        comparisons: compareMetrics(previousMetrics, recovered),
      });
    }
    return result;
  });
  const performance = evidence.filter((e) => e.source === "performance" && !e.coverage);
  const incidents = evidence.filter((e) => e.source === "diagnostics" && !e.coverage);
  const tasks = evidence.filter((e) => e.source === "development" && !e.coverage);
  const builds = evidence.filter(
    (e) => ["workflows", "recovery"].includes(e.source) && !e.coverage,
  );
  const taskStates = await rows(
    db,
    "SELECT body FROM owner_monitor_logs WHERE sequence IN (SELECT MAX(sequence) FROM owner_monitor_logs WHERE source='development' AND observed_at<? AND json_extract(body,'$.task.id') IS NOT NULL GROUP BY json_extract(body,'$.task.id'))",
    end,
  );
  const development = taskStates
    .map((row) => taskView(decode(row).task, end, settings))
    .filter((view) => view.task.active || view.task.completedAt >= start);
  const incidentStates = await rows(
    db,
    "SELECT id,sequence,observed_at,body FROM owner_monitor_logs WHERE sequence IN (SELECT MAX(sequence) FROM owner_monitor_logs WHERE source='diagnostics' AND observed_at<? AND json_extract(body,'$.diagnostic.component') IS NOT NULL GROUP BY json_extract(body,'$.diagnostic.component'))",
    end,
  );
  const unresolved = incidentStates
    .map((row) => ({ entryId: row.id, sequence: row.sequence, ...decode(row).diagnostic }))
    .filter((d) => d.color !== "green")
    .map((d) => ({ ...d, durationMs: Math.max(0, end - (d.firstOccurredAt || end)), asOf: end }));
  const usageEntries = evidence.filter((e) => e.source === "cloudflare-usage" && e.usage);
  const usageEntry = usageEntries.at(-1) || null;
  const lastUsage = [...usageEntries].reverse().find((e) => e.usage.state === "ready") || null;
  const cloudflareUsage = {
    readings: usageEntries.length,
    available: usageEntries.filter((e) => e.usage.state === "ready").length,
    // The newest reading of the day (its billing cycle to date covers the day); null stays a gap.
    latest: lastUsage
      ? { observedAt: lastUsage.observedAt, summary: lastUsage.summary, usage: lastUsage.usage }
      : null,
    latestAttempt: usageEntry
      ? {
          observedAt: usageEntry.observedAt,
          state: usageEntry.usage.state,
          errorCode: usageEntry.usage.errorCode || null,
        }
      : null,
    lines: lastUsage ? usageLines(lastUsage.usage) : [],
  };
  const highUsage = (lastUsage?.usage.data?.metrics || []).filter(
    (m) =>
      m.state === "ready" &&
      (m.month?.percent ?? m.current?.percent ?? 0) >= USAGE_ATTENTION_PERCENT,
  );
  const gaps = coverage.filter((c) => c.gap).map((c) => `${c.name}: ${c.gap}`);
  if (collected < expected)
    gaps.unshift(
      `${collected}/${expected} scheduled half-hour intervals have actual observations; ${expected - collected} are missing, failed or historical recovery only.`,
    );
  if (scheduledFrom > start)
    gaps.unshift(
      `Scheduled monitoring began at ${new Date(scheduledFrom).toISOString()}; the earlier part of this day was not monitored and is not counted as missed.`,
    );
  const recommendations = [
    ...(gaps.length
      ? [
          "Restore missing source feeds and inspect scheduler catch-up; do not interpret coverage gaps as healthy operation.",
        ]
      : []),
    ...(performance.some((e) => e.kind === "regression")
      ? [
          "Investigate each >=15% slowdown using its equivalent workload/environment and retain the original trend until a verified fix.",
        ]
      : []),
    ...unresolved.map(
      (d) =>
        `${d.component}: ${d.action} Last observed check ${new Date(d.latestCheckAt).toISOString()}; ${d.retainedFailure ? "known failure remains unverified" : d.state}.`,
    ),
    ...highUsage.map(
      (m) =>
        `${m.label} is at ${formatPercent(m.month?.percent ?? m.current?.percent)} of the Workers Paid included ${m.unit === "bytes" ? "storage" : "monthly allowance"}; review usage before overage billing applies.`,
    ),
    ...(tasks.some((e) => e.task?.state === "blocked")
      ? ["Resolve recorded development blockers or publish the next handoff."]
      : []),
  ];
  if (!recommendations.length)
    recommendations.push(
      "Continue scheduled collection; no action is indicated by the available evidence.",
    );
  const correlations = [];
  for (const event of [...incidents, ...performance]) {
    const nearby = builds.filter((b) => Math.abs(b.observedAt - event.observedAt) <= INTERVAL);
    if (nearby.length)
      correlations.push({
        entry: event.id,
        related: nearby.map((b) => b.id),
        statement:
          "These events occurred within 30 minutes. This is an observed time correlation, not a confirmed cause.",
      });
  }
  const report = {
    id: `${settings.timezone}:${day}`,
    day,
    timezone: settings.timezone,
    start,
    end,
    generatedAt: now,
    summary: `${day}: ${collected} of ${expected} scheduled intervals observed, ${incidents.length} incident/recovery changes, ${performance.length} performance records and ${tasks.length} development updates. ${gaps.length ? "Monitoring coverage is incomplete." : "Registered sources supplied the expected coverage."} ${lastUsage ? `Cloudflare plan usage: ${cloudflareUsage.available} of ${cloudflareUsage.readings} hourly readings available; latest ${new Date(lastUsage.observedAt).toISOString()}.` : "Cloudflare plan usage: no available reading for this day."}${retiredLogs.length ? ` ${retiredLogs.length} retired log span${retiredLogs.length === 1 ? " is" : "s are"} listed separately and not counted as missing data.` : ""}`,
    coverage,
    // Workers Paid allowance use: hourly readings for the day and the newest available one.
    cloudflareUsage,
    // Retired registry entries are not active coverage; their stored history stays in History.
    retiredLogs,
    gaps,
    recommendations,
    trends,
    incidents,
    unresolved,
    performance,
    taskUpdateCount: tasks.length,
    development,
    builds,
    correlations,
    history: {
      since: start,
      until: end,
      totalEntries: evidence.length,
      description:
        "All source entries, including heartbeats and coverage attestations, remain in paginated history for this window.",
    },
    evidence: evidence
      .filter((e) => !e.coverage && e.eventKind !== "heartbeat")
      .map((e) => ({
        id: e.id,
        sequence: e.sequence,
        source: e.source,
        summary: e.summary.slice(0, 600),
        observedAt: e.observedAt,
        collectedAt: e.collectedAt,
        evidence: e.evidence || [],
      })),
  };
  summarizeReport(report);
  await db.batch([
    statement(
      db,
      "INSERT INTO owner_monitor_reports VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET generated_at=excluded.generated_at,body=excluded.body",
      report.id,
      day,
      settings.timezone,
      now,
      JSON.stringify(report),
    ),
    logStatement(
      db,
      {
        id: `report:${report.id}:${now}`,
        source: "reports",
        observedAt: now,
        summary: report.summary,
        reportId: report.id,
        coverage: report.coverage,
        gaps: report.gaps,
      },
      now,
    ),
  ]);
  await sourceSuccess(db, "reports", now);
  await run(
    db,
    "DELETE FROM owner_monitor_report_refresh WHERE report_id=? AND requested_at<=?",
    report.id,
    now,
  );
  return report;
}
export async function scheduledMonitor(env, scheduledAt = Date.now(), options = {}) {
  const now = options.now ?? Date.now(),
    db = env.DB;
  const settings = await initializeMonitor(db, now);
  const owner = await db
    .prepare(
      "SELECT r.user_id FROM site_roles r JOIN member_access a ON a.user_id=r.user_id WHERE r.role='owner' AND a.status='active' ORDER BY r.granted_at LIMIT 1",
    )
    .first();
  if (!owner) throw Error("Monitoring requires an active provisioned owner.");
  // Live rooms for the Field monitor (one bounded read of room revisions, no provider calls). A
  // failure leaves the tracker's run time behind, so the widget shows the count as unknown.
  try {
    await trackRoomActivity(db, now);
  } catch {
    /* The live-room count becomes an explicit STALE_READING gap after three minutes. */
  }
  const slot = Math.floor(scheduledAt / INTERVAL) * INTERVAL;
  const created = (
    await db.prepare("SELECT created_at FROM owner_monitor_config WHERE id=1").first()
  ).created_at;
  const latest = await db.prepare("SELECT MAX(slot) AS slot FROM owner_monitor_intervals").first();
  let cursor =
    latest.slot === null ? Math.floor(created / INTERVAL) * INTERVAL : latest.slot + INTERVAL;
  // Catch-up is bounded per invocation and drains from oldest to newest, retaining every missed slot.
  const missing = [];
  while (cursor < slot && missing.length < 48) {
    const summary =
      "Missed scheduled interval. Current measurements cannot reconstruct the unobserved service state; provider history may be recovered separately.";
    missing.push(
      statement(
        db,
        "INSERT OR IGNORE INTO owner_monitor_intervals(slot,outcome,collected_at,body) VALUES(?,'missed',?,?)",
        cursor,
        now,
        JSON.stringify({ summary, observedAt: null }),
      ),
    );
    missing.push(
      logStatement(
        db,
        {
          id: `interval:${cursor}`,
          source: "monitoring",
          observedAt: cursor,
          summary,
          scheduledAt: cursor,
          outcome: "missed",
          originalObservationAt: null,
        },
        now,
      ),
    );
    cursor += INTERVAL;
  }
  await batches(db, missing);
  // Do not jump the cursor over older missing intervals; the next minute continues the backlog.
  if (cursor >= slot) await collectInterval(env, owner.user_id, slot, { ...options, now });
  // Hourly Cloudflare plan usage. The deployed Worker (ASSETS bound) reads it by default; tests
  // and tools pass `cloudflareUsage` explicitly. It never blocks collection or reports.
  const usageReader =
    options.cloudflareUsage !== undefined
      ? options.cloudflareUsage
      : env.ASSETS
        ? cloudflareUsage
        : null;
  if (options.integrations !== false && usageReader)
    try {
      await collectUsage(env, now, usageReader, options.fetcher || fetch);
    } catch {
      /* The hour stays without an entry: an explicit coverage gap in the daily report. */
    }
  const interrupted = await rows(
    db,
    "SELECT slot FROM owner_monitor_intervals WHERE outcome IN ('collecting','failed') AND slot<? AND (lease_until IS NULL OR lease_until<?) ORDER BY slot LIMIT 2",
    slot,
    now,
  );
  for (const item of interrupted) {
    await run(
      db,
      "UPDATE owner_monitor_intervals SET outcome='missed',lease_until=NULL,body=? WHERE slot=?",
      JSON.stringify({
        summary:
          "Interrupted collection: no complete observation was saved. See retained failure events; available provider history is recovered separately.",
      }),
      item.slot,
    );
    await recordLog(
      db,
      {
        id: `interval:${item.slot}`,
        source: "monitoring",
        observedAt: item.slot,
        summary: "Interrupted interval; actual service observations are unavailable.",
        outcome: "missed",
      },
      now,
    );
  }
  if (options.integrations !== false && env.OWNER_MONITOR_CLOUDFLARE_TOKEN) {
    const historical = await db
      .prepare(
        "SELECT slot,outcome,body FROM owner_monitor_intervals WHERE (outcome='missed' OR (outcome='partial' AND COALESCE(json_extract(body,'$.sources.traffic.state'),'unavailable')!='ready' AND COALESCE(json_extract(body,'$.historicalTraffic.state'),'unavailable')!='ready')) AND COALESCE(json_extract(body,'$.historyAttemptAt'),0)<? ORDER BY slot LIMIT 1",
      )
      .bind(now - INTERVAL)
      .first();
    if (historical) {
      const traffic =
        now - historical.slot > 89 * 86400000
          ? {
              state: "unavailable",
              checkedAt: now,
              data: null,
              errorCode: "OUTSIDE_RECOVERY_RETENTION",
            }
          : await cloudflareTraffic(env, options.fetcher || fetch, {
              start: historical.slot - INTERVAL,
              end: historical.slot,
            });
      const original = decode(historical);
      const recoverySummary =
        traffic.state === "ready"
          ? `Recovered ${traffic.data.requests} requests and ${traffic.data.errors} errors for the half-hour ending ${new Date(historical.slot).toISOString()} from provider history. Other unavailable source observations remain gaps.`
          : "Historical traffic could not be recovered; the original coverage gap remains.";
      const body = {
        ...original,
        historyAttemptAt: now,
        historicalTraffic: traffic,
        originalObservationAt: original.observedAt || null,
        recoverySummary,
        summary: historical.outcome === "partial" ? original.summary : recoverySummary,
      };
      await run(
        db,
        "UPDATE owner_monitor_intervals SET outcome=?,body=? WHERE slot=? AND outcome=?",
        historical.outcome === "partial"
          ? "partial"
          : traffic.state === "ready"
            ? "recovered"
            : "missed",
        JSON.stringify(body),
        historical.slot,
        historical.outcome,
      );
      if (traffic.state === "ready") {
        await recordLog(
          db,
          {
            id: `recovered:${historical.slot}`,
            source: "monitoring",
            observedAt: historical.slot,
            summary: recoverySummary,
            recovered: true,
            originalObservationAt: null,
            historicalTraffic: traffic,
            scheduledAt: historical.slot,
          },
          now,
        );
        const day = localCalendar(historical.slot - 1, settings.timezone).day;
        if (
          await db
            .prepare("SELECT id FROM owner_monitor_reports WHERE day=? AND timezone=?")
            .bind(day, settings.timezone)
            .first()
        )
          try {
            await generateReport(db, day, settings, now);
          } catch {
            /* Logged by generateReport; the recovered log already queued this report's refresh. */
          }
      }
    }
  }
  const calendar = localCalendar(scheduledAt, settings.timezone);
  if (calendar.time >= settings.reportTime) {
    // At most one historical report per tick, starting at registration; DST uses calendar boundaries.
    const firstDay = localCalendar(created, settings.timezone).day;
    const last = await db
      .prepare("SELECT day FROM owner_monitor_reports WHERE timezone=? ORDER BY day DESC LIMIT 1")
      .bind(settings.timezone)
      .first();
    const due = last
      ? new Date(Date.parse(last.day + "T12:00:00Z") + 86400000).toISOString().slice(0, 10)
      : firstDay;
    if (due <= previousDay(calendar.day)) {
      const reportId = `${settings.timezone}:${due}`;
      const failures = await reportFailures(db, reportId, now);
      if (failures.ready)
        try {
          await generateReport(db, due, settings, now);
        } catch (error) {
          // Never retry every minute, and never block later days behind one failing day.
          if ((error.status && error.status < 500) || failures.attempts + 1 >= REPORT_MAX_ATTEMPTS)
            await storeFailedReport(db, due, settings, now, failures.attempts + 1);
        }
    }
  }
  // A refresh stopped at the attempt cap stays queued (so it is never lost) but is skipped until
  // the stored report changes: a successful generation or the owner's Retry refresh.
  const dirty = await db
    .prepare(
      `SELECT r.id,r.day,r.timezone,r.generated_at FROM owner_monitor_report_refresh q JOIN owner_monitor_reports r ON r.id=q.report_id WHERE q.requested_at<=? AND NOT EXISTS(SELECT 1 FROM owner_monitor_logs l WHERE l.id='${REFRESH_STOPPED}'||r.id||':'||r.generated_at) ORDER BY q.requested_at LIMIT 1`,
    )
    .bind(now)
    .first();
  if (dirty)
    try {
      await generateReport(db, dirty.day, { ...settings, timezone: dirty.timezone }, now);
    } catch (error) {
      // Count only failures since this report was last stored, so an old failure never shortens
      // a later refresh's attempts and a success starts the count again.
      const failures = await reportFailures(db, dirty.id, now, dirty.generated_at);
      if ((error.status && error.status < 500) || failures.attempts >= REPORT_MAX_ATTEMPTS)
        await stopReportRefresh(db, dirty, now, failures.attempts, error);
      // Otherwise keep the queued refresh but defer it, so one failing day cannot starve the queue.
      else
        await run(
          db,
          "UPDATE owner_monitor_report_refresh SET requested_at=? WHERE report_id=?",
          now + failures.waitMs,
          dirty.id,
        );
    }
  return { slot, checkedAt: now };
}

const REFRESH_STOPPED = "report-refresh-stopped:";
/**
 * Stops retrying a queued refresh that keeps failing (for example a report over the size
 * budget, which retrying cannot fix). The stored report stays, now marked out of date in its
 * own coverage gaps, and a failed `reports` entry carries the error so Daily reporting (and the
 * widgets' diagnostics) stay red until a real report for that day is generated. Nothing is
 * deleted: the queue row is kept and the next successful generation clears it.
 */
async function stopReportRefresh(db, report, now, attempts, error) {
  const message = String(error?.message ?? error).slice(0, 500);
  const gap = `This report is out of date: refreshing it with later observations failed ${attempts} ${attempts === 1 ? "time" : "times"} and automatic retries stopped on ${new Date(now).toISOString()}. Last error: ${message} All source entries for ${report.day} remain in History. Use Retry refresh on this report to try again.`;
  const stored = await db
    .prepare("SELECT body FROM owner_monitor_reports WHERE id=? AND generated_at=?")
    .bind(report.id, report.generated_at)
    .first();
  let body = null;
  try {
    body = stored && JSON.parse(stored.body);
  } catch {
    /* An unreadable body is left as it is; the failure entry below still records the gap. */
  }
  const statements = [];
  if (body && typeof body === "object") {
    body.refreshStopped = { at: now, attempts, error: message };
    body.gaps = [gap, ...(Array.isArray(body.gaps) ? body.gaps : [])];
    // generated_at is unchanged: the stored report still reflects that generation only.
    statements.push(
      statement(
        db,
        "UPDATE owner_monitor_reports SET body=? WHERE id=? AND generated_at=?",
        JSON.stringify(body),
        report.id,
        report.generated_at,
      ),
    );
  }
  statements.push(
    logStatement(
      db,
      {
        id: `${REFRESH_STOPPED}${report.id}:${report.generated_at}`,
        source: "reports",
        observedAt: now,
        outcome: "failed",
        reportId: report.id,
        attempts,
        error: message,
        summary: `Daily report for ${report.day} (${report.timezone}) is out of date: automatic refresh stopped after ${attempts} failed ${attempts === 1 ? "attempt" : "attempts"}. Last error: ${message} Use Retry refresh on the report.`,
      },
      now,
    ),
  );
  await db.batch(statements);
}

/** Recorded generation failures for one report (optionally since a time) and its backoff. */
async function reportFailures(db, reportId, now, since = -1) {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS attempts, MAX(observed_at) AS last FROM owner_monitor_logs WHERE source='reports' AND id LIKE ? AND observed_at>?",
    )
    .bind(`report-failure:${reportId}:%`, since)
    .first();
  const attempts = Number(row?.attempts || 0);
  const waitMs = 60000 * 2 ** Math.min(Math.max(attempts - 1, 0), 5);
  return { attempts, waitMs, ready: !attempts || now - Number(row.last) >= waitMs };
}

/**
 * After repeated failures, records an explicitly failed report for the day so later days can be
 * generated. It never replaces an existing report and contains no substituted measurements.
 * A queued refresh or Generate previous day replaces it once generation succeeds.
 */
async function storeFailedReport(db, day, settings, now, attempts) {
  const { start, end } = dayBounds(day, settings.timezone);
  const id = `${settings.timezone}:${day}`;
  const summary = `${day}: the daily report could not be generated after ${attempts} attempts. All source entries for this day remain in History. Use Generate previous day to retry; the cause is not confirmed.`;
  const report = {
    id,
    day,
    timezone: settings.timezone,
    start,
    end,
    generatedAt: now,
    failed: true,
    summary,
    coverage: [],
    gaps: [summary],
    recommendations: [
      "Inspect the day's report failure entries and source logs, then use Generate previous day.",
    ],
    trends: [],
    incidents: [],
    unresolved: [],
    performance: [],
    taskUpdateCount: 0,
    development: [],
    builds: [],
    correlations: [],
    history: {
      since: start,
      until: end,
      totalEntries: null,
      description: "All source entries for this window remain in paginated history.",
    },
    evidence: [],
  };
  await db.batch([
    statement(
      db,
      "INSERT OR IGNORE INTO owner_monitor_reports VALUES(?,?,?,?,?)",
      id,
      day,
      settings.timezone,
      // One millisecond before its failure entry, so Daily reporting stays red until a real
      // report for this day is generated (the diagnostic compares generated_at with failures).
      now - 1,
      JSON.stringify(report),
    ),
    logStatement(
      db,
      {
        id: `report-failed:${id}`,
        source: "reports",
        observedAt: now,
        outcome: "failed",
        reportId: id,
        summary,
      },
      now,
    ),
  ]);
}

export async function monitorHistory(db, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
  const cursor =
    url.searchParams.get("before") || `${Number.MAX_SAFE_INTEGER}.${Number.MAX_SAFE_INTEGER}`;
  if (!/^\d+\.\d+$/.test(cursor)) fail("Invalid history cursor.");
  const [beforeAt, beforeSequence] = cursor.split(".").map(Number);
  const since = Number(url.searchParams.get("since")) || 0;
  const until = Number(url.searchParams.get("until")) || Number.MAX_SAFE_INTEGER;
  const source = clean(url.searchParams.get("source") || "", 80),
    query = clean(url.searchParams.get("q") || "", 200);
  const result = await rows(
    db,
    "SELECT * FROM owner_monitor_logs WHERE (observed_at<? OR (observed_at=? AND sequence<?)) AND observed_at>=? AND observed_at<? AND (?='' OR source=?) AND (?='' OR instr(lower(summary),lower(?))>0) ORDER BY observed_at DESC,sequence DESC LIMIT ?",
    beforeAt,
    beforeAt,
    beforeSequence,
    since,
    until,
    source,
    source,
    query,
    query,
    limit + 1,
  );
  const page = result.slice(0, limit);
  return {
    entries: page.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      source: r.source,
      observedAt: r.observed_at,
      collectedAt: r.collected_at,
      summary: r.summary,
      ...decode(r),
    })),
    next: result.length > limit ? `${page.at(-1).observed_at}.${page.at(-1).sequence}` : null,
    retention:
      "No automatic deletion. Export all pages for archival; source-provider retention is separate.",
  };
}
export async function updateTask(db, input, now, settings, guard = null) {
  const id = clean(input.id, 120),
    eventId = clean(input.eventId, 160);
  if (!eventId) fail("A persistent event identifier is required.");
  const duplicate = await db
    .prepare("SELECT body FROM owner_monitor_logs WHERE id=?")
    .bind(`task:${eventId}`)
    .first();
  if (duplicate) {
    if (decode(duplicate).task.id !== id)
      fail("This event identifier belongs to another task.", 409);
    return decode(duplicate).task;
  }
  const previous = decode(
    await db.prepare("SELECT body FROM owner_monitor_tasks WHERE id=?").bind(id).first(),
  );
  if ((previous?.revision || 0) !== input.revision)
    fail("Task changed. Refresh before updating.", 409);
  const task = transitionTask(previous, input, now, settings);
  const predicate = guard ? ` AND ${guard.sql}` : "",
    binds = guard?.binds || [];
  const sql = previous
    ? `UPDATE owner_monitor_tasks SET revision=?,updated_at=?,body=? WHERE id=? AND revision=?${predicate}`
    : `INSERT INTO owner_monitor_tasks(id,revision,updated_at,body) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM owner_monitor_tasks WHERE id=?)${predicate}`;
  const args = previous
    ? [task.revision, now, JSON.stringify(task), id, previous.revision, ...binds]
    : [id, task.revision, now, JSON.stringify(task), id, ...binds];
  const results = await db.batch([
    statement(db, sql, ...args),
    statement(
      db,
      "INSERT OR IGNORE INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) SELECT ?,'development',?,?,?,? WHERE changes()=1",
      `task:${eventId}`,
      now,
      now,
      `${task.title}: ${task.state} · ${task.progress || task.phase}`,
      JSON.stringify({
        task,
        eventKind: previous && task.progressAt === previous.progressAt ? "heartbeat" : "progress",
      }),
    ),
  ]);
  if (!results[0].meta.changes)
    fail("Task or authorization changed. Refresh before updating.", 409);
  return task;
}
/**
 * Retires or reinstates a custom registry entry (audit M10). The state and every retired span live
 * in the registry row's JSON body, guarded by its revision; the change is also a history entry of
 * that log, keyed by a persistent event ID so a retried request is applied once. Nothing stored for
 * the log is deleted, and built-in logs cannot be retired.
 */
export async function changeRegistryStatus(
  db,
  input,
  action,
  actor,
  now = Date.now(),
  guard = null,
) {
  if (!["retire", "reinstate"].includes(action)) fail("Monitoring route not found.", 404);
  const id = clean(input?.id ?? "", 80),
    eventId = clean(input?.eventId ?? "", 160),
    reason = clean(input?.reason || "", 500);
  if (!id || !eventId) fail("Choose a registered log and supply a persistent event identifier.");
  const row = await db.prepare("SELECT * FROM owner_monitor_registry WHERE id=?").bind(id).first();
  if (!row) fail("This log is not registered.", 404);
  const source = decode(row);
  if (source.builtin) fail("Built-in logs are maintained in code and cannot be retired.", 409);
  const logId = `registry:${id}:${eventId}`;
  const duplicate = await db
    .prepare("SELECT body FROM owner_monitor_logs WHERE id=?")
    .bind(logId)
    .first();
  if (duplicate) {
    if (decode(duplicate).registryChange?.action !== action)
      fail("This event identifier belongs to another registry change.", 409);
    return registryView(row);
  }
  if (!Number.isSafeInteger(input.revision) || (source.revision || 0) !== input.revision)
    fail("The log registry changed. Refresh before updating.", 409);
  if (action === "retire" && source.retired) fail("This log is already retired.", 409);
  if (action === "reinstate" && !source.retired) fail("This log is not retired.", 409);
  const by = {
    id: actor,
    name:
      (await db.prepare('SELECT name FROM "user" WHERE id=?').bind(actor).first())?.name ||
      "Site owner",
  };
  const next = { ...source, revision: (source.revision || 0) + 1 };
  let summary;
  if (action === "retire") {
    next.retired = { retiredAt: now, retiredBy: by, reason };
    summary = `${source.name} retired by ${by.name}${reason ? `: ${reason}` : "."} Its stored history stays readable and exportable; daily reports list it under retired logs instead of reporting missing data.`;
  } else {
    const span = { ...source.retired, reinstatedAt: now, reinstatedBy: by };
    delete next.retired;
    next.retirements = [...(source.retirements || []), span];
    summary = `${source.name} reinstated by ${by.name}${reason ? `: ${reason}` : "."} Daily coverage resumes now; the span retired since ${new Date(span.retiredAt).toISOString()} is shown as retired, not as a gap.`;
  }
  const predicate = guard ? ` AND ${guard.sql}` : "",
    binds = guard?.binds || [];
  const results = await db.batch([
    statement(
      db,
      `UPDATE owner_monitor_registry SET body=? WHERE id=? AND body=? AND json_extract(body,'$.builtin')=0${predicate}`,
      JSON.stringify(next),
      id,
      row.body,
      ...binds,
    ),
    statement(
      db,
      "INSERT OR IGNORE INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) SELECT ?,?,?,?,?,? WHERE changes()=1",
      logId,
      id,
      now,
      now,
      summary,
      JSON.stringify({
        outcome: action === "retire" ? "retired" : "reinstated",
        registryChange: { action, at: now, by, reason, revision: next.revision },
      }),
    ),
  ]);
  if (!results[0].meta.changes)
    fail("The log registry or authorization changed. Refresh before updating.", 409);
  return registryView({ ...row, body: JSON.stringify(next) });
}
export async function monitorApi(env, userId, sessionId, request, body) {
  await authorizeOwner(env, userId, sessionId);
  const db = env.DB,
    now = Date.now(),
    settings = await initializeMonitor(db, now),
    url = new URL(request.url);
  const route = url.pathname.slice("/api/account/owner/monitor/".length);
  let result;
  if (request.method === "GET") {
    if (route === "history" || route === "export") result = await monitorHistory(db, url);
    else if (route === "registry")
      result = {
        logs: (await rows(db, "SELECT * FROM owner_monitor_registry ORDER BY id")).map(
          registryView,
        ),
        customLimit: REGISTRY_CUSTOM_LIMIT,
        settings,
      };
    else if (route === "reports")
      result = {
        reports: (
          await rows(
            db,
            "SELECT * FROM owner_monitor_reports WHERE day<? AND (?='' OR day=?) ORDER BY day DESC LIMIT 31",
            url.searchParams.get("before") || "9999-99-99",
            url.searchParams.get("day") || "",
            url.searchParams.get("day") || "",
          )
        ).map((r) => decode(r)),
      };
    else if (route === "task") result = await currentTask(db, now, settings);
    else fail("Monitoring route not found.", 404);
  } else if (request.method === "POST") {
    const guard = await staffCommitGuard(db, userId, sessionId, ["owner"]);
    if (route === "task") result = await updateTask(db, body, now, settings, guard);
    else if (route === "settings") {
      const next = config(body);
      const changed = await run(
        db,
        `UPDATE owner_monitor_config SET body=? WHERE id=1 AND ${guard.sql}`,
        JSON.stringify(next),
        ...guard.binds,
      );
      if (!changed.meta.changes) fail("Owner authorization changed.", 403);
      result = next;
    } else if (route === "registry") {
      const id = clean(body.id, 80),
        name = clean(body.name, 160),
        description = clean(body.description, 1000);
      if (
        !/^[a-z][a-z0-9-]*$/.test(id) ||
        !name ||
        !["event", "external"].includes(body.mode) ||
        !Number.isSafeInteger(body.expectedMs) ||
        body.expectedMs < 0 ||
        body.expectedMs > 7 * 86400000
      )
        fail("Check the log identifier, mode and expected interval.");
      const record = {
        id,
        name,
        description,
        mode: body.mode,
        expectedMs: body.expectedMs,
        builtin: false,
        url: links(body.evidence || [])[0]?.url || null,
      };
      // Every registered source adds work to each daily report; bound new custom entries.
      const existing = await db
        .prepare("SELECT body FROM owner_monitor_registry WHERE id=?")
        .bind(id)
        .first();
      const previous = decode(existing);
      // Updating a definition keeps its retirement state and span history.
      if (previous) {
        record.revision = (previous.revision || 0) + 1;
        if (previous.retired) record.retired = previous.retired;
        if (previous.retirements) record.retirements = previous.retirements;
      }
      // Retired entries still count: they keep their definition, history and report notes, and
      // reinstating one then never has to fail on a full registry.
      if (!existing) {
        const custom = await db
          .prepare(
            "SELECT COUNT(*) AS n FROM owner_monitor_registry WHERE json_extract(body,'$.builtin')=0",
          )
          .first();
        if (Number(custom?.n || 0) >= REGISTRY_CUSTOM_LIMIT)
          fail(
            `The log registry already has ${REGISTRY_CUSTOM_LIMIT} custom sources. Update an existing source instead of adding another.`,
            409,
          );
      }
      const changed = await run(
        db,
        `INSERT INTO owner_monitor_registry(id,body,registered_at) SELECT ?,?,? WHERE ${guard.sql} ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE json_extract(owner_monitor_registry.body,'$.builtin')=0 AND owner_monitor_registry.body IS ?`,
        id,
        JSON.stringify(record),
        now,
        ...guard.binds,
        existing?.body ?? null,
      );
      if (!changed.meta.changes)
        fail(
          "Built-in registry definitions are maintained in code, the log changed meanwhile, or authorization changed. Refresh and try again.",
          409,
        );
      result = record;
    } else if (route === "registry/retire" || route === "registry/reinstate") {
      result = await changeRegistryStatus(
        db,
        body,
        route.slice("registry/".length),
        userId,
        now,
        guard,
      );
    } else if (route === "entry") {
      const source = clean(body.source, 80),
        id = clean(body.id, 160),
        summary = clean(body.summary, 4000),
        at = body.observedAt;
      if (!id || !Number.isSafeInteger(at) || at < 0 || at > now + 60000)
        fail("Use a stable entry ID and actual observation time.");
      if (
        !(await db.prepare("SELECT id FROM owner_monitor_registry WHERE id=?").bind(source).first())
      )
        fail("Register this log before recording its first entry.");
      const data = {
        evidence: links(body.evidence),
        outcome: clean(body.outcome || "observed", 80),
        recovered: body.recovered === true,
        coverage: body.coverage === true,
      };
      const inserted = await run(
        db,
        `INSERT OR IGNORE INTO owner_monitor_logs(id,source,observed_at,collected_at,summary,body) SELECT ?,?,?,?,?,? WHERE ${guard.sql}`,
        `external:${source}:${id}`,
        source,
        at,
        now,
        summary,
        JSON.stringify(data),
        ...guard.binds,
      );
      result = { recorded: !!inserted.meta.changes, id: `external:${source}:${id}` };
    } else if (route === "device") {
      const id = clean(body.id, 80);
      if (
        !/^[a-zA-Z0-9-]{8,80}$/.test(id) ||
        !Number.isSafeInteger(body.snapshotId) ||
        body.snapshotId < 0
      )
        fail("Invalid device report.");
      const data = {
        snapshotId: body.snapshotId,
        version: clean(body.version || "unknown", 40),
        delivery: clean(body.delivery || "refresh", 60),
      };
      const changed = await run(
        db,
        `INSERT INTO owner_monitor_devices SELECT ?,?,?,? WHERE ${guard.sql} ON CONFLICT(id) DO UPDATE SET reported_at=excluded.reported_at,body=excluded.body WHERE owner_monitor_devices.user_id=excluded.user_id AND ${guard.sql}`,
        id,
        userId,
        now,
        JSON.stringify(data),
        ...guard.binds,
        ...guard.binds,
      );
      if (!changed.meta.changes) fail("Device or authorization changed.", 403);
      await recordLog(
        db,
        {
          id: `device:${id}:${Math.floor(now / INTERVAL)}`,
          source: "devices",
          observedAt: now,
          summary: `Android device reported snapshot ${body.snapshotId}. Device delivery is separate from backend collection.`,
          deviceId: id,
          ...data,
        },
        now,
      );
      result = { reportedAt: now };
    } else if (route === "report") {
      // Retry refresh names a stored report (day + its own timezone); Generate previous day
      // sends nothing and uses the configured timezone.
      let timezone = settings.timezone;
      if (body.timezone && body.timezone !== settings.timezone) {
        const stored = await db
          .prepare("SELECT timezone FROM owner_monitor_reports WHERE day=? AND timezone=?")
          .bind(clean(body.day || "", 10), clean(body.timezone, 80))
          .first();
        if (!stored) fail("No stored report exists for that day and timezone.");
        timezone = stored.timezone;
      }
      result = await generateReport(
        db,
        body.day || previousDay(localCalendar(now, timezone).day),
        { ...settings, timezone },
        now,
      );
    } else if (route === "widget-session") {
      result = await widgetSession(env, userId, sessionId, body, now);
    } else fail("Monitoring route not found.", 404);
  } else fail("Method not allowed.", 405);
  await authorizeOwner(env, userId, sessionId);
  return result;
}

/** The widget's own sign-in lasts this long; the periodic refresh keeps the row's updatedAt current. */
export const WIDGET_SESSION_DAYS = 365;
export const WIDGET_SESSION_AGENT = "Lootsplitter owner widget";
/**
 * The home-screen widget authenticates with its own session, separate from the app's. Until
 * 2026-10-28 it borrowed the app's bearer token, so every sign-out, re-sign-in or 30-day expiry
 * of the app session also disconnected the widget ("No current owner reading · Sign in").
 *
 * `action: "create"` opens a new widget session (revoking this device's previous widget session
 * when `previousToken` is given) and returns a bearer token in the same `<token>.<signature>`
 * form Better Auth's bearer plugin verifies. `action: "revoke"` ends the given widget session.
 * Only widget sessions (identified by their user agent) are ever revoked here, never the app's.
 */
async function widgetSession(env, userId, sessionId, body, now) {
  const db = env.DB;
  const action = body?.action === "revoke" ? "revoke" : "create";
  const { generateId } = await import("@better-auth/core/utils/id");
  // Same form as the tokens Better Auth hands the app (`set-auth-token`): token + "." + standard
  // base64 HMAC-SHA256, which both the bearer plugin and the signed-cookie layer verify.
  const sign = async (token) => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.ACCOUNT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(token)));
    return `${token}.${btoa(String.fromCharCode(...signature))}`;
  };
  const revoke = async (bearer) => {
    const token = typeof bearer === "string" ? bearer.split(".")[0] : "";
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return 0;
    const result = await db
      .prepare("DELETE FROM session WHERE token=? AND userId=? AND userAgent=?")
      .bind(token, userId, WIDGET_SESSION_AGENT)
      .run();
    return result.meta?.changes ?? 0;
  };
  if (action === "revoke") return { revoked: (await revoke(body?.token)) > 0 };
  const stamp = new Date(now).toISOString();
  const expires = new Date(now + WIDGET_SESSION_DAYS * 86400000).toISOString();
  const token = generateId(32);
  await db
    .prepare(
      "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(generateId(), expires, token, stamp, stamp, null, WIDGET_SESSION_AGENT, userId)
    .run();
  if (body?.previousToken) await revoke(body.previousToken);
  return { token: await sign(token), expiresAt: expires };
}
