import type { CloudSeat, CloudTable } from "./cloud.ts";
import { readArchivedSnapshot, sessionSummary, type Journal } from "./journal.ts";
import { projectRecord } from "./session-records.ts";
import type { LedgerLine } from "./types.ts";

export type ArchiveInput = { snapshot: unknown; error?: string };
export type ArchiveSeat = Pick<CloudSeat, "role" | "purseIds"> & {
  id?: string;
  ownedDevice?: boolean;
};
export type ArchiveResult =
  { available: true; snapshot: CloudTable } | { available: false; error: string };

const unavailable =
  "This archived report cannot be read. Totals are unavailable. Keep its original backup for recovery.";

/** A reader never repairs, replaces or interprets a diagnostic placeholder as history. */
export function readArchiveResult(report: ArchiveInput, seat?: ArchiveSeat): ArchiveResult {
  if (report.error !== undefined) return { available: false, error: unavailable };
  try {
    const snapshot = readArchivedSnapshot(
      typeof report.snapshot === "string" ? report.snapshot : JSON.stringify(report.snapshot),
    );
    return {
      available: true,
      snapshot: seat ? projectRecord(snapshot, seat, { ownedDevice: seat.ownedDevice }) : snapshot,
    };
  } catch {
    // Do not echo malformed bytes or private data into an error message.
    return { available: false, error: unavailable };
  }
}

/** Existing unarchived records use their ledger; damaged archives never fall back to live data. */
export function readSessionSummary(
  session: Journal["sessions"][number],
  ledger: LedgerLine[],
  archive?: ArchiveInput,
  seat?: ArchiveSeat,
) {
  const result = archive ? readArchiveResult(archive, seat) : undefined;
  if (result && !result.available) return result;
  return {
    available: true as const,
    summary: sessionSummary(
      result?.snapshot.ledger ?? ledger,
      session,
      seat?.role === "player" ? seat.purseIds : undefined,
    ),
  };
}
