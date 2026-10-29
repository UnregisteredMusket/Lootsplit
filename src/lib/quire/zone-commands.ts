/**
 * Zones and the DM's split rule (map tokens PR 7A; owner 2026-10-29; plan 6A.9): `zone-save`,
 * `zone-request`, `zone-request-withdraw`, `zone-vote` and `zone-request-resolve`. They run in the
 * shared engine (room and device). Votes settle lazily with server time: a vote, the mover's
 * client at the deadline, or anyone's `settle` after it; the DM may approve or reject at any time.
 */
import { canonicalJson } from "./canonical-json.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { characterVisible } from "./character-position.ts";
import { groupMembers, MAIN_GROUP, purseGroup, resolveGroup } from "./party-groups.ts";
import { applyTokenFollow, mapAccessible, readTabletopSession, type TabletopExecution } from "./tabletop.ts";
import { DEFAULT_SPLIT_RULE, type SplitRuleSettings, type Zone, type ZoneRequest } from "./world-schema.ts";
import { crossing, splitRuleFor, zoneName, zoneOf } from "./zones.ts";

type Seat = Pick<CloudSeat, "id" | "role" | "purseIds">;
export type ZoneCommand =
  | { id: string; kind: "zone-save"; before: string; zones: Zone[]; splitRule: SplitRuleSettings | null }
  | { id: string; kind: "zone-request"; requestId: string; purseId: string; fromMapId: string | null; toMapId: string; grid: string; at: { column: number; row: number } }
  | { id: string; kind: "zone-request-withdraw"; requestId: string }
  | { id: string; kind: "zone-vote"; requestId: string; vote: "yes" | "no" }
  | { id: string; kind: "zone-request-resolve"; requestId: string; action: "approve" | "reject" | "decline" | "settle" };
export const ZONE_COMMAND_KINDS = new Set(["zone-save", "zone-request", "zone-request-withdraw", "zone-vote", "zone-request-resolve"]);

/** What the DM saw before saving zones (zones and the campaign split rule). */
export const zonesFingerprint = (t: Pick<CloudTable, "journal">) =>
  canonicalJson({ zones: t.journal?.world?.zones ?? [], splitRule: t.journal?.world?.splitRule ?? null });

/**
 * The vote's state: decided (pass or fail) or still open. Only the other players' ballots count
 * (privacy review 2026-10-29; owner rule: a tie or no votes keeps the party together), so a vote
 * nobody else answered fails when it closes. When the mover is the only eligible voter (nobody
 * else in their group has a seat), nobody is left behind and it passes.
 */
export function voteOutcome(r: Pick<ZoneRequest, "votes" | "majority" | "deadline" | "seatId">, now: number): "pass" | "fail" | "open" {
  const ballots = (r.votes ?? []).filter((v) => v.seatId !== r.seatId);
  if (!ballots.length) return "pass";
  const yes = ballots.filter((v) => v.vote === "yes").length,
    no = ballots.filter((v) => v.vote === "no").length,
    waiting = ballots.length - yes - no;
  const closed = r.deadline !== undefined && now >= r.deadline;
  if (r.majority === "unanimous") {
    if (no > 0) return "fail";
    if (waiting === 0) return "pass";
    return closed ? "fail" : "open";
  }
  // Majority of the ballots cast: more yes than no. A tie, or no ballots cast, fails.
  if (yes > no + waiting) return "pass";
  if (yes + waiting <= no) return "fail";
  if (waiting === 0 || closed) return yes > no ? "pass" : "fail";
  return "open";
}
export function voteTally(r: Pick<ZoneRequest, "votes">) {
  const votes = r.votes ?? [];
  const yes = votes.filter((v) => v.vote === "yes").length,
    no = votes.filter((v) => v.vote === "no").length;
  return { yes, no, waiting: votes.length - yes - no };
}

