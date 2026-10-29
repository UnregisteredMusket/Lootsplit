// "Move party to ▸" (map tokens PR 4, plan section 3.1): destinations (submaps via their
// entrance, the parent and connected maps), the entry point, and the one batch in order — party
// location, players' scene, tokens at the entry — all or nothing, the same on device and in a room.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommandBatch, commandSchema } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { readTabletopSession } from "./tabletop.ts";
import { mapGridSchema, type CampaignMap, type MapToken } from "./world-schema.ts";
import { partyDestinations, partyEntry, partyMoveCommands } from "./party-move.ts";

const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] };
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const ch = (id: string, column: number, row: number): MapToken => ({ id: `${id}-token`, kind: "character", entityId: id, label: id, column, row, visibility: "party" });
const link = (id: string, targetMapId: string, label: string, x: number, y: number) => ({ id, targetMapId, label, x, y, visibility: "party" as const });
function fixture(): CloudTable {
  const map = (id: string, extra: Partial<CampaignMap>) => ({ id, name: id, image: "data:image/png;base64,AAAA", locationId: "town", visible: true, anchors: [], markers: [], ...extra });
  return {
    ...emptyCloudTable(),
    purses: ["mira", "bram"].map((id) => ({ id, kind: "character" as const, name: id, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({
      market: {
        currentLocationId: "town",
        locations: [
          { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
          { id: "town", name: "Testville", kind: "city", parentId: "region", description: "" },
          { id: "forest", name: "Forest", kind: "city", parentId: "region", description: "" },
        ],
      },
      finance: { day: 0, loans: [], rules: [], downtime: [] },
      world: {
        maps: [
          map("city", {}),
          map("keep", { grid, tokens: [ch("mira", 3, 3), ch("bram", 4, 3)], connected: { parentMapId: "city", links: [link("l1", "cellar", "trapdoor", 0.2, 0.3), link("l2", "forest-map", "North Gate", 0.5, 0)], placements: [] } }),
          map("cellar", { grid, tokens: [], connected: { parentMapId: "keep", links: [link("l3", "keep", "ladder", 0.5, 0.5)], placements: [] } }),
          map("upper", { connected: { parentMapId: "keep", links: [], placements: [] } }),
          map("forest-map", { locationId: "forest", grid, tokens: [], visible: false }),
        ],
      },
    }),
  };
}
const maps = (t: CloudTable) => t.journal!.world!.maps;
const mapOf = (t: CloudTable, id: string) => maps(t).find((m) => m.id === id)!;
let n = 0;
const ids = () => `id-${++n}`;
const run = (t: CloudTable, steps: ReturnType<typeof partyMoveCommands>) =>
  applyCommandBatch(t, dm, steps.map((s, i) => commandSchema.parse({ ...s, id: `move-${n}-${i}` })), () => ({ source: "server" }));

test("destinations: submaps via their entrance, then the parent and the entrances' maps", () => {
  const t = fixture();
  const { submaps, connected } = partyDestinations(maps(t), mapOf(t, "keep"));
  assert.deepEqual(submaps, [
    { mapId: "cellar", name: "cellar", hint: "via trapdoor" },
    { mapId: "upper", name: "upper", hint: "submap" },
  ]);
  assert.deepEqual(connected, [
    { mapId: "city", name: "city", hint: "parent map" },
    { mapId: "forest-map", name: "forest-map", hint: "North Gate" },
  ]);
});

test("entry: the destination's entrance back here wins, then the starting view, then the middle", () => {
  const t = fixture();
  assert.deepEqual(partyEntry(mapOf(t, "keep"), mapOf(t, "cellar")), { x: 0.5, y: 0.5, zoom: 1 });
  assert.deepEqual(partyEntry(mapOf(t, "cellar"), mapOf(t, "city")), { x: 0.5, y: 0.5, zoom: 1 });
});

test("one batch in order: tokens leave this map and arrive at the entry; the scene follows", () => {
  const t = fixture();
  const steps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "cellar"), { follow: true, placeTokens: true }, ids);
  assert.deepEqual(steps.map((s) => s.kind), ["tabletop-session", "map-tokens-place"], "same place: no party-location");
  const next = run(t, steps);
  assert.equal(readTabletopSession(next).activeMapId, "cellar");
  assert.deepEqual(readTabletopSession(next).camera?.view, { x: 0.5, y: 0.5, zoom: 1 });
  assert.equal(mapOf(next, "keep").tokens!.length, 0);
  const placed = mapOf(next, "cellar").tokens!;
  assert.deepEqual(placed.map((p) => p.id).sort(), ["bram-token", "mira-token"]);
  assert.ok(placed.every((p) => Math.abs(p.column - 9.5) <= 2 && Math.abs(p.row - 5.5) <= 2), "around the ladder");
  // Options off: only what was asked.
  assert.deepEqual(partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "cellar"), { follow: false, placeTokens: true }, ids).map((s) => s.kind), ["map-tokens-place"]);
  assert.deepEqual(partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "upper"), { follow: true, placeTokens: true }, ids).map((s) => s.kind), ["tabletop-session"], "no grid: no tokens");
});

