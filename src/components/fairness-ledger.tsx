/**
 * Party → Fairness (future-development prompt 2, phase 3; mockups approved by the owner on
 * 2026-10-24). A read-only view of the loot each party character has received, per session and
 * campaign to date, with a breakdown of the receipts behind each total. Everything is derived by
 * loot-fairness.ts from the table this seat already has (its own projection for players).
 */
import { useMemo, type ReactNode } from "react";
import { Coins, Gem, Minus, RotateCcw, Swords } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { LedgerArt } from "@/components/ledger-art";
import { EmptyState } from "@/components/terminal";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { partyFunds } from "@/lib/quire/coin-split";
import { pooledLots } from "@/lib/quire/loot-claims";
import { formatCopper, toCopper } from "@/lib/quire/money";
import {
  fairnessLedger,
  fairnessReceipts,
  roundGap,
  type FairnessView,
  type FairPeriod,
  type FairReceipt,
  type FairRow,
  type FairTable,
  type FairViewer,
} from "@/lib/quire/loot-fairness";
import "./fairness-ledger.css";

const selectClass = "min-h-11 w-full rounded-sm border border-border bg-subtle px-3 text-base text-fg";

/** The seat's own table and viewer (players: their projection; the DM: the campaign). */
export function useFairness(): { table: FairTable; viewer: FairViewer; ready: boolean } {
  const economy = useEconomy();
  const seat = useSeat();
  const table = useMemo(
    () => ({ purses: economy.purses, ledger: economy.ledger, journal: economy.journal }),
    [economy.purses, economy.ledger, economy.journal],
  );
  const viewer = useMemo(
    () => ({ dm: seat.role === "dm", purseIds: seat.role === "dm" ? [] : seat.purseIds }),
    [seat.role, seat.purseIds],
  );
  return { table, viewer, ready: economy.ready };
}

const first = (name: string) => name.split(" ")[0] ?? name;
const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
function gapText(row: Pick<FairRow, "gap">) {
  if (!row.gap) return null;
  const g = roundGap(row.gap);
  if (g === 0) return <b className="even">level with the average</b>;
  return <b className={g < 0 ? "behind" : "ahead"}>{formatCopper(Math.abs(g))} {g < 0 ? "behind" : "ahead"}</b>;
}
function GapBar({ row, scale }: { row: FairRow; scale: number }) {
  const g = row.gap ? row.gap.num / row.gap.den : 0;
  const width = g === 0 || !scale ? 0 : Math.max(2, Math.round((Math.abs(g) / scale) * 500) / 10);
  return (
    <span className="fair-gapbar" aria-hidden="true">
      {width > 0 && <i className={g < 0 ? "behind" : "ahead"} style={{ width: `${width}%` }} />}
    </span>
  );
}
const periodHref = (period: string, character?: string) =>
  `/party?section=fairness${period !== "campaign" ? `&period=${encodeURIComponent(period)}` : ""}${character ? `&character=${encodeURIComponent(character)}` : ""}`;

function PeriodSelect({ view, onPeriod, links }: { view: FairnessView; onPeriod: (p: string) => void; links?: ReactNode }) {
  const sessions = view.periods.filter((p) => p.number !== null).reverse();
  const between = view.periods.find((p) => p.key === "between");
  return (
    <div className="fair-period">
      <label>
        Period
        <select className={selectClass} value={view.period} onChange={(e) => onPeriod(e.target.value)} aria-label="Period">
          <option value="campaign">
            Campaign to date
            {view.fromSession ? ` · from Session ${view.fromSession}` : ` · ${view.sessionCount} session${view.sessionCount === 1 ? "" : "s"}`}
          </option>
          {sessions.map((p) => (
            <option key={p.key} value={p.key} disabled={!!p.unavailable}>
              {p.label}
              {p.inProgress ? " (in progress)" : p.unavailable === "unreadable" ? " (cannot be read)" : p.unavailable ? " (not available to you)" : ""}
            </option>
          ))}
          {between && <option value="between">Between sessions</option>}
        </select>
      </label>
      {links}
    </div>
  );
}

function periodName(view: FairnessView): string {
  if (view.period === "campaign") return "campaign to date";
  const p = view.periods.find((x) => x.key === view.period);
  if (!p) return "campaign to date";
  return p.number ? `Session ${p.number}${p.inProgress ? " (in progress)" : ""}` : p.label;
}