export function applyZoneCommand(t: CloudTable, seat: Seat, cmd: ZoneCommand, at: number, execution: TabletopExecution = {}) {
  const w = t.journal!.world!;
  const event = (summary: string, purseId?: string) =>
    t.journal!.events.push({ id: `${cmd.id}-event`, at, kind: "management", summary: summary.slice(0, 500), ...(purseId ? { purseId } : {}) });
  if (cmd.kind === "zone-save") {
    if (seat.role !== "dm") throw Error("Only the DM can edit zones.");
    if (zonesFingerprint(t) !== cmd.before) throw Error("Zones changed. Refresh before saving; your draft is retained.");
    const ids = new Set<string>(),
      maps = new Set<string>(),
      locations = new Set<string>();
    for (const z of cmd.zones) {
      if (ids.has(z.id)) throw Error("Each zone needs its own ID.");
      ids.add(z.id);
      for (const m of z.mapIds) {
        if (maps.has(m)) throw Error("A map can be in only one zone.");
        if (!w.maps.some((x) => x.id === m)) throw Error("Choose existing maps for zones.");
        maps.add(m);
      }
      for (const l of z.locationIds) {
        if (locations.has(l)) throw Error("A location can be in only one zone.");
        locations.add(l);
      }
      if (z.parentZoneId === `zone:${z.id}`) throw Error("A zone can't be inside itself.");
    }
    if (cmd.zones.length) w.zones = cmd.zones;
    else delete w.zones;
    if (cmd.splitRule) w.splitRule = cmd.splitRule;
    else delete w.splitRule;
    event("Zones updated");
    return;
  }
  if (cmd.kind === "zone-request") {
    if (seat.role === "dm") throw Error("The DM moves characters directly; requests are for players.");
    if (!seat.purseIds.includes(cmd.purseId)) throw Error("You can only move your own character's token.");
    const person = t.purses.find((p) => p.id === cmd.purseId && p.kind === "character");
    if (!person || !characterVisible(t, person)) throw Error("This character is unavailable.");
    // Both maps must be ones the player can open, checked first (privacy review 2026-10-29), and
    // a move that can't be requested gets one generic answer, so zones of hidden maps can't be probed.
    const to = w.maps.find((m) => m.id === cmd.toMapId);
    const from = cmd.fromMapId ? w.maps.find((m) => m.id === cmd.fromMapId) : undefined;
    if (!to || !mapAccessible(t, to, seat) || (cmd.fromMapId && (!from || !mapAccessible(t, from, seat))))
      throw Error("This map is unavailable.");
    if (!readTabletopSession(t).followView) throw Error("The DM hasn't turned on tokens following your map view.");
    const move = crossing(t, person.id, person.name, to.id, cmd.fromMapId ?? undefined);
    if ((move.kind !== "split" && move.kind !== "join") || move.rule.allow || move.rule.rule === "block")
      throw Error("This move can't be requested now. Refresh and try again.");
    const combat = w.combat?.phase === "active" ? w.combat : undefined;
    if (combat && [move.from, move.to].includes(zoneOf(t, combat.mapId))) throw Error("Finish the encounter before leaving.");
    const requests = (w.zoneRequests ??= []);
    if (requests.some((r) => r.id === cmd.requestId)) throw Error("This request was already sent.");
    // One open request per character: a new one replaces the old.
    for (const r of requests)
      if (r.purseId === person.id && r.status === "open") {
        r.status = "withdrawn";
        r.decidedAt = at;
        r.reason = "Replaced by a newer request.";
      }
    const group = resolveGroup(t, purseGroup(t, person.id) ?? MAIN_GROUP);
    const rule = move.rule;
    const request: ZoneRequest = {
      id: cmd.requestId,
      purseId: person.id,
      seatId: seat.id,
      fromMapId: cmd.fromMapId,
      toMapId: to.id,
      at: { column: cmd.at.column, row: cmd.at.row },
      fromZone: move.from,
      toZone: move.to,
      mode: rule.rule === "vote" ? "vote" : "session-end",
      status: "open",
      createdAt: at,
      groupId: group,
      tokenAt: tokenAt(t, person.id, cmd.fromMapId),
      ...(t.journal!.sessions.find((x) => !x.endedAt) ? { sessionId: t.journal!.sessions.find((x) => !x.endedAt)!.id } : {}),
    };
    if (rule.rule === "vote") {
      // One vote per player seat with a character in the mover's group; the mover's counts as yes.
      const members = new Set(groupMembers(t, group).map((p) => p.id));
      const voters = (execution.playerSeats ?? []).filter((s) => s.id !== seat.id && s.purseIds.some((id) => members.has(id)));
      request.majority = rule.majority;
      if (rule.minutes) request.deadline = at + rule.minutes * 60_000;
      request.votes = [{ seatId: seat.id, vote: "yes" }, ...voters.map((s) => ({ seatId: s.id, vote: null }))];
    }
    requests.push(request);
    event(
      request.mode === "vote" ? `${person.name} asked the party to go to ${to.name}.` : `${person.name} will go to ${to.name} when the session ends, if the DM agrees.`,
      person.id,
    );
    if (request.mode === "vote") settle(t, request, at, `${cmd.id}-apply`, event);
    return;
  }
  const request = (w.zoneRequests ?? []).find((r) => r.id === cmd.requestId);
  if (!request) throw Error("This request no longer exists.");
  if (request.status !== "open") throw Error("This request is already decided.");
  if (cmd.kind === "zone-request-withdraw") {
    if (seat.role !== "dm" && !seat.purseIds.includes(request.purseId)) throw Error("Only the player who asked (or the DM) can withdraw this request.");
    request.status = "withdrawn";
    request.decidedAt = at;
    event("A party-split request was withdrawn.", request.purseId);
    return;
  }
  if (cmd.kind === "zone-vote") {
    if (request.mode !== "vote") throw Error("This request isn't a vote.");
    const ballot = request.votes?.find((v) => v.seatId === seat.id);
    // A ballot counts only while the voter still has a character in the mover's group.
    const members = new Set(groupMembers(t, resolveGroup(t, purseGroup(t, request.purseId) ?? MAIN_GROUP)).map((p) => p.id));
    if (!ballot || seat.role === "dm" || ballot.seatId === request.seatId || !seat.purseIds.some((id) => members.has(id)))
      throw Error("You don't have a vote on this request.");
    if (request.deadline !== undefined && at >= request.deadline) {
      settle(t, request, at, `${cmd.id}-apply`, event);
      return;
    }
    ballot.vote = cmd.vote;
    settle(t, request, at, `${cmd.id}-apply`, event);
    return;
  }
  // zone-request-resolve
  if (cmd.action === "settle") {
    if (request.mode !== "vote" || voteOutcome(request, at) === "open") throw Error("The vote is still open.");
    settle(t, request, at, `${cmd.id}-apply`, event);
    return;
  }
  if (seat.role !== "dm") throw Error("Only the DM can approve or reject this request.");
  if (cmd.action === "approve") apply(t, request, at, `${cmd.id}-apply`, event);
  else {
    request.status = cmd.action === "reject" ? "rejected" : "declined";
    request.decidedAt = at;
    event(`The DM kept ${t.purses.find((p) => p.id === request.purseId)?.name ?? "a character"} with the party.`, request.purseId);
  }
}

