/**
 * A player's projection of zones (map tokens PR 7A, plan 6A.5): zone membership is computed on
 * the server; players receive only zones naming maps they already receive (other maps dropped from
 * them), and split requests for maps they can see, with the tally instead of the voters. They
 * never see who voted how; their own ballot is shown as `tally.mine`.
 */
import type { CloudSeat } from "./cloud.ts";
import type { World } from "./world-schema.ts";
import { voteTally } from "./zone-commands.ts";

export function projectZones(world: World, seat: Pick<CloudSeat, "role" | "purseIds"> & { id?: string }) {
  if (seat.role === "dm") return;
  const maps = new Set(world.maps.map((m) => m.id));
  if (world.zones) {
    const zones = world.zones
      .map((z) => ({ ...z, mapIds: z.mapIds.filter((id) => maps.has(id)) }))
      .filter((z) => z.mapIds.length || z.locationIds.length);
    if (zones.length) world.zones = zones;
    else delete world.zones;
  }
  // "Ask the DM" moves (PR 8): players see their own only.
  if (world.moveRequests) {
    const own = world.moveRequests.filter((r) => seat.purseIds.includes(r.purseId) && maps.has(r.mapId));
    if (own.length) world.moveRequests = own;
    else delete world.moveRequests;
  }
  if (world.zoneRequests) {
    const requests = world.zoneRequests
      .filter((r) => maps.has(r.toMapId) && (r.status === "open" || seat.purseIds.includes(r.purseId)))
      .map((r) => {
        const projected = { ...r };
        const mine = seat.id ? r.votes?.find((v) => v.seatId === seat.id) : undefined;
        if (r.votes) projected.tally = { ...voteTally(r), ...(mine ? { mine: mine.vote } : {}) };
        delete projected.votes;
        projected.seatId = "";
        if (projected.fromMapId && !maps.has(projected.fromMapId)) projected.fromMapId = null;
        // A zone named after a map the player can't open never reveals its id.
        for (const key of ["fromZone", "toZone"] as const)
          if (projected[key].startsWith("map:") && !maps.has(projected[key].slice(4))) projected[key] = "map:elsewhere";
        return projected;
      });
    if (requests.length) world.zoneRequests = requests;
    else delete world.zoneRequests;
  }
}
