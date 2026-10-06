import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { playSound } from "@/lib/quire/sound";
import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { Button } from "./ui";
export function JournalNotes() {
  const { journal, command, purses } = useEconomy(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [visibility, setVisibility] = useState<"dm" | "party" | "player">(dm ? "dm" : "player"),
    [attachments, setAttachments] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  useDraftGuard(!!title || !!text || attachments.length>0,"journal");
  const [selected, setSelected] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const entries = (journal.entries || []).filter(
    (e) =>
      e.visibility === "party" ||
      (dm ? e.visibility === "dm" : e.visibility === "player" && seat.purseIds.includes(e.purseId)),
  );
  const current = entries.find((e) => e.id === selected) || entries.at(-1);
  const composing = writing || !current;
  const purseId =
    purses.find((p) => p.kind === "character" && seat.purseIds.includes(p.id))?.id || "";
  return (
    <section id="journal" className="journal-book" aria-label="Session journal">
      <header>
        <div>
          <p className="journal-kicker">The campaign chronicle</p>
          <h2>Session journal</h2>
        </div>
        <Button onClick={() => setWriting(true)}>Write an entry</Button>
      </header>
      <div className="journal-spread">
        <nav className="journal-contents" aria-label="Journal contents">
          <h3>Contents</h3>
          <p>
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
          {entries.map((entry, i) => (
            <button
              key={entry.id}
              aria-current={!composing && current?.id === entry.id ? "page" : undefined}
              onClick={() => {
                void playSound("page");
                setSelected(entry.id);
                setWriting(false);
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span>
                {entry.title}
                <small>{new Date(entry.at).toLocaleDateString()}</small>
              </span>
            </button>
          ))}
          {!entries.length && <p>Your story begins here.</p>}
        </nav>
        <div className="journal-leaf">
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
                    await command({
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
                {e.reportIds.map((id) => (
                  <p key={id}>
                    Attached:{" "}
                    {journal.reports?.find((r) => r.id === id)?.name || "Archived session"}
                  </p>
                ))}
              </article>
            ))}
          <footer className="journal-page-number">
            {composing
              ? "A new page"
              : `Page ${entries.findIndex((e) => e.id === current?.id) + 1}`}
          </footer>
        </div>
      </div>
    </section>
  );
}