/** A decided vote: pass applies the move, fail closes it with the reason. */
function settle(t: CloudTable, r: ZoneRequest, at: number, id: string, event: (s: string, purseId?: string) => void) {
  const outcome = voteOutcome(r, at);
  if (outcome === "open") return;
  if (outcome === "pass") return apply(t, r, at, id, event, true);
  const name = t.purses.find((p) => p.id === r.purseId)?.name ?? "The character";
  // The other players' ballots (the mover's own yes isn't counted).
  const ballots = (r.votes ?? []).filter((v) => v.seatId !== r.seatId);
  const yes = ballots.filter((v) => v.vote === "yes").length,
    no = ballots.filter((v) => v.vote === "no").length;
  r.status = "failed";
  r.decidedAt = at;
  r.reason = !yes && !no
    ? `${name} stays with the party: nobody else voted.`
    : yes === no
      ? `${name} stays with the party: the vote tied.`
      : `${name} stays with the party: the vote didn't pass.`;
  event(r.reason, r.purseId);
}

/**
 * Apply a request from the character's current state ("send Mira there", not a replay): checked
 * again now. A request that no longer applies is closed with the reason instead.
 */
function apply(t: CloudTable, r: ZoneRequest, at: number, id: string, event: (s: string, purseId?: string) => void, byVote = false) {
  const w = t.journal!.world!;
  const person = t.purses.find((p) => p.id === r.purseId && p.kind === "character");
  const to = w.maps.find((m) => m.id === r.toMapId);
  const close = (status: ZoneRequest["status"], reason: string) => {
    r.status = status;
    r.decidedAt = at;
    r.reason = reason;
    event(reason, r.purseId);
  };
  if (!person || !to?.visible) return close("cancelled", "Can't apply: the destination is no longer available.");
  const from = w.maps.find((m) => (m.tokens ?? []).some((x) => x.kind === "character" && x.entityId === person.id) && m.id !== to.id);
  const move = crossing(t, person.id, person.name, to.id, from?.id);
  if (move.kind === "same") return close("not-needed", `No longer needed: ${person.name} is already in ${zoneName(t, move.kind === "same" ? r.toZone : r.toZone)}.`);
  if (move.kind !== "split" && move.kind !== "join") return close("cancelled", `Can't apply: ${to.name} is no longer next to ${person.name}'s place.`);
  // A passed vote applies only under the rule as it is now: if the DM switched to Block, it's
  // refused (the DM's own approval always applies).
  if (byVote && !move.rule.allow && splitRuleFor(t, move.from).rule === "block")
    return close("cancelled", "Can't apply: the DM is keeping the party together now.");
  const seat = { role: "player" as const, purseIds: [person.id] };
  const beforeFrom = from?.tokens?.find((x) => x.kind === "character" && x.entityId === person.id) ?? null;
  const beforeTo = to.tokens?.find((x) => x.kind === "character" && x.entityId === person.id) ?? null;
  try {
    applyTokenFollow(
      t,
      seat,
      {
        id,
        kind: "map-token-follow",
        mapId: to.id,
        grid: canonicalJson(to.grid ?? null),
        purseId: person.id,
        fromMapId: from?.id ?? null,
        beforeFrom,
        beforeTo,
        tokenId: beforeTo?.id ?? beforeFrom?.id ?? `${r.id}-token`.slice(0, 150),
        at: r.at,
      },
      at,
      true,
    );
  } catch (e) {
    return close("cancelled", `Can't apply: ${e instanceof Error ? e.message : "the move is no longer allowed."}`);
  }
  r.status = "applied";
  r.decidedAt = at;
}

