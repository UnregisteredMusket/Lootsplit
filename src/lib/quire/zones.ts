import type { CloudTable } from "./cloud.ts";
import { travellingJourney } from "./journey-engine.ts";
import { activeGroups, groupPlace, MAIN_GROUP, purseGroup, resolveGroup } from "./party-groups.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { readTravel, type CampaignMap, type SplitRuleSettings, type Zone } from "./world-schema.ts";
import { DEFAULT_SPLIT_RULE } from "./world-schema.ts";

/**
 * Zones: maps that count as one place (docs/plans/MAP-TOKENS.md section 6A). One module, shared
 * by the client, the server and the device engine. A zone id is `zone:<id>` (saved by the DM),
 * `loc:<city, town or region id>` or `map:<id>` (derived from the location tree):
 * - a map or location the DM put in a zone is in it (a map's own entry wins over its location's);
 * - a map whose location is a city or town, or an area inside one, is in that city's zone;
 * - a map whose location is a region (and not inside a city) is in that region's zone;
 * - a map with no location takes its parent map's zone; with no parent it is its own zone, so
 *   nothing silently becomes "the same place".
 */
type T = Pick<CloudTable, "journal">;
const zones = (table: T): Zone[] => table.journal?.world?.zones ?? [];
/** A saved zone that customises a derived one stands in for it. */
function canonical(table: T, ref: string): string {
  const saved = zones(table).find((z) => z.derivedFrom === ref);
  return saved ? `zone:${saved.id}` : ref;
}

/** The zone of a location: a saved zone listing it (or an ancestor), else its city or town, else its region. */
export function locationZone(table: T, locationId: string | null | undefined): string | undefined {
  if (!locationId) return undefined;
  const path = locationPath(readMarketLocations(table.journal?.market), locationId);
  if (!path.length) return undefined;
  for (const location of [...path].reverse()) {
    const saved = zones(table).find((z) => z.locationIds.includes(location.id));
    if (saved) return `zone:${saved.id}`;
  }
  const town = [...path].reverse().find((l) => l.kind === "city" || l.kind === "town");
  return canonical(table, `loc:${(town ?? path[path.length - 1]).id}`);
}

export function zoneOf(table: T, mapId: string): string {
  const maps = table.journal?.world?.maps ?? [];
  const seen = new Set<string>();
  let map: CampaignMap | undefined = maps.find((m) => m.id === mapId);
  while (map && !seen.has(map.id)) {
    seen.add(map.id);
    const listed = zones(table).find((z) => z.mapIds.includes(map!.id));
    if (listed) return `zone:${listed.id}`;
    const zone = locationZone(table, map.locationId);
    if (zone) return zone;
    const parentId: string | undefined = map.connected?.parentMapId;
    map = parentId ? maps.find((m) => m.id === parentId) : undefined;
  }
  return canonical(table, `map:${mapId}`);
}

/** The zone's name for messages: the saved name, the city, town or region, else the map. */
export function zoneName(table: T, zone: string): string {
  const kind = zone.slice(0, zone.indexOf(":")),
    id = zone.slice(zone.indexOf(":") + 1);
  if (kind === "zone") return zones(table).find((z) => z.id === id)?.name ?? "this place";
  if (kind === "loc") return readMarketLocations(table.journal?.market).locations.find((l) => l.id === id)?.name ?? "this place";
  return table.journal?.world?.maps.find((m) => m.id === id)?.name ?? "this place";
}

/** Maps in a zone (by computing each map's zone). */
export const zoneMaps = (table: T, zone: string) => (table.journal?.world?.maps ?? []).filter((m) => zoneOf(table, m.id) === zone);

