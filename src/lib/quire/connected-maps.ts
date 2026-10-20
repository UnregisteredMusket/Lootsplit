import { characterVisible } from "./character-position.ts";
import { canAccessEstate } from "./estate.ts";
import { readEstate } from "./estate-schema.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { CampaignMap } from "./world-schema.ts";
import type { MapRecordReference } from "./connected-maps-schema.ts";

/** Exact identities only. This operates on the authoritative table, or an already
 * permission-projected table; it must never substitute for service authorization. */
export function mapReferenceRecord(t: CloudTable, ref: MapRecordReference) {
  switch (ref.kind) {
    case "location":
      return t.journal?.market?.locations.find((r) => r.id === ref.id);
    case "shop":
      return t.shops.find((r) => r.id === ref.id);
    case "npc":
      return t.journal?.world?.npcs.find((r) => r.id === ref.id);
    case "character":
      return t.purses.find((r) => r.id === ref.id && r.kind === "character");
    case "property":
      return t.holdings.find((r) => r.id === ref.id && r.kind === "property");
    case "listing":
      return t.listings.find((r) => r.id === ref.id);
    case "exchange":
      return t.journal?.tradeEconomy?.exchanges.find((r) => r.id === ref.id);
    case "facility":
      return t.journal?.fleet?.facilities.find((r) => r.id === ref.id);
    case "entry":
      return t.journal?.entries?.find((r) => r.id === ref.id);
    case "handout":
      return t.handouts?.find((r) => r.id === ref.id);
  }
}
export function mapReferenceName(t: CloudTable, ref: MapRecordReference) {
  const record = mapReferenceRecord(t, ref);
  if (!record) return undefined;
  return "name" in record ? record.name : "title" in record ? record.title : "Journal entry";
}
export function validateConnectedMaps(t: CloudTable, projected = false) {
  const maps = t.journal?.world?.maps ?? [],
    defaults = new Set<string>();
  const unique = (values: string[]) => new Set(values).size === values.length;
  for (const map of maps) {
    const nav = map.connected;
    if (!nav) continue;
    const seen = new Set([map.id]);
    let parent = nav.parentMapId;
    while (parent) {
      if (seen.has(parent)) throw Error("Map containment cannot contain a cycle.");
      seen.add(parent);
      const target = maps.find((m) => m.id === parent);
      if (!target) throw Error("A parent map is missing. Update its connected maps first.");
      parent = target.connected?.parentMapId;
    }
    if (nav.defaultForLocation) {
      if (!map.locationId) throw Error("Choose a location before assigning its default map.");
      const key = JSON.stringify([map.locationId, nav.defaultForLocation]);
      if (defaults.has(key))
        throw Error(
          "This place already has a default map for that purpose. Clear it before assigning another.",
        );
      defaults.add(key);
    }
    if (
      !unique(nav.links.map((l) => l.id)) ||
      !unique(nav.placements.map((p) => p.id)) ||
      !unique(nav.placements.map((p) => JSON.stringify(p.record)))
    )
      throw Error("Map links and record placements must have unique identities.");
    for (const link of nav.links)
      if (link.targetMapId === map.id || !maps.some((m) => m.id === link.targetMapId))
        throw Error(
          "A linked destination is missing or refers to this map. Update its connected maps first.",
        );
    if (!projected)
      for (const pin of nav.placements)
        if (!mapReferenceRecord(t, pin.record))
          throw Error(
            "A placed record is missing. Remove its map placement before deleting the record.",
          );
  }
}
/** Call after canonical record privacy and geometric projection, including re-projection. */
export function projectConnectedMaps(t: CloudTable, seat: Pick<CloudSeat,"role"|"purseIds">) {
  const permitted=(ref:MapRecordReference)=>{
    if(!mapReferenceRecord(t,ref))return false;
    if(ref.kind==='character')return characterVisible(t,t.purses.find(p=>p.id===ref.id)!);
    if(ref.kind==='property'){const h=t.holdings.find(h=>h.id===ref.id)!;return h.quantity>0&&(seat.purseIds.includes(h.purseId)||canAccessEstate(t,readEstate(t.journal?.propertyOperations),h.id,seat))}
    return true;
  };
  const maps = t.journal?.world?.maps ?? [];
  for (const map of maps) {
    if (!map.connected) continue;
    map.connected = {
      ...map.connected,
      parentMapId: maps.some((m) => m.id === map.connected!.parentMapId)
        ? map.connected.parentMapId
        : undefined,
      links: map.connected.links.filter(
        (l) => l.visibility === "party" && maps.some((m) => m.id === l.targetMapId),
      ),
      placedRecords: (
        map.connected.placedRecords ?? map.connected.placements.map((p) => p.record)
      ).filter((ref) => permitted(ref)),
      placements: map.connected.placements.filter(
        (p) => p.visibility === "party" && permitted(p.record),
      ),
    };
  }
}
export function mapsForLocation(
  maps: CampaignMap[],
  locationId: string,
  purpose?: "regional" | "local" | "battle",
) {
  const matching = maps.filter(
    (m) =>
      m.locationId === locationId &&
      (!purpose || m.connected?.defaultForLocation===purpose ||
        (purpose === "battle"
          ? m.type === "battle"
          : purpose === "regional"
            ? m.type === "regional"
            : !["battle", "regional"].includes(m.type ?? ""))),
  );
  return matching.sort(
    (a, b) =>
      Number(b.connected?.defaultForLocation === (purpose ?? "local")) -
        Number(a.connected?.defaultForLocation === (purpose ?? "local")) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
export function defaultLocationMap(
  maps: CampaignMap[],
  locationId: string,
  purpose: "regional" | "local" | "battle" = "local",
) {
  const choices = mapsForLocation(maps, locationId, purpose);
  return (
    choices.find((m) => m.connected?.defaultForLocation === purpose) ??
    (choices.length === 1 ? choices[0] : undefined)
  );
}
export function mapAncestry(maps: CampaignMap[], map: CampaignMap) {
  const trail = [map],
    seen = new Set([map.id]);
  let parent = map.connected?.parentMapId;
  while (parent && !seen.has(parent)) {
    const next = maps.find((m) => m.id === parent);
    if (!next) break;
    trail.unshift(next);
    seen.add(next.id);
    parent = next.connected?.parentMapId;
  }
  return trail;
}
