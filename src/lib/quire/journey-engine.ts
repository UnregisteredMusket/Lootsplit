/**
 * Party journey engine (journey planner phase B, docs/MAP-TILES.md "Journey planner"). Shared by
 * the room server and offline play through `commands.ts`: `party-journey` and `travel-settings`
 * move no money; the reviewed downtime quote (`previewDowntime` with a journey) prices the
 * optional ration and mount lines, and `downtime-apply` charges them once and moves the party
 * along the frozen route. Session Time never advances a journey (the voyage rule).
 */
import { z } from "zod";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { canonicalJson } from "./canonical-json.ts";
import {
  OPEN_JOURNEY_STATUSES,
  readTravel,
  type Journey,
  type JourneyCommand,
} from "./journey-schema.ts";
import { partyMapPositionSchema, type CampaignMap, type PartyMapPosition } from "./world-schema.ts";
import {
  downtimeDays,
  frameFingerprint,
  journeyDurationMinutes,
  legDeciMiles,
  legIndexAt,
  routeFrame,
  routePointAt,
} from "./journey.ts";
import { characterPosition, characterVisible } from "./character-position.ts";
import { groupInfo, groupMarket, groupShip, MAIN_GROUP, purseGroup as purseGroupOf, resolveGroup } from "./party-groups.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import { shopScheduleSchema } from "./shop-schedule.ts";
import { formatCopper, toCopper } from "./money.ts";
import { mapAccessible, mapNeedsMask, readMapTabletop, sceneViewers } from "./tabletop.ts";
import { scenePointVisible } from "./tabletop-geometry.ts";
import type { World } from "./world-schema.ts";

const id = z.string().min(1).max(150);
export const journeyQuoteSchema = z.object({
  journeyId: id,
  journeyHash: z.string().max(100),
  fromMinutes: z.number().int().nonnegative(),
  toMinutes: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive(),
  arrived: z.boolean(),
  position: partyMapPositionSchema,
  lines: z.array(
    z.object({
      /** fare: a stable's coach fare (services wave 2), charged once on departure. */
      kind: z.enum(["fare", "rations", "mounts"]),
      purseId: id,
      quantity: z.number().int().min(1).max(100000),
      unitCopper: z.number().int().min(0).max(1e12),
      copper: z.number().int().min(0).max(1e12),
      /** The payer can't cover it: approval is refused until the line is off or coins are added. */
      short: z.boolean(),
    }),
  ),
  notices: z.array(
    z.object({
      kind: z.enum(["left-behind", "schedule", "stays-behind"]),
      shopId: id.optional(),
      purseId: id.optional(),
      day: z.number().int().nonnegative().optional(),
      text: z.string().max(300),
    }),
  ),
});
export type JourneyQuote = z.infer<typeof journeyQuoteSchema>;

