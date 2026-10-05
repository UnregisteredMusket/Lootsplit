import { useState } from "react";
import { toast } from "sonner";
import {
  characterPermissions,
  canEditCharacterField,
  type CharacterPermission,
} from "@/lib/characters/permissions.mjs";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import type { Purse } from "@/lib/quire/types";
export function CharacterPermissions({ purse }: { purse: Purse }) {
  const { command } = useEconomy();
  const [busy, setBusy] = useState(false);
  return (
    <details className="character-permissions">
      <summary>{purse.name} · Individual permissions</summary>
      <p className="text-sm text-muted">
        Allowed changes apply when the player saves. Currency and inventory grants allow immediate
        adjustments, recorded in the ledger. Rolls and normal gameplay remain available.
      </p>
      <div className="field-grid">
        {Object.entries(characterPermissions).map(([key, label]) => (
          <label className="flex min-h-11 items-center gap-2" key={key}>
            <input
              type="checkbox"
              aria-label={`${purse.name}: ${label}`}
              checked={canEditCharacterField(purse, key)}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                try {
                  await command({
                    kind: "character-permission",
                    purseId: purse.id,
                    permission: key as CharacterPermission,
                    allowed: e.target.checked,
                  });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not save permission");
                } finally {
                  setBusy(false);
                }
              }}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}
export function PlayerPermissions() {
  const { purses } = useEconomy();
  const seat = useSeat();
  if (seat.role !== "dm") return null;
  return (
    <div className="grid gap-3">
      {purses
        .filter((p) => p.kind === "character")
        .map((p) => (
          <CharacterPermissions key={p.id} purse={p} />
        ))}
    </div>
  );
}
