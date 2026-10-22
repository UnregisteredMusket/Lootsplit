import { useEffect, useState } from "react";
import { Activity, Cloud, GitBranch, RefreshCw, ShieldCheck } from "lucide-react";
import { accountRequest } from "@/lib/account/client";
import {
  ownerAnalyticsGroups,
  type OwnerAnalyticsSnapshot,
} from "@/lib/quire/owner-analytics-view";
import release from "@/lib/website/release.json";
import type { MonitorData } from "./server-monitor";
import "./owner-monitor.css";
import { MonitorJournal, MonitorTaskSummary } from "./monitor-journal";
import type { JournalSnapshot } from "@/lib/monitor/types";
import { AppLink } from "@/components/app-link";
import {
  cycleName,
  formatPercent,
  ordinal,
  usageRows,
  usageUnavailableText,
} from "@/lib/monitor/usage-format";

type Source<T> = {
  state: "ready" | "unavailable" | "not-connected";
  checkedAt: number | null;
  data: T | null;
};
type Run = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  commit: string | null;
  url: string;
  deployment: boolean;
};
type ActivityEvent = {
  id: string;
  kind: string;
  state: "ok" | "active" | "attention" | "fail";
  text: string;
  pr: number | null;
  title: string;
  at: number;
  url: string;
};
const activityGlyph = { ok: "✓", active: "!", attention: "!", fail: "✕" } as const;
const activityWord = {
  ok: "Succeeded",
  active: "In progress",
  attention: "Needs attention",
  fail: "Failed",
} as const;
type Snapshot = JournalSnapshot & {
  checkedAt: number;
  account: { name: string; email: string };
  health: MonitorData;
  analytics: Source<OwnerAnalyticsSnapshot>;
  development: Source<{
    scannedRuns: number;
    active: Run[];
    latestDeployment: Run | null;
    openPulls: { number: number; title: string; draft: boolean; url: string }[];
    /** Newest-first GitHub workflow/pull request events (also shown by the Agent activity companion). */
    events?: ActivityEvent[];
  }>;
  traffic: Source<{ requests: number; errors: number; since: string; until: string }>;
  release: Source<{ commit: string }>;
};
const count = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString());
const age = (timestamp: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  return minutes === 0 ? "just now" : `${minutes} min ago`;
};
const stateLabel = (state: Source<unknown>["state"]) =>
  state === "not-connected" ? "Not connected" : "Unavailable";
function SourceTime({ source, now }: { source: Source<unknown>; now: number }) {
  return source.checkedAt ? (
    <span>
      Checked {age(source.checkedAt, now)}
      {now - source.checkedAt > 360000 ? " · stale" : ""}
    </span>
  ) : null;
}

