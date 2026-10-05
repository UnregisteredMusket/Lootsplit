import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { readImageText } from "@/lib/quire/ocr";
import { parseStatblock } from "@/lib/encounters/statblock.mjs";
export function ImportStatblock({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (creature: ReturnType<typeof parseStatblock>) => void;
}) {
  const [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [confidence, setConfidence] = useState(0);
  let creature: ReturnType<typeof parseStatblock> | undefined;
  try {
    if (text) creature = parseStatblock(text);
  } catch {
    /* Explain on review; raw text remains editable. */
  }
  return (
    <div>
      <label className="quick-action relative overflow-hidden">
        {busy ? progress || "Reading statblock…" : "Import statblock picture"}
        <input
          type="file"
          className="sr-only"
          aria-label="Import statblock picture"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || disabled}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            setError("");
            try {
              if (f.size > 20 * 1024 * 1024) throw Error("Use an image smaller than 20 MB.");
              const result = await readImageText(f, setProgress);
              setText(result.text);
              setConfidence(result.confidence);
              setOpen(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not read statblock");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Modal open={open} onOpenChange={setOpen} title="Review statblock">
        <p>
          OCR confidence: {Math.round(confidence)}%. Compare every number with the picture. Actions,
          abilities and traits are retained in the creature’s notes.
        </p>
        <label>
          Extracted statblock
          <textarea
            aria-label="Extracted statblock"
            className="ledger-search w-full min-h-64"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {creature ? (
          <p>
            {creature.name} · AC {creature.ac} · HP {creature.maxHp} · Initiative{" "}
            {creature.initiativeBonus >= 0 ? "+" : ""}
            {creature.initiativeBonus} · CR {creature.cr} · {creature.xp} XP
          </p>
        ) : (
          <p role="alert">
            Correct the creature name, Armor Class and Hit Points above before continuing.
          </p>
        )}
        <Button
          disabled={!creature || disabled}
          onClick={() => {
            if (creature) {
              onImport(creature);
              setOpen(false);
              setText("");
            }
          }}
        >
          Add reviewed creature
        </Button>
      </Modal>
    </div>
  );
}
