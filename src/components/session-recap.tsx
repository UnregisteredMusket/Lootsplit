/**
 * Session recap in the campaign journal (loot plan phase 6). The recap is computed on this device
 * from the session's records (session-recap.ts); nothing derived is stored. The DM can edit the
 * party draft and share it once as a party journal entry (the existing `journal-note` command,
 * with the session's recap entry ID as its command ID, so a retry posts nothing twice).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useArchiveReaderSeat } from "@/lib/quire/use-archive-reader-seat";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { readArchiveResult } from "@/lib/quire/archive-reader";
import { emptyCloudTable } from "@/lib/quire/cloud";
import type { Journal } from "@/lib/quire/journal";
import { projectRecord } from "@/lib/quire/session-records";
import { journalEntryHref } from "@/lib/quire/journal-navigation";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import {
  buildSessionRecap,
  NOTHING_RECORDED,
  recapEntryId,
  recapText,
  recapTitle,
  type RecapAudience,
  type RecapSource,
  type SessionRecap as Recap,
} from "@/lib/quire/session-recap";
import { AppLink } from "./app-link";
import { LedgerCoverage, LoadArchivedSession } from "./history-loader";
import { Button, Modal } from "./ui";

type Session = Journal["sessions"][number];
type Report = NonNullable<Journal["reports"]>[number];

function RecapSections({ recap, label }: { recap: Recap; label: string }) {
  if (!recap.sections.length) return <p className="text-muted">{NOTHING_RECORDED}.</p>;
  return (
    <div className="session-recap-sections" aria-label={label}>
      {recap.sections.map((section) => (
        <section key={section.key}>
          <h4>{section.title}</h4>
          <ul>
            {section.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Recap" on one session record, with its dialog. */
export function SessionRecapButton({ session, archived }: { session: Session; archived?: Report }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Recap
      </Button>
      {open && <SessionRecapDialog session={session} archived={archived} onClose={() => setOpen(false)} />}
    </>
  );
}

function SessionRecapDialog({
  session,
  archived,
  onClose,
}: {
  session: Session;
  archived?: Report;
  onClose: () => void;
}) {
  const { journal, ledger, purses, holdings, shops, stock, commandOutcome } = useEconomy();
  const seat = useSeat();
  const archiveSeat = useArchiveReaderSeat(seat);
  const dm = seat.role === "dm";
  // The session's records: its archived report (loaded on request) or the live working set.
  const source = useMemo((): { source: RecapSource } | { deferred: true } | { error: string } => {
    if (archived) {
      const result = readArchiveResult(archived, archiveSeat);
      if (result.available) return { source: result.snapshot };
      return "deferred" in result && result.deferred ? { deferred: true } : { error: result.error };
    }
    const live = { ...emptyCloudTable(), purses, holdings, shops, stock, ledger, journal };
    if (dm) return { source: live };
    try {
      // A shared room already sends a player's projection; project again for device player links.
      return { source: projectRecord(live, archiveSeat) };
    } catch {
      return { source: live };
    }
  }, [archived, archiveSeat, purses, holdings, shops, stock, ledger, journal, dm]);
  const audience: RecapAudience = dm ? { kind: "dm" } : { kind: "player", purseIds: seat.purseIds };
  const recap = "source" in source ? buildSessionRecap(source.source, session, audience) : null;
  const draft = dm && "source" in source ? buildSessionRecap(source.source, session, { kind: "party" }) : null;
  const entryId = recapEntryId(session.id);
  const shared = (journal.entries ?? []).find((entry) => entry.id === entryId);
  const [title, setTitle] = useState(() => recapTitle(session.name));
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const words = text ?? (draft ? recapText(draft) : "");
  useDraftGuard(dm && !shared && text !== null, "session recap");
  async function share() {
    setBusy(true);
    try {
      const outcome = await commandOutcome({
        // One recap per session: the entry ID is the command ID, so a retry is a no-op.
        id: entryId,
        kind: "journal-note",
        title: title.trim() || recapTitle(session.name),
        text: words,
        visibility: "party",
        purseId: "",
        reportIds: [],
      });
      setText(null);
      toast.success(mutationNotice(outcome, "Recap shared with the party in the journal."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not share the recap");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onOpenChange={(next) => !next && onClose()} title={`Recap · ${session.name}`}>
      <div className="session-recap grid gap-3">
        <p className="text-sm text-muted">
          Worked out from this session's ledger and activity{dm ? "" : " that you can see"}. It is not stored.
        </p>
        {"deferred" in source && archived && <LoadArchivedSession id={archived.id} name={session.name} />}
        {"error" in source && <p role="alert">{source.error}</p>}
        {!archived && !session.endedAt && <LedgerCoverage since={session.startedAt} ledger={ledger} />}
        {shared && (
          <p role="status">
            Shared with the party on {new Date(shared.at).toLocaleString()}.{" "}
            <AppLink href={journalEntryHref(shared.id)}>Read the shared recap</AppLink>
          </p>
        )}
        {recap && !dm && <RecapSections recap={recap} label="Your recap" />}
        {recap && dm && (
          <details className="session-recap-dm">
            <summary>Your full records (DM only)</summary>
            <RecapSections recap={recap} label="DM recap" />
          </details>
        )}
        {draft && !shared && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void share();
            }}
          >
            <p className="text-sm">
              Draft for the players. It leaves out NPCs, hidden characters, DM-only records and each character&apos;s
              private purchases and finances. Edit it, then share it once.
            </p>
            <input
              className="ledger-search"
              aria-label="Recap title"
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="ledger-search session-recap-text"
              aria-label="Recap text"
              rows={10}
              maxLength={12000}
              value={words}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !words.trim()}>
                Share with the party
              </Button>
              {text !== null && (
                <Button variant="secondary" disabled={busy} onClick={() => setText(null)}>
                  Reset to the computed draft
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