/** Private website overview. Existing detailed monitoring and owner tools remain below. */
export function OwnerMonitor() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    async function load() {
      if (controller || document.visibilityState !== "visible") return;
      const request = new AbortController();
      controller = request;
      setBusy(true);
      const timeout = setTimeout(() => request.abort(), 12000);
      try {
        const next = await accountRequest<Snapshot>("owner/monitor", undefined, request.signal);
        if (next.analytics.data) ownerAnalyticsGroups(next.analytics.data);
        if (alive && import.meta.env.VITE_MOBILE === "true") {
          const { OwnerWidget, hasOwnerWidget } = await import("@/lib/mobile/owner-widget");
          if (hasOwnerWidget())
            void OwnerWidget.sync({
              expectedToken: localStorage.getItem("lootsplit.account.token.v1") || "",
              snapshot: next,
            }).catch(() => {
              /* The dated native snapshot remains; its next refresh retries delivery. */
            });
        }
        if (alive) {
          setData((previous) =>
            previous?.snapshotId && next.snapshotId && previous.snapshotId > next.snapshotId
              ? previous
              : previous?.developmentStatus?.task?.id === next.developmentStatus?.task?.id &&
                  (previous?.developmentStatus?.task?.revision || 0) >
                    (next.developmentStatus?.task?.revision || 0)
                ? { ...next, developmentStatus: previous?.developmentStatus }
                : next,
          );
          setError(false);
          setNow(Date.now());
        }
      } catch (failure) {
        // Fail closed: never retain private totals or a healthy badge after a failed read.
        if (alive) {
          setData(null);
          setError(true);
          setErrorMessage(
            failure instanceof Error
              ? failure.message
              : "Owner monitoring could not be reached. Check connectivity and retry.",
          );
        }
      } finally {
        clearTimeout(timeout);
        controller = null;
        if (alive) setBusy(false);
      }
    }
    const visibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    const accountChanged = () => {
      setData(null);
      setError(false);
      setRevision((n) => n + 1);
    };
    void load();
    const poll = automatic ? setInterval(() => void load(), 60000) : undefined;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("lootsplit-account-changed", accountChanged);
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("lootsplit-account-changed", accountChanged);
    };
  }, [automatic, revision]);
  const hasData = !!data;
  useEffect(() => {
    // The Agent activity companion opens My account#field-development once the section exists.
    if (!hasData) return;
    const reveal = () => {
      if (window.location.hash === "#field-development")
        document.getElementById("field-development")?.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("lootsplit-monitor-destination", reveal);
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("lootsplit-monitor-destination", reveal);
      window.removeEventListener("hashchange", reveal);
    };
  }, [hasData]);
  const stale = !!data && now - data.checkedAt > 120000;
  const stats = data?.health.stats;
  const development = data?.development.data;
  const games = data?.analytics.data?.metrics;
  return (
    <section className="portal-card owner-monitor" aria-labelledby="owner-monitor-title">
      <header className="owner-monitor-heading">
        <div>
          <p className="portal-eyebrow">LOOTSPLIT · PRIVATE OVERVIEW</p>
          <h2 id="owner-monitor-title">Field monitor</h2>
        </div>
        <span className="owner-monitor-access">
          <ShieldCheck size={16} aria-hidden="true" /> Owner access
        </span>
        {data && (
          <div className="owner-monitor-account">
            <span className="owner-monitor-avatar" aria-hidden="true">
              {data.account.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{data.account.name}</strong>
              <span>{data.account.email}</span>
            </div>
            <span>Signed in</span>
          </div>
        )}
      </header>
      <div
        className="owner-monitor-status"
        role="status"
        data-color={
          data?.overall?.color === "red"
            ? "red"
            : stale
              ? "yellow"
              : data?.overall?.color || "yellow"
        }
      >
        <Activity size={19} aria-hidden="true" />
        <strong>
          {!data
            ? error
              ? "Status unavailable"
              : "Checking services…"
            : stale
              ? "Snapshot is stale"
              : data.overall
                ? data.overall.label
                : data.health.status === "healthy"
                  ? "Services responding"
                  : "Service needs attention"}
        </strong>
        {data && <span>{age(data.checkedAt, now)}</span>}
      </div>
      {error && (
        <p role="alert">
          {errorMessage}{" "}
          <AppLink
            href="/account#account-sign-in"
            onClick={() => window.dispatchEvent(new Event("lootsplit-monitor-sign-in"))}
          >
            Open account / sign in
          </AppLink>
        </p>
      )}
      {data && (
        <>
          {data.developmentStatus && <MonitorTaskSummary data={data} now={now} />}
          <div
            className="owner-monitor-scroll"
            tabIndex={0}
            aria-label="Scrollable monitoring details"
          >
            {data.schemaVersion === 2 && (
              <MonitorJournal data={data} refresh={() => setRevision((n) => n + 1)} />
            )}
            <dl className="owner-monitor-metrics">
              <div>
                <dt>Active accounts · 5m</dt>
                <dd className="monitor-change" key={stats?.active5m}>
                  {count(stats?.active5m)}
                </dd>
              </div>
              <div>
                <dt>Active accounts · 24h</dt>
                <dd className="monitor-change" key={stats?.active24h}>
                  {count(stats?.active24h)}
                </dd>
              </div>
              <div>
                <dt>Accounts</dt>
                <dd className="monitor-change" key={stats?.accounts}>
                  {count(stats?.accounts)}
                </dd>
              </div>
              <div>
                <dt>Stored campaigns</dt>
                <dd className="monitor-change" key={stats?.sharedCampaigns}>
                  {count(stats?.sharedCampaigns)}
                </dd>
              </div>
            </dl>
            <div className="owner-monitor-checks">
              {data.health.checks.map((check) => (
                <span key={check.name}>
                  <i data-ok={check.status === "healthy"} />
                  {check.name} ·{" "}
                  {check.status === "healthy" ? `${check.durationMs} ms` : "unavailable"}
                </span>
              ))}
            </div>
            <div className="owner-monitor-grid">
              <section aria-labelledby="field-app-stats">
                <h3 id="field-app-stats">App statistics</h3>
                <dl className="owner-monitor-list">
                  <div>
                    <dt>Cloud backups</dt>
                    <dd>{count(stats?.cloudBackups)}</dd>
                  </div>
                  <div>
                    <dt>Character profiles</dt>
                    <dd>{count(stats?.characterProfiles)}</dd>
                  </div>
                  <div>
                    <dt>Saved memberships</dt>
                    <dd>{count(stats?.savedMemberships)}</dd>
                  </div>
                  <div>
                    <dt>Push devices</dt>
                    <dd>{count(stats?.pushDevices)}</dd>
                  </div>
                </dl>
              </section>
              <section aria-labelledby="field-game-analytics">
                <h3 id="field-game-analytics">Game analytics</h3>
                <dl className="owner-monitor-list">
                  <div>
                    <dt>Recorded sessions</dt>
                    <dd>{count(games?.sessions)}</dd>
                  </div>
                  <div>
                    <dt>Completed sessions</dt>
                    <dd>{count(games?.completedSessions)}</dd>
                  </div>
                  <div>
                    <dt>Player characters</dt>
                    <dd>{count(games?.playerCharacters)}</dd>
                  </div>
                  <div>
                    <dt>Transactions</dt>
                    <dd>{count(games?.transactionCount)}</dd>
                  </div>
                </dl>
                <p className="owner-monitor-note">
                  {data.analytics.data ? (
                    <>
                      Current shared campaigns ·{" "}
                      <SourceTime
                        source={{ ...data.analytics, checkedAt: data.analytics.data.asOf }}
                        now={now}
                      />
                    </>
                  ) : (
                    "Game analytics unavailable"
                  )}
                </p>
              </section>
            </div>
            <section className="owner-monitor-traffic" aria-labelledby="field-traffic">
              <h3 id="field-traffic">
                <Cloud size={17} aria-hidden="true" /> Cloudflare traffic <span>24 hours</span>
              </h3>
              {data.traffic.data ? (
                <>
                  <dl className="owner-monitor-list">
                    <div>
                      <dt>Worker requests</dt>
                      <dd>{count(data.traffic.data.requests)}</dd>
                    </div>
                    <div>
                      <dt>Worker errors</dt>
                      <dd>{count(data.traffic.data.errors)}</dd>
                    </div>
                  </dl>
                  <p className="owner-monitor-note">
                    Cloudflare sampled analytics · <SourceTime source={data.traffic} now={now} />
                  </p>
                </>
              ) : (
                <p className="owner-monitor-note">
                  <strong>{stateLabel(data.traffic.state)}</strong> ·{" "}
                  {data.traffic.state === "not-connected"
                    ? "A read-only Cloudflare analytics connection is needed."
                    : "Cloudflare did not return a current reading."}
                </p>
              )}
            </section>
            <section className="owner-monitor-traffic" aria-labelledby="field-usage">
              <h3 id="field-usage">
                <Cloud size={17} aria-hidden="true" /> Cloudflare plan usage{" "}
                <span>Workers Paid allowance</span>
              </h3>
              {data.usage?.state === "ready" && data.usage.data ? (
                <>
                  <div className="owner-monitor-usage">
                    {usageRows(data.usage).map((row) => (
                      <div key={row.key} data-level={row.level}>
                        <strong>
                          {row.level === "attention" || row.level === "over" ? "! " : ""}
                          {row.label}
                        </strong>
                        {row.unavailable ? (
                          <p>Unavailable ({row.unavailable}); not counted as zero.</p>
                        ) : (
                          <dl className="owner-monitor-list">
                            {row.cells.map((cell) => (
                              <div key={cell.window}>
                                <dt>{cell.window}</dt>
                                <dd>
                                  {cell.value} <small>({cell.share})</small>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="owner-monitor-note">
                    Account-wide, UTC. Included usage resets on your Cloudflare billing renewal day
                    {data.usage.data.windows.month.renewalDay
                      ? ` (the ${ordinal(data.usage.data.windows.month.renewalDay)} of each month)`
                      : ""}
                    . Today and 7 days compare with the monthly allowance divided by the days in
                    this billing cycle (daily share) and seven daily shares (weekly share);{" "}
                    {cycleName(data.usage.data.windows.month)} compares with the full allowance,{" "}
                    {formatPercent(data.usage.data.windows.month.elapsedPercent)} of the{" "}
                    {data.usage.data.windows.month.basis === "billing-cycle"
                      ? "billing cycle"
                      : "month"}{" "}
                    has elapsed. Allowances verified {data.usage.data.allowancesVerifiedOn} ·{" "}
                    {data.usage.checkedAt
                      ? `checked ${age(data.usage.checkedAt, now)}`
                      : "check time unavailable"}{" "}
                    · collected hourly
                  </p>
                </>
              ) : (
                <p className="owner-monitor-note">
                  <strong>{usageUnavailableText(data.usage)}</strong>
                </p>
              )}
            </section>
            <section className="owner-monitor-development" aria-labelledby="field-development">
              <h3 id="field-development">
                <GitBranch size={17} aria-hidden="true" /> Development & deployments
              </h3>
              {development ? (
                <>
                  <p>
                    {development.active.length
                      ? `${development.active.length} active workflow${development.active.length === 1 ? "" : "s"} in recent activity`
                      : "No active workflows in recent activity"}
                  </p>
                  {development.active.slice(0, 3).map((run) => (
                    <a
                      className="owner-monitor-run"
                      key={run.id}
                      href={run.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        {run.name}
                        <small>
                          {run.branch}
                          {run.commit ? ` · ${run.commit.slice(0, 7)}` : ""}
                        </small>
                      </span>
                      <b>{run.status.replaceAll("_", " ")}</b>
                    </a>
                  ))}
                  {development.active.length > 3 && (
                    <a
                      href="https://github.com/UnregisteredMusket/Lootsplit/actions"
                      target="_blank"
                      rel="noreferrer"
                    >
                      View all workflow activity
                    </a>
                  )}
                  <p className="owner-monitor-note">
                    {development.openPulls.length === 100 ? "100+" : development.openPulls.length}{" "}
                    open changes · <SourceTime source={data.development} now={now} />
                  </p>
                  {development.openPulls.slice(0, 2).map((pr) => (
                    <a
                      className="owner-monitor-change"
                      key={pr.number}
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      #{pr.number} {pr.title}
                      {pr.draft ? " · draft" : ""}
                    </a>
                  ))}
                  {development.latestDeployment && (
                    <a
                      className="owner-monitor-run"
                      href={development.latestDeployment.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        Latest website deployment
                        <small>{development.latestDeployment.commit?.slice(0, 7)}</small>
                      </span>
                      <b>
                        {(
                          development.latestDeployment.conclusion ||
                          development.latestDeployment.status
                        ).replaceAll("_", " ")}
                      </b>
                    </a>
                  )}
                  {development.events && (
                    <>
                      <h4 id="field-activity">Recent GitHub activity</h4>
                      {development.events.length ? (
                        <ol className="owner-monitor-activity" aria-labelledby="field-activity">
                          {development.events.map((event) => (
                            <li key={event.id}>
                              <a
                                className="owner-monitor-run"
                                data-state={event.state}
                                href={event.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <span>
                                  <b aria-hidden="true">{activityGlyph[event.state]}</b>{" "}
                                  <span className="sr-only">{activityWord[event.state]}: </span>
                                  {event.text}
                                  {event.title && event.kind.startsWith("pr-")
                                    ? ` · ${event.title}`
                                    : ""}
                                  <small>{age(event.at, now)}</small>
                                </span>
                              </a>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="owner-monitor-note">
                          No recent workflow runs or pull request changes.
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="owner-monitor-note">
                  {stateLabel(data.development.state)} · Development activity cannot be confirmed.
                </p>
              )}
            </section>
            <div className="owner-monitor-release">
              <span>
                Serving website{" "}
                <strong>{data.release.data?.commit.slice(0, 7) || "unavailable"}</strong>
              </span>
              <span>
                Android <strong>{release.version}</strong>
              </span>
            </div>
            <details className="owner-monitor-details">
              <summary>Reading this monitor</summary>
              <p>
                Account activity means signed-in check-ins, including staff, not concurrent players
                or guest presence. Stored campaigns are not necessarily active sessions. Game
                analytics counts accepted records in current shared campaigns, excluding test rooms,
                local saves and private backups; it is not a count of unique people or play time.
              </p>
              <p>
                Provider readings are cached for up to five minutes. GitHub activity covers the
                latest {development?.scannedRuns ?? "100"} workflow runs, up to 100 open changes and
                the 20 most recently updated closed changes; local development, unsubmitted work and
                the development chat are not visible. While a workflow runs, GitHub readings refresh
                about every minute. Deployment workflow results are separate from the website
                version serving this request. Service checks cover the database and website assets,
                not global uptime.
              </p>
              <p>
                Cloudflare Worker:{" "}
                <code>{data.health.version?.id || "Version metadata unavailable"}</code>. Android is
                the published download version; this website update does not install a phone widget.
              </p>
            </details>
          </div>
        </>
      )}
      <footer className="owner-monitor-footer">
        <button
          type="button"
          className="portal-button secondary"
          disabled={busy}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {busy ? "Refreshing…" : "Refresh overview"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />{" "}
          Auto-refresh every minute
        </label>
      </footer>
    </section>
  );
}
