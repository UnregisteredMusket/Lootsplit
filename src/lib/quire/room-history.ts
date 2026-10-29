/**
 * History on demand, browser side (tabletop protocol 12; history-pages.ts has the overview).
 *
 * A shared room view holds the newest ledger and chat lines and lists archived sessions without
 * their snapshots. This store keeps, for the seat this tab uses, the older pages and archived
 * sessions someone has opened in this tab (in memory only), and `mergeHistory` puts them back into
 * every view before it reaches the device table, so every screen sees the lines it has loaded.
 *
 * - `loadEarlier(list)` reads the next older batch of a list (`readCloudHistory`), following the
 *   per-seat cursors of the view; pages already held are named by hash and not sent again.
 * - `openReport(id)` reads one archived session.
 * - `loadAllHistory()` reads everything (before a device export or a comparison over the whole
 *   campaign), with progress.
 *
 * Nothing here writes: loading history never changes the campaign.
 */
import type { CloudTable } from "./cloud.ts";
import { HISTORY_LISTS, HISTORY_PROTOCOL, type HistoryCursors, type HistoryList } from "./history-pages.ts";

type Scope = { code: string; token: string };
type Page = { cursor: string; prev: string | null; hash: string; items: unknown[] };
type ArchivedReport = NonNullable<NonNullable<CloudTable["journal"]>["reports"]>[number];
type HistoryResponse =
  | { revision: number; missing: true }
  | { revision: number; list: HistoryList; pages: { cursor: string; prev: string | null; hash: string; items?: unknown[] }[]; next: string | null }
  | { revision: number; report: string; hash: string; value?: ArchivedReport };
type Reader = (options: {
  data: Scope & { tabletopProtocol: number; list?: HistoryList; before?: string; report?: string; held?: string[]; bulk?: boolean };
}) => Promise<unknown>;

export type HistoryListState = {
  /** Older lines are available on the server and not loaded in this tab. */
  more: boolean;
  /** Older lines this tab holds (merged into the campaign). */
  loaded: number;
  loading: boolean;
  error: string | null;
};
export type HistoryState = {
  ledger: HistoryListState;
  notes: HistoryListState;
  /** Archived sessions this tab has opened, by report ID. */
  reports: ReadonlySet<string>;
  /** Report IDs being read. */
  reportsLoading: ReadonlySet<string>;
  reportError: string | null;
  /** `loadAllHistory` progress: steps done of steps known so far, or null when not running. */
  all: { done: number; total: number } | null;
};

let reader: Reader | null = null;
/** Set by the shared-room client (cloud-client.ts): the server function, and how to re-merge. */
export function connectRoomHistory(read: Reader) {
  reader = read;
}

let scopeKey = "";
let scope: Scope | null = null;
let cursors: HistoryCursors = {};
let pages: Record<HistoryList, Map<string, Page>> = { ledger: new Map(), notes: new Map() };
let reports = new Map<string, { hash: string; value: ArchivedReport }>();
let deferredIds: string[] = [];
const loading = new Set<string>();
const errors: Record<string, string | null> = {};
let reportError: string | null = null;
let all: HistoryState["all"] = null;
let snapshot: HistoryState | null = null;
const listeners = new Set<() => void>();
const changeHandlers = new Set<() => void>();

function changed(merge: boolean) {
  snapshot = null;
  for (const fn of listeners) fn();
  if (merge) for (const fn of changeHandlers) fn();
}
/** Called after loaded history changes, so the device table is merged again. */
export function onRoomHistoryLoaded(fn: () => void) {
  changeHandlers.add(fn);
  return () => changeHandlers.delete(fn);
}
export function subscribeRoomHistory(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Pages of `list` this tab holds that connect to the view's cursor, oldest first. */
function chain(list: HistoryList): { pages: Page[]; next: string | null } {
  const found: Page[] = [];
  let cursor = cursors[list] ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const page = pages[list].get(cursor);
    if (!page) return { pages: found.reverse(), next: cursor };
    found.push(page);
    cursor = page.prev;
  }
  return { pages: found.reverse(), next: null };
}

function listState(list: HistoryList): HistoryListState {
  const { pages: held, next } = chain(list);
  return {
    more: !!next,
    loaded: held.reduce((sum, page) => sum + page.items.length, 0),
    loading: loading.has(list),
    error: errors[list] ?? null,
  };
}
export function getRoomHistory(): HistoryState {
  return (snapshot ??= {
    ledger: listState("ledger"),
    notes: listState("notes"),
    reports: new Set(reports.keys()),
    reportsLoading: new Set([...loading].filter((key) => key.startsWith("report:")).map((key) => key.slice(7))),
    reportError,
    all,
  });
}

function reset(next: Scope | null) {
  scope = next;
  scopeKey = next ? `${next.code.trim().toUpperCase()}\n${next.token}` : "";
  cursors = {};
  pages = { ledger: new Map(), notes: new Map() };
  reports = new Map();
  deferredIds = [];
  loading.clear();
  for (const key of Object.keys(errors)) delete errors[key];
  reportError = null;
  all = null;
}
/** Forget everything (leaving a room, another account). */
export function clearRoomHistory() {
  reset(null);
  changed(false);
}

/**
 * Called with every accepted room view: its seat and cursors. Another seat or campaign starts
 * over. When new pages were sealed above what this tab already loaded, the gap is read at once
 * (older lines someone opened stay visible).
 */
