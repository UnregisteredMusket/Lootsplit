import { useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { Button, Fold } from "./ui";
export function JournalNotes() {
  const { journal, command, purses } = useEconomy(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [visibility, setVisibility] = useState<"dm" | "party" | "player">(dm ? "dm" : "player"),
    [attachments, setAttachments] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const purseId =
    purses.find((p) => p.kind === "character" && seat.purseIds.includes(p.id))?.id || "";
  return (
    <Fold title="Session notes" hint="DM-private, party-shared and personal player entries.">
      <form
        className="grid gap-3"
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
          required
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="ledger-search"
          aria-label="Journal entry text"
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
      {(journal.entries || [])
        .filter(
          (e) =>
            e.visibility === "party" ||
            (dm
              ? e.visibility === "dm"
              : e.visibility === "player" && seat.purseIds.includes(e.purseId)),
        )
        .map((e) => (
          <article className="journal-entry" key={e.id}>
            <strong>{e.title}</strong>
            <small>
              {e.visibility} · {new Date(e.at).toLocaleString()}
            </small>
            <p className="whitespace-pre-wrap">{e.text}</p>
            {e.reportIds.map((id) => (
              <p key={id}>
                Attached: {journal.reports?.find((r) => r.id === id)?.name || "Archived session"}
              </p>
            ))}
          </article>
        ))}
    </Fold>
  );
}