/** Party → Fairness: the table, or one character's breakdown. */
export function FairnessLedger({
  period,
  character,
  onPeriod,
}: {
  period: string;
  character?: string;
  onPeriod: (period: string) => void;
}) {
  const { table, viewer, ready } = useFairness();
  const economy = useEconomy();
  const view = useMemo(() => fairnessLedger(table, viewer, period), [table, viewer, period]);
  // Nothing handed out yet, campaign to date (design plan P10): explain instead of zero rows.
  const campaign = useMemo(
    () => (period === "campaign" ? view : fairnessLedger(table, viewer, "campaign")),
    [period, view, table, viewer],
  );
  if (!ready) return <p className="mt-6 text-muted">Loading…</p>;
  const all = [...view.rows, ...view.others];
  if (character && all.some((r) => r.purseId === character))
    return <Breakdown table={table} viewer={viewer} view={view} purseId={character} onPeriod={onPeriod} />;
  const portrait = (id: string) => economy.purses.find((p) => p.id === id)?.portrait;
  const away = !viewer.dm && !view.compared;
  const behind = view.rows[0] && view.rows[0].gap && view.rows[0].gap.num < 0 ? view.rows[0] : null;
  const scale = Math.max(1, ...view.rows.map((r) => (r.gap ? Math.abs(r.gap.num / r.gap.den) : 0)));
  const funds = viewer.dm || view.compared ? partyFunds(table) : [];
  const lots = viewer.dm || view.compared ? pooledLots({ ...table, holdings: economy.holdings }) : [];
  const undivided =
    funds.length || lots.length
      ? [
          ...funds.map((f) => `${f.name}: ${formatCopper(toCopper(f.coins))}`),
          ...(lots.length
            ? [`${lots.reduce((s, h) => s + h.quantity, 0)} pool items (${formatCopper(lots.reduce((s, h) => s + h.quantity * h.unitCopper, 0))})`]
            : []),
        ].join(" · ")
      : "";
  const mineUnvalued = view.unvalued.filter((u) => viewer.purseIds.includes(u.purseId)).reduce((s, u) => s + u.units, 0);
  const allUnvalued = view.unvalued.reduce((s, u) => s + u.units, 0);
  const rowLink = (r: FairRow) => periodHref(view.period, r.purseId);
  const label = periodName(view);
  const nothingYet =
    campaign.sum === 0 &&
    campaign.unvalued.length === 0 &&
    [...campaign.rows, ...campaign.others].every((r) => r.total === 0) &&
    view.unreadable === 0;
  if (nothingYet && all.length > 0)
    return (
      <div className="fair-ledger" id="fairness">
        <div className="mt-4">
          <EmptyState
            title="No loot handed out yet"
            body="Coin splits, encounter awards and treasure-pool results will appear here, with each character's total and the gap to the party average."
            action={
              <span className="flex flex-col items-center gap-1 text-sm">
                <a href="#what-counts">What counts?</a>
                {undivided ? <span className="text-muted">Still undivided: {undivided}</span> : null}
              </span>
            }
          />
        </div>
        <WhatCounts />
      </div>
    );
  return (
    <div className="fair-ledger" id="fairness">
      <PeriodSelect
        view={view}
        onPeriod={onPeriod}
        links={
          viewer.dm ? (
            <span className="fair-links">
              <a href="#what-counts">What counts?</a>
            </span>
          ) : null
        }
      />
      {view.unreadable > 0 && (
        <div className="loot-warn" role="note">
          {view.unreadable} archived session{view.unreadable === 1 ? "" : "s"} could not be read, so {view.unreadable === 1 ? "its" : "their"} receipts are not in these totals. Keep the original backup for recovery.
        </div>
      )}
      <section className="wealth-card fair-card mt-4 rounded-2xl border border-lead/25 bg-elevated p-5">
        <p className="text-xs tracking-[0.16em] text-faint uppercase">
          {away ? "Your loot received" : "Loot received"} · {label}
        </p>
        <p className="mt-1 font-display text-3xl tracking-tight text-lead">{formatCopper(view.sum)}</p>
        <div className="fair-summary">
          <span>
            <span>Coins</span>
            {formatCopper(view.coins)}
          </span>
          <span>
            <span>Items at recorded value</span>
            {formatCopper(view.items)}
          </span>
          {view.compared && (
            <span>
              <span>
                {view.period === "campaign" || view.period === "between" ? "Party" : "Session"} average ({view.n} character{view.n === 1 ? "" : "s"})
              </span>
              {formatCopper(Math.round(view.sum / view.n))}
            </span>
          )}
          {behind && (
            <span>
              <span>Furthest behind</span>
              {first(behind.name)} · {formatCopper(Math.abs(roundGap(behind.gap!)))}
            </span>
          )}
          {undivided && (
            <span className="fair-wide">
              <span>Still undivided</span>
              {undivided}
            </span>
          )}
        </div>
      </section>
      {all.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No party characters yet. Totals appear here once characters receive coin splits, encounter awards or treasure-pool items.
        </p>
      ) : (
        <div className={`fair-table${viewer.dm ? "" : " is-player"}`} role="table" aria-label="Loot received per character">
          <div className="fair-head" role="row">
            <span role="columnheader">Character</span>
            <span role="columnheader">Coins</span>
            <span role="columnheader">Items</span>
            <span role="columnheader">Total</span>
            <span role="columnheader">Gap against the average</span>
          </div>
          {view.rows.map((r) => (
            <Row key={r.purseId} row={r} href={rowLink(r)} portrait={portrait(r.purseId)} scale={scale} />
          ))}
          {view.compared && (
            <div className="fair-avg">
              <span>
                {view.period === "campaign" || view.period === "between" ? "Party" : "Session"} average, {view.n} character{view.n === 1 ? "" : "s"}{" "}
                {view.period === "campaign" || view.period === "between" ? "in the party" : "in that session's party"} (rounded to the nearest copper)
              </span>
              <b>{formatCopper(Math.round(view.sum / view.n))}</b>
            </div>
          )}
          {view.others.length > 0 && (
            <>
              {view.compared && <div className="fair-sub">{viewer.dm ? "Away from the party · not in the average" : "Not compared"}</div>}
              {view.others.map((r) => (
                <Row key={r.purseId} row={r} href={rowLink(r)} portrait={portrait(r.purseId)} scale={scale} />
              ))}
            </>
          )}
        </div>
      )}
      {viewer.dm && allUnvalued > 0 && (
        <div className="loot-warn">
          {allUnvalued} item{allUnvalued === 1 ? "" : "s"} from older encounter awards {allUnvalued === 1 ? "has" : "have"} no recorded value and count{allUnvalued === 1 ? "s" : ""} as 0 cp (
          {view.unvalued.map((u) => `${first(all.find((r) => r.purseId === u.purseId)?.name ?? "")} ${u.units}`).join(", ")}). They were awarded before values were recorded.{" "}
          <AppLink href={periodHref(view.period, view.unvalued[0]!.purseId)}>
            See them in {first(all.find((r) => r.purseId === view.unvalued[0]!.purseId)?.name ?? "the")}'s receipts
          </AppLink>
          .
        </div>
      )}
      {away ? (
        <div className="loot-callout mt-3">
          While you are away from the party you see only your own totals and receipts. The party's totals and the average come back when the DM brings you back to the party.
        </div>
      ) : (
        <div className="fair-foot">
          <p>Sorted by total, lowest first. Tap a character for the receipts behind their total.</p>
          {!viewer.dm && (
            <p>
              Everyone travelling with the party sees these totals.
              {mineUnvalued > 0 ? ` ${mineUnvalued} of your items ${mineUnvalued === 1 ? "has" : "have"} no recorded value and count as 0 cp.` : ""}
              {view.fromSession ? ` Your totals start at Session ${view.fromSession}, the first session you were part of.` : ""}{" "}
              <a href="#what-counts">What counts?</a>
            </p>
          )}
          {viewer.dm && (
            <p>
              <strong>Not counted:</strong> NPCs, party funds and the treasure pool. <span className="loot-pill dm">DM only</span>
            </p>
          )}
        </div>
      )}
      <WhatCounts />
    </div>
  );
}

