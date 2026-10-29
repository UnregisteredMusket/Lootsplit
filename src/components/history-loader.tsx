/**
 * History on demand in the interface (tabletop protocol 12; room-history.ts): a shared campaign
 * view holds the newest ledger and chat lines and lists archived sessions without their contents.
 * These controls load earlier history when someone asks for it. They render nothing outside a
 * shared room, and nothing once everything is loaded.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { History, LoaderCircle } from "lucide-react";
import {
  getRoomHistory,
  historyIncomplete,
  loadAllHistory,
  loadEarlier,
  openReport,
  subscribeRoomHistory,
  type HistoryState,
} from "@/lib/quire/room-history";
import type { HistoryList } from "@/lib/quire/history-pages";
import { Button } from "./ui";
import "./history-loader.css";

export function useRoomHistory(): HistoryState {
  return useSyncExternalStore(subscribeRoomHistory, getRoomHistory, getRoomHistory);
}

const LABELS: Record<HistoryList, { more: string; loading: string; region: string }> = {
  ledger: { more: "Load earlier entries", loading: "Loading earlier entries…", region: "Earlier ledger entries" },
  notes: { more: "Load earlier messages", loading: "Loading earlier messages…", region: "Earlier messages" },
};

/** "Load earlier entries" for one list; place it where that list starts (its oldest end). */
export function LoadEarlierEntries({ list, className }: { list: HistoryList; className?: string }) {
  const state = useRoomHistory()[list];
  if (!state.more && !state.loading && !state.error) return null;
  const labels = LABELS[list];
  return (
    <div className={`history-loader ${className ?? ""}`} role="group" aria-label={labels.region}>
      {state.more || state.loading ? (
        <Button
          variant="secondary"
          disabled={state.loading}
          aria-busy={state.loading}
          onClick={() => void loadEarlier(list).catch(() => undefined)}
        >
          {state.loading ? <LoaderCircle size={16} className="history-loader-spin" aria-hidden /> : <History size={16} aria-hidden />}
          {state.loading ? labels.loading : labels.more}
        </Button>
      ) : null}
      <p className="history-loader-note" role="status" aria-live="polite">
        {state.error
          ? state.error
          : state.loading
            ? labels.loading
            : "Earlier entries are kept online and load when you ask for them."}
      </p>
    </div>
  );
}

/**
 * For a search or filter over history: while `active`, every earlier batch of `list` is loaded in
 * turn, so the search covers the whole campaign, with a status line.
 */
export function SearchEarlierEntries({ list, active }: { list: HistoryList; active: boolean }) {
  const state = useRoomHistory()[list];
  const running = useRef(false);
  // Each finished batch starts the next while the search is active (until the list's start).
  const [batches, setBatches] = useState(0);
  useEffect(() => {
    if (!active || !state.more || state.loading || state.error || running.current) return;
    running.current = true;
    void loadEarlier(list, { bulk: true })
      .catch(() => undefined)
      .finally(() => {
        running.current = false;
        setBatches((n) => n + 1);
      });
  }, [active, list, state.more, state.loading, state.error, batches]);
  if (!active || (!state.more && !state.loading && !state.error)) return null;
  return (
    <p className="history-loader-note" role="status" aria-live="polite">
      {state.error ?? (state.loading ? "Searching earlier entries…" : "Search includes earlier entries.")}
    </p>
  );
}

/**
 * For totals and comparisons over the whole campaign: says when they cover only what is loaded,
 * with "Load all history" (progress while it runs).
 */
export function HistoryCoverage({ what = "These figures" }: { what?: string }) {
  const state = useRoomHistory();
  if (!historyIncomplete() && !state.all) return null;
  return (
    <div className="history-loader" role="group" aria-label="Campaign history">
      <p className="history-loader-note" role="status" aria-live="polite">
        {state.all
          ? `Loading the campaign's history… ${state.all.done} of ${Math.max(state.all.total, state.all.done)} steps`
          : `${what} include the history loaded on this device. Earlier entries and archived sessions are kept online.`}
      </p>
      {!state.all && (
        <Button variant="secondary" onClick={() => void loadAllHistory().catch(() => undefined)}>
          <History size={16} aria-hidden />
          Load all history
        </Button>
      )}
      {state.ledger.error || state.notes.error || state.reportError ? (
        <p className="history-loader-note" role="alert">
          {state.ledger.error ?? state.notes.error ?? state.reportError}
        </p>
      ) : null}
    </div>
  );
}

/** One archived session listed without its contents: "Load this session". */
export function LoadArchivedSession({ id, name }: { id: string; name: string }) {
  const state = useRoomHistory();
  const loading = state.reportsLoading.has(id);
  return (
    <div className="history-loader" role="group" aria-label={`Archived session ${name}`}>
      <Button
        variant="secondary"
        disabled={loading}
        aria-busy={loading}
        onClick={() => void openReport(id).catch(() => undefined)}
      >
        {loading ? <LoaderCircle size={16} className="history-loader-spin" aria-hidden /> : <History size={16} aria-hidden />}
        {loading ? "Loading this session…" : "Load this session"}
      </Button>
      {state.reportError && !loading ? (
        <p className="history-loader-note" role="alert">
          {state.reportError}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Next to totals over the current ledger (a session's received and spent): when lines older than
 * `since` are not loaded, says so and offers "Load earlier entries". Renders nothing when the
 * loaded ledger reaches back to `since`.
 */
export function LedgerCoverage({ since, ledger }: { since: number; ledger: readonly { at: number }[] }) {
  const state = useRoomHistory().ledger;
  const oldest = ledger.reduce((min, line) => Math.min(min, line.at), Number.POSITIVE_INFINITY);
  if (!state.more || oldest <= since) return null;
  return (
    <div className="history-loader" role="group" aria-label="Ledger coverage">
      <p className="history-loader-note" role="status">
        Totals cover entries since {new Date(oldest).toLocaleString()}. Earlier entries of this session are kept online.
      </p>
      <Button
        variant="secondary"
        disabled={state.loading}
        aria-busy={state.loading}
        onClick={() => void loadEarlier("ledger").catch(() => undefined)}
      >
        {state.loading ? <LoaderCircle size={16} className="history-loader-spin" aria-hidden /> : <History size={16} aria-hidden />}
        {state.loading ? LABELS.ledger.loading : LABELS.ledger.more}
      </Button>
    </div>
  );
}
