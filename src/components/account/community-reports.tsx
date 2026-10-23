import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { accountRequest } from "@/lib/account/client";

type Report = {
  id: string;
  reason: string;
  created_at: number;
  handle: string;
  name: string;
  community_hidden: number;
  reporter: string;
};

/** Staff: open reports about community profiles, with hide, show and dismiss. */
export function CommunityReports() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      setReports((await accountRequest<{ reports: Report[] }>("staff/community-reports")).reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load community reports.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(handle: string, action: "hide" | "show" | "dismiss") {
    setBusy(handle);
    setError("");
    try {
      await accountRequest("staff/community-action", { handle, action, reason: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update that profile.");
    } finally {
      setBusy("");
    }
  }
  const byHandle = new Map<string, Report[]>();
  for (const r of reports ?? []) byHandle.set(r.handle, [...(byHandle.get(r.handle) ?? []), r]);
  return (
    <section className="portal-card" aria-labelledby="community-reports-title">
      <p className="portal-eyebrow">STAFF</p>
      <h2 id="community-reports-title">Community profile reports</h2>
      {error && (
        <p role="alert" className="portal-message error">
          {error}
        </p>
      )}
      {reports === null ? (
        <p role="status">Loading…</p>
      ) : byHandle.size === 0 ? (
        <p>No open reports.</p>
      ) : (
        <ul className="community-report-list">
          {[...byHandle].map(([handle, list]) => (
            <li key={handle}>
              <p>
                <Link to="/community/$handle" params={{ handle }}>
                  {list[0]!.name} (@{handle})
                </Link>{" "}
                · {list.length} report{list.length === 1 ? "" : "s"}
                {list[0]!.community_hidden ? " · hidden" : ""}
              </p>
              <ul>
                {list.map((r) => (
                  <li key={r.id}>
                    “{r.reason}” — {r.reporter}, {new Date(r.created_at).toLocaleString()}
                  </li>
                ))}
              </ul>
              <div className="portal-actions">
                {list[0]!.community_hidden ? (
                  <button className="portal-button secondary" disabled={!!busy} onClick={() => act(handle, "show")}>
                    Show profile again
                  </button>
                ) : (
                  <button className="portal-button" disabled={!!busy} onClick={() => act(handle, "hide")}>
                    Hide profile
                  </button>
                )}
                <button className="portal-button secondary" disabled={!!busy} onClick={() => act(handle, "dismiss")}>
                  Dismiss reports
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