function Row({ row, href, portrait, scale }: { row: FairRow; href: string; portrait?: string; scale: number }) {
  const notes = [
    row.status === "away" ? "Away from the party" : row.status === "former" ? "Former character" : "",
    row.joined ? `Joined in Session ${row.joined}` : "",
    row.unvalued ? `${row.unvalued} item${row.unvalued === 1 ? "" : "s"} without a recorded value` : "",
  ].filter(Boolean);
  const g = row.gap ? roundGap(row.gap) : null;
  return (
    <AppLink
      href={href}
      className={`fair-row${row.mine ? " is-you" : ""}${row.status !== "party" ? " is-away" : ""}`}
      role="row"
      aria-label={`${row.name}: total ${formatCopper(row.total)}${g === null ? "" : g === 0 ? ", level with the average" : `, ${formatCopper(Math.abs(g))} ${g < 0 ? "behind" : "ahead of"} the average`}`}
    >
      <span className="who" role="cell">
        <span className="fair-av" aria-hidden="true">
          <LedgerArt kind="portrait" src={portrait} />
        </span>
        <span>
          <strong>
            {row.name}
            {row.mine && <span className="fair-you">You</span>}
          </strong>
          {notes.length > 0 && <small>{notes.join(" · ")}</small>}
        </span>
      </span>
      <span className="n coins" role="cell">
        <small>Coins</small>
        {formatCopper(row.coins)}
      </span>
      <span className="n items" role="cell">
        <small>Items</small>
        {formatCopper(row.items)}
      </span>
      <span className="n total" role="cell">
        <small>Total</small>
        {formatCopper(row.total)}
      </span>
      <span className="gap" role="cell">
        <span className="lbl">Gap against the average</span>
        {row.gap ? (
          <>
            {gapText(row)}
            <GapBar row={row} scale={scale} />
          </>
        ) : (
          <span className="text-sm text-muted">{row.status === "away" && row.mine ? "shown when you rejoin" : row.status === "former" ? "not compared" : "not compared while away"}</span>
        )}
      </span>
    </AppLink>
  );
}

