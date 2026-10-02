import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import type { Journal } from "@/lib/quire/journal";
import { sessionSummary } from "@/lib/quire/journal";
import { formatCopper } from "@/lib/quire/money";
import { Button, Fold } from "./ui";
function RecordedChange({ change }: { change: NonNullable<Journal["events"][number]["change"]> }) {
  const keys = [
    ...new Set([...Object.keys(change.before || {}), ...Object.keys(change.after || {})]),
  ].filter((key) => change.before?.[key] !== change.after?.[key]);
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer">Recorded changes</summary>
      <dl className="mt-2 grid gap-2">
        {keys.map((key) => (
          <div key={key} className="break-words">
            <dt className="font-medium">{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt>
            <dd>
              {String(change.before?.[key] ?? "Not recorded")} →{" "}
              {String(change.after?.[key] ?? "Not recorded")}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
export function CampaignJournal() {
  const { journal, ledger, purses, command, loans, decideLoan } = useEconomy();
  const seat = useSeat();
  const dm = seat.role === "dm";
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [copper, setCopper] = useState("");
  const [purseId, setPurse] = useState("");
  const [busy, setBusy] = useState(false);
  const active = journal.sessions.find((x) => !x.endedAt);
  const accounts = dm ? purses : purses.filter((x) => seat.purseIds.includes(x.id));
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const requests = journal.requests.filter((x) => dm || seat.purseIds.includes(x.purseId));
  const pending = loans.filter(
    (x) => x.status === "pending" && (dm || seat.purseIds.includes(x.purseId)),
  );
  const events = [
    ...ledger
      .filter((x) => dm || seat.purseIds.includes(x.purseId))
      .map((x) => ({ ...x, kind: "transaction" })),
    ...journal.events.filter((x) => dm || !x.purseId || seat.purseIds.includes(x.purseId)),
  ].sort((a, b) => b.at - a.at);
  return (
    <div className="campaign-journal" id="review">
      <Fold
        title={active ? `Session · ${active.name}` : "Play sessions"}
        hint="Named sessions, with recorded coin movement."
      >
        {dm ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => command({ kind: "session", name, end: false }));
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              className="ledger-search flex-1"
              aria-label="Session name"
              placeholder="Name your next session"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button disabled={busy} type="submit">
              {active ? "End & start next" : "Start session"}
            </Button>
            {active ? (
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() =>
                  void run(() => command({ kind: "session", name: active.name, end: true }))
                }
              >
                End session
              </Button>
            ) : null}
          </form>
        ) : null}
        {!journal.sessions.length ? (
          <p className="text-muted">
            No sessions recorded yet. Earlier activity remains in the ledger.
          </p>
        ) : null}
        {[...journal.sessions].reverse().map((session) => {
          const sum = sessionSummary(ledger, session, dm ? undefined : seat.purseIds);
          return (
            <div className="journal-entry" key={session.id}>
              <strong>{session.name}</strong>
              <small>
                {new Date(session.startedAt).toLocaleString()} ·{" "}
                {session.endedAt ? "Ended" : "In progress"}
              </small>
              <p>
                Received {formatCopper(sum.received)} · Spent {formatCopper(sum.spent)} · Net{" "}
                {formatCopper(sum.net)}
              </p>
            </div>
          );
        })}
        <p className="text-sm text-muted">
          Received/spent excludes internal coin transfers. Net is the balance movement; this is not
          a measure of newly earned wealth or changes in item valuations.
        </p>
      </Fold>
      <details id="review-inbox" className="review-inbox">
        <summary>
          {dm ? "Review inbox" : "Payment requests"} ·{" "}
          {pending.length + requests.filter((x) => x.status === "pending").length} pending
        </summary>
        <p className="text-sm text-muted">Normal authorized trading remains immediate.</p>
        {pending.map((x) => (
          <div className="journal-entry" key={x.id}>
            <strong>
              Loan · {x.purseName} · {formatCopper(x.copper)}
            </strong>
            <p>{x.note}</p>
            {dm ? (
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void run(() => decideLoan(x.id, "approved"))}
                >
                  Approve loan
                </Button>
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() => void run(() => decideLoan(x.id, "denied"))}
                >
                  Decline
                </Button>
              </div>
            ) : (
              <small>Pending</small>
            )}
          </div>
        ))}
        {[...requests].reverse().map((x) => (
          <div className="journal-entry" key={x.id}>
            <strong>
              Payment · {purses.find((p) => p.id === x.purseId)?.name} · {formatCopper(x.copper)}
            </strong>
            <p>{x.note}</p>
            <small>{x.status}</small>
            {dm && x.status === "pending" ? (
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      command({
                        kind: "payment-decision",
                        requestId: x.id,
                        status: "approved",
                      }),
                    )
                  }
                >
                  Approve payment
                </Button>
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() =>
                    void run(() =>
                      command({
                        kind: "payment-decision",
                        requestId: x.id,
                        status: "denied",
                      }),
                    )
                  }
                >
                  Decline
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await command({
                kind: "payment-request",
                purseId: purseId || accounts[0]?.id || "",
                copper: Number(copper),
                note,
              });
              setNote("");
              setCopper("");
            });
          }}
        >
          <h3>Submit a payment for DM review</h3>
          <p className="text-sm text-muted">
            Approval spends the requested coins from the selected account once. It does not purchase
            a shop item.
          </p>
          <select
            className="ledger-search"
            aria-label="Payment account"
            value={purseId || accounts[0]?.id || ""}
            onChange={(e) => setPurse(e.target.value)}
          >
            {accounts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <input
            className="ledger-search"
            aria-label="Payment amount in copper"
            type="number"
            min="1"
            max="1000000000000"
            required
            placeholder="Amount in copper pieces"
            value={copper}
            onChange={(e) => setCopper(e.target.value)}
          />
          <input
            className="ledger-search"
            aria-label="Payment description"
            required
            maxLength={1000}
            placeholder="What is this payment for?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button disabled={busy || !accounts.length} type="submit">
            Submit request
          </Button>
        </form>
      </details>
      <Fold
        title="Full activity"
        hint="Transactions and management events recorded by this version."
      >
        {events.map((x, i) => (
          <div className="journal-entry" key={`${x.id}-${i}`}>
            <p>{x.summary}</p>
            {dm && "change" in x && x.change ? <RecordedChange change={x.change} /> : null}
            <small>
              {new Date(x.at).toLocaleString()} · {x.kind}
              {"copper" in x ? ` · ${formatCopper(x.copper)}` : ""}
            </small>
          </div>
        ))}
        {!events.length ? <p>No activity recorded.</p> : null}
      </Fold>
    </div>
  );
}
export function PriceHistory() {
  const dm = useSeat().role === "dm";
  const { journal } = useEconomy();
  return (
    <Fold
      title="Price-change history"
      hint="Recorded changes only; earlier prices are not reconstructed."
    >
      {journal.events
        .filter((x) => x.kind === "prices")
        .slice()
        .reverse()
        .map((x, i) => (
          <div className="journal-entry" key={`${x.id}-${i}`}>
            <p>{x.summary}</p>
            {dm && x.change ? <RecordedChange change={x.change} /> : null}
            <small>{new Date(x.at).toLocaleString()}</small>
          </div>
        ))}
    </Fold>
  );
}
