// Place hub (docs/MAP-TILES.md "Place hub"): deep links to a record on a map, "Show on map"
// and the pin → place card. Everything here reads the table the viewer already has (the
// permission-projected room for players), so it can never reveal more than the map itself.
import { mapRecordTypes, type MapRecordReference } from "./connected-maps-schema.ts";
import { mapReferenceRecord } from "./connected-maps.ts";
import { characterLocation, characterVisible, canReadCharacter } from "./character-position.ts";
import { canAccessEstate } from "./estate.ts";
import { readEstate } from "./estate-schema.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { propertyAvailableHere } from "./property.ts";
import { exchangeHere } from "./trade-economy.ts";
import { facilityAccess } from "./ships.ts";
import { npcAvailableHere, shopVisible } from "./world.ts";
import { mapAccessible, readTabletopSession } from "./tabletop.ts";
import { readWorld, type CampaignMap } from "./world-schema.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";

/** The one message for every record a viewer can't be shown: hidden, DM-only, fogged, private,
 * restricted to the active scene, deleted or malformed. A link can't be used to probe secrets. */
export const PLACE_UNAVAILABLE = "That place isn't on a map you can open.";

type Viewer = Pick<CloudSeat, "role" | "purseIds">;
type Table = CloudTable;

const PARAM_LIMIT = 170;
/** `kind:id`, bounded, with a known kind and a 1–150 character identity. */
export function parseRecordParam(value: unknown): MapRecordReference | undefined {
  if (typeof value !== "string" || !value || value.length > PARAM_LIMIT) return undefined;
  const split = value.indexOf(":");
  if (split <= 0) return undefined;
  const kind = value.slice(0, split),
    id = value.slice(split + 1);
  if (!(mapRecordTypes as readonly string[]).includes(kind)) return undefined;
  // eslint-disable-next-line no-control-regex
  if (!id || id.length > 150 || /[\u0000-\u001f\u007f]/.test(id)) return undefined;
  return { kind: kind as MapRecordReference["kind"], id };
}
export const recordParam = (ref: MapRecordReference) => `${ref.kind}:${ref.id}`;
export const sameRecord = (a?: MapRecordReference, b?: MapRecordReference) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;
/** In-app path for "Show on map" (`record`) or the DM's "Place on map" (`place`). */
export function recordMapHref(
  mapId: string | undefined,
  ref: MapRecordReference,
  mode: "record" | "place" = "record",
) {
  const query = new URLSearchParams();
  if (mapId) query.set("map", mapId);
  query.set(mode, recordParam(ref));
  return `/maps?${query.toString()}`;
}

/** Maps this viewer may open, with the same rule the server projection uses. */
export function browsableMaps(t: Table, viewer: Viewer) {
  return readWorld(t.journal?.world).maps.filter((m) => mapAccessible(t, m, viewer));
}

/** Kinds the map already draws at their location's anchor until the DM pins them. */
const anchoredKinds = new Set<MapRecordReference["kind"]>([
  "shop",
  "npc",
  "character",
  "property",
]);
/** Where a record is drawn by default (its location), or undefined when it is not drawn there.
 * Mirrors the visibility rules of the map's inferred pins. */
function inferredLocation(t: Table, ref: MapRecordReference, viewer: Viewer) {
  const dm = viewer.role === "dm";
  if (!anchoredKinds.has(ref.kind)) return undefined;
  switch (ref.kind) {
    case "shop": {
      const s = t.shops.find((s) => s.id === ref.id);
      return s && (dm || shopVisible(s, t)) ? s.locationId : undefined;
    }
    case "npc": {
      const n = t.journal?.world?.npcs.find((n) => n.id === ref.id),
        p = t.purses.find((p) => p.id === ref.id);
      return n && p && (dm || npcAvailableHere(n, t)) ? characterLocation(t, p) : undefined;
    }
    case "character": {
      const p = t.purses.find((p) => p.id === ref.id && p.kind === "character");
      if (!p || t.journal?.world?.npcs.some((n) => n.id === p.id)) return undefined;
      return dm || characterVisible(t, p) ? characterLocation(t, p) : undefined;
    }
    case "property": {
      const h = t.holdings.find((h) => h.id === ref.id && h.kind === "property");
      if (!h || h.quantity <= 0) return undefined;
      const sited = t.journal?.propertyOperations?.sites.some((s) => s.propertyId === h.id);
      return dm || viewer.purseIds.includes(h.purseId) || sited ? h.locationId : undefined;
    }
  }
  return undefined;
}

