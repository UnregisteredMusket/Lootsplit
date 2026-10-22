// Declarations for the parts of monitor-journal.mjs that TypeScript sources import. The Worker
// module itself is plain JavaScript; scripts/monitor-journal.test.mjs covers its behavior.
type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first(): Promise<unknown>;
      all(): Promise<{ results: unknown[] }>;
    };
  };
};
/** [id, name, mode, expected interval ms, description] */
export const BUILTIN_LOGS: [string, string, "interval" | "event", number, string][];
/** Registers the built-in log sources and default configuration (idempotent). */
export function initializeMonitor(db: D1Like, now?: number): Promise<void>;
/** Records one log entry; extra fields become the entry body. A repeated id updates nothing. */
export function recordLog(
  db: D1Like,
  entry: { id: string; source: string; observedAt: number; summary: string; [field: string]: unknown },
  now?: number,
): Promise<void>;
