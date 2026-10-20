import { authorizeOwner, collectOwnerMonitor, cloudflareTraffic } from "./owner-monitor.mjs";
import { staffCommitGuard } from "./members.mjs";
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
} from "./monitor-model.mjs";

const REPO = "https://github.com/UnregisteredMusket/Lootsplit";
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
    "runtime",
    "Worker invocation and application timing logs",
    "external",
    INTERVAL * 2,
    "Cloudflare retained runtime logs need a registered export/ingestion feed; request/error aggregates alone are not raw-log coverage.",
  ],
];
const decode = (row) => (row ? JSON.parse(row.body) : null);
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
async function currentTask(db, now, settings) {
  const row = await db
    .prepare(
      "SELECT body FROM owner_monitor_tasks ORDER BY (json_extract(body,'$.state') NOT IN ('completed','failed','idle')) DESC,(json_extract(body,'$.source')='owner') DESC,updated_at DESC,id DESC LIMIT 1",
    )
    .first();
  return taskView(decode(row), now, settings);
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
  add(
    "Multiplayer",
    "unavailable",
    "Storage was checked; no synthetic player session was created.",
    "End-to-end live room connectivity is not directly measured by this collector.",
    "Check the existing room connection indicator and recent multiplayer audit.",
  );
  for (const [key, name] of [
    ["development", "GitHub workflows"],
    ["traffic", "Cloudflare analytics"],
    ["analytics", "App statistics"],
    ["release", "Cloudflare deployment"],
  ]) {
    const source = snapshot[key],
      ready = source?.state === "ready" && now - source.checkedAt <= 6 * 60000,
      code = source?.errorCode;
    const expired = code === "HTTP_401" || code === "HTTP_403";
    add(
      name,
      ready ? "healthy" : "unavailable",
      ready
        ? "The source returned a validated reading."
        : source?.state === "not-connected"
          ? `${name} is not connected.`
          : expired
            ? `${name} rejected authorization (${code}).`
            : `${name} could not be checked.`,
      `The corresponding monitoring information ${ready ? "is available" : "may be out of date"}; this alone does not prove the app failed.`,
      ready
        ? "No action required."
        : expired
          ? "Review the integration's authorization and permissions; reconnect if expired."
          : "Check the connection and provider status, then retry.",
      code || null,
      { sourceCheckedAt: source?.checkedAt || null },
    );
  }
  const latestRuns = new Map();
  const traffic = snapshot.traffic;
  const trafficCurrent = traffic?.state === "ready" && now - traffic.checkedAt <= 6 * 60000;
  const trafficErrors = trafficCurrent ? traffic.data?.errors : null;
  add(
    "Worker execution errors",
    trafficErrors === null || trafficErrors === undefined
      ? "unavailable"
      : trafficErrors > 0
        ? "error"
        : "healthy",
    trafficErrors === null || trafficErrors === undefined
      ? "The measured Worker error count is unavailable."
      : `${trafficErrors} Worker error(s) were reported in the measured past-24-hour window.`,
    "Reported invocation errors may have interrupted requests; the affected requests and cause require log evidence.",
    trafficErrors > 0
      ? "Inspect Cloudflare invocation logs for this window and correlate deployments before assigning a cause."
      : "Review the dated source window; an unavailable count does not establish recovery.",
    trafficErrors > 0 ? "WORKER_ERRORS_OBSERVED" : null,
  );
  for (const run of snapshot.development?.data?.runs || []) {
    if (run.status !== "completed" || /performance|failure report/i.test(run.name)) continue;
    const component = `Workflow: ${run.name} (${run.branch})`;
    if (!latestRuns.has(component)) latestRuns.set(component, run);
  }
  // A different workflow cannot resolve this workflow's failure. Keep absent histories unknown.
  for (const component of previous.keys())
    if (component.startsWith("Workflow:") && !latestRuns.has(component))
      latestRuns.set(component, null);
  if (!latestRuns.size) latestRuns.set("Workflow: available results", null);
  for (const [component, latestRun] of latestRuns) {
    add(
      component,
      snapshot.development?.state !== "ready"
        ? "unavailable"
        : latestRun && ["failure", "timed_out", "action_required"].includes(latestRun.conclusion)
          ? "error"
          : latestRun?.conclusion === "success"
            ? "healthy"
            : "unavailable",
      latestRun
        ? `${latestRun.name}: ${latestRun.conclusion}.`
        : "No completed build or test result was returned.",
      "A failed candidate does not replace the deployed version; review the linked run.",
      latestRun?.conclusion === "success"
        ? "No action required."
        : "Inspect failed job evidence before retrying.",
      latestRun?.conclusion || null,
      { evidence: latestRun ? [{ label: latestRun.name, url: latestRun.url }] : [] },
    );
  }
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
    "SELECT reported_at,body FROM owner_monitor_devices ORDER BY reported_at DESC LIMIT 100",
  );
  add(
    "Widget synchronization",
    devices.length && devices.every((d) => now - d.reported_at <= settings.deviceFreshMs)
      ? "healthy"
      : "unavailable",
    devices.length
      ? `${devices.length} registered device(s); oldest report ${new Date(Math.min(...devices.map((d) => d.reported_at))).toISOString()}.`
      : "No Android installation has reported yet.",
    "Android may delay delivery while asleep, offline or battery restricted. Backend collection continues.",
    "Open widget diagnostics, check connectivity and tap Refresh. Sign in only if authorization was rejected.",
  );
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
  { force = false, now = Date.now(), collector = collectOwnerMonitor } = {},
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
    const observed = await collector(env, userId);
    const diagnostics = await updateDiagnostics(db, observed, now, settings);
    const task = await currentTask(db, now, settings);
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
    } else snapshot.snapshotId = result.meta.last_row_id;
  }
  // Every refresh reads task state, even when provider snapshot is reused; the task has its own revision.
  snapshot.developmentStatus = await currentTask(db, now, settings);
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