export type RecordSpot = {
  map: CampaignMap;
  point: { x: number; y: number };
  /** An exact pin (or a location's own anchor); otherwise inherited from an anchor. */
  exact: boolean;
  /** DM view only: the exact pin is DM only. Never set for players. */
  dmOnly: boolean;
};

/**
 * Every map on which this viewer can see the record, best first:
 * exact pins (the active scene first), then the location's anchor (nearest anchored place,
 * then the location's default map). A hidden or DM-only pin gives players exactly the same
 * answer as no pin: the map is skipped, as the map itself hides that record there.
 */
export function recordMapSpots(
  t: Table,
  ref: MapRecordReference,
  viewer: Viewer,
  maps: CampaignMap[] = browsableMaps(t, viewer),
): RecordSpot[] {
  const dm = viewer.role === "dm";
  if (!mapReferenceRecord(t, ref)) return [];
  const market = readMarketLocations(t.journal?.market),
    active = readTabletopSession(t).activeMapId;
  const exact: (RecordSpot & { rank: number })[] = [],
    approximate: (RecordSpot & { rank: number; preferred: boolean })[] = [];
  const location = ref.kind === "location" ? ref.id : inferredLocation(t, ref, viewer);
  const path = location ? [...locationPath(market, location)].reverse() : [];
  for (const map of maps) {
    const placements = map.connected?.placements ?? [];
    const pin = placements.find(
      (p) => sameRecord(p.record, ref) && (dm || p.visibility === "party"),
    );
    if (pin) {
      exact.push({
        map,
        point: { x: pin.x, y: pin.y },
        exact: true,
        dmOnly: dm && pin.visibility === "dm",
        rank: map.id === active ? 0 : 1,
      });
      continue;
    }
    // Any other pin for this record on this map (hidden, DM only, fogged) hides the fallback.
    const placed = map.connected?.placedRecords ?? placements.map((p) => p.record);
    if (placed.some((r) => sameRecord(r, ref))) continue;
    if (!path.length) continue;
    if (ref.kind === "location") {
      const anchor = map.anchors.find((a) => a.locationId === ref.id);
      if (anchor)
        exact.push({
          map,
          point: { x: anchor.x, y: anchor.y },
          exact: true,
          dmOnly: false,
          rank: map.id === active ? 0 : 1,
        });
      continue;
    }
    const depth = path.findIndex((l) => map.anchors.some((a) => a.locationId === l.id));
    if (depth < 0) continue;
    const anchor = map.anchors.find((a) => a.locationId === path[depth].id)!;
    approximate.push({
      map,
      point: { x: anchor.x, y: anchor.y },
      exact: false,
      dmOnly: false,
      rank: depth,
      preferred: !!map.connected?.defaultForLocation && map.locationId === path[depth].id,
    });
  }
  const byName = (a: { map: CampaignMap }, b: { map: CampaignMap }) =>
    a.map.name.localeCompare(b.map.name) || a.map.id.localeCompare(b.map.id);
  exact.sort((a, b) => a.rank - b.rank || byName(a, b));
  approximate.sort(
    (a, b) => a.rank - b.rank || Number(b.preferred) - Number(a.preferred) || byName(a, b),
  );
  return [...exact, ...approximate].map(({ map, point, exact, dmOnly }) => ({
    map,
    point,
    exact,
    dmOnly,
  }));
}

export type RecordMapStatus =
  | { kind: "placed"; spots: RecordSpot[] }
  | { kind: "several"; spots: RecordSpot[] }
  | { kind: "approximate"; spots: RecordSpot[] }
  | { kind: "dm-only"; spots: RecordSpot[] }
  | { kind: "none"; spots: [] };
