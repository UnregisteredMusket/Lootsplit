import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal, preserveJournalMetadata } from "./journal.ts";
import { legacyTabletopMap, legacyTabletopToken, tabletopResponse } from "./tabletop-protocol.ts";
import { campaignMapSchema, mapGridSchema } from "./world-schema.ts";
import { mapTabletopSchema, tabletopSessionSchema, areaTemplateSchema } from "./tabletop-schema.ts";
import {
  concealedMapImage,
  readMapTabletop,
  readTabletopSession,
  sceneViewers,
} from "./tabletop.ts";
import {
  blocked,
  manuallyVisible,
  scenePointVisible,
  sceneDistance,
  sceneTokenPoint,
  inAreaTemplate,
} from "./tabletop-geometry.ts";
import { projectRecord } from "./session-records.ts";
import { canonicalJson } from "./canonical-json.ts";
import { readArchiveResult } from "./archive-reader.ts";

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player-token",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
const grid = mapGridSchema.parse({ columns: 10, rows: 10 });
let seq = 0;
function fixture(settings?: unknown): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: ["hero", "other"].map((id) => ({
      id,
      kind: "character" as const,
      name: id,
      coins: { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 },
    })),
    journal: readJournal({
      world: {
        maps: [
          {
            id: "map",
            name: "Keep",
            image: "data:image/png;base64,cHJpdmF0ZS1zb3VyY2U=",
            locationId: null,
            visible: true,
            anchors: [],
            markers: [],
            grid,
            tokens: [
              {
                id: "hero-token",
                kind: "character",
                entityId: "hero",
                label: "Hero",
                column: 1,
                row: 1,
                visibility: "party",
              },
              {
                id: "other-token",
                kind: "character",
                entityId: "other",
                label: "Other",
                column: 5,
                row: 5,
                visibility: "party",
              },
            ],
            ...(settings ? { tabletop: mapTabletopSchema.parse(settings) } : {}),
          },
        ],
      },
    }),
  };
}
const map = (t: CloudTable) => t.journal!.world!.maps[0];
const act = (t: CloudTable, c: CommandInput, seat = dm) =>
  applyCommand(
    t,
    seat,
    c.kind === "map-token-move"
      ? { ...c, grid: canonicalJson(map(t).grid), id: `tabletop-${++seq}` }
      : { ...c, id: `tabletop-${++seq}` },
  );
const move = (id = "hero-token", column = 2, row = 1) => ({
  tokenId: id,
  before: { column: id === "hero-token" ? 1 : 5, row: id === "hero-token" ? 1 : 5 },
  after: { column, row },
});

