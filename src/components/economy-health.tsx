/**
 * Activity → Economy health (owner-approved 2026-11-05): a DM-only, read-only panel computed on
 * this device from the ledger the DM already holds (src/lib/quire/economy-health.ts). Nothing is
 * stored on the server and no command is sent. Archived sessions a shared room has not loaded
 * are counted, and loaded only when the DM asks (history on demand).
 */
import { useMemo, useState } from "react";
import { History, LoaderCircle } from "lucide-react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { formatCopper } from "@/lib/quire/money";
import { historyIncomplete, loadAllHistory } from "@/lib/quire/room-history";
import {
  economyHealth,
  FAUCETS,
  SINKS,
  type EconomyHealth as Health,
  type NetWorth,
  type PeriodFlows,
} from "@/lib/quire/economy-health";
import { useRoomHistory } from "./history-loader";
import { Button } from "./ui";
import "./economy-health.css";

/** The DM's own target (gp per character level), kept on this device only. */
const TARGET_KEY = "quire.economy-health.target.v1";
function readTarget(): number | null {
  try {
    const n = Number(localStorage.getItem(TARGET_KEY));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function writeTarget(gp: number | null) {
  try {
    if (gp) localStorage.setItem(TARGET_KEY, String(gp));
    else localStorage.removeItem(TARGET_KEY);
  } catch {
    // Private browsing: the target lasts for this visit.
  }
}

const signed = (copper: number) => (copper > 0 ? `+${formatCopper(copper)}` : formatCopper(copper));

function Coverage({ view }: { view: Health }) {
  const state = useRoomHistory();
  const incomplete = historyIncomplete();
  if (!view.notLoaded && !incomplete && !state.all && !view.unreadable) return null;
  const sessions = view.notLoaded === 1 ? "1 earlier session" : `${view.notLoaded} earlier sessions`;
  return (
    <div className="history-loader econ-coverage" role="group" aria-label="Economy health coverage">
      <p className="history-loader-note" role="status" aria-live="polite">
        {state.all
          ? `Loading the campaign's history… ${state.all.done} of ${Math.max(state.all.total, state.all.done)} steps`
          : view.notLoaded
            ? `${sessions} not loaded. These figures cover what this device has loaded.`
            : incomplete
              ? "Earlier ledger entries are not loaded. These figures cover what this device has loaded."
              : null}
        {view.unreadable ? ` ${view.unreadable} archived session${view.unreadable === 1 ? "" : "s"} cannot be read and ${view.unreadable === 1 ? "is" : "are"} not counted.` : ""}
      </p>
      {(view.notLoaded > 0 || incomplete) && !state.all && (
        <Button variant="secondary" onClick={() => void loadAllHistory().catch(() => undefined)}>
          <History size={16} aria-hidden />
          Load
        </Button>
      )}
      {state.all && <LoaderCircle size={16} className="history-loader-spin" aria-hidden />}
    </div>
  );
}

function worthText(w: NetWorth | null) {
  return w ? formatCopper(w.total) : "—";
}

function FlowTable({ rows, weekly }: { rows: PeriodFlows[]; weekly: boolean }) {
  if (!rows.length)
    return <p className="text-muted econ-empty">No money has moved yet. Faucets and sinks appear here as the party earns and spends.</p>;
  return (
    <table className="econ-table" aria-label={weekly ? "Money in and out by in-game week" : "Money in and out by session"}>
      <thead>
        <tr>
          <th scope="col">{weekly ? "In-game week" : "Session"}</th>
          <th scope="col">In</th>
          <th scope="col">Out</th>
          <th scope="col">Net</th>
          <th scope="col">Moved in party</th>
          <th scope="col">Unclassified</th>
          {!weekly && <th scope="col">Net worth at end</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={r.kind === "between" ? "is-between" : undefined}>
            <th scope="row">
              {r.label}
              {r.inProgress && <small> · in progress</small>}
            </th>
            {r.unavailable ? (
              <td colSpan={weekly ? 5 : 6} className="econ-unavailable">
                {r.unavailable === "not-loaded" ? "Not loaded on this device" : "This archive cannot be read"}
              </td>
            ) : (
              <>
                <td data-label="In">{formatCopper(r.faucetTotal)}</td>
                <td data-label="Out">{formatCopper(r.sinkTotal)}</td>
                <td data-label="Net" className={r.net < 0 ? "is-down" : undefined}>
                  {signed(r.net)}
                </td>
                <td data-label="Moved in party">
                  {formatCopper(r.transfers.moved)}
                  {r.transfers.count ? <small> · {r.transfers.count} lines</small> : null}
                </td>
                <td data-label="Unclassified">
                  {r.unclassified.count ? `${r.unclassified.count} · ${signed(r.unclassified.net)}` : "0"}
                </td>
                {!weekly && <td data-label="Net worth at end">{worthText(r.worth)}</td>}
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One small line chart of party net worth by session (theme colours via currentColor). */
function WorthChart({ trend }: { trend: Health["trend"] }) {
  if (trend.length < 2) return null;
  const values = trend.map((p) => p.worth.total);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => 8 + (i * 284) / (trend.length - 1);
  const y = (v: number) => 92 - ((v - min) / (max - min || 1)) * 80;
  const last = trend.at(-1)!;
  return (
    <figure className="econ-chart">
      <svg
        viewBox="0 0 300 100"
        role="img"
        aria-label={`Party net worth by session, from ${formatCopper(values[0]!)} to ${formatCopper(last.worth.total)}`}
      >
        <line x1="8" x2="292" y1="92" y2="92" className="econ-axis" />
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={trend.map((p, i) => `${x(i)},${y(p.worth.total)}`).join(" ")}
        />
        {trend.map((p, i) => (
          <circle key={p.key} cx={x(i)} cy={y(p.worth.total)} r="2.5" fill="currentColor" />
        ))}
      </svg>
      <figcaption>
        {trend.map((p) => p.label).join(" · ")} — {formatCopper(min)} to {formatCopper(max)}
      </figcaption>
    </figure>
  );
}

function Categories({ flows }: { flows: PeriodFlows }) {
  const faucets = (Object.keys(FAUCETS) as Array<keyof typeof FAUCETS>).filter((k) => flows.faucets[k] !== 0);
  const sinks = (Object.keys(SINKS) as Array<keyof typeof SINKS>).filter((k) => flows.sinks[k] !== 0);
  return (
    <div className="econ-categories">
      <div>
        <h4>Faucets · money in</h4>
        {faucets.length ? (
          <dl>
            {faucets.map((k) => (
              <div key={k}>
                <dt>{FAUCETS[k]}</dt>
                <dd>{formatCopper(flows.faucets[k])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted">None yet.</p>
        )}
      </div>
      <div>
        <h4>Sinks · money out</h4>
        {sinks.length ? (
          <dl>
            {sinks.map((k) => (
              <div key={k}>
                <dt>{SINKS[k]}</dt>
                <dd>{formatCopper(flows.sinks[k])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted">None yet.</p>
        )}
      </div>
    </div>
  );
}

function WealthNote({ view, targetGp, onTarget }: { view: Health; targetGp: number | null; onTarget: (gp: number | null) => void }) {
  const [draft, setDraft] = useState(targetGp ? String(targetGp) : "");
  const { wealth } = view;
  const ratio = wealth.guideCopper ? wealth.worthCopper / wealth.guideCopper : null;
  return (
    <div className="econ-wealth" role="note" aria-label="Wealth by level (advisory)">
      <h4>Wealth by level · advisory</h4>
      <p>
        Party net worth {formatCopper(wealth.worthCopper)} for {wealth.characters.length} player character
        {wealth.characters.length === 1 ? "" : "s"}
        {wealth.characters.length ? ` (levels ${wealth.characters.map((c) => c.level).join(", ")})` : ""}.{" "}
        {targetGp
          ? `Your target: ${targetGp} gp per character level, ${formatCopper(wealth.guideCopper)} in all.`
          : wealth.guideCopper
            ? `The SRD 5.2.1 starting gold for characters of these levels comes to ${formatCopper(wealth.guideCopper)}.`
            : "The SRD 5.2.1 table suggests no extra starting gold below level 5."}
        {ratio !== null && ` The party holds ${Math.round(ratio * 100)}% of that.`}
      </p>
      <p className="text-muted">
        An advisory comparison, like the encounter-difficulty estimate: tables differ, and the SRD figure is
        the average gold for a character created at that level, without its magic items.
      </p>
      <form
        className="econ-target"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(draft);
          onTarget(Number.isSafeInteger(n) && n > 0 ? n : null);
        }}
      >
        <label>
          Your own target (gp per character level, this device)
          <input inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))} />
        </label>
        <Button type="submit" variant="secondary">
          Use target
        </Button>
        {targetGp ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft("");
              onTarget(null);
            }}
          >
            Use the SRD table
          </Button>
        ) : null}
      </form>
    </div>
  );
}

export function EconomyHealth() {
  const { purses, ledger, journal, holdings, sheets, ready } = useEconomy();
  const seat = useSeat();
  useRoomHistory();
  const [mode, setMode] = useState<"session" | "week">("session");
  const [targetGp, setTargetGp] = useState<number | null>(() => (typeof window === "undefined" ? null : readTarget()));
  const view = useMemo(
    () =>
      economyHealth(
        { purses, ledger, journal, holdings, sheets },
        targetGp ? { targetPerLevel: (level) => level * targetGp * 100 } : {},
      ),
    [purses, ledger, journal, holdings, sheets, targetGp],
  );
  // DM only: never rendered for players (their own projection is never read here).
  if (seat.role !== "dm" || !ready) return null;
  const c = view.campaign;
  return (
    <section className="economy-health" aria-labelledby="economy-health-title">
      <h2 id="economy-health-title">Economy health</h2>
      <p className="text-muted">
        DM only. Where the party's money comes from and where it goes, computed on this device from the ledger. Nothing is
        stored or changed.
      </p>
      <Coverage view={view} />
      <div className="econ-summary">
        <span>
          <span>Money in</span>
          {formatCopper(c.faucetTotal)}
        </span>
        <span>
          <span>Money out</span>
          {formatCopper(c.sinkTotal)}
        </span>
        <span>
          <span>Net</span>
          {signed(c.net)}
        </span>
        <span>
          <span>Party net worth now</span>
          {formatCopper(view.now.total)}
        </span>
      </div>
      <p className="text-sm text-muted">
        Net worth: coins {formatCopper(view.now.coins)} and items {formatCopper(view.now.items)} of the player characters and
        party funds. Unidentified items count at the value players are told
        {view.now.unvalued ? `; ${view.now.unvalued} unidentified item${view.now.unvalued === 1 ? " has" : "s have"} no told value (0 cp)` : ""}.
        {view.now.property ? ` Properties and ships (${formatCopper(view.now.property)}) are not included.` : ""}
      </p>
      <WorthChart trend={view.trend} />
      <div className="mode-switch econ-mode" role="group" aria-label="Group money by">
        <button type="button" aria-pressed={mode === "session"} onClick={() => setMode("session")}>
          By session
        </button>
        <button type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>
          By in-game week
        </button>
      </div>
      <FlowTable rows={mode === "session" ? view.sessions : view.weeks} weekly={mode === "week"} />
      <p className="text-sm text-muted">
        In: encounter loot, sales, income, quest rewards, loans and DM grants. Out: purchases, upkeep and wages, services,
        travel, loan repayments and DM deductions. Money moved between party members and party funds (Give, splits) is not
        in or out; it is shown under “Moved in party”. Item-only entries are not money.
      </p>
      <h3>Campaign so far, by kind</h3>
      <Categories flows={c} />
      {view.unclassified.length > 0 && (
        <details className="econ-unclassified">
          <summary>
            Unclassified: {view.unclassified.reduce((s, e) => s + e.lineIds.length, 0)} entries · {signed(c.unclassified.net)}
          </summary>
          <ul>
            {view.unclassified.map((e, i) => (
              <li key={`${e.lineIds[0] ?? i}`}>
                <span>{e.summary}</span> <b>{signed(e.copper)}</b>
                {e.reason && <small> · {e.reason}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <WealthNote
        view={view}
        targetGp={targetGp}
        onTarget={(gp) => {
          writeTarget(gp);
          setTargetGp(gp);
        }}
      />
    </section>
  );
}
