import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance } from "@/lib/quire/finance";
import { readSessionSummary } from "@/lib/quire/archive-reader";
import { useArchiveReaderSeat } from "@/lib/quire/use-archive-reader-seat";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { useState, useMemo } from "react";
export function CampaignReports() {
  const { purses, holdings, journal, ledger, loans } = useEconomy(),
    seat = useSeat();
  const archiveSeat = useArchiveReaderSeat(seat);
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState("all");
  const [bankSearch, setBankSearch] = useState("");
  const summaries = useMemo(
    () =>
      journal.sessions.map((session) => ({
        session,
        result: readSessionSummary(
          session,
          ledger,
          journal.reports?.find((r) => r.id === session.id),
          archiveSeat,
        ),
      })),
    [journal.sessions, journal.reports, ledger, archiveSeat],
  );
  const shownSessions = summaries.filter(
    ({ session }) =>
      !search.trim() ||
      `${session.name} ${new Date(session.startedAt).toLocaleString()}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const decisions = loans.filter((loan) => loan.status !== "pending");
  const shownDecisions = decisions.filter(
    (loan) =>
      (decision === "all" || loan.status === decision) &&
      (!bankSearch.trim() ||
        `${loan.purseName} ${loan.note} ${loan.status}`
          .toLowerCase()
          .includes(bankSearch.trim().toLowerCase())),
  );
  if (seat.role !== "dm") return null;
  const f = readFinance(journal.finance);
  return (
    <section>
      <h2>Campaign financial overview</h2>
      <p>
        Coins {formatCopper(purses.reduce((s, p) => s + toCopper(p.coins), 0))} · Inventory/property
        value {formatCopper(holdings.reduce((s, h) => s + h.quantity * h.unitCopper, 0))} ·
        Outstanding debt {formatCopper(f.loans.reduce((s, l) => s + l.principal + l.interest, 0))}
      </p>
      <p>
        {loans.filter((l) => l.status === "pending").length} pending loan applications ·{" "}
        {journal.requests.filter((r) => r.status === "pending").length} pending payment requests
      </p>
      <h2>Session financial summaries</h2>
      <input
        className="ledger-search"
        aria-label="Search campaign report sessions"
        placeholder="Search session names or dates"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="text-sm text-muted">
        {shownSessions.length} of {summaries.length} session summaries
      </p>
      {shownSessions.map(({ session, result }) => {
        return (
          <div className="journal-entry" key={session.id}>
            <h3>{session.name}</h3>
            {result.available ? (
              <p>
                Received {formatCopper(result.summary.received)} · Spent{" "}
                {formatCopper(result.summary.spent)} · Net {formatCopper(result.summary.net)}
              </p>
            ) : (
              <p role="alert">{result.error}</p>
            )}
          </div>
        );
      })}
      {!shownSessions.length && (
        <p>
          {summaries.length
            ? "No session summaries match. Clear the search to see every record."
            : "No named sessions recorded yet."}
        </p>
      )}
      <p>
        Internal transfers are excluded from received/spent totals. Archived reports retain their
        original records; active activity is not an all-time site statistic.
      </p>
      <h2>Bank decision history</h2>
      <input
        className="ledger-search"
        aria-label="Search Bank decisions"
        placeholder="Find an account, request or decision"
        value={bankSearch}
        onChange={(event) => setBankSearch(event.target.value)}
      />
      <select
        className="ledger-search"
        aria-label="Bank decision status"
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
      >
        <option value="all">All decisions</option>
        <option value="approved">Approved</option>
        <option value="denied">Denied</option>
      </select>
      <p className="text-sm text-muted">
        {shownDecisions.length} of {decisions.length} decisions. Pending loan applications remain in
        Bank.
      </p>
      {shownDecisions.map((l) => (
        <p key={l.id}>
          {l.purseName} · {l.note} · {formatCopper(l.copper)} · {l.status}
        </p>
      ))}
      {!shownDecisions.length && (
        <p>
          {decisions.length
            ? "No decisions match. Clear the search or choose All decisions."
            : "No loan decisions recorded yet."}
        </p>
      )}
    </section>
  );
}
