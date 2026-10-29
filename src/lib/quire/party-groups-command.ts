/**
 * Split the party: the shared commands (room and device run the same code through commands.ts).
 * Nothing here moves money or items. Every DM command compares `partyGroupsFingerprint` first and
 * is refused while campaign downtime is pending, the same rule as moving the party.
 */
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { PartyGroup, PartyMapPosition } from "./world-schema.ts";
import { readWorld, MAX_PARTY_GROUPS } from "./world-schema.ts";
import type { PartyGroupCommand } from "./party-groups-schema.ts";
import { characterPosition, characterVisible } from "./character-position.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { canonicalJson } from "./canonical-json.ts";
import {
  groupShip,
  activeGroups,
  allGroups,
  groupInfo,
  groupMembers,
  groupPlace,
  MAIN_GROUP,
  nextGroupLetter,
  partyGroupsFingerprint,
  partySplit,
  purseGroup,
  resolveGroup,
  samePlace,
} from "./party-groups.ts";

type Event = (summary: string, purseId?: string, dmOnly?: boolean) => void;
const pendingDowntime = (t: CloudTable) => t.journal?.finance?.downtime.some((d) => d.status === "pending");
/** The journey under way for a group (journeys without a group belong to the main group). */
export const groupJourneyUnderWay = (t: CloudTable, ref: string) =>
  (t.journal?.world?.journeys ?? []).find(
    (j) => (j.status === "active" || j.status === "arrived") && (j.groupId ?? MAIN_GROUP) === ref,
  );

function group(t: CloudTable, ref: string): PartyGroup | undefined {
  return ref === MAIN_GROUP ? undefined : activeGroups(t).find((g) => g.id === ref);
}
function assertGroup(t: CloudTable, ref: string) {
  if (ref === MAIN_GROUP) return;
  if (!group(t, ref)) throw Error("This group no longer exists. Refresh before saving.");
}
const placeName = (t: CloudTable, locationId: string | null) =>
  locationId
    ? (readMarketLocations(t.journal?.market).locations.find((l) => l.id === locationId)?.name ?? "an unknown place")
    : "no particular place";
/** Store one character's group (main = no groupId). */
export function setGroup(t: CloudTable, purseId: string, ref: string) {
  const w = t.journal!.world!;
  const p = t.purses.find((p) => p.id === purseId)!;
  const { shipId, shipReturnInParty, ...stored } = characterPosition(t, p);
  void shipId;
  void shipReturnInParty;
  if (ref === MAIN_GROUP) delete stored.groupId;
  else stored.groupId = ref;
  w.characterPositions = [...w.characterPositions.filter((s) => s.purseId !== purseId), stored];
}
export function assertColours(t: CloudTable) {
  const w = t.journal!.world!;
  const colours = [w.mainGroup?.colour ?? "green", ...activeGroups(t).map((g) => g.colour)];
  if (new Set(colours).size !== colours.length) throw Error("Give each group its own colour.");
}

/**
 * Move a group at once (no time passes, nothing is charged), like Move party here. The main
 * group uses the party's own fields, so moving it is exactly today's party-location.
 */
export function moveGroup(t: CloudTable, ref: string, locationId: string | null) {
  const journal = t.journal!;
  if (groupShip(t, ref)) throw Error(`${groupInfo(t, ref).name} is aboard a ship: it moves with the ship's voyage. Land the group first.`);
  if (locationId && !readMarketLocations(journal.market).locations.some((l) => l.id === locationId))
    throw Error("Choose an existing location.");
  if (ref === MAIN_GROUP) {
    if (journal.world) delete journal.world.partyPosition;
    journal.market = readMarketLocations({ ...readMarketLocations(journal.market), currentLocationId: locationId });
    return;
  }
  const g = group(t, ref)!;
  g.locationId = locationId;
  delete g.position;
}

