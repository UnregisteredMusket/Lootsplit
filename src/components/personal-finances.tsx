import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance } from "@/lib/quire/finance";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { FeatureLink } from "./feature-navigation";
import { Button } from "./ui";
export function PersonalFinances({ bank = false }: { bank?: boolean }) {
  const { journal, purses, ledger, command } = useEconomy(),
    seat = useSeat();
  const f = readFinance(journal.finance),
    mine = purses.filter((p) => seat.purseIds.includes(p.id));
  const [repay, setRepay] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useDraftGuard(Object.values(repay).some(Boolean), "repayment");
  return (
    <section>
      <p>Campaign day {f.day}. Scheduled amounts are not money already received or paid.</p>
      {error && <p role="alert">{error}</p>}
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
                  {l.periodDays} days · Scheduled payment {formatCopper(l.payment)}
                </p>
                {bank && l.principal + l.interest > 0 && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (busy) return;
                      setBusy(true);
                      setError("");
                      try {
                        await command({
                          kind: "bank-repay",
                          loanId: l.id,
                          copper: Number(repay[l.id]),
                        });
                        setRepay((r) => ({ ...r, [l.id]: "" }));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Repayment failed.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label>
                      Repayment in copper
                      <input
                        required
                        type="number"
                        min="1"
                        max={l.principal + l.interest}
                        value={repay[l.id] || ""}
                        onChange={(e) => setRepay({ ...repay, [l.id]: e.target.value })}
                      />
                    </label>
                    <Button type="submit" disabled={busy}>
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
                    {r.active ? "Active" : "Paused"}
                    {r.arrears ? ` · Owed ${formatCopper(r.arrears)}` : ""}
                  </p>
                ))}
              <h3>Recorded transactions</h3>
              {ledger
                .filter((l) => l.purseId === p.id)
                .slice()
                .sort((a, b) => b.at - a.at)
                .map((l) => (
                  <p key={l.id}>
                    {new Date(l.at).toLocaleString()} · {l.summary} · {formatCopper(l.copper)}
                  </p>
                ))}
            </>
          )}
        </section>
      ))}
      <FeatureLink feature={bank ? "finances" : "bank"} />
    </section>
  );
}
