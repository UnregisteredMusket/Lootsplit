import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useLibrary } from "@/lib/quire/library";
import { formatCopper, toCopper } from "@/lib/quire/money";
import { useDollarText, usePrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { basketNote, realmNote, scarcityNote } from "@/lib/quire/scale";
import { Shell } from "@/components/shell";
import { Campaigns } from "@/components/campaigns";
import { Guide } from "@/components/guide";
import { Button, Confirm } from "@/components/ui";

export const Route = createFileRoute("/")({
  component: Desk,
});

function Desk() {
  const { ready, purses, holdings, shops, catalog, lexicon, ledger, realm, download, restoreFile } = useEconomy();
  const { prefs } = usePrefs();
  const seat = useSeat();
  const dollars = useDollarText();
  const { reload } = useLibrary();
  const [confirming, setConfirming] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const coin = purses.reduce((sum, purse) => sum + toCopper(purse.coins), 0);
  const goods = holdings.reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);

  return (
    <Shell>
      <h1 className="font-display text-4xl tracking-tight">Desk</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">Money, items, and the current price modifiers.</p>
      <Guide />
      <Campaigns />
      {!ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {ready ? (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section data-surface="paper" className="rounded-lg p-5">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-paper-muted">Coin on hand</p>
                  <p className="mt-1 font-display text-3xl tracking-tight tabular-nums">{formatCopper(coin)}</p>
                  <p className="mt-1 text-sm text-paper-muted">10 cp = 1 sp · 10 sp = 1 gp · 10 gp = 1 pp</p>
                  {dollars(coin) ? <p className="mt-1 text-sm text-paper-muted">about {dollars(coin)}</p> : null}
                </div>
                <div>
                  <p className="text-sm text-paper-muted">Goods and property</p>
                  <p className="mt-1 font-display text-3xl tracking-tight tabular-nums">{formatCopper(goods)}</p>
                  {dollars(goods) ? <p className="mt-1 text-sm text-paper-muted">about {dollars(goods)}</p> : null}
                </div>
              </div>
              <p className="mt-5 border-t border-paper-line pt-3 text-sm text-paper-muted">
                {purses.length} purses · {shops.length} {shops.length === 1 ? "shop" : "shops"} · {catalog.length} index goods · {lexicon.length} names
              </p>
            </section>
            <div className="flex flex-col gap-6">
              <section className="rounded-lg border border-border p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-2xl tracking-tight">Realm</h2>
                  <Link to="/settings" className="inline-flex min-h-11 items-center text-sm text-muted">
                    Adjust
                  </Link>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {realmNote(realm, { dollars: prefs.showDollars })} {scarcityNote(realm.scarcity)}
                </p>
                <p className="mt-2 text-sm text-muted">{basketNote(realm, { dollars: prefs.showDollars })}</p>
              </section>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void download().catch(() => toast.error("Could not prepare the file."))}>
              Download copy
            </Button>
            {seat.role === "dm" ? (
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border border-border px-4 text-sm">
                Restore copy
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(event) => {
                    const next = event.target.files?.[0];
                    if (next) {
                      setFile(next);
                      setConfirming(true);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
            ) : null}
          </div>
          <h2 className="mt-10 font-display text-2xl tracking-tight">Recent entries</h2>
          {ledger.length === 0 ? <p className="mt-3 text-muted">Purchases, sales, and payments show up here.</p> : null}
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {ledger.slice(0, prefs.ledgerRows).map((line) => (
              <li key={line.id} className="flex items-baseline justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block">{line.summary}</span>
                  <span className="text-sm text-muted">{new Date(line.at).toLocaleString()}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">{formatCopper(line.copper)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Confirm
        open={confirming}
        onOpenChange={setConfirming}
        title="Restore this copy?"
        body="This replaces the shops, purses, items, and ledger in this campaign. A newer file also replaces the index and the names. PDFs in the file are added."
        confirmLabel="Restore"
        onConfirm={() => {
          if (!file) return;
          void restoreFile(file)
            .then(() => reload())
            .catch((error) => toast.error(error instanceof Error ? error.message : "That file could not be restored."));
        }}
      />
    </Shell>
  );
}
