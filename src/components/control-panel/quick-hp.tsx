import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { characterRequest } from "@/lib/characters/campaign-client";
import type { PlaySheet } from "@/lib/characters/model.mjs";

/**
 * Desk party card during an active encounter (design Q11): −1 / +1 HP through the character
 * sheet's own save path (the `character` command with the sheet it read as `before`), so a stale
 * sheet is refused instead of overwritten.
 */
export function QuickHp({
  purseId,
  name,
  hp,
  max,
}: {
  purseId: string;
  name: string;
  hp: number;
  max: number;
}) {
  const [busy, setBusy] = useState(false);
  async function change(delta: number) {
    setBusy(true);
    try {
      const id = `party:${purseId}`;
      const detail = await characterRequest<{ body: PlaySheet; editable: boolean }>(
        "sheets/detail",
        { id },
      );
      if (!detail.editable) throw Error(`${name}'s sheet is read-only for you.`);
      const next = Math.max(0, Math.min(detail.body.maxHp, detail.body.hp + delta));
      if (next === detail.body.hp) return;
      await characterRequest("sheets/save", {
        id,
        before: detail.body,
        sheet: { ...detail.body, hp: next },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change hit points.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="quick-hp" role="group" aria-label={`${name} hit points`}>
      <button
        type="button"
        aria-label={`${name}: 1 damage`}
        title="1 damage"
        disabled={busy || hp <= 0}
        onClick={() => void change(-1)}
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`${name}: heal 1`}
        title="Heal 1"
        disabled={busy || hp >= max}
        onClick={() => void change(1)}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </span>
  );
}
