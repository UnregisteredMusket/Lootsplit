/** Split the party: invariants checked by `validateWorld` on every command's result. */
import type { CloudTable } from "./cloud.ts";
import { MAX_PARTY_GROUPS, readWorld } from "./world-schema.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { MAIN_GROUP } from "./party-groups.ts";

export function validatePartyGroups(t: CloudTable, projected = false) {
  const w = readWorld(t.journal?.world);
  const groups = w.groups ?? [];
  const active = groups.filter((g) => g.status === "active");
  const ids = new Set(groups.map((g) => g.id));
  if (ids.size !== groups.length || ids.has(MAIN_GROUP)) throw Error("Duplicate party group IDs.");
  if (active.length > MAX_PARTY_GROUPS - 1)
    throw Error(`The party can be split into at most ${MAX_PARTY_GROUPS} groups.`);
  const letters = active.flatMap((g) => (g.letter ? [g.letter] : []));
  if (new Set(letters).size !== letters.length || letters.includes("A"))
    throw Error("Each group needs its own letter.");
  if (!active.length && w.mainGroup) throw Error("The main group's label belongs to a split party.");
  const colours = [w.mainGroup?.colour ?? "green", ...active.map((g) => g.colour)];
  if (active.length && new Set(colours).size !== colours.length) throw Error("Give each group its own colour.");
  const locations = new Set(readMarketLocations(t.journal?.market).locations.map((l) => l.id));
  for (const g of groups) {
    if (g.status === "merged" && !g.mergedInto) throw Error("A merged group must record where it merged.");
    if (g.status !== "active") continue;
    if (g.locationId && g.position) throw Error("A group is either at a place or on the road.");
    if (!projected && g.locationId && !locations.has(g.locationId)) throw Error("A group's location is missing.");
    if (!projected && g.position && (!g.position.mapId || !w.maps.some((m) => m.id === g.position!.mapId)))
      throw Error("A group's free position requires an existing map.");
  }
  const members = new Map<string, number>();
  for (const s of w.characterPositions) {
    if (s.groupId) {
      if (!s.inParty || s.downtime || !active.some((g) => g.id === s.groupId))
        throw Error("A character's group must be an active group of the party.");
      members.set(s.groupId, (members.get(s.groupId) ?? 0) + 1);
    }
    if (!projected && s.downtime?.returnGroupId && !ids.has(s.downtime.returnGroupId))
      throw Error("A character's downtime return group is missing.");
  }
  // Characters on downtime or aboard alone count for the group they will return to.
  for (const s of w.characterPositions)
    if (s.downtime?.returnInParty && s.downtime.returnGroupId)
      members.set(s.downtime.returnGroupId, (members.get(s.downtime.returnGroupId) ?? 0) + 1);
  for (const a of t.journal?.fleet?.aboard ?? [])
    if (a.returnInParty && a.returnGroupId) members.set(a.returnGroupId, (members.get(a.returnGroupId) ?? 0) + 1);
  if (!projected && active.some((g) => !members.get(g.id)))
    throw Error("A group can't be left empty. Merge it, or move a character into it first.");
  if (!projected)
    for (const a of t.journal?.fleet?.aboard ?? [])
      if (a.returnGroupId && !ids.has(a.returnGroupId)) throw Error("An aboard character's return group is missing.");
  const requests = w.groupRequests ?? [];
  if (new Set(requests.map((r) => r.id)).size !== requests.length) throw Error("Duplicate group request IDs.");
  const pending = requests.filter((r) => r.status === "pending").map((r) => r.groupId);
  if (new Set(pending).size !== pending.length) throw Error("A group can have one move request waiting.");
  if (!projected)
    for (const j of w.journeys ?? [])
      if (j.groupId && !ids.has(j.groupId)) throw Error("A journey's group is missing.");
}
