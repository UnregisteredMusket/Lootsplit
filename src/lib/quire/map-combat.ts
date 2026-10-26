import { mapCombatHudSchema, mapCombatOrderSchema } from "./map-combat-schema.ts";
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

const safeInt = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

/**
 * The initiative panel for one seat (map controls PR 6). `map` must already be projected for the
 * seat (hidden and fogged tokens removed); tokens marked DM-only are dropped here too. Combatants
 * keep the tracker's order. HP and initiative scores are included only for the seat's own
 * characters (`ownPurseIds`); conditions, notes, loot and names of unrevealed combatants never.
 */
export function projectMapCombatOrder(
  map: CampaignMap,
  encounterId: string,
  row: { status: string; body: { round?: unknown; activeId?: unknown; combatants?: unknown } },
  ownPurseIds: readonly string[],
) {
  const status = ["draft", "active", "concluded"].includes(row.status) ? row.status : "concluded";
  const combatants = Array.isArray(row.body.combatants) ? row.body.combatants : [];
  const tokens = (map.tokens ?? []).filter((t) => t.visibility === "party");
  const entries = combatants.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as { id?: unknown; initiative?: unknown; hp?: unknown; maxHp?: unknown };
    if (typeof c.id !== "string") return [];
    const token =
      tokens.find((t) => t.encounterId === encounterId && t.combatantId === c.id) ??
      tokens.find((t) => t.kind === "character" && t.entityId === c.id && !t.combatantId);
    if (!token) return [];
    const own = token.kind === "character" && !!token.entityId && ownPurseIds.includes(token.entityId);
    const hp = own ? safeInt(c.hp) : undefined,
      maxHp = own ? safeInt(c.maxHp) : undefined;
    return [
      {
        tokenId: token.id,
        label: token.label,
        // The order is shared; initiative scores only for the seat's own characters.
        initiative:
          own && typeof c.initiative === "number" && Number.isFinite(c.initiative)
            ? c.initiative
            : null,
        active: c.id === row.body.activeId,
        own,
        ...(hp !== undefined ? { hp } : {}),
        ...(maxHp !== undefined ? { maxHp } : {}),
      },
    ];
  });
  return mapCombatOrderSchema.parse({
    mapId: map.id,
    status,
    round: Math.max(0, safeInt(row.body.round) ?? 0),
    entries,
  });
}
