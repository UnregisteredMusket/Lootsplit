import type { ReactNode } from "react";
import { DesktopDeskPanels } from "./control-panel/desktop-panels";
import { useDesktop } from "@/lib/quire/use-desktop";
import { AppLink } from "./app-link";
import { sessionSummary } from "@/lib/quire/journal";
import { CampaignJournal } from "./campaign-journal";
import { LedgerArt } from "./ledger-art";
import {
  Coins,
  Package,
  Store,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  SlidersHorizontal,
  Users,
  ScrollText,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Campaigns } from "@/components/campaigns";
import { Guide } from "@/components/guide";
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

function OverviewSection({
  embedded,
  title,
  hint,
  children,
}: {
  embedded: boolean;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return embedded ? (
    <Fold title={title} hint={hint}>
      {children}
    </Fold>
  ) : (
    <>{children}</>
  );
}

export function HomeBoard({ embedded = false }: { embedded?: boolean }) {
  const desktop = useDesktop();
  const { ready, purses, holdings, ledger, shops, loans, journal, sheets, download, restoreFile } =
    useEconomy();
  const seat = useSeat();
  const { reload } = useLibrary();
  const [confirming, setConfirming] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { prefs, setPrefs } = usePrefs();
  const notes = useSyncExternalStore(subscribeChat, getChatSnapshot, serverChat);
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const campaign =
    campaigns.campaigns.find((item) => item.id === campaigns.activeId)?.name ?? "This campaign";

  useEffect(() => {
    void refreshChat();
  }, []);

  const mine =
    seat.role === "player" ? purses.filter((purse) => seat.purseIds.includes(purse.id)) : purses;
  const treasury = seat.role === "player" ? mine.filter((p) => p.kind === "character") : mine;
  const activeSession = journal.sessions.find((x) => !x.endedAt);
  const coin = treasury.reduce((sum, purse) => sum + toCopper(purse.coins), 0);
  const loot = holdings.filter((holding) => treasury.some((purse) => purse.id === holding.purseId));
  const lootValue = loot.reduce((sum, holding) => sum + holding.unitCopper * holding.quantity, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = ledger.filter(
    (line) => line.at >= start.getTime() && mine.some((purse) => purse.id === line.purseId),
  );
  const session = activeSession
    ? sessionSummary(
        ledger,
        activeSession,
        treasury.map((p) => p.id),
      ).net
    : today.reduce((sum, line) => sum + line.copper, 0);
  const recent = [...ledger]
    .filter((line) => mine.some((purse) => purse.id === line.purseId))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const messages = [...notes].sort((a, b) => b.at - a.at).slice(0, 2);

  return (
    <>
      {!embedded && (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">
              {seat.role === "dm" ? "Campaign overview" : "Campaign overview"}
            </p>
            <h1 className="mt-1 font-display text-4xl tracking-tight">{campaign}</h1>
            <p className="text-sm text-muted">
              {seat.role === "dm"
                ? `${purses.filter((purse) => purse.kind === "character").length} character${purses.filter((purse) => purse.kind === "character").length === 1 ? "" : "s"}.`
                : `Playing as ${
                    mine
                      .filter((p) => p.kind === "character")
                      .map((p) => p.name)
                      .join(", ") || "an unassigned character"
                  }`}
            </p>
          </div>
          <Guide />
        </div>
      )}
      <TurnLine />
      {!ready ? <p className="mt-6 text-muted">Loading…</p> : null}
      {ready ? (
        <>
          <OverviewSection
            embedded={embedded}
            title="Campaign treasury"
            hint={`${formatCopper(coin)} in coins · ${formatCopper(lootValue)} in holdings`}
          >
            <div className="dashboard-top mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <Card className="wealth-card relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <p className="eyebrow">
                    {seat.role === "dm" ? "Campaign treasury" : "Your treasury"}
                  </p>
                  <Coins className="size-6 text-lead" aria-hidden="true" />
                </div>
                <p className="treasury-value mt-4 font-display text-lead">{formatCopper(coin)}</p>
                <p className="mt-1 text-sm text-muted">
                  {session !== 0 ? (
                    <>
                      <MoneyLine copper={session} label={formatCopper(Math.abs(session))} />{" "}
                      {activeSession ? `net this session · ${activeSession.name}` : "net today"}
                    </>
                  ) : activeSession ? (
                    `No net coin movement · ${activeSession.name}`
                  ) : (
                    "No coin moved today"
                  )}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-lead/20 pt-4">
                  <div>
                    <p className="text-sm text-muted">Holdings value</p>
                    <p className="mt-1 text-lg tabular-nums">{formatCopper(lootValue)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">Total wealth</p>
                    <p className="mt-1 text-lg tabular-nums">{formatCopper(coin + lootValue)}</p>
                  </div>
                </div>
              </Card>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/party" className="stat-card">
                  <Package className="size-5 text-lead" />
                  <p className="mt-4 font-display text-3xl">{loot.length}</p>
                  <p className="text-sm text-muted">Recorded holdings</p>
                </Link>
                <Link to="/market" search={{ book: "" }} className="stat-card">
                  <Store className="size-5 text-lead" />
                  <p className="mt-4 font-display text-3xl">
                    {seat.role === "dm"
                      ? shops.filter((shop) => !shop.closed).length
                      : shops.filter((shop) => !shop.closed && seat.shopIds.includes(shop.id))
                          .length}
                  </p>
                  <p className="text-sm text-muted">Open shops</p>
                </Link>
                {!embedded && (
                  <>
                    <Link to="/party" className="stat-card hidden sm:block">
                      <Users className="size-5 text-lead" />
                      <p className="mt-4 font-display text-3xl">
                        {mine.filter((purse) => purse.kind === "character").length}
                      </p>
                      <p className="text-sm text-muted">Characters</p>
                    </Link>
                    <Link
                      to={seat.role === "dm" ? "/" : "/party"}
                      search={seat.role === "dm" ? { view: "home" } : { action: "" }}
                      hash={seat.role === "dm" ? "review-inbox" : undefined}
                      onClick={() => {
                        if (seat.role !== "dm") return;
                        const el = document.getElementById("review-inbox");
                        if (el instanceof HTMLDetailsElement) el.open = true;
                      }}
                      className="stat-card hidden sm:block"
                    >
                      <ScrollText className="size-5 text-lead" />
                      <p className="mt-4 font-display text-3xl">
                        {seat.role === "dm"
                          ? loans.filter((loan) => loan.status === "pending").length +
                            journal.requests.filter((x) => x.status === "pending").length
                          : loot.filter((holding) => holding.kind === "property").length}
                      </p>
                      <p className="text-sm text-muted">
                        {seat.role === "dm" ? "Review inbox" : "Properties"}
                      </p>
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div className="quick-actions mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {seat.role === "dm" ? (
                <Link to="/party" search={{ action: "add" }} className="quick-action primary">
                  <Plus className="size-4" />
                  Add loot
                </Link>
              ) : (
                <Link to="/" search={{ view: "sheet" }} className="quick-action primary">
                  <Package className="size-4" />
                  Your inventory
                </Link>
              )}
              {seat.role === "dm" ? (
                <AppLink href="/features/bank?from=%2F" className="quick-action">
                  <ScrollText className="size-4" />
                  Review requests
                </AppLink>
              ) : (
                <Link to="/party" search={{ action: "give" }} className="quick-action">
                  <ArrowUpRight className="size-4" />
                  Give
                </Link>
              )}
              <Link to="/market" search={{ book: "" }} className="quick-action">
                <Store className="size-4" />
                {seat.role === "dm" ? "Manage shops" : "Browse market"}
              </Link>
              <Link
                to={seat.role === "dm" ? "/settings" : "/party"}
                search={seat.role === "dm" ? undefined : { action: "" }}
                className="quick-action"
              >
                <SlidersHorizontal className="size-4" />
                {seat.role === "dm" ? "Economy rules" : "Your party"}
              </Link>
            </div>
          </OverviewSection>
          <OverviewSection
            embedded={embedded}
            title="Activity & balances"
            hint="Recent transactions, review queue, account balances and messages."
          >
            {embedded && <DesktopDeskPanels />}
            <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
              {(!embedded || !desktop) && (
                <section className="min-w-0">
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <span className="text-sm text-faint">Latest transactions</span>
                  </div>
                  {recent.length === 0 ? (
                    <EmptyState
                      title="No transactions yet"
                      body="Record a payment or trade at a shop to see your activity."
                      action={
                        <Link
                          to="/party"
                          search={{ action: "pay" }}
                          className="inline-flex min-h-11 items-center gap-2 text-sm text-lead"
                        >
                          <Plus className="size-4" />
                          Record a payment
                        </Link>
                      }
                    />
                  ) : (
                    <ul className="activity-list">
                      {recent.map((line) => (
                        <li key={line.id} className="activity-row">
                          <span className="activity-icon">
                            {line.copper >= 0 ? (
                              <ArrowDownLeft className="size-4" />
                            ) : (
                              <ArrowUpRight className="size-4" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{line.summary}</span>
                            <span className="text-sm text-faint">
                              {purses.find((purse) => purse.id === line.purseId)?.name} ·{" "}
                              {when(line.at)}
                            </span>
                          </span>
                          <MoneyLine
                            copper={line.copper}
                            label={formatCopper(Math.abs(line.copper))}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              <section className="min-w-0">
                <div className="section-heading">
                  <h2>{seat.role === "dm" ? "Party funds" : "Your funds"}</h2>
                  <Link to="/party" className="text-sm text-lead">
                    View all
                  </Link>
                </div>
                {mine.length === 0 ? (
                  <EmptyState
                    title="No account assigned"
                    body="Your character’s coins will appear when an account is assigned."
                  />
                ) : (
                  <ul className="purse-list">
                    {mine.slice(0, 6).map((purse) => (
                      <li key={purse.id}>
                        <Link
                          to="/party"
                          search={{ action: "" }}
                          className="flex min-h-16 items-center gap-3 border-b border-border/50 py-3"
                        >
                          <LedgerArt kind="portrait" src={purse.portrait} className="round" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{purse.name}</span>
                            <span className="text-xs text-faint">
                              {purse.kind === "party" ? "Shared fund" : "Character"}
                            </span>
                          </span>
                          <span className="text-sm tabular-nums text-lead">
                            {formatCoins(purse.coins)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {messages.length > 0 ? (
                  <Link to="/share" className="mt-4 block rounded-xl border border-lead/20 p-4">
                    <p className="eyebrow">Latest message</p>
                    <p className="mt-2 truncate text-sm">{messages[0]?.text}</p>
                  </Link>
                ) : null}
              </section>
            </div>
          </OverviewSection>
        </>
      ) : null}
      {seat.role === "player" && mine.find((p) => p.kind === "character") ? (
        <Link to="/" search={{ view: "sheet" }} className="character-link">
          <LedgerArt kind="portrait" src={mine.find((p) => p.kind === "character")?.portrait} />
          <span>
            <strong>Your character sheet</strong>
            <small>
              {mine.find((p) => p.kind === "character")?.name} ·{" "}
              {sheets.find((s) => s.purseId === mine.find((p) => p.kind === "character")?.id)
                ?.classLevel || "Character & handouts"}
            </small>
          </span>
        </Link>
      ) : null}
      <Link to="/share" className="connection-link">
        Multiplayer · Room, chat & connection status →
      </Link>
      <div id="journal">
        <CampaignJournal section={embedded ? "sessions" : "overview"} />
      </div>
      <Fold title="Campaign tools" hint="Multiplayer, display options, and this campaign.">
        <Link to="/share" className="quick-action primary">
          Open Multiplayer — host or join a room
        </Link>

        <div className="mt-3">
          <Switch
            checked={prefs.showDollars}
            onChange={(on) => setPrefs({ showDollars: on })}
            label="Show dollars"
            hint="A estimated dollar equivalent beside the coins."
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link
            to="/settings"
            className="inline-flex min-h-11 items-center rounded-xl border border-lead/40 px-3"
          >
            Settings
          </Link>
          <Link
            to="/share"
            className="inline-flex min-h-11 items-center rounded-xl border border-lead/40 px-3"
          >
            Multiplayer
          </Link>
          {seat.role === "dm" ? (
            <Button
              variant="secondary"
              onClick={() =>
                void download().catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Could not export backup."),
                )
              }
            >
              Download copy
            </Button>
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
        body={file ? `${file.name} replaces the open campaign in this browser on this device.` : ""}
        confirmLabel="Restore"
        onConfirm={() => {
          if (!file) return;
          void restoreFile(file)
            .then(() => reload())
            .catch((error: unknown) =>
              toast.error(
                error instanceof Error ? error.message : "That copy could not be restored.",
              ),
            );
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
