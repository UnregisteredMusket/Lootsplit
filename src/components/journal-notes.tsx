import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { playSound } from "@/lib/quire/sound";
import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { Button, Modal } from "./ui";
import { SessionReportReader } from "./session-report-reader";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { useArchiveReaderSeat } from "@/lib/quire/use-archive-reader-seat";
import { readSessionSummary } from "@/lib/quire/archive-reader";
import { formatCopper } from "@/lib/quire/money";
import {
  authorizedJournalEntries,
  journalDestination,
  journalEntryHref,
  sessionChronicleEntries,
  sessionRecordHref,
} from "@/lib/quire/journal-navigation";
import { AppLink } from "./app-link";
import { JournalReceiptLink } from "./journal-receipt-link";
export function JournalNotes() {
  const { journal, ledger, commandOutcome, purses } = useEconomy(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const archiveSeat = useArchiveReaderSeat(seat);
  const hash = useRouterState({ select: (state) => state.location.hash });
  const destination = journalDestination(hash);
  const navigate = useNavigate();
  const [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [visibility, setVisibility] = useState<"dm" | "party" | "player">(dm ? "dm" : "player"),
    [attachments, setAttachments] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useDraftGuard(!!title || !!text || attachments.length > 0, "journal");
  const [selected, setSelected] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [search, setSearch] = useState("");
  const [visibleFilter, setVisibleFilter] = useState("all");
  const [openedReportId, setOpenedReportId] = useState("");
  const openedReport = journal.reports?.find((report) => report.id === openedReportId);
  const entries = authorizedJournalEntries(journal.entries || [], seat);
  useEffect(() => {
    if (journalDestination(hash)?.kind !== "entry") return;
    setWriting(false);
    setSelected(journalDestination(hash)!.id);
    setSearch("");
    setVisibleFilter("all");
  }, [hash]);
  const shownEntries = entries.filter(
    (entry) =>
      (visibleFilter === "all" || entry.visibility === visibleFilter) &&
      (!search.trim() ||
        `${entry.title} ${entry.text} ${new Date(entry.at).toLocaleString()}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const linkedEntry =
    destination?.kind === "entry"
      ? entries.find((entry) => entry.id === destination.id)
      : undefined;
  const missingEntry = destination?.kind === "entry" && !linkedEntry;
  const current = missingEntry
    ? undefined
    : shownEntries.find((e) => e.id === selected) || linkedEntry || shownEntries.at(-1);
  const composing = !missingEntry && (writing || !entries.length);
  const linkedSession =
    destination?.kind === "session"
      ? journal.sessions.find((session) => session.id === destination.id)
      : undefined;
  const linkedArchive =
    linkedSession && journal.reports?.find((report) => report.id === linkedSession.id);
  const linkedSummary = linkedSession
    ? readSessionSummary(linkedSession, ledger, linkedArchive, archiveSeat)
    : undefined;
  const purseId =
    purses.find((p) => p.kind === "character" && seat.purseIds.includes(p.id))?.id || "";
  return (
    <section id="journal" className="journal-book" aria-label="Session journal">
      <header>
        <div>
          <p className="journal-kicker">The campaign chronicle</p>
          <h2>Session journal</h2>
        </div>
        <Button
          onClick={() => {
            setWriting(true);
            if (destination) void navigate({ hash: "" });
          }}
        >
          Write an entry
        </Button>
      </header>
      <div className="journal-spread">
        <nav className="journal-contents" aria-label="Journal contents">
          <h3>Contents</h3>
          <input
            className="ledger-search w-full"
            aria-label="Search journal entries"
            placeholder="Find a title, text or date"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="ledger-search w-full"
            aria-label="Filter journal visibility"
            value={visibleFilter}
            onChange={(e) => setVisibleFilter(e.target.value)}
          >
            <option value="all">All authorized entries</option>
            <option value="party">Party shared</option>
            <option value={dm ? "dm" : "player"}>{dm ? "DM private" : "Private player"}</option>
          </select>
          <p>
            {shownEntries.length} of {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
          {shownEntries.map((entry) => (
            <button
              key={entry.id}
              aria-current={!composing && current?.id === entry.id ? "page" : undefined}
              onClick={() => {
                void playSound("page");
                setSelected(entry.id);
                setWriting(false);
                if (destination?.kind === "entry")
                  void navigate({ hash: journalEntryHref(entry.id).split("#")[1] });
              }}
            >
              <span>
                {String(entries.findIndex((e) => e.id === entry.id) + 1).padStart(2, "0")}
              </span>
              <span>
                {entry.title}
                <small>{new Date(entry.at).toLocaleDateString()}</small>
              </span>
            </button>
          ))}
          {!entries.length && <p>Your story begins here.</p>}
          {!!entries.length && !shownEntries.length && (
            <p>No entries match. Clear the search or choose All authorized entries.</p>
          )}
        </nav>
        <div className="journal-leaf">
          {missingEntry && (
            <p role="alert">This journal entry is unavailable in your current campaign access.</p>
          )}
          {composing ? (
            <>
              <p className="journal-date">
                {new Date().toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <form
                className="journal-writing grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const outcome = await commandOutcome({
                      kind: "journal-note",
                      title,
                      text,
                      visibility,
                      purseId,
                      reportIds: attachments,
                    });
                    setTitle("");
                    setText("");
                    setAttachments([]);
                    setWriting(false);
                    setSelected(null);
                    toast.success(mutationNotice(outcome, "Journal note saved."));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not save note");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <input
                  className="ledger-search"
                  aria-label="Journal entry title"
                  placeholder="Title of this chapter"
                  required
                  maxLength={100}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  className="ledger-search"
                  aria-label="Journal entry text"
                  placeholder="Record the places, promises and discoveries worth remembering…"
                  maxLength={12000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <select
                  aria-label="Journal visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as typeof visibility)}
                >
                  {dm ? (
                    <option value="dm">DM private</option>
                  ) : (
                    <option value="player">Private player</option>
                  )}
                  <option value="party">Party shared</option>
                </select>
                {(journal.reports || []).map((r) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      checked={attachments.includes(r.id)}
                      onChange={(e) =>
                        setAttachments(
                          e.target.checked
                            ? [...attachments, r.id]
                            : attachments.filter((id) => id !== r.id),
                        )
                      }
                    />{" "}
                    Attach {r.name}
                  </label>
                ))}
                <Button disabled={busy} type="submit">
                  Save note
                </Button>
              </form>
            </>
          ) : null}
          {(current && !composing ? [current] : [])
            .filter(
              (e) =>
                e.visibility === "party" ||
                (dm
                  ? e.visibility === "dm"
                  : e.visibility === "player" && seat.purseIds.includes(e.purseId)),
            )
            .map((e) => (
              <article className="journal-reading" key={e.id}>
                <h3>{e.title}</h3>
                <small>
                  {e.visibility} · {new Date(e.at).toLocaleString()}
                </small>
                <p className="whitespace-pre-wrap">{e.text}</p>
                {e.provenance?.kind === "encounter-loot" && (
                  <div className="mt-3" aria-label="Recorded loot context">
                    {e.provenance.sessionId &&
                      (journal.sessions.some(
                        (session) => session.id === e.provenance?.sessionId,
                      ) ? (
                        <AppLink
                          className="settings-link"
                          href={sessionRecordHref(e.provenance.sessionId)}
                        >
                          Open linked recorded session
                        </AppLink>
                      ) : (
                        <p className="text-sm text-muted">
                          The linked recorded session is unavailable in your current campaign
                          access.
                        </p>
                      ))}
                    <JournalReceiptLink provenance={e.provenance} />
                  </div>
                )}
                {e.reportIds.map((id) => {
                  const report = journal.reports?.find((r) => r.id === id);
                  return (
                    <div key={id} className="mt-2">
                      <p>Attached: {report?.name || "Archived session"}</p>
                      {report ? (
                        <Button variant="secondary" onClick={() => setOpenedReportId(id)}>
                          Read attached report · {report.name}
                        </Button>
                      ) : (
                        <p className="text-sm text-muted">
                          This report is unavailable in your current campaign access.
                        </p>
                      )}
                    </div>
                  );
                })}
              </article>
            ))}
          <footer className="journal-page-number">
            {composing
              ? "A new page"
              : `Page ${entries.findIndex((e) => e.id === current?.id) + 1}`}
          </footer>
        </div>
      </div>
      <Modal
        open={destination?.kind === "session"}
        onOpenChange={(open) => {
          if (!open)
            void navigate({ hash: current ? journalEntryHref(current.id).split("#")[1] : "" });
        }}
        title="Recorded session"
      >
        {linkedSession ? (
          <div className="grid gap-3">
            <h3>{linkedSession.name}</h3>
            <p>
              {new Date(linkedSession.startedAt).toLocaleString()} ·{" "}
              {linkedSession.endedAt ? "Ended" : "In progress"}
            </p>
            {linkedSummary?.available ? (
              <p>
                {dm ? "Campaign" : "Your assigned accounts"} · Received{" "}
                {formatCopper(linkedSummary.summary.received)} · Spent{" "}
                {formatCopper(linkedSummary.summary.spent)} · Net{" "}
                {formatCopper(linkedSummary.summary.net)}
              </p>
            ) : (
              <p role="alert">{linkedSummary?.error}</p>
            )}
            <p className="text-sm text-muted">
              Received/spent excludes internal coin transfers. Net is balance movement.
            </p>
            {sessionChronicleEntries(journal.entries || [], seat, linkedSession.id).map((entry) => (
              <AppLink className="settings-link" key={entry.id} href={journalEntryHref(entry.id)}>
                Read linked journal entry · {entry.title}
              </AppLink>
            ))}
            {linkedArchive && (
              <Button variant="secondary" onClick={() => setOpenedReportId(linkedArchive.id)}>
                Read session report
              </Button>
            )}
            <AppLink
              className="settings-link"
              href={current ? journalEntryHref(current.id) : "/features/journal"}
            >
              Return to journal entry
            </AppLink>
          </div>
        ) : (
          <p role="alert">This recorded session is unavailable in your current campaign access.</p>
        )}
      </Modal>
      {openedReport && (
        <SessionReportReader
          report={openedReport}
          seat={archiveSeat}
          open
          onOpenChange={(open) => {
            if (!open) setOpenedReportId("");
          }}
        />
      )}
    </section>
  );
}
