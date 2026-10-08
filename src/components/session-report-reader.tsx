import { useMemo } from "react";
import { readArchiveResult, type ArchiveSeat } from "@/lib/quire/archive-reader";
import { formatCopper } from "@/lib/quire/money";
import { readJournal } from "@/lib/quire/journal";
import { downloadJson } from "@/lib/quire/table";
import { Button, Modal } from "./ui";

export type SessionReport = {
  id: string;
  name: string;
  at: number;
  snapshot: unknown;
  error?: string;
};

/** Caller supplies an authorized account record, or a seat for campaign/device projection. */
export function SessionReportReader({
  report,
  open,
  onOpenChange,
  seat,
}: {
  report: SessionReport;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seat?: ArchiveSeat;
}) {
  const result = useMemo(() => readArchiveResult(report, seat), [report, seat]);
  const snapshot = result.available ? result.snapshot : null;
  const journal = snapshot ? readJournal(snapshot.journal) : null;
  const sections =
    snapshot && journal
      ? ([
          ["Accounts and character sheets", snapshot.purses],
          ["Inventory and properties", snapshot.holdings],
          ["Imported character sheets", snapshot.sheets],
          ["Shops", snapshot.shops],
          ["Shop stock", snapshot.stock],
          ["Property listings", snapshot.listings],
          ["Loan applications", snapshot.loans],
          ["Financial agreements and downtime", journal.finance ? [journal.finance] : []],
          ["Character edit reports", journal.editReports ?? []],
          ["Management and session events", journal.events],
          ["Journal entries", journal.entries ?? []],
          ["Nested saved reports", journal.reports ?? []],
          ["Payment requests", journal.requests],
          ["Named session records", journal.sessions],
          ["Shared handouts", snapshot.handouts ?? []],
          ["Campaign settings", snapshot.realm ? [snapshot.realm] : []],
        ] as const)
      : [];
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={report.name}>
      <section aria-label="Session report reader" className="grid gap-4">
        <p>{new Date(report.at).toLocaleString()}</p>
        <p className="text-sm text-muted">
          This is a saved record. Reading it does not restore a campaign or change play.
        </p>
        {!result.available ? (
          <p role="alert">{result.error}</p>
        ) : (
          <>
            <section>
              <h3>Financial activity · {snapshot!.ledger.length} records</h3>
              <p className="text-sm text-muted">
                Original transactions and transfers are preserved. A transfer is not newly earned
                wealth.
              </p>
              {snapshot!.ledger.map((row) => (
                <p key={row.id} className="journal-entry">
                  {row.summary} · {formatCopper(row.copper)} · {new Date(row.at).toLocaleString()}
                </p>
              ))}
              {!snapshot!.ledger.length && <p>No financial activity recorded.</p>}
            </section>
            <section>
              <h3>Authorized messages · {snapshot!.notes.length}</h3>
              {snapshot!.notes.map((note) => (
                <article key={note.id} className="journal-entry">
                  <small>
                    {note.from === "dm"
                      ? "Dungeon master"
                      : (snapshot!.purses.find((p) => p.id === note.purseId)?.name ??
                        "Player")}{" "}
                    · {note.to === "party" ? "Party" : "Private"} ·{" "}
                    {new Date(note.at).toLocaleString()}
                  </small>
                  <p className="whitespace-pre-wrap break-words">{note.text}</p>
                </article>
              ))}
              {!snapshot!.notes.length && <p>No messages available in this record.</p>}
            </section>
            {sections.map(([label, rows]) => (
              <details key={label}>
                <summary>
                  {label} · {rows.length}
                </summary>
                {rows.length ? (
                  <pre className="whitespace-pre-wrap break-words text-sm">
                    {JSON.stringify(rows, null, 2)}
                  </pre>
                ) : (
                  <p>No records.</p>
                )}
              </details>
            ))}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!result.available}
            onClick={() => {
              if (result.available)
                void downloadJson("lootsplit-session-" + report.id + ".json", result.snapshot);
            }}
          >
            Download session report
          </Button>
          <Button onClick={() => onOpenChange(false)}>Return to previous view</Button>
        </div>
      </section>
    </Modal>
  );
}
