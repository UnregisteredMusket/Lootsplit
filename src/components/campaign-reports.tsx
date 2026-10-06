import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance } from "@/lib/quire/finance";
import { sessionSummary } from "@/lib/quire/journal";
import { formatCopper, toCopper } from "@/lib/quire/money";
export function CampaignReports() {
  const { purses, holdings, journal, ledger, loans } = useEconomy(),
    seat = useSeat();
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
      {journal.sessions.map((session) => {
        const archived = journal.reports?.find((r) => r.id === session.id);
        let rows = ledger;
        if (archived) {
          try {
            const saved = JSON.parse(archived.snapshot).ledger;
            if (Array.isArray(saved)) rows = saved;
          } catch {
            /* Existing legacy records may omit snapshots. */
          }
        }
        const sum = sessionSummary(rows, session);
        return (
          <div className="journal-entry" key={session.id}>
            <h3>{session.name}</h3>
            <p>
              Received {formatCopper(sum.received)} · Spent {formatCopper(sum.spent)} · Net{" "}
              {formatCopper(sum.net)}
            </p>
          </div>
        );
      })}
      <p>
        Internal transfers are excluded from received/spent totals. Archived reports retain their
        original records; active activity is not an all-time site statistic.
      </p>
      <h2>Bank decision history</h2>
      {loans
        .filter((l) => l.status !== "pending")
        .map((l) => (
          <p key={l.id}>
            {l.purseName} · {l.note} · {formatCopper(l.copper)} · {l.status}
          </p>
        ))}
    </section>
  );
}