test("another place moves the party first; hidden maps never become the players' scene", () => {
  const t = fixture();
  const steps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "forest-map"), { follow: true, placeTokens: true }, ids);
  assert.deepEqual(steps.map((s) => s.kind), ["party-location", "map-tokens-place"]);
  const next = run(t, steps);
  assert.equal(readMarketLocations(next.journal?.market).currentLocationId, "forest");
  assert.equal(mapOf(next, "forest-map").tokens!.length, 2);
});

test("all or nothing: a refused party move leaves the tokens and the scene where they were", () => {
  const t = fixture();
  const steps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "forest-map"), { follow: true, placeTokens: true }, ids);
  // The party moved elsewhere since the menu opened: party-location refuses, so nothing applies.
  const moved = { ...t, journal: { ...t.journal!, market: { ...t.journal!.market!, currentLocationId: null } } } as CloudTable;
  assert.throws(() => run(moved, steps), /party moved elsewhere/);
  assert.equal(mapOf(moved, "keep").tokens!.length, 2);
  assert.equal(mapOf(moved, "forest-map").tokens!.length, 0);
  // A later step refused (a token already arrived) undoes the scene change too.
  const cellarSteps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "cellar"), { follow: true, placeTokens: true }, ids);
  const crowded = structuredClone(t);
  mapOf(crowded, "cellar").tokens = [{ ...ch("mira", 0, 0), id: "mira-elsewhere" }];
  assert.throws(() => run(crowded, cellarSteps));
  assert.equal(readTabletopSession(crowded).activeMapId, null);
});

test("device and room give the same result (shared engine)", () => {
  const t = fixture();
  const steps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "cellar"), { follow: true, placeTokens: true }, () => "fixed").map((s, i) => commandSchema.parse({ ...s, id: `p-${i}` }));
  const server = applyCommandBatch(t, dm, steps, () => ({ source: "server" })),
    device = applyCommandBatch(t, dm, steps, () => ({ source: "local" }));
  const without = (x: CloudTable) => ({ ...x.journal, events: x.journal!.events.map((e) => ({ ...e, at: 0 })) });
  assert.deepEqual(without(server), without(device));
});

test("summary before sending: who moves, the scene and the tokens at the entrance", async () => {
  const { partyMoveSummary } = await import("./party-move.ts");
  const t = fixture();
  const steps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "cellar"), { follow: true, placeTokens: true }, ids);
  assert.equal(partyMoveSummary(t, mapOf(t, "keep"), mapOf(t, "cellar"), steps), "The party moves to cellar · players' scene switches · 2 tokens placed at the trapdoor");
  const quiet = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "upper"), { follow: false, placeTokens: false }, ids);
  assert.equal(partyMoveSummary(t, mapOf(t, "keep"), mapOf(t, "upper"), quiet), "The party moves to upper");
});

test("a split party: one group moves with its own place, the others stay", async () => {
  const { partyGroupsFingerprint } = await import("./party-groups.ts");
  let t = fixture();
  t = applyCommandBatch(t, dm, [commandSchema.parse({ id: "split", kind: "party-split", before: partyGroupsFingerprint(t), groups: [{ id: "b", name: "Bram's band", colour: "blue", locationId: "town", memberIds: ["bram"] }] })], () => ({ source: "server" }));
  const steps = partyMoveCommands(t, mapOf(t, "keep"), mapOf(t, "forest-map"), { follow: false, placeTokens: true, groupId: "b" }, ids);
  assert.deepEqual(steps.map((s) => s.kind), ["party-location", "map-tokens-place"]);
  assert.equal((steps[0] as { groupId?: string }).groupId, "b");
  const next = run(t, steps);
  assert.equal(readMarketLocations(next.journal?.market).currentLocationId, "town", "the main group stays");
  assert.equal(next.journal!.world!.groups!.find((g) => g.id === "b")!.locationId, "forest");
  assert.deepEqual(mapOf(next, "forest-map").tokens!.map((x) => x.entityId), ["bram"]);
  assert.deepEqual(mapOf(next, "keep").tokens!.map((x) => x.entityId), ["mira"]);
});
