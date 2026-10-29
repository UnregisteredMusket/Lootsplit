import { HistoryCoverage, useRoomHistory } from "./history-loader";
import { historyIncomplete, loadAllHistory } from "@/lib/quire/room-history";
/**
 * Party treasure pool and item claims (future-development prompt 2, phase 2; mockups approved
 * by the owner on 2026-10-23). The Party → Treasure pool tab, the Review Inbox section and the
 * pool history. Every change goes through one `loot-*` command (economy-context.tsx); claims
 * never move items, and only the DM's resolution does.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppLink } from "@/components/app-link";
import { Button } from "@/components/ui";
import { toast } from "sonner";
import { requestConfirm } from "@/lib/quire/confirm-store";
import { LedgerArt } from "@/components/ledger-art";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { usePrefs } from "@/lib/quire/prefs";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { seatInParty } from "@/lib/quire/character-position";
import { isNpc, recipientProblem } from "@/lib/quire/coin-split";
import { formatCopper } from "@/lib/quire/money";
import {
  CHOICE_LABEL,
  METHOD_LABEL,
  claimSummary,
  lootClaimants,
  lootFingerprint,
  lotClaims,
  planLootResolution,
  poolFunds,
  pooledLots,
  readLootClaims,
  type LootPlan,
  type LootRoll,
  type LootTable,
} from "@/lib/quire/loot-claims";
import type { FavourBasis, LootChoice, LootMethod } from "@/lib/quire/loot-claims-schema";
import { FurthestBehindLine, useFairness } from "@/components/fairness-ledger";
import { fairnessLedger, fairnessStandings, roundGap } from "@/lib/quire/loot-fairness";
import type { Holding, Purse } from "@/lib/quire/types";
import type { Journal } from "@/lib/quire/journal";

const CHOICES: Array<{ choice: LootChoice; hint: string }> = [
  { choice: "need", hint: "I'll use it" },
  { choice: "greed", hint: "I'd take it" },
  { choice: "pass", hint: "Not for me" },
];
type Event = Journal["events"][number];

function useLootTable(): LootTable & { ready: boolean } {
  const economy = useEconomy();
  return useMemo(
    () => ({
      purses: economy.purses,
      holdings: economy.holdings,
      journal: economy.journal as LootTable["journal"],
      ready: economy.ready,
    }),
    [economy.purses, economy.holdings, economy.journal, economy.ready],
  );
}
const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const nameOf = (t: LootTable, id: string) => t.purses.find((p) => p.id === id)?.name ?? "A character";
function lotSource(t: LootTable, h: Holding): string {
  if (h.pool?.source === "encounter") {
    const event = (t.journal?.events ?? []).find((e) => e.lootPool?.holdingId === h.id);
    const name = event?.summary.match(/^Added to the treasure pool from (.+): /)?.[1];
    return name ? `From encounter: ${name}` : "From an encounter award";
  }
  return "Added by the DM";
}
function Pill({ choice }: { choice: LootChoice | "dm" | "none" | "won"; children?: ReactNode }) {
  return (
    <span className={`loot-pill ${choice}`}>
      {choice === "none" ? "Not yet" : choice === "won" ? "Won" : CHOICE_LABEL[choice]}
    </span>
  );
}

/** Lots in the pool for the Party tab's count (what this seat can see). */
export function usePoolCount(): number {
  const t = useLootTable();
  return pooledLots(t).length;
}

