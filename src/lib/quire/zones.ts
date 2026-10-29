import type { CloudTable } from "./cloud.ts";
import { travellingJourney } from "./journey-engine.ts";
import { groupPlace, MAIN_GROUP, purseGroup, resolveGroup } from "./party-groups.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import type { CampaignMap } from "./world-schema.ts";

/**
 * Zones: maps that count as one place (docs/plans/MAP-TOKENS.md section 6A). One function, shared
 * by the client, the server and the device engine. A zone id is `loc:<city, town or region id>` or
 * `map:<id>` (derived from the location tree; explicit zones arrive with the Zones editor):
 * - a map whose location is a city or town, or an area inside one, is in that city's zone;
 * - a map whose location is a region (and not inside a city) is in that region's zone;
 * - a map with no location takes its parent map's zone; with no parent it is its own zone, so
 *   nothing silently becomes "the same place".
 */
type T = Pick<CloudTable, "journal">;

/** The zone of a location: its city or town, else its own region (or the location itself). */
export function locationZone(table: T, locationId: string | null | undefined): string | undefined {
  if (!locationId) return undefined;
  const path = locationPath(readMarketLocations(table.journal?.market), locationId);
  if (!path.length) return undefined;
  const town = [...path].reverse().find((l) => l.kind === "city" || l.kind === "town");
  return `loc:${(town ?? path[path.length - 1]).id}`;
}

export function zoneOf(table: T, mapId: string): string {
  const maps = table.journal?.world?.maps ?? [];
  const seen = new Set<string>();
  let map: CampaignMap | undefined = maps.find((m) => m.id === mapId);
  while (map && !seen.has(map.id)) {
    seen.add(map.id);
    const zone = locationZone(table, map.locationId);
    if (zone) return zone;
    const parentId: string | undefined = map.connected?.parentMapId;
    map = parentId ? maps.find((m) => m.id === parentId) : undefined;
  }
  return `map:${mapId}`;
}

/** The zone's name for messages: the city, town or region, else the map. */
export function zoneName(table: T, zone: string): string {
  const [kind, id] = [zone.slice(0, zone.indexOf(":")), zone.slice(zone.indexOf(":") + 1)];
  if (kind === "loc") return readMarketLocations(table.journal?.market).locations.find((l) => l.id === id)?.name ?? "this place";
  return table.journal?.world?.maps.find((m) => m.id === id)?.name ?? "this place";
}

export type CharacterPlace =
  /** On the road (a journey or a free party position): only the map with the party marker. */
  | { kind: "travel"; mapId?: string }
  | { kind: "zone"; zone: string }
  | { kind: "unknown" };

/**
 * Where a character is, for following their map view: their group's travel marker, else the zone
 * of their group's location, else the zone of the map their token is on now.
 */
export function characterPlace(table: Pick<CloudTable, "journal" | "purses">, purseId: string, tokenMapId?: string): CharacterPlace {
  const group = resolveGroup(table, purseGroup(table, purseId) ?? MAIN_GROUP);
  const place = groupPlace(table, group);
  if (place.position || travellingJourney(table, group)) return { kind: "travel", mapId: place.position?.mapId };
  const zone = locationZone(table, place.locationId);
  if (zone) return { kind: "zone", zone };
  if (tokenMapId) return { kind: "zone", zone: zoneOf(table, tokenMapId) };
  return { kind: "unknown" };
}

/** Whether a token may follow the player's view onto this map (null) or why not. */
export function followRefusal(
  table: Pick<CloudTable, "journal" | "purses">,
  purseId: string,
  name: string,
  toMapId: string,
  tokenMapId?: string,
): string | null {
  const place = characterPlace(table, purseId, tokenMapId);
  if (place.kind === "travel")
    return place.mapId === toMapId ? null : `Viewing only — ${name} is on the road. Tokens follow only onto the map with the party marker.`;
  if (place.kind === "unknown") return `Viewing only — ${name} has no place yet. Use Place my token.`;
  if (zoneOf(table, toMapId) === place.zone) return null;
  return `Viewing only — ${name} is in ${zoneName(table, place.zone)}.`;
}
