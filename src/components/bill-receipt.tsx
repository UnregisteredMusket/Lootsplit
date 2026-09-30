import { useSyncExternalStore } from "react";
import { formatCopper } from "@/lib/quire/money";
import { dismissReceipt, getReceipt, subscribeReceipt } from "@/lib/quire/receipt";
import { Button, Modal } from "@/components/ui";

export function BillReceipt() {
  const receipt = useSyncExternalStore(subscribeReceipt, getReceipt, () => null);
  if (!receipt) return null;
  const empty = receipt.bought.length === 0 && receipt.sold.length === 0;
  return (
    <Modal open onOpenChange={(open) => { if (!open) dismissReceipt(); }} title="Bill received">
      <div className="flex flex-col gap-4">
        {empty ? <p className="text-sm text-muted">Nothing was purchased.</p> : null}
        <ReceiptList title="Purchased" buyers={receipt.bought} />
        <ReceiptList title="Sold" buyers={receipt.sold} />
        <Button onClick={() => dismissReceipt()}>Close</Button>
      </div>
    </Modal>
  );
}

function ReceiptList({ title, buyers }: { title: string; buyers: { name: string; lines: { summary: string; copper: number }[] }[] }) {
  if (buyers.length === 0) return null;
  return (
    <section>
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      <ul className="mt-2 flex flex-col gap-3">
        {buyers.map((buyer) => (
          <li key={buyer.name}>
            <p className="text-sm font-medium">{buyer.name}</p>
            <ul className="mt-1">
              {buyer.lines.map((line, index) => (
                <li key={`${line.summary}-${index}`} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                  <span className="min-w-0 text-muted">{line.summary}</span>
                  <span className="shrink-0 tabular-nums">{formatCopper(Math.abs(line.copper))}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
