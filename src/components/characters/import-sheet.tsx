import { importedFieldNames } from "@/lib/characters/import-fields.mjs";
import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { readCharacterSheet } from "@/lib/quire/sheet-file";
import { legacyCharacter } from "@/lib/characters/campaign-sheet.mjs";
import { sheetSchema, type PlaySheet } from "@/lib/characters/model.mjs";
import { formatCopper } from "@/lib/quire/money";
import type { SrdValuation } from "@/lib/quire/srd-item-values";

/** Gives unpriced imported items their SRD value (bundled from Open5e; works offline). */
async function withSrdValues(sheet: PlaySheet) {
  const { loadSrdIndex, valueEquipment } = await import("@/lib/quire/srd-item-values");
  const result = valueEquipment(await loadSrdIndex(), sheet.equipment, sheet.edition);
  return { sheet: sheetSchema.parse({ ...sheet, equipment: result.equipment }), result };
}
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
    [error, setError] = useState(""),
    [valuation, setValuation] = useState<SrdValuation | null>(null);
  const review = async (sheet: PlaySheet) => {
    try {
      const priced = await withSrdValues(sheet);
      setValuation(priced.result);
      setDraft(priced.sheet);
    } catch {
      // The price list is a convenience: an import never fails because of it.
      setValuation(null);
      setDraft(sheet);
    }
  };
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
                  await review(sheetSchema.parse(raw));
                  return;
                }
              }
              const legacy = await readCharacterSheet(file),
                next = legacyCharacter(legacy, legacy.name || file.name);
              setFields(importedFieldNames(legacy));
              next.coins = legacy.coins;
              next.source =
                "Imported character sheet. Review extracted values against the original; unspecified fields retain editor defaults. Original text is preserved in notes.";
              await review(sheetSchema.parse(next));
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
          if (!open && !busy) {
            setDraft(null);
            setValuation(null);
          }
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
            {valuation && (valuation.valued.length > 0 || valuation.unmatched.length > 0) && (
              <details open={valuation.valued.length > 0}>
                <summary>
                  Item values: {valuation.valued.length} of{" "}
                  {valuation.valued.length + valuation.unmatched.length} unpriced items matched the
                  SRD
                </summary>
                <p>
                  Prices come from the System Reference Document (SRD 5.1 and 5.2, via Open5e),
                  preferring this sheet’s edition. Magic items without a listed price use the SRD
                  5.2.1 value for their rarity. Values you already entered are kept, and every value
                  can be changed after saving.
                </p>
                {valuation.valued.length > 0 && (
                  <ul>
                    {valuation.valued.map((v, i) => (
                      <li key={i}>
                        {v.item}: {formatCopper(v.copper)} each
                        {v.srd.toLowerCase() !== v.item.toLowerCase() ? ` (SRD “${v.srd}”)` : ""}
                        {v.basis === "rarity" ? " · rarity value" : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {valuation.unmatched.length > 0 && (
                  <p>No SRD match, left without a value: {valuation.unmatched.join(", ")}</p>
                )}
              </details>
            )}
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