export type ZoneKind = Zone["kind"];
/** A derived zone's kind: from its location (town, city, region) or its map (dungeon). */
export function zoneKind(table: T, zone: string): ZoneKind {
  const kind = zone.slice(0, zone.indexOf(":")),
    id = zone.slice(zone.indexOf(":") + 1);
  if (kind === "zone") return zones(table).find((z) => z.id === id)?.kind ?? "custom";
  if (kind === "loc") {
    const location = readMarketLocations(table.journal?.market).locations.find((l) => l.id === id);
    return location?.kind === "city" ? "city" : location?.kind === "town" ? "town" : location?.kind === "region" ? "region" : "district";
  }
  const map = table.journal?.world?.maps.find((m) => m.id === id);
  return map?.type === "dungeon" ? "dungeon" : map?.type === "regional" ? "region" : "custom";
}
/** Defaults by kind (plan section 6A.4 table). */
export const ZONE_DEFAULTS: Record<ZoneKind, { travel: "free" | "journey"; sizeMiles?: number }> = {
  district: { travel: "free" },
  town: { travel: "free", sizeMiles: 1 },
  city: { travel: "free", sizeMiles: 3 },
  dungeon: { travel: "free" },
  wilderness: { travel: "journey", sizeMiles: 10 },
  region: { travel: "journey", sizeMiles: 50 },
  custom: { travel: "free" },
};
export function zoneSettings(table: T, zone: string): Zone["settings"] {
  const saved = zone.startsWith("zone:") ? zones(table).find((z) => `zone:${z.id}` === zone) : undefined;
  if (saved) return saved.settings;
  const defaults = ZONE_DEFAULTS[zoneKind(table, zone)];
  return { travel: defaults.travel, ...(defaults.sizeMiles !== undefined ? { sizeMiles: defaults.sizeMiles } : {}) };
}

/** The zone this one is inside: its saved parent, else the region above its city or town. */
export function parentZone(table: T, zone: string): string | undefined {
  const saved = zone.startsWith("zone:") ? zones(table).find((z) => `zone:${z.id}` === zone) : undefined;
  if (saved?.parentZoneId) return canonical(table, saved.parentZoneId);
  const base = saved?.derivedFrom ?? zone;
  if (base.startsWith("loc:")) {
    const path = locationPath(readMarketLocations(table.journal?.market), base.slice(4));
    const region = [...path].reverse().find((l) => l.kind === "region" && `loc:${l.id}` !== base);
    return region ? canonical(table, `loc:${region.id}`) : undefined;
  }
  return undefined;
}

/**
 * Adjacent zones are crossed without a journey (plan 6A.4): a map in one has an entrance link to a
 * map in the other, a parent/child map relation, or a location link (anchor) to the other's
 * location. The DM can mark two zones adjacent with no link, or untick a link.
 */
export function zonesAdjacent(table: T, a: string, b: string): boolean {
  if (a === b) return true;
  const sa = zoneSettings(table, a),
    sb = zoneSettings(table, b);
  if (sa.notAdjacent?.includes(b) || sb.notAdjacent?.includes(a)) return false;
  if (sa.adjacent?.includes(b) || sb.adjacent?.includes(a)) return true;
  const maps = table.journal?.world?.maps ?? [];
  const inA = new Set(zoneMaps(table, a).map((m) => m.id)),
    inB = new Set(zoneMaps(table, b).map((m) => m.id));
  const linked = (x: Set<string>, y: Set<string>) =>
    maps.some(
      (m) =>
        x.has(m.id) &&
        ((m.connected?.links ?? []).some((l) => y.has(l.targetMapId)) ||
          (!!m.connected?.parentMapId && y.has(m.connected.parentMapId)) ||
          (m.anchors ?? []).some((anchor) => !!anchor.locationId && locationZone(table, anchor.locationId) === (y === inB ? b : a))),
    );
  return linked(inA, inB) || linked(inB, inA);
}

/** "This trip takes about N days": from the zones' sizes and the normal pace (estimate only). */
export function tripEstimate(table: T, from: string, to: string) {
  const pace = readTravel(table.journal?.world?.travel).paces.normal;
  const region = parentZone(table, to) ?? parentZone(table, from);
  const miles = Math.round(
    region ? (zoneSettings(table, region).sizeMiles ?? ZONE_DEFAULTS.region.sizeMiles!) * 0.9 : (zoneSettings(table, to).sizeMiles ?? 10) + (zoneSettings(table, from).sizeMiles ?? 10),
  );
  return { miles, days: Math.max(1, Math.ceil(miles / pace)), pace };
}

