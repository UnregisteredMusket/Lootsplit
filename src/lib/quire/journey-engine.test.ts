import test from "node:test";
import assert from "node:assert/strict";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";
import { applyCommand, applyCommandBatch, type Command, type CommandInput } from "./commands.ts";
import { projectRecord } from "./session-records.ts";
import { campaignMapSchema, type CampaignMap } from "./world-schema.ts";
import { DEFAULT_TRAVEL, type Journey } from "./journey-schema.ts";
import { quoteHash, journeyTravellers } from "./journey-engine.ts";
import { tableForProtocol, tabletopResponse, hasJourneys, JOURNEY_PROTOCOL } from "./tabletop-protocol.ts";
import { toCopper } from "./money.ts";
import { sessionTimeFingerprint } from "./session-time.ts";
import { canonicalJson } from "./canonical-json.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";

const dm: CloudSeat = { id: "dm", name: "DM", role: "dm", token: "t", purseIds: [] };
const aria: CloudSeat = { ...dm, id: "pa", name: "Aria", role: "player", purseIds: ["aria"] };
const bram: CloudSeat = { ...dm, id: "pb", name: "Bram", role: "player", purseIds: ["bram"] };
const coins = (c: Partial<Record<"cp" | "sp" | "ep" | "gp" | "pp", number>> = {}) => ({
  cp: 0,
  sp: 0,
  ep: 0,
  gp: 0,
  pp: 0,
  ...c,
});
const scale = { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 }, distance: 100, unit: "mi" as const, aspect: 1 };
const vale = (extra: Partial<CampaignMap> = {}) =>
  campaignMapSchema.parse({
    id: "vale",
    name: "Vale of Harrow",
    image: "data:image/png;base64,YQ==",
    locationId: "region",
    visible: true,
    type: "regional",
    anchors: [
      { locationId: "harrowgate", x: 0.2, y: 0.5 },
      { locationId: "kestrel", x: 0.811, y: 0.5 },
    ],
    markers: [],
    scale,
    ...extra,
  });
function fixture(fund = coins({ gp: 2, cp: 3 }), maps: CampaignMap[] = [vale()]): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      { id: "fund", name: "Party fund", kind: "party", coins: fund },
      { id: "aria", name: "Aria Thorne", kind: "character", coins: coins({ gp: 1 }) },
      { id: "bram", name: "Bram Ironfoot", kind: "character", coins: coins({ gp: 1 }) },
      { id: "ambrose", name: "Brother Ambrose", kind: "character", coins: coins() },
    ] as CloudTable["purses"],
    holdings: [
      { id: "horses", purseId: "aria", name: "Riding horse", kind: "item", quantity: 2, unitCopper: 0, notes: "" },
      { id: "mule", purseId: "fund", name: "Pack mule", kind: "item", quantity: 1, unitCopper: 0, notes: "" },
    ] as CloudTable["holdings"],
    shops: [
      {
        id: "lantern",
        name: "Brass Lantern Outfitters",
        keeper: "",
        place: "",
        notes: "",
        sellRate: 1,
        buyRate: 0.5,
        wealth: "modest",
        category: "general",
        priceScale: 1,
        locationId: "harrowgate",
        schedule: { cycleDays: 7, openDays: [0, 2, 3, 4, 5, 6], restockEveryDays: 0, restockQuantity: 1, lastRestockDay: 0 },
      },
    ] as CloudTable["shops"],
    journal: readJournal({
      market: {
        currentLocationId: "harrowgate",
        locations: [
          { id: "region", name: "Vale", kind: "region", parentId: null, description: "" },
          { id: "harrowgate", name: "Harrowgate", kind: "town", parentId: "region", description: "" },
          { id: "kestrel", name: "Kestrel Watch", kind: "town", parentId: "region", description: "" },
          { id: "saltmere", name: "Saltmere", kind: "town", parentId: "region", description: "" },
        ],
      },
      finance: { day: 41 },
      world: {
        maps,
        characterPositions: [
          { purseId: "ambrose", inParty: false, locationId: "saltmere", visible: true, sheetVisible: true },
        ],
      },
    }),
  };
}
const points = [
  { x: 0.2, y: 0.5, locationId: "harrowgate" },
  { x: 0.368, y: 0.5 },
  { x: 0.518, y: 0.5 },
  { x: 0.662, y: 0.5 },
  { x: 0.811, y: 0.5, locationId: "kestrel" },
];
const journey = (extra: Partial<Journey> = {}): Journey => ({
  id: "j1",
  status: "proposed",
  requestedBy: "dm",
  mapId: "vale",
  points,
  legs: [
    { environment: "Roads" },
    { environment: "Wilderness", biome: "Grassland" },
    { environment: "Wilderness", biome: "Forest" },
    { environment: "Roads" },
  ],
  originLocationId: "harrowgate",
  destinationLocationId: "kestrel",
  pace: { preset: "normal", milesPerDay: 24 },
  forcedMarchHours: 0,
  costs: { rations: false, mounts: false, payerId: null, mountHoldingIds: [] },
  elapsedMinutes: 0,
  downtimeIds: [],
  createdAt: 1,
  ...extra,
});
let n = 0;
const act = (t: CloudTable, c: CommandInput, seat = dm, id = `c${++n}`) =>
  applyCommand(t, seat, { ...c, id } as Command);
