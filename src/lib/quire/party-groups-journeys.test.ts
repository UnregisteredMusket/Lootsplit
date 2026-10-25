// Split the party, phase 3: journeys per group (one open per group; approving time advances every
// journey the DM ticks), arrival per group, coach passengers per group, a whole group boarding a
// ship and staying in the party, map markers per group, and older apps.
import "./commands.ts";
import test from "node:test";
import assert from "node:assert/strict";
import type { CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import { projectRecord } from "./session-records.ts";
import { preserveJournalMetadata, readJournal } from "./journal.ts";
import { campaignMapSchema, type Journey } from "./world-schema.ts";
import { characterLocation, characterPosition } from "./character-position.ts";
import { validateWorld } from "./world.ts";
import { groupPlace, groupShip, partyGroupsFingerprint, partySplit } from "./party-groups.ts";
import { mapGroupPins } from "./party-groups-map.ts";
import { journeyTravellers } from "./journey-engine.ts";
import { tableForProtocol } from "./tabletop-protocol.ts";
import { defaultShip, type Vessel } from "./ships-schema.ts";
import { shipFingerprint } from "./ships.ts";
import { toCopper } from "./money.ts";
import { canonicalJson } from "./canonical-json.ts";
import { alex, dm, partyFixture, run, sam, splitFixture } from "./test-fixtures/party-groups.ts";
import { coachCommand, stableFixture, svcDm, svcThorn } from "./test-fixtures/services.ts";

const coast = campaignMapSchema.parse({
  id: "coast-map",
  name: "The Sunken Coast",
  image: "data:image/png;base64,YQ==",
  locationId: "coast",
  visible: true,
  type: "regional",
  anchors: [
    { locationId: "harbour", x: 0.1, y: 0.5 },
    { locationId: "ford", x: 0.5, y: 0.5 },
    { locationId: "ironhold", x: 0.9, y: 0.5 },
  ],
  markers: [],
  scale: { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 }, distance: 100, unit: "mi", aspect: 1 },
});
function campaign() {
  const t = partyFixture();
  t.journal!.world!.maps = [coast];
  return splitFixture(t);
}
const journey = (id: string, from: string, to: string, fromX: number, toX: number, extra: Partial<Journey> = {}): Journey => ({
  id,
  status: "proposed",
  requestedBy: "dm",
  mapId: "coast-map",
  points: [
    { x: fromX, y: 0.5, locationId: from },
    { x: toX, y: 0.5, locationId: to },
  ],
  legs: [{ environment: "Roads" }],
  originLocationId: from,
  destinationLocationId: to,
  pace: { preset: "normal", milesPerDay: 24 },
  forcedMarchHours: 0,
  costs: { rations: false, mounts: false, payerId: null, mountHoldingIds: [] },
  elapsedMinutes: 0,
  downtimeIds: [],
  createdAt: 1,
  ...extra,
});
const propose = (t: CloudTable, j: Journey, seat = dm) => run(t, { kind: "party-journey", journeyId: j.id, before: null, journey: j } as never, seat);
const journeyOf = (t: CloudTable, id: string) => t.journal!.world!.journeys!.find((j) => j.id === id)!;
const pending = (t: CloudTable) => t.journal!.finance!.downtime.find((d) => d.status === "pending")!;
const apply = (t: CloudTable) => run(t, { kind: "downtime-apply", downtimeId: pending(t).id, endSession: false } as never);
// Harbour ward → Greywater Ford: 40 mi; Ironhold → Greywater Ford: 40 mi (2 downtime days at 24 mi/day).
const watchTrip = () => journey("watch-trip", "harbour", "ford", 0.1, 0.5);
const ridersTrip = () => journey("riders-trip", "ironhold", "ford", 0.9, 0.5, { groupId: "riders" });

