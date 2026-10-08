import { AppLink } from "@/components/app-link";
import { useEconomy } from "@/lib/quire/economy-context";
import { formatCopper } from "@/lib/quire/money";
import { sessionSummary } from "@/lib/quire/journal";
import { useDesktop } from "@/lib/quire/use-desktop";
import { usePrefs } from "@/lib/quire/prefs";

export function DesktopDeskPanels() {
  const desktop = useDesktop();
  const { prefs } = usePrefs();
  const { ready, purses, ledger, journal, loans, shops, holdings } = useEconomy();
  if (!desktop || !ready) return null;
  const recent = [...ledger].sort((a, b) => b.at - a.at).slice(0, prefs.ledgerRows);
  const requests = [
    ...journal.requests
      .filter((r) => r.status === "pending")
      .map((r) => ({
        ...r,
        key: `payment-${r.id}`,
        kind: "Payment",
        name: purses.find((p) => p.id === r.purseId)?.name || "Unassigned",
      })),
    ...loans
      .filter((r) => r.status === "pending")
      .map((r) => ({ ...r, key: `loan-${r.id}`, kind: "Loan", name: r.purseName })),
  ].sort((a, b) => a.at - b.at);
  const session = journal.sessions.find((s) => !s.endedAt);
  const totals = session ? sessionSummary(ledger, session) : null;
  return (
    <div className="desktop-desk-panels">
      <section
        className="desktop-desk-card desktop-activity"
        aria-labelledby="desktop-activity-heading"
      >
        <div className="panel-heading">
          <h2 id="desktop-activity-heading">Recent activity</h2>
          <AppLink href="/features/reports">Full ledger →</AppLink>
        </div>
        <p className="desktop-panel-note">
          {recent.length
            ? `Latest ${recent.length} of ${ledger.length} transactions`
            : "Campaign transactions appear here as you play."}
        </p>
        {recent.length ? (
          <div className="desktop-table-scroll">
            <table className="desktop-ledger">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Account</th>
                  <th>When</th>
                  <th>Coin movement</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((line) => (
                  <tr key={line.id}>
                    <td>{line.summary}</td>
                    <td>{purses.find((p) => p.id === line.purseId)?.name || "Removed account"}</td>
                    <td>
                      <time dateTime={new Date(line.at).toISOString()}>
                        {new Date(line.at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </td>
                    <td className={line.copper < 0 ? "desktop-outgoing" : "desktop-incoming"}>
                      {line.copper < 0 ? "−" : line.copper > 0 ? "+" : ""}
                      {formatCopper(Math.abs(line.copper))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="desktop-panel-empty">
            No transactions recorded yet.{" "}
            <AppLink href="/party?section=funds&action=pay">Record a payment →</AppLink>
          </p>
        )}
      </section>
      <section className="desktop-desk-card" aria-labelledby="desktop-review-heading">
        <div className="panel-heading">
          <h2 id="desktop-review-heading">Financial requests</h2>
          <AppLink href="/features/bank">Open Bank →</AppLink>
        </div>
        <p className="desktop-panel-note">
          {requests.length} pending {requests.length === 1 ? "request" : "requests"}
        </p>
        {requests.length ? (
          <ul className="desktop-request-list">
            {requests.map((r) => (
              <li key={r.key}>
                <div>
                  <strong>{r.name}</strong>
                  <span>{formatCopper(r.copper)}</span>
                </div>
                <p>
                  {r.kind} · {r.note || "No note"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="desktop-panel-empty">
            All caught up. Payment and loan requests will appear here for review.
          </p>
        )}
      </section>
      <section className="desktop-desk-card" aria-labelledby="desktop-session-heading">
        <div className="panel-heading">
          <h2 id="desktop-session-heading">Session & economy</h2>
        </div>
        {session && totals ? (
          <>
            <p className="desktop-session-name">{session.name}</p>
            <dl className="desktop-metrics">
              <div>
                <dt>Received</dt>
                <dd>{formatCopper(totals.received)}</dd>
              </div>
              <div>
                <dt>Spent</dt>
                <dd>{formatCopper(totals.spent)}</dd>
              </div>
              <div>
                <dt>Net coin movement</dt>
                <dd>
                  {totals.net < 0 ? "−" : ""}
                  {formatCopper(Math.abs(totals.net))}
                </dd>
              </div>
            </dl>
            <p className="desktop-panel-note">
              Transfers between accounts are excluded from received and spent.
            </p>
          </>
        ) : (
          <p className="desktop-panel-empty">
            No active session. Start one to track this session’s received and spent coins.
          </p>
        )}
        <dl className="desktop-metrics desktop-economy-counts">
          <div>
            <dt>Open shops</dt>
            <dd>
              {shops.filter((s) => !s.closed).length} / {shops.length}
            </dd>
          </div>
          <div>
            <dt>Inventory entries</dt>
            <dd>{holdings.length}</dd>
          </div>
        </dl>
        <AppLink href="/features/journal" className="desktop-panel-link">
          Session journal →
        </AppLink>
      </section>
    </div>
  );
}
