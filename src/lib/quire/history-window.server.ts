/**
 * Command batches on the working set (history on demand, step 4).
 *
 * A room read for a command batch (`readRoom(code, { working: true })`) holds only the newest
 * lines of the ledger and the chat, plus the stored history pages before them, and its archived
 * sessions are deferred (history-pages.ts). Most commands only append to those lists or look at
 * their newest line, so they run on that working set and never load the history.
 *
 * Exactness does not depend on knowing which commands those are. `runOnWorkingSet` gives the
 * command engine (commands.ts, unchanged) lists that report their true length and serve their
 * newest lines, and stop the batch the moment anything reads, searches, copies or rewrites a line
 * that is not loaded, or parses an archived session that was not read. Any such observation marks
 * the attempt as needing history even if the command catches the error, and its result is thrown
 * away; the caller then runs the same batch on the whole campaign. A batch that completes without
 * that mark observed exactly what it would have observed on the whole campaign (the same length
 * and the same lines), so it produces exactly the same result.
 */
import { DEFERRED_REPORT_PREFIX } from "./history-pages.ts";
import { HISTORY_WINDOW, type HistoryWindowInfo } from "./history-window.ts";

/** Thrown inside a working-set attempt that needs history; the caller reruns on the whole campaign. */
export class HistoryNeeded extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("This action needs the campaign's earlier history.");
    this.reason = reason;
  }
}

type Window = { offset: number; tail: unknown[]; shared: Shared };
/** Per list and attempt: the window's IDs as read, and IDs added since (history-window.ts). */
type Shared = { initialIds: ReadonlySet<string>; pendingIds: Set<string> };
/** Test-only diagnostics: where the last attempt first needed history. */
let traceTrips = false;
export const lastTrip: { stack: string } = { stack: "" };
export function traceHistoryTripsForTests(on: boolean) {
  traceTrips = on;
}
/** Proxy -> its window. */
const windows = new WeakMap<object, Window>();
/** The paged lists of a table. */
const LISTS = ["ledger", "notes"] as const;

const INDEX = /^(?:0|[1-9]\d*)$/;
const isIndex = (key: string | symbol): key is string => typeof key === "string" && INDEX.test(key) && Number(key) < 2 ** 32 - 1;

