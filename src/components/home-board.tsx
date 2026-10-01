import { Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Campaigns } from "@/components/campaigns";
import { CloudTable } from "@/components/cloud-table";
import { Guide } from "@/components/guide";
import { Notices } from "@/components/notices";
import { Card, EmptyState, MoneyLine } from "@/components/terminal";
import { TurnLine } from "@/components/turn-line";
import { Button, Confirm, Fold, Switch } from "@/components/ui";
import { getCampaigns, serverCampaigns, subscribeCampaigns } from "@/lib/quire/campaigns";
import { getChatSnapshot, refreshChat, serverChat, subscribeChat } from "@/lib/quire/chat";
import { useEconomy } from "@/lib/quire/economy-context";
import { useLibrary } from "@/lib/quire/library";
import { formatCoins, formatCopper, toCopper } from "@/lib/quire/money";
import { usePrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";

export function HomeBoard() {
  const { ready, purses, holdings, ledger, shops, loans, download, restoreFile } = useEconomy();
  const seat = useSeat();
  const { reload } = useLibrary();
  const [confirming, setConfirming] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { prefs, setPrefs } = usePrefs();
  const notes = useSyncExternalStore(subscribeChat, getChatSnapshot, serverChat);
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const campaign = campaigns.campaigns.find((item) => item.id === campaigns.activeId)?.name ?? "This campaign";

  useEffect(() => {
    void refreshChat();
  }, []);

  const mine = seat.role === "player" ? purses.filter((purse) => seat.purseIds.includes(purse.id)) : purses;
  const coin = mine.reduce((sum, purse) => sum + toCopper(purse.coins), 0);
  const loot = holdings.filter((holding) => mine.some((purse) => purse.id === holding.purseId));
  const lootValue = loot.reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = ledger.filter((line) => line.at >= start.getTime() && mine.some((purse) => purse.id === line.purseId));
  const session = today.reduce((sum, line) => sum + line.copper, 0);
  const recent = [...ledger].filter((line) => mine.some((purse) => purse.id === line.purseId)).sort((a, b) => b.at - a.at).slice(0, 5);
  const messages = [...notes].sort((a, b) => b.at - a.at).slice(0, 2);

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">{campaign}</h1>
          <p className="text-sm text-muted">
            {seat.role === "dm"
              ? `${purses.filter((purse) => purse.kind === "character").length} adventurers.`
              : "What this phone is carrying."}
          </p>
        </div>
        <Guide />
      </div>
      <TurnLine />
      {!ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {ready ? (
        <>
          <Card className="mt-4">
            <p className="text-xs tracking-[0.16em] text-faint uppercase">Treasury</p>
            <p className="mt-1 font-display text-4xl tracking-tight text-lead">{formatCopper(coin)}</p>
            {session !== 0 ? (
              <p className="mt-1 text-sm">
                <MoneyLine copper={session} label={formatCopper(Math.abs(session))} />
                <span className="text-muted"> today</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">No coin moved today.</p>
            )}
          </Card>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {seat.role === "dm" ? (
              <>
                <Link to="/market" search={{ book: "" }} className="rounded-2xl border border-lead/25 bg-elevated p-3">
                  <p className="text-xs tracking-[0.14em] text-faint uppercase">Open shops</p>
                  <p className="mt-1 font-display text-3xl">{shops.length}</p>
                  <p className="text-sm text-muted">{new Set(shops.map((shop) => shop.place).filter(Boolean)).size} locations</p>
                </Link>
                <Link to="/share" className="rounded-2xl border border-lead/25 bg-elevated p-3">
                  <p className="text-xs tracking-[0.14em] text-faint uppercase">Pending</p>
                  <p className="mt-1 font-display text-3xl">{loans.filter((loan) => loan.status === "pending").length}</p>
                  <p className="text-sm text-muted">loan requests</p>
                </Link>
              </>
            ) : (
              <>
                <Link to="/party" className="rounded-2xl border border-lead/25 bg-elevated p-3">
                  <p className="text-xs tracking-[0.14em] text-faint uppercase">Loot</p>
                  <p className="mt-1 font-display text-2xl">{loot.length} {loot.length === 1 ? "item" : "items"}</p>
                  <p className="text-sm text-muted">{formatCopper(lootValue)}</p>
                </Link>
                <Link to="/market" search={{ book: "" }} className="rounded-2xl border border-lead/25 bg-elevated p-3">
                  <p className="text-xs tracking-[0.14em] text-faint uppercase">Market</p>
                  <p className="mt-1 font-display text-2xl">{shops.length} {shops.length === 1 ? "shop" : "shops"}</p>
                  <p className="text-sm text-muted">{today.filter((line) => line.shopId).length} today</p>
                </Link>
              </>
            )}
          </div>
          <section className="mt-5">
            <h2 className="text-sm font-medium text-muted">Recent activity</h2>
            {recent.length === 0 ? (
              <div className="mt-2">
                <EmptyState title="No activity yet" body="Purchases, sales, and payments will list here." />
              </div>
            ) : (
              <ul className="mt-2">
                {recent.map((line) => (
                  <li key={line.id} className="flex items-baseline justify-between gap-3 border-b border-border/70 py-2 text-sm">
                    <span className="min-w-0">
                      <MoneyLine copper={line.copper} label={formatCopper(Math.abs(line.copper))} />
                      <span className="mt-0.5 block truncate text-muted">{line.summary}</span>
                    </span>
                    <span className="shrink-0 text-xs text-faint">{when(line.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {messages.length > 0 ? (
            <Link to="/share" className="mt-4 block rounded-2xl border border-lead/25 bg-elevated px-4 py-3">
              <p className="text-xs tracking-[0.14em] text-faint uppercase">Latest message</p>
              <p className="mt-1 truncate text-sm">{messages[0]?.text}</p>
            </Link>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link to="/party" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-lead px-3 text-sm font-medium text-bg">Add loot</Link>
            {seat.role === "dm" ? (
              <Link to="/share" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40 px-3 text-sm">Approve bills</Link>
            ) : (
              <Link to="/party" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40 px-3 text-sm">Transfer</Link>
            )}
            {seat.role === "dm" ? (
              <>
                <Link to="/market" search={{ book: "" }} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40 px-3 text-sm">Open shop</Link>
                <Link to="/settings" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-lead/40 px-3 text-sm">Adjust prices</Link>
              </>
            ) : null}
          </div>
          <ul className="mt-5 divide-y divide-border border-y border-border">
            {mine.slice(0, 6).map((purse) => (
              <li key={purse.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span>{purse.name}</span>
                <span className="shrink-0 tabular-nums text-lead">{formatCoins(purse.coins)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Fold title="Table" hint="Mode, notices, and this campaign.">
        <CloudTable />
        <div className="mt-3">
          <Notices />
        </div>
        <TurnLine />
        <div className="mt-3">
          <Switch checked={prefs.showDollars} onChange={(on) => setPrefs({ showDollars: on })} label="Show dollars" hint="A dollar reading beside the coins." />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link to="/settings" className="inline-flex min-h-11 items-center rounded-xl border border-lead/40 px-3">Settings</Link>
          <Link to="/share" className="inline-flex min-h-11 items-center rounded-xl border border-lead/40 px-3">Share</Link>
          {seat.role === "dm" ? (
            <Button variant="secondary" onClick={() => void download()}>Download copy</Button>
          ) : null}
        </div>
        {seat.role === "dm" ? (
          <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center text-sm text-muted">
            Restore a copy
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                event.target.value = "";
                if (next) {
                  setFile(next);
                  setConfirming(true);
                }
              }}
            />
          </label>
        ) : null}
        <div className="mt-4">
          <Campaigns />
        </div>
      </Fold>
      <Confirm
        open={confirming}
        onOpenChange={setConfirming}
        title="Replace this campaign?"
        body={file ? `${file.name} replaces the open campaign on this phone.` : ""}
        confirmLabel="Restore"
        onConfirm={() => {
          if (!file) return;
          void restoreFile(file).then(() => reload()).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "That copy could not be restored."));
        }}
      />
    </>
  );
}

function when(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