/** party-location with a `groupId` (not the main group): move that group. */
export function applyGroupLocation(
  t: CloudTable,
  cmd: { groupId: string; before: string | null; beforePosition?: string; locationId: string | null; journeyId?: string },
  event: Event,
  at = Date.now(),
) {
  const g = group(t, cmd.groupId);
  if (!g) throw Error("This group no longer exists. Refresh before moving it.");
  if (g.locationId !== cmd.before) throw Error(`${g.name} moved elsewhere. Refresh before changing location.`);
  if (g.position && canonicalJson(g.position) !== cmd.beforePosition)
    throw Error(`${g.name}'s travel position changed. Refresh before choosing a location.`);
  if (pendingDowntime(t)) throw Error("Approve or cancel pending downtime before moving a group.");
  const travelling = groupJourneyUnderWay(t, g.id);
  if (cmd.journeyId) {
    // "Move group here" on arrival: no time passes and nothing is charged.
    if (!travelling || travelling.id !== cmd.journeyId || travelling.status !== "arrived")
      throw Error("This journey hasn't arrived. Refresh before moving the group.");
    if (!cmd.locationId || (travelling.destinationLocationId && travelling.destinationLocationId !== cmd.locationId))
      throw Error("Move the group to the journey's destination, or stop the journey first.");
    travelling.status = "completed";
    travelling.decidedAt = at;
  } else if (travelling)
    throw Error(
      travelling.status === "arrived"
        ? `${g.name} has arrived on a journey. Confirm Move group here, or stop the journey first.`
        : `${g.name} is on a journey. Stop it on the road before moving the group.`,
    );
  moveGroup(t, g.id, cmd.locationId);
  // A hidden group's place stays in the DM's record.
  event(`${g.name}: ${cmd.locationId ? `moved to ${placeName(t, cmd.locationId)}` : "location cleared"}`, undefined, !!g.hidden);
}

/** party-map-position with a `groupId` (not the main group): place that group on the road. */
export function applyGroupMapPosition(
  t: CloudTable,
  cmd: { groupId: string; before: PartyMapPosition | null; beforeLocationId: string | null; position: PartyMapPosition | null },
  event: Event,
) {
  const g = group(t, cmd.groupId);
  if (!g) throw Error("This group no longer exists. Refresh before placing it.");
  if (canonicalJson(g.position ?? null) !== canonicalJson(cmd.before) || g.locationId !== cmd.beforeLocationId)
    throw Error(`${g.name} moved. Refresh before placing it.`);
  if (pendingDowntime(t)) throw Error("Approve or cancel pending downtime before moving a group.");
  if (groupShip(t, g.id)) throw Error(`${g.name} is aboard a ship. Land the group first.`);
  if (groupJourneyUnderWay(t, g.id)) throw Error(`${g.name} is on a journey. Stop it on the road before moving it freely.`);
  if (cmd.position) {
    g.position = cmd.position;
    g.locationId = null;
  } else delete g.position;
  event(cmd.position ? `${g.name}: travel position updated` : `${g.name}: free position cleared`, undefined, !!g.hidden);
}

