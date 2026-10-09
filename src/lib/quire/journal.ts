import { z } from "zod";
import { worldSchema } from "./world-schema.ts";
import { validateWorld } from "./world.ts";
import { estateSchema } from "./estate-schema.ts";
import { validateEstate } from "./estate.ts";
import { marketLocationsSchema, validateShopLocations } from "./shop-locations.ts";
import { validateEconomyRows } from "./validation.ts";
import { validatePropertyLocations, listingSchema } from "./property.ts";
import type { CloudTable } from "./cloud.ts";
import { sheetSchema } from "../characters/model.mjs";
import { financeSchema } from "./finance.ts";
import { quireDb, request } from "./db.ts";
import type { LedgerLine } from "./types.ts";
const id = z.string().min(1).max(150),
  at = z.number().int().nonnegative();
/** Optional receipt identity; it carries no recipient, financial or enemy data. */
export const encounterLootProvenanceSchema = z.object({
  kind: z.literal("encounter-loot"),
  encounterId: id,
  receiptId: z.string().min(1).max(120),
  sessionId: id.optional(),
}).strict();
export type EncounterLootProvenance = z.infer<typeof encounterLootProvenanceSchema>;
export const encounterLootEntryId = (receiptId: string) => `encounter-loot:${receiptId}`;
const journalFields = z.object({
  world: worldSchema.optional(),
  propertyOperations: estateSchema.optional(),
  market: marketLocationsSchema.optional(),
  downtimePrompt: z
    .object({ enabled: z.boolean(), days: z.number().int().min(0).max(3650) })
    .optional(),
  finance: financeSchema.optional(),
  reports: z
    .array(
      z.object({
        id,
        name: z.string().max(100),
        at,
        seatIds: z.array(id).optional(),
        snapshot: z.string(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  entries: z
    .array(
      z.object({
        id,
        at,
        authorId: id,
        purseId: z.string(),
        visibility: z.enum(["dm", "party", "player"]),
        title: z.string().max(100),
        text: z.string().max(12000),
        reportIds: z.array(id).default([]),
        provenance: encounterLootProvenanceSchema.optional(),
      }),
    )
    .optional(),
  editReports: z
    .array(
      z.object({ id, purseId: id, name: z.string(), at, before: sheetSchema, after: sheetSchema }),
    )
    .optional(),
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
        propertyId: id.optional(),
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
export const journalSchema = journalFields.superRefine((journal, ctx) => {
  for (const [index, report] of (journal.reports || []).entries()) {
    try { readCompleteArchive(report); }
    catch { ctx.addIssue({ code: "custom", path: ["reports", index, "snapshot"],
      message: "An archived report has an invalid campaign snapshot or unreadable diagnostic placeholder. The current campaign was not changed." }); }
  }
});

function readCompleteArchive(report: { snapshot: string; error?: string }): CloudTable {
  if (report.error !== undefined) throw Error("An unreadable diagnostic placeholder is not a complete archived report.");
  return readArchivedSnapshot(report.snapshot);
}

/** Validate an archive without recursively invoking the outer journal refinement. */
export function readArchivedSnapshot(snapshot: string): CloudTable {
  const root: unknown = JSON.parse(snapshot);
  const pending: { table: unknown; depth: number }[] = [{ table: root, depth: 0 }];
  while (pending.length) {
    const { table, depth } = pending.pop()!;
    if (!table || typeof table !== "object" || depth > 32)
      throw Error("Archived report nesting is invalid.");
    const t = table as CloudTable;
    validateEconomyRows(t);
    const journal = journalFields.parse(t.journal ?? {});
    validateShopLocations(t.shops, journal.market);
    for (const listing of t.listings ?? []) listingSchema.parse(listing);
    validatePropertyLocations(t.listings ?? [], t.holdings, journal.market);
    validateEstate({ ...t, journal }, true);
    validateWorld({ ...t, journal }, true);
    for (const key of ["notes", "sheets", "loans", "listings", "handouts"] as const)
      if (t[key] !== undefined && !Array.isArray(t[key])) throw Error("Invalid archived records.");
    if (!z.array(z.object({ id: z.string(), at: z.number().finite(), from: z.enum(["dm", "player"]),
      to: z.enum(["dm", "party", "player"]), purseId: z.string(), text: z.string(),
      recipientId: z.string().optional() })).safeParse(t.notes ?? []).success)
      throw Error("Invalid archived messages.");
    for (const report of journal.reports || []) {
      if (report.error !== undefined) throw Error("An unreadable diagnostic placeholder is not a complete archived report.");
      pending.push({ table: JSON.parse(report.snapshot), depth: depth + 1 });
    }
  }
  const table = root as CloudTable;
  return { ...table, notes: table.notes ?? [], sheets: table.sheets ?? [], loans: table.loans ?? [],
    listings: table.listings ?? [], handouts: table.handouts ?? [] };
}

/** Existing unreadable archives remain discoverable without breaking other authorized records. */
export const readJournalForRecords = (value: unknown) => journalFields.parse(value ?? {});
export type Journal = z.infer<typeof journalSchema>;
/** Stored journal fields remain usable even when one legacy archive needs recovery. */
export function readJournal(value: unknown): Journal {
  return journalFields.parse(value ?? {});
}
/** Untrusted imports/new rooms must contain fully projectable archived snapshots. */
export function readValidatedJournal(value: unknown): Journal {
  return journalSchema.parse(value ?? {});
}
export async function loadJournal(): Promise<Journal> {
  const db = await quireDb();
  const row = await request<{ value: unknown } | undefined>(
    db.transaction("meta").objectStore("meta").get("journal"),
  );
  return readJournal(row?.value);
}
export function selectSessionLedgerRows(
  ledger: LedgerLine[],
  session: Journal["sessions"][number],
  purseIds?: string[],
) {
  const startIds = session.startLedgerIds ? new Set(session.startLedgerIds) : null;
  const endIds = session.endLedgerIds ? new Set(session.endLedgerIds) : null;
  return ledger.filter(
    (x) =>
      (startIds ? !startIds.has(x.id) : x.at >= session.startedAt) &&
      (endIds ? endIds.has(x.id) : !session.endedAt || x.at < session.endedAt) &&
      (!purseIds || purseIds.includes(x.purseId)),
  );
}
// An account movement is not campaign income. Legacy transfers use their recorded summaries.
export function isExternalLedgerLine(row: LedgerLine): boolean {
  return row.transactionType ? row.transactionType !== "transfer" : !/^(Transfer (sent|received)$|Gave )/.test(row.summary);
}
export function sessionSummary(
  ledger: LedgerLine[],
  session: Journal["sessions"][number],
  purseIds?: string[],
) {
  const rows = selectSessionLedgerRows(ledger, session, purseIds);
  const external = rows.filter(isExternalLedgerLine);
  return {
    net: rows.reduce((n, x) => n + x.copper, 0),
    received: external.reduce((n, x) => n + Math.max(0, x.copper), 0),
    spent: external.reduce((n, x) => n + Math.max(0, -x.copper), 0),
  };
}

/** Older clients omit optional change metadata. Preserve it during their journal patches. */
export function preserveJournalMetadata(value: unknown, current: Journal): Journal {
  const next = readJournal(value);
  const reports = new Map((current.reports || []).map(report => [report.id, report]));
  for (const report of next.reports || []) {
    // An archive is immutable. Hydrated error placeholders and stale client copies must
    // never replace the authoritative source bytes of an existing record.
    if (!reports.has(report.id)) {
      readCompleteArchive(report);
      reports.set(report.id, report);
    }
  }
  const changes = new Map(current.events.map((event) => [event.id, event.change]));
  const entries = new Map((current.entries || []).map(entry => [entry.id, entry]));
  for (const entry of next.entries || []) {
    const provenance = entries.get(entry.id)?.provenance ?? entry.provenance;
    // Older clients do not know this optional field. Keep a confirmed record's
    // stable association when they write the same entry back without it.
    entries.set(entry.id, provenance ? { ...entry, provenance } : entry);
  }
  return readJournal({
    ...next,
    ...((next.downtimePrompt ?? current.downtimePrompt)
      ? { downtimePrompt: next.downtimePrompt ?? current.downtimePrompt }
      : {}),
    ...(next.finance && next.finance.minuteOfDay===undefined && current.finance?.minuteOfDay!==undefined ? {finance:{...next.finance,minuteOfDay:current.finance.minuteOfDay}} : {}),
    ...(next.finance ? {} : current.finance ? { finance: current.finance } : {}),
    ...(next.world ? {} : current.world ? { world: current.world } : {}),
    ...(next.market ? {} : current.market ? { market: current.market } : {}),
    ...(next.propertyOperations ? {} : current.propertyOperations ? { propertyOperations: current.propertyOperations } : {}),
    ...(current.reports || next.reports
      ? {
          reports: [...reports.values()],
        }
      : {}),
    ...(current.entries || next.entries
      ? {
          entries: [...entries.values()],
        }
      : {}),
    ...(current.editReports || next.editReports
      ? {
          editReports: [
            ...new Map(
              [...(current.editReports || []), ...(next.editReports || [])].map((r) => [r.id, r]),
            ).values(),
          ],
        }
      : {}),
    events: next.events.map((event) => {
      const change = event.change ?? changes.get(event.id);
      return change ? { ...event, change } : event;
    }),
  });
}
