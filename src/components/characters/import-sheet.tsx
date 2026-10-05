import { importedFieldNames } from "@/lib/characters/import-fields.mjs";
import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { readCharacterSheet } from "@/lib/quire/sheet-file";
import { legacyCharacter } from "@/lib/characters/campaign-sheet.mjs";
import { sheetSchema, type PlaySheet } from "@/lib/characters/model.mjs";
export function ImportCharacterSheet({
  onImport,
  disabled = false,
  label = "Import character sheet",
}: {
  onImport: (sheet: PlaySheet, fields?: string[]) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
}) {
  const [fields, setFields] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<PlaySheet | null>(null),
    [error, setError] = useState("");
  return (
    <div className="character-import">
      <label className="quick-action relative overflow-hidden">
        {busy ? "Reading character sheet…" : label}
        <input
          type="file"
          className="sr-only"
          aria-label={label}
          accept=".pdf,.json,.png,.jpg,.jpeg,.webp"
          disabled={busy || disabled}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            setFields(undefined);
            try {
              if (file.size > 20 * 1024 * 1024) throw Error("Choose a file smaller than 20 MB.");
              if (file.name.toLowerCase().endsWith(".json")) {
                const raw = JSON.parse(await file.text());
                if (raw.version === 1) {
                  setDraft(sheetSchema.parse(raw));
                  return;
                }
              }
              const legacy = await readCharacterSheet(file),
                next = legacyCharacter(legacy, legacy.name || file.name);
              setFields(importedFieldNames(legacy));
              next.coins = legacy.coins;
              next.source =
                "Imported character sheet. Review extracted values against the original; unspecified fields retain editor defaults. Original text is preserved in notes.";
              setDraft(sheetSchema.parse(next));
            } catch (error) {
              setError(error instanceof Error ? error.message : "Unable to read sheet");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Modal
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) setDraft(null);
        }}
        title="Review imported character"
      >
        {draft && (
          <>
            <p>
              Compare these values with your original. Scans can misread numbers; missing fields use
              editor defaults. You can correct every tab before saving an existing character.
              Campaign permissions still apply.
            </p>
            <h3>{draft.name}</h3>
            <p>
              {draft.classes} · {draft.species} · HP {draft.hp}/{draft.maxHp} · AC {draft.ac}
            </p>
            <p>
              {Object.entries(draft.scores)
                .map(([key, value]) => `${key.toUpperCase()} ${value}`)
                .join(" · ")}
            </p>
            <p>
              {draft.attacks.length} attacks · {draft.spells.length} spells with explicit levels ·{" "}
              {draft.equipment.length} inventory entries · {draft.resources.length} resources
            </p>
            <details>
              <summary>All extracted fields</summary>
              <pre className="whitespace-pre-wrap break-words max-h-80 overflow-auto">
                {JSON.stringify(draft, null, 2)}
              </pre>
            </details>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onImport(draft, fields);
                  setDraft(null);
                } catch (error) {
                  setError(error instanceof Error ? error.message : "Import failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use reviewed character
            </Button>
          </>
        )}
      </Modal>
    </div>
  );
}
