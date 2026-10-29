/**
 * The marker a working-set list carries during a command batch on the Worker (history on demand,
 * step 4; history-window.server.ts). Shared code only reads it; a plain list never has it, so on
 * the device and in every other caller nothing changes.
 */
export const HISTORY_WINDOW = Symbol.for("lootsplit.history-window");
export type HistoryWindowInfo = {
  /** Lines before the window that are not loaded. */
  readonly offset: number;
  /** The loaded (newest) lines. */
  readonly tail: unknown[];
  /** IDs of the lines the window held when it was read: they were checked when they were added. */
  readonly initialIds: ReadonlySet<string>;
  /** IDs added since, which must also be unique among the lines that are not loaded. */
  readonly pendingIds: Set<string>;
};
/** The window behind a working-set list, or undefined for an ordinary list. */
export function historyWindow(value: unknown): HistoryWindowInfo | undefined {
  return value && typeof value === "object"
    ? ((value as { [HISTORY_WINDOW]?: HistoryWindowInfo })[HISTORY_WINDOW] ?? undefined)
    : undefined;
}
