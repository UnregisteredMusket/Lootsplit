import { mapCombatHudSchema } from "./map-combat-schema.ts";
import type { CampaignMap } from "./world-schema.ts";
/** The input map MUST already have passed seat/fog projection. No tracker labels,
 * HP, initiative, notes, loot or unrevealed combatant identity leave this boundary. */
export function projectMapCombat(
  map: CampaignMap,
  encounterId: string,
  row: { status: string; body: { round?: unknown; activeId?: unknown } },
) {
  const status = ["draft", "active", "concluded"].includes(row.status) ? row.status : "concluded";
  const token = map.tokens?.find(
    (t) =>
      t.encounterId === encounterId &&
      t.combatantId === row.body.activeId &&
      t.visibility === "party",
  );
  return mapCombatHudSchema.parse({
    mapId: map.id,
    status,
    round:
      typeof row.body.round === "number" &&
      Number.isSafeInteger(row.body.round) &&
      row.body.round >= 0
        ? row.body.round
        : 0,
    ...(token ? { activeTokenId: token.id } : {}),
  });
}
