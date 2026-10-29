import { toast } from "sonner";
import { encounterRequest } from "../encounters/client";
import { blankCombatant } from "../encounters/model.mjs";
import { encounterDetailPoller } from "../encounters/detail-poller";
import { resultToast } from "./result-toast";
import type { CloudTable } from "./cloud";
import type { CommandInput } from "./commands";
import type { CampaignMap, MapToken } from "./world-schema";

type Detail = {
  id: string;
  revision: number;
  body: { combatants: { id: string }[] } & Record<string, unknown>;
};
/** The tracker id a token plays as: a character's purse, else its combatant or the token. */
export const combatantIdOf = (token: MapToken) =>
  token.kind === "character" && token.entityId ? token.entityId : (token.combatantId ?? token.id);

/**
 * Add to initiative (map tokens PR 3, group bar and token menu): the tokens join the encounter
 * running on this map through the tracker's own revision-checked `encounters/save`, then tokens
 * that aren't characters are linked to their new combatants with one `map-tokens-edit`. The
 * tracker is a separate store, so the order is tracker first, then the link; a retry never adds a
 * combatant twice because the ids come from the tokens.
 */
export async function addToInitiative(
  table: Pick<CloudTable, "journal">,
  map: CampaignMap,
  tokens: MapToken[],
  act: (input: CommandInput, done?: () => void) => Promise<void>,
) {
  const encounterId = table.journal?.world?.combat?.encounterId ?? map.encounterId;
  if (!encounterId) {
    toast.error("Start an encounter on this map first (Initiative › Start encounter here).");
    return;
  }
  try {
    const detail = await encounterRequest<Detail>("encounters/detail", { id: encounterId });
    const have = new Set(detail.body.combatants.map((c) => c.id));
    const joining = tokens.filter((t) => !have.has(combatantIdOf(t)));
    if (joining.length) {
      const combatants = [
        ...detail.body.combatants,
        ...joining.map((t) => ({
          ...blankCombatant(),
          id: combatantIdOf(t),
          name: t.label,
          side: t.kind === "creature" ? ("enemy" as const) : ("ally" as const),
          source: "Map token",
        })),
      ];
      await encounterRequest("encounters/save", {
        id: detail.id,
        revision: detail.revision,
        encounter: { ...detail.body, combatants },
      });
      encounterDetailPoller.refresh(detail.id);
    }
    const link = tokens.filter((t) => t.kind !== "character" && (t.encounterId !== encounterId || t.combatantId !== combatantIdOf(t)));
    if (link.length)
      await act({
        kind: "map-tokens-edit",
        mapId: map.id,
        edits: link.map((t) => ({ tokenId: t.id, before: t, token: { ...t, encounterId, combatantId: combatantIdOf(t) } })),
      });
    resultToast(joining.length ? `Added ${joining.length} to initiative` : "Already in initiative");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The tracker could not be updated. Try again.");
  }
}

/**
 * Remove from combat (map tokens PR 4, token menu): the tokens' combatants leave the encounter
 * running on this map through the tracker's revision-checked `encounters/save`. The tokens stay on
 * the map; their link to the tracker is kept, so Add to initiative brings the same combatant back.
 */
export async function removeFromInitiative(
  table: Pick<CloudTable, "journal">,
  map: CampaignMap,
  tokens: MapToken[],
) {
  const encounterId = table.journal?.world?.combat?.encounterId ?? map.encounterId;
  if (!encounterId) return;
  try {
    const detail = await encounterRequest<Detail>("encounters/detail", { id: encounterId });
    const leaving = new Set(tokens.map(combatantIdOf));
    const order = detail.body.combatants;
    const combatants = order.filter((c) => !leaving.has(c.id));
    const removed = order.length - combatants.length;
    if (removed) {
      // The active combatant leaving passes the turn to the next one still in the order.
      const active = String(detail.body.activeId ?? "");
      let activeId = active;
      if (active && leaving.has(active)) {
        const at = order.findIndex((c) => c.id === active);
        activeId = [...order.slice(at + 1), ...order.slice(0, at)].find((c) => !leaving.has(c.id))?.id ?? "";
      }
      await encounterRequest("encounters/save", {
        id: detail.id,
        revision: detail.revision,
        encounter: { ...detail.body, combatants, activeId },
      });
    }
    encounterDetailPoller.refresh(detail.id);
    resultToast(removed ? `Removed ${removed} from combat` : "Not in combat");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "The tracker could not be updated. Try again.");
  }
}

/** The encounter running on this map (the tracker the token menu adds to and removes from). */
export const mapEncounterId = (table: Pick<CloudTable, "journal">, map: CampaignMap) =>
  table.journal?.world?.combat?.encounterId ?? map.encounterId;
