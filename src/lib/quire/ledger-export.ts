/**
 * Ledger CSV export (loot plan phase 6). Built on the device from the whole stored campaign: every
 * archived session (oldest first) and the live ledger and Activity events. Nothing is stored and
 * no server route is involved.
 *
 * Privacy: a player's file holds exactly what their seat's view holds. The live table is
 * projected as `economyView` projects it for a player seat, and each archived session as the
 * session reader reads it (`readArchiveResult` with the reader seat), so other players' private
 * purses, hidden NPC treasuries and DM-only events never reach the file. The DM's file holds
 * everything the DM's view holds.
 *
 * Completeness: an archived session that is still kept online (not loaded) makes the export
 * refuse (`LedgerExportIncomplete`); callers load the whole campaign first (cloud-client.ts
 * `loadWholeCampaignForExport`, the loader Download a copy uses). An archived session that cannot
 * be read is an explicit gap row, never a silent omission.
 */
import type { ArchiveSeat } from "./archive-reader.ts";
import { readArchiveResult } from "./archive-reader.ts";
import type { CloudTable } from "./cloud.ts";
import { isDeferredSnapshot } from "./history-pages.ts";
import { formatCopper } from "./money.ts";
import { projectRecord } from "./session-records.ts";
import type { LedgerLine } from "./types.ts";

export class LedgerExportIncomplete extends Error {
  constructor() {
    super(
      "Part of this campaign's history is not loaded, so the export would be incomplete. Nothing was downloaded. Check the connection and try again.",
    );
    this.name = "LedgerExportIncomplete";
  }
}

export const LEDGER_CSV_COLUMNS = [
  "Date and time",
  "Session",
  "Record",
  "Purse or account",
  "Counterparty",
  "Summary",
  "Type",
  "Amount (cp)",
  "Amount",
  "Purse total in this file (cp)",
  "Receipt ID",
  "Group ID",
  "DM only",
] as const;

export type LedgerExportRow = {
  at: number;
  session: string;
  record: "ledger" | "event" | "gap";
  purse: string;
  counterparty: string;
  summary: string;
  type: string;
  copper: number | null;
  runningTotal: number | null;
  id: string;
  groupId: string;
  dmOnly: boolean;
};

type Part = { table: CloudTable; fallbackSession: string };
type Journal = NonNullable<CloudTable["journal"]>;

function lineType(line: LedgerLine): string {
  if (line.transactionType) return line.transactionType;
  if (line.split) return "split";
  if (line.loot) return "treasure pool";
  if (line.award) return "award";
  return "transaction";
}

function groupId(line: LedgerLine): string {
  return (
    line.split?.id ??
    line.trade?.receiptId ??
    line.loot?.id ??
    line.award?.receiptId ??
    line.reversalOf ??
    ""
  );
}

function sessionAt(journal: Journal | undefined, at: number, fallback: string): string {
  const found = (journal?.sessions ?? []).find(
    (s) => s.startedAt <= at && (s.endedAt === undefined || at <= s.endedAt),
  );
  return found?.name ?? fallback;
}

/**
 * The rows of the export for `seat`, oldest first. `table` is this device's stored campaign (for
 * a shared campaign, the seat's server view with its history loaded). Throws
 * `LedgerExportIncomplete` while an archived session is not loaded.
 */
export function ledgerExportRows(table: CloudTable, seat: ArchiveSeat): LedgerExportRow[] {
  const dm = seat.role === "dm";
  // The same projection economyView gives a player seat; the DM's view is the stored table.
  const view = dm
    ? table
    : projectRecord(table, seat, { directory: true, tabletopProjected: seat.tabletopProjected });
  const reports = [...(view.journal?.reports ?? [])].sort((a, b) => a.at - b.at);
  const parts: Part[] = [];
  const rows: LedgerExportRow[] = [];
  for (const report of reports) {
    if (isDeferredSnapshot(report.snapshot)) throw new LedgerExportIncomplete();
    const result = readArchiveResult(report, seat);
    if (!result.available) {
      if (result.deferred) throw new LedgerExportIncomplete();
      rows.push({
        at: report.at,
        session: report.name,
        record: "gap",
        purse: "",
        counterparty: "",
        summary:
          "This archived session cannot be read, so its lines are not in this file. Keep its original backup for recovery.",
        type: "unreadable archive",
        copper: null,
        runningTotal: null,
        id: report.id,
        groupId: "",
        dmOnly: false,
      });
      continue;
    }
    parts.push({ table: result.snapshot, fallbackSession: report.name });
  }
  parts.push({ table: view, fallbackSession: "" });

  const seen = new Set<string>();
  for (const { table: part, fallbackSession } of parts) {
    const purseName = (id: string | undefined) =>
      (id && (part.purses.find((p) => p.id === id) ?? view.purses.find((p) => p.id === id))?.name) || "";
    const shopName = (id: string | null) =>
      (id && (part.shops.find((s) => s.id === id) ?? view.shops.find((s) => s.id === id))?.name) || "";
    for (const line of part.ledger ?? []) {
      const key = "l:" + line.id;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        at: line.at,
        session: sessionAt(part.journal, line.at, fallbackSession),
        record: "ledger",
        purse: purseName(line.purseId),
        counterparty: shopName(line.shopId),
        summary: line.summary,
        type: lineType(line),
        copper: line.copper,
        runningTotal: null,
        id: line.id,
        groupId: groupId(line),
        dmOnly: false,
      });
    }
    for (const event of part.journal?.events ?? []) {
      const key = "e:" + event.id;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        at: event.at,
        session: sessionAt(part.journal, event.at, fallbackSession),
        record: "event",
        purse: purseName(event.purseId),
        counterparty: "",
        summary: event.summary,
        type: event.kind,
        copper: null,
        runningTotal: null,
        id: event.id,
        groupId: event.split?.id ?? "",
        dmOnly: dm && !!event.dmOnly,
      });
    }
  }
  rows.sort((a, b) => a.at - b.at);
  // Running totals per purse over the lines in this file (cheap; not a balance check).
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.record !== "ledger" || row.copper === null) continue;
    const next = (totals.get(row.purse) ?? 0) + row.copper;
    totals.set(row.purse, next);
    row.runningTotal = next;
  }
  return rows;
}

/** A spreadsheet cannot run a cell as a formula: text starting =, +, - or @ gets an apostrophe. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local date and time a spreadsheet reads as a date: 2026-11-04 18:05:09. */
export function csvDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function ledgerCsv(rows: LedgerExportRow[]): string {
  const lines = [LEDGER_CSV_COLUMNS.map(csvCell).join(",")];
  for (const row of rows)
    lines.push(
      [
        csvDate(row.at),
        row.session,
        row.record,
        row.purse,
        row.counterparty,
        row.summary,
        row.type,
        row.copper,
        row.copper === null ? "" : formatCopper(row.copper),
        row.runningTotal,
        row.id,
        row.groupId,
        row.dmOnly ? "yes" : "",
      ]
        .map(csvCell)
        .join(","),
    );
  // Byte order mark so spreadsheet apps read the file as UTF-8; CRLF rows (RFC 4180).
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function ledgerExportFileName(seat: ArchiveSeat, at = Date.now()): string {
  const d = new Date(at);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `lootsplitter-${seat.role === "dm" ? "ledger" : "my-ledger"}-${day}.csv`;
}
