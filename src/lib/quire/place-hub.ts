// Place hub (docs/MAP-TILES.md "Place hub"): deep links to a record on a map, "Show on map"
// and the pin → place card. Everything here reads the table the viewer already has (the
// permission-projected room for players), so it can never reveal more than the map itself.
import { readServices } from "./services-schema.ts";
import { approvedOffers, serviceLabel } from "./services.ts";
import {
  mapRecordTypes,
  type ConnectedMap,
  type MapPlacement,
  type MapRecordReference,
} from "./connected-maps-schema.ts";
import { formatCopper } from "./money.ts";
import { partyEnvironment } from "./map-tiles.ts";
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
import type { CampaignMap } from "./world-schema.ts";
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
  // The journal is already parsed; no re-validation per card.
  return (t.journal?.world?.maps ?? []).filter((m) => mapAccessible(t, m, viewer));
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

/** Kinds that can use a portrait pin. */
export const portraitKinds = new Set<MapRecordReference["kind"]>(["npc", "character"]);
/** The portrait a portrait pin shows (an NPC's own portrait, else its purse's), if any. */
export function placementPortrait(t: Pick<Table, "purses" | "journal">, ref: MapRecordReference) {
  if (!portraitKinds.has(ref.kind)) return undefined;
  return (
    (ref.kind === "npc"
      ? t.journal?.world?.npcs.find((n) => n.id === ref.id)?.portrait
      : undefined) ?? t.purses.find((p) => p.id === ref.id)?.portrait
  );
}

// ---------------------------------------------------------------------------------------------
// Phase B: DM placement (`place=`), portrait pins and the "Here" sheet.

/**
 * The `map-save` that places, moves, restyles or removes one record's exact pin. It keeps the
 * pin's identity and label, and changes nothing else on the map. `change: null` removes the pin.
 * A pin never changes where the record belongs.
 */
export function placementSave(
  map: CampaignMap,
  ref: MapRecordReference,
  change: Partial<Pick<MapPlacement, "x" | "y" | "visibility" | "style">> | null,
  newId: () => string = () => crypto.randomUUID(),
) {
  const connected: ConnectedMap = map.connected ?? { links: [], placements: [] };
  const existing = connected.placements.find((p) => sameRecord(p.record, ref));
  const others = connected.placements.filter((p) => !sameRecord(p.record, ref));
  let placements = others;
  if (change) {
    const x = change.x ?? existing?.x,
      y = change.y ?? existing?.y;
    if (x === undefined || y === undefined) throw Error("Choose where the pin goes on the map.");
    const style = "style" in change ? change.style : existing?.style;
    const next: MapPlacement = {
      id: existing?.id ?? newId(),
      record: { kind: ref.kind, id: ref.id },
      x,
      y,
      visibility: change.visibility ?? existing?.visibility ?? "party",
      ...(existing?.label ? { label: existing.label } : {}),
      ...(style && style !== "icon" && portraitKinds.has(ref.kind) ? { style } : {}),
    };
    placements = [...others, next];
  } else if (!existing) throw Error("This record has no exact pin on this map.");
  const next = { ...connected, placements };
  delete next.placedRecords;
  return {
    kind: "map-save" as const,
    mapId: map.id,
    before: map,
    map: { ...map, connected: next },
  };
}

/** The map a DM's "Place on map" opens: the record's best map, else its location's default
 * map, else the active scene, else the first map. */
export function placementMap(t: Table, ref: MapRecordReference, maps: CampaignMap[]) {
  const dm = { role: "dm" as const, purseIds: [] };
  const spot = recordMapSpots(t, ref, dm, maps)[0];
  if (spot) return spot.map;
  const location = recordLocationId(t, ref);
  const market = readMarketLocations(t.journal?.market);
  for (const l of [...locationPath(market, location)].reverse()) {
    const local = maps.find((m) => m.locationId === l.id && m.connected?.defaultForLocation);
    if (local) return local;
    const any = maps.find((m) => m.locationId === l.id);
    if (any) return any;
  }
  const active = readTabletopSession(t).activeMapId;
  return maps.find((m) => m.id === active) ?? maps[0];
}

