import { useEffect, useState } from "react";
import { accountRequest } from "@/lib/account/client";
import { downloadJson } from "@/lib/quire/table";
export function AccountSessionRecords() {
  const [reports, setReports] = useState<
    Array<{
      id: string;
      code: string;
      campaign: string;
      name: string;
      at: number;
      snapshot: unknown;
    }>
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    accountRequest<{ reports: typeof reports }>("records", undefined, c.signal)
      .then((r) => setReports(r.reports))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  return (
    <section className="portal-card">
      <h2>Archived session reports</h2>
      <p>
        Reports remain available after leaving or dismissal. Campaign bans revoke report access.
      </p>
      {error && <p role="alert">{error}</p>}
      {!reports.length && !error && <p>No archived reports yet.</p>}
      {reports.map((r) => (
        <div key={r.code + ":" + r.id} className="journal-entry">
          <strong>
            {r.campaign} · {r.name}
          </strong>
          <p>{new Date(r.at).toLocaleString()}</p>
          <button
            className="portal-button secondary"
            onClick={() => void downloadJson("lootsplit-session-" + r.id + ".json", r.snapshot)}
          >
            Download report
          </button>
        </div>
      ))}
    </section>
  );
}
