/**
 * Attunement on the character sheet (loot plan phase 5): "Attuned 2/3" from the character's
 * holdings, and for the DM in the campaign the character's limit (0 to 10) through the
 * `attunement-limit` command. Players see it only for characters whose holdings they can read.
 */
import { useRef, useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { newCommandId } from "@/lib/quire/command-id";
import { DEFAULT_ATTUNEMENT_LIMIT, MAX_ATTUNEMENT_LIMIT } from "@/lib/quire/attunement";
import type { Holding, Purse } from "@/lib/quire/types";
import { Button, Select } from "@/components/ui";

export function AttunementLine({
  holdings,
  limit,
  purse,
}: {
  holdings: Holding[];
  limit: number | undefined;
  /** The character in the campaign open on this device, when there is one (the DM's limit). */
  purse: Purse | undefined;
}) {
  const economy = useEconomy();
  const seat = useSeat();
  const live = purse ? economy.purses.find((p) => p.id === purse.id) : undefined;
  const shownLimit = live?.attunementLimit ?? limit ?? DEFAULT_ATTUNEMENT_LIMIT;
  // The holdings are already this character's (the sheet's campaign ledger).
  const attuned = holdings.filter((h) => h.attuned);
  const count = attuned.length;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const commandId = useRef("");
  const canSet = seat.role === "dm" && live?.kind === "character";
  return (
    <div className="attunement-line" data-testid="sheet-attunement">
      <p>
        <strong>
          Attuned {count}/{shownLimit}
        </strong>
        {count > shownLimit ? " (past the limit by the DM)" : ""}
        {attuned.length ? `: ${attuned.map((h) => h.name).join(", ")}` : ""}
      </p>
      {canSet ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving || draft === null || !live) return;
            const next = Number(draft);
            if (!commandId.current) commandId.current = newCommandId();
            setSaving(true);
            try {
              if (await economy.setAttunementLimit(live, next === DEFAULT_ATTUNEMENT_LIMIT ? null : next, { commandId: commandId.current })) {
                commandId.current = "";
                setDraft(null);
              } else commandId.current = "";
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="text-sm">
            Attunement limit
            <Select
              aria-label={`Attunement limit for ${live.name}`}
              value={draft ?? String(shownLimit)}
              onChange={(e) => {
                commandId.current = "";
                setDraft(e.target.value);
              }}
            >
              {Array.from({ length: MAX_ATTUNEMENT_LIMIT + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                  {n === DEFAULT_ATTUNEMENT_LIMIT ? " (default)" : ""}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={saving || draft === null || Number(draft) === shownLimit}>
            {saving ? "Saving…" : "Set limit"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