/** Party → Treasure pool. */
export function TreasurePool({ onAddLoot, onAddFund }: { onAddLoot?: () => void; onAddFund?: () => void }) {
  const t = useLootTable();
  const seat = useSeat();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const dm = seat.role === "dm";
  const [view, setView] = useState<"pool" | "history">("pool");
  const [filter, setFilter] = useState<"all" | "unmarked" | "need">("all");
  if (!t.ready) return <p className="mt-6 text-muted">Loading…</p>;
  const funds = poolFunds(t);
  const lots = pooledLots(t);
  const claimants = lootClaimants(t);
  const mine = claimants.filter((p) => seat.purseIds.includes(p.id));
  // A player-only device link holds part of the party: the pool is shown read-only there.
  const readOnly = !dm && !cloud.joined;
  const inParty = dm || seatInParty(t, seat);
  const state = readLootClaims(t);
  const units = lots.reduce((sum, h) => sum + h.quantity, 0);
  const value = lots.reduce((sum, h) => sum + h.quantity * h.unitCopper, 0);
  const myChoice = (h: Holding) => state.claims.find((c) => c.holdingId === h.id && c.purseId === mine[0]?.id)?.choice;
  const ready = lots.filter((h) => lotClaims(t, h.id, state).some((c) => c.choice !== "pass"));
  const unmarked = lots.filter((h) => lotClaims(t, h.id, state).length < claimants.length);
  const shown = lots.filter((h) =>
    filter === "unmarked" ? !myChoice(h) : filter === "need" ? myChoice(h) === "need" : true,
  );
  const fundLabel = funds.length ? funds.filter((f) => lots.some((h) => h.purseId === f.id)).map((f) => f.name).join(", ") || funds[0]!.name : "";

  if (!funds.length && !lots.length)
    return (
      <div className="loot-pool" id="treasure-pool">
        <div className="loot-callout">
          The treasure pool lives in a party fund. This campaign has none, so the pool is not available.
          {dm && onAddFund ? (
            <>
              {" "}
              <button type="button" className="coin-split-link" onClick={onAddFund}>
                Add party fund
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  if (!inParty)
    return (
      <div className="loot-pool" id="treasure-pool">
        <div className="loot-callout">
          <strong>Away from the party.</strong> Rejoin the party to see and claim the treasure pool.
        </div>
        <LootHistory t={t} />
      </div>
    );
  return (
    <div className="loot-pool" id="treasure-pool">
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="mode-switch" role="tablist" aria-label="Treasure pool views">
          <button type="button" role="tab" aria-selected={view === "pool"} onClick={() => setView("pool")}>
            In the pool<span className="loot-count">{lots.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={view === "history"} onClick={() => setView("history")}>
            History
          </button>
        </div>
      </div>
      {view === "history" ? (
        <LootHistory t={t} />
      ) : (
        <>
          <section className="wealth-card mt-5 rounded-2xl border border-lead/25 bg-elevated p-5">
            <p className="text-xs tracking-[0.16em] text-faint uppercase">Treasure pool · {fundLabel}</p>
            <p className="mt-1 font-display text-3xl tracking-tight text-lead">
              {dm
                ? `${units} item${units === 1 ? "" : "s"} · ${ready.length} ready to resolve`
                : `${units} item${units === 1 ? "" : "s"} waiting`}
            </p>
            <div className="loot-pool-summary">
              <span>
                <span>Lots</span>
                {lots.length}
              </span>
              <span>
                <span>Recorded value</span>
                {formatCopper(value)}
              </span>
              {mine[0] ? (
                <span>
                  <span>Your claims ({mine[0].name.split(" ")[0]})</span>
                  {lots.filter((h) => myChoice(h)).length} of {lots.length} marked
                </span>
              ) : null}
            </div>
            {dm ? (
              <>
                <p className="mt-3 text-sm">
                  {ready.length} lot{ready.length === 1 ? " has" : "s have"} at least one Need or Greed.
                  {unmarked.length
                    ? ` ${unmarked.length} lot${unmarked.length === 1 ? " is" : "s are"} still waiting for claims; unmarked counts as Pass when you resolve.`
                    : ""}
                </p>
                <div className="loot-actions">
                  <AppLink className="btn-link gold-link" href="/features/review?from=%2Fparty">
                    Resolve claims in Review Inbox →
                  </AppLink>
                  {onAddLoot && (
                    <Button variant="secondary" onClick={onAddLoot}>
                      Add loot
                    </Button>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm">
                {readOnly
                  ? "On a player link the pool is read-only: your characters live on the DM's device. Ask the DM to mark your claims at the table."
                  : "Mark what you need, would take (Greed) or don't want (Pass). The DM decides; nothing moves until then. You can change a claim until the DM resolves the item."}
              </p>
            )}
            <FurthestBehindLine />
          </section>
          {!dm && mine.length > 0 && lots.length > 0 && (
            <div className="loot-chips" role="group" aria-label="Show">
              {(
                [
                  ["all", `All · ${lots.length}`],
                  ["unmarked", `Not marked by me · ${lots.filter((h) => !myChoice(h)).length}`],
                  ["need", `My Need · ${lots.filter((h) => myChoice(h) === "need").length}`],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" className="loot-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {!readOnly && (dm ? claimants.length > 0 : mine.length > 0) && lots.length > 0 ? (
            <ClaimAllPass t={t} lots={lots} options={dm ? claimants : mine} dm={dm} />
          ) : null}
          {!lots.length ? (
            <p className="mt-4 text-sm text-muted">
              The pool is empty. {dm ? "Add loot to a party fund with “Put in the treasure pool”, or send encounter items to the pool." : "When the DM adds treasure, it appears here for claims."}
            </p>
          ) : (
            <div className="loot-lots two">
              {shown.map((h) => (
                <LotCard key={h.id} t={t} h={h} mine={mine} readOnly={readOnly} />
              ))}
            </div>
          )}
          <p className="mt-3 text-sm text-muted">
            A claim for a stack is one claim for the whole stack; the DM hands units out one at a time. Companion NPCs
            don't claim; the DM can still give them items.
          </p>
          <RecentlyResolved t={t} />
        </>
      )}
    </div>
  );
}

/**
 * Q22: mark Pass on every lot not claimed yet (one claim each): a player's own characters, or the
 * character the DM is marking for at a table that shares one device.
 */
function ClaimAllPass({ t, lots, options, dm }: { t: LootTable; lots: Holding[]; options: Purse[]; dm: boolean }) {
  const economy = useEconomy();
  const state = readLootClaims(t);
  const [forId, setForId] = useState(options[0]?.id ?? "");
  const mine = dm ? options.filter((p) => p.id === forId).slice(0, 1) : options;
  const todo = lots.flatMap((h) =>
    mine
      .filter((p) => !lotClaims(t, h.id, state).some((c) => c.purseId === p.id))
      .map((p) => ({ h, p })),
  );
  const [busy, setBusy] = useState(false);
  // One command ID per run of unmarked claims; each claim derives its own, so a retry is applied once.
  const action = useCommandId(todo.map(({ h, p }) => `${h.id}:${p.id}`).join("|"));
  const lotsLeft = new Set(todo.map(({ h }) => h.id)).size;
  if (!todo.length && !dm) return null;
  return (
    <div className="loot-pass-all">
      {dm && options.length > 1 ? (
        <select
          aria-label="Pass for"
          value={forId}
          onChange={(e) => setForId(e.target.value)}
          className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      <Button
        variant="secondary"
        disabled={busy || !todo.length}
        onClick={async () => {
          const yes = await requestConfirm({
            title: `Pass on ${lotsLeft} unmarked lot${lotsLeft === 1 ? "" : "s"}?`,
            body: `Marks Pass for ${mine.map((p) => p.name).join(" and ")} on every lot not marked yet. Need and Greed already chosen stay.${dm ? " Recorded as marked by the DM." : ""} Claims can change until the item is resolved.`,
            confirmLabel: "Claim all as Pass",
          });
          if (!yes) return;
          setBusy(true);
          let done = 0;
          try {
            for (const [i, { h, p }] of todo.entries()) {
              const refusal = await economy.lootClaim(
                { holdingId: h.id, purseId: p.id, choice: "pass", before: null },
                { commandId: `${action.commandId}-${i}` },
              );
              if (refusal) {
                toast.error(`${h.name}: ${refusal}`);
                return;
              }
              done++;
            }
            action.renew();
            toast.success(`Marked Pass on ${done} claim${done === 1 ? "" : "s"}.`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Marking Pass…" : `Claim all as Pass · ${lotsLeft}`}
      </Button>
    </div>
  );
}

function LotCard({ t, h, mine, readOnly }: { t: LootTable; h: Holding; mine: Purse[]; readOnly: boolean }) {
  const economy = useEconomy();
  const seat = useSeat();
  const dm = seat.role === "dm";
  const claimants = lootClaimants(t);
  const options = dm ? claimants : mine;
  const [forId, setForId] = useState(options[0]?.id ?? "");
  const who = options.find((p) => p.id === forId) ?? options[0];
  const claims = lotClaims(t, h.id);
  const current = claims.find((c) => c.purseId === who?.id);
  const [pending, setPending] = useState<LootChoice | null>(null);
  const [error, setError] = useState("");
  const [busyOut, setBusyOut] = useState(false);
  // One command ID per (lot, character, prior claim); each choice derives its own from it, so a
  // retried click reuses its ID and a different choice is a different action.
  const action = useCommandId(`${h.id}|${who?.id}|${current?.choice ?? ""}`);
  const outAction = useCommandId(`out|${h.id}`);
  const shownChoice = pending ?? current?.choice ?? null;
  async function mark(choice: LootChoice) {
    if (!who || pending || readOnly) return;
    if (choice === current?.choice) return;
    setPending(choice);
    setError("");
    try {
      const refusal = await economy.lootClaim(
        { holdingId: h.id, purseId: who.id, choice, before: current?.choice ?? null },
        { commandId: `${action.commandId}-${choice}` },
      );
      if (refusal) setError(refusal);
      else action.renew();
    } finally {
      setPending(null);
    }
  }
  return (
    <article className={`loot-lot${!dm && who && !current ? " is-mine" : ""}`} aria-labelledby={`lot-${h.id}`}>
      <div className="loot-lot-head">
        <span className="loot-lot-icon" aria-hidden="true">
          <LedgerArt kind="item" src={h.image} entry={h} />
        </span>
        <span>
          <span className="loot-lot-title" id={`lot-${h.id}`}>
            {h.name}
          </span>
          <span className="loot-lot-meta">
            × {h.quantity} · {lotSource(t, h)} · {when(h.pool?.at ?? 0)}
            {dm ? ` · in ${nameOf(t, h.purseId)}` : ""}
          </span>
        </span>
        <span className="loot-lot-value">
          {h.quantity > 1 ? `${formatCopper(h.unitCopper)} each` : formatCopper(h.unitCopper)}
          <small>{h.quantity > 1 ? `${formatCopper(h.unitCopper * h.quantity)} total` : "recorded value"}</small>
        </span>
      </div>
      {h.notes && <p className="loot-lot-notes">“{h.notes}”</p>}
      {who && !readOnly ? (
        <>
          {/* Always one status line, so Need / Greed / Pass keep their place as claims update (Q22). */}
          {!dm ? (
            <p className="loot-status">{current ? `Your claim: ${CHOICE_LABEL[current.choice]}` : "● You haven't chosen yet"}</p>
          ) : null}
          <div className="loot-claim-for">
            {options.length > 1 ? (
              <label>
                {dm ? "Recording a claim for the table: " : "Claim for "}
                <select value={who.id} onChange={(e) => setForId(e.target.value)} aria-label="Claim for">
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>{dm ? `Recording a claim for ${who.name}` : `${who.name}'s claim`}</span>
            )}
            {/* Always present, so the row keeps its height as claims change (Q22). */}
            <span className="text-xs text-muted">{current ? `Changed ${when(current.at)}` : "Not marked yet"}</span>
          </div>
          <div className="loot-seg" role="radiogroup" aria-label={`${who.name}'s claim on ${h.name}`} aria-busy={!!pending}>
            {CHOICES.map(({ choice, hint }) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={shownChoice === choice}
                className={choice}
                disabled={!!pending}
                onClick={() => void mark(choice)}
              >
                {CHOICE_LABEL[choice]}
                <small>{hint}</small>
              </button>
            ))}
          </div>
          {pending && (
            <p className="loot-saving" role="status">
              <span className="coin-split-spinner" aria-hidden="true" />
              Saving your claim… (the choice stays selected; nothing else changes)
            </p>
          )}
          {dm && (
            <p className="mt-1 text-xs text-muted">
              Recorded as “marked by the DM for {who.name}”, for a table that shares one device.
            </p>
          )}
        </>
      ) : null}
      {error && (
        <div className="coin-split-alert mt-2" role="alert">
          <strong>Claim not saved.</strong>
          {error} Nothing changed.
        </div>
      )}
      {!claims.length ? (
        // Nobody has claimed yet: one line instead of a "Not yet" row per character (P10).
        <details className="loot-claims loot-claims-none">
          <summary className="loot-claims-title">
            No claims yet · {claimants.length} can claim
          </summary>
          <ul className="loot-claim-list">
            {claimants.map((p) => (
              <li key={p.id}>
                <span>
                  <span>
                    {p.name}
                    {seat.purseIds.includes(p.id) ? " (you)" : ""}
                  </span>
                </span>
                <Pill choice="none" />
              </li>
            ))}
          </ul>
        </details>
      ) : (
      <div className="loot-claims">
        <p className="loot-claims-title">
          Party claims · {claimSummary(t, h.id)}
        </p>
        <ul className="loot-claim-list">
          {claimants.map((p) => {
            const claim = claims.find((c) => c.purseId === p.id);
            return (
              <li key={p.id}>
                <span>
                  <span>
                    {p.name}
                    {seat.purseIds.includes(p.id) ? " (you)" : ""}
                  </span>
                  {claim?.by === "dm" ? <small className="text-muted">marked by the DM</small> : null}
                </span>
                <Pill choice={claim?.choice ?? "none"} />
              </li>
            );
          })}
        </ul>
      </div>
      )}
      {dm && (
        <div className="loot-actions">
          <Button
            variant="secondary"
            disabled={busyOut}
            onClick={async () => {
              setBusyOut(true);
              setError("");
              try {
                const refusal = await economy.lootPoolSet(h.id, false, { commandId: outAction.commandId });
                if (refusal) setError(refusal);
                else outAction.renew();
              } finally {
                setBusyOut(false);
              }
            }}
          >
            Take out of pool (keep in {nameOf(t, h.purseId)})
          </Button>
          <AppLink href={`/features/review?from=%2Fparty#loot-${h.id}`}>Resolve this item →</AppLink>
        </div>
      )}
    </article>
  );
}

/** Resolution receipts this seat can see, newest first. */
function receipts(t: LootTable): Event[] {
  return (t.journal?.events ?? []).filter((e) => e.lootResolution).sort((a, b) => b.at - a.at);
}
function RecentlyResolved({ t }: { t: LootTable }) {
  const rows = receipts(t).slice(0, 5);
  if (!rows.length) return null;
  return (
    <details className="loot-pool-fold">
      <summary>
        <span>Recently resolved · {rows.length}</span>
        <span>History in Activity →</span>
      </summary>
      <div className="loot-pool-fold-body">
        {rows.map((e) => (
          <ReceiptLines key={e.id} t={t} event={e} />
        ))}
      </div>
    </details>
  );
}
function ReceiptLines({ t, event }: { t: LootTable; event: Event }) {
  const r = event.lootResolution!;
  return (
    <div className="journal-entry">
      {r.lots.map((lot) =>
        lot.awards.map((a) => (
          <p key={`${lot.holdingId}-${a.purseId}`}>
            {lot.name} × {a.quantity} → <strong>{nameOf(t, a.purseId)}</strong> <Pill choice={a.choice} />
          </p>
        )),
      )}
      <small>
        {when(event.at)} · {METHOD_LABEL[r.method]}
        {r.rolls ? ` · ${r.rolls === "manual" ? "Pen & Paper rolls entered by the DM" : `${r.rolls === "server" ? "server" : "DM device"} rolls`}` : ""}
      </small>
    </div>
  );
}

/** Per-lot timelines built from the pool's journal events (claims, pool changes, receipts). */
export function LootHistory({ t }: { t: LootTable }) {
  const events = (t.journal?.events ?? []).filter((e) => e.lootClaim || e.lootPool || e.lootResolution);
  const lots = new Map<string, { name: string; rows: Event[]; resolved: boolean; quantity?: number }>();
  const touch = (id: string, name: string) => {
    const row = lots.get(id) ?? { name, rows: [], resolved: false };
    lots.set(id, row);
    return row;
  };
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    if (e.lootClaim) touch(e.lootClaim.holdingId, e.lootClaim.name).rows.push(e);
    else if (e.lootPool) {
      const row = touch(e.lootPool.holdingId, e.lootPool.name);
      row.rows.push(e);
      row.quantity ??= e.lootPool.quantity;
    } else
      for (const lot of e.lootResolution!.lots) {
        const row = touch(lot.holdingId, lot.name);
        row.rows.push(e);
        row.quantity ??= lot.poolQuantity;
        if (lot.kept === 0) row.resolved = true;
      }
  }
  if (!lots.size)
    return (
      <p className="mt-4 text-sm text-muted">
        No treasure-pool history in this session yet. Earlier sessions keep theirs in their session reports.
      </p>
    );
  return (
    <div className="loot-lots two">
      {[...lots].map(([id, lot]) => {
        const still = t.holdings.find((h) => h.id === id && h.pool);
        return (
          <article className="loot-lot" key={id}>
            <div className="loot-lot-head">
              <span className="loot-lot-icon" aria-hidden="true">
                <LedgerArt kind="item" />
              </span>
              <span>
                <span className="loot-lot-title">{lot.name}</span>
                <span className="loot-lot-meta">
                  {lot.quantity ? `× ${lot.quantity} · ` : ""}
                  {still ? "still in the pool" : lot.resolved ? "resolved" : "left the pool"}
                </span>
              </span>
            </div>
            <ol className="loot-timeline">
              {lot.rows.map((e) => (
                <TimelineRow key={e.id + id} t={t} e={e} holdingId={id} />
              ))}
              {still && <li>Waiting for claims<small>open</small></li>}
            </ol>
          </article>
        );
      })}
    </div>
  );
}
function TimelineRow({ t, e, holdingId }: { t: LootTable; e: Event; holdingId: string }) {
  if (e.lootClaim) {
    const c = e.lootClaim;
    return (
      <li>
        {nameOf(t, c.purseId)} {c.previous ? `changed ${CHOICE_LABEL[c.previous]} → ` : "marked "}
        <Pill choice={c.choice} />
        {c.by === "dm" ? " (marked by the DM)" : ""}
        <small>{when(e.at)}</small>
      </li>
    );
  }
  if (e.lootPool)
    return (
      <li>
        {e.lootPool.pooled
          ? e.lootPool.source === "encounter"
            ? "Added from an encounter award"
            : "Added to the treasure pool by the DM"
          : "Taken out of the pool by the DM (kept in the party fund)"}
        <small>{when(e.at)}</small>
      </li>
    );
  const r = e.lootResolution!;
  const lot = r.lots.find((l) => l.holdingId === holdingId)!;
  const top = Math.max(...lot.rolls.map((x) => x.d100.at(-1) ?? 0));
  return (
    <>
      {lot.unmarked.length > 0 && (
        <li>
          {lot.unmarked.map((id) => nameOf(t, id)).join(", ")} did not mark (counted as Pass)<small>at resolution</small>
        </li>
      )}
      <li className={lot.kept === 0 ? "resolved" : undefined}>
        <strong>
          {lot.awards.map((a) => `${nameOf(t, a.purseId)}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`).join(", ")}
          {lot.awards.length === 1 && lot.awards[0]!.quantity === 1 ? " received it" : ""}
        </strong>{" "}
        {lot.awards[0] && <Pill choice={lot.awards[0].choice} />}
        <small>
          {when(e.at)} · {METHOD_LABEL[r.method]}
          {lot.rolls.length ? ` · ${r.rolls === "manual" ? "Pen & Paper" : r.rolls === "local" ? "DM device" : "server"} rolls: ` : ""}
          {lot.rolls.map((roll) => (
            <span key={roll.purseId}>
              {" "}
              {nameOf(t, roll.purseId).split(" ")[0]}{" "}
              <span className={`loot-die${roll.d100.at(-1) === top ? " win" : ""}`}>{roll.d100.join("/")}</span>
            </span>
          ))}
          {lot.kept ? ` · ${lot.kept} stayed in the pool` : ""}
          {e.lootFavour?.lots.some((l) => l.holdingId === holdingId)
            ? ` · favoured whoever was behind (${e.lootFavour.lots
                .find((l) => l.holdingId === holdingId)!
                .purseIds.map((id) => nameOf(t, id).split(" ")[0])
                .join(", ")})`
            : ""}{" "}
          · receipt <span className="loot-receipt-id">{r.id.slice(0, 8)}</span>
        </small>
      </li>
    </>
  );
}

/** Review Inbox → Treasure pool claims (DM). */
export function LootClaimsReview() {
  const t = useLootTable();
  const economy = useEconomy();
  const seat = useSeat();
  const { prefs } = usePrefs();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const lots = pooledLots(t);
  const claimants = lootClaimants(t);
  const ready = lots.filter((h) => lotClaims(t, h.id).some((c) => c.choice !== "pass"));
  const [method, setMethod] = useState<LootMethod>("random");
  const [rolls, setRolls] = useState<"server" | "manual">(prefs.rollMode === "manual" ? "manual" : "server");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [manualLot, setManualLot] = useState("");
  const [manual, setManual] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  // Favour whoever is behind (phase 3): off by default, chosen for this resolution only.
  const [favourOn, setFavourOn] = useState(false);
  const [basis, setBasis] = useState<FavourBasis>("campaign");
  const fair = useFairness();
  const sessionRunning = (t.journal?.sessions ?? []).some((x) => !x.endedAt);
  const favourBasis: FavourBasis = basis === "session" && !sessionRunning ? "campaign" : basis;
  const blocked =
    cloud.joined && !cloud.mine
      ? `Return the campaign turn to the DM before resolving (it is ${cloud.who}'s turn).`
      : cloud.joined && cloud.pending > 0
        ? "Submit or discard your pending actions before resolving the treasure pool."
        : "";
  const selected = (picked ?? ready.map((h) => h.id)).filter((id) => lots.some((h) => h.id === id));
  const assist = method !== "manual";
  const manualHolding = lots.find((h) => h.id === (manualLot || lots[0]?.id));
  const manualAwards = manualHolding
    ? (Object.entries(manual) as Array<[string, number]>)
        .filter(([key, q]) => key.startsWith(manualHolding.id + "\n") && q > 0)
        .map(([key, quantity]) => ({ purseId: key.split("\n")[1]!, quantity }))
    : [];
  const input: { method: LootMethod; lots: Array<{ holdingId: string; quantity: number; awards?: Array<{ purseId: string; quantity: number }> }> } = assist
    ? { method, lots: lots.filter((h) => selected.includes(h.id)).map((h) => ({ holdingId: h.id, quantity: h.quantity })) }
    : {
        method,
        lots: manualHolding && manualAwards.length
          ? [{ holdingId: manualHolding.id, quantity: manualAwards.reduce((s, a) => s + a.quantity, 0), awards: manualAwards }]
          : [],
      };
  const key = (holdingId: string, purseId: string, round: number) => `${holdingId}\n${purseId}\n${round}`;
  const roll: LootRoll | undefined =
    method === "random" && rolls === "manual"
      ? (holdingId, purseId, round) => {
          const raw = entered[key(holdingId, purseId, round)]?.trim();
          if (!raw) return undefined;
          const n = Number(raw);
          return Number.isInteger(n) && n >= 1 && n <= 100 ? n : Number.NaN;
        }
      : undefined;
  const favouring = favourOn && assist;
  // Favour compares totals over every archived session: in a shared room that loads the whole
  // history first (history on demand), so the totals and the room's agree.
  useRoomHistory();
  const historyMissing = favouring && historyIncomplete();
  useEffect(() => {
    if (historyMissing) void loadAllHistory().catch(() => undefined);
  }, [historyMissing]);
  const totals = useMemo(
    () => (favouring ? fairnessStandings(fair.table, favourBasis) : null),
    [favouring, fair.table, favourBasis],
  );
  let plan: LootPlan | null = null;
  let plain: LootPlan | null = null;
  let planError = "";
  try {
    if (input.lots.length) {
      plan = planLootResolution(t, input, roll, totals ?? undefined);
      if (totals) plain = planLootResolution(t, input, roll);
    }
  } catch (e) {
    planError = e instanceof Error ? e.message : "Check the resolution.";
  }
  const expect = input.lots.length
    ? lootFingerprint(t, input.lots, method, totals ? { basis: favourBasis, totals } : undefined)
    : "";
  // One command ID per reviewed resolution, reused when the same resolution is retried.
  const action = useCommandId(
    `${method}|${rolls}|${expect}|${JSON.stringify(input.lots)}|${JSON.stringify(entered)}|${favouring ? favourBasis : ""}`,
  );
  if (seat.role !== "dm" || !t.ready) return null;
  const rolling = method === "random" && plan?.lots.some((l) => l.needsRolls);
  const unmarkedNames = plan
    ? [...new Set(plan.lots.flatMap((l) => l.unmarked))].map((id) => nameOf(t, id))
    : [];
  const unmarkedLots = plan ? plan.lots.filter((l) => l.unmarked.length) : [];
  const canResolve =
    !!plan && !blocked && !busy && !historyMissing && (method !== "random" || rolls === "server" || plan.missing === 0);
  async function resolve() {
    if (!plan || !canResolve) return;
    setBusy(true);
    setError("");
    try {
      const manualRolls =
        method === "random" && rolls === "manual"
          ? plan.lots.flatMap((l) => l.rolls.map((r) => ({ holdingId: l.holdingId, purseId: r.purseId, d100: r.d100 })))
          : undefined;
      const refusal = await economy.lootResolve(
        {
          method,
          lots: input.lots,
          ...(method === "random" ? { rolls } : {}),
          ...(manualRolls?.length ? { manualRolls } : {}),
          ...(favouring ? { favour: { basis: favourBasis } } : {}),
          expect,
        },
        { commandId: action.commandId },
      );
      if (refusal) {
        setError(refusal);
        return;
      }
      setDone(action.commandId);
      action.renew();
      setPicked(null);
      setEntered({});
      setManual({});
    } finally {
      setBusy(false);
    }
  }
  const receipt = done ? (t.journal?.events ?? []).find((e) => e.lootResolution?.id === done) : undefined;
  return (
    <details className="loot-pool-fold" open={lots.length > 0 || !!receipt} id="treasure-pool-claims">
      <summary>
        <span>Treasure pool claims</span>
        <span>{lots.length ? `${lots.length} item${lots.length === 1 ? "" : "s"} · ${ready.length} ready` : "None pending"}</span>
      </summary>
      <div className="loot-pool-fold-body">
        {receipt && <ResolvedReceipt t={t} event={receipt} />}
        {!lots.length ? (
          <p className="text-sm text-muted">
            {poolFunds(t).length
              ? "Nothing is in the treasure pool."
              : "The treasure pool lives in a party fund; this campaign has none."}{" "}
            <AppLink href="/party?section=pool">Open the treasure pool →</AppLink>
          </p>
        ) : (
          <>
            <p className="text-sm">
              The treasure pool of {poolFunds(t).filter((f) => lots.some((h) => h.purseId === f.id)).map((f) => f.name).join(", ")}.
              Players' claims are requests; choosing here is what moves items. Unmarked counts as Pass.
            </p>
            {blocked && <p className="loot-warn">{blocked}</p>}
            <fieldset className="loot-fieldset">
              <legend>How to resolve</legend>
              <div className="loot-method">
                {(
                  [
                    ["manual", "One at a time", "You choose who receives each item."],
                    ["random", "Random: Need, then Greed", "Need claimants first; if none, Greed. Each rolls d100, highest first. Ties roll again."],
                    [
                      "round-robin",
                      "Round-robin",
                      `Next in line among each item's Need claimants, then Greed. Next: ${nextInLine(t, claimants)}.`,
                    ],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label key={value} className={`coin-split-rule${method === value ? " is-selected" : ""}`}>
                    <input type="radio" name="loot-method" checked={method === value} onChange={() => { setMethod(value); setError(""); }} />
                    <span>{label}</span>
                    <small>{hint}</small>
                  </label>
                ))}
              </div>
              {method === "random" && (
                <div className="loot-rollmode">
                  <span>Rolls</span>
                  <div className="mode-switch" role="tablist" aria-label="Rolls">
                    <button type="button" role="tab" aria-selected={rolls === "server"} onClick={() => setRolls("server")}>
                      {cloud.joined ? "Server rolls" : "Device rolls"}
                    </button>
                    <button type="button" role="tab" aria-selected={rolls === "manual"} onClick={() => setRolls("manual")}>
                      Pen &amp; Paper
                    </button>
                  </div>
                  <span className="text-xs text-muted">
                    From this device's Roll mode ({prefs.rollMode === "manual" ? "Pen & Paper" : "Virtual"}).
                    {cloud.joined
                      ? " Pen & Paper follows the campaign's manual-roll policy."
                      : " Offline, the DM's device rolls."}
                  </span>
                </div>
              )}
              <FavourPanel
                on={favourOn}
                onChange={(on) => {
                  setFavourOn(on);
                  setError("");
                }}
                basis={favourBasis}
                onBasis={setBasis}
                sessionRunning={sessionRunning}
                method={method}
                claimants={claimants}
              />
            </fieldset>
            {assist ? (
              <fieldset className="loot-fieldset">
                <legend>
                  Items to resolve · {selected.length} of {lots.length} selected
                </legend>
                {lots.map((h) => {
                  const claims = lotClaims(t, h.id);
                  const waiting = claimants.length - claims.length;
                  return (
                    <label className="loot-lot-select" key={h.id} id={`loot-${h.id}`}>
                      <input
                        type="checkbox"
                        checked={selected.includes(h.id)}
                        onChange={(e) =>
                          setPicked(e.target.checked ? [...selected, h.id] : selected.filter((id) => id !== h.id))
                        }
                      />
                      <span>
                        {h.name} × {h.quantity}{" "}
                        <small>
                          · {claimSummary(t, h.id) || "no claims"}
                          {waiting > 0 ? ` · waiting for ${waiting}` : ""}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <ManualLot
                t={t}
                lots={lots}
                holding={manualHolding}
                onLot={(id) => {
                  setManualLot(id);
                  setManual({});
                }}
                manual={manual}
                setManual={setManual}
              />
            )}
            {plan ? (
              <PlanPreview
                t={t}
                plan={plan}
                rolls={method === "random" ? rolls : null}
                entered={entered}
                setEntered={setEntered}
                keyOf={key}
                favour={totals && plain ? { totals, plain } : null}
              />
            ) : (
              <p className="coin-split-hint" role="status">
                {planError || (assist ? "Select at least one item with claims." : "Choose who receives the item.")}
              </p>
            )}
            {assist && unmarkedLots.length > 0 && (
              <div className="loot-warn">
                {unmarkedNames.join(", ")} {unmarkedNames.length === 1 ? "hasn't" : "haven't"} marked{" "}
                {unmarkedLots.map((l) => l.name).join(", ")}. If you resolve now, {unmarkedNames.length === 1 ? "they count" : "they count"} as Pass.{" "}
                <button
                  type="button"
                  className="coin-split-link"
                  onClick={() => setPicked(selected.filter((id) => !unmarkedLots.some((l) => l.holdingId === id)))}
                >
                  Leave {unmarkedLots.length === 1 ? "that one" : `those ${unmarkedLots.length}`} for later
                </button>
              </div>
            )}
            {error && (
              <div className="coin-split-alert" role="alert">
                <strong>{error.startsWith("Claims changed") ? "Claims changed. Nothing moved." : "Nothing moved."}</strong>
                {error.replace("Claims changed. Nothing moved. ", "")} Your selections are kept.
              </div>
            )}
            {plan && (
              <div className="coin-split-confirm">
                <strong>Confirm the resolution</strong>
                <ul>
                  <li>
                    {plan.lots.reduce((s, l) => s + l.quantity, 0)} item{plan.lots.reduce((s, l) => s + l.quantity, 0) === 1 ? "" : "s"} leave the treasure pool
                    {plan.lots.every((l) => l.awards.length)
                      ? ` and go to ${[...new Set(plan.lots.flatMap((l) => l.awards.map((a) => nameOf(t, a.purseId))))].join(", ")}`
                      : ""}
                    .
                  </li>
                  {rolling && rolls === "server" && (
                    <li>
                      {cloud.joined ? "The room server" : "This device"} rolls now. The rolls are recorded and can't be rolled
                      again.
                    </li>
                  )}
                  {rolling && rolls === "manual" && <li>Your Pen &amp; Paper totals are recorded as entered by the DM.</li>}
                  {historyMissing && (
                    <li>
                      <HistoryCoverage what="Favour totals" />
                    </li>
                  )}
                  {favouring && (
                    <li>
                      Favour whoever is behind is on ({favourBasis === "session" ? "this session" : "campaign to date"}); the totals it
                      used are recorded on the receipt.
                    </li>
                  )}
                  <li>
                    All items move or none do. If a claim{favouring ? " or anyone's total" : ""} changes before you confirm (for
                    example a split lands), nothing moves and you review again.
                  </li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button disabled={!canResolve} onClick={() => void resolve()} aria-busy={busy}>
                    {busy ? (
                      <>
                        <span className="coin-split-spinner" aria-hidden="true" />
                        {rolling && rolls === "server" ? "Rolling and resolving…" : "Resolving…"}
                      </>
                    ) : rolling && rolls === "server" ? (
                      `Roll and resolve ${plan.lots.length} item${plan.lots.length === 1 ? "" : "s"}`
                    ) : (
                      `Resolve ${plan.lots.length === 1 ? plan.lots[0]!.name : `${plan.lots.length} items`}`
                    )}
                  </Button>
                  {!assist && manualHolding && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        const refusal = await economy.lootPoolSet(manualHolding.id, false);
                        if (refusal) setError(refusal);
                      }}
                    >
                      Take out of pool
                    </Button>
                  )}
                </div>
                {busy && (
                  <p className="text-sm text-muted" role="status">
                    Waiting for the campaign to confirm. Pressing again can't move items twice: the resolution keeps one
                    command ID until it succeeds.
                  </p>
                )}
              </div>
            )}
          </>
        )}
        <AppLink href="/party?section=pool">Open the treasure pool →</AppLink>
      </div>
    </details>
  );
}
function nextInLine(t: LootTable, claimants: Purse[]): string {
  const last = readLootClaims(t).rotation?.lastPurseId;
  const lastPurse = t.purses.find((p) => p.id === last);
  if (!claimants.length) return "nobody yet";
  const next = lastPurse ? claimants.find((p) => p.name.localeCompare(lastPurse.name, "en", { sensitivity: "base", numeric: true }) > 0 || (p.name === lastPurse.name && p.id > lastPurse.id)) : undefined;
  return (next ?? claimants[0]!).name;
}

function ManualLot({
  t,
  lots,
  holding,
  onLot,
  manual,
  setManual,
}: {
  t: LootTable;
  lots: Holding[];
  holding: Holding | undefined;
  onLot: (id: string) => void;
  manual: Record<string, number>;
  setManual: (next: Record<string, number>) => void;
}) {
  if (!holding) return null;
  const claims = lotClaims(t, holding.id);
  const claimants = lootClaimants(t);
  const k = (purseId: string) => `${holding.id}\n${purseId}`;
  const assigned = (Object.entries(manual) as Array<[string, number]>)
    .filter(([key]) => key.startsWith(holding.id + "\n"))
    .reduce((s, [, q]) => s + q, 0);
  const others = t.purses.filter(
    (p) => recipientProblem(t, p, "dm") === null && !claims.some((c) => c.choice !== "pass" && c.purseId === p.id),
  );
  const extra = Object.keys(manual).find(
    (key) => key.startsWith(holding.id + "\n") && others.some((p) => key === k(p.id)),
  );
  const row = (p: Purse) => (
    <div className="loot-award-row" key={p.id}>
      <span>{p.name}</span>
      <span className="loot-stepper">
        <button
          type="button"
          aria-label={`One fewer for ${p.name}`}
          disabled={!manual[k(p.id)]}
          onClick={() => setManual({ ...manual, [k(p.id)]: Math.max(0, (manual[k(p.id)] ?? 0) - 1) })}
        >
          −
        </button>
        <output>{manual[k(p.id)] ?? 0}</output>
        <button
          type="button"
          aria-label={`One more for ${p.name}`}
          disabled={assigned >= holding.quantity}
          onClick={() => setManual({ ...manual, [k(p.id)]: (manual[k(p.id)] ?? 0) + 1 })}
        >
          +
        </button>
      </span>
    </div>
  );
  const tier = (choice: LootChoice) => claimants.filter((p) => claims.some((c) => c.purseId === p.id && c.choice === choice));
  return (
    <article className="loot-lot" id={`loot-${holding.id}`}>
      <label className="coin-split-field">
        <span>Item</span>
        <select value={holding.id} onChange={(e) => onLot(e.target.value)} aria-label="Item to resolve">
          {lots.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} × {h.quantity}
            </option>
          ))}
        </select>
      </label>
      {(["need", "greed"] as const).map((choice) =>
        tier(choice).length ? (
          <div className="loot-tier" key={choice}>
            <p className="loot-tier-title">
              <Pill choice={choice} />
            </p>
            {tier(choice).map(row)}
          </div>
        ) : null,
      )}
      {tier("pass").length > 0 && (
        <div className="loot-tier">
          <p className="loot-tier-title">
            <Pill choice="pass" /> {tier("pass").map((p) => p.name).join(", ")}
          </p>
        </div>
      )}
      <label className="coin-split-field mt-2">
        <span>Someone else (DM's choice)</span>
        <select
          value={extra ? extra.split("\n")[1] : ""}
          onChange={(e) => {
            const next = Object.fromEntries(Object.entries(manual).filter(([key]) => key !== extra));
            if (e.target.value) next[k(e.target.value)] = Math.max(1, Math.min(1, holding.quantity - assigned));
            setManual(next);
          }}
        >
          <option value="">Nobody</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {isNpc(t, p) ? " (companion NPC, DM-only)" : claims.some((c) => c.purseId === p.id) ? " (passed)" : " (not marked)"}
            </option>
          ))}
        </select>
      </label>
      {extra && others.some((p) => k(p.id) === extra) && row(t.purses.find((p) => k(p.id) === extra)!)}
      <p className="mt-2 text-sm">
        {assigned} of {holding.quantity} assigned · {holding.quantity - assigned} stay in the pool.
      </p>
    </article>
  );
}

function PlanPreview({
  t,
  plan,
  rolls,
  entered,
  setEntered,
  keyOf,
  favour,
}: {
  t: LootTable;
  plan: LootPlan;
  rolls: "server" | "manual" | null;
  entered: Record<string, string>;
  setEntered: (next: Record<string, string>) => void;
  keyOf: (holdingId: string, purseId: string, round: number) => string;
  /** Favour on: the totals used and the same plan without favour, to compare. */
  favour: { totals: Map<string, number>; plain: LootPlan } | null;
}) {
  const pool = plan.lots.reduce((s, l) => s + l.poolQuantity, 0);
  const moving = plan.lots.reduce((s, l) => s + l.quantity, 0);
  const first = (id: string) => nameOf(t, id).split(" ")[0];
  return (
    <section className="coin-split-preview" aria-label="Resolution preview">
      <div className="coin-split-preview-head">
        <strong>Preview{rolls === "manual" ? " · Pen & Paper" : ""}</strong>
        <span>
          {moving} item{moving === 1 ? "" : "s"}
          {plan.lots.some((l) => l.needsRolls) && rolls === "server" ? " · rolls happen when you confirm" : ""}
        </span>
      </div>
      {plan.lots.map((lot) => {
        const tierIds = lot.claims.filter((c) => c.choice === lot.tier).map((c) => c.purseId);
        const inputs = rolls === "manual" && lot.needsRolls
          ? [
              ...tierIds.map((purseId) => ({ purseId, round: 1 })),
              ...lot.missing.filter((m) => m.round > 1),
              ...lot.rolls.flatMap((r) => r.d100.slice(1).map((_, i) => ({ purseId: r.purseId, round: i + 2 }))),
            ].filter((x, i, all) => all.findIndex((y) => y.purseId === x.purseId && y.round === x.round) === i)
          : [];
        const top = Math.max(0, ...lot.rolls.map((r) => r.d100.at(-1) ?? 0));
        return (
          <div className="coin-split-row" key={lot.holdingId}>
            <span>
              <strong>{lot.name}{lot.quantity > 1 ? ` × ${lot.quantity}` : ""}</strong>
              {lot.tier ? ` · ${CHOICE_LABEL[lot.tier]}: ${tierIds.map(first).join(", ")}` : ""}
            </span>
            <span className="coin-split-amt">
              {lot.awards.length
                ? lot.awards.map((a) => `${first(a.purseId)}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`).join(", ")
                : lot.needsRolls
                  ? "roll"
                  : "—"}
            </span>
            <span className="loot-rolls">
              {lot.awards.length > 0 && !lot.needsRolls && plan.method === "random" && (
                <span className="text-xs text-muted">no roll: every claimant gets {lot.awards[0]!.quantity === 1 ? "one" : "the same number"}</span>
              )}
              {rolls === "server" && lot.needsRolls &&
                tierIds.map((id) => (
                  <span key={id}>
                    {first(id)} <span className="loot-die pending">d100</span>
                  </span>
                ))}
              {inputs.map(({ purseId, round }) => (
                <label key={`${purseId}-${round}`}>
                  {first(purseId)}
                  {round > 1 ? " again" : ""}
                  <input
                    className="loot-roll-input"
                    inputMode="numeric"
                    placeholder="d100"
                    aria-label={`${nameOf(t, purseId)}'s ${round > 1 ? "tie-break " : ""}d100 for ${lot.name}`}
                    value={entered[keyOf(lot.holdingId, purseId, round)] ?? ""}
                    onChange={(e) => setEntered({ ...entered, [keyOf(lot.holdingId, purseId, round)]: e.target.value })}
                  />
                </label>
              ))}
              {rolls === "manual" && lot.rolls.length > 0 && lot.awards.length > 0 &&
                lot.rolls.map((r) => (
                  <span key={r.purseId}>
                    {first(r.purseId)} <span className={`loot-die${r.d100.at(-1) === top ? " win" : ""}`}>{r.d100.join("/")}</span>
                  </span>
                ))}
            </span>
            {favour && <FavourCompare t={t} lot={lot} plain={favour.plain.lots.find((l) => l.holdingId === lot.holdingId)} totals={favour.totals} method={plan.method} />}
          </div>
        );
      })}
      <div className="coin-split-sum">
        Pool: {pool} item{pool === 1 ? "" : "s"} in the selected lots. Moving {moving}
        {plan.lots.some((l) => l.kept) ? ` · staying ${plan.lots.reduce((s, l) => s + l.kept, 0)}` : ""} <b>✓</b>
        {rolls === "manual" && plan.missing > 0 ? ` · enter ${plan.missing} more d100 total${plan.missing === 1 ? "" : "s"} (whole numbers from 1 to 100)` : ""}
      </div>
    </section>
  );
}

function ResolvedReceipt({ t, event }: { t: LootTable; event: Event }) {
  const r = event.lootResolution!;
  const items = r.lots.reduce((s, l) => s + l.awards.reduce((x, a) => x + a.quantity, 0), 0);
  const value = r.lots.reduce((s, l) => s + l.awards.reduce((x, a) => x + a.quantity * l.unitCopper, 0), 0);
  return (
    <section className="encounter-panel" aria-label="Treasure pool resolution receipt">
      <p className="eyebrow">Resolved · receipt</p>
      <h3 className="font-display text-xl">Treasure pool resolution</h3>
      <p className="text-sm text-muted">
        Receipt <span className="loot-receipt-id">{r.id.slice(0, 8)}</span> · {when(event.at)} · {METHOD_LABEL[r.method]}
        {r.rolls ? ` · ${r.rolls === "manual" ? "Pen & Paper" : r.rolls === "server" ? "server" : "DM device"} rolls` : ""} · resolved once
      </p>
      <FavourNote t={t} event={event} />
      <div className="coin-split-preview mt-2">
        <div className="coin-split-preview-head">
          <strong>Items moved</strong>
          <span>
            {items} item{items === 1 ? "" : "s"} · {formatCopper(value)} recorded value
          </span>
        </div>
        {r.lots.map((lot) => (
          <div className="coin-split-row" key={lot.holdingId}>
            <span>
              {lot.name} →{" "}
              {lot.awards.map((a) => (
                <strong key={a.purseId}>
                  {nameOf(t, a.purseId)}
                  {a.quantity > 1 ? ` × ${a.quantity}` : ""}{" "}
                </strong>
              ))}
            </span>
            <span className="coin-split-amt">{CHOICE_LABEL[lot.awards[0]?.choice ?? "dm"]}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <AppLink href={`/features/reports#loot-${r.id}`}>Open in Activity</AppLink>
        <AppLink href="/party?section=pool">Back to the pool</AppLink>
      </div>
    </section>
  );
}

/** Review Inbox: "Favour whoever is behind" (phase 3). Off by default; for this resolution only. */
function FavourPanel({
  on,
  onChange,
  basis,
  onBasis,
  sessionRunning,
  method,
  claimants,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  basis: FavourBasis;
  onBasis: (basis: FavourBasis) => void;
  sessionRunning: boolean;
  method: LootMethod;
  claimants: Purse[];
}) {
  const fair = useFairness();
  const view = useMemo(() => {
    const active = (fair.table.journal?.sessions ?? []).find((x) => !x.endedAt);
    return fairnessLedger(fair.table, fair.viewer, basis === "session" && active ? active.id : "campaign");
  }, [fair.table, fair.viewer, basis]);
  const rows = claimants
    .map((p) => [...view.rows, ...view.others].find((r) => r.purseId === p.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.total - b.total);
  return (
    <div className={`fair-favour${on ? " is-on" : ""}`}>
      <label className="switch-row">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>
          Favour whoever is behind<span className="fair-new">New</span>
        </span>
        <small>
          {!on
            ? "Off. Uses Fairness totals to settle ties instead of re-rolling, and to order round-robin. Need still comes before Greed."
            : method === "manual"
              ? "One at a time: you choose; the totals below are for information only."
              : "For this resolution only. Need still comes before Greed and only claimants can receive. Random: the highest roll still wins; a tie goes to whoever is further behind instead of rolling again. Round-robin: whoever is furthest behind goes next."}
        </small>
      </label>
      {on && (
        <>
          <div className="basis">
            <span>Behind on</span>
            <select
              className="min-h-11 rounded-sm border border-border bg-subtle px-3 text-base text-fg"
              value={basis}
              onChange={(e) => onBasis(e.target.value as FavourBasis)}
              aria-label="Favour basis"
            >
              <option value="campaign">Campaign to date</option>
              <option value="session" disabled={!sessionRunning}>
                This session{sessionRunning ? "" : " (no session running)"}
              </option>
            </select>
          </div>
          <ul className="fair-standings" aria-label="Fairness standings">
            {rows.map((r) => {
              const g = r.gap ? roundGap(r.gap) : null;
              return (
                <li key={r.purseId}>
                  <span>{r.name}</span>
                  {g === null ? (
                    <b>{formatCopper(r.total)}</b>
                  ) : g === 0 ? (
                    <b>level</b>
                  ) : (
                    <b className={g < 0 ? "behind" : "ahead"}>
                      {formatCopper(Math.abs(g))} {g < 0 ? "behind" : "ahead"}
                    </b>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** One lot's preview with favour on, beside what would happen without it. */
function FavourCompare({
  t,
  lot,
  plain,
  totals,
  method,
}: {
  t: LootTable;
  lot: LootPlan["lots"][number];
  plain: LootPlan["lots"][number] | undefined;
  totals: Map<string, number>;
  method: LootMethod;
}) {
  const first = (id: string) => nameOf(t, id).split(" ")[0];
  const awards = (l: LootPlan["lots"][number] | undefined) =>
    l?.awards.length ? l.awards.map((a) => `${first(a.purseId)}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`).join(", ") : "";
  const tierIds = lot.claims.filter((c) => c.choice === lot.tier).map((c) => c.purseId);
  const total = (id: string) => totals.get(id) ?? 0;
  const lowest = [...tierIds].sort((a, b) => total(a) - total(b));
  const unique = lowest.length > 1 && total(lowest[0]!) < total(lowest[1]!);
  const greedBehind =
    lot.tier === "need"
      ? lot.claims.filter((c) => c.choice === "greed" && tierIds.every((id) => total(c.purseId) < total(id))).map((c) => c.purseId)
      : [];
  let without = "";
  let withFavour = "";
  if (method === "random") {
    without = lot.needsRolls ? "Highest d100 wins. A tie rolls again." : "No roll: every claimant gets the same.";
    withFavour = !lot.needsRolls
      ? "The same."
      : unique
        ? `Highest d100 still wins. If the top rolls tie, ${first(lowest[0]!)} gets it without a re-roll (further behind).`
        : "Highest d100 still wins. The claimants are level, so a tie still rolls again.";
    if (lot.awards.length && plain?.awards.length) {
      without = `${awards(plain)}.`;
      withFavour = `${awards(lot)}${lot.favoured.length ? ` (tie settled for ${lot.favoured.map(first).join(", ")}, behind)` : ""}.`;
    }
  } else {
    without = `${awards(plain) || "—"} (name order)`;
    withFavour = `${awards(lot) || "—"} (furthest behind first)`;
  }
  return (
    <div className="fair-cmp" style={{ gridColumn: "1 / -1" }}>
      <div>
        <h4>Without favour</h4>
        <p>{without}</p>
      </div>
      <div className="with">
        <h4>With favour</h4>
        <p>
          {withFavour}
          {greedBehind.length
            ? ` ${greedBehind.map(first).join(", ")} ${greedBehind.length === 1 ? "is" : "are"} further behind but marked Greed; Need comes first.`
            : ""}
        </p>
      </div>
    </div>
  );
}

/** "Favoured whoever was behind" on a resolution receipt (Activity, history and the Review Inbox). */
export function FavourNote({ t, event }: { t: LootTable; event: Event }) {
  const f = event.lootFavour;
  if (!f) return null;
  return (
    <p className="text-sm text-muted">
      Favoured whoever was behind, {f.basis === "session" ? "this session" : "campaign to date"}. Totals used:{" "}
      {[...f.totals]
        .sort((a, b) => a.copper - b.copper)
        .map((x) => `${nameOf(t, x.purseId).split(" ")[0]} ${formatCopper(x.copper)}`)
        .join(", ")}
      .
    </p>
  );
}
