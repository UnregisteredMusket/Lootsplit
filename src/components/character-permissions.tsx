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
import { Button, Checkbox, Modal } from "./ui";

const NOTE =
  "Allowed changes apply when the player saves. Currency and inventory grants allow immediate adjustments, recorded in the ledger. Rolls and normal gameplay remain available.";

/** The per-field permission checkboxes for one character (each one is a single command). */
function PermissionChecks({ purse }: { purse: Purse }) {
  const { command } = useEconomy();
  const [busy, setBusy] = useState(false);
  return (
    <div className="field-grid">
      {Object.entries(characterPermissions).map(([key, label]) => (
        <Checkbox
          key={key}
          label={label}
          aria-label={`${purse.name}: ${label}`}
          checked={canEditCharacterField(purse, key)}
          disabled={busy}
          onChange={async (allowed) => {
            setBusy(true);
            try {
              await command({
                kind: "character-permission",
                purseId: purse.id,
                permission: key as CharacterPermission,
                allowed,
              });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save permission");
            } finally {
              setBusy(false);
            }
          }}
        />
      ))}
    </div>
  );
}

export function CharacterPermissions({ purse }: { purse: Purse }) {
  return (
    <details className="character-permissions">
      <summary>{purse.name} · Individual permissions</summary>
      <p className="text-sm text-muted">{NOTE}</p>
      <PermissionChecks purse={purse} />
    </details>
  );
}

/**
 * On a Party character card: one "Permissions…" button that opens the per-field list in a sheet,
 * so the card isn't a column of small checkboxes (design plan M1). Same commands as above.
 */
export function CharacterPermissionsSheet({ purse }: { purse: Purse }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Permissions…
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`${purse.name} · Individual permissions`}>
        <p className="text-sm text-muted">{NOTE}</p>
        <PermissionChecks purse={purse} />
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setOpen(false)}>Done</Button>
        </div>
      </Modal>
    </>
  );
}

export function PlayerPermissions() {
  const { purses } = useEconomy();
  const seat = useSeat();
  if (seat.role !== "dm") return null;
  return (
    <div className="grid gap-3">
      {purses
        .filter((p) => p.kind === "character" && !p.nonParty)
        .map((p) => (
          <CharacterPermissions key={p.id} purse={p} />
        ))}
    </div>
  );
}
