/**
 * Split the party (docs/WORLD-FEATURES.md "Split the party", tabletop protocol 10). Party
 * members stay in the party but travel in groups at different places. The main group keeps
 * today's fields (`market.currentLocationId`, `world.partyPosition`); a character in the party
 * without a `groupId` is in the main group, so a campaign that was never split reads exactly as
 * before. Other groups live in `world.groups` (history kept, never deleted).
 *
 * This module only reads: it has no command logic, so the presence helpers (character
 * locations, shops, NPCs) can import it without cycles.
 */
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { CharacterPosition, PartyGroup, PartyMapPosition } from "./world-schema.ts";
import { groupLetters } from "./world-schema.ts";
import { locationPath, readMarketLocations, type MarketLocations } from "./shop-locations.ts";
import { canonicalJson } from "./canonical-json.ts";

/** The implicit main group's reference. Stored group IDs are never "main". */
export const MAIN_GROUP = "main";
type J = Pick<CloudTable, "journal">;
type PJ = Pick<CloudTable, "journal" | "purses">;

export const allGroups = (t: J): PartyGroup[] => t.journal?.world?.groups ?? [];
/** Groups other than the main group that are not merged. */
export const activeGroups = (t: J): PartyGroup[] => allGroups(t).filter((g) => g.status === "active");
/** True while the party is split into groups. */
export const partySplit = (t: J) => activeGroups(t).length > 0;
/** Every group's reference, main first. Just `["main"]` when the party is whole. */
export const groupRefs = (t: J): string[] => [MAIN_GROUP, ...activeGroups(t).map((g) => g.id)];

/** Follow merges from a stored group reference to the group that is active now (or main). */
export function resolveGroup(t: J, ref: string | undefined): string {
  const seen = new Set<string>();
  let current = ref ?? MAIN_GROUP;
  while (current !== MAIN_GROUP && !seen.has(current)) {
    seen.add(current);
    const g = allGroups(t).find((x) => x.id === current);
    if (!g) return MAIN_GROUP;
    if (g.status === "active") return g.id;
    current = g.mergedInto ?? MAIN_GROUP;
  }
  return MAIN_GROUP;
}

/** The group of a stored or default character position; undefined when not in the party. */
export const positionGroup = (s: Pick<CharacterPosition, "inParty" | "groupId"> | undefined) =>
  s?.inParty ? (s.groupId ?? MAIN_GROUP) : undefined;

/**
 * The group a purse travels with: a character in the party → its group; anything else
 * (party funds, characters away from the party, NPCs elsewhere) → undefined.
 * Reads stored positions only, so it works on the device's journal alone.
 */
export function purseGroup(t: J & Partial<Pick<CloudTable, "purses">>, purseId: string): string | undefined {
  const s = t.journal?.world?.characterPositions?.find((x) => x.purseId === purseId);
  if (s) return positionGroup(s);
  const p = t.purses?.find((x) => x.id === purseId);
  if (!p || p.kind !== "character" || p.nonParty) return undefined;
  return MAIN_GROUP;
}

/** Where a group is: a location, or a free position on the road (like the party today). */
export function groupPlace(t: J, ref: string | undefined): { locationId: string | null; position?: PartyMapPosition } {
  const g = ref && ref !== MAIN_GROUP ? allGroups(t).find((x) => x.id === ref) : undefined;
  if (!g || g.status !== "active") {
    const position = t.journal?.world?.partyPosition;
    return {
      locationId: readMarketLocations(t.journal?.market).currentLocationId,
      ...(position ? { position } : {}),
    };
  }
  return { locationId: g.locationId, ...(g.position ? { position: g.position } : {}) };
}
/** The market as one group sees it: its location is the "current location". */
export function groupMarket(t: J, ref: string | undefined): MarketLocations {
  const market = readMarketLocations(t.journal?.market);
  const place = groupPlace(t, ref);
  return place.locationId === market.currentLocationId ? market : { ...market, currentLocationId: place.locationId };
}
/** The group is on the road (or, in a player's projection of a hidden group, elsewhere). */
export const groupTravelling = (t: J, ref: string | undefined) => !!groupPlace(t, ref).position;

