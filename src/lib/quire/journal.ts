import { z } from "zod";
import { quireDb, request } from "./db.ts";
import type { LedgerLine } from "./types.ts";
const id = z.string().min(1).max(150),
  at = z.number().int().nonnegative();
export const journalSchema = z.object({
  sessions: z
    .array(
      z.object({
        id,
        name: z.string().min(1).max(100),
        startedAt: at,
        endedAt: at.optional(),
        startLedgerIds: z.array(id).optional(),
        endLedgerIds: z.array(id).optional(),
      }),
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
        change: z
          .object({
            entity: z.enum(["stock", "realm", "shop", "holding", "account"]),
            entityId: id.optional(),
            before: z
              .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
              .nullable(),
            after: z
              .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
              .nullable(),
          })
          .optional(),
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
  const startIds = session.startLedgerIds ? new Set(session.startLedgerIds) : null;
  const endIds = session.endLedgerIds ? new Set(session.endLedgerIds) : null;
  const rows = ledger.filter(
    (x) =>
      (startIds ? !startIds.has(x.id) : x.at >= session.startedAt) &&
      (endIds ? endIds.has(x.id) : !session.endedAt || x.at < session.endedAt) &&
      (!purseIds || purseIds.includes(x.purseId)),
  );
  // An account movement is not campaign income. Legacy transfers are identified by their recorded summaries.
  const external = rows.filter((x) =>
    x.transactionType
      ? x.transactionType !== "transfer"
      : !/^(Transfer (sent|received)$|Gave )/.test(x.summary),
  );
  return {
    net: rows.reduce((n, x) => n + x.copper, 0),
    received: external.reduce((n, x) => n + Math.max(0, x.copper), 0),
    spent: external.reduce((n, x) => n + Math.max(0, -x.copper), 0),
  };
}

/** Older clients omit optional change metadata. Preserve it during their journal patches. */
export function preserveJournalMetadata(value: unknown, current: Journal): Journal {
  const next = readJournal(value);
  const changes = new Map(current.events.map(event => [event.id, event.change]));
  return { ...next, events: next.events.map(event => {
    const change = event.change ?? changes.get(event.id);
    return change ? { ...event, change } : event;
  }) };
}
