/**
 * Item identification (loot plan phase 5): the DM's dialog for what players are told about an
 * item. It marks the item unidentified (or edits the presented record) with `item-unidentify`, and
 * reveals it with `item-identify`, each one command with an ID reused on retry. Players never see
 * this dialog: they receive the presented record from the server (item-identity.ts).
 */
import { useEffect, useState } from "react";
import { Button, Field, Modal, TextArea, TextInput } from "./ui";
import { useCommandId, useEconomy } from "@/lib/quire/economy-context";
import { requestConfirm } from "@/lib/quire/confirm-store";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import { isUnidentified, UNKNOWN_VALUE, type Unidentified } from "@/lib/quire/item-identity";
import type { Holding } from "@/lib/quire/types";

export function ItemIdentityDialog({ holding, onClose }: { holding: Holding | null; onClose: () => void }) {
  const { itemIdentity } = useEconomy();
  const current = holding && isUnidentified(holding) ? holding.unidentified : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = useCommandId(`${holding?.id}|${name}|${description}|${value}`);
  const reveal = useCommandId(`${holding?.id}|reveal`);
  useEffect(() => {
    if (!holding) return;
    setName(current?.name ?? "");
    setDescription(current?.description ?? "");
    setValue(current?.value === undefined ? "" : formatCopper(current.value));
    setError("");
    // Reset the form when another item opens; `current` follows the holding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding?.id]);
  if (!holding) return null;
  const record = (): Unidentified | null => {
    if (!name.trim()) {
      setError("Enter the name players see.");
      return null;
    }
    const copper = value.trim() ? parsePrice(value) : undefined;
    if (copper === null) {
      setError("Enter a value such as 25 gp or 2 gp 5 sp, or leave it empty for an unknown value.");
      return null;
    }
    return {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(copper === undefined ? {} : { value: copper }),
    };
  };
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={current ? `What players see: ${holding.name}` : `Mark ${holding.name} unidentified`}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const next = record();
          if (!next) return;
          setBusy(true);
          setError("");
          try {
            const ok = await itemIdentity(
              { kind: "item-unidentify", holdingId: holding.id, before: current, unidentified: next },
              { commandId: save.commandId },
            );
            if (ok) {
              save.renew();
              onClose();
            } else setError("Not saved. Your changes are still here.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">
          Until you identify it, everyone else sees this name, description and value instead of the
          true item, in inventories, sheets, Activity, receipts and on the player display. It sells
          at this value; without one, nobody can sell it.
        </p>
        <Field label="Name players see">
          <TextInput aria-label="Name players see" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Plain brass ring" />
        </Field>
        <label className="text-sm">
          Description players see (optional)
          <TextArea aria-label="Description players see" className="mt-1" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <Field label="Value players see (optional)" hint={`Empty: players see “${UNKNOWN_VALUE}”.`}>
          <TextInput aria-label="Value players see" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="25 gp" />
        </Field>
        {error ? (
          <p role="alert" className="text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : current ? "Save" : "Mark unidentified"}
          </Button>
          {current ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                const yes = await requestConfirm({
                  title: `Identify ${holding.name}?`,
                  body: `Everyone who can see it will see ${holding.name}, its notes and its value. Activity logs the reveal once.`,
                  confirmLabel: "Identify",
                });
                if (!yes) return;
                setBusy(true);
                try {
                  if (await itemIdentity({ kind: "item-identify", holdingId: holding.id, before: current }, { commandId: reveal.commandId })) {
                    reveal.renew();
                    onClose();
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              Identify
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
