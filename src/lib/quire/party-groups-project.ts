/**
 * A player's projection of split-the-party groups (`projectRecord`, which the non-DM branch of
 * `view()` uses). Players see every active group's name, colour, letter and place, except a
 * group the DM hid: a player with no character in it sees it as "Elsewhere" (no location or map
 * position). Players see only their own move requests, and a denial reason only when shared.
 */
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { PartyGroup, World } from "./world-schema.ts";
import { seatGroups } from "./party-groups.ts";

/** The place a player sees for a hidden group they are not in. */
export const ELSEWHERE = { environment: "Other" as const, description: "Elsewhere" };

export function projectPartyGroups(
  table: CloudTable,
  world: World,
  seat: Pick<CloudSeat, "role" | "purseIds">,
) {
  if (seat.role === "dm") return;
  const mine = new Set(seatGroups(table, seat));
  if (world.groups) {
    const groups: PartyGroup[] = world.groups
      .filter((g) => g.status === "active")
      .map((g) => {
        if (g.hidden && !mine.has(g.id))
          return {
            id: g.id,
            name: g.name,
            colour: g.colour,
            ...(g.letter ? { letter: g.letter } : {}),
            status: "active",
            locationId: null,
            position: { ...ELSEWHERE },
            hidden: true,
            createdAt: g.createdAt,
          };
        const projected = structuredClone(g);
        delete projected.mergedAt;
        delete projected.mergedInto;
        if (projected.position && !world.maps.some((m) => m.id === projected.position!.mapId)) {
          delete projected.position.mapId;
          delete projected.position.x;
          delete projected.position.y;
        }
        return projected;
      });
    if (groups.length) world.groups = groups;
    else {
      delete world.groups;
      delete world.mainGroup;
    }
  }
  if (world.groupRequests) {
    const own = world.groupRequests
      .filter((r) => seat.purseIds.includes(r.purseId))
      .map((r) => {
        const projected = { ...r };
        if (projected.reason && !projected.reason.showToPlayer) delete projected.reason;
        return projected;
      });
    if (own.length) world.groupRequests = own;
    else delete world.groupRequests;
  }
}