/** Deterministic short hash (two FNV-1a passes) for quote and journey fingerprints. */
export function hashText(text: string) {
  let a = 0x811c9dc5,
    b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export const quoteHash = (quote: unknown) => hashText(canonicalJson(quote));
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/**
 * The table with its record lists in ID order. Screens list purses, holdings and shops by name,
 * the device by key and a room in insertion order; Review Inbox's one-click Approve & depart
 * hashes its quote from this form so the server can compare it whatever order it stores.
 */
export function orderedTable<T extends Pick<CloudTable, "purses" | "holdings" | "shops">>(t: T): T {
  return {
    ...t,
    purses: [...t.purses].sort(byId),
    holdings: [...t.holdings].sort(byId),
    shops: [...t.shops].sort(byId),
    ...("stock" in t && Array.isArray((t as { stock?: unknown }).stock)
      ? { stock: [...(t as unknown as { stock: { id: string }[] }).stock].sort(byId) }
      : {}),
  };
}

type Table = Pick<CloudTable, "purses" | "journal">;
const journeysOf = (t: Pick<CloudTable, "journal">) => t.journal?.world?.journeys ?? [];
/** The group a journey moves (split the party): absent = the main group. */
export const journeyGroup = (j: Pick<Journey, "groupId">) => j.groupId ?? MAIN_GROUP;
/** A group's open journey (one per group); without a group, any open journey. */
export const openJourney = (t: Pick<CloudTable, "journal">, group?: string) =>
  journeysOf(t).find(
    (j) => (OPEN_JOURNEY_STATUSES as readonly string[]).includes(j.status) && (group === undefined || journeyGroup(j) === group),
  );
/** A group's journey under way (active or arrived); without a group, any. */
export const travellingJourney = (t: Pick<CloudTable, "journal">, group?: string) =>
  journeysOf(t).find(
    (j) => (j.status === "active" || j.status === "arrived") && (group === undefined || journeyGroup(j) === group),
  );

/**
 * Who travels: characters (and companions) with the party. A character with their own position,
 * aboard a ship or on personal downtime stays where they are (owner decision, 2026-10-23).
 */
export function journeyTravellers(t: Table, group: string = MAIN_GROUP) {
  return t.purses.filter((p) => {
    if (p.kind !== "character") return false;
    const s = characterPosition(t, p);
    // Split the party: a journey moves one group.
    return s.inParty && !s.shipId && !s.downtime && resolveGroup(t, s.groupId) === group;
  });
}
export function staysBehind(t: Table, group: string = MAIN_GROUP) {
  return t.purses.filter((p) => {
    if (p.kind !== "character" || p.control === "npc") return false;
    const s = characterPosition(t, p);
    return (
      characterVisible(t, p) &&
      (!s.inParty || !!s.shipId || !!s.downtime || resolveGroup(t, s.groupId) !== group)
    );
  });
}

/** The route's measuring frame, distances and duration from the map as it is now. */
export function measureJourney(map: CampaignMap, journey: Journey) {
  const frame = routeFrame(map);
  if (!frame) throw Error("Set the map's scale before planning a journey on it.");
  if (!journey.points) throw Error("The journey has no route.");
  const legs = legDeciMiles(frame, journey.points);
  const total = legs.reduce((s, l) => s + l, 0);
  if (!total) throw Error("Draw a route with some distance to travel.");
  return {
    frame,
    fingerprint: frameFingerprint(frame),
    legDeciMiles: legs,
    durationMinutes: journeyDurationMinutes(total, journey.pace.milesPerDay, journey.forcedMarchHours),
  };
}
/** downtime-plan{journeyId}: freeze a proposed or planned journey (an active one stays frozen). */
export function prepareJourneyPlan(t: CloudTable, journeyId: string) {
  const j = journeysOf(t).find((j) => j.id === journeyId);
  if (!j) throw Error("This journey no longer exists.");
  if (j.status === "active") {
    if (j.elapsedMinutes >= j.frozen!.durationMinutes) throw Error("This journey has arrived.");
    return j;
  }
  if (j.status === "arrived") throw Error("This journey has arrived. Confirm Move party here.");
  if (j.status !== "proposed" && j.status !== "planned")
    throw Error("Only a proposed, planned or ongoing journey can be reviewed.");
  const map = t.journal?.world?.maps.find((m) => m.id === j.mapId);
  if (!map) throw Error("The journey's map no longer exists.");
  const measured = measureJourney(map, j);
  const travel = readTravel(t.journal?.world?.travel);
  j.status = "planned";
  j.frozen = {
    ...measured,
    travellerIds: journeyTravellers(t, journeyGroup(j)).map((p) => p.id),
    unitCopper: { rations: travel.rations.unitCopper, mounts: travel.mounts.unitCopper },
  };
  return j;
}

function placeName(t: Pick<CloudTable, "journal">, locationId?: string | null) {
  return locationId
    ? (readMarketLocations(t.journal?.market).locations.find((l) => l.id === locationId)?.name ??
        "an unknown place")
    : "";
}
/** The party's map position after `minutes` on a frozen journey, with that leg's terrain. */
export function journeyPosition(
  t: Pick<CloudTable, "journal">,
  j: Journey,
  minutes: number,
): PartyMapPosition {
  const frozen = j.frozen!;
  const progress = Math.min(1, minutes / frozen.durationMinutes);
  const legs = frozen.legDeciMiles ?? j.legs.map(() => 1);
  const point = routePointAt(j.points!, legs, progress);
  const leg = j.legs[legIndexAt(legs, progress)];
  const to = placeName(t, j.destinationLocationId);
  return partyMapPositionSchema.parse({
    x: Math.min(1, Math.max(0, point.x)),
    y: Math.min(1, Math.max(0, point.y)),
    mapId: j.mapId,
    environment: leg.environment,
    ...(leg.biome ? { biome: leg.biome } : {}),
    description: (progress >= 1 && to ? `Arrived near ${to}` : to ? `On the road to ${to}` : "On the road").slice(0, 200),
  });
}

/**
 * The journey section of a downtime quote (deterministic, so `applyDowntime`'s
 * recompute-and-compare refuses a stale preview). Ration and mount lines are paid after every
 * other quote line from `balances`; a payer who can't cover a line is marked `short`, and
 * approval refuses the whole downtime until the line is off or coins are added.
 */
export function previewJourney(
  t: Pick<CloudTable, "purses" | "holdings" | "journal"> & Partial<Pick<CloudTable, "shops" | "ledger">>,
  day: number,
  days: number,
  journeyId: string,
  balances: Map<string, number>,
): JourneyQuote {
  const j = journeysOf(t).find((j) => j.id === journeyId);
  if (!j || !j.frozen || !j.points || !j.mapId) throw Error("Review the journey again before approving it.");
  if (j.status !== "planned" && j.status !== "active")
    throw Error("This journey is not waiting to travel.");
  const frozen = j.frozen;
  if (j.status === "planned") {
    const map = t.journal?.world?.maps.find((m) => m.id === j.mapId);
    const frame = map && routeFrame(map);
    if (!frame || frameFingerprint(frame) !== frozen.fingerprint)
      throw Error("The journey's map or scale changed. Review the journey again.");
  }
  const from = j.elapsedMinutes,
    to = Math.min(frozen.durationMinutes, from + days * 1440),
    chargeDays = Math.ceil((to - from) / 1440);
  const lines: JourneyQuote["lines"] = [];
  // A coach fare is charged once, first, when the DM approves departure (its booking's payment ID).
  const fare = j.costs.fare;
  if (fare && fare.copper && !t.ledger?.some((l) => l.id === `${fare.orderId}-payment`)) {
    if (!balances.has(fare.payerId)) throw Error("The coach fare's payer no longer exists.");
    const short = balances.get(fare.payerId)! < fare.copper;
    if (!short) balances.set(fare.payerId, balances.get(fare.payerId)! - fare.copper);
    lines.push({ kind: "fare", purseId: fare.payerId, quantity: 1, unitCopper: fare.copper, copper: fare.copper, short });
  }
  const price = frozen.unitCopper ?? { rations: 0, mounts: 0 };
  const quantities = {
    rations: frozen.travellerIds.length * chargeDays,
    mounts:
      j.costs.mountHoldingIds.reduce(
        (sum, hid) => sum + (t.holdings.find((h) => h.id === hid && h.quantity > 0)?.quantity ?? 0),
        0,
      ) * chargeDays,
  };
  for (const kind of ["rations", "mounts"] as const) {
    if (!j.costs[kind] || !quantities[kind]) continue;
    const payer = j.costs.payerId;
    if (!payer || !balances.has(payer)) throw Error("Choose who pays for the journey's costs.");
    if (quantities[kind] > 100000) throw Error("A journey cost line is limited to 100,000 units.");
    const copper = quantities[kind] * price[kind];
    if (!Number.isSafeInteger(copper) || copper > 1e12) throw Error("Journey costs are too large.");
    const short = balances.get(payer)! < copper;
    if (!short) balances.set(payer, balances.get(payer)! - copper);
    lines.push({ kind, purseId: payer, quantity: quantities[kind], unitCopper: price[kind], copper, short });
  }
  const notices: JourneyQuote["notices"] = [];
  // Split the party: shops left behind are those at the travelling group's place.
  const market = groupMarket(t, journeyGroup(j));
  const shops = t.shops ?? [];
  const leaving =
    from === 0 && market.currentLocationId
      ? shops.filter(
          (s) =>
            s.locationId &&
            locationPath(market, market.currentLocationId).some((l) => l.id === s.locationId),
        )
      : [];
  const closesDuring = (s: (typeof shops)[number], first: number, last: number) => {
    const schedule = s.schedule ? shopScheduleSchema.safeParse(s.schedule) : undefined;
    if (!schedule?.success) return undefined;
    for (let d = first; d <= last; d++)
      if (!schedule.data.openDays.includes(d % schedule.data.cycleDays)) return d;
    return undefined;
  };
  for (const s of leaving) {
    notices.push({ kind: "left-behind", shopId: s.id, text: `${s.name} (${placeName(t, s.locationId)})` });
    const closes = closesDuring(s, day + 1, day + days);
    if (closes !== undefined)
      notices.push({ kind: "schedule", shopId: s.id, day: closes, text: `${s.name} closes on day ${closes} by its schedule.` });
  }
  const arrived = to === frozen.durationMinutes;
  if (arrived && j.destinationLocationId) {
    const arrival = day + Math.floor((to - from) / 1440);
    for (const s of shops.filter(
      (s) => s.locationId && locationPath(market, j.destinationLocationId).some((l) => l.id === s.locationId),
    )) {
      const closed = closesDuring(s, arrival, arrival);
      if (closed !== undefined)
        notices.push({ kind: "schedule", shopId: s.id, day: arrival, text: `${s.name} is closed on day ${arrival} (arrival) by its schedule.` });
    }
  }
  if (from === 0)
    for (const p of staysBehind(t, journeyGroup(j))) {
      const s = characterPosition(t, p);
      const other = s.inParty && !s.shipId && !s.downtime ? resolveGroup(t, s.groupId) : undefined;
      notices.push({
        kind: "stays-behind",
        purseId: p.id,
        text: other
          ? `${p.name} is with ${groupInfo(t, other).name} and stays there.`.slice(0, 300)
          : `${p.name} has their own position and stays there.`,
      });
    }
  return journeyQuoteSchema.parse({
    journeyId: j.id,
    journeyHash: hashText(canonicalJson(j)),
    fromMinutes: from,
    toMinutes: to,
    durationMinutes: frozen.durationMinutes,
    arrived,
    position: journeyPosition(t, j, to),
    lines,
    notices,
  });
}

const costLabel = { fare: "the coach fare", rations: "trail rations", mounts: "mount upkeep" } as const;
/** All-or-nothing payer check, run before anything in an approved downtime moves. */
export function assertJourneyPayable(t: Pick<CloudTable, "purses">, quote?: JourneyQuote) {
  const short = quote?.lines.find((l) => l.short);
  if (!short) return;
  const payer = t.purses.find((p) => p.id === short.purseId);
  throw Error(
    `${payer?.name ?? "The payer"} can't pay ${formatCopper(short.copper)} for ${costLabel[short.kind]}` +
      ` (has ${formatCopper(payer ? toCopper(payer.coins) : 0)} after the other downtime lines).` +
      " Turn the line off or add coins, then review the journey again. Nothing was charged.",
  );
}
/**
 * Inside `applyDowntime`, after the shared quote settled: charge the journey's lines once (one
 * ledger line per purse and kind, keyed to the downtime receipt), then move the party along the
 * frozen route. Departure clears the party's location, exactly like Move party freely.
 */
export function applyJourney(
  t: CloudTable,
  quote: JourneyQuote,
  receipt: { id: string; name: string },
  at: number,
  move: (purseId: string, delta: number, id: string, summary: string) => void,
  /** Split the party: a second journey in the same downtime keys its lines apart. */
  suffix = "",
) {
  assertJourneyPayable(t, quote);
  const world = t.journal!.world!;
  const j = world.journeys?.find((j) => j.id === quote.journeyId);
  if (!j || (j.status !== "planned" && j.status !== "active"))
    throw Error("This journey is not waiting to travel.");
  for (const line of quote.lines) {
    if (line.kind === "fare") {
      // Once, with the booking's payment ID, however many downtime windows the journey takes.
      const fare = j.costs.fare!;
      if (t.ledger.some((l) => l.id === `${fare.orderId}-payment`)) continue;
      move(line.purseId, -line.copper, `${fare.orderId}-payment`, `${receipt.name}: coach fare`);
      settleCoach(t, fare.orderId, at, true);
      continue;
    }
    move(
      line.purseId,
      -line.copper,
      `${receipt.id}:journey${suffix}:${line.kind}`,
      `${receipt.name}: ${costLabel[line.kind]} (${line.quantity} × ${formatCopper(line.unitCopper)})`,
    );
  }
  const departing = j.status === "planned";
  j.status = quote.arrived ? "arrived" : "active";
  j.decidedAt ??= at;
  j.elapsedMinutes = quote.toMinutes;
  j.downtimeIds = [...j.downtimeIds, receipt.id];
  const group = journeyGroup(j) === MAIN_GROUP ? undefined : world.groups?.find((g) => g.id === j.groupId && g.status === "active");
  if (j.groupId && !group) throw Error("This journey's group merged. Stop the journey first.");
  if (group) {
    // Split the party: the journey moves its own group, not the party's place.
    group.position = quote.position;
    group.locationId = null;
  } else {
    world.partyPosition = quote.position;
    const market = readMarketLocations(t.journal!.market);
    if (market.currentLocationId) t.journal!.market = readMarketLocations({ ...market, currentLocationId: null });
  }
  t.journal!.events.push({
    id: `${receipt.id}-journey${suffix}`,
    at,
    kind: "session",
    // A hidden group's travel stays in the DM's record.
    ...(group?.hidden ? { dmOnly: true } : {}),
    summary: (
      `${group ? `${group.name}: ` : ""}${departing ? "Departed" : "Travelled"}: ${receipt.name} · ${Math.round((quote.toMinutes / quote.durationMinutes) * 100)}% of the route` +
      (quote.arrived ? ` · arrived; waiting for the DM to move ${group ? "the group" : "the party"} in` : "")
    ).slice(0, 500),
  });
}

/**
 * A stable's coach booking follows its journey: departure pays it (completed), a denial or
 * withdrawal closes it without charge. Only the booking's own record changes here.
 */
function settleCoach(t: CloudTable, orderId: string, at: number, departed: boolean, status?: "denied" | "cancelled", reason = "") {
  const services = t.journal?.services as { orders?: { id: string; status: string; message: string; paidDay?: number; paidMinute?: number; completedDay?: number; completedMinute?: number; history: { at: number; status: string; note: string }[]; terms: { shopId: string } }[] } | undefined;
  const o = services?.orders?.find((x) => x.id === orderId);
  if (!o || o.status !== "requested") return;
  const f = t.journal!.finance ?? { day: 0, minuteOfDay: 0 };
  if (departed) {
    const line = t.ledger.find((l) => l.id === `${orderId}-payment`);
    if (line) line.shopId = o.terms.shopId;
    o.status = "completed";
    o.paidDay = o.completedDay = f.day;
    o.paidMinute = o.completedMinute = f.minuteOfDay ?? 0;
    o.message = "Departed. The fare was charged once when the DM approved departure.";
  } else {
    o.status = status!;
    o.message = `${status === "denied" ? `The DM denied the journey.${reason ? ` ${reason}` : ""}` : "The journey request was withdrawn."} Nothing was charged.`.slice(0, 1000);
  }
  if (o.history.length < 50) o.history.push({ at, status: o.status, note: o.message });
}

/** Called by `validateWorld`. */
export function validateJourneys(t: CloudTable, projected = false) {
  const journeys = journeysOf(t);
  if (new Set(journeys.map((j) => j.id)).size !== journeys.length) throw Error("Duplicate journey IDs.");
  // One open journey per group (split the party); one for the whole party otherwise.
  const open = journeys.filter((j) => (OPEN_JOURNEY_STATUSES as readonly string[]).includes(j.status)).map(journeyGroup);
  if (new Set(open).size !== open.length) throw Error("Only one journey can be open at a time for each group.");
  if (projected) return;
  // A player's projected table (previews of their own commands) has journeys without a route or
  // map on private and fogged maps; only the room's full table is checked for those.
  for (const j of journeys) {
    if (["planned", "active", "stopped", "arrived", "completed"].includes(j.status) && !j.frozen)
      throw Error("A reviewed journey must keep its frozen route.");
    if (
      j.mapId &&
      ["planned", "active", "arrived"].includes(j.status) &&
      !t.journal?.world?.maps.some((m) => m.id === j.mapId)
    )
      throw Error("Finish or stop the journey before removing its map.");
  }
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
/** Fields fixed once a journey is reviewed; only status, reason and decision time change after. */
const routeFields = (j: Journey) => {
  const { status: _s, reason: _r, decidedAt: _d, ...rest } = j;
  return rest;
};
export function applyJourneyCommand(
  t: CloudTable,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  cmd: JourneyCommand,
  at: number,
  event: (summary: string, purseId?: string) => void,
) {
  const dm = seat.role === "dm";
  const world = t.journal!.world!;
  if (cmd.kind === "travel-settings") {
    if (!dm) throw Error("Only the DM can perform this action.");
    if (!same(world.travel ?? null, cmd.before))
      throw Error("Travel settings changed elsewhere. Refresh before saving.");
    if (cmd.after) world.travel = cmd.after;
    else delete world.travel;
    event("Travel settings updated");
    return;
  }
  const journeys = (world.journeys ??= []);
  const current = journeys.find((j) => j.id === cmd.journeyId) ?? null;
  if (!same(current, cmd.before)) throw Error("This journey changed. Refresh before saving.");
  const next = structuredClone(cmd.journey);
  if (next.id !== cmd.journeyId) throw Error("Journey identity cannot change.");
  if (next.runs) throw Error("A journey route must use its full waypoints.");
  const travel = readTravel(world.travel);
  const own = !dm && seat.purseIds.includes(next.requestedBy);
  // Split the party: a journey moves one group (absent = the main group), fixed at creation.
  if (next.groupId === MAIN_GROUP) delete next.groupId;
  if (current && (next.groupId ?? null) !== (current.groupId ?? null)) throw Error("A journey keeps the group it was planned for.");
  if (!current && next.groupId && !world.groups?.some((g) => g.id === next.groupId && g.status === "active"))
    throw Error("This group no longer exists. Refresh before planning.");
  if (!current && next.groupId && groupShip(t, next.groupId))
    throw Error("This group is aboard a ship: it travels with the ship's voyage.");
  if (!current && !dm) {
    // A player plans for their own character's group (characters away from the party: the main group, as before).
    const proposer = purseGroupOf(t, next.requestedBy);
    const theirs = proposer ? resolveGroup(t, proposer) : MAIN_GROUP;
    if (journeyGroup(next) !== theirs) throw Error("Plan a journey for your own character's group.");
  }
  if (!current) {
    // Proposing: a new journey starts proposed, with nothing travelled or charged.
    if (next.status !== "proposed" || next.frozen || next.elapsedMinutes || next.downtimeIds.length || next.decidedAt || next.reason)
      throw Error("A new journey starts as a proposal.");
    if (dm ? next.requestedBy !== "dm" : !own) throw Error("Propose a journey for your own character.");
    if (!dm && t.purses.find((p) => p.id === next.requestedBy)?.kind !== "character")
      throw Error("Propose a journey for your own character.");
    if (!dm && next.message === undefined) next.message = "";
    if (openJourney(t, journeyGroup(next)))
      throw Error(
        journeyGroup(next) === MAIN_GROUP && !world.groups?.some((g) => g.status === "active")
          ? "Another journey is already open. Finish, deny or withdraw it first."
          : `${groupInfo(t, journeyGroup(next)).name} already has a journey open. Finish, deny or withdraw it first.`,
      );
  } else if (!dm) {
    if (!seat.purseIds.includes(current.requestedBy) || current.status !== "proposed")
      throw Error("Only the DM can change this journey.");
    if (next.requestedBy !== current.requestedBy) throw Error("Journey identity cannot change.");
    if (next.status !== "proposed" && next.status !== "cancelled")
      throw Error("You can edit or withdraw your own request.");
    if (next.frozen || next.elapsedMinutes || next.downtimeIds.length || next.reason)
      throw Error("Only the DM can review a journey.");
  } else {
    if (next.requestedBy !== current.requestedBy || next.createdAt !== current.createdAt)
      throw Error("Journey identity cannot change.");
    const transitions: Record<string, string[]> = {
      proposed: ["proposed", "denied", "cancelled"],
      planned: ["proposed", "cancelled"],
      active: ["stopped"],
      arrived: ["stopped"],
    };
    if (!transitions[current.status]?.includes(next.status))
      throw Error(
        current.status === "active" || current.status === "arrived"
          ? "A journey under way keeps its frozen route. Stop it here and plan a new one to change course."
          : "This journey is already decided.",
      );
    if (next.status === "proposed") {
      // Editing returns a reviewed journey to a proposal: it is frozen again when reviewed.
      if (next.frozen || next.elapsedMinutes || next.downtimeIds.length)
        throw Error("Review the journey to freeze its route.");
    } else if (!same(routeFields(next), routeFields(current)))
      throw Error("Only the status and reason change when a journey is decided.");
    if (next.status === "denied" && !next.reason) next.reason = { text: "", showToPlayer: false };
    if (next.status !== "proposed") next.decidedAt = at;
  }
  // A coach fare is set by its stable booking and never edited here.
  if (!same(next.costs.fare ?? null, current?.costs.fare ?? null))
    throw Error("A coach fare comes from its stable booking and can't be changed here.");
  if (!dm && next.reason) throw Error("Only the DM can give a reason.");
  if (!dm && (next.costs.rations || next.costs.mounts))
    throw Error("Optional journey costs are chosen by the DM.");
  if (next.status === "proposed") {
    const map = world.maps.find((m) => m.id === next.mapId);
    if (!map || (!dm && !mapAccessible(t, map, seat)))
      throw Error("Choose a map you can open for this journey.");
    if (!routeFrame(map)) throw Error("Set the map's scale before planning a journey on it.");
    measureJourney(map, next);
    if (next.destinationLocationId && !map.anchors.some((a) => a.locationId === next.destinationLocationId))
      throw Error("The destination must be anchored on this map, or a free point.");
    if (next.originLocationId && !map.anchors.some((a) => a.locationId === next.originLocationId))
      throw Error("The starting place must be anchored on this map.");
    if (next.pace.preset !== "custom" && next.pace.milesPerDay !== travel.paces[next.pace.preset])
      throw Error("The pace no longer matches the campaign's travel settings. Choose it again.");
    if (next.pace.preset === "custom" && !dm) throw Error("Only the DM can set a custom pace.");
    if (next.forcedMarchHours > (travel.forcedMarch.allowed ? travel.forcedMarch.maxExtraHours : 0))
      throw Error("Forced march is not allowed for that many hours.");
    if ((next.costs.rations || next.costs.mounts) && !t.purses.some((p) => p.id === next.costs.payerId))
      throw Error("Choose who pays for the journey's costs.");
    if (next.costs.mountHoldingIds.some((h) => !t.holdings.some((x) => x.id === h && x.quantity > 0)))
      throw Error("A chosen mount is no longer held.");
  }
  if (next.status === "stopped" && t.journal?.finance?.downtime.some((d) => d.status === "pending" && d.quote.journey?.journeyId === next.id))
    throw Error("Cancel the journey's pending downtime preview before stopping it.");
  world.journeys = [...journeys.filter((j) => j.id !== next.id), next];
  if (next.costs.fare && (next.status === "denied" || next.status === "cancelled"))
    settleCoach(t, next.costs.fare.orderId, at, false, next.status, next.reason?.showToPlayer ? next.reason.text : "");
  const to = placeName(t, next.destinationLocationId) || "a point on the map";
  event(
    {
      proposed: current ? `Journey to ${to} updated` : `Journey to ${to} proposed`,
      denied: `Journey to ${to} denied`,
      cancelled: `Journey to ${to} withdrawn`,
      stopped: `Journey to ${to} stopped on the road`,
    }[next.status as "proposed"] ?? `Journey to ${to} saved`,
    !dm ? next.requestedBy : undefined,
  );
}

/** A day count with downtime days for UI ("2.55 days of travel → 3 days of downtime"). */
export function journeyDays(minutes: number) {
  return { travel: minutes / 1440, downtime: downtimeDays(minutes) };
}

/** Samples per leg when cutting a route at concealed fog for a player. */
const FOG_SAMPLES = 24;
/**
 * A player's projection of journeys (`projectRecord`, which the non-DM branch of `view()` uses).
 * Players see their own requests and the party's reviewed journeys: status, days, progress,
 * terrain and pace. Never: other players' messages, unshared denial reasons, purses or mounts
 * they don't control, DM prices, or unknown destination names. On a private map the route and
 * distances are removed; on a shared map with concealed fog only the visible stretches are sent
 * (`runs`), cut on the server.
 */
export function projectJourneys(
  table: CloudTable,
  world: World,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  knownLocations: Set<string>,
) {
  if (world.travel) {
    const { paces, forcedMarch } = world.travel;
    world.travel = { paces, forcedMarch };
  }
  if (!world.journeys) return;
  const rawMaps = table.journal?.world?.maps ?? [];
  const holdings = new Set(table.holdings.filter((h) => seat.purseIds.includes(h.purseId)).map((h) => h.id));
  world.journeys = world.journeys
    .filter(
      (j) =>
        seat.purseIds.includes(j.requestedBy) ||
        ["planned", "active", "stopped", "arrived", "completed"].includes(j.status),
    )
    .map((journey) => {
      const j = structuredClone(journey);
      const own = seat.purseIds.includes(j.requestedBy);
      if (!own) delete j.message;
      if (j.reason && !(own && j.reason.showToPlayer)) delete j.reason;
      j.costs = {
        rations: j.costs.rations,
        mounts: j.costs.mounts,
        payerId: j.costs.payerId && seat.purseIds.includes(j.costs.payerId) ? j.costs.payerId : null,
        mountHoldingIds: j.costs.mountHoldingIds.filter((id) => holdings.has(id)),
        // A coach fare (services wave 2) is shown only to its payer (and the DM).
        ...(j.costs.fare && seat.purseIds.includes(j.costs.fare.payerId) ? { fare: j.costs.fare } : {}),
      };
      if (j.frozen) {
        delete j.frozen.unitCopper;
        j.frozen.travellerIds = j.frozen.travellerIds.filter((id) => {
          const p = table.purses.find((p) => p.id === id);
          return !!p && characterVisible(table, p);
        });
      }
      for (const key of ["originLocationId", "destinationLocationId"] as const)
        if (j[key] && !knownLocations.has(j[key]!)) delete j[key];
      if (j.points)
        j.points = j.points.map((p) =>
          p.locationId && !knownLocations.has(p.locationId) ? { x: p.x, y: p.y } : p,
        );
      const map = world.maps.find((m) => m.id === j.mapId),
        raw = rawMaps.find((m) => m.id === j.mapId);
      if (!map || !raw) {
        // Private (or unavailable) map: no map, coordinates, waypoints or distances.
        delete j.mapId;
        delete j.points;
        delete j.runs;
        if (j.frozen) {
          delete j.frozen.frame;
          delete j.frozen.fingerprint;
          delete j.frozen.legDeciMiles;
        }
        return j;
      }
      if (!raw.tabletop || !j.points) return j;
      const settings = readMapTabletop(raw);
      if (!mapNeedsMask(settings)) return j;
      const viewers = sceneViewers(table, raw, seat);
      const visible = (p: { x: number; y: number }) =>
        scenePointVisible(p, settings, raw.grid, viewers);
      if (j.points.every(visible) && j.points.slice(1).every((b, i) => {
        const a = j.points![i];
        for (let k = 1; k < FOG_SAMPLES; k++)
          if (!visible({ x: a.x + ((b.x - a.x) * k) / FOG_SAMPLES, y: a.y + ((b.y - a.y) * k) / FOG_SAMPLES }))
            return false;
        return true;
      }))
        return j;
      // Cut the polyline into its visible stretches; fogged waypoints never leave the server.
      const runs: { x: number; y: number }[][] = [];
      let run: { x: number; y: number }[] = [];
      const push = (p: { x: number; y: number }) => {
        if (visible(p)) run.push({ x: p.x, y: p.y });
        else {
          if (run.length > 1) runs.push(run);
          run = [];
        }
      };
      push(j.points[0]);
      for (let i = 1; i < j.points.length; i++) {
        const a = j.points[i - 1],
          b = j.points[i];
        for (let k = 1; k <= FOG_SAMPLES; k++)
          push({ x: a.x + ((b.x - a.x) * k) / FOG_SAMPLES, y: a.y + ((b.y - a.y) * k) / FOG_SAMPLES });
      }
      if (run.length > 1) runs.push(run);
      delete j.points;
      if (runs.length) j.runs = runs.slice(0, 200);
      return j;
    });
}