/** The "Show on map" strip state. Players only ever see "placed"/"several"/"approximate"/"none". */
export function recordMapStatus(spots: RecordSpot[]): RecordMapStatus {
  if (!spots.length) return { kind: "none", spots: [] };
  if (spots.length > 1) return { kind: "several", spots };
  if (spots[0].dmOnly) return { kind: "dm-only", spots };
  return { kind: spots[0].exact ? "placed" : "approximate", spots };
}

/** Whether this viewer may use the record's service here (the same checks as the original
 * screens). Viewing a pin never grants remote access; every command rechecks on the authority. */
export function mapServiceAllowed(
  t: Table,
  ref: MapRecordReference,
  seat: Viewer & { shopIds?: string[] },
) {
  const record = mapReferenceRecord(t, ref);
  if (!record) return false;
  if (seat.role === "dm") return true;
  const estate = readEstate(t.journal?.propertyOperations),
    market = readMarketLocations(t.journal?.market);
  switch (ref.kind) {
    case "shop": {
      const s = t.shops.find((s) => s.id === ref.id)!;
      return (!seat.shopIds || seat.shopIds.includes(s.id)) && shopVisible(s, t);
    }
    case "npc":
      return npcAvailableHere(t.journal!.world!.npcs.find((n) => n.id === ref.id)!, t);
    case "character":
      return canReadCharacter(t, t.purses.find((p) => p.id === ref.id)!, seat);
    case "property": {
      const h = t.holdings.find((h) => h.id === ref.id)!;
      return seat.purseIds.includes(h.purseId) || canAccessEstate(t, estate, h.id, seat);
    }
    case "listing": {
      const l = t.listings.find((l) => l.id === ref.id)!;
      return (
        propertyAvailableHere(l, market, !!t.journal?.world?.partyPosition) &&
        l.quantity !== 0 &&
        l.status !== "withdrawn"
      );
    }
    case "exchange": {
      const e = t.journal!.tradeEconomy!.exchanges.find((e) => e.id === ref.id)!;
      return e.visible && exchangeHere(t, e);
    }
    case "facility":
      return facilityAccess(t, t.journal!.fleet!.facilities.find((f) => f.id === ref.id)!, seat);
    case "entry": {
      const e = t.journal!.entries!.find((e) => e.id === ref.id)!;
      return (
        e.visibility === "party" || (e.visibility === "player" && seat.purseIds.includes(e.purseId))
      );
    }
  }
  return true;
}

/** The campaign location a record belongs to (for the card's breadcrumb and presence chip). */
export function recordLocationId(t: Table, ref: MapRecordReference): string | null | undefined {
  switch (ref.kind) {
    case "location":
      return ref.id;
    case "shop":
      return t.shops.find((s) => s.id === ref.id)?.locationId;
    case "npc":
    case "character": {
      const p = t.purses.find((p) => p.id === ref.id);
      return p ? characterLocation(t, p) : undefined;
    }
    case "property":
      return t.holdings.find((h) => h.id === ref.id)?.locationId;
    case "listing":
      return t.listings.find((l) => l.id === ref.id)?.locationId;
    case "exchange":
      return t.journal?.tradeEconomy?.exchanges.find((e) => e.id === ref.id)?.locationId;
    case "facility":
      return t.journal?.fleet?.facilities.find((f) => f.id === ref.id)?.locationId;
  }
  return undefined;
}
/** Whether the party is at (or inside) the record's location. Travelling parties are nowhere. */
export function partyAt(t: Table, locationId: string | null | undefined) {
  if (!locationId || t.journal?.world?.partyPosition) return false;
  const market = readMarketLocations(t.journal?.market);
  return (
    !!market.currentLocationId &&
    locationPath(market, market.currentLocationId).some((l) => l.id === locationId)
  );
}

/** An NPC pin opens the conversation hub (#188) unless a player controls that NPC; controlled
 * NPCs keep the existing interaction (Talk plus the Trading & Barter table). */
export const npcPinOpensHub = (npc: { controllerPurseId: string | null }) => !npc.controllerPurseId;
