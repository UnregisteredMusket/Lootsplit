import { useEffect, useMemo, useState } from "react";
import { accountRequest } from "@/lib/account/client";
import { downloadJson } from "@/lib/quire/table";
import { readArchiveResult } from "@/lib/quire/archive-reader";
import { filterAccountReports } from "@/lib/account/report-library";
import { SessionReportReader } from "@/components/session-report-reader";

type AccountReport = {
  id: string;
  code: string;
  campaign: string;
  name: string;
  at: number;
  snapshot: unknown;
  error?: string;
};

export function AccountSessionRecords() {
  const [reports, setReports] = useState<AccountReport[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState(""),
    [campaign, setCampaign] = useState("all");
  const [after, setAfter] = useState(""),
    [before, setBefore] = useState("");
  const [selected, setSelected] = useState<AccountReport | null>(null);
  const availability = useMemo(
    () =>
      new Map(
        reports.map((report) => {
          // Validate each received archive once, rather than reparsing it on every search keystroke.
          const result = readArchiveResult(report);
          return [report, result.available ? null : result.error] as const;
        }),
      ),
    [reports],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    accountRequest<{ reports: AccountReport[] }>("records", undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setReports(result.reports);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load archived reports.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  const visible = filterAccountReports(reports, { search, campaign, after, before });
  const campaigns = [...new Map(reports.map((report) => [report.code, report.campaign])).entries()];
  return (
    <section className="portal-card">
      <h2>Archived session reports</h2>
      <p>
        Reports remain available after leaving or dismissal. Campaign bans revoke report access.
      </p>
      <p>These are archived records, separate from current play and campaign restores.</p>
      <div className="account-report-filters">
        <label>
          Find a report
          <input
            aria-label="Find archived reports"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Campaign, session or room code"
          />
        </label>
        <label>
          Campaign
          <select
            aria-label="Archived report campaign"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          >
            <option value="all">All campaigns</option>
            {campaigns.map(([code, name]) => (
              <option key={code} value={code}>
                {name} · {code}
              </option>
            ))}
          </select>
        </label>
        <label>
          From date
          <input
            aria-label="Reports from date"
            type="date"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
          />
        </label>
        <label>
          Through date
          <input
            aria-label="Reports through date"
            type="date"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
          />
        </label>
        <button
          className="portal-button secondary"
          onClick={() => {
            setSearch("");
            setCampaign("all");
            setAfter("");
            setBefore("");
          }}
        >
          Clear report filters
        </button>
        <button
          className="portal-button secondary"
          disabled={loading}
          onClick={() => {
            setSelected(null);
            setRefresh((n) => n + 1);
          }}
        >
          Refresh archived reports
        </button>
      </div>
      {loading && <p role="status">Loading archived reports…</p>}
      {error && (
        <p role="alert">
          {error} {reports.length ? "The reports below are from the last successful load." : ""}
        </p>
      )}
      {!loading && !error && !reports.length && <p>No archived reports yet.</p>}
      {!loading && reports.length > 0 && (
        <p role="status">
          Showing {visible.length} of {reports.length} reports.
        </p>
      )}
      {!loading && reports.length > 0 && !visible.length && (
        <p>No reports match these filters. Clear filters to see your complete available history.</p>
      )}
      {visible.map((report) => {
        // The account endpoint has already applied the historical seat's privacy.
        // Never reproject it through an unrelated current campaign/seat.
        const unavailable = availability.get(report);
        return (
          <div key={report.code + ":" + report.id} className="journal-entry">
            <strong>
              {report.campaign} · {report.name}
            </strong>
            <p>
              {new Date(report.at).toLocaleString()} · {report.code}
            </p>
            {unavailable && <p role="alert">{unavailable}</p>}
            <div className="portal-actions">
              <button
                disabled={!!unavailable}
                className="portal-button"
                onClick={() => setSelected(report)}
              >
                Read report
              </button>
              <button
                disabled={!!unavailable}
                className="portal-button secondary"
                onClick={() =>
                  void downloadJson("lootsplit-session-" + report.id + ".json", report.snapshot)
                }
              >
                Download report
              </button>
            </div>
          </div>
        );
      })}
      {selected && (
        <SessionReportReader
          report={selected}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        />
      )}
    </section>
  );
}