const journeyOf = (t: CloudTable, id = "j1") => t.journal!.world!.journeys!.find((j) => j.id === id)!;
const propose = (t: CloudTable, j = journey(), seat = dm) =>
  act(t, { kind: "party-journey", journeyId: j.id, before: null, journey: j }, seat);
const plan = (t: CloudTable, days: number, id = `plan${++n}`, extra = {}) =>
  applyCommand(t, dm, { id, kind: "downtime-plan", name: "Journey to Kestrel Watch", days, journeyId: "j1", ...extra } as Command);
const pending = (t: CloudTable) => t.journal!.finance!.downtime.find((d) => d.status === "pending")!;
const apply = (t: CloudTable, id = `apply${++n}`) =>
  applyCommand(t, dm, { id, kind: "downtime-apply", downtimeId: pending(t).id, endSession: false });
const copper = (t: CloudTable, id: string) => toCopper(t.purses.find((p) => p.id === id)!.coins);

test("party-journey: validation, player proposals and CAS", () => {
  const t = fixture();
  const proposed = propose(t);
  assert.equal(journeyOf(proposed).status, "proposed");
  // A second open journey is refused.
  assert.throws(() => propose(proposed, journey({ id: "j2" })), /Another journey is already open/);
  // A map without a scale, an unanchored destination and mismatched legs are refused.
  const unscaled = fixture(undefined, [vale({ scale: undefined })]);
  assert.throws(() => propose(unscaled), /Set the map's scale/);
  assert.throws(() => propose(t, journey({ destinationLocationId: "saltmere" })), /anchored on this map/);
  assert.throws(() => propose(t, journey({ legs: [{ environment: "Roads" }] })));
  assert.throws(() => propose(t, journey({ legs: journey().legs.map(() => ({ environment: "Wilderness" as const })) })), /biome/);
  // Pace must match the travel settings unless custom; forced march is off by default.
  assert.throws(() => propose(t, journey({ pace: { preset: "normal", milesPerDay: 30 } })), /pace/);
  assert.throws(() => propose(t, journey({ forcedMarchHours: 2 })), /Forced march/);
  // Players propose only for their own character, time only; they may edit and withdraw it.
  assert.throws(() => propose(t, journey({ requestedBy: "bram" }), aria), /your own character/);
  assert.throws(
    () => propose(t, journey({ requestedBy: "aria", costs: { rations: true, mounts: false, payerId: "aria", mountHoldingIds: [] } }), aria),
    /chosen by the DM/,
  );
  const mine = propose(t, journey({ requestedBy: "aria", message: "Before the pass snows in." }), aria);
  assert.throws(
    () => act(mine, { kind: "party-journey", journeyId: "j1", before: journeyOf(mine), journey: { ...journeyOf(mine), status: "cancelled" } }, bram),
    /Only the DM/,
  );
  const withdrawn = act(mine, { kind: "party-journey", journeyId: "j1", before: journeyOf(mine), journey: { ...journeyOf(mine), status: "cancelled" } }, aria);
  assert.equal(journeyOf(withdrawn).status, "cancelled");
  assert.throws(
    () => act(mine, { kind: "party-journey", journeyId: "j1", before: journeyOf(mine), journey: { ...journeyOf(mine), status: "planned" } }, aria),
    /edit or withdraw/,
  );
  // CAS: a stale `before` is refused.
  assert.throws(
    () => act(proposed, { kind: "party-journey", journeyId: "j1", before: journey({ message: "old" }), journey: journey() }),
    /changed/,
  );
  // The DM denies with a reason; only the status and reason change.
  const denied = act(mine, {
    kind: "party-journey",
    journeyId: "j1",
    before: journeyOf(mine),
    journey: { ...journeyOf(mine), status: "denied", reason: { text: "Snow", showToPlayer: true } },
  });
  assert.equal(journeyOf(denied).status, "denied");
  assert.equal(journeyOf(denied).reason!.text, "Snow");
  // Travel settings are DM-only with CAS.
  assert.throws(() => act(t, { kind: "travel-settings", before: null, after: DEFAULT_TRAVEL }, aria), /DM/);
  const set = act(t, { kind: "travel-settings", before: null, after: { ...DEFAULT_TRAVEL, forcedMarch: { allowed: true, maxExtraHours: 2 } } });
  assert.doesNotThrow(() => propose(set, journey({ forcedMarchHours: 2 })));
  assert.throws(() => act(set, { kind: "travel-settings", before: null, after: null }), /changed elsewhere/);
});

test("downtime-plan{journeyId} freezes the route, prices nothing by default and lists notices", () => {
  const t = propose(fixture());
  // An earlier pending preview is replaced, as today.
  const winter = applyCommand(t, dm, { id: "winter", kind: "downtime-plan", name: "Winter rest", days: 5 });
  const planned = plan(winter, 3, "p1");
  const j = journeyOf(planned);
  assert.equal(j.status, "planned");
  assert.equal(j.frozen!.durationMinutes, 3666);
  assert.deepEqual(j.frozen!.legDeciMiles, [168, 150, 144, 149]);
  assert.deepEqual(j.frozen!.travellerIds.sort(), ["aria", "bram"], "Brother Ambrose stays behind");
  assert.equal(j.frozen!.frame!.kind, "scale");
  assert.equal(planned.journal!.finance!.downtime.find((d) => d.id === "winter")!.status, "cancelled");
  const quote = pending(planned).quote.journey!;
  assert.equal(quote.toMinutes, 3666);
  assert.equal(quote.arrived, true);
  assert.deepEqual(quote.lines, []);
  assert.deepEqual(
    quote.notices.map((n) => n.kind),
    ["left-behind", "schedule", "stays-behind"],
  );
  assert.match(quote.notices[1].text, /closes on day 4[2-4]/);
  assert.deepEqual(journeyTravellers(planned).map((p) => p.id).sort(), ["aria", "bram"]);
});

test("approval: departure, partial days, then the rest; arrival needs Move party here", () => {
  const t = propose(fixture());
  // Apply now: 1 day — the party leaves Harrowgate and is on the road (Grassland, leg 2).
  const day1 = apply(plan(t, 1, "p1"), "a1");
  let j = journeyOf(day1);
  assert.equal(j.status, "active");
  assert.equal(j.elapsedMinutes, 1440);
  assert.deepEqual(j.downtimeIds, ["p1"]);
  assert.equal(day1.journal!.market!.currentLocationId, null);
  const position = day1.journal!.world!.partyPosition!;
  assert.equal(position.mapId, "vale");
  assert.equal(position.environment, "Wilderness");
  assert.equal(position.biome, "Grassland");
  assert.ok(Math.abs(position.x! - (0.2 + 0.24)) < 1e-9, "24 of 61.1 miles");
  assert.equal(day1.journal!.finance!.day, 42);
  // While under way the route is frozen, Move party freely and party-location are refused.
  assert.throws(
    () => act(day1, { kind: "party-journey", journeyId: "j1", before: j, journey: { ...j, pace: { preset: "fast", milesPerDay: 30 } } }),
    /frozen route/,
  );
  assert.throws(
    () => act(day1, { kind: "party-location", before: null, locationId: "kestrel", beforePosition: canonicalJson(position) }),
    /on a journey/,
  );
  assert.throws(
    () => act(day1, { kind: "party-map-position", before: position, beforeLocationId: null, position: { environment: "Roads", description: "" } }),
    /on a journey/,
  );
  // The map can't be removed while the journey is under way.
  assert.throws(
    () => act(day1, { kind: "map-save", mapId: "vale", before: day1.journal!.world!.maps[0], map: null }),
    /journey on this map|free party position/,
  );
  // Changing the scale doesn't change the journey under way.
  const map = day1.journal!.world!.maps[0];
  const rescaled = act(day1, { kind: "map-save", mapId: "vale", before: map, map: { ...map, scale: { ...scale, distance: 50 } } });
  // The remaining two days arrive.
  const arrived = apply(plan(rescaled, 2, "p2"), "a2");
  j = journeyOf(arrived);
  assert.equal(j.status, "arrived");
  assert.equal(j.elapsedMinutes, 3666);
  assert.equal(j.frozen!.durationMinutes, 3666);
  assert.ok(Math.abs(arrived.journal!.world!.partyPosition!.x! - 0.811) < 1e-9);
  assert.equal(arrived.journal!.world!.partyPosition!.environment, "Roads");
  assert.throws(() => plan(arrived, 1), /arrived/);
  const before = canonicalJson(arrived.journal!.world!.partyPosition);
  // "Not yet" leaves it; party-location without the journey is refused; the wrong place is refused.
  assert.throws(
    () => act(arrived, { kind: "party-location", before: null, locationId: "kestrel", beforePosition: before }),
    /Confirm Move party here/,
  );
  assert.throws(
    () => act(arrived, { kind: "party-location", before: null, locationId: "saltmere", beforePosition: before, journeyId: "j1" }),
    /destination/,
  );
  const home = act(arrived, { kind: "party-location", before: null, locationId: "kestrel", beforePosition: before, journeyId: "j1" });
  assert.equal(home.journal!.market!.currentLocationId, "kestrel");
  assert.equal(home.journal!.world!.partyPosition, undefined);
  assert.equal(journeyOf(home).status, "completed");
  assert.equal(home.ledger.length, arrived.ledger.length, "arrival moves no money");
  assert.equal(home.journal!.finance!.day, arrived.journal!.finance!.day, "and no time");
});

test("optional lines are charged once with exact change, keyed to the downtime receipt", () => {
  const t = propose(
    fixture(coins({ gp: 1, sp: 3 })),
    journey({ costs: { rations: true, mounts: true, payerId: "fund", mountHoldingIds: ["horses", "mule"] } }),
  );
  const planned = plan(t, 3, "p1");
  const lines = pending(planned).quote.journey!.lines;
  // 2 travellers × 3 days × 5 cp; 3 animals × 3 days × 8 cp.
  assert.deepEqual(
    lines.map((l) => [l.kind, l.quantity, l.unitCopper, l.copper, l.short]),
    [
      ["rations", 6, 5, 30, false],
      ["mounts", 9, 8, 72, false],
    ],
  );
  const paid = apply(planned, "a1");
  assert.equal(copper(t, "fund") - copper(paid, "fund"), 102, "copper conservation");
  const ledger = paid.ledger.filter((l) => l.id.startsWith("p1:journey:"));
  assert.deepEqual(ledger.map((l) => [l.id, l.copper]).sort(), [
    ["p1:journey:mounts", -72],
    ["p1:journey:rations", -30],
  ]);
  // Exact change from silver: 130 cp − 102 cp = 28 cp, whole coins only.
  const left = paid.purses.find((p) => p.id === "fund")!.coins;
  assert.ok(Object.values(left).every((v) => Number.isInteger(v) && v >= 0));
  assert.equal(toCopper(left), 28);
  // Exactly once: the same approval again is refused and changes nothing.
  assert.throws(
    () => applyCommand(paid, dm, { id: "a1", kind: "downtime-apply", downtimeId: "p1", endSession: false }),
    /already been decided/,
  );
});

test("a payer short of coins refuses the whole approval; nothing moves", () => {
  const t = propose(
    fixture(coins({ cp: 50 })),
    journey({ costs: { rations: true, mounts: true, payerId: "fund", mountHoldingIds: ["horses", "mule"] } }),
  );
  const planned = plan(t, 3, "p1");
  const quote = pending(planned).quote.journey!;
  assert.deepEqual(quote.lines.map((l) => l.short), [false, true], "rations fit, mounts don't");
  const snapshot = canonicalJson(planned);
  assert.throws(() => apply(planned, "a1"), /Party fund can't pay .* mount upkeep.*Nothing was charged/);
  assert.equal(canonicalJson(planned), snapshot, "unchanged");
});

test("a stale preview is refused: balances, the journey or the map scale changed", () => {
  const t = propose(fixture());
  const planned = plan(t, 3, "p1");
  const richer = structuredClone(planned);
  richer.purses.find((p) => p.id === "fund")!.coins.cp += 1;
  assert.throws(() => apply(richer, "a1"), /changed after this preview/);
  // A scale change before departure refuses the frozen preview.
  const map = planned.journal!.world!.maps[0];
  const rescaled = act(planned, { kind: "map-save", mapId: "vale", before: map, map: { ...map, scale: { ...scale, distance: 50 } } });
  assert.throws(() => apply(rescaled, "a2"), /map or scale changed/);
  // Editing the journey sends it back to a proposal; the old preview can't be approved.
  const j = journeyOf(planned);
  const { frozen: _f, ...plain } = j;
  const edited = act(planned, { kind: "party-journey", journeyId: "j1", before: j, journey: { ...plain, status: "proposed", pace: { preset: "fast", milesPerDay: 30 } } });
  assert.throws(() => apply(edited, "a3"), /not waiting to travel|changed after this preview|Review the journey again/);
});

test("one-click inbox approval runs plan + apply as one batch and aborts on any change", () => {
  const t = propose(fixture(), journey({ requestedBy: "aria", message: "Go" }), aria);
  const previewed = plan(t, 3, "batch-plan");
  const hash = quoteHash(pending(previewed).quote);
  const commands = [
    { id: "batch-plan", kind: "downtime-plan", name: "Journey to Kestrel Watch", days: 3, journeyId: "j1", expectedQuoteHash: hash },
    { id: "batch-apply", kind: "downtime-apply", downtimeId: "batch-plan", endSession: false },
  ] as Command[];
  const done = applyCommandBatch(t, dm, commands);
  assert.equal(journeyOf(done).status, "arrived");
  // Anything changed since the entry was drawn up: the batch stops and nothing is applied.
  const changed = structuredClone(t);
  changed.purses.find((p) => p.id === "fund")!.coins.gp += 1;
  assert.throws(() => applyCommandBatch(changed, dm, commands), /Open the full review/);
  assert.equal(journeyOf(changed).status, "proposed");
  // The batch is the same as the two commands one after the other (the offline path).
  const sequential = applyCommand(applyCommand(t, dm, commands[0]), dm, commands[1]);
  const strip = (x: CloudTable) => canonicalJson({ ...x, journal: { ...x.journal, events: [] }, ledger: x.ledger.map((l) => ({ ...l, at: 0 })) });
  assert.equal(
    strip({ ...done, journal: { ...done.journal!, finance: { ...done.journal!.finance!, downtime: done.journal!.finance!.downtime.map((d) => ({ ...d, at: 0, appliedAt: 0 })) }, world: { ...done.journal!.world!, journeys: done.journal!.world!.journeys!.map((j) => ({ ...j, decidedAt: 0 })) } } }),
    strip({ ...sequential, journal: { ...sequential.journal!, finance: { ...sequential.journal!.finance!, downtime: sequential.journal!.finance!.downtime.map((d) => ({ ...d, at: 0, appliedAt: 0 })) }, world: { ...sequential.journal!.world!, journeys: sequential.journal!.world!.journeys!.map((j) => ({ ...j, decidedAt: 0 })) } } }),
  );
});

test("stopping on the road keeps the position; Session Time never advances a journey", () => {
  const t = apply(plan(propose(fixture()), 1, "p1"), "a1");
  const j = journeyOf(t);
  const stopped = act(t, { kind: "party-journey", journeyId: "j1", before: j, journey: { ...j, status: "stopped" } });
  assert.equal(journeyOf(stopped).status, "stopped");
  assert.deepEqual(stopped.journal!.world!.partyPosition, t.journal!.world!.partyPosition);
  assert.equal(stopped.ledger.length, t.ledger.length);
  const position = canonicalJson(stopped.journal!.world!.partyPosition);
  assert.doesNotThrow(() =>
    act(stopped, { kind: "party-location", before: null, locationId: "kestrel", beforePosition: position }),
  );
  const started = act(t, { kind: "session", name: "Session 2", end: false });
  const timed = act(started, {
    kind: "session-time",
    before: sessionTimeFingerprint(started),
    hours: 8,
    rest: "none",
    purseIds: [],
    allowDowntime: false,
    note: "",
  });
  assert.equal(journeyOf(timed).elapsedMinutes, 1440, "Session Time does not advance the journey");
});

test("projection: private maps, fog cutting, reasons, purses and prices", () => {
  const fogged = vale({
    tabletop: mapTabletopSchema.parse({
      fog: {
        enabled: true,
        base: "concealed",
        shapes: [{ id: "r", kind: "rectangle", reveal: true, a: { x: 0, y: 0 }, b: { x: 0.45, y: 1 } }],
      },
    }),
  });
  const base = fixture(undefined, [fogged]);
  base.journal!.world!.travel = DEFAULT_TRAVEL;
  const t = apply(
    plan(
      propose(base, journey({ costs: { rations: true, mounts: true, payerId: "fund", mountHoldingIds: ["horses", "mule"] } })),
      1,
      "p1",
    ),
    "a1",
  );
  const seen = projectRecord(t, aria).journal!.world!;
  const j = seen.journeys![0];
  assert.equal(j.points, undefined, "fogged waypoints are cut on the server");
  assert.ok(j.runs!.length >= 1);
  assert.ok(j.runs!.flat().every((p) => p.x <= 0.45 + 1e-9), "only the revealed stretch");
  assert.equal(j.frozen!.unitCopper, undefined);
  assert.equal(j.costs.payerId, null, "Aria doesn't control the party fund");
  assert.deepEqual(j.costs.mountHoldingIds, ["horses"]);
  assert.equal(seen.travel!.rations, undefined, "DM prices stay with the DM");
  assert.deepEqual(seen.travel!.paces, DEFAULT_TRAVEL.paces);
  // The DM sees everything.
  assert.deepEqual(projectRecord(t, dm).journal!.world!.journeys![0].points, points);
  // A private map: no map, coordinates, waypoints or distances.
  const hidden = structuredClone(t);
  hidden.journal!.world!.maps[0].visible = false;
  const p = projectRecord(hidden, aria).journal!.world!.journeys![0];
  assert.equal(p.mapId, undefined);
  assert.equal(p.points, undefined);
  assert.equal(p.runs, undefined);
  assert.equal(p.frozen!.legDeciMiles, undefined);
  assert.equal(p.frozen!.frame, undefined);
  assert.equal(p.legs.length, 4, "terrain stays");
  assert.equal(p.elapsedMinutes, 1440);
  assert.equal(p.frozen!.durationMinutes, 3666);
  assert.equal(p.destinationLocationId, undefined, "Kestrel Watch is unknown to players");
  assert.equal(projectRecord(hidden, aria).journal!.world!.partyPosition!.x, undefined);
  // A player's own commands still preview on the projected table (shared play).
  const view = projectRecord(hidden, aria);
  assert.doesNotThrow(() =>
    applyCommand(view, aria, { id: "note", kind: "journal-note", purseId: "aria", visibility: "player", title: "Road", text: "Cold" } as Command, { preview: true }),
  );
  const foggedView = projectRecord(t, aria);
  assert.doesNotThrow(() =>
    applyCommand(foggedView, aria, { id: "note2", kind: "journal-note", purseId: "aria", visibility: "player", title: "Road", text: "Cold" } as Command, { preview: true }),
  );
  // Requests: another player's request, messages and unshared reasons stay private.
  const request = propose(fixture(), journey({ requestedBy: "aria", message: "Secret plan" }), aria);
  assert.equal(projectRecord(request, bram).journal!.world!.journeys!.length, 0);
  assert.equal(projectRecord(request, aria).journal!.world!.journeys![0].message, "Secret plan");
  const deny = (showToPlayer: boolean) =>
    act(request, {
      kind: "party-journey",
      journeyId: "j1",
      before: journeyOf(request),
      journey: { ...journeyOf(request), status: "denied", reason: { text: "Snow", showToPlayer } },
    });
  assert.equal(projectRecord(deny(false), aria).journal!.world!.journeys![0].reason, undefined);
  assert.equal(projectRecord(deny(true), aria).journal!.world!.journeys![0].reason!.text, "Snow");
  // Pending downtime previews (and their journey lines) are never projected to players.
  assert.deepEqual(projectRecord(plan(propose(fixture()), 3), aria).journal!.finance!.downtime, []);
});

test("old clients: protocols 0-6 never receive journeys; their writes keep them", () => {
  const t = apply(plan(propose(fixture()), 1, "p1"), "a1");
  assert.equal(JOURNEY_PROTOCOL, 7);
  assert.equal(hasJourneys(t), true);
  for (const protocol of [0, 2, 3, 5, 6]) {
    const old = tableForProtocol(t, protocol);
    assert.equal(hasJourneys(old), false, `protocol ${protocol}`);
    assert.ok(old.journal!.world!.partyPosition, "the party's position is still sent");
  }
  assert.equal(tableForProtocol(t, 7), t);
  const merged = preserveJournalMetadata(
    readJournal({ ...t.journal, world: { ...t.journal!.world!, journeys: undefined, travel: undefined } }),
    t.journal!,
  );
  assert.deepEqual(merged.world!.journeys, t.journal!.world!.journeys);
  for (const draft of [
    [{ id: "d", kind: "party-journey", journeyId: "j1", before: null, journey: journey() }],
    [{ id: "d", kind: "downtime-plan", name: "x", days: 1, journeyId: "j1" }],
    [{ id: "d", kind: "party-location", before: null, locationId: "kestrel", journeyId: "j1" }],
  ])
    assert.throws(
      () => tabletopResponse({ table: t, draft: JSON.stringify(draft) }, 6),
      /updated Lootsplitter client/,
    );
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft: "[]" }, 6));
  // Old saves without journeys or travel load and plan downtime unchanged.
  const old = fixture();
  assert.equal(old.journal!.world!.journeys, undefined);
  const plain = applyCommand(old, dm, { id: "w", kind: "downtime-plan", name: "Rest", days: 2 });
  assert.equal(pending(plain).quote.journey, undefined);
});
