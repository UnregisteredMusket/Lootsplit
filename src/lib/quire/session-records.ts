import type { CloudTable, CloudSeat } from "./cloud.ts";
import { canReadNote } from "./chat-visibility.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { readFinance } from "./finance.ts";
import { readJournal, readJournalForRecords, readArchivedSnapshot } from "./journal.ts";

/** All report projections happen on the server before delivery. */
export function projectRecord(
  table: CloudTable,
  seat: Pick<CloudSeat, "role" | "purseIds"> & { id?: string },
): CloudTable {
  const t = structuredClone(table);
  const dm = seat.role === "dm";
  t.notes = t.notes.filter((n) => canReadNote(n, seat));
  t.journal = readJournalForRecords(t.journal);
  t.journal.entries = t.journal.entries?.filter(
    (e) =>
      e.visibility === "party" ||
      (dm ? e.visibility === "dm" : e.visibility === "player" && seat.purseIds.includes(e.purseId)),
  );
  t.journal.reports = t.journal.reports
    ?.filter((r) => !r.seatIds || (seat.id && r.seatIds.includes(seat.id)))
    .map((r) => {
      try { return { ...r, snapshot: JSON.stringify(projectRecord(readArchivedSnapshot(r.snapshot), seat)) }; }
      catch { return { ...r, snapshot: JSON.stringify({ purses: [], holdings: [], shops: [], stock: [], ledger: [], notes: [], sheets: [], loans: [], listings: [] }), error: "This archived report cannot be read. Keep its original backup for recovery." }; }
    });
  t.journal.editReports = t.journal.editReports?.filter(
    (r) => dm || seat.purseIds.includes(r.purseId),
  );
  if (!dm) {
    t.ledger = t.ledger.filter((l) => seat.purseIds.includes(l.purseId));
    t.holdings = t.holdings.filter((h) => seat.purseIds.includes(h.purseId));
    t.purses = t.purses.filter((p) => seat.purseIds.includes(p.id));
    if (t.journal.finance) {
      const f = readFinance(t.journal.finance);
      t.journal.finance = { day: f.day, loans: f.loans.filter(l => seat.purseIds.includes(l.purseId)), rules: f.rules.filter(r => seat.purseIds.includes(r.purseId)), downtime: [] };
    }
    t.journal.requests = t.journal.requests.filter((r) => seat.purseIds.includes(r.purseId));
    t.journal.events = t.journal.events
      .filter((e) => !e.purseId || seat.purseIds.includes(e.purseId))
      .map(({ change, ...e }) => e);
    t.loans = t.loans.filter((l) => seat.purseIds.includes(l.purseId));
    t.sheets = t.sheets.filter((s) => seat.purseIds.includes(s.purseId));
  }
  for (const p of t.purses) delete p.editBaseline;
  return t;
}
/** Freeze a complete record before clearing active logs; never include prior snapshots recursively. */
export function archiveSession(table: CloudTable, id: string, name: string, at = Date.now()) {
  const journal = (table.journal = readJournal(table.journal));
  for (const p of table.purses.filter((p) => p.editingAllowed)) {
    const sheet = characterSheet(
      p,
      table.holdings,
      table.sheets.find((s) => s.purseId === p.id),
    );
    (journal.editReports ??= []).push({
      id: id + ":" + p.id,
      purseId: p.id,
      name: p.name,
      at,
      before: p.editBaseline || sheet,
      after: sheet,
    });
    p.editingAllowed = false;
    delete p.editBaseline;
  }
  const archived = structuredClone(table);
  delete archived.journal!.reports;
  // DM sees that a private message was sent, but its text stays restricted.
  for (const n of table.notes.filter((n) => n.to === "player"))
    archived.journal!.events.push({
      id: n.id + ":private",
      at: n.at,
      kind: "management",
      summary: "Private message sent between player characters",
      purseId: n.purseId,
    });
  const record = { id, name, at, snapshot: JSON.stringify(archived) };
  (journal.reports ??= []).push(record);
  table.ledger = [];
  table.notes = [];
  journal.events = [];
  journal.editReports = [];
  for (const p of table.purses) p.rolls = [];
  return record;
}
