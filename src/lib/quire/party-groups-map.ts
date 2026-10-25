/** Split the party on the map: one marker per group, at its free position or its place's anchor. */
import type { CloudTable } from "./cloud.ts";
import type { CampaignMap } from "./world-schema.ts";
import { anchorFor } from "./world.ts";
import { groupInfo, groupPlace, groupRefs } from "./party-groups.ts";
import { groupWhere } from "./party-groups-ui.ts";

export type GroupPin = { ref: string; name: string; letter: string; colour: string; where: string; point: { x: number; y: number } };
export function mapGroupPins(t: Pick<CloudTable, "journal">, map: CampaignMap): GroupPin[] {
  return groupRefs(t).flatMap((ref) => {
    const place = groupPlace(t, ref);
    const info = groupInfo(t, ref);
    const free = place.position;
    const point =
      free && free.mapId === map.id && free.x !== undefined && free.y !== undefined
        ? { x: free.x, y: free.y }
        : !free && place.locationId
          ? anchorFor(map, t, place.locationId)
          : undefined;
    return point ? [{ ref, name: info.name, letter: info.letter, colour: info.colour, where: groupWhere(t, ref), point: { x: point.x, y: point.y } }] : [];
  });
}