/** Default split rule shown in Settings. */
export const readSplitRule = (t: Pick<CloudTable, "journal">): SplitRuleSettings => t.journal?.world?.splitRule ?? DEFAULT_SPLIT_RULE;

/** The mover's token on the map being left, as a request saw it (null when there is none). */
function tokenAt(t: CloudTable, purseId: string, fromMapId: string | null) {
  const token = fromMapId
    ? t.journal?.world?.maps.find((m) => m.id === fromMapId)?.tokens?.find((x) => x.kind === "character" && x.entityId === purseId)
    : undefined;
  return canonicalJson(token ? { mapId: fromMapId, column: token.column, row: token.row, offsetX: token.offsetX ?? 0, offsetY: token.offsetY ?? 0 } : null);
}

/**
 * After every command (commands.ts): open split requests that no longer fit are cancelled with the
 * reason (privacy review 2026-10-29): the mover's group changed, their token moved or left the map,
 * or combat started in either zone. Votes keep only ballots from seats with a character still in
 * the mover's group (when the room's seats are known).
 */
export function cancelStaleZoneRequests(t: CloudTable, at: number, commandId: string, playerSeats?: { id: string; purseIds: string[] }[]) {
  const w = t.journal?.world;
  if (!w?.zoneRequests?.some((r) => r.status === "open")) return;
  const combat = w.combat?.phase === "active" ? w.combat : undefined;
  for (const r of w.zoneRequests) {
    if (r.status !== "open") continue;
    const name = t.purses.find((p) => p.id === r.purseId)?.name ?? "The character";
    const group = resolveGroup(t, purseGroup(t, r.purseId) ?? MAIN_GROUP);
    const reason =
      r.groupId !== undefined && r.groupId !== group
        ? `Cancelled: ${name}'s group changed.`
        : r.tokenAt !== undefined && r.tokenAt !== tokenAt(t, r.purseId, r.fromMapId)
          ? `Cancelled: ${name}'s token moved.`
          : combat && [r.fromZone, r.toZone].includes(zoneOf(t, combat.mapId))
            ? "Cancelled: combat started."
            : undefined;
    if (reason) {
      r.status = "cancelled";
      r.decidedAt = at;
      r.reason = reason;
      t.journal!.events.push({ id: `${commandId}-zone-${r.id}`.slice(0, 150), at, kind: "management", summary: reason, purseId: r.purseId });
      continue;
    }
    if (r.votes && playerSeats) {
      const members = new Set(groupMembers(t, group).map((p) => p.id));
      r.votes = r.votes.filter((v) => v.seatId === r.seatId || playerSeats.some((s) => s.id === v.seatId && s.purseIds.some((id) => members.has(id))));
    }
  }
}
