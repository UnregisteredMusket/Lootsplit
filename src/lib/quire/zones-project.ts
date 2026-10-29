/**
 * A player's projection of zones (map tokens PR 7A, plan 6A.5; privacy review 2026-10-29).
 * Allow-lists only:
 * - a zone reaches a player only when at least one map they can see is in it (computed on the
 *   DM's full table), with only those maps, the locations they can see, and parent, derived and
 *   adjacency references to zones, locations and maps they can see;
 * - split requests reach a player only when they are the mover, or hold a ballot on an open vote;
 *   the tally replaces the voters, their own ballot is `tally.mine`, and the map being left and
 *   both zones are replaced when the player can't see them. The mover's group and token square
 *   are DM-only.
 */
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import type { World, Zone, ZoneRequest } from "./world-schema.ts";
import { voteTally } from "./zone-commands.ts";
import { zoneOf } from "./zones.ts";

export function projectZones(world: World, seat: Pick<CloudSeat, "role" | "purseIds"> & { id?: string }, table?: Pick<CloudTable, "journal" | "purses">) {
  if (seat.role === "dm") return;
  const full = table ?? { journal: { world } as never, purses: [] };
  const maps = new Set(world.maps.map((m) => m.id));
  const market = readMarketLocations(full.journal?.market);
  const locations = new Set(
    [full.journal?.market?.currentLocationId, ...world.maps.map((m) => m.locationId)].flatMap((id) =>
      id ? locationPath(market, id).map((l) => l.id) : [],
    ),
  );
  // Zones that hold a map the player sees (zoneOf on the full table, so saved zones count).
  const seenZones = new Set(world.maps.map((m) => zoneOf(full, m.id)));
  const visibleRef = (ref: string) =>
    ref.startsWith("map:") ? maps.has(ref.slice(4)) : ref.startsWith("loc:") ? locations.has(ref.slice(4)) : seenZones.has(ref);
  if (world.zones) {
    const zones = world.zones
      .filter((z) => seenZones.has(`zone:${z.id}`))
      .map((z): Zone => {
        const settings: Zone["settings"] = { travel: z.settings.travel };
        if (z.settings.sizeMiles !== undefined) settings.sizeMiles = z.settings.sizeMiles;
        if (z.settings.splitRule !== undefined) settings.splitRule = z.settings.splitRule;
        const adjacent = z.settings.adjacent?.filter(visibleRef),
          notAdjacent = z.settings.notAdjacent?.filter(visibleRef);
        if (adjacent?.length) settings.adjacent = adjacent;
        if (notAdjacent?.length) settings.notAdjacent = notAdjacent;
        return {
          id: z.id,
          name: z.name,
          kind: z.kind,
          mapIds: z.mapIds.filter((id) => maps.has(id)),
          locationIds: z.locationIds.filter((id) => locations.has(id)),
          ...(z.parentZoneId && visibleRef(z.parentZoneId) ? { parentZoneId: z.parentZoneId } : {}),
          ...(z.derivedFrom && visibleRef(z.derivedFrom) ? { derivedFrom: z.derivedFrom } : {}),
          settings,
        };
      });
    if (zones.length) world.zones = zones;
    else delete world.zones;
  }
  if (world.zoneRequests) {
    const ref = (zone: string) => (visibleRef(zone) ? zone : "map:elsewhere");
    const requests = world.zoneRequests
      .filter(
        (r) =>
          seat.purseIds.includes(r.purseId) ||
          (r.status === "open" && !!seat.id && !!r.votes?.some((v) => v.seatId === seat.id && v.seatId !== r.seatId)),
      )
      .map((r): ZoneRequest => {
        const mine = seat.id ? r.votes?.find((v) => v.seatId === seat.id) : undefined;
        return {
          id: r.id,
          purseId: r.purseId,
          seatId: "",
          fromMapId: r.fromMapId && maps.has(r.fromMapId) ? r.fromMapId : null,
          toMapId: maps.has(r.toMapId) ? r.toMapId : "elsewhere",
          at: maps.has(r.toMapId) ? r.at : { column: 0, row: 0 },
          fromZone: ref(r.fromZone),
          toZone: ref(r.toZone),
          mode: r.mode,
          status: r.status,
          createdAt: r.createdAt,
          ...(r.reason !== undefined ? { reason: r.reason } : {}),
          ...(r.deadline !== undefined ? { deadline: r.deadline } : {}),
          ...(r.majority !== undefined ? { majority: r.majority } : {}),
          ...(r.votes ? { tally: { ...voteTally(r), ...(mine ? { mine: mine.vote } : {}) } } : {}),
          ...(r.sessionId !== undefined ? { sessionId: r.sessionId } : {}),
          ...(r.decidedAt !== undefined ? { decidedAt: r.decidedAt } : {}),
        };
      });
    if (requests.length) world.zoneRequests = requests;
    else delete world.zoneRequests;
  }
}