export function noteRoomView(seat: Scope, view: { history?: HistoryCursors; table: CloudTable }) {
  const key = `${seat.code.trim().toUpperCase()}\n${seat.token}`;
  if (key !== scopeKey) reset(seat);
  cursors = { ...(view.history ?? {}) };
  deferredIds = (view.table.journal?.reports ?? []).filter((r) => r.deferred).map((r) => r.id);
  for (const id of [...reports.keys()]) if (!(view.table.journal?.reports ?? []).some((r) => r.id === id)) reports.delete(id);
  snapshot = null;
  for (const fn of listeners) fn();
  for (const list of HISTORY_LISTS) {
    const { pages: held, next } = chain(list);
    if (next && !held.length && pages[list].size && !loading.has(list)) void loadEarlier(list).catch(() => undefined);
  }
}

/** The view's table with this tab's loaded history put back: older lines first, sessions opened. */
export function mergeHistory<T extends CloudTable>(table: T): T {
  if (!scope) return table;
  let result: T = table;
  for (const list of HISTORY_LISTS) {
    const older = chain(list).pages.flatMap((page) => page.items);
    if (!older.length) continue;
    const current = result[list] as unknown as { id?: string }[];
    const ids = new Set(current.map((line) => line.id));
    result = { ...result, [list]: [...older.filter((line) => !ids.has((line as { id?: string }).id)), ...current] };
  }
  const journal = result.journal;
  if (journal?.reports?.some((r) => r.deferred && reports.has(r.id)))
    result = {
      ...result,
      journal: { ...journal, reports: journal.reports.map((r) => (r.deferred && reports.has(r.id) ? reports.get(r.id)!.value : r)) },
    };
  return result;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Earlier history could not be loaded. Try again.";
const MOVED = "The campaign changed while earlier history was loading. Try again.";

async function read(data: { list?: HistoryList; before?: string; report?: string; held?: string[]; bulk?: boolean }) {
  if (!reader || !scope) throw Error("Open a shared campaign to load its earlier history.");
  return (await reader({ data: { ...scope, tabletopProtocol: HISTORY_PROTOCOL, ...data } })) as HistoryResponse;
}

/**
 * Reads the next older batch of `list` (about 400 visible lines). Resolves to whether more remain.
 * Safe to call repeatedly; a call while one runs waits for it.
 */
const running = new Map<string, Promise<boolean>>();
export function loadEarlier(list: HistoryList, options: { bulk?: boolean } = {}): Promise<boolean> {
  const active = running.get(list);
  if (active) return active;
  const work = (async () => {
    const key = scopeKey;
    const start = chain(list).next;
    if (!start) return false;
    loading.add(list);
    errors[list] = null;
    changed(false);
    try {
      const held = [...pages[list].values()].map((page) => page.hash).slice(-512);
      const result = await read({ list, before: start, held, ...(options.bulk ? { bulk: true } : {}) });
      if (key !== scopeKey) return false;
      if ("missing" in result) throw Error(MOVED);
      if (!("pages" in result)) throw Error(MOVED);
      for (const page of result.pages) {
        const items = page.items ?? [...pages[list].values()].find((p) => p.hash === page.hash)?.items;
        if (!items) throw Error(MOVED);
        pages[list].set(page.cursor, { cursor: page.cursor, prev: page.prev, hash: page.hash, items });
      }
      return !!chain(list).next;
    } catch (error) {
      if (key === scopeKey) errors[list] = message(error);
      throw error;
    } finally {
      if (key === scopeKey) {
        loading.delete(list);
        changed(true);
      }
      running.delete(list);
    }
  })();
  running.set(list, work);
  return work;
}

/** Reads one archived session (the view lists it without its snapshot). */
export async function openReport(id: string): Promise<void> {
  if (reports.has(id)) return;
  const key = scopeKey;
  const loadingKey = `report:${id}`;
  if (loading.has(loadingKey)) return;
  loading.add(loadingKey);
  reportError = null;
  changed(false);
  try {
    const result = await read({ report: id });
    if (key !== scopeKey) return;
    if ("missing" in result || !("report" in result) || !result.value) throw Error(MOVED);
    reports.set(id, { hash: result.hash, value: result.value });
  } catch (error) {
    if (key === scopeKey) reportError = message(error);
    throw error;
  } finally {
    if (key === scopeKey) {
      loading.delete(loadingKey);
      changed(true);
    }
  }
}

/** True when the view holds less than the whole campaign this seat may read. */
export function historyIncomplete(): boolean {
  return HISTORY_LISTS.some((list) => !!chain(list).next) || deferredIds.some((id) => !reports.has(id));
}

/**
 * Reads every older line and archived session this seat may see, with progress (`all`), before
 * something that needs the whole campaign: a device export or online backup, or a comparison
 * across every session ("favour whoever is behind").
 */
export async function loadAllHistory(): Promise<void> {
  if (!scope || !historyIncomplete()) return;
  const key = scopeKey;
  all = { done: 0, total: deferredIds.filter((id) => !reports.has(id)).length + HISTORY_LISTS.filter((l) => chain(l).next).length };
  changed(false);
  try {
    for (const list of HISTORY_LISTS)
      while (key === scopeKey && chain(list).next) {
        const more = await loadEarlier(list, { bulk: true });
        all = { done: all!.done + (more ? 0 : 1), total: all!.total + (more ? 1 : 0) };
        changed(false);
        if (!more) break;
      }
    for (const id of deferredIds) {
      if (key !== scopeKey) return;
      if (!reports.has(id)) await openReport(id);
      all = { done: all!.done + 1, total: all!.total };
      changed(false);
    }
  } finally {
    if (key === scopeKey) {
      all = null;
      changed(false);
    }
  }
}

if (typeof window !== "undefined") window.addEventListener("lootsplit-account-changed", () => clearRoomHistory());

/** Test-only. */
export function roomHistoryForTests() {
  return { scopeKey, cursors, pages, reports, deferredIds };
}