test("legacy maps retain their exact optional fields and TV defaults off", () => {
  const t = fixture();
  assert.deepEqual(campaignMapSchema.parse(map(t)), map(t));
  assert.equal(map(t).tabletop, undefined);
  assert.equal(readTabletopSession(t).tvEnabled, false);
  assert.equal(readMapTabletop(map(t)).playerMovement, false);
});
test("older clients retain pending token locks, free-placement offsets and advanced before-state", () => {
  for (const value of [
    { token: { locked: false } },
    { token: { offsetX: 0.2 } },
    { before: { vision: { enabled: true } } },
  ])
    assert.throws(
      () =>
        tabletopResponse({
          table: fixture(),
          draft: JSON.stringify([{ kind: "map-token", ...value }]),
        }),
      /unfinished map actions/,
    );
});
test("client display retains the server's visible tokens without recomputing from redacted geometry", () => {
  const table = fixture({
    fog: {
      enabled: true,
      base: "concealed",
      shapes: [
        { id: "reveal", kind: "rectangle", reveal: true, a: { x: 0, y: 0 }, b: { x: 0.4, y: 0.4 } },
      ],
    },
  });
  const projected = projectRecord(table, player);
  assert.equal(map(projected).tokens!.length, 1);
  assert.equal(map(projected).tabletop!.fog.shapes.length, 0);
  const displayed = projectRecord(projected, player, { tabletopProjected: true });
  assert.equal(map(displayed).tokens!.length, 1);
  assert.equal(map(displayed).image, concealedMapImage);
  assert.equal(map(displayed).tabletop!.walls.length, 0);
  const archive = readArchiveResult(
    { snapshot: JSON.stringify(projected) },
    { ...player, tabletopProjected: true },
  );
  assert.equal(archive.available, true);
  if (archive.available) assert.equal(map(archive.snapshot).tokens!.length, 1);
});
test("only explicitly permitted assigned tokens move; wealth and source input stay unchanged", () => {
  const denied = fixture();
  assert.throws(
    () =>
      act(
        denied,
        { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: false },
        player,
      ),
    /cannot move/,
  );
  const t = fixture({ playerMovement: true }),
    before = structuredClone(t);
  const next = act(
    t,
    { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: false },
    player,
  );
  assert.equal(map(next).tokens![0].column, 2);
  assert.deepEqual(t, before);
  for (const key of ["purses", "holdings", "ledger", "shops", "stock"] as const)
    assert.deepEqual(next[key], t[key]);
  assert.throws(
    () =>
      act(
        t,
        { kind: "map-token-move", mapId: "map", moves: [move("other-token")], ignoreWalls: false },
        player,
      ),
    /cannot move/,
  );
});
test("multi-token moves reject stale, unowned, duplicate and out-of-bounds members atomically", () => {
  const t = fixture({ playerMovement: true }),
    before = structuredClone(t);
  for (const moves of [
    [move(), move("other-token")],
    [move(), move()],
    [{ ...move(), before: { column: 0, row: 0 } }],
    [move("hero-token", 20, 0)],
  ]) {
    assert.throws(() =>
      act(t, { kind: "map-token-move", mapId: "map", moves, ignoreWalls: false }, player),
    );
    assert.deepEqual(t, before);
  }
  map(t).tokens![0].locked = true;
  assert.throws(
    () =>
      act(t, { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: false }, player),
    /cannot move/,
  );
  assert.equal(
    map(act(t, { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: false }))
      .tokens![0].column,
    2,
  );
});
test("barriers require explicit configuration and only a DM may override them", () => {
  const t = fixture({
    playerMovement: true,
    walls: [
      { id: "door", a: { x: 0.2, y: 0 }, b: { x: 0.2, y: 1 }, kind: "door", blocksMovement: true },
    ],
  });
  assert.throws(
    () =>
      act(t, { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: false }, player),
    /barrier/,
  );
  assert.throws(
    () =>
      act(t, { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: true }, player),
    /Only the DM/,
  );
  assert.equal(
    map(act(t, { kind: "map-token-move", mapId: "map", moves: [move()], ignoreWalls: true }))
      .tokens![0].column,
    2,
  );
});
test("precise free placement is optional and snaps remain enforced authoritatively", () => {
  const m = { ...move(), after: { column: 2, row: 1, offsetX: 0.2, offsetY: -0.3 } };
  assert.throws(
    () =>
      act(
        fixture({ playerMovement: true }),
        { kind: "map-token-move", mapId: "map", moves: [m], ignoreWalls: false },
        player,
      ),
    /snapped/,
  );
  const next = act(
    fixture({ playerMovement: true, snap: false }),
    { kind: "map-token-move", mapId: "map", moves: [m], ignoreWalls: false },
    player,
  );
  assert.deepEqual(sceneTokenPoint(grid, map(next).tokens![0]), { x: 0.27, y: 0.12 });
});
test("fog operations preserve ordered reveals, concealment, stale checks and undo/redo", () => {
  let t = fixture();
  const fog = () => readMapTabletop(map(t)).fog;
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(), action: "enable" });
  assert.equal(manuallyVisible({ x: 0.15, y: 0.15 }, fog()), false);
  const before = structuredClone(fog());
  t = act(t, {
    kind: "map-fog",
    mapId: "map",
    before,
    action: "shape",
    shape: {
      id: "room",
      kind: "rectangle",
      reveal: true,
      a: { x: 0, y: 0 },
      b: { x: 0.3, y: 0.3 },
    },
  });
  assert.equal(manuallyVisible({ x: 0.15, y: 0.15 }, fog()), true);
  assert.throws(
    () => act(t, { kind: "map-fog", mapId: "map", before, action: "reveal-all" }),
    /Exploration changed/,
  );
  assert.throws(
    () => act(t, { kind: "map-fog", mapId: "map", before: fog(), action: "conceal-all" }, player),
    /Only the DM/,
  );
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(), action: "undo" });
  assert.equal(manuallyVisible({ x: 0.15, y: 0.15 }, fog()), false);
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(), action: "redo" });
  assert.equal(manuallyVisible({ x: 0.15, y: 0.15 }, fog()), true);
  t = act(t, { kind: "map-fog", mapId: "map", before: fog(), action: "conceal-all" });
  assert.equal(manuallyVisible({ x: 0.15, y: 0.15 }, fog()), false);
});
test("player projection withholds original pixels, hidden geometry, fog history and concealed tokens", () => {
  const t = fixture({
    playerMovement: true,
    fog: {
      enabled: true,
      base: "concealed",
      shapes: [
        {
          id: "secret-room-shape",
          kind: "rectangle",
          reveal: true,
          a: { x: 0, y: 0 },
          b: { x: 0.3, y: 0.3 },
        },
      ],
    },
    walls: [{ id: "secret-wall", a: { x: 0.4, y: 0 }, b: { x: 0.4, y: 1 } }],
  });
  const projected = projectRecord(t, player),
    result = JSON.stringify(projected);
  assert.equal(map(projected).image, concealedMapImage);
  assert.ok(!result.includes("cHJpdmF0ZS1zb3VyY2U="));
  assert.ok(!result.includes("secret-room-shape"));
  assert.ok(!result.includes("secret-wall"));
  assert.deepEqual(
    map(projected).tokens!.map((t) => t.id),
    ["hero-token"],
  );
  assert.equal(map(projectRecord(t, dm)).image, map(t).image);
});
test("individual vision uses assigned visible characters, walls, doors and configured darkness", () => {
  const t = fixture({ vision: "individual", ambientLight: false });
  const settings = readMapTabletop(map(t)),
    viewers = sceneViewers(t, map(t), player);
  assert.equal(viewers.length, 1);
  const p = { x: 0.3, y: 0.15 };
  assert.equal(scenePointVisible(p, settings, grid, viewers), false);
  settings.lights = [
    { id: "torch", at: viewers[0].point, radiusFeet: 20, color: "#ffbb55", visible: true },
  ];
  assert.equal(scenePointVisible(p, settings, grid, viewers), true);
  settings.walls = [
    {
      id: "door",
      a: { x: 0.2, y: 0 },
      b: { x: 0.2, y: 1 },
      kind: "door",
      open: false,
      blocksSight: true,
      blocksMovement: false,
    },
  ];
  assert.equal(scenePointVisible(p, settings, grid, viewers), false);
  settings.walls[0].open = true;
  assert.equal(scenePointVisible(p, settings, grid, viewers), true);
  settings.fog = { enabled: true, base: "concealed", shapes: [] };
  assert.equal(scenePointVisible(p, settings, grid, viewers), false);
});
test("scene activation is deliberate and shared; player browsing policy is enforced in projections", () => {
  let t = fixture();
  t.journal!.world!.maps.push({ ...structuredClone(map(t)), id: "second", name: "Second" });
  t = act(t, {
    kind: "tabletop-session",
    before: null,
    session: tabletopSessionSchema.parse({ activeMapId: "map", playerBrowsing: false }),
  });
  assert.deepEqual(
    projectRecord(t, player).journal!.world!.maps.map((m) => m.id),
    ["map"],
  );
  assert.equal(readTabletopSession(t).tvEnabled, false);
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "tabletop-session",
          before: t.journal!.world!.tabletop!,
          session: tabletopSessionSchema.parse({ tvEnabled: true }),
        },
        player,
      ),
    /Only the DM/,
  );
  map(t).visible = false;
  assert.throws(
    () =>
      act(t, {
        kind: "tabletop-session",
        before: t.journal!.world!.tabletop!,
        session: t.journal!.world!.tabletop!,
      }),
    /shared map/,
  );
});
test("templates are permission-controlled, stale checked and have no financial effects", () => {
  const t = fixture({ playerTemplates: true });
  const template = areaTemplateSchema.parse({
    id: "area",
    kind: "cone",
    origin: { x: 0.15, y: 0.15 },
    distanceFeet: 15,
    controllerPurseId: "hero",
  });
  const next = act(
    t,
    { kind: "map-template", mapId: "map", templateId: "area", before: null, template },
    player,
  );
  assert.equal(readMapTabletop(map(next)).templates.length, 1);
  assert.deepEqual(next.purses, t.purses);
  assert.throws(
    () =>
      act(
        next,
        { kind: "map-template", mapId: "map", templateId: "area", before: null, template },
        player,
      ),
    /changed/,
  );
  assert.throws(
    () =>
      act(
        t,
        {
          kind: "map-template",
          mapId: "map",
          templateId: "area",
          before: null,
          template: { ...template, controllerPurseId: "other" },
        },
        player,
      ),
    /cannot edit/,
  );
});
test("measurements and templates respect cropped rectangular grids without imposing combat rules", () => {
  const g = { ...grid, columns: 10, rows: 5, x: 0.1, y: 0.2, width: 0.8, height: 0.5 };
  assert.ok(
    Math.abs(
      sceneDistance(g, { x: 0.1, y: 0.2 }, { x: 0.18, y: 0.3 }, "euclidean") - Math.sqrt(50),
    ) < 1e-8,
  );
  const circle = areaTemplateSchema.parse({
    id: "circle",
    kind: "circle",
    origin: { x: 0.5, y: 0.5 },
    distanceFeet: 10,
  });
  assert.equal(inAreaTemplate({ x: 0.6, y: 0.5 }, circle, grid), true);
  assert.equal(inAreaTemplate({ x: 0.9, y: 0.5 }, circle, grid), false);
  const cone = { ...circle, kind: "cone" as const, direction: 90, angle: 60 };
  assert.equal(inAreaTemplate({ x: 0.5, y: 0.6 }, cone, grid), true);
  assert.equal(inAreaTemplate({ x: 0.6, y: 0.5 }, cone, grid), false);
  assert.equal(
    blocked({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, [
      {
        id: "wall",
        a: { x: 0.5, y: 0.5 },
        b: { x: 0.5, y: 1 },
        kind: "wall",
        open: false,
        blocksSight: true,
        blocksMovement: false,
      },
    ]),
    true,
  );
});

test("legacy envelopes retain protected imagery while omitting unsupported strict-schema fields", () => {
  const t = fixture({ playerMovement: true, fog: { enabled: true } });
  map(t).tokens![0].locked = true;
  const response = { table: projectRecord(t, player), draft: "[]" };
  const old = tabletopResponse(response);
  assert.equal(map(old.table).tabletop, undefined);
  assert.equal(map(old.table).image, concealedMapImage);
  assert.ok(!JSON.stringify(old).includes('"locked"'));
  assert.ok(!JSON.stringify(old).includes("cHJpdmF0ZS1zb3VyY2U="));
  assert.ok(map(tabletopResponse(response, 1).table).tabletop);
  const pending = { ...response, draft: JSON.stringify([{ kind: "map-token-move" }]) };
  assert.throws(() => tabletopResponse(pending), /unfinished map actions/);
  assert.equal(tabletopResponse(pending, 1).draft, pending.draft);
});
test("older DM map/token writes preserve new configuration, locks, control and vision", () => {
  let t = fixture({ playerMovement: true });
  map(t).tokens![0].locked = true;
  map(t).tokens![0].controllerPurseIds = ["hero"];
  const old = legacyTabletopMap(map(t));
  t = act(t, {
    kind: "map-save",
    mapId: "map",
    before: old,
    map: { ...old, name: "Renamed on older app" },
  });
  assert.equal(readMapTabletop(map(t)).playerMovement, true);
  assert.equal(map(t).tokens![0].locked, true);
  const token = legacyTabletopToken(map(t).tokens![0]);
  t = act(t, {
    kind: "map-token",
    mapId: "map",
    grid,
    tokenId: token.id,
    before: token,
    token: { ...token, column: 3 },
  });
  assert.equal(map(t).tokens!.find((v) => v.id === token.id)!.column, 3);
  assert.equal(map(t).tokens!.find((v) => v.id === token.id)!.locked, true);
  assert.deepEqual(map(t).tokens!.find((v) => v.id === token.id)!.controllerPurseIds, ["hero"]);
  const oldJournal = structuredClone(t.journal!);
  delete oldJournal.world!.tabletop;
  oldJournal.world!.maps = oldJournal.world!.maps.map(legacyTabletopMap);
  const restored = preserveJournalMetadata(oldJournal, t.journal!);
  assert.deepEqual(restored.world!.maps[0].tabletop, map(t).tabletop);
});