/** The newest `tail` lines of a list of `offset + tail.length`, guarded by `trip`. */
function windowList(tail: unknown[], offset: number, trip: (reason: string) => never, shared: Shared): unknown[] {
  const state: Window = { offset, tail, shared };
  const info: HistoryWindowInfo = {
    get offset() {
      return state.offset;
    },
    get tail() {
      return state.tail;
    },
    initialIds: shared.initialIds,
    pendingIds: shared.pendingIds,
  };
  const proxy: unknown[] = new Proxy<unknown[]>([], {
    get(target, key, receiver) {
      if (key === "length") return state.offset + state.tail.length;
      if (key === HISTORY_WINDOW) return info;
      if (isIndex(key)) {
        const index = Number(key);
        if (index < state.offset) trip("read");
        return state.tail[index - state.offset];
      }
      return Reflect.get(target, key, receiver);
    },
    set(_target, key, value) {
      if (key === "length") {
        const length = Number(value);
        if (!Number.isSafeInteger(length) || length < state.offset) trip("truncate");
        state.tail.length = length - state.offset;
        return true;
      }
      if (isIndex(key) && Number(key) >= state.offset) {
        state.tail[Number(key) - state.offset] = value;
        return true;
      }
      return trip("write");
    },
    has(target, key) {
      if (key === "length") return true;
      if (isIndex(key)) {
        const index = Number(key);
        if (index < state.offset) trip("read");
        return index - state.offset < state.tail.length && index - state.offset in state.tail;
      }
      return Reflect.has(target, key);
    },
    deleteProperty(_target, key) {
      if (isIndex(key) && Number(key) >= state.offset) return delete state.tail[Number(key) - state.offset];
      return trip("delete");
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === "length") return { value: state.offset + state.tail.length, writable: true, enumerable: false, configurable: false };
      if (isIndex(key)) {
        const index = Number(key);
        if (index < state.offset) trip("read");
        const at = index - state.offset;
        return at < state.tail.length && at in state.tail
          ? { value: state.tail[at], writable: true, enumerable: true, configurable: true }
          : undefined;
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    defineProperty: () => trip("define"),
    ownKeys: () => trip("keys"),
    setPrototypeOf: () => trip("prototype"),
    preventExtensions: () => trip("freeze"),
  });
  windows.set(proxy, state);
  return proxy;
}

type Table = Record<string, unknown>;

/**
 * Runs `apply` (synchronous: the command engine) on `table` with its paged lists windowed after
 * `offsets` (`{ ledger: n }`: n older lines are not loaded). Returns the resulting table with plain
 * lists (the windows, with whatever was appended), and the line IDs added to each list that must
 * also be unique among its unloaded lines (the caller checks them against the stored pages before
 * writing; validation.ts records them). Throws `HistoryNeeded` when the batch needs history.
 *
 * During the call, the global `structuredClone` copies a table's windowed lists as windows (the
 * engine copies the table before changing it) and `JSON.parse` refuses a deferred archived
 * session. Both are restored before returning; the engine is synchronous, so nothing else runs
 * in between.
 */
export function runOnWorkingSet<T extends object>(
  table: T,
  offsets: Partial<Record<(typeof LISTS)[number], number>>,
  apply: (table: T) => T,
): { table: T; pendingIds: Partial<Record<(typeof LISTS)[number], string[]>> } {
  let tripped: string | null = null;
  const trip = (reason: string): never => {
    if (tripped === null) {
      tripped = reason;
      if (traceTrips) lastTrip.stack = new Error(reason).stack ?? reason;
    }
    throw new HistoryNeeded(reason);
  };
  const shared = new Map<string, Shared>();
  const wrap = (value: Table): Table => {
    const copy = { ...value };
    for (const list of LISTS) {
      const offset = offsets[list] ?? 0;
      const current = copy[list];
      if (offset > 0 && Array.isArray(current)) {
        const ids = new Set(current.map((line) => (line as { id?: unknown })?.id).filter((id): id is string => typeof id === "string"));
        shared.set(list, { initialIds: ids, pendingIds: new Set() });
        copy[list] = windowList(current, offset, trip, shared.get(list)!);
      }
    }
    return copy;
  };
  const clone = globalThis.structuredClone;
  const parse = JSON.parse;
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const own = LISTS.filter((list) => windows.has((value as Table)[list] as object));
      if (own.length) {
        // A table with windowed lists: copy it with the windows' lines, then window the copies.
        const plain: Table = { ...(value as Table) };
        const states = own.map((list) => windows.get(plain[list] as object)!);
        own.forEach((list, i) => (plain[list] = states[i]!.tail));
        const copy = clone(plain, options) as Table;
        own.forEach((list, i) => (copy[list] = windowList(copy[list] as unknown[], states[i]!.offset, trip, states[i]!.shared)));
        return copy;
      }
    }
    try {
      return clone(value, options);
    } catch (error) {
      // A windowed list deeper inside the value cannot be copied: that needs the whole list.
      if (error instanceof Error && error.name === "DataCloneError") trip("clone");
      throw error;
    }
  }) as typeof structuredClone;
  JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    if (typeof text === "string" && text.charCodeAt(0) === 0 && text.startsWith(DEFERRED_REPORT_PREFIX)) trip("reports");
    return parse(text, reviver);
  }) as typeof JSON.parse;
  let result: T;
  try {
    result = apply(wrap(table as unknown as Table) as unknown as T);
  } catch (error) {
    if (tripped !== null) throw new HistoryNeeded(tripped);
    throw error;
  } finally {
    globalThis.structuredClone = clone;
    JSON.parse = parse;
  }
  if (tripped !== null) throw new HistoryNeeded(tripped);
  // Back to plain lists: each must still be the window it was given (or one copied from it).
  const out = { ...(result as unknown as Table) };
  const pendingIds: Partial<Record<(typeof LISTS)[number], string[]>> = {};
  for (const list of LISTS) {
    if ((offsets[list] ?? 0) <= 0) continue;
    const state = windows.get(out[list] as object);
    if (!state || state.offset !== offsets[list]) throw new HistoryNeeded("replaced");
    out[list] = [...state.tail];
    if (state.shared.pendingIds.size) pendingIds[list] = [...state.shared.pendingIds];
  }
  return { table: out as unknown as T, pendingIds };
}