test("one open journey per group; players plan only for their own group", () => {
  let t = campaign();
  t = propose(t, watchTrip());
  assert.throws(() => propose(t, journey("again", "harbour", "ford", 0.1, 0.5)), /Harbour watch already has a journey open/);
  t = propose(t, ridersTrip());
  validateWorld(t);
  assert.throws(() => propose(t, journey("again-b", "ironhold", "ford", 0.9, 0.5, { groupId: "riders" })), /Ironhold riders already has a journey open/);
  // Players: their own group only.
  const fresh = campaign();
  assert.throws(() => propose(fresh, journey("p1", "ironhold", "ford", 0.9, 0.5, { requestedBy: "tamsin" }), alex), /your own character's group/);
  const asked = propose(fresh, journey("p1", "ironhold", "ford", 0.9, 0.5, { requestedBy: "tamsin", groupId: "riders", message: "" }), alex);
  assert.equal(journeyOf(asked, "p1").groupId, "riders");
  assert.throws(() => propose(fresh, journey("p2", "harbour", "ford", 0.1, 0.5, { requestedBy: "brannoc", groupId: "riders" }), sam), /your own character's group/);
  // A journey keeps the group it was planned for.
  assert.throws(
    () => run(asked, { kind: "party-journey", journeyId: "p1", before: journeyOf(asked, "p1"), journey: { ...journeyOf(asked, "p1"), groupId: undefined } } as never, alex),
    /keeps the group/,
  );
});

test("approving time moves each ticked journey's group; travellers, notices and lines per group", () => {
  let t = campaign();
  t = propose(t, watchTrip());
  t = propose(t, ridersTrip());
  // Rations for the riders, paid from the fund.
  const riders = journeyOf(t, "riders-trip");
  t = run(t, { kind: "party-journey", journeyId: "riders-trip", before: riders, journey: { ...riders, costs: { ...riders.costs, rations: true, payerId: "hoard" } } } as never);
  t = run(t, { id: "both", kind: "downtime-plan", name: "Two journeys", days: 1, journeyId: "riders-trip", journeyIds: ["watch-trip"] } as never);
  const quote = pending(t).quote;
  assert.deepEqual([...journeyOf(t, "riders-trip").frozen!.travellerIds].sort(), ["kettle", "maud", "tamsin"]);
  assert.deepEqual([...journeyOf(t, "watch-trip").frozen!.travellerIds].sort(), ["brannoc", "garrick", "oriel"]);
  assert.equal(quote.journey!.lines.find((l) => l.kind === "rations")!.quantity, 3, "3 riders × 1 day");
  assert.ok(quote.journey!.notices.some((n) => n.kind === "left-behind" && n.shopId === "armoury"), "riders leave Ironhold's shops");
  assert.ok(quote.journey!.notices.some((n) => n.kind === "stays-behind" && /Brannoc Vale is with Harbour watch/.test(n.text)));
  assert.equal(quote.journeys!.length, 1);
  assert.ok(quote.journeys![0]!.notices.some((n) => n.shopId === "chandlery"));
  const fund = toCopper(t.purses.find((p) => p.id === "hoard")!.coins);

  t = apply(t);
  assert.equal(journeyOf(t, "riders-trip").status, "active");
  assert.equal(journeyOf(t, "watch-trip").status, "active");
  assert.equal(groupPlace(t, "riders").locationId, null);
  assert.equal(groupPlace(t, "riders").position!.description, "On the road to Greywater Ford");
  assert.equal(t.journal!.market!.currentLocationId, null, "the main group is on the road too");
  assert.equal(toCopper(t.purses.find((p) => p.id === "hoard")!.coins), fund - 15);
  assert.ok(t.ledger.some((l) => l.id === "both:journey:rations"));
  assert.equal(new Set(t.journal!.events.map((e) => e.id)).size, t.journal!.events.length);
  // A group on the road can't merge; one ticked off stays put next time.
  assert.throws(
    () => run(t, { kind: "party-merge", before: partyGroupsFingerprint(t), groupIds: ["main", "riders"], intoLocationId: null } as never),
    /Merge waits: Harbour watch is on a journey/,
  );
  t = run(t, { id: "riders-only", kind: "downtime-plan", name: "Riders", days: 1, journeyId: "riders-trip" } as never);
  t = apply(t);
  assert.equal(journeyOf(t, "riders-trip").status, "arrived");
  assert.equal(journeyOf(t, "watch-trip").elapsedMinutes, 1440, "the unticked journey stayed put");
  // Arrival: Move group here completes that group's journey only.
  assert.throws(
    () => run(t, { kind: "party-location", groupId: "riders", before: null, locationId: "ironhold", journeyId: "riders-trip", beforePosition: canonicalJson(groupPlace(t, "riders").position) } as never),
    /destination/,
  );
  t = run(t, {
    kind: "party-location",
    groupId: "riders",
    before: null,
    locationId: "ford",
    journeyId: "riders-trip",
    beforePosition: canonicalJson(groupPlace(t, "riders").position),
  } as never);
  assert.equal(journeyOf(t, "riders-trip").status, "completed");
  assert.equal(groupPlace(t, "riders").locationId, "ford");
  assert.equal(characterLocation(t, t.purses.find((p) => p.id === "tamsin")!), "ford");
});

test("a coach carries the paying character's group", () => {
  let t = stableFixture();
  t = applyCommand(t, svcDm, {
    id: "coach-split",
    kind: "party-split",
    before: partyGroupsFingerprint(t),
    groups: [{ id: "thorns", name: "Thorn's band", colour: "blue", locationId: null, memberIds: ["thorn"] }],
  } as Command);
  t.journal!.world!.groups![0]!.locationId = groupPlace(t, "main").locationId;
  t = applyCommand(t, svcThorn, coachCommand(t, "thorn-coach", "saltmere", "thorn") as Command);
  const j = t.journal!.world!.journeys!.at(-1)!;
  assert.equal(j.groupId, "thorns");
  assert.deepEqual(journeyTravellers(t, "thorns").map((p) => p.id), ["thorn"]);
  const order = (t.journal!.services as { orders: { id: string; terms: { route?: { passengers: number } } }[] }).orders.find((o) => o.id === "thorn-coach")!;
  assert.equal(order.terms.route!.passengers, 1);
});

function withShip(t: CloudTable) {
  t.holdings.push({ id: "gull", name: "The Gull's Wager", kind: "property", quantity: 1, unitCopper: 10000, purseId: "hoard", notes: "", locationId: "ironhold", property: { type: "other" } } as never);
  const vessel: Vessel = { ...defaultShip(), propertyId: "gull", mode: "docked", facilityId: null, installed: [], arrearsCopper: 0, expenseRemainder: 0, dmNotes: "" };
  return run(t, { kind: "ship-configure", before: null, vessel } as never);
}
const boardGroup = (t: CloudTable, action: "board" | "disembark", groupId = "riders", seat = dm) =>
  run(t, { kind: "ship-board-group", propertyId: "gull", groupId, action, before: shipFingerprint(t, "gull") } as never, seat);

test("a whole group boards as a group and stays in the party; one character alone still leaves", () => {
  let t = withShip(campaign());
  assert.throws(() => boardGroup(t, "board", "riders", alex), /Only the DM/);
  assert.throws(() => boardGroup(t, "board", "main"), /other than the main group/);
  t = boardGroup(t, "board");
  assert.equal(groupShip(t, "riders"), "gull");
  for (const id of ["tamsin", "kettle", "maud"]) {
    const s = characterPosition(t, t.purses.find((p) => p.id === id)!);
    assert.equal(s.inParty, true, id);
    assert.equal(s.groupId, "riders", id);
    assert.equal(s.shipId, "gull", id);
  }
  validateWorld(t);
  // Moving, merging or journeys wait for the group to land.
  assert.throws(() => run(t, { kind: "party-location", groupId: "riders", before: "ironhold", locationId: "ford" } as never), /aboard a ship/);
  assert.throws(() => propose(t, ridersTrip()), /aboard a ship/);
  assert.throws(
    () => run(t, { kind: "ship-board", propertyId: "gull", purseId: "tamsin", action: "disembark", before: shipFingerprint(t, "gull") } as never),
    /aboard with their group/,
  );
  // Older apps see the group's characters as aboard alone, and their journal writes keep the group.
  const old = tableForProtocol(t, 9);
  assert.equal(old.journal!.world!.characterPositions.find((s) => s.purseId === "tamsin")!.inParty, false);
  assert.equal(old.purses.find((p) => p.id === "maud")!.nonParty, true);
  const written = preserveJournalMetadata(old.journal, readJournal(t.journal));
  assert.equal(written.world!.characterPositions.find((s) => s.purseId === "tamsin")!.inParty, true);
  assert.equal(written.world!.characterPositions.find((s) => s.purseId === "tamsin")!.groupId, "riders");
  // Land the group.
  t = boardGroup(t, "disembark");
  assert.equal(groupShip(t, "riders"), undefined);
  assert.equal(groupPlace(t, "riders").locationId, "ironhold");
  assert.equal(t.journal!.fleet!.aboard.length, 0);
  validateWorld(t);
});

test("map markers: one per group with letter and colour; hidden groups have none for others", () => {
  let t = campaign();
  assert.deepEqual(
    mapGroupPins(t, coast).map((p) => [p.ref, p.letter, p.colour, p.point.x]),
    [
      ["main", "A", "green", 0.1],
      ["riders", "B", "blue", 0.9],
    ],
  );
  t = run(t, { kind: "party-group-edit", before: partyGroupsFingerprint(t), groupId: "riders", name: "Ironhold riders", colour: "blue", hidden: true } as never);
  t = propose(t, ridersTrip());
  t = run(t, { kind: "downtime-plan", name: "Riders", days: 1, journeyId: "riders-trip" } as never);
  const forSam = projectRecord(t, sam);
  assert.deepEqual(mapGroupPins(forSam, coast).map((p) => p.ref), ["main"]);
  assert.equal(forSam.journal!.world!.journeys?.some((j) => j.groupId === "riders") ?? false, false, "a hidden group's journeys stay hidden");
  assert.ok(projectRecord(t, alex).journal!.world!.journeys!.some((j) => j.groupId === "riders"));
  assert.equal(partySplit(forSam), true);
  // Older apps never receive another group's journey.
  assert.equal(tableForProtocol(t, 9).journal!.world!.journeys!.some((j) => j.groupId), false);
});
