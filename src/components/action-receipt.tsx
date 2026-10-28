import { useSyncExternalStore } from "react";
import { formatCopper } from "@/lib/quire/money";
import { useEconomy } from "@/lib/quire/economy-context";
import {
  dismissActionReceipt,
  getActionReceipt,
  receiptHolding,
  receiptLines,
  subscribeActionReceipt,
} from "@/lib/quire/action-receipt";
import { holdingRecordId } from "@/lib/quire/finance-record-links";
import { AppLink } from "@/components/app-link";
import { Button, Modal } from "@/components/ui";

/** The receipt a result toast's "View receipt" opens (design D9). Read-only. */
export function ActionReceipt() {
  const request = useSyncExternalStore(subscribeActionReceipt, getActionReceipt, () => null);
  const { ledger, holdings, purses } = useEconomy();
  if (!request) return null;
  const lines = request.commandId ? receiptLines(ledger, request.commandId) : [];
  const holding = receiptHolding(holdings, request.holdingId);
  const name = (id: string) => purses.find((p) => p.id === id)?.name ?? "Account unavailable";
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) dismissActionReceipt();
      }}
      title={request.title}
    >
      <div className="action-receipt flex flex-col gap-3">
        {lines.length ? (
          <ul aria-label="Recorded lines">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="font-medium">{name(line.purseId)}</span>
                  <span className="text-muted"> · {line.summary}</span>
                  <span className="block text-xs text-faint">
                    {new Date(line.at).toLocaleString()}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatCopper(line.copper)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {holding ? (
          <p className="text-sm">
            {holding.name} ×{holding.quantity} · {name(holding.purseId)} ·{" "}
            {formatCopper(holding.unitCopper * holding.quantity)}
          </p>
        ) : null}
        {!lines.length && !holding ? (
          <p className="text-sm text-muted">
            Nothing from this action is on this screen: it may still be waiting to sync, or it has
            changed since. Activity and the campaign journal keep the full history.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {holding ? (
            <AppLink
              className="inline-flex min-h-11 items-center text-sm text-lead"
              href={`/party?section=funds#${holdingRecordId(holding.id)}`}
              onClick={() => dismissActionReceipt()}
            >
              Show in inventory
            </AppLink>
          ) : null}
          <Button variant="secondary" onClick={() => dismissActionReceipt()}>
            Close receipt
          </Button>
        </div>
      </div>
    </Modal>
  );
}
