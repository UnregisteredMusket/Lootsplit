import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { CoinAmountInput, FinanceReadiness } from "./finance-input";
import { AppLink } from "./app-link";
import { useDisclosureAnchor } from "@/lib/help/use-disclosure-anchor";
import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { readFinance, type Terms, type Debt } from "@/lib/quire/finance";
import { formatCopper, toCopper } from "@/lib/quire/money";
import type { CommandInput } from "@/lib/quire/commands";
import { Button } from "./ui";
const defaults: Terms = {
  name: "",
  purseId: "",
  lenderId: "",
  rateBps: 0,
  periodDays: 30,
  compound: false,
  payment: 0,
};
export function CampaignFinance({
  section = "all",
}: {
  section?: "all" | "bank" | "downtime" | "settings";
}) {
  const anchorRef = useDisclosureAnchor("campaign-finance");
  const { journal, purses, holdings, shops, stock, loans: requests, commandOutcome } = useEconomy();
  const seat = useSeat();
  const f = readFinance(journal.finance),
    pending = f.downtime.find((d) => d.status === "pending");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [terms, setTerms] = useState<Terms>(defaults),
    [editing, setEditing] = useState(""),
    [source, setSource] = useState("");
  const [principal, setPrincipal] = useState(1000),
    [days, setDays] = useState(pending?.days ?? 7),
    [name, setName] = useState(pending?.name ?? "Between sessions");
  const [loanEntryRevision, setLoanEntryRevision] = useState(0),
    [ruleEntryRevision, setRuleEntryRevision] = useState(0);
  const [repay, setRepay] = useState<Record<string, string>>({});
  const [rule, setRule] = useState({
    id: "",
    name: "",
    purseId: "",
    kind: "income" as "income" | "expense",
    copper: 100,
    periodDays: 1,
    holdingId: "",
    active: true,
  });
  const [downtimeBefore, setDowntimeBefore] = useState({
    name: pending?.name ?? "Between sessions",
    days: pending?.days ?? 7,
  });
  const [termsBefore, setTermsBefore] = useState<Terms>(defaults),
    [principalBefore, setPrincipalBefore] = useState(1000),
    [ruleBefore, setRuleBefore] = useState(rule),
    [notice, setNotice] = useState("");
  const termsDirty =
    JSON.stringify(terms) !== JSON.stringify(termsBefore) || principal !== principalBefore;
  const ruleDirty = JSON.stringify(rule) !== JSON.stringify(ruleBefore);
  useDraftGuard(
    termsDirty ||
      ruleDirty ||
      Object.values(repay).some(Boolean) ||
      name !== downtimeBefore.name ||
      days !== downtimeBefore.days,
    "campaign finance",
  );
  if (seat.role !== "dm") return null;
  const run = async (input: CommandInput, done?: () => void) => {
    setBusy(true);
    setError("");
    try {
      const result = await commandOutcome(input);
      done?.();
      const message = mutationNotice(result, "Campaign finances saved.");
      setNotice(message);
      toast.success(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save finances.");
    } finally {
      setBusy(false);
    }
  };
  const owner = terms.purseId || purses[0]?.id || "",
    ruleOwner = rule.purseId || purses[0]?.id || "";
  const accountName = (id: string) => purses.find((p) => p.id === id)?.name || "Missing account";
  const debt = f.loans.reduce((n, l) => n + l.principal + l.interest, 0);
  const cash = purses.reduce((n, p) => n + toCopper(p.coins), 0);
  const inventory = holdings.reduce((n, h) => n + h.quantity * h.unitCopper, 0);
  const edit = (l: Debt) => {
    if (termsDirty && !window.confirm("Discard unsaved loan terms and edit another loan?")) return;
    setLoanEntryRevision((v) => v + 1);
    setTerms(l);
    setTermsBefore(l);
    setPrincipalBefore(l.principal);
    setEditing(l.id);
    setSource("");
    setPrincipal(l.principal);
  };
  return (
    <details
      open={section !== "all" ? true : undefined}
      ref={anchorRef}
      className="review-inbox"
      id="campaign-finance"
    >
      <summary>
        {section === "bank"
          ? "Loans & repayments"
          : section === "settings"
            ? "Recurring financial agreements"
            : "Campaign finances & downtime"}
        {pending ? " · Awaiting DM approval" : ""}
      </summary>
      <p className="text-sm text-muted">
        Campaign records only. Uses the existing party/character purses and inventory, independently
        of account character profiles.
      </p>
      <p className="text-sm">
        Coins {formatCopper(cash)} · Inventory value {formatCopper(inventory)} · Outstanding loans{" "}
        {formatCopper(debt)} · In-game day {f.day}
      </p>
      <FinanceReadiness pendingDowntime={!!pending} />
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="character-error">
          {error}
        </p>
      )}
      {(section === "all" || section === "downtime") && (
        <>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={journal.downtimePrompt?.enabled !== false}
              disabled={busy}
              onChange={(e) =>
                void run({
                  kind: "downtime-preference",
                  days: e.target.checked ? Math.max(1, days) : 0,
                })
              }
            />
            Remind me to set downtime before sessions
          </label>
          <details open={pending ? true : undefined}>
            <summary>Set downtime & review calculations</summary>
            <form
              className="mt-4 grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run({ kind: "downtime-plan", name, days }, () =>
                  setDowntimeBefore({ name, days }),
                );
              }}
            >
              <label>
                Downtime description
                <input
                  className="ledger-search w-full"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                In-game days
                <input
                  className="ledger-search w-full"
                  type="number"
                  min={1}
                  max={3650}
                  required
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </label>
              <Button disabled={busy} type="submit">
                {pending ? "Recalculate downtime" : "Preview downtime"}
              </Button>
            </form>
            <p className="text-sm text-muted">
              Only complete periods accrue; unused days carry forward. Income settles first, loan
              installments next in creation order, then expenses. Payments never overdraw a purse.
              Interest is charged per completed period before its installment; repayments pay
              interest first. Fractional copper interest carries forward. Nothing moves until you
              approve when starting the next session.
            </p>
            {pending && (
              <div className="journal-entry">
                <strong>
                  {pending.name} · {pending.days} days · Day {pending.fromDay} →{" "}
                  {pending.fromDay + pending.days}
                </strong>
                <p role="status">
                  Preview only: {pending.days} in-game days · Revenue{" "}
                  {formatCopper(
                    pending.quote.lines
                      .filter((l) => l.kind === "income")
                      .reduce((n, l) => n + l.paid, 0),
                  )}{" "}
                  · Loan installments paid{" "}
                  {formatCopper(
                    pending.quote.lines
                      .filter((l) => l.kind === "loan")
                      .reduce((n, l) => n + l.paid, 0),
                  )}{" "}
                  · Interest added{" "}
                  {formatCopper(pending.quote.lines.reduce((n, l) => n + l.interest, 0))} · Expenses
                  paid{" "}
                  {formatCopper(
                    pending.quote.lines
                      .filter((l) => l.kind === "expense")
                      .reduce((n, l) => n + l.paid, 0),
                  )}{" "}
                  · Unpaid obligations{" "}
                  {formatCopper(pending.quote.lines.reduce((n, l) => n + l.unpaid, 0))}. Settlement
                  order remains income, loans in creation order, then expenses.
                </p>
                {pending.quote.lines.map((l) => (
                  <div className="journal-entry" key={l.id}>
                    <strong>
                      {l.name} · {accountName(l.purseId)}
                    </strong>
                    <p className="text-sm">
                      {l.periods} periods · {l.kind === "income" ? "Revenue" : "Payment"}{" "}
                      {formatCopper(l.paid)}
                      {l.kind === "loan"
                        ? ` · Interest added ${formatCopper(l.interest)} · Remaining debt ${formatCopper(l.balance)}`
                        : ""}
                      {l.unpaid ? ` · Unpaid ${formatCopper(l.unpaid)}` : ""}
                    </p>
                  </div>
                ))}
                {pending.quote.market?.map((m) => (
                  <details key={m.shopId}>
                    <summary>
                      {shops.find((s) => s.id === m.shopId)?.name || "Shop"}:{" "}
                      {m.closed ? "closed" : "open"} after downtime ·{" "}
                      {m.stock.filter((s) => s.after > s.before).length} stock lines topped up.
                    </summary>
                    {m.stock.map((line) => (
                      <p key={line.id}>
                        {stock.find((s) => s.id === line.id)?.name || "Stock record"}: {line.before}{" "}
                        → {line.after}
                        {line.before === line.after ? " · surplus retained" : ""}
                      </p>
                    ))}
                    {stock
                      .filter((s) => s.shopId === m.shopId && s.quantity === null)
                      .map((line) => (
                        <p key={line.id}>{line.name}: unlimited, unchanged.</p>
                      ))}
                  </details>
                ))}
                {!pending.quote.lines.length && !pending.quote.market?.length && (
                  <p>No active financial agreements; approval advances only in-game time.</p>
                )}
                {pending.quote.balances
                  .filter((b) => b.before !== b.after)
                  .map((b) => (
                    <p className="text-sm" key={b.purseId}>
                      {accountName(b.purseId)}: {formatCopper(b.before)} → {formatCopper(b.after)}
                    </p>
                  ))}
                <p className="text-sm">
                  Review these amounts, then use{" "}
                  <AppLink href="#sessions">
                    Approve downtime & start session in Play sessions
                  </AppLink>
                  . Changed funds, agreements or stock require a fresh preview; your description and
                  days remain available for recalculation.
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run({ kind: "downtime-cancel", downtimeId: pending.id })}
                >
                  Cancel downtime
                </Button>
              </div>
            )}
          </details>
        </>
      )}
      {(section === "all" || section === "bank") && (
        <details open={section === "bank" ? true : undefined}>
          <summary>
            Loans & repayments · {f.loans.filter((l) => l.principal + l.interest > 0).length}{" "}
            outstanding
          </summary>
          {f.loans.map((l) => (
            <div className="journal-entry" key={l.id}>
              <strong>
                {l.name} · {accountName(l.purseId)}
              </strong>
              <p className="text-sm">
                Principal {formatCopper(l.principal)} · Interest {formatCopper(l.interest)} · Repaid{" "}
                {formatCopper(l.paid)} · Overdue {formatCopper(l.due)}
              </p>
              <p className="text-sm text-muted">
                {l.rateBps / 100}% {l.compound ? "compound" : "simple"} every {l.periodDays} days ·
                Installment {formatCopper(l.payment)} · {l.carryDays} days carried · Lender:{" "}
                {l.lenderId ? accountName(l.lenderId) : "External / NPC lender"}
              </p>
              {l.principal + l.interest > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !!pending} variant="secondary" onClick={() => edit(l)}>
                    Edit terms
                  </Button>
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(
                        { kind: "finance-repay", loanId: l.id, copper: Number(repay[l.id]) },
                        () => setRepay((v) => ({ ...v, [l.id]: "" })),
                      );
                    }}
                  >
                    <CoinAmountInput
                      label={`Repayment in copper for ${l.name}`}
                      min={1}
                      max={l.principal + l.interest}
                      value={repay[l.id] || ""}
                      onChange={(raw) => setRepay((v) => ({ ...v, [l.id]: raw }))}
                    />
                    {Number.isSafeInteger(Number(repay[l.id])) && Number(repay[l.id]) > 0 && (
                      <p>
                        Interest first {formatCopper(Math.min(l.interest, Number(repay[l.id])))} ·
                        Principal {formatCopper(Math.max(0, Number(repay[l.id]) - l.interest))} ·
                        Remaining debt{" "}
                        {formatCopper(l.principal + l.interest - Number(repay[l.id]))}. The final
                        operation checks available funds.
                      </p>
                    )}
                    <Button disabled={busy || !!pending} type="submit">
                      Record repayment
                    </Button>
                  </form>
                </div>
              ) : (
                <small>Paid in full</small>
              )}
            </div>
          ))}
          {requests
            .filter((r) => r.status === "approved" && !f.loans.some((l) => l.sourceLoanId === r.id))
            .map((r) => (
              <div key={r.id} className="journal-entry">
                <p>
                  Earlier approved loan: {r.note} · {formatCopper(r.copper)}
                </p>
                <Button
                  disabled={busy || !!pending}
                  variant="secondary"
                  onClick={() => {
                    if (
                      termsDirty &&
                      !window.confirm("Discard unsaved loan terms and record this existing debt?")
                    )
                      return;
                    const next = { ...defaults, name: r.note.slice(0, 100), purseId: r.purseId };
                    setLoanEntryRevision((v) => v + 1);
                    setTerms(next);
                    setTermsBefore(next);
                    setPrincipalBefore(r.copper);
                    setPrincipal(r.copper);
                    setSource(r.id);
                    setEditing("");
                  }}
                >
                  Track existing debt (no new coins)
                </Button>
              </div>
            ))}
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const t = { ...terms, purseId: owner };
              void run(
                editing
                  ? { kind: "finance-terms", loanId: editing, terms: t }
                  : {
                      kind: "finance-loan",
                      terms: t,
                      principal,
                      ...(source ? { sourceLoanId: source } : {}),
                    },
                () => {
                  setLoanEntryRevision((v) => v + 1);
                  setEditing("");
                  setSource("");
                  setTerms(defaults);
                  setTermsBefore(defaults);
                  setPrincipal(1000);
                  setPrincipalBefore(1000);
                },
              );
            }}
          >
            <h3>
              {editing
                ? "Edit loan terms"
                : source
                  ? "Record existing debt"
                  : "Create a campaign loan"}
            </h3>
            <fieldset disabled={busy || !!pending} className="grid gap-3">
              <label>
                Loan name
                <input
                  className="ledger-search w-full"
                  required
                  maxLength={100}
                  value={terms.name}
                  onChange={(e) => setTerms({ ...terms, name: e.target.value })}
                />
              </label>
              <label>
                Borrower
                <select
                  className="ledger-search w-full"
                  disabled={!!editing || !!source}
                  aria-label="Borrower"
                  value={owner}
                  onChange={(e) => setTerms({ ...terms, purseId: e.target.value })}
                >
                  {purses.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lender
                <select
                  className="ledger-search w-full"
                  disabled={!!editing || !!source}
                  aria-label="Lender"
                  value={terms.lenderId}
                  onChange={(e) => setTerms({ ...terms, lenderId: e.target.value })}
                >
                  <option value="">External / NPC lender</option>
                  {purses
                    .filter((p) => p.id !== owner)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              {!editing && (
                <CoinAmountInput
                  label="Principal (cp)"
                  resetKey={loanEntryRevision}
                  value={principal}
                  min={1}
                  max={1e12}
                  disabled={!!source}
                  onChange={(raw) => setPrincipal(raw === "" ? NaN : Number(raw))}
                />
              )}
              <label>
                Interest per period (%)
                <input
                  className="ledger-search w-full"
                  type="number"
                  min={0}
                  max={1000}
                  step="0.01"
                  required
                  value={terms.rateBps / 100}
                  onChange={(e) =>
                    setTerms({ ...terms, rateBps: Math.round(Number(e.target.value) * 100) })
                  }
                />
              </label>
              <label>
                Period (in-game days)
                <input
                  className="ledger-search w-full"
                  type="number"
                  min={1}
                  max={3650}
                  required
                  value={terms.periodDays}
                  onChange={(e) => setTerms({ ...terms, periodDays: Number(e.target.value) })}
                />
              </label>
              <CoinAmountInput
                label="Scheduled repayment per period (cp)"
                resetKey={loanEntryRevision}
                value={terms.payment}
                min={0}
                max={1e12}
                onChange={(raw) => setTerms({ ...terms, payment: raw === "" ? NaN : Number(raw) })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={terms.compound}
                  onChange={(e) => setTerms({ ...terms, compound: e.target.checked })}
                />{" "}
                Compound unpaid interest each period
              </label>
              <p className="text-sm text-muted">
                Simple interest uses remaining principal. A zero installment requires manual
                repayment. Creating a new loan transfers its principal immediately; recording an
                earlier approved loan does not credit coins again. Inventory is never sold or seized
                automatically.
              </p>
              <Button type="submit" disabled={!purses.length}>
                {editing
                  ? "Save loan terms"
                  : source
                    ? "Record existing debt"
                    : "Approve & fund loan"}
              </Button>
            </fieldset>
            {(editing || source) && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (termsDirty && !window.confirm("Discard unsaved loan terms?")) return;
                  setLoanEntryRevision((v) => v + 1);
                  setEditing("");
                  setSource("");
                  setTerms(defaults);
                  setTermsBefore(defaults);
                  setPrincipal(1000);
                  setPrincipalBefore(1000);
                }}
              >
                Cancel editing
              </Button>
            )}
          </form>
        </details>
      )}
      {(section === "all" || section === "settings") && (
        <details open={section === "settings" ? true : undefined}>
          <summary>Recurring revenue & expenses</summary>
          {f.rules.map((r) => (
            <div
              className="journal-entry"
              key={r.id}
              id={
                r.holdingId && f.rules.find((x) => x.holdingId === r.holdingId)?.id === r.id
                  ? `property-${encodeURIComponent(r.holdingId)}`
                  : undefined
              }
            >
              <strong>
                {r.name} · {accountName(r.purseId)}
              </strong>
              <p className="text-sm">
                {r.kind} · {formatCopper(r.copper)} every {r.periodDays} days ·{" "}
                {r.active ? "Active" : "Paused"} · {r.carryDays} days carried
                {r.arrears ? ` · Unpaid ${formatCopper(r.arrears)}` : ""}
              </p>
              <Button
                disabled={busy || !!pending}
                variant="secondary"
                onClick={() => {
                  if (
                    ruleDirty &&
                    !window.confirm("Discard unsaved recurring schedule and edit another?")
                  )
                    return;
                  setRuleEntryRevision((v) => v + 1);
                  setRule(r);
                  setRuleBefore(r);
                }}
              >
                Edit schedule
              </Button>
            </div>
          ))}
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                {
                  kind: "finance-rule",
                  rule: { ...rule, id: rule.id || crypto.randomUUID(), purseId: ruleOwner },
                },
                () => {
                  setRuleEntryRevision((v) => v + 1);
                  setRuleBefore({
                    id: "",
                    name: "",
                    purseId: "",
                    kind: "income",
                    copper: 100,
                    periodDays: 1,
                    holdingId: "",
                    active: true,
                  });
                  setRule({
                    id: "",
                    name: "",
                    purseId: "",
                    kind: "income",
                    copper: 100,
                    periodDays: 1,
                    holdingId: "",
                    active: true,
                  });
                },
              );
            }}
          >
            <fieldset disabled={busy || !!pending} className="grid gap-3">
              <h3>{rule.id ? "Edit schedule" : "Add a schedule"}</h3>
              <label>
                Schedule name
                <input
                  className="ledger-search w-full"
                  required
                  maxLength={100}
                  value={rule.name}
                  onChange={(e) => setRule({ ...rule, name: e.target.value })}
                />
              </label>
              <label>
                Campaign account
                <select
                  className="ledger-search w-full"
                  disabled={!!rule.id}
                  aria-label="Campaign account"
                  value={ruleOwner}
                  onChange={(e) => setRule({ ...rule, purseId: e.target.value, holdingId: "" })}
                >
                  {purses.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select
                  className="ledger-search w-full"
                  disabled={!!rule.id}
                  aria-label="Type"
                  value={rule.kind}
                  onChange={(e) =>
                    setRule({
                      ...rule,
                      kind: e.target.value as "income" | "expense",
                      holdingId: "",
                    })
                  }
                >
                  <option value="income">Revenue</option>
                  <option value="expense">Expense / recurring payment</option>
                </select>
              </label>
              <CoinAmountInput
                label="Amount per period (cp)"
                resetKey={ruleEntryRevision}
                value={rule.copper}
                min={1}
                max={1e12}
                onChange={(raw) => setRule({ ...rule, copper: raw === "" ? NaN : Number(raw) })}
              />
              <label>
                Every (in-game days)
                <input
                  className="ledger-search w-full"
                  type="number"
                  min={1}
                  max={3650}
                  required
                  value={rule.periodDays}
                  onChange={(e) => setRule({ ...rule, periodDays: Number(e.target.value) })}
                />
              </label>
              {rule.kind === "income" && (
                <label>
                  Optional inventory source
                  <select
                    className="ledger-search w-full"
                    aria-label="Optional inventory source"
                    value={rule.holdingId}
                    onChange={(e) => setRule({ ...rule, holdingId: e.target.value })}
                  >
                    <option value="">No inventory link</option>
                    {holdings
                      .filter((h) => h.purseId === ruleOwner)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={rule.active}
                  onChange={(e) => setRule({ ...rule, active: e.target.checked })}
                />{" "}
                Active
              </label>
              <p className="text-sm text-muted">
                An inventory link requires that holding to remain in the selected account; it does
                not consume or sell items. Pausing stops new accrual and payment attempts while
                retaining unpaid amounts.
              </p>
              <Button type="submit" disabled={!purses.length}>
                Save schedule
              </Button>
            </fieldset>
          </form>
        </details>
      )}
      {(section === "all" || section === "downtime") && (
        <details>
          <summary>Downtime history</summary>
          {[...f.downtime].reverse().map((d) => (
            <details key={d.id} className="journal-entry">
              <summary>
                {d.name} · {d.days} days · {d.status}
              </summary>
              <p className="text-sm">
                Day {d.fromDay} → {d.fromDay + d.days}
                {d.appliedAt
                  ? ` · Applied ${new Date(d.appliedAt).toLocaleString()}`
                  : " · No funds moved"}
              </p>
              {d.quote.lines.map((l) => (
                <p className="text-sm" key={l.id}>
                  {l.name}: {d.status === "applied" ? "Applied" : "Preview"} {formatCopper(l.paid)}{" "}
                  · Interest {formatCopper(l.interest)} · Unpaid {formatCopper(l.unpaid)}
                </p>
              ))}
            </details>
          ))}
        </details>
      )}
    </details>
  );
}