export type HereRow = {
  reference: MapRecordReference;
  label: string;
  group: "shops" | "people" | "services";
  /** Shop, Trade, Person, Post office, Property, For sale. */
  kind: string;
  detail: string;
  /** The verb on the row's button: Shop, Trade, Talk, Send, Open, View. */
  action: string;
  /** DM view only: players would not see this row. */
  dmOnly: boolean;
  /** Distinguishes several rows for one record (an NPC's service providers). */
  key?: string;
  /** Why the row's action can't be used now (a closed or paused service). */
  disabled?: string;
};
export type HereSheet =
  | { mode: "here"; locationName: string; rows: HereRow[] }
  | { mode: "road"; environment: string }
  | { mode: "nowhere" }
  | {
      mode: "away";
      placeName: string;
      partyPlace: string;
      rows: { reference: MapRecordReference; label: string; kind: string; action: string; dmOnly: boolean }[];
    };

const firstLine = (text: string) => {
  const line = text.split("\n")[0].trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

/**
 * The "Here" sheet (derived, never stored): what this viewer may use at the party's location,
 * with the same checks as the original screens. When the viewer browses a map of somewhere else
 * it becomes a read-only list of that map's pins the viewer already receives: names and kinds
 * only, never stock, prices, hours or people's details.
 */
export function hereSheet(
  t: Table,
  viewer: Viewer & { shopIds?: string[] },
  viewed?: CampaignMap,
): HereSheet {
  const dm = viewer.role === "dm";
  const market = readMarketLocations(t.journal?.market);
  const world = { npcs: t.journal?.world?.npcs ?? [], partyPosition: t.journal?.world?.partyPosition };
  const current = market.currentLocationId;
  const path = locationPath(market, current);
  const name = (id?: string | null) => market.locations.find((l) => l.id === id)?.name ?? "";
  // Browsing a map of a place the party isn't in (nor inside): read only.
  if (viewed?.locationId && current && !path.some((l) => l.id === viewed.locationId)) {
    const inside = locationPath(market, viewed.locationId).some((l) => l.id === current);
    if (!inside) {
      const verbs: Partial<Record<MapRecordReference["kind"], [string, string]>> = {
        shop: ["Shop", "Visit to shop"],
        npc: ["Person", "Visit to talk"],
        character: ["Person", "Visit to talk"],
        property: ["Property", "Visit to open"],
        listing: ["For sale", "Visit to view"],
        exchange: ["Trade", "Visit to trade"],
        facility: ["Dock", "Visit to use"],
        location: ["Place", "Visit"],
      };
      const offices = new Set(readEstate(t.journal?.propertyOperations).postal.offices.map((o) => o.shopId));
      return {
        mode: "away",
        placeName: name(viewed.locationId) || viewed.name,
        partyPlace: world.partyPosition ? "on the road" : name(current),
        rows: (viewed.connected?.placements ?? []).flatMap((p) => {
          const verb = verbs[p.record.kind];
          if (!verb || (!dm && p.visibility !== "party") || !mapReferenceRecord(t, p.record)) return [];
          const office = p.record.kind === "shop" && offices.has(p.record.id);
          const label =
            p.label ?? (mapReferenceRecord(t, p.record) as { name?: string } | undefined)?.name;
          if (!label) return [];
          return [
            {
              reference: p.record,
              label,
              kind: office ? "Post office" : verb[0],
              action: office ? "Visit to send" : verb[1],
              dmOnly: p.visibility === "dm",
            },
          ];
        }),
      };
    }
  }
  if (world.partyPosition) return { mode: "road", environment: partyEnvironment(world.partyPosition) };
  if (!current) return { mode: "nowhere" };
  const on = (id?: string | null) => !!id && path.some((l) => l.id === id);
  const rows: HereRow[] = [];
  const estate = readEstate(t.journal?.propertyOperations);
  const offices = new Set(estate.postal.offices.map((o) => o.shopId));
  for (const s of t.shops) {
    if (!on(s.locationId)) continue;
    const visible =
      shopVisible(s, t) && (dm || !viewer.shopIds || viewer.shopIds.includes(s.id));
    if (!dm && !visible) continue;
    const office = offices.has(s.id);
    rows.push({
      reference: { kind: "shop", id: s.id },
      label: s.name,
      group: office ? "services" : "shops",
      kind: office ? "Post office" : s.blackMarket ? "Black market" : "Shop",
      detail: [s.closed ? "Closed" : "Open", name(s.locationId)].filter(Boolean).join(" · "),
      action: office ? "Send" : "Shop",
      dmOnly: !visible,
    });
  }
  for (const e of t.journal?.tradeEconomy?.exchanges ?? []) {
    if (!on(e.locationId)) continue;
    const visible = e.visible && exchangeHere(t, e);
    if (!dm && !visible) continue;
    rows.push({
      reference: { kind: "exchange", id: e.id },
      label: e.name,
      group: "shops",
      kind: "Trade",
      detail: `${e.offers.length} ${e.offers.length === 1 ? "good" : "goods"} quoted${e.open ? "" : " · closed"}`,
      action: "Trade",
      dmOnly: !visible,
    });
  }
  for (const n of world.npcs) {
    const p = t.purses.find((p) => p.id === n.id);
    const available = npcAvailableHere(n, t);
    if (!(available || (dm && p && on(characterLocation(t, p))))) continue;
    rows.push({
      reference: { kind: "npc", id: n.id },
      label: n.name,
      group: "people",
      kind: "Person",
      detail: firstLine(n.description),
      action: "Talk",
      dmOnly: !available,
    });
  }
  for (const h of t.holdings) {
    if (h.kind !== "property" || h.quantity <= 0 || !on(h.locationId)) continue;
    const own = viewer.purseIds.includes(h.purseId);
    if (!dm && !own && !canAccessEstate(t, estate, h.id, viewer)) continue;
    rows.push({
      reference: { kind: "property", id: h.id },
      label: h.name,
      group: "services",
      kind: "Property",
      detail: own ? "Your property" : dm ? (t.purses.find((p) => p.id === h.purseId)?.name ?? "Property") : "You have access",
      action: "Open",
      dmOnly: false,
    });
  }
  for (const l of t.listings) {
    if (!on(l.locationId) || l.quantity === 0 || l.status === "withdrawn") continue;
    rows.push({
      reference: { kind: "listing", id: l.id },
      label: l.name,
      group: "services",
      kind: "For sale",
      detail: `For sale · ${formatCopper(l.copper)}`,
      action: "View",
      dmOnly: false,
    });
  }
  // Service providers (docs/SERVICES.md): one row each, opening the provider NPC's conversation.
  const services = readServices(t.journal?.services);
  for (const p of services.providers) {
    const shop = t.shops.find((s) => s.id === p.shopId),
      offers = approvedOffers(p);
    if (!shop || !on(shop.locationId) || !offers.length) continue;
    const npc = world.npcs.find((n) => n.id === p.npcId);
    if (!npc || (!dm && !npcAvailableHere(npc, t))) continue;
    const mine = services.orders.filter((o) => o.providerId === p.id && viewer.purseIds.includes(o.purseId));
    const ready = mine.find((o) => o.status === "ready");
    const closed = shop.closed ? `Closed${p.paused ? `: ${p.paused.reason}` : ""}` : p.paused ? `Not taking new orders: ${p.paused.reason}` : "";
    rows.push({
      reference: { kind: "npc", id: p.npcId },
      key: `service:${p.id}`,
      label: `${serviceLabel(p)} · ${shop.name}`,
      group: "services",
      kind: serviceLabel(p),
      detail: closed || `${npc.name} · ${ready ? "your order is ready to collect" : `${offers.length} ${offers.length === 1 ? "offer" : "offers"}`}`,
      action: ready ? "Collect" : p.kind === "inn" ? "Book" : "Services",
      dmOnly: false,
      ...(shop.closed || (p.paused && !ready) ? { disabled: closed } : {}),
    });
  }
  const order = { shops: 0, people: 1, services: 2 };
  rows.sort((a, b) => order[a.group] - order[b.group] || a.label.localeCompare(b.label));
  return { mode: "here", locationName: name(current), rows };
}
