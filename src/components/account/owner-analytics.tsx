import { useEffect, useState } from "react";
import { accountRequest } from "@/lib/account/client";
import {
  ownerAnalyticsGroups,
  type OwnerAnalyticsSnapshot,
} from "@/lib/quire/owner-analytics-view";
import "./account-admin.css";

/** Mounted only inside the existing role-gated owner workspace. */
export function OwnerAnalytics() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<OwnerAnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSnapshot(null);
    accountRequest<OwnerAnalyticsSnapshot>("owner/analytics", undefined, controller.signal)
      .then((next) => {
        // A malformed response must not render partial totals or a fabricated zero.
        ownerAnalyticsGroups(next);
        if (!controller.signal.aborted) setSnapshot(next);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Game analytics is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, refresh]);
  const groups = snapshot ? ownerAnalyticsGroups(snapshot) : [];
  return (
    <section className="owner-analytics" aria-labelledby="owner-analytics-title">
      <h3 id="owner-analytics-title">Private game analytics</h3>
      <p>
        Read-only totals across currently stored shared campaigns. These are fantasy game records,
        not real money, unique people, attendance, or play time.
      </p>
      <button
        type="button"
        className="portal-button secondary"
        aria-expanded={open}
        aria-controls="owner-analytics-panel"
        onClick={() => {
          if (open) {
            setSnapshot(null);
            setError("");
          }
          setOpen((value) => !value);
        }}
      >
        {open ? "Close game analytics" : "Open game analytics"}
      </button>
      {open && (
        <div id="owner-analytics-panel">
          <button
            type="button"
            className="portal-button secondary"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Refresh game analytics
          </button>
          {loading && <p role="status">Loading game analytics…</p>}
          {error && (
            <p role="alert" className="portal-message error">
              Game analytics is unavailable. {error}
            </p>
          )}
          {snapshot && (
            <>
              <p className="portal-subtle">
                {snapshot.sharedCampaigns.toLocaleString()} stored shared campaigns · Snapshot{" "}
                <time dateTime={new Date(snapshot.asOf).toISOString()}>
                  {new Date(snapshot.asOf).toLocaleString()}
                </time>
                . Cached snapshots can be up to one minute old when fetched. This panel does not
                refresh automatically.
              </p>
              {groups.map((group) => (
                <section key={group.title} className="owner-analytics-group">
                  <h4>{group.title}</h4>
                  <dl>
                    {group.metrics.map((metric) => (
                      <div key={metric.key}>
                        <dt>{metric.label}</dt>
                        <dd>{metric.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </>
          )}
          <details className="owner-analytics-explanation">
            <summary>What these totals include</summary>
            <p>
              Only accepted shared-campaign records are counted. Local-only saves, private account
              backups, reusable character profiles, pending actions, and test rooms are excluded. A
              campaign hosted in two separate rooms counts as two games.
            </p>
            <p>
              Spending includes purchase debits and outgoing payment debits, including approved
              external loan repayments and downtime expenses. Internal transfers and loans, loan
              proceeds, balance adjustments, and revenue are excluded from spending. Sales are shown
              separately. Unknown ledger entries remain unclassified.
            </p>
            <p>
              Valid reversals, imports, restores, and room deletion can lower totals. Money is kept
              in exact copper, with 100 cp = 1 gp. Inventory includes properties; character counts
              do not identify individual people. The rollup reads rooms in sequence and is not an
              atomic snapshot across every room.
            </p>
            <p>
              This panel is private to the site owner. It adds no collection or public metrics and
              exposes no campaign names, room codes, chats, or individual ledgers.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
