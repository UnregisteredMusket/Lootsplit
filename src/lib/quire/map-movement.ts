import type { MapCombatOrder } from "./map-combat-schema.ts";
import type { CampaignMap, MapToken } from "./world-schema.ts";
import { movementMode, type MovementMode } from "./tabletop.ts";

/**
 * What a player's map shows about moving their own tokens (map tokens PR 2, mockup
 * player-token-move frames 1-3). Derived on the device from the seat's projection and, during a
 * combat the DM shows on this map, the shared turn order. Convenience only: the room server
 * enforces every rule (tabletop.ts).
 */
export type PlayerMovement = {
  mode: MovementMode;
  /** An encounter the DM shows on this map is running (its order is known). */
  combat: boolean;
  round?: number;
  /** The active turn, when it is a revealed token. */
  acting?: { tokenId: string; label: string; own: boolean };
  /** Tokens this seat may move now (empty while it is someone else's turn). */
  myTurn: boolean;
  /** The seat's own entry that comes next, and who acts just before it. */
  next?: { label: string; after: string };
};

export function playerMovement(
  map: CampaignMap,
  order: MapCombatOrder | null | undefined,
): PlayerMovement {
  const mode = movementMode(map);
  if (!order || order.mapId !== map.id || order.status !== "active")
    return { mode, combat: false, myTurn: true };
  const entries = order.entries,
    active = entries.find((e) => e.active),
    index = active ? entries.indexOf(active) : -1;
  let next: PlayerMovement["next"];
  if (entries.length > 1)
    for (let step = 1; step <= entries.length; step++) {
      const entry = entries[(Math.max(0, index) + step) % entries.length];
      if (entry.own) {
        const before = entries[(entries.indexOf(entry) - 1 + entries.length) % entries.length];
        next = { label: entry.label, after: before.label };
        break;
      }
    }
  return {
    mode,
    combat: true,
    round: order.round,
    ...(active ? { acting: { tokenId: active.tokenId, label: active.label, own: active.own } } : {}),
    myTurn: !!active?.own,
    ...(next ? { next } : {}),
  };
}

/** "the Ogre" for creatures and custom tokens, names as they are for characters. */
export function actorName(label: string, token?: Pick<MapToken, "kind">) {
  return token && token.kind !== "character" ? `the ${label}` : label;
}

/** Walking speed in feet from a sheet's free-text speed ("30 ft.", "25 ft, fly 60"). */
export function sheetSpeedFeet(speed: string | undefined) {
  const match = /(\d{1,4})/.exec(speed ?? "");
  const feet = match ? Number(match[1]) : NaN;
  return Number.isFinite(feet) && feet > 0 ? feet : undefined;
}
