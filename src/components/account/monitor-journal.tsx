import { useEffect, useState } from "react";
import { AppLink } from "@/components/app-link";
import { accountRequest } from "@/lib/account/client";
import {
  dated,
  duration,
  type Evidence,
  type JournalSnapshot,
  type MonitorDiagnostic,
  type MonitorEntry,
  type MonitorReport,
  type MonitorSettings,
} from "@/lib/monitor/types";

const deniesAccess = (failure: unknown) => {
  const status = (failure as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
};
const summarizedCounts = (sections: Record<string, { shown: number; total: number }>) =>
  Object.keys(sections)
    .map((section) => `${section}: ${sections[section].shown} of ${sections[section].total}`)
    .join(" · ");
/** Same meanings as the Android widgets: a coverage limit or recent warning is not a failure. */
const diagnosticLabel = (check: Pick<MonitorDiagnostic, "color" | "state" | "coverageLimit">) =>
  check.color === "red"
    ? "Confirmed failure"
    : check.color === "green"
      ? "Current and healthy"
      : check.coverageLimit
        ? "Coverage limit (not measured by design)"
        : check.state === "warning"
          ? "Recent problem, not current"
          : "Unverified or stale";
const tabs = ["history", "reports", "task", "diagnostics", "registry"] as const;
type Tab = (typeof tabs)[number];
type RetiredSpan = {
  retiredAt: number;
  retiredBy: { id: string; name: string };
  reason?: string;
  reinstatedAt?: number | null;
  reinstatedBy?: { id: string; name: string } | null;
};
type Registry = {
  id: string;
  name: string;
  description: string;
  mode: string;
  expectedMs: number;
  lastSuccessAt: number | null;
  builtin?: boolean;
  revision?: number;
  /** Present while the owner has retired this custom log; its history is kept. */
  retired?: RetiredSpan | null;
  /** Closed retired spans, oldest first. */
  retirements?: RetiredSpan[];
};
const currentTab = (): Tab | null => {
  if (typeof window === "undefined") return null;
  const id = window.location.hash.replace("#monitor-", "");
  return tabs.includes(id as Tab) ? (id as Tab) : null;
};
function EvidenceLinks({ links = [] }: { links?: Evidence[] }) {
  return (
    <>
      {links
        .filter((l) => l.url?.startsWith("https://"))
        .map((link, i) => (
          <a key={`${link.url}-${i}`} href={link.url} target="_blank" rel="noreferrer">
            {link.label} ↗
          </a>
        ))}
    </>
  );
}
function Entry({ entry }: { entry: MonitorEntry }) {
  return (
    <article className="monitor-entry monitor-change" id={`monitor-entry-${entry.sequence}`}>
      <p className="owner-monitor-note">
        {entry.source} · observed {dated(entry.observedAt)} · collected {dated(entry.collectedAt)}
        {entry.outcome ? ` · ${entry.outcome}` : ""}
      </p>
      <p>{entry.summary}</p>
      <EvidenceLinks links={entry.evidence} />
      {entry.sources && (
        <details>
          <summary>Source freshness at collection</summary>
          {Object.entries(entry.sources).map(([name, source]) => (
            <p key={name}>
              {name}:{" "}
              {source.state === "ready" &&
              source.checkedAt &&
              entry.collectedAt - source.checkedAt > 360000
                ? "stale"
                : source.state || "unavailable"}{" "}
              · checked {dated(source.checkedAt)}
              {source.errorCode ? ` · ${source.errorCode}` : ""}
            </p>
          ))}
        </details>
      )}
      {!!entry.comparisons?.length && (
        <details>
          <summary>Measurements and comparison windows</summary>
          <div className="monitor-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>Previous</th>
                  <th>Current</th>
                  <th>Change</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {entry.comparisons.map((c) => (
                  <tr key={c.key}>
                    <th>{c.label}</th>
                    <td>{c.previous ?? "Unavailable"}</td>
                    <td>{c.current ?? "Unavailable"}</td>
                    <td>
                      {c.change === null ? "—" : `${c.change > 0 ? "+" : ""}${c.change}`}
                      {c.percent !== null ? ` (${c.percent.toFixed(1)}%)` : ""}
                    </td>
                    <td>
                      {c.kind} · {c.unit}
                      {c.windowMs ? ` · ${duration(c.windowMs)} window` : ""}
                      {c.reason ? ` · ${c.reason}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </article>
  );
}
async function saveExport(name: string, value: unknown) {
  const text = JSON.stringify(value, null, 2);
  if (import.meta.env.VITE_MOBILE === "true")
    await (await import("@/lib/mobile/files")).saveTextFile(name, text);
  else {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function MonitorTaskSummary({ data, now }: { data: JournalSnapshot; now: number }) {
  const status = data.developmentStatus,
    task = status?.task;
  return (
    <div className="monitor-current-task">
      <strong className="monitor-change" key={`${task?.id}:${task?.state}`}>
        {status?.label || "No development task active"}
      </strong>
      {task && (
        <>
          <p>
            {task.phase} · {task.state} ·{" "}
            <span className="monitor-timer" aria-label="Total task elapsed time">
              {duration((task.completedAt || now) - task.startedAt)}
            </span>{" "}
            total elapsed
          </p>
          <p className="monitor-change" key={task.progressAt}>
            {task.progress || task.objective}
          </p>
          <small>
            Progress {dated(task.progressAt)} · telemetry {dated(task.heartbeatAt)}
          </small>
        </>
      )}
      {status?.warning && (
        <p className="monitor-warning" role="status">
          ⚠ {status.warning.message} {status.warning.blocker} {status.warning.nextAction}
        </p>
      )}
    </div>
  );
}
/** Shared website/bundled Android owner controls. Only current-session requests supply private data. */
export function MonitorJournal({ data, refresh }: { data: JournalSnapshot; refresh: () => void }) {
  const [tab, setTab] = useState<Tab | null>(currentTab);
  const [entries, setEntries] = useState<MonitorEntry[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [query, setQuery] = useState(""),
    [source, setSource] = useState("");
  const [reports, setReports] = useState<MonitorReport[]>([]),
    [registry, setRegistry] = useState<Registry[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [settings, setSettings] = useState<MonitorSettings | undefined>(data.settings);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [reduced, setReduced] = useState(
    () => localStorage.getItem("lootsplit.monitor.reduced-motion") === "true",
  );
  useEffect(() => {
    const open = () => setTab(currentTab());
    window.addEventListener("hashchange", open);
    window.addEventListener("lootsplit-monitor-destination", open);
    return () => {
      window.removeEventListener("hashchange", open);
      window.removeEventListener("lootsplit-monitor-destination", open);
    };
  }, []);
  useEffect(() => {
    document.querySelector(".owner-monitor")?.setAttribute("data-reduced-motion", String(reduced));
  }, [reduced]);
  async function action(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await run();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Monitoring could not be loaded.");
      // Authorization rejection clears private data; a validation or transport error keeps the
      // loaded lists so a mistyped form does not wipe the history the owner is reading.
      if (deniesAccess(failure)) {
        setEntries([]);
        setReports([]);
        setRegistry([]);
      }
    } finally {
      setBusy(false);
    }
  }
  function changeStatus(log: Registry, change: "retire" | "reinstate", reason = "") {
    void action(async () => {
      await accountRequest(`owner/monitor/registry/${change}`, {
        id: log.id,
        revision: log.revision ?? 0,
        eventId: crypto.randomUUID(),
        reason,
      });
      const result = await accountRequest<{ logs: Registry[] }>("owner/monitor/registry");
      setRegistry(result.logs);
      setConfirmRetire(null);
      setMessage(
        change === "retire"
          ? `${log.name} retired. Its history stays in Monitoring logs and exports; daily reports list it under Retired logs instead of reporting missing data.`
          : `${log.name} reinstated. Daily coverage resumes now; the retired span is shown as retired, not as a gap.`,
      );
    });
  }
  async function loadHistory(more = false) {
    const parameters = new URLSearchParams({ q: query, source });
    if (more && next) parameters.set("before", String(next));
    const result = await accountRequest<{ entries: MonitorEntry[]; next: string | null }>(
      `owner/monitor/history?${parameters}`,
    );
    setEntries((old) => (more ? [...old, ...result.entries] : result.entries));
    setNext(result.next);
  }
  useEffect(() => {
    if (!tab) return;
    let current = true;
    const abort = new AbortController();
    setError("");
    const endpoint =
      tab === "history"
        ? "history"
        : tab === "reports"
          ? "reports"
          : tab === "registry"
            ? "registry"
            : null;
    if (endpoint)
      void accountRequest<{
        entries?: MonitorEntry[];
        next?: string | null;
        reports?: MonitorReport[];
        logs?: Registry[];
        settings?: MonitorSettings;
      }>(`owner/monitor/${endpoint}`, undefined, abort.signal)
        .then((result) => {
          if (!current) return;
          if (result.entries) {
            setEntries(result.entries);
            setNext(result.next || null);
          }
          if (result.reports) setReports(result.reports);
          if (result.logs) setRegistry(result.logs);
          if (result.settings) setSettings(result.settings);
        })
        .catch((failure) => {
          if (current) {
            setError(failure instanceof Error ? failure.message : "Monitoring unavailable.");
            if (deniesAccess(failure)) {
              setEntries([]);
              setReports([]);
              setRegistry([]);
            }
          }
        });
    return () => {
      current = false;
      abort.abort();
    };
  }, [tab]);
  const task = data.developmentStatus?.task;
  return (
    <section className="monitor-journal" aria-label="Monitoring journal">
      <nav aria-label="Monitoring details">
        {tabs.map((value) => (
          <AppLink
            key={value}
            href={`/account#monitor-${value}`}
            onClick={() => setTab(value)}
            aria-current={tab === value ? "page" : undefined}
          >
            {
              {
                history: "Monitoring logs",
                reports: "Daily reports",
                task: "Development task",
                diagnostics: "Diagnostics",
                registry: "Log registry & settings",
              }[value]
            }
          </AppLink>
        ))}
      </nav>
      <p className="owner-monitor-note">
        Snapshot {data.snapshotId ?? "unavailable"} · collected {dated(data.checkedAt)}. Android
        delivery can be delayed independently.
      </p>
      <label className="monitor-motion">
        <input
          type="checkbox"
          checked={reduced}
          onChange={(e) => {
            setReduced(e.target.checked);
            localStorage.setItem("lootsplit.monitor.reduced-motion", String(e.target.checked));
          }}
        />{" "}
        Reduce monitor motion
      </label>
      {data.monitoring && (
        <div className="monitor-entry">
          <strong>Latest scheduled entry · {data.monitoring.outcome}</strong>
          <p>{data.monitoring.summary}</p>
          <small>
            Scheduled {dated(data.monitoring.scheduledAt)} · collected{" "}
            {dated(data.monitoring.collectedAt)}
          </small>
        </div>
      )}
      {!!data.recentEntries?.length && (
        <details>
          <summary>Recent monitoring explanations</summary>
          {data.recentEntries.map((e) => (
            <Entry key={e.id} entry={e} />
          ))}
        </details>
      )}
      <div className="monitor-entry">
        <strong>Latest daily report</strong>
        <p>
          {data.dailyReport?.summary ||
            "No daily report has been generated yet. Backend collection continues independently of this screen."}
        </p>
        {data.dailyReport && (
          <small>
            {data.dailyReport.timezone} · generated {dated(data.dailyReport.generatedAt)}
          </small>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {tab === "history" && (
        <section id="monitor-history">
          <h3>Monitoring history</h3>
          <form
            className="monitor-tools"
            onSubmit={(e) => {
              e.preventDefault();
              void action(() => loadHistory());
            }}
          >
            <label>
              Search explanations
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              Log source
              <input
                value={source}
                placeholder="All sources"
                onChange={(e) => setSource(e.target.value)}
                list="monitor-source-list"
              />
            </label>
            <datalist id="monitor-source-list">
              {[
                "monitoring",
                "performance",
                "development",
                "diagnostics",
                "workflows",
                "devices",
                "multiplayer",
                "room-storage",
                "campaign-limit",
                "reports",
                "recovery",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </datalist>
            <button disabled={busy}>Search logs</button>
          </form>
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
          {!entries.length && (
            <p>
              No matching entries. An absent source is reported as a coverage gap in the daily
              report.
            </p>
          )}
          <div className="monitor-tools">
            <button disabled={busy || !next} onClick={() => void action(() => loadHistory(true))}>
              Load older entries
            </button>
            <button
              disabled={busy || !entries.length}
              onClick={() =>
                void action(async () => {
                  await saveExport("lootsplit-monitoring-page.json", {
                    exportedAt: Date.now(),
                    entries,
                    next,
                    filters: { source, query },
                    retention:
                      "No automatic deletion; continue using next cursor for complete history.",
                  });
                  setMessage(
                    "This page was exported; load older entries to include earlier history.",
                  );
                })
              }
            >
              Export loaded entries
            </button>
          </div>
        </section>
      )}
      {tab === "reports" && (
        <section id="monitor-reports">
          <h3>Daily reports</h3>
          <p>
            Calendar-day reports include every registered log. Missing sources remain visible. The
            schedule is configured below.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const report = await accountRequest<MonitorReport>("owner/monitor/report", {});
                setReports((old) => [report, ...old.filter((r) => r.id !== report.id)]);
                refresh();
              })
            }
          >
            Generate previous day
          </button>
          {reports.map((report) => (
            <article className="monitor-entry" key={report.id}>
              <h4>
                {report.day} · {report.timezone}
              </h4>
              <p>{report.summary}</p>
              <p className="owner-monitor-note">Generated {dated(report.generatedAt)}</p>
              {report.refreshStopped && (
                <p className="owner-monitor-note">
                  Out of date: automatic refresh stopped {dated(report.refreshStopped.at)} after{" "}
                  {report.refreshStopped.attempts} failed attempts. Last error:{" "}
                  {report.refreshStopped.error}{" "}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const fresh = await accountRequest<MonitorReport>("owner/monitor/report", {
                          day: report.day,
                          timezone: report.timezone,
                        });
                        setReports((old) => old.map((r) => (r.id === fresh.id ? fresh : r)));
                        refresh();
                      })
                    }
                  >
                    Retry refresh
                  </button>
                </p>
              )}
              {report.summarized && (
                <p className="owner-monitor-note">
                  {report.summarized.note} {summarizedCounts(report.summarized.sections)}
                </p>
              )}
              <ul>
                {report.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {!!report.gaps.length && (
                <details open>
                  <summary>Coverage gaps ({report.gaps.length})</summary>
                  <ul>
                    {report.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!!report.unresolved?.length && (
                <details>
                  <summary>Unresolved component observations at day end</summary>
                  {report.unresolved.map((d) => (
                    <p key={d.component}>
                      <strong>
                        {d.component} · {diagnosticLabel(d)}
                      </strong>
                      : {d.symptom} {d.action} Last checked {dated(d.latestCheckAt)}. Evidence:{" "}
                      {d.entryId}.
                    </p>
                  ))}
                </details>
              )}
              {report.cloudflareUsage && (
                <details>
                  <summary>
                    Cloudflare plan usage ({report.cloudflareUsage.available} of{" "}
                    {report.cloudflareUsage.readings} hourly readings)
                  </summary>
                  {report.cloudflareUsage.latest ? (
                    <>
                      <p className="owner-monitor-note">
                        Latest available reading {dated(report.cloudflareUsage.latest.observedAt)}.
                        Account-wide, UTC windows, against the Workers Paid included allowance.
                      </p>
                      <ul>
                        {report.cloudflareUsage.lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>
                      No available Cloudflare usage reading for this day; this is a coverage gap.
                    </p>
                  )}
                </details>
              )}
              <details>
                <summary>Analytics changes and measurement windows</summary>
                {report.trends?.map((trend) => (
                  <Entry
                    key={`${trend.scheduledAt}:${trend.recovered ? "recovered" : "observed"}`}
                    entry={{
                      id: `trend-${trend.scheduledAt}`,
                      sequence: trend.scheduledAt,
                      source: "monitoring",
                      observedAt: trend.scheduledAt,
                      collectedAt: trend.collectedAt || 0,
                      summary: trend.recovered
                        ? "Historical traffic recovered after collection. These values do not reconstruct other unobserved services; comparison uses the preceding interval available within this report."
                        : "Comparison with the preceding available monitoring observation. Open measurements for values, changes and reset or missing-data explanations.",
                      comparisons: trend.comparisons,
                    }}
                  />
                ))}
                {!report.trends?.length && (
                  <p>No comparable monitoring measurements were available for this day.</p>
                )}
              </details>
              <details>
                <summary>Development progress and unresolved tasks</summary>
                {report.development?.map(({ task: recorded, warning }) => (
                  <article className="monitor-entry" key={recorded.id}>
                    <strong>
                      {recorded.title} · {recorded.state} · {recorded.phase}
                    </strong>
                    <p>{recorded.progress || recorded.objective}</p>
                    <p>
                      Total elapsed at day end: {duration(recorded.totalElapsedMs)}. Progress{" "}
                      {dated(recorded.progressAt)}; telemetry {dated(recorded.heartbeatAt)}.
                    </p>
                    {warning && (
                      <p>
                        ⚠ {warning.message} {warning.blocker} {warning.nextAction}
                      </p>
                    )}
                    <EvidenceLinks links={recorded.links} />
                  </article>
                ))}
                {!report.development?.length && (
                  <p>No task was active or completed in the available records for this day.</p>
                )}
              </details>
              {!!report.retiredLogs?.length && (
                <details>
                  <summary>Retired logs ({report.retiredLogs.length})</summary>
                  <p className="owner-monitor-note">
                    Retired spans are not active coverage and are not counted as missing data. Their
                    stored entries remain in History.
                  </p>
                  <ul>
                    {report.retiredLogs.map((r) => (
                      <li key={`${r.id}:${r.retiredAt}`}>
                        <strong>{r.name}</strong> · retired {dated(r.retiredAt)} by{" "}
                        {r.retiredBy?.name || "owner"}
                        {r.reason ? ` (${r.reason})` : ""} ·{" "}
                        {r.reinstatedAt
                          ? `reinstated ${dated(r.reinstatedAt)} by ${r.reinstatedBy?.name || "owner"}`
                          : "still retired at day end"}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <details>
                <summary>Registered sources and evidence</summary>
                {report.coverage?.map((c) => (
                  <p key={c.id}>
                    <strong>{c.name}</strong>: {c.entries} entries ·{" "}
                    {c.gap ||
                      (c.mode === "event" && !c.entries
                        ? "No events recorded; no active work is inferred."
                        : "Coverage checked")}{" "}
                    · latest {dated(c.lastObservationAt)}
                    {c.retiredSpans?.length ? " · retired for part of this day" : ""}
                  </p>
                ))}
                {report.evidence?.map((e) => (
                  <Entry key={e.id} entry={e} />
                ))}
                {report.correlations?.map((c) => (
                  <p key={c.entry}>
                    {c.statement}{" "}
                    {[c.entry, ...c.related].map((id) => {
                      const linked = report.evidence?.find((e) => e.id === id);
                      return linked ? (
                        <button
                          key={id}
                          onClick={() =>
                            document
                              .getElementById(`monitor-entry-${linked.sequence}`)
                              ?.scrollIntoView({ block: "nearest" })
                          }
                        >
                          View {linked.source} evidence
                        </button>
                      ) : (
                        <span key={id}> {id}</span>
                      );
                    })}
                  </p>
                ))}
              </details>
              <button
                onClick={() =>
                  void action(() => saveExport(`lootsplit-report-${report.day}.json`, report))
                }
              >
                Export report
              </button>
            </article>
          ))}
          <button
            disabled={busy || reports.length < 31}
            onClick={() =>
              void action(async () => {
                const result = await accountRequest<{ reports: MonitorReport[] }>(
                  `owner/monitor/reports?before=${reports.at(-1)?.day}`,
                );
                setReports((old) => [...old, ...result.reports]);
              })
            }
          >
            Load older reports
          </button>
        </section>
      )}
      {tab === "task" && (
        <section id="monitor-task">
          <h3>Development task</h3>
          {task && (
            <>
              <p>{task.objective}</p>
              <p>
                Task ID <code>{task.id}</code> · revision {task.revision} · started{" "}
                {dated(task.startedAt)} · completed {dated(task.completedAt)}
              </p>
              <p>
                Recorded active {duration(task.timings.active || 0)} · testing{" "}
                {duration(task.timings.testing || 0)} · deployment{" "}
                {duration(task.timings.deploying || 0)} · pauses{" "}
                {duration(task.timings.paused || 0)} · blockers{" "}
                {duration(task.timings.blocked || 0)}
              </p>
              <p>
                Unobserved time {duration(task.unobservedMs)}. Recorded active time uses
                heartbeat-bounded spans; elapsed wall time is not measured effort.
              </p>
              <p>
                {task.blocker ? `Blocker: ${task.blocker}` : "No blocker recorded."} Next:{" "}
                {task.nextAction || "No next action recorded."}
              </p>
              <EvidenceLinks links={task.links} />
            </>
          )}
          <details>
            <summary>Publish task start, progress, pause or handoff</summary>
            <form
              key={`${task?.id}-${task?.revision}`}
              className="monitor-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void action(async () => {
                  const id = String(values.get("id"));
                  await accountRequest("owner/monitor/task", {
                    id,
                    revision: id === task?.id ? task.revision : 0,
                    eventId: crypto.randomUUID(),
                    title: values.get("title"),
                    objective: values.get("objective"),
                    phase: values.get("phase"),
                    state: values.get("state"),
                    progress: values.get("progress"),
                    blocker: values.get("blocker"),
                    nextAction: values.get("nextAction"),
                    expectedUntil:
                      Number(values.get("expected")) > 0
                        ? Date.now() + Number(values.get("expected")) * 60000
                        : null,
                  });
                  setMessage("Task event saved with its persistent timing history.");
                  refresh();
                });
              }}
            >
              <label>
                Task identifier
                <input
                  name="id"
                  required
                  defaultValue={task?.active ? task.id : `update-${Date.now()}`}
                  maxLength={120}
                />
              </label>
              <label>
                Title
                <input
                  name="title"
                  required
                  defaultValue={task?.active ? task.title : ""}
                  maxLength={160}
                />
              </label>
              <label>
                Plain-English objective
                <textarea
                  name="objective"
                  required
                  defaultValue={task?.active ? task.objective : ""}
                  maxLength={600}
                />
              </label>
              <label>
                Phase
                <input
                  name="phase"
                  defaultValue={task?.active ? task.phase : "Planning"}
                  maxLength={160}
                />
              </label>
              <label>
                State
                <select
                  aria-label="State"
                  name="state"
                  defaultValue={task?.active ? task.state : "active"}
                >
                  {[
                    "queued",
                    "active",
                    "testing",
                    "deploying",
                    "paused",
                    "blocked",
                    "completed",
                    "failed",
                    "idle",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Latest meaningful progress
                <textarea
                  name="progress"
                  defaultValue={task?.active ? task.progress : ""}
                  maxLength={1000}
                />
              </label>
              <label>
                Known blocker
                <textarea
                  name="blocker"
                  defaultValue={task?.active ? task.blocker : ""}
                  maxLength={600}
                />
              </label>
              <label>
                Next action
                <textarea
                  name="nextAction"
                  defaultValue={task?.active ? task.nextAction : ""}
                  maxLength={600}
                />
              </label>
              <label>
                Expected stage duration (minutes, optional)
                <input name="expected" type="number" min="0" max="10080" />
              </label>
              <button disabled={busy}>Publish task update</button>
            </form>
          </details>
        </section>
      )}
      {tab === "diagnostics" && (
        <section id="monitor-diagnostics">
          <h3>Component diagnostics</h3>
          <p>
            {data.overall?.label}: {data.overall?.reason}
          </p>
          {data.diagnostics?.map((check) => (
            <article key={check.component} className="monitor-entry">
              <strong className="monitor-change" key={check.color}>
                <span className="monitor-light" data-color={check.color} aria-hidden="true">
                  ●
                </span>{" "}
                {check.component} · {diagnosticLabel(check)}
              </strong>
              <p>{check.symptom}</p>
              {check.lastAt ? (
                <p>
                  {check.brief ? `${check.brief} · ` : ""}last {dated(check.lastAt)}
                </p>
              ) : null}
              <p>
                {check.impact} {check.action}
              </p>
              <details>
                <summary>Check times and technical details</summary>
                <p>
                  First occurrence: {dated(check.firstOccurredAt)} · latest check:{" "}
                  {dated(check.latestCheckAt)} · last success: {dated(check.lastSuccessAt)} ·
                  duration {duration(check.durationMs)}
                </p>
                <p>
                  Error code: {check.errorCode || "Unavailable"} · confirmed cause:{" "}
                  {check.confirmedCause || "Not established"} · suspected cause:{" "}
                  {check.suspectedCause || "Not established"}
                </p>
                {check.retainedFailure && (
                  <p>A later disconnection has not cleared the previous confirmed failure.</p>
                )}
              </details>
            </article>
          ))}
          <h4>Android device reports</h4>
          {data.devices?.length ? (
            data.devices.map((d) => (
              <p key={d.id}>
                Installation {d.id.slice(0, 8)} · {d.version} · snapshot {d.snapshotId} · last
                reported {dated(d.lastReportedAt)} · {d.delivery}
              </p>
            ))
          ) : (
            <p>
              No device has reported. Phone connectivity cannot be inferred from the backend check.
            </p>
          )}
        </section>
      )}
      {tab === "registry" && (
        <section id="monitor-registry">
          <h3>Log registry & schedule</h3>
          <p>
            Every future log explicitly requested or designated for Lootsplitter must automatically
            become part of the daily report. Register it before its first entry; an unavailable
            registered source remains a coverage gap.
          </p>
          {registry.map((log) => (
            <details key={log.id} className="monitor-registry-log">
              <summary>
                {log.name} · {log.id}
                {log.retired ? " · retired" : ""}
              </summary>
              <p>{log.description}</p>
              <p>
                {log.mode} · expected interval{" "}
                {log.expectedMs ? duration(log.expectedMs) : "event driven"} · last successful check{" "}
                {dated(log.lastSuccessAt)}
              </p>
              {log.retired && (
                <p>
                  <strong>Retired</strong> {dated(log.retired.retiredAt)} by{" "}
                  {log.retired.retiredBy.name}
                  {log.retired.reason ? `: ${log.retired.reason}` : "."} No missing-data gaps are
                  reported while retired; all stored entries stay in Monitoring logs and exports.
                </p>
              )}
              {!!log.retirements?.length && (
                <ul aria-label={`Earlier retired spans of ${log.name}`}>
                  {log.retirements.map((span) => (
                    <li key={span.retiredAt}>
                      Retired {dated(span.retiredAt)} by {span.retiredBy.name} · reinstated{" "}
                      {dated(span.reinstatedAt ?? null)} by {span.reinstatedBy?.name || "owner"}
                    </li>
                  ))}
                </ul>
              )}
              {log.builtin ? (
                <p className="owner-monitor-note">
                  Built-in log maintained in code; it cannot be retired.
                </p>
              ) : log.retired ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => changeStatus(log, "reinstate")}
                >
                  Reinstate {log.name}
                </button>
              ) : confirmRetire === log.id ? (
                <form
                  className="monitor-form monitor-retire-confirm"
                  aria-labelledby={`retire-${log.id}-title`}
                  aria-describedby={`retire-${log.id}-detail`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    changeStatus(
                      log,
                      "retire",
                      String(new FormData(e.currentTarget).get("reason") || ""),
                    );
                  }}
                >
                  <p id={`retire-${log.id}-title`}>
                    <strong>Retire {log.name}?</strong>
                  </p>
                  <p id={`retire-${log.id}-detail`}>
                    Nothing is deleted: every stored entry stays readable and exportable, and the
                    change is recorded in this log&apos;s history. From now on daily reports stop
                    reporting missing data for it and list it under Retired logs. You can reinstate
                    it at any time.
                  </p>
                  <label>
                    Reason (optional)
                    <input name="reason" maxLength={500} autoFocus />
                  </label>
                  <div className="monitor-retire-actions">
                    <button disabled={busy}>Retire log</button>
                    <button type="button" onClick={() => setConfirmRetire(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" disabled={busy} onClick={() => setConfirmRetire(log.id)}>
                  Retire {log.name}…
                </button>
              )}
            </details>
          ))}
          {settings && (
            <form
              key={`${settings.timezone}-${settings.reportTime}`}
              className="monitor-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void action(async () => {
                  const result = await accountRequest<MonitorSettings>("owner/monitor/settings", {
                    timezone: values.get("timezone"),
                    reportTime: values.get("reportTime"),
                    heartbeatMs: Number(values.get("heartbeat")) * 60000,
                    progressMs: Number(values.get("progress")) * 60000,
                    deviceFreshMs: Number(values.get("device")) * 60000,
                  });
                  setSettings(result);
                  setMessage(
                    "Schedule and thresholds saved. Backend collection remains every 30 minutes.",
                  );
                  refresh();
                });
              }}
            >
              <label>
                Report timezone
                <input name="timezone" required defaultValue={settings.timezone} />
              </label>
              <label>
                Daily report time
                <input type="time" name="reportTime" required defaultValue={settings.reportTime} />
              </label>
              <label>
                Heartbeat threshold (minutes)
                <input
                  name="heartbeat"
                  type="number"
                  min="1"
                  max="10080"
                  defaultValue={settings.heartbeatMs / 60000}
                />
              </label>
              <label>
                Progress threshold (minutes)
                <input
                  name="progress"
                  type="number"
                  min="1"
                  max="10080"
                  defaultValue={settings.progressMs / 60000}
                />
              </label>
              <label>
                Device freshness threshold (minutes)
                <input
                  name="device"
                  type="number"
                  min="1"
                  max="10080"
                  defaultValue={settings.deviceFreshMs / 60000}
                />
              </label>
              <button disabled={busy}>Save monitoring settings</button>
            </form>
          )}
          <details>
            <summary>Register an external or future log</summary>
            <form
              className="monitor-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void action(async () => {
                  await accountRequest("owner/monitor/registry", {
                    id: values.get("id"),
                    name: values.get("name"),
                    description: values.get("description"),
                    mode: values.get("mode"),
                    expectedMs: Number(values.get("interval")) * 60000,
                  });
                  const result = await accountRequest<{ logs: Registry[] }>(
                    "owner/monitor/registry",
                  );
                  setRegistry(result.logs);
                  setMessage(
                    "Log registered. It now appears in daily coverage, including when data is missing.",
                  );
                });
              }}
            >
              <label>
                Stable log ID
                <input name="id" required pattern="[a-z][a-z0-9-]*" />
              </label>
              <label>
                Name
                <input name="name" required maxLength={160} />
              </label>
              <label>
                Purpose and source
                <textarea name="description" required maxLength={1000} />
              </label>
              <label>
                Collection mode
                <select name="mode" aria-label="Collection mode">
                  <option value="external">External scheduled source</option>
                  <option value="event">Explicit events</option>
                </select>
              </label>
              <label>
                Expected interval (minutes; 0 for events)
                <input name="interval" type="number" min="0" max="10080" defaultValue="30" />
              </label>
              <button disabled={busy}>Register log</button>
            </form>
          </details>
          <details>
            <summary>Record an external log entry or coverage check</summary>
            <form
              className="monitor-form"
              onSubmit={(e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                void action(async () => {
                  await accountRequest("owner/monitor/entry", {
                    source: values.get("source"),
                    id: values.get("id"),
                    summary: values.get("summary"),
                    observedAt: new Date(String(values.get("observedAt"))).getTime(),
                    coverage: values.get("coverage") === "on",
                    outcome: "observed",
                  });
                  setMessage(
                    "Entry recorded. It will be included in the corresponding calendar-day report; older reports are automatically refreshed when late evidence arrives.",
                  );
                });
              }}
            >
              <label>
                Registered log
                <select name="source" aria-label="Registered log">
                  {registry.map((log) => (
                    <option key={log.id} value={log.id}>
                      {log.name}
                      {log.retired ? " (retired)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Persistent entry ID
                <input name="id" required defaultValue={crypto.randomUUID()} />
              </label>
              <label>
                Actual observation time
                <input name="observedAt" type="datetime-local" required />
              </label>
              <label>
                Plain-English explanation
                <textarea name="summary" maxLength={4000} required />
              </label>
              <label>
                <input name="coverage" type="checkbox" /> This explicitly attests that the source
                was checked
              </label>
              <button disabled={busy}>Record log entry</button>
            </form>
          </details>
          <p>
            No automatic history deletion. Export pages and reports for archival. Integration
            credentials remain server-only; use the documented Cloudflare analytics reconnection
            procedure.
          </p>
        </section>
      )}
    </section>
  );
}
