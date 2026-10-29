// Zones and the DM's split rule (map tokens PR 7A, plan 6A): saved zones over derived ones,
// adjacency, trip estimates, split / join / merge inside the token follow, Block, Wait until end of
// session, Party vote (majority, unanimous, tie, timeout, DM override, withdraw, replace), requests
// that no longer apply, combat, privacy of votes, and protocol 17.
import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "./canonical-json.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { activeGroups, groupPlace, MAIN_GROUP, purseGroup, resolveGroup } from "./party-groups.ts";
import { projectRecord } from "./session-records.ts";
import { tableForProtocol, tabletopResponse, ZONES_PROTOCOL } from "./tabletop-protocol.ts";
import { mapGridSchema, type MapToken, type Zone } from "./world-schema.ts";
import { voteOutcome, zonesFingerprint } from "./zone-commands.ts";
import { crossing, tripEstimate, zoneOf, zonesAdjacent } from "./zones.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const mira: CloudSeat = { id: "p1", token: "p1", name: "P1", role: "player", purseIds: ["mira"] };
const torv: CloudSeat = { id: "p2", token: "p2", name: "P2", role: "player", purseIds: ["torvald"] };
const sela: CloudSeat = { id: "p3", token: "p3", name: "P3", role: "player", purseIds: ["sela"] };
const seats = [mira, torv, sela].map((s) => ({ id: s.id, purseIds: s.purseIds }));
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const g = canonicalJson(grid);
const ch = (id: string, column: number, row: number): MapToken => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column, row, visibility: "party" });
const link = (id: string, targetMapId: string, label: string) => ({ id, targetMapId, label, x: 0.5, y: 0.1, visibility: "party" as const });
function fixture(splitRule?: object, zones?: Zone[]): CloudTable {
  const map = (id: string, extra: Record<string, unknown>) => ({ id, name: id[0].toUpperCase() + id.slice(1), image: "data:image/png;base64,AAAA", locationId: null, visible: true, anchors: [], markers: [], grid, tokens: [], ...extra });
  return {
    ...emptyCloudTable(),
    purses: ["mira", "torvald", "sela"].map((id) => ({ id, kind: "character" as const, name: id[0].toUpperCase() + id.slice(1), coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({
      sessions: [{ id: "s14", name: "Session 14", startedAt: 1 }],
      market: {
        currentLocationId: "testville",
        locations: [
          { id: "greenvale", name: "Greenvale", kind: "region", parentId: null, description: "" },
          { id: "testville", name: "Testville", kind: "city", parentId: "greenvale", description: "" },
          { id: "commons", name: "The Commons", kind: "area", parentId: "testville", description: "" },
          { id: "far", name: "Farbury", kind: "town", parentId: "greenvale", description: "" },
        ],
      },
      finance: { day: 0, loans: [], rules: [], downtime: [] },
      world: {
        tabletop: { followView: true },
        ...(splitRule ? { splitRule } : {}),
        ...(zones ? { zones } : {}),
        maps: [
          map("city", { locationId: "testville", tokens: [ch("mira", 2, 2), ch("torvald", 3, 2), ch("sela", 4, 2)], connected: { links: [link("gate", "forest", "North Gate")], placements: [] } }),
          map("commons", { locationId: "commons" }),
          map("sewers", { connected: { parentMapId: "city", links: [], placements: [] } }),
          map("forest", { locationId: "greenvale", type: "regional", connected: { links: [link("back", "city", "City gate")], placements: [] } }),
          map("farbury", { locationId: "far" }),
          map("secret", { locationId: "greenvale", visible: false }),
        ],
      },
    }),
  };
}
const mapOf = (t: CloudTable, id: string) => t.journal!.world!.maps.find((m) => m.id === id)!;
let n = 0;
const run = (t: CloudTable, c: object, seat = mira, now?: number) =>
  applyCommand(t, seat, commandSchema.parse({ ...c, id: `zone-${++n}` }), { source: "server", playerSeats: seats, ...(now ? {} : {}) });
const follow = (t: CloudTable, to: string, who = "mira", from = "city") => ({
  kind: "map-token-follow",
  mapId: to,
  grid: g,
  purseId: who,
  fromMapId: from,
  beforeFrom: mapOf(t, from).tokens!.find((x) => x.entityId === who) ?? null,
  beforeTo: mapOf(t, to).tokens!.find((x) => x.entityId === who) ?? null,
  tokenId: `${who}-token`,
  at: { column: 5, row: 5 },
});
const ask = (t: CloudTable, to = "forest", seat = mira) => run(t, { kind: "zone-request", requestId: `req-${++n}`, purseId: seat.purseIds[0], fromMapId: "city", toMapId: to, grid: g, at: { column: 5, row: 5 } }, seat);
const groupOf = (t: CloudTable, who: string) => resolveGroup(t, purseGroup(t, who) ?? MAIN_GROUP);

test("zones: derived from locations, saved zones first, adjacency and trips", () => {
  const t = fixture();
  assert.equal(zoneOf(t, "commons"), "loc:testville");
  assert.equal(zoneOf(t, "sewers"), "loc:testville");
  assert.equal(zoneOf(t, "forest"), "loc:greenvale");
  assert.ok(zonesAdjacent(t, "loc:testville", "loc:greenvale"), "the North Gate links them");
  assert.ok(!zonesAdjacent(t, "loc:testville", "loc:far"), "no link: a journey");
  assert.deepEqual(tripEstimate(t, "loc:testville", "loc:far"), { miles: 45, days: 2, pace: 24 });
  // A saved zone: the sewers become their own place; Farbury is marked adjacent with no link.
  const saved = fixture(undefined, [
    { id: "sewers", name: "Testville Sewers", kind: "dungeon", mapIds: ["sewers"], locationIds: [], settings: { travel: "free" } },
    { id: "tv", name: "Testville", kind: "city", mapIds: [], locationIds: ["testville"], derivedFrom: "loc:testville", settings: { travel: "free", adjacent: ["loc:far"], notAdjacent: ["loc:greenvale"] } },
  ]);
  assert.equal(zoneOf(saved, "sewers"), "zone:sewers");
  assert.equal(zoneOf(saved, "commons"), "zone:tv");
  assert.ok(zonesAdjacent(saved, "zone:tv", "loc:far"));
  assert.ok(!zonesAdjacent(saved, "zone:tv", "loc:greenvale"), "the DM unticked the gate");
});

test("zone-save: DM only, revision-checked, one zone per map", () => {
  const t = fixture();
  const zones: Zone[] = [{ id: "z", name: "Z", kind: "custom", mapIds: ["sewers"], locationIds: [], settings: { travel: "free" } }];
  assert.throws(() => run(t, { kind: "zone-save", before: zonesFingerprint(t), zones, splitRule: null }, mira), /Only the DM/);
  const saved = run(t, { kind: "zone-save", before: zonesFingerprint(t), zones, splitRule: { rule: "block", majority: "majority", minutes: 5 } }, dm);
  assert.equal(saved.journal!.world!.zones!.length, 1);
  assert.equal(saved.journal!.world!.splitRule!.rule, "block");
  assert.throws(() => run(saved, { kind: "zone-save", before: zonesFingerprint(t), zones: [], splitRule: null }, dm), /Zones changed/);
  assert.throws(() => run(t, { kind: "zone-save", before: zonesFingerprint(t), zones: [...zones, { ...zones[0], id: "y" }], splitRule: null }, dm), /only one zone/);
});

test("Allow freely: the follow splits Mira off in the same command; coming back merges her", () => {
  const t = fixture(undefined, [{ id: "tv", name: "Testville", kind: "city", mapIds: [], locationIds: [], derivedFrom: "loc:testville", settings: { travel: "free", splitRule: "allow" } }]);
  const out = run(t, follow(t, "forest"));
  const group = groupOf(out, "mira");
  assert.notEqual(group, MAIN_GROUP);
  assert.equal(activeGroups(out)[0].name, "Mira — Forest");
  assert.equal(groupPlace(out, group).locationId, "greenvale");
  assert.equal(groupPlace(out, MAIN_GROUP).locationId, "testville", "the others stay");
  assert.ok(out.journal!.events.some((e) => e.summary === "Mira split off: Forest."));
  // Back to Testville: she rejoins and the one-member group merges.
  const back = run(out, { ...follow(out, "city", "mira", "forest"), at: { column: 2, row: 2 } });
  assert.equal(groupOf(back, "mira"), MAIN_GROUP);
  assert.equal(activeGroups(back).length, 0);
});

test("Block: the move is refused and the token stays", () => {
  const t = fixture({ rule: "block", majority: "majority", minutes: 5 });
  assert.throws(() => run(t, follow(t, "forest")), /The DM is keeping the party together here\. Ask your DM if Mira should split off to Forest\./);
  assert.throws(() => ask(t), /keeping the party together/);
  assert.throws(() => run(t, follow(t, "farbury")), /This trip takes about 2 days\. Ask your DM to plan the journey\./);
});

test("Party vote: majority passes, applies the split; a tie fails; voters stay anonymous", () => {
  let t = fixture();
  assert.throws(() => run(t, follow(t, "forest")), /ask the party first/);
  t = ask(t);
  const r = () => t.journal!.world!.zoneRequests!.at(-1)!;
  assert.equal(r().mode, "vote");
  assert.deepEqual(r().votes!.map((v) => [v.seatId, v.vote]), [["p1", "yes"], ["p2", null], ["p3", null]]);
  // A player's view shows the tally and their own vote, never who voted.
  t = run(t, { kind: "zone-vote", requestId: r().id, vote: "no" }, sela);
  const seen = projectRecord(t, { ...torv }).journal!.world!.zoneRequests![0];
  assert.equal(seen.votes, undefined);
  assert.equal(seen.seatId, "");
  assert.deepEqual(seen.tally, { yes: 1, no: 1, waiting: 1, mine: null });
  assert.equal(projectRecord(t, { ...sela }).journal!.world!.zoneRequests![0].tally!.mine, "no");
  t = run(t, { kind: "zone-vote", requestId: r().id, vote: "yes" }, torv);
  assert.equal(r().status, "applied");
  assert.notEqual(groupOf(t, "mira"), MAIN_GROUP);
  assert.equal(mapOf(t, "forest").tokens![0].entityId, "mira");
  // A tie (1 yes, 1 no, one never votes) fails at the deadline: settled lazily by anyone.
  let u = fixture();
  u = ask(u);
  const req = u.journal!.world!.zoneRequests![0];
  u = run(u, { kind: "zone-vote", requestId: req.id, vote: "no" }, torv);
  assert.equal(voteOutcome(u.journal!.world!.zoneRequests![0], req.deadline! + 1), "fail");
  assert.throws(() => run(u, { kind: "zone-request-resolve", requestId: req.id, action: "settle" }, sela), /still open/);
  u.journal!.world!.zoneRequests![0].deadline = 1; // the deadline passed
  u = run(u, { kind: "zone-request-resolve", requestId: req.id, action: "settle" }, sela);
  assert.equal(u.journal!.world!.zoneRequests![0].status, "failed");
  assert.match(u.journal!.world!.zoneRequests![0].reason!, /Mira stays with the party: the vote tied\./);
  assert.equal(groupOf(u, "mira"), MAIN_GROUP);
});

test("unanimous needs everyone; the DM can approve or reject any time; withdraw and replace", () => {
  let t = fixture({ rule: "vote", majority: "unanimous", minutes: 15 });
  t = ask(t);
  const id = t.journal!.world!.zoneRequests![0].id;
  t = run(t, { kind: "zone-vote", requestId: id, vote: "yes" }, torv);
  assert.equal(t.journal!.world!.zoneRequests![0].status, "open");
  const rejected = run(t, { kind: "zone-request-resolve", requestId: id, action: "reject" }, dm);
  assert.equal(rejected.journal!.world!.zoneRequests![0].status, "rejected");
  assert.throws(() => run(t, { kind: "zone-request-resolve", requestId: id, action: "approve" }, torv), /Only the DM/);
  const approved = run(t, { kind: "zone-request-resolve", requestId: id, action: "approve" }, dm);
  assert.equal(approved.journal!.world!.zoneRequests![0].status, "applied");
  const withdrawn = run(t, { kind: "zone-request-withdraw", requestId: id });
  assert.equal(withdrawn.journal!.world!.zoneRequests![0].status, "withdrawn");
  const replaced = ask(t);
  assert.deepEqual(replaced.journal!.world!.zoneRequests!.map((r) => r.status), ["withdrawn", "open"]);
  // No other players: the mover's own yes decides at once.
  const solo = applyCommand(fixture(), mira, commandSchema.parse({ id: "solo", kind: "zone-request", requestId: "solo", purseId: "mira", fromMapId: "city", toMapId: "forest", grid: g, at: { column: 5, row: 5 } }), { playerSeats: [] });
  assert.equal(solo.journal!.world!.zoneRequests![0].status, "applied");
});

test("Wait until end of session: queued, then applied or declined; requests that no longer apply", () => {
  let t = fixture({ rule: "session-end", majority: "majority", minutes: 5 });
  t = ask(t);
  const r = t.journal!.world!.zoneRequests![0];
  assert.equal(r.mode, "session-end");
  assert.equal(r.sessionId, "s14");
  assert.equal(groupOf(t, "mira"), MAIN_GROUP, "nothing moves yet");
  const declined = run(t, { kind: "zone-request-resolve", requestId: r.id, action: "decline" }, dm);
  assert.equal(declined.journal!.world!.zoneRequests![0].status, "declined");
  // The party moved to the forest meanwhile: the request is no longer needed.
  const moved = structuredClone(t);
  moved.journal!.market!.currentLocationId = null;
  moved.journal!.world!.partyPosition = undefined;
  moved.journal!.market = { ...moved.journal!.market!, currentLocationId: "testville" };
  const party = run(moved, { kind: "party-location", before: "testville", locationId: "far" }, dm);
  const stale = run(party, { kind: "zone-request-resolve", requestId: r.id, action: "approve" }, dm);
  assert.equal(stale.journal!.world!.zoneRequests![0].status, "cancelled");
  assert.match(stale.journal!.world!.zoneRequests![0].reason!, /no longer next to/);
});

test("combat blocks leaving the zone", () => {
  const t = fixture(undefined, [{ id: "tv", name: "Testville", kind: "city", mapIds: [], locationIds: [], derivedFrom: "loc:testville", settings: { travel: "free", splitRule: "allow" } }]);
  t.journal!.world!.combat = { id: "b", encounterId: "e", encounterRevision: 1, mapId: "commons", mode: "grid", phase: "active", gridFingerprint: g, scaleConfirmed: true, showPlayers: true, returnMapId: "commons", returnCamera: { x: 0.5, y: 0.5, zoom: 1 } } as never;
  assert.throws(() => run(t, follow(t, "forest")), /Finish the encounter before leaving Testville\./);
  assert.equal(crossing(t, "mira", "Mira", "commons", "city").kind, "same");
});

test("privacy and protocol 17: hidden maps never show; older clients get no zones", () => {
  let t = fixture();
  t = ask(t);
  t.journal!.world!.zoneRequests!.push({ ...t.journal!.world!.zoneRequests![0], id: "hidden", toMapId: "secret", toZone: "map:secret" });
  const seen = projectRecord(t, { ...torv }).journal!.world!.zoneRequests!;
  assert.deepEqual(seen.map((r) => r.id), [t.journal!.world!.zoneRequests![0].id]);
  assert.equal(ZONES_PROTOCOL, 17);
  const old = tableForProtocol(t, 16).journal!.world!;
  assert.equal(old.zoneRequests, undefined);
  for (const draft of [[{ kind: "zone-vote" }], [{ kind: "zone-save" }]])
    assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify(draft) }, 16), /unfinished map actions/);
});