/** Display facts for a group reference: name, colour, letter. */
export function groupInfo(t: J, ref: string | undefined) {
  const w = t.journal?.world;
  const g = ref && ref !== MAIN_GROUP ? allGroups(t).find((x) => x.id === ref) : undefined;
  if (!g)
    return {
      id: MAIN_GROUP,
      name: w?.mainGroup?.name ?? "The party",
      colour: w?.mainGroup?.colour ?? ("green" as const),
      letter: "A" as const,
      hidden: false,
    };
  return { id: g.id, name: g.name, colour: g.colour, letter: g.letter ?? groupLetter(t, g.id), hidden: !!g.hidden };
}
/** A stored letter, or the next free one (display only). */
function groupLetter(t: J, id: string) {
  const used = new Set<string>(["A", ...activeGroups(t).flatMap((g) => (g.letter ? [g.letter] : []))]);
  const unlettered = activeGroups(t).filter((g) => !g.letter);
  const free = groupLetters.filter((l) => !used.has(l));
  return free[unlettered.findIndex((g) => g.id === id)] ?? "?";
}
/** The first letter not used by the main group (A) or an active group. */
export function nextGroupLetter(t: J, taken: string[] = []) {
  const used = new Set<string>(["A", ...taken, ...activeGroups(t).map((g) => groupInfo(t, g.id).letter)]);
  return groupLetters.find((l) => !used.has(l));
}

/**
 * The groups whose place counts for a purse's action. A character in the party acts from its
 * own group. Shared party funds belong to every group (owner decision 2026-10-25), so they act
 * from the seat's groups when a seat is given, otherwise from any group. Anything else (a
 * character away from the party) keeps today's rule: the main group's place.
 */
export function actingGroups(t: PJ | J, purseId: string | undefined, seatPurseIds?: string[]): string[] {
  if (!purseId) return seatPurseIds ? seatGroupsFor(t, seatPurseIds) : groupRefs(t);
  const own = purseGroup(t, purseId);
  if (own) return [resolveGroup(t, own)];
  const p = "purses" in t ? t.purses.find((x) => x.id === purseId) : undefined;
  if (p?.kind === "party") return seatPurseIds ? seatGroupsFor(t, seatPurseIds) : groupRefs(t);
  return [MAIN_GROUP];
}
function seatGroupsFor(t: J & Partial<Pick<CloudTable, "purses">>, purseIds: string[]) {
  const found = new Set<string>();
  for (const id of purseIds) {
    const g = purseGroup(t, id);
    if (g) found.add(resolveGroup(t, g));
  }
  return found.size ? groupRefs(t).filter((g) => found.has(g)) : [MAIN_GROUP];
}
/**
 * The groups a seat can see "here": the DM sees every group; a player sees the groups their
 * visible party characters are in (the main group when none, which is today's rule).
 */
export function seatGroups(t: PJ, seat: Pick<CloudSeat, "role" | "purseIds">): string[] {
  if (seat.role === "dm") return groupRefs(t);
  const visible = seat.purseIds.filter((id) => {
    const s = t.journal?.world?.characterPositions?.find((x) => x.purseId === id);
    return s ? s.visible : t.purses.some((p) => p.id === id);
  });
  return seatGroupsFor(t, visible);
}

/** The characters in a group (in the party, any visibility). */
export function groupMembers(t: PJ, ref: string) {
  return t.purses.filter((p) => {
    if (p.kind !== "character") return false;
    const g = purseGroup(t, p.id);
    return !!g && resolveGroup(t, g) === ref;
  });
}

/** Two places count as the same place when one is the other or inside it. */
export function samePlace(market: MarketLocations, a: string | null, b: string | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return locationPath(market, a).some((l) => l.id === b) || locationPath(market, b).some((l) => l.id === a);
}

/**
 * Compare-and-swap value for the DM's group commands: the groups, the main group's label and
 * place, and who is in which group. Any change elsewhere makes a stale screen refresh first.
 */
export function partyGroupsFingerprint(t: J) {
  const w = t.journal?.world;
  return canonicalJson({
    groups: w?.groups ?? [],
    main: w?.mainGroup ?? null,
    members: (w?.characterPositions ?? [])
      .filter((s) => s.inParty && s.groupId)
      .map((s) => [s.purseId, s.groupId])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    location: readMarketLocations(t.journal?.market).currentLocationId,
    position: w?.partyPosition ?? null,
  });
}

/** A position without the split-the-party fields (what protocol 9 apps send back). */
export function withoutGroupFields<T extends Partial<CharacterPosition>>(s: T): T {
  const plain = { ...s };
  delete plain.groupId;
  if (plain.downtime) {
    const downtime = { ...plain.downtime };
    delete downtime.returnGroupId;
    plain.downtime = downtime;
  }
  return plain;
}

/** Every group's location (main first); null for a group on the road. */
export const partyPlaces = (t: J): (string | null)[] => groupRefs(t).map((g) => groupPlace(t, g).locationId);