async function textFetch(url, fetcher) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(8000),
    redirect: "error",
    headers: { "User-Agent": "Lootsplit-monitoring", Accept: "application/json" },
  });
  if (!response.ok) throw Error(`Source HTTP ${response.status}`);
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
  for (const id of ["development", "diagnostics", "devices"])
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
  { now = Date.now(), collector = collectOwnerMonitor, fetcher = fetch, integrations = true } = {},
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
    "UPDATE owner_monitor_intervals SET outcome='collecting',started_at=?,lease=?,lease_until=?,attempts=attempts+1 WHERE slot=? AND outcome NOT IN ('complete','partial','recovered','missed') AND (lease_until IS NULL OR lease_until<?)",
    now,
    lease,
    now + 120000,
    slot,
    now,
  );
  if (!lock.meta.changes) return { duplicate: true };
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
    await sourceSuccess(db, "monitoring", now);
    await monitorSnapshot(env, userId, { force: true, now, collector: async () => snapshot });
    return { outcome, ...body };
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
  let sequence = 0;
  // Bounded pages, without truncating the report. A failed page leaves the previous report intact.
  for (;;) {
    const page = await rows(
      db,
      "SELECT * FROM owner_monitor_logs WHERE observed_at>=? AND observed_at<? AND sequence>? ORDER BY sequence LIMIT 200",
      start,
      end,
      sequence,
    );
    entries.push(...page);
    if (page.length < 200) break;
    sequence = page.at(-1).sequence;
    if (entries.length > 20000)
      fail(
        "Daily report exceeds the safe aggregation bound; export and review the day's source logs.",
        503,
      );
  }
  const intervals = await rows(
    db,
    "SELECT slot,outcome,collected_at,body FROM owner_monitor_intervals WHERE slot>? AND slot<=? ORDER BY slot",
    start,
    end,
  );
  const expected = Math.floor(end / INTERVAL) - Math.floor(start / INTERVAL);
  const collected = intervals.filter((i) => ["complete", "partial"].includes(i.outcome)).length;
  const coverage = registry.map((r) => {
    const source = decode(r),
      count = entries.filter((e) => e.source === r.id).length;
    // A current heartbeat cannot prove yesterday's coverage; use dated observations/attestations.
    const observations = entries.filter((e) => e.source === r.id);
    const observedTimes = observations
      .map((e) => decode(e).sourceFreshAt ?? e.observed_at)
      .sort((a, b) => a - b);
    const freshness = observedTimes.length ? observedTimes.at(-1) : null;
    const coverageStart = Math.max(start, r.registered_at);
    const widestGap = Math.max(
      ...[coverageStart, ...observedTimes, end]
        .slice(1)
        .map((at, i) => at - [coverageStart, ...observedTimes][i]),
    );
    const explicitGap = observations.map((e) => decode(e).coverageGap).find(Boolean);
    const gap =
      (r.registered_at >= end
        ? "This source was registered after this day; earlier coverage is not verified."
        : null) ||
      explicitGap ||
      (!count
        ? "No data or coverage attestation for this day."
        : source.expectedMs && widestGap > source.expectedMs
          ? "One or more expected source checks are missing or stale."
          : null);
    return {
      id: r.id,
      name: source.name,
      mode: source.mode,
      entries: count,
      lastObservationAt: freshness,
      gap,
      registrationAt: r.registered_at,
    };
  });
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
  const gaps = coverage.filter((c) => c.gap).map((c) => `${c.name}: ${c.gap}`);
  if (collected < expected)
    gaps.unshift(
      `${collected}/${expected} scheduled half-hour intervals have actual observations; ${expected - collected} are missing, failed or historical recovery only.`,
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
    summary: `${day}: ${collected} of ${expected} scheduled intervals observed, ${incidents.length} incident/recovery changes, ${performance.length} performance records and ${tasks.length} development updates. ${gaps.length ? "Monitoring coverage is incomplete." : "Registered sources supplied the expected coverage."}`,
    coverage,
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
          await generateReport(db, day, settings, now);
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
    if (due <= previousDay(calendar.day)) await generateReport(db, due, settings, now);
  }
  const dirty = await db
    .prepare(
      "SELECT r.day,r.timezone FROM owner_monitor_report_refresh q JOIN owner_monitor_reports r ON r.id=q.report_id ORDER BY q.requested_at LIMIT 1",
    )
    .first();
  if (dirty) await generateReport(db, dirty.day, { ...settings, timezone: dirty.timezone }, now);
  return { slot, checkedAt: now };
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
        logs: (await rows(db, "SELECT * FROM owner_monitor_registry ORDER BY id")).map((r) => ({
          ...decode(r),
          registeredAt: r.registered_at,
          lastSuccessAt: r.last_success,
        })),
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
      const changed = await run(
        db,
        `INSERT INTO owner_monitor_registry(id,body,registered_at) SELECT ?,?,? WHERE ${guard.sql} ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE json_extract(owner_monitor_registry.body,'$.builtin')=0`,
        id,
        JSON.stringify(record),
        now,
        ...guard.binds,
      );
      if (!changed.meta.changes)
        fail(
          "Built-in registry definitions are maintained in code, or authorization changed.",
          409,
        );
      result = record;
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
    } else if (route === "report")
      result = await generateReport(
        db,
        body.day || previousDay(localCalendar(now, settings.timezone).day),
        settings,
        now,
      );
    else fail("Monitoring route not found.", 404);
  } else fail("Method not allowed.", 405);
  await authorizeOwner(env, userId, sessionId);
  return result;
}