export function applyPartyGroupCommand(
  t: CloudTable,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  cmd: PartyGroupCommand,
  at: number,
  event: Event,
) {
  const journal = t.journal!;
  const w = (journal.world = readWorld(journal.world));
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can split, merge or edit the party's groups.");
  };
  const fresh = (before: string) => {
    if (partyGroupsFingerprint(t) !== before)
      throw Error("The party's groups changed. Refresh before saving; your draft is retained.");
  };
  const noDowntime = () => {
    if (pendingDowntime(t)) throw Error("Approve or cancel pending downtime before splitting, moving or merging groups.");
  };
  const member = (purseId: string) => {
    const p = t.purses.find((p) => p.id === purseId && p.kind === "character");
    if (!p) throw Error("Choose an existing character.");
    const s = characterPosition(t, p);
    if (!s.inParty)
      throw Error(`${p.name} isn't in the party. Bring them back from their placement first.`);
    if (s.downtime) throw Error(`${p.name} is on downtime and can't join a group until it ends.`);
    if (s.shipId) throw Error(`${p.name} is aboard a ship. Disembark first.`);
    return p;
  };
  const leavesEmpty = (moved: Set<string>) => {
    for (const ref of [MAIN_GROUP, ...activeGroups(t).map((g) => g.id)])
      if (groupMembers(t, ref).length && groupMembers(t, ref).every((p) => moved.has(p.id)))
        throw Error(
          ref === MAIN_GROUP
            ? `Keep at least one character in ${groupInfo(t, MAIN_GROUP).name}.`
            : `${groupInfo(t, ref).name} would be empty. Merge it instead.`,
        );
  };

  if (cmd.kind === "party-split") {
    dm();
    fresh(cmd.before);
    noDowntime();
    if (activeGroups(t).length + cmd.groups.length > MAX_PARTY_GROUPS - 1)
      throw Error(`The party can be split into at most ${MAX_PARTY_GROUPS} groups.`);
    const ids = new Set<string>();
    const moved = new Set<string>();
    const locations = readMarketLocations(journal.market).locations;
    for (const g of cmd.groups) {
      if (g.id === MAIN_GROUP || ids.has(g.id) || allGroups(t).some((x) => x.id === g.id))
        throw Error("Each group needs a new, unique ID.");
      ids.add(g.id);
      if (g.locationId && !locations.some((l) => l.id === g.locationId)) throw Error("Choose an existing location.");
      for (const id of g.memberIds) {
        if (moved.has(id)) throw Error("A character can be in only one group.");
        moved.add(id);
        member(id);
        // A group on a journey keeps its travellers until it stops or arrives.
        if (groupJourneyUnderWay(t, resolveGroup(t, purseGroup(t, id))))
          throw Error("Stop or finish the journey under way before splitting off its travellers.");
      }
    }
    leavesEmpty(moved);
    if (cmd.main || !w.mainGroup) w.mainGroup = cmd.main ?? { name: "Main group", colour: "green" };
    const groups = (w.groups ??= []);
    const taken: string[] = [];
    for (const g of cmd.groups) {
      const letter = nextGroupLetter(t, taken);
      if (!letter) throw Error(`The party can be split into at most ${MAX_PARTY_GROUPS} groups.`);
      taken.push(letter);
      groups.push({ id: g.id, name: g.name, colour: g.colour, letter, status: "active", locationId: g.locationId, ...(g.hidden ? { hidden: true } : {}), createdAt: at });
      for (const id of g.memberIds) setGroup(t, id, g.id);
    }
    assertColours(t);
    // The public event names the groups only; places and members stay in the DM's record.
    event(`The party split into ${activeGroups(t).length + 1} groups: ${[MAIN_GROUP, ...activeGroups(t).map((g) => g.id)].map((r) => groupInfo(t, r).name).join(", ")}.`.slice(0, 500));
    event(
      cmd.groups
        .map((g) => `${g.name} at ${placeName(t, g.locationId)} (${g.memberIds.map((id) => t.purses.find((p) => p.id === id)!.name).join(", ")})`)
        .join("; ")
        .slice(0, 500),
      undefined,
      true,
    );
    return;
  }
  if (cmd.kind === "party-group-edit") {
    dm();
    fresh(cmd.before);
    if (!partySplit(t)) throw Error("The party isn't split.");
    assertGroup(t, cmd.groupId);
    if (cmd.groupId === MAIN_GROUP) {
      if (cmd.hidden) throw Error("The main group's place can't be hidden.");
      w.mainGroup = { name: cmd.name, colour: cmd.colour };
    } else {
      const g = group(t, cmd.groupId)!;
      g.name = cmd.name;
      g.colour = cmd.colour;
      if (cmd.hidden) g.hidden = true;
      else delete g.hidden;
    }
    assertColours(t);
    event(`Group updated: ${cmd.name}`, undefined, true);
    return;
  }
  if (cmd.kind === "party-group-assign") {
    dm();
    fresh(cmd.before);
    noDowntime();
    if (!partySplit(t)) throw Error("The party isn't split.");
    assertGroup(t, cmd.groupId);
    const p = member(cmd.purseId);
    const from = resolveGroup(t, purseGroup(t, p.id));
    if (from === cmd.groupId) throw Error(`${p.name} is already in ${groupInfo(t, from).name}.`);
    if (groupJourneyUnderWay(t, from) || groupJourneyUnderWay(t, cmd.groupId))
      throw Error("A group on a journey keeps its travellers. Stop or finish the journey first.");
    if (groupShip(t, from) || groupShip(t, cmd.groupId))
      throw Error("A group aboard a ship keeps its passengers. Land the group first.");
    leavesEmpty(new Set([p.id]));
    setGroup(t, p.id, cmd.groupId);
    event(`${p.name} joined ${groupInfo(t, cmd.groupId).name}.`, characterVisible(t, p) ? p.id : undefined, !characterVisible(t, p));
    return;
  }
  if (cmd.kind === "party-merge") {
    dm();
    fresh(cmd.before);
    noDowntime();
    const refs = [...new Set(cmd.groupIds)];
    if (refs.length < 2) throw Error("Choose at least two groups to merge.");
    for (const ref of refs) assertGroup(t, ref);
    const market = readMarketLocations(journal.market);
    for (const ref of refs) {
      const name = groupInfo(t, ref).name;
      if (groupJourneyUnderWay(t, ref)) throw Error(`Merge waits: ${name} is on a journey.`);
      if (groupShip(t, ref)) throw Error(`Merge waits: ${name} is aboard a ship. Land the group where the others are, then merge.`);
      if (groupPlace(t, ref).position) throw Error(`Merge waits: ${name} is on the road. Move the group to a place first.`);
    }
    const places = refs.map((r) => groupPlace(t, r).locationId);
    if (places.some((a) => places.some((b) => !samePlace(market, a, b))))
      throw Error("Merge needs every group at the same place. Move a group or plan a journey for it first.");
    if (!places.includes(cmd.intoLocationId)) throw Error("Choose one of the groups' places for the merged group.");
    const target = refs.includes(MAIN_GROUP) ? MAIN_GROUP : refs[0]!;
    for (const ref of refs.filter((r) => r !== target)) {
      if ((w.journeys ?? []).some((j) => (j.groupId ?? MAIN_GROUP) === ref && ["proposed", "planned"].includes(j.status)))
        throw Error(`${groupInfo(t, ref).name} has a journey planned. Withdraw or deny it before merging.`);
      for (const p of groupMembers(t, ref)) setGroup(t, p.id, target);
      const g = group(t, ref)!;
      g.status = "merged";
      g.mergedAt = at;
      g.mergedInto = target;
      for (const r of w.groupRequests ?? [])
        if (r.groupId === ref && r.status === "pending") {
          r.status = "withdrawn";
          r.decidedAt = at;
          r.reason = { text: "The group merged.", showToPlayer: true };
        }
    }
    moveGroup(t, target, cmd.intoLocationId);
    const names = refs.map((r) => groupInfo(t, r).name);
    if (!partySplit(t)) {
      delete w.mainGroup;
      event(`The party regrouped at ${placeName(t, cmd.intoLocationId)}.`);
    } else event(`Groups merged: ${names.join(" + ")}.`.slice(0, 500));
    return;
  }
  if (cmd.kind === "party-group-request") {
    if (seat.role !== "player") throw Error("Players ask to move their group; the DM moves it directly.");
    if (!seat.purseIds.includes(cmd.purseId)) throw Error("Ask for your own character's group.");
    if (!partySplit(t)) throw Error("The party isn't split.");
    const p = t.purses.find((p) => p.id === cmd.purseId && p.kind === "character");
    const own = p && purseGroup(t, p.id);
    if (!p || !characterVisible(t, p) || !own || resolveGroup(t, own) !== cmd.groupId)
      throw Error("You can ask to move only a group your character is in.");
    assertGroup(t, cmd.groupId);
    if (!readMarketLocations(journal.market).locations.some((l) => l.id === cmd.locationId))
      throw Error("Choose an existing location.");
    if (groupPlace(t, cmd.groupId).locationId === cmd.locationId) throw Error("Your group is already there.");
    const requests = (w.groupRequests ??= []);
    if (requests.some((r) => r.id === cmd.requestId)) throw Error("This request was already sent.");
    if (requests.some((r) => r.groupId === cmd.groupId && r.status === "pending"))
      throw Error("Your group already has a move waiting for the DM. Withdraw it first to ask again.");
    requests.push({
      id: cmd.requestId,
      groupId: cmd.groupId,
      purseId: p.id,
      locationId: cmd.locationId,
      ...(cmd.message ? { message: cmd.message } : {}),
      status: "pending",
      createdAt: at,
    });
    event(`${p.name} asked to move ${groupInfo(t, cmd.groupId).name} to ${placeName(t, cmd.locationId)}.`.slice(0, 500), p.id);
    return;
  }
  const request = (w.groupRequests ?? []).find((r) => r.id === cmd.requestId);
  if (!request) throw Error("This request no longer exists.");
  if (request.status !== "pending") throw Error("This request is already decided.");
  if (cmd.kind === "party-group-request-withdraw") {
    if (seat.role !== "dm" && !seat.purseIds.includes(request.purseId))
      throw Error("Only the player who asked (or the DM) can withdraw this request.");
    request.status = "withdrawn";
    request.decidedAt = at;
    event(`Move request for ${groupInfo(t, request.groupId).name} withdrawn.`, request.purseId);
    return;
  }
  // party-group-request-review
  dm();
  const ref = resolveGroup(t, request.groupId);
  if (ref !== request.groupId) throw Error("This group merged. Deny the request instead.");
  if (cmd.approve) {
    noDowntime();
    if (groupJourneyUnderWay(t, ref)) throw Error(`${groupInfo(t, ref).name} is on a journey. Stop it before moving the group.`);
    moveGroup(t, ref, request.locationId);
    request.status = "approved";
  } else {
    request.status = "denied";
    request.reason = cmd.reason ?? { text: "", showToPlayer: false };
  }
  request.decidedAt = at;
  event(
    `${groupInfo(t, ref).name}: move to ${placeName(t, request.locationId)} ${cmd.approve ? "approved" : "denied"}.`.slice(0, 500),
    request.purseId,
  );
}
