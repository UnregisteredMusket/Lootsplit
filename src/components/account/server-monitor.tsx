import { useEffect, useState } from "react";
import { accountRequest } from "@/lib/account/client";

type MonitorData = {
  checkedAt: number;
  durationMs: number;
  status: "healthy" | "degraded";
  checks: { name: string; status: "healthy" | "unavailable"; durationMs: number }[];
  stats: null | {
    accounts: number;
    active5m: number;
    active24h: number;
    sharedCampaigns: number;
    savedMemberships: number;
    cloudBackups: number;
    characterProfiles: number;
    pushDevices: number;
    pushConfigured: number;
    moderation24h: number;
  };
  version: null | { id: string | null; createdAt: string | null };
};
export function ServerMonitor() {
  const [open, setOpen] = useState(false);
  return (
    <section className="portal-card server-monitor" aria-labelledby="monitor-title">
      <p className="portal-eyebrow">OWNER & ADMINISTRATORS</p>
      <h2 id="monitor-title">Server monitoring</h2>
      <p>Check live service health, account activity and shared storage totals.</p>
      <button
        className="portal-button secondary"
        aria-expanded={open}
        aria-controls="monitor-panel"
        onClick={() => setOpen(!open)}
      >
        {open ? "Close server monitor" : "Open server monitor"}
      </button>
      {open && <MonitorPanel />}
    </section>
  );
}
function MonitorPanel() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const controller = new AbortController();
    async function load() {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      setBusy(true);
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const next = await accountRequest<MonitorData>("monitor", undefined, controller.signal);
        if (alive) {
          setData(next);
          setReceivedAt(Date.now());
          setError("");
        }
      } catch {
        if (alive) {
          setData(null);
          setError(
            "Monitoring is unavailable. Check your connection and sign-in permissions, then refresh. No current health result is available.",
          );
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (alive) setBusy(false);
      }
    }
    void load();
    const interval = automatic
      ? setInterval(() => {
          if (!controller.signal.aborted) void load();
          else setRefresh((n) => n + 1);
        }, 30000)
      : undefined;
    const visible = () => {
      if (automatic && document.visibilityState === "visible") setRefresh((n) => n + 1);
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [automatic, refresh]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale = !!data && clock - receivedAt > 60000;
  const stats = data?.stats;
  return (
    <div id="monitor-panel" className="monitor-panel" aria-busy={busy}>
      <div className="portal-actions">
        <button className="portal-button" disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
          {busy ? "Checking services…" : "Refresh server status"}
        </button>
        <label className="monitor-auto">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(e) => setAutomatic(e.target.checked)}
          />
          Auto-refresh every 30 seconds
        </label>
      </div>
      <p className="monitor-summary" role="status">
        {error
          ? "Status unavailable"
          : stale
            ? "Snapshot is stale — refresh to check current health"
            : data
              ? data.status === "healthy"
                ? "Service checks passed"
                : "Service check needs attention"
              : "Checking services…"}
      </p>
      {error && (
        <p className="portal-message error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>
            Last checked:{" "}
            <time dateTime={new Date(data.checkedAt).toISOString()}>
              {new Date(data.checkedAt).toLocaleString()}
            </time>
            . Server checks took {data.durationMs.toLocaleString()} ms.
          </p>
          <div className="monitor-services">
            {data.checks.map((check) => (
              <div key={check.name} className={`monitor-service ${stale ? "stale" : check.status}`}>
                <h3>{check.name}</h3>
                <strong>
                  {stale
                    ? "Stale result"
                    : check.status === "healthy"
                      ? "Available"
                      : "Check failed"}
                </strong>
                <span>{check.durationMs.toLocaleString()} ms at last check</span>
              </div>
            ))}
          </div>
          <p>
            Account authentication passed for this request. Asset health checks a bundled image;
            database health checks the aggregate queries below.
          </p>
          {stats ? (
            <>
              <dl className="owner-stats">
                {[
                  ["Total accounts", stats.accounts],
                  ["Members active · 5 min", stats.active5m],
                  ["Members active · 24 hr", stats.active24h],
                  ["Shared campaigns", stats.sharedCampaigns],
                  ["Saved memberships", stats.savedMemberships],
                  ["Cloud backups", stats.cloudBackups],
                  ["Character profiles", stats.characterProfiles],
                  ["Web push devices", stats.pushDevices],
                  ["Moderation actions · 24 hr", stats.moderation24h],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{Number(value).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Activity is approximate, based on signed-in account check-ins; it includes this
                administrator. Campaign totals include all stored shared rooms. Devices are unique
                web push endpoints, not confirmed deliveries.
              </p>
              <h3>Notification readiness</h3>
              <ul className="monitor-notifications">
                <li>
                  Web push:{" "}
                  {stats.pushConfigured
                    ? "server keys configured; delivery not tested"
                    : "keys not initialized yet"}
                  .
                </li>
                <li>Email delivery: not enabled.</li>
                <li>Native Android push: not integrated.</li>
              </ul>
            </>
          ) : (
            <p>Usage totals are unavailable because the database check failed.</p>
          )}
          <details className="monitor-release">
            <summary>Running release</summary>
            <p>
              Cloudflare Worker version: {data.version?.id || "Not available in this environment"}
            </p>
            {data.version?.createdAt && (
              <p>Version created: {new Date(data.version.createdAt).toLocaleString()}</p>
            )}
          </details>
        </>
      )}
      <p className="monitor-note">
        Checks run only while this panel is open and the page is visible. This is a live diagnostic
        snapshot, not continuous uptime or traffic history. CPU, memory, billing and infrastructure
        logs are not collected here. If the account service itself is down, this panel cannot load.
      </p>
    </div>
  );
}
