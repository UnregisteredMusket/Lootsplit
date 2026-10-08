import { useArchiveReaderSeat } from "@/lib/quire/use-archive-reader-seat";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance } from "@/lib/quire/finance";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { FeatureLink } from "./feature-navigation";
import { Button } from "./ui";
import { selectSessionLedgerRows } from "@/lib/quire/journal";
import { readArchiveResult } from "@/lib/quire/archive-reader";
import {
  financialRows,
  financialTotals,
  nextFinancePeriod,
  repaymentPreview,
} from "@/lib/quire/finance-presentation";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { CoinAmountInput, FinanceReadiness } from "./finance-input";
import { AppLink } from "./app-link";
export function PersonalFinances({ bank = false }: { bank?: boolean }) {
  const { journal, purses, ledger, commandOutcome } = useEconomy(),
    seat = useSeat();
  const archiveSeat = useArchiveReaderSeat(seat);
  const f = readFinance(journal.finance),
    mine = purses.filter((p) => seat.purseIds.includes(p.id));
  const [repay, setRepay] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState(""),
    [session, setSession] = useState(""),
    [type, setType] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const { locked } = useFinanceReadiness(f.downtime.some((d) => d.status === "pending"));
  const selectedSession = journal.sessions.find((s) => s.id === session),
    archive = journal.reports?.find((r) => r.id === session);
  let source = ledger,
    archiveError = "";
  if (archive) {
    const result = readArchiveResult(archive, archiveSeat);
    if (result.available) source = result.snapshot.ledger;
    else {
      source = [];
      archiveError = result.error;
    }
  }
  const rows = financialRows(
      selectedSession
        ? selectSessionLedgerRows(source, selectedSession, seat.purseIds)
        : source.filter((r) => seat.purseIds.includes(r.purseId)),
      { account, type, query },
    ),
    totals = financialTotals(rows);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  useDraftGuard(Object.values(repay).some(Boolean), "repayment");
  return (
    <section>
      <p>Campaign day {f.day}. Scheduled amounts are not money already received or paid.</p>
      <FinanceReadiness pendingDowntime={f.downtime.some((d) => d.status === "pending")} />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {mine.map((p) => (
        <section className="journal-entry" key={p.id}>
          <h2>{p.name}</h2>
          <p>Available coins: {formatCopper(toCopper(p.coins))}</p>
          <h3>Loans & repayments</h3>
          {f.loans
            .filter((l) => l.purseId === p.id)
            .map((l) => (
              <article className="journal-entry" key={l.id}>
                <strong>{l.name}</strong>
                <p>
                  Principal {formatCopper(l.principal)} · Interest {formatCopper(l.interest)} ·
                  Overdue {formatCopper(l.due)} · Repaid {formatCopper(l.paid)}
                </p>
                <p>
                  {l.rateBps / 100}% {l.compound ? "compound" : "simple"} interest per{" "}
                  {l.periodDays} days · Scheduled payment {formatCopper(l.payment)} · {l.carryDays}{" "}
                  days carried
                  {l.principal + l.interest > 0
                    ? ` · Next full period at campaign day ${nextFinancePeriod(f.day, l.periodDays, l.carryDays, true)}, if those in-game days are approved`
                    : ""}
                </p>
                {bank && l.principal + l.interest > 0 && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (busy || locked) return;
                      setBusy(true);
                      setError("");
                      try {
                        const result = await commandOutcome({
                          kind: "bank-repay",
                          loanId: l.id,
                          copper: Number(repay[l.id]),
                        });
                        setRepay((r) => ({ ...r, [l.id]: "" }));
                        setNotice(mutationNotice(result, "Repayment recorded."));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Repayment failed.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <CoinAmountInput
                      label="Repayment in copper"
                      min={1}
                      max={l.principal + l.interest}
                      value={repay[l.id] || ""}
                      disabled={busy || locked}
                      onChange={(raw) => setRepay({ ...repay, [l.id]: raw })}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || locked || !toCopper(p.coins) || !l.due}
                        onClick={() =>
                          setRepay({ ...repay, [l.id]: String(Math.min(l.due, toCopper(p.coins))) })
                        }
                      >
                        Pay overdue amount
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || locked || !toCopper(p.coins)}
                        onClick={() =>
                          setRepay({
                            ...repay,
                            [l.id]: String(Math.min(l.principal + l.interest, toCopper(p.coins))),
                          })
                        }
                      >
                        Pay remaining debt
                      </Button>
                    </div>
                    {repaymentPreview(
                      Number(repay[l.id]),
                      l.principal,
                      l.interest,
                      toCopper(p.coins),
                    ) && (
                      <p role="status">
                        Preview: {formatCopper(Math.min(l.interest, Number(repay[l.id])))} interest
                        +{" "}
                        {formatCopper(
                          Number(repay[l.id]) - Math.min(l.interest, Number(repay[l.id])),
                        )}{" "}
                        principal. Remaining debt{" "}
                        {formatCopper(l.principal + l.interest - Number(repay[l.id]))}; available
                        coins afterward {formatCopper(toCopper(p.coins) - Number(repay[l.id]))}.
                      </p>
                    )}
                    {repay[l.id] &&
                      !repaymentPreview(
                        Number(repay[l.id]),
                        l.principal,
                        l.interest,
                        toCopper(p.coins),
                      ) && (
                        <p>
                          Choose a whole-copper amount within available coins and outstanding debt.
                          No money has moved.
                        </p>
                      )}
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        locked ||
                        !repaymentPreview(
                          Number(repay[l.id]),
                          l.principal,
                          l.interest,
                          toCopper(p.coins),
                        )
                      }
                    >
                      Make repayment
                    </Button>
                  </form>
                )}
              </article>
            ))}
          {!bank && (
            <>
              <h3>Recurring income & expenses</h3>
              {f.rules
                .filter((r) => r.purseId === p.id)
                .map((r) => (
                  <p key={r.id}>
                    {r.name} · {r.kind} · {formatCopper(r.copper)} every {r.periodDays} days ·{" "}
                    {r.active ? "Active" : "Paused"} · {r.carryDays} days carried
                    {r.active
                      ? ` · Next full period at campaign day ${nextFinancePeriod(f.day, r.periodDays, r.carryDays, true)}, conditional on approved in-game days`
                      : " · Pausing keeps carried days and unpaid amounts"}
                    {r.arrears ? ` · Owed ${formatCopper(r.arrears)}` : ""}
                  </p>
                ))}
            </>
          )}
        </section>
      ))}
      {!bank && (
        <section>
          <h3>Recorded transactions</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label>
              Financial account
              <select
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All assigned accounts</option>
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Financial session
              <select
                value={session}
                onChange={(e) => {
                  setSession(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Active records</option>
                {journal.sessions.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transaction type
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All types</option>
                {["purchase", "sale", "transfer", "loan", "payment", "adjustment", "void"].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Search transactions
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setAccount("");
              setSession("");
              setType("");
              setQuery("");
              setPage(0);
            }}
          >
            Clear financial filters
          </Button>
          {archiveError && <p role="alert">{archiveError}</p>}
          <p>
            {rows.length} original records · Received {formatCopper(totals.received)} · Spent{" "}
            {formatCopper(totals.spent)} · Net {formatCopper(totals.net)}. Internal transfers are
            excluded from received/spent.
          </p>
          {rows.slice(currentPage * 25, (currentPage + 1) * 25).map((r) => (
            <article
              className="journal-entry"
              key={r.id}
              id={`transaction-${encodeURIComponent(r.id)}`}
            >
              <p>
                {new Date(r.at).toLocaleString()} · {r.summary} · {formatCopper(r.copper)}
              </p>
              <small>Original record · {r.transactionType || "Legacy type not recorded"}</small>
              {r.purchase?.holding && (
                <AppLink href="/party?section=funds">Open purchased inventory</AppLink>
              )}
            </article>
          ))}
          {!rows.length && (
            <p>No transactions match. Clear filters to see every available record.</p>
          )}
          {rows.length > 25 && (
            <nav aria-label="Financial history pages">
              <Button
                variant="secondary"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous transactions
              </Button>
              <span>
                Page {currentPage + 1} of {Math.ceil(rows.length / 25)} · all records retained
              </span>
              <Button
                variant="secondary"
                disabled={(currentPage + 1) * 25 >= rows.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Next transactions
              </Button>
            </nav>
          )}
        </section>
      )}
      <FeatureLink feature={bank ? "finances" : "bank"} />
    </section>
  );
}
