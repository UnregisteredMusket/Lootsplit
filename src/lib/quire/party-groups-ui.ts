/**
 * Split the party: what the screens show (Party → Characters Groups panel, the split and merge
 * dialogs, the DM desk glance and the player's group card). Pure functions over a table, so the
 * screens and their tests read the same facts the engine checks.
 */
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Purse } from "./types.ts";
import { characterPosition, characterVisible } from "./character-position.ts";
import { locationPath, readMarketLocations, shopAvailableHere } from "./shop-locations.ts";
import {
  activeGroups,
  groupInfo,
  groupMembers,
  groupPlace,
  groupRefs,
  groupTravelling,
  MAIN_GROUP,
  partySplit,
  resolveGroup,
  samePlace,
  seatGroups,
  groupMarket,
} from "./party-groups.ts";
import { groupColours } from "./world-schema.ts";

type Table = Pick<CloudTable, "purses" | "journal"> & Partial<Pick<CloudTable, "shops">>;
export type GroupColour = (typeof groupColours)[number];
export const groupColourNames: Record<GroupColour, string> = {
  green: "Green",
  blue: "Blue",
  amber: "Amber",
  plum: "Plum",
  teal: "Teal",
  red: "Red",
};

/** "Saltmarsh · Harbour ward"; regions are left out when a town or area is known. */
export function placeLabel(t: Pick<CloudTable, "journal">, locationId: string | null | undefined) {
  const path = locationPath(readMarketLocations(t.journal?.market), locationId);
  const shown = path.length > 1 ? path.filter((l) => l.kind !== "region") : path;
  return shown.map((l) => l.name).join(" · ");
}
/** Where a group is, in words: a place, on the road, or "Elsewhere" (hidden from this player). */
export function groupWhere(t: Pick<CloudTable, "journal">, ref: string) {
  const info = groupInfo(t, ref);
  const place = groupPlace(t, ref);
  if (info.hidden && !place.locationId && place.position?.description === "Elsewhere") return "Elsewhere";
  if (place.position) return place.position.description || "On the road";
  return placeLabel(t, place.locationId) || "No particular place";
}

export type GroupSummary = ReturnType<typeof groupInfo> & {
  ref: string;
  where: string;
  locationId: string | null;
  travelling: boolean;
  /** Characters in this group this seat may see (hidden ones only for the DM). */
  members: Purse[];
  /** Hidden characters in the group (counted for the DM only). */
  hiddenMembers: number;
  shops: number;
};
export function groupSummaries(t: Table, seat: Pick<CloudSeat, "role" | "purseIds">): GroupSummary[] {
  const dm = seat.role === "dm";
  return groupRefs(t).map((ref) => {
    const all = groupMembers(t, ref);
    const visible = all.filter((p) => dm || characterVisible(t, p));
    const market = groupMarket(t, ref);
    return {
      ...groupInfo(t, ref),
      ref,
      where: groupWhere(t, ref),
      locationId: groupPlace(t, ref).locationId,
      travelling: groupTravelling(t, ref),
      members: visible,
      hiddenMembers: dm ? all.filter((p) => !characterVisible(t, p)).length : 0,
      shops: (t.shops ?? []).filter(
        (s) => !!s.locationId && !s.closed && (!s.blackMarket || t.journal?.world?.blackMarketActive) && shopAvailableHere(s, market, groupTravelling(t, ref)),
      ).length,
    };
  });
}

/** Characters with the party's placement form but not in any group (downtime, own position). */
export function awayFromParty(t: Table) {
  return t.purses.filter((p) => {
    if (p.kind !== "character") return false;
    const s = characterPosition(t, p);
    if (s.inParty) return false;
    // NPCs elsewhere are location NPCs, not party members away.
    return p.control !== "npc" || !!s.downtime || !!s.shipId;
  });
}
/** The group a character returns to after downtime, as a name ("the party" when whole). */
export function returnGroupName(t: Table, p: Purse) {
  const d = characterPosition(t, p).downtime;
  if (!d?.returnInParty) return "";
  const ref = resolveGroup(t, d.returnGroupId);
  return partySplit(t) ? groupInfo(t, ref).name : "the party";
}

/** Why these groups can't merge now ("" when they can). Mirrors `party-merge`. */
export function mergeBlock(t: Table, refs: string[]): string {
  if (refs.length < 2) return "Choose at least two groups.";
  if (t.journal?.finance?.downtime.some((d) => d.status === "pending"))
    return "Approve or cancel pending downtime before merging groups.";
  const market = readMarketLocations(t.journal?.market);
  for (const ref of refs) {
    const name = groupInfo(t, ref).name;
    if ((t.journal?.world?.journeys ?? []).some((j) => (j.status === "active" || j.status === "arrived") && (j.groupId ?? MAIN_GROUP) === ref))
      return `Merge waits: ${name} is on a journey.`;
    if (groupPlace(t, ref).position) return `Merge waits: ${name} is on the road.`;
  }
  const places = refs.map((r) => groupPlace(t, r).locationId);
  if (places.some((a) => places.some((b) => !samePlace(market, a, b))))
    return `Merge needs the groups at the same place. ${refs
      .map((r) => `${groupInfo(t, r).name} ${groupPlace(t, r).locationId ? `is at ${placeLabel(t, groupPlace(t, r).locationId)}` : "has no place"}`)
      .join("; ")}.`;
  return "";
}
/** The outer place of groups at the same place (the default for the merged group). */
export function outerPlace(t: Table, refs: string[]) {
  const market = readMarketLocations(t.journal?.market);
  const places = refs.map((r) => groupPlace(t, r).locationId);
  return places.reduce<string | null>(
    (outer, p) => (outer && p && locationPath(market, outer).length <= locationPath(market, p).length ? outer : p),
    places[0] ?? null,
  );
}

/** A player's groups (the DM: every group) and the other groups. */
export function playerGroupView(t: Table, seat: Pick<CloudSeat, "role" | "purseIds">) {
  const mine = new Set(seatGroups(t as Pick<CloudTable, "purses" | "journal">, seat));
  const all = groupSummaries(t, seat);
  return { mine: all.filter((g) => mine.has(g.ref)), others: all.filter((g) => !mine.has(g.ref)) };
}

export function activeGroupCount(t: Pick<CloudTable, "journal">) {
  return activeGroups(t).length + 1;
}
/** Colours not taken by other groups (for the split dialog's swatches). */
export function freeColours(taken: string[]): GroupColour[] {
  return groupColours.filter((c) => !taken.includes(c));
}
