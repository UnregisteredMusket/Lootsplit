/**
 * Zones (map tokens PR 7A, plan 6A.2): what a character's crossing does to the party's groups,
 * inside the same command that moves the token, so the token and the group never disagree.
 * - Into the zone of another of the party's groups: the character joins it. A group left empty
 *   merges into it; when the last character of the main group leaves, the party regroups there.
 * - Into an adjacent zone with no group: the character splits off into a new group at the map's
 *   location (or on the map), named after them; a group with only that character just moves.
 * The usual split checks apply: at most MAX_PARTY_GROUPS, no pending downtime, no journey or ship.
 */
import type { CloudTable } from "./cloud.ts";
import { characterPosition } from "./character-position.ts";
import { groupJourneyUnderWay, moveGroup, setGroup, assertColours } from "./party-groups-command.ts";
import { activeGroups, groupInfo, groupMembers, groupPlace, groupShip, MAIN_GROUP, nextGroupLetter, purseGroup, resolveGroup } from "./party-groups.ts";
import { groupColours, MAX_PARTY_GROUPS, type CampaignMap, type PartyMapPosition } from "./world-schema.ts";
import type { Crossing } from "./zones.ts";
import { zoneName } from "./zones.ts";

type Person = { id: string; name: string };
const pendingDowntime = (t: CloudTable) => t.journal?.finance?.downtime.some((d) => d.status === "pending");

/** Why this crossing can't change the groups now (null when it can). */
export function zoneChangeRefusal(t: CloudTable, person: Person, move: Extract<Crossing, { kind: "join" | "split" }>): string | null {
  const from = resolveGroup(t, purseGroup(t, person.id) ?? MAIN_GROUP);
  const p = t.purses.find((x) => x.id === person.id);
  if (!p) return "This character is unavailable.";
  const s = characterPosition(t, p);
  if (!s.inParty) return `${person.name} isn't with the party. Ask your DM.`;
  if (s.downtime) return `${person.name} is on downtime.`;
  if (s.shipId || groupShip(t, from)) return `${person.name} is aboard a ship. Land first.`;
  if (pendingDowntime(t)) return "The DM has downtime waiting for approval. Try again after it's decided.";
  if (groupJourneyUnderWay(t, from)) return `${groupInfo(t, from).name} is on a journey.`;
  if (move.kind === "join" && groupJourneyUnderWay(t, move.group)) return `${groupInfo(t, move.group).name} is on a journey.`;
  if (move.kind === "split") {
    const alone = groupMembers(t, from).every((m) => m.id === person.id);
    if (from === MAIN_GROUP && alone) return "Ask your DM to move the party.";
    if (!alone && activeGroups(t).length >= MAX_PARTY_GROUPS - 1) return "The party can't split further — ask the DM.";
  }
  return null;
}

/** The free position for a group on a map with no location: the token's square on that map. */
function mapPosition(map: CampaignMap, at: { column: number; row: number }): PartyMapPosition {
  const g = map.grid!;
  return {
    mapId: map.id,
    x: Math.max(0, Math.min(1, g.x + ((at.column + 0.5) / g.columns) * g.width)),
    y: Math.max(0, Math.min(1, g.y + ((at.row + 0.5) / g.rows) * g.height)),
    environment: "Other",
    description: map.name.slice(0, 200),
  };
}

export function applyZoneChange(
  t: CloudTable,
  person: Person,
  move: Extract<Crossing, { kind: "join" | "split" }>,
  map: CampaignMap,
  at: { column: number; row: number },
  commandId: string,
  now: number,
) {
  const refusal = zoneChangeRefusal(t, person, move);
  if (refusal) throw Error(refusal);
  const w = t.journal!.world!;
  const from = resolveGroup(t, purseGroup(t, person.id) ?? MAIN_GROUP);
  const event = (summary: string) => t.journal!.events.push({ id: `${commandId}-zone`, at: now, kind: "management", summary: summary.slice(0, 500), purseId: person.id });
  const mergeInto = (ref: string, target: string) => {
    const g = activeGroups(t).find((x) => x.id === ref);
    if (!g) return;
    g.status = "merged";
    g.mergedAt = now;
    g.mergedInto = target;
  };
  if (move.kind === "join") {
    const alone = groupMembers(t, from).every((m) => m.id === person.id);
    if (from === MAIN_GROUP && alone) {
      // The main group's last character joins another group: the party regroups there.
      const target = move.group;
      const place = groupPlace(t, target);
      for (const m of groupMembers(t, target)) setGroup(t, m.id, MAIN_GROUP);
      setGroup(t, person.id, MAIN_GROUP);
      mergeInto(target, MAIN_GROUP);
      if (place.position) {
        moveGroup(t, MAIN_GROUP, null);
        w.partyPosition = place.position;
      } else moveGroup(t, MAIN_GROUP, place.locationId);
    } else {
      setGroup(t, person.id, move.group);
      if (from !== MAIN_GROUP && alone) mergeInto(from, move.group);
    }
    if (!activeGroups(t).length) delete w.mainGroup;
    event(`${person.name} rejoined ${groupInfo(t, resolveGroup(t, purseGroup(t, person.id) ?? MAIN_GROUP)).name} in ${zoneName(t, move.to)}.`);
    return;
  }
  // A split: a group with only this character moves; otherwise a new group is made.
  const alone = groupMembers(t, from).every((m) => m.id === person.id);
  if (alone && from !== MAIN_GROUP) {
    if (map.locationId) moveGroup(t, from, map.locationId);
    else {
      const g = activeGroups(t).find((x) => x.id === from)!;
      g.locationId = null;
      g.position = mapPosition(map, at);
    }
    event(`${groupInfo(t, from).name} went to ${map.name}.`);
    return;
  }
  const letter = nextGroupLetter(t);
  if (!letter) throw Error("The party can't split further — ask the DM.");
  const used = new Set([w.mainGroup?.colour ?? "green", ...activeGroups(t).map((g) => g.colour)]);
  const colour = groupColours.find((c) => !used.has(c)) ?? "blue";
  if (!w.mainGroup) w.mainGroup = { name: "Main group", colour: "green" };
  const id = `split-${commandId}`.slice(0, 150);
  (w.groups ??= []).push({
    id,
    name: `${person.name} — ${map.name}`.slice(0, 60),
    colour,
    letter,
    status: "active",
    locationId: map.locationId ?? null,
    ...(map.locationId ? {} : { position: mapPosition(map, at) }),
    createdAt: now,
  });
  setGroup(t, person.id, id);
  assertColours(t);
  event(`${person.name} split off: ${map.name}.`);
}
