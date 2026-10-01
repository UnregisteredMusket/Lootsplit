import { useState, useSyncExternalStore } from "react";
import { formatCopper } from "@/lib/quire/money";
import { useEconomy } from "@/lib/quire/economy-context";
import { dismissReceipt, getReceipt, subscribeReceipt, type ReceiptEntry, type ReceiptNote, type ReceiptTotal } from "@/lib/quire/receipt";
import { Button, Modal } from "@/components/ui";

export function BillReceipt() {
  const receipt = useSyncExternalStore(subscribeReceipt, getReceipt, () => null);
  const { decideLoan, voidLine } = useEconomy();
  const [settled, setSettled] = useState<Record<string, "approved" | "denied">>({});
  if (!receipt) return null;
  const who = receipt.who.length > 0 ? receipt.who.join(", ") : "This player";
  const loans = receipt.loans.filter((loan) => loan.status === "pending" || settled[loan.id]);
  return (
    <Modal open onOpenChange={(open) => { if (!open) dismissReceipt(); }} title="From this player">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Every transaction and message from {who}.</p>
        {receipt.sheets.length > 0 ? (
          <p className="text-sm">A 2014 character sheet arrived for {receipt.sheets.map((sheet) => sheet.name).join(", ")}. It is on the Party page.</p>
        ) : null}
        {receipt.switchedToDm ? (
          <p className="rounded-sm border border-danger px-3 py-2 text-sm">
            This player switched to dungeon master before sending the bill. The purchases may have been changed after that switch.
          </p>
        ) : null}
        <section>
          <h2 className="font-display text-xl tracking-tight">Transactions</h2>
          {receipt.entries.length === 0 ? <p className="mt-2 text-sm text-muted">No transactions.</p> : null}
          <ul className="mt-2">
            {receipt.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} onVoid={() => void voidLine(entry.id)} />
            ))}
          </ul>
          {receipt.totals.length > 0 ? (
            <ul className="mt-2 border-t border-border pt-2">
              {receipt.totals.map((total) => (
                <li key={total.name} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                  <span>{total.name}</span>
                  <span className="shrink-0 tabular-nums">{net(total)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        {loans.length > 0 ? (
          <section>
            <h2 className="font-display text-xl tracking-tight">Loans</h2>
            <ul className="mt-2 flex flex-col gap-3">
              {loans.map((loan) => {
                const status = settled[loan.id];
                return (
                  <li key={loan.id} className="rounded-sm border border-border px-3 py-2">
                    <p className="text-sm font-medium">{loan.purseName} asks for {formatCopper(loan.copper)}</p>
                    <p className="mt-1 text-sm text-muted">{loan.note}</p>
                    {status ? <p className="mt-2 text-sm">{status === "approved" ? "Approved." : "Denied."}</p> : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          onClick={() => {
                            void decideLoan(loan.id, "approved").then(() => setSettled((current) => ({ ...current, [loan.id]: "approved" })));
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            void decideLoan(loan.id, "denied").then(() => setSettled((current) => ({ ...current, [loan.id]: "denied" })));
                          }}
                        >
                          Deny
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section>
          <h2 className="font-display text-xl tracking-tight">Messages</h2>
          {receipt.notes.length === 0 ? <p className="mt-2 text-sm text-muted">No messages.</p> : null}
          <ul className="mt-2 flex flex-col gap-3">
            {receipt.notes.map((note) => (
              <Message key={note.id} note={note} />
            ))}
          </ul>
        </section>
        <Button onClick={() => dismissReceipt()}>Close</Button>
      </div>
    </Modal>
  );
}

function Entry({ entry, onVoid }: { entry: ReceiptEntry; onVoid: () => void }) {
  const voided = entry.summary.startsWith("Voided");
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <span className="min-w-0">
        <span className="font-medium">{entry.name}</span>
        <span className="text-muted"> · {entry.summary}</span>
        {voided ? null : (
          <button type="button" className="mt-1 block min-h-11 text-muted" onClick={onVoid}>
            Void
          </button>
        )}
      </span>
      <span className="shrink-0 tabular-nums">{formatCopper(entry.copper)}</span>
    </li>
  );
}

function Message({ note }: { note: ReceiptNote }) {
  return (
    <li>
      <p className="text-sm font-medium">{note.label}</p>
      <p className="mt-1 text-sm text-muted">{note.text}</p>
    </li>
  );
}

function net(total: ReceiptTotal) {
  if (total.copper < 0) return `spent ${formatCopper(Math.abs(total.copper))}`;
  if (total.copper > 0) return `gained ${formatCopper(total.copper)}`;
  return "no coin change";
}