const ICONS: Record<FairReceipt["kind"] | "void" | "other", ReactNode> = {
  "fund-split": <Coins aria-hidden="true" />,
  "encounter-split": <Swords aria-hidden="true" />,
  "encounter-coins": <Swords aria-hidden="true" />,
  "encounter-item": <Swords aria-hidden="true" />,
  pool: <Gem aria-hidden="true" />,
  void: <RotateCcw aria-hidden="true" />,
  other: <Minus aria-hidden="true" />,
};

function receiptLink(r: { receiptId?: string; kind?: FairReceipt["kind"] }, period: FairPeriod | undefined, dm: boolean): { href: string; label: string } {
  if (period && !period.live && period.key !== "between")
    return { href: dm ? "/features/reports" : "/features/journal", label: `Open in ${period.number ? `Session ${period.number}` : "its session"} report` };
  if (dm && r.receiptId && (r.kind === "fund-split" || r.kind === "encounter-split"))
    return { href: `/features/reports#split-${r.receiptId}`, label: "Open in Activity" };
  if (dm && r.receiptId && r.kind === "pool") return { href: `/features/reports#loot-${r.receiptId}`, label: "Open in Activity" };
  return { href: dm ? "/features/reports" : "/features/finances", label: "Open in Activity" };
}

function Breakdown({
  table,
  viewer,
  view,
  purseId,
  onPeriod,
}: {
  table: FairTable;
  viewer: FairViewer;
  view: FairnessView;
  purseId: string;
  onPeriod: (period: string) => void;
}) {
  const economy = useEconomy();
  const row = [...view.rows, ...view.others].find((r) => r.purseId === purseId)!;
  const { groups, others } = useMemo(() => fairnessReceipts(table, viewer, purseId, view.period), [table, viewer, purseId, view.period]);
  const g = row.gap ? roundGap(row.gap) : null;
  const label = periodName(view);
  const sessionAverage = view.period !== "campaign" && view.period !== "between";
  const name = first(row.name);
  return (
    <div className="fair-ledger" id="fairness">
      <AppLink className="fair-back" href={periodHref(view.period)}>
        ← Fairness
      </AppLink>
      <section className="wealth-card fair-card rounded-2xl border border-lead/25 bg-elevated p-5">
        <div className="fair-char-head">
          <span className="fair-av lg" aria-hidden="true">
            <LedgerArt kind="portrait" src={economy.purses.find((p) => p.id === purseId)?.portrait} />
          </span>
          <div>
            <p className="eyebrow">Loot received · {label}</p>
            <h2 className="font-display text-2xl">{row.name}</h2>
          </div>
        </div>
        <p className="mt-1 font-display text-3xl tracking-tight text-lead">{formatCopper(row.total)}</p>
        <div className="fair-summary">
          <span>
            <span>Coins</span>
            {formatCopper(row.coins)}
          </span>
          <span>
            <span>Items at recorded value</span>
            {formatCopper(row.items)}
          </span>
          {view.compared && row.gap && (
            <>
              <span>
                <span>{sessionAverage ? "Session average" : "Party average"}</span>
                {formatCopper(Math.round(view.sum / view.n))}
              </span>
              <span>
                <span>Gap</span>
                {g === 0 ? <b>level</b> : <b className={g! < 0 ? "fair-behind" : "fair-ahead"}>{formatCopper(Math.abs(g!))} {g! < 0 ? "behind" : "ahead"}</b>}
              </span>
            </>
          )}
        </div>
      </section>
      <PeriodSelect view={view} onPeriod={onPeriod} />
      {groups.length === 0 && <p className="mt-4 text-sm text-muted">No counted receipts for {row.name} in this period.</p>}
      {groups.map(({ period, receipts }) => {
        const coins = receipts.reduce((s, r) => s + r.coins, 0);
        const items = receipts.reduce((s, r) => s + r.items, 0);
        return (
          <details className="loot-pool-fold fair-sess" open key={period.key}>
            <summary>
              <strong>{period.number ? `Session ${period.number} · ${period.label.replace(/^Session \d+ · /, "")}` : period.label}</strong>
              <span className="num">
                {period.inProgress ? "In progress · " : ""}
                {formatCopper(coins + items)}
              </span>
            </summary>
            <ul className="fair-rc-list">
              {receipts.map((r) => {
                const link = receiptLink(r, period, viewer.dm);
                const cls = r.reversalOf ? " is-void" : r.reversedBy ? " is-reversed" : r.unvalued > 0 && r.items === 0 ? " is-unvalued" : "";
                return (
                  <li className={`fair-rc${cls}`} key={r.lineId}>
                    <span className="ic">{ICONS[r.reversalOf ? "void" : r.kind]}</span>
                    <span className="t">
                      <strong>{r.label}</strong>
                      <small>
                        {when(r.at)} · {r.detail}
                      </small>
                      <AppLink href={link.href}>{link.label} →</AppLink>
                    </span>
                    <span className={`amt coins${r.coins ? "" : " zero"}`}>
                      <small>Coins</small>
                      <span>{r.coins ? formatCopper(r.coins) : "—"}</span>
                    </span>
                    <span className={`amt items${r.items ? "" : " zero"}`}>
                      <small>Items</small>
                      <span>{r.unvalued > 0 && r.items === 0 ? "value not recorded · 0 cp" : r.items ? formatCopper(r.items) : "—"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="fair-rc-sub">
              <span>Subtotal</span>
              <b>{formatCopper(coins)}</b>
              <b>{formatCopper(items)}</b>
            </div>
          </details>
        );
      })}
      {groups.length > 0 && (
        <div className="fair-foot">
          <p>
            Total of the receipts above: {formatCopper(row.coins)} in coins + {formatCopper(row.items)} in items = <strong>{formatCopper(row.total)}</strong>. It matches the Fairness tab because both read the same lines.
          </p>
        </div>
      )}
      {others && others.length > 0 && (
        <details className="loot-pool-fold" open>
          <summary>
            <span>Also on {name}'s ledger, not counted</span>
            <span>
              {others.length} line{others.length === 1 ? "" : "s"}
            </span>
          </summary>
          <ul className="fair-rc-list">
            {others.map((o) => {
              const p = view.periods.find((x) => x.key === o.period);
              const link = receiptLink({}, p, viewer.dm);
              return (
                <li className="fair-rc" key={o.lineId}>
                  <span className="ic">{ICONS.other}</span>
                  <span className="t">
                    <strong>{o.summary}</strong>
                    <small>
                      {p?.number ? `Session ${p.number}` : when(o.at)} · {o.reason}
                    </small>
                    <AppLink href={link.href}>{link.label} →</AppLink>
                  </span>
                  <span className="amt coins zero">
                    <small>Coins</small>
                    <span>{o.copper ? formatCopper(o.copper) : "—"}</span>
                  </span>
                  <span className="amt items zero">
                    <small>Items</small>
                    <span>—</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="px-4 pb-3 text-sm text-muted">
            Shown to the DM and to {name}'s own player only. Other party members see the counted receipts above.
          </p>
        </details>
      )}
      {!viewer.dm && !viewer.purseIds.includes(purseId) && (
        <p className="mt-2 text-sm text-muted">
          You see {name}'s counted receipts because you both travel with the party. Their purchases, gifts and wages are not listed here.
        </p>
      )}
      <WhatCounts details />
    </div>
  );
}

/** The "What counts?" explainer (owner decisions, 2026-10-24). */
export function WhatCounts({ details = false }: { details?: boolean }) {
  return (
    <details className="loot-pool-fold" id="what-counts">
      <summary>
        <span>What counts?</span>
        <span>Coins and items received as loot</span>
      </summary>
      <div className="loot-pool-fold-body">
        <div className="fair-counts">
          <section className="yes">
            <h3>Counts</h3>
            <ul>
              <li>
                <strong>Coin splits</strong>: each character's share, and leftover copper a character was given. Splits from a party fund or an encounter only.
              </li>
              <li>
                <strong>Encounter awards</strong>: coins sent to a character (one purse or split) and items given straight to a character, at the value set in the loot review.
              </li>
              <li>
                <strong>Treasure pool resolutions</strong>: each item awarded, at its value when the DM resolved it. This includes "DM's choice" awards.
              </li>
              <li>
                <strong>Reversals</strong> of any of these subtract what they cancel.
              </li>
            </ul>
          </section>
          <section className="no">
            <h3>Does not count</h3>
            <ul>
              <li>Purchases, sales, trades, NPC barter and exchange offers.</li>
              <li>Give between characters, and splitting a character's own coins (that loot was already counted once).</li>
              <li>Wages, loans, payments, downtime income and DM coin adjustments.</li>
              <li>Items recorded with Add loot or edited on a sheet.</li>
              <li>Party funds, the treasure pool itself, NPCs and characters away from the party.</li>
            </ul>
          </section>
        </div>
        <p className="mt-2 text-sm text-muted">
          Values are the ones recorded at the time: a potion claimed at 50 gp stays 50 gp even if its price changes later. Older encounter items that were awarded before values were recorded count as 0 cp and are listed so you can see them. Nothing here moves money or items; it reads the receipts you already have.
        </p>
        {details && (
          <>
            <h3 className="mt-3 font-display text-lg">The gap</h3>
            <p className="text-sm">
              The gap compares a character's total with the average of everyone currently travelling with the party, for the same period. A character who joined later starts behind for "Campaign to date"; choose a single session to compare like with like (its average uses that session's party).
            </p>
            <h3 className="mt-3 font-display text-lg">Who sees what</h3>
            <ul className="text-sm">
              <li>DM: every party character, characters away from the party (not compared), former characters and the not-counted lines.</li>
              <li>Players travelling with the party: every party character's totals and counted receipts; their own not-counted lines.</li>
              <li>A player away from the party: only their own totals and receipts.</li>
              <li>NPCs and party funds never appear.</li>
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

/** One line for the treasure pool's summary card: who is furthest behind, campaign to date. */
export function FurthestBehindLine() {
  const { table, viewer, ready } = useFairness();
  const view = useMemo(() => (ready ? fairnessLedger(table, viewer, "campaign") : null), [table, viewer, ready]);
  if (!view || view.n < 2) return null;
  const row = view.rows[0]!;
  if (!row.gap || row.gap.num >= 0) return null;
  return (
    <p className="mt-2 text-sm">
      Fairness, campaign to date: {first(row.name)} is furthest behind ({formatCopper(Math.abs(roundGap(row.gap)))}).{" "}
      <AppLink href="/party?section=fairness">Open Fairness →</AppLink>
    </p>
  );
}
