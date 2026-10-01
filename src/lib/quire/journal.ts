import { z } from "zod";
import { quireDb, request } from "./db.ts";
import type { LedgerLine } from "./types.ts";
const id = z.string().min(1).max(150),
  at = z.number().int().nonnegative();
export const journalSchema = z.object({
  sessions: z
    .array(
      z.object({ id, name: z.string().min(1).max(100), startedAt: at, endedAt: at.optional() }),
    )
    .default([]),
  requests: z
    .array(
      z.object({
        id,
        purseId: id,
        note: z.string().min(1).max(1000),
        copper: z.number().int().positive().max(1e12),
        at,
        status: z.enum(["pending", "approved", "denied"]),
      }),
    )
    .default([]),
  events: z
    .array(
      z.object({
        id,
        at,
        summary: z.string().max(500),
        kind: z.enum(["management", "prices", "request", "session"]),
        purseId: id.optional(),
      }),
    )
    .default([]),
});
export type Journal = z.infer<typeof journalSchema>;
export function readJournal(value: unknown): Journal {
  return journalSchema.parse(value ?? {});
}
export async function loadJournal(): Promise<Journal> {
  const db = await quireDb();
  const row = await request<{ value: unknown } | undefined>(
    db.transaction("meta").objectStore("meta").get("journal"),
  );
  return readJournal(row?.value);
}
export function sessionSummary(
  ledger: LedgerLine[],
  session: Journal["sessions"][number],
  purseIds?: string[],
) {
  const rows = ledger.filter(
    (x) =>
      x.at >= session.startedAt &&
      (!session.endedAt || x.at < session.endedAt) &&
      (!purseIds || purseIds.includes(x.purseId)),
  );
  // An account movement is not campaign income. Legacy transfers are identified by their recorded summaries.
  const external = rows.filter((x) => !/^(Transfer (sent|received)$|Gave )/.test(x.summary));
  return {
    net: rows.reduce((n, x) => n + x.copper, 0),
    received: external.reduce((n, x) => n + Math.max(0, x.copper), 0),
    spent: external.reduce((n, x) => n + Math.max(0, -x.copper), 0),
  };
}