/** The split rule for leaving a zone: the zone's own override, else the campaign's. */
export function splitRuleFor(table: T, leaving: string): SplitRuleSettings & { allow?: boolean } {
  const campaign = table.journal?.world?.splitRule ?? DEFAULT_SPLIT_RULE;
  const own = zoneSettings(table, leaving).splitRule;
  if (own === "allow") return { ...campaign, allow: true };
  return own ? { ...campaign, rule: own } : campaign;
}

export type CharacterPlace =
  /** On the road (a journey or a free party position): only the map with the party marker. */
  | { kind: "travel"; mapId?: string }
  | { kind: "zone"; zone: string; group: string }
  | { kind: "unknown" };

/**
 * Where a character is, for moving their token: their group's travel marker, else the zone of
 * their group's location, else the zone of the map their token is on now.
 */
export function characterPlace(table: Pick<CloudTable, "journal" | "purses">, purseId: string, tokenMapId?: string): CharacterPlace {
  const group = resolveGroup(table, purseGroup(table, purseId) ?? MAIN_GROUP);
  const place = groupPlace(table, group);
  if (place.position || travellingJourney(table, group)) return { kind: "travel", mapId: place.position?.mapId };
  const zone = locationZone(table, place.locationId);
  if (zone) return { kind: "zone", zone, group };
  if (tokenMapId) return { kind: "zone", zone: zoneOf(table, tokenMapId), group };
  return { kind: "unknown" };
}

/** Another group of the party whose place is in this zone (the character would join it). */
export function groupInZone(table: Pick<CloudTable, "journal" | "purses">, zone: string, except: string): string | undefined {
  for (const ref of [MAIN_GROUP, ...activeGroups(table).map((g) => g.id)]) {
    if (ref === except) continue;
    const place = groupPlace(table, ref);
    if (place.position) {
      if (place.position.mapId && zoneOf(table, place.position.mapId) === zone) return ref;
    } else if (locationZone(table, place.locationId) === zone) return ref;
  }
}

export type Crossing =
  | { kind: "same" }
  /** Into the zone of another of the party's groups: the character joins it (never split-ruled). */
  | { kind: "join"; group: string; from: string; to: string }
  /** Into an adjacent zone: a split, decided by the leaving zone's rule. */
  | { kind: "split"; from: string; to: string; rule: ReturnType<typeof splitRuleFor> }
  | { kind: "far"; from: string; to: string; miles: number; days: number; pace: number }
  | { kind: "refused"; message: string };

/** What a move of this character's token to this map means (plan 6A.2 and 6A.4). */
export function crossing(
  table: Pick<CloudTable, "journal" | "purses">,
  purseId: string,
  name: string,
  toMapId: string,
  tokenMapId?: string,
): Crossing {
  const place = characterPlace(table, purseId, tokenMapId);
  if (place.kind === "travel")
    return place.mapId === toMapId
      ? { kind: "same" }
      : { kind: "refused", message: `Viewing only — ${name} is on the road. Tokens follow only onto the map with the party marker.` };
  if (place.kind === "unknown") return { kind: "refused", message: `Viewing only — ${name} has no place yet. Use Place my token.` };
  const to = zoneOf(table, toMapId);
  if (to === place.zone) return { kind: "same" };
  const join = groupInZone(table, to, place.group);
  if (join) return { kind: "join", group: join, from: place.zone, to };
  if (!zonesAdjacent(table, place.zone, to)) return { kind: "far", from: place.zone, to, ...tripEstimate(table, place.zone, to) };
  return { kind: "split", from: place.zone, to, rule: splitRuleFor(table, place.zone) };
}

/** Whether a token may follow onto this map without a split (null), or the message why not. */
export function followRefusal(
  table: Pick<CloudTable, "journal" | "purses">,
  purseId: string,
  name: string,
  toMapId: string,
  tokenMapId?: string,
): string | null {
  const c = crossing(table, purseId, name, toMapId, tokenMapId);
  if (c.kind === "same" || c.kind === "join") return null;
  if (c.kind === "refused") return c.message;
  if (c.kind === "far") return `This trip takes about ${c.days} ${c.days === 1 ? "day" : "days"}. Ask your DM to plan the journey.`;
  return null;
}
