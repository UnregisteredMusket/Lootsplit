import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { campaignMapSchema, mapGridSchema, type MapToken } from "./world-schema.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import {
  footprintLabel,
  freeTokenPosition,
  sceneTokenPoint,
  shiftToken,
  snapTokenPosition,
  tokenBox,
  tokenCentre,
  tokenFootprint,
  tokenInsideGrid,
  tokenSnapped,
} from "./tabletop-geometry.ts";
import {
  CURRENT_TABLETOP_PROTOCOL,
  FOOTPRINT_PROTOCOL,
  VIEW_SECTIONS_PROTOCOL,
  centreFormToken,
  hasFootprintTokens,
  legacyTabletopToken,
  tabletopResponse,
  tableForProtocol,
  upgradeFootprintCommands,
} from "./tabletop-protocol.ts";

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = {
  id: "player",
  token: "player-token",
  name: "Player",
  role: "player",
  purseIds: ["hero"],
};
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const ogre: MapToken = {
  id: "ogre",
  kind: "other",
  label: "Ogre",
  column: 16,
  row: 5,
  visibility: "party",
  sizeClass: "large",
  anchor: "corner",
};
function fixture(settings: unknown = { playerMovement: true }, tokens: MapToken[] = []): CloudTable {
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
                controllerPurseIds: [],
              },
              ...tokens,
            ],
            tabletop: mapTabletopSchema.parse(settings),
          },
        ],
      },
    }),
  };
}
const map = (t: CloudTable) => t.journal!.world!.maps[0];
const token = (t: CloudTable, id: string) => map(t).tokens!.find((x) => x.id === id)!;
let seq = 0;
const act = (t: CloudTable, c: CommandInput, seat = dm) =>
  applyCommand(
    t,
    seat,
    commandSchema.parse({
      ...(c.kind === "map-token-move" ? { ...c, grid: canonicalJson(map(t).grid) } : c),
      id: `footprint-${++seq}`,
    }),
  );
const moveTo = (t: CloudTable, id: string, after: object, seat = dm) => {
  const x = token(t, id);
  return act(
    t,
    {
      kind: "map-token-move",
      mapId: "map",
      moves: [
        {
          tokenId: id,
          before: { column: x.column, row: x.row, offsetX: x.offsetX, offsetY: x.offsetY },
          after: after as { column: number; row: number },
        },
      ],
      ignoreWalls: false,
    },
    seat,
  );
};

test("sizes map to squares: Tiny a quarter, Small/Medium 1, Large 2, Huge 3, Gargantuan 4", () => {
  for (const [size, n] of [
    ["tiny", 0.25],
    ["small", 1],
    ["medium", 1],
    ["large", 2],
    ["huge", 3],
    ["gargantuan", 4],
  ] as const)
    assert.equal(tokenFootprint({ sizeClass: size }), n);
  assert.equal(tokenFootprint({}), 1);
  // The DM's custom squares win over the size.
  assert.equal(tokenFootprint({ sizeClass: "gargantuan", footprint: 6 }), 6);
});

test("the anchor is the top-left square; older tokens keep their centre square", () => {
  assert.deepEqual(tokenCentre(ogre), { x: 17, y: 6 });
  assert.deepEqual(tokenCentre({ column: 16, row: 5 }), { x: 16.5, y: 5.5 });
  assert.deepEqual(tokenBox({ ...ogre, sizeClass: "huge" }), { left: 16, top: 5, size: 3 });
  assert.equal(footprintLabel({ ...ogre, column: 18, row: 8 }), "col 19–20, row 9–10");
  assert.equal(footprintLabel({ column: 10, row: 6 }), "col 11, row 7");
  const p = sceneTokenPoint(grid, ogre);
  assert.equal(p.x, 17 / 20);
  assert.equal(p.y, 6 / 12);
});

test("snapping: the square under the grabbed point wins and the footprint stays inside", () => {
  const at = (col: number, row: number) => ({ x: col / 20, y: row / 12 });
  // Grabbed by the top-left square: the pointer square becomes the top-left.
  assert.deepEqual(snapTokenPosition(grid, ogre, at(10.4, 4.6), { x: 0.5, y: 0.5 }), {
    column: 10,
    row: 4,
  });
  // Grabbed by the lower-right square: the token doesn't jump under the finger.
  assert.deepEqual(snapTokenPosition(grid, ogre, at(10.4, 4.6), { x: 1.7, y: 1.2 }), {
    column: 9,
    row: 3,
  });
  // The whole footprint is kept inside the grid.
  assert.deepEqual(snapTokenPosition(grid, ogre, at(19.9, 11.9), { x: 0.2, y: 0.2 }), {
    column: 18,
    row: 10,
  });
  // Off the grid: no position.
  assert.equal(snapTokenPosition(grid, ogre, { x: 1.2, y: 0.5 }), undefined);
  // Tiny takes the quadrant under the pointer.
  assert.deepEqual(snapTokenPosition(grid, { sizeClass: "tiny" }, at(3.8, 2.1)), {
    column: 3,
    row: 2,
    offsetX: 0.25,
    offsetY: -0.25,
  });
  assert.equal(tokenSnapped({ column: 3, row: 2, offsetX: 0.25, offsetY: -0.25, sizeClass: "tiny" }), true);
  assert.equal(tokenSnapped({ column: 3, row: 2, sizeClass: "tiny" }), false);
  assert.equal(tokenSnapped({ ...ogre, offsetX: 0.5 }), false);
});

test("grid mode off keeps the exact point and the footprint inside the grid", () => {
  const place = freeTokenPosition(grid, ogre, { x: 10.3 / 20, y: 4.2 / 12 }, { x: 1, y: 1 })!;
  assert.deepEqual(tokenBox({ ...ogre, ...place }), { left: 9.3, top: 3.2, size: 2 });
  const legacy = freeTokenPosition(grid, {}, { x: 10.3 / 20, y: 4.2 / 12 })!;
  assert.deepEqual(tokenCentre(legacy), { x: 10.3, y: 4.2 });
  assert.deepEqual(shiftToken({ column: 2, row: 2, offsetX: 0.3 }, 1, 0), {
    column: 3,
    row: 2,
    offsetX: 0.3,
    offsetY: 0,
  });
});

test("the server refuses unsnapped and out-of-bounds footprint moves and never relocates", () => {
  const t = fixture({ playerMovement: true }, [ogre]);
  const moved = moveTo(t, "ogre", { column: 18, row: 8 });
  assert.deepEqual([token(moved, "ogre").column, token(moved, "ogre").row], [18, 8]);
  // Huge or Large footprints must fit: column 19 would cover columns 19-20 of a 20-column grid.
  assert.throws(() => moveTo(t, "ogre", { column: 19, row: 8 }), /inside the combat grid/);
  assert.throws(() => moveTo(t, "ogre", { column: 18, row: 11 }), /inside the combat grid/);
  // Grid mode on: offsets are refused, not rounded.
  assert.throws(
    () => moveTo(t, "ogre", { column: 10, row: 8, offsetX: 0.3, offsetY: 0 }),
    /snapped to the grid/,
  );
  // Tiny: a quadrant is required with grid mode on.
  const tiny = fixture({ playerMovement: true }, [
    { id: "rat", kind: "other", label: "Rat", column: 3, row: 3, offsetX: -0.25, offsetY: -0.25, visibility: "party", sizeClass: "tiny" },
  ]);
  assert.throws(() => moveTo(tiny, "rat", { column: 4, row: 3 }), /snapped/);
  assert.equal(token(moveTo(tiny, "rat", { column: 4, row: 3, offsetX: 0.25, offsetY: 0.25 }), "rat").column, 4);
  // Grid mode off: free positions inside the grid are accepted exactly.
  const free = fixture({ playerMovement: true, snap: false }, [ogre]);
  const next = moveTo(free, "ogre", { column: 10, row: 4, offsetX: 0.3, offsetY: -0.2 });
  assert.equal(token(next, "ogre").offsetX, 0.3);
});

test("a wide token must be corner-anchored and fit inside the grid when saved", () => {
  assert.throws(() =>
    campaignMapSchema.parse({ ...map(fixture()), tokens: [{ ...ogre, anchor: undefined }] }),
  );
  const t = fixture();
  assert.throws(
    () =>
      act(t, {
        kind: "map-token",
        mapId: "map",
        grid,
        tokenId: "ogre",
        before: null,
        token: { ...ogre, column: 19 },
      }),
    /fit inside/,
  );
  const saved = act(t, { kind: "map-token", mapId: "map", grid, tokenId: "ogre", before: null, token: ogre });
  assert.deepEqual(token(saved, "ogre"), ogre);
});

test("players move their own footprint tokens only with the same checks", () => {
  const mine: MapToken = { ...map(fixture()).tokens![0], sizeClass: "large", anchor: "corner" };
  const t = fixture({ playerMovement: true }, []);
  map(t).tokens = [mine, { ...ogre }];
  assert.equal(token(moveTo(t, "hero-token", { column: 4, row: 4 }, player), "hero-token").column, 4);
  assert.throws(() => moveTo(t, "ogre", { column: 4, row: 4 }, player), /cannot move/);
  assert.throws(() => moveTo(t, "hero-token", { column: 19, row: 4 }, player), /inside/);
});

test("fog: the footprint centre decides what a player sees and where they may move", () => {
  const fog = {
    enabled: true,
    base: "concealed",
    shapes: [{ id: "lit", kind: "rectangle", reveal: true, a: { x: 0, y: 0 }, b: { x: 0.5, y: 1 } }],
  };
  const t = fixture({ playerMovement: true, fog }, [{ ...ogre, column: 8, row: 2 }]);
  map(t).tokens![0] = { ...map(t).tokens![0], sizeClass: "large", anchor: "corner" };
  // The ogre's centre is at column 9 + 1 = 10 = x 0.5: on the revealed edge.
  assert.throws(() => moveTo(t, "hero-token", { column: 14, row: 4 }, player), /visible destination/);
  assert.equal(token(moveTo(t, "hero-token", { column: 6, row: 4 }, player), "hero-token").column, 6);
});

test("older clients receive footprint tokens in their centre form without the new fields", () => {
  const t = fixture({ playerMovement: true }, [
    ogre,
    { ...ogre, id: "golem", label: "Golem", sizeClass: "huge", column: 2, row: 6 },
    { id: "rat", kind: "other", label: "Rat", column: 3, row: 3, offsetX: -0.25, offsetY: 0.25, visibility: "party", sizeClass: "tiny" },
  ]);
  assert.equal(FOOTPRINT_PROTOCOL, 13);
  assert.equal(CURRENT_TABLETOP_PROTOCOL, FOOTPRINT_PROTOCOL);
  assert.ok(FOOTPRINT_PROTOCOL > VIEW_SECTIONS_PROTOCOL);
  assert.equal(tableForProtocol(t, FOOTPRINT_PROTOCOL), t);
  for (const protocol of [0, 1, 3, 10, 11]) {
    const old = tableForProtocol(t, protocol);
    const tokens = map(old).tokens!;
    for (const x of tokens) for (const key of ["sizeClass", "footprint", "anchor"]) assert.equal(key in x, false);
    const large = tokens.find((x) => x.id === "ogre")!;
    // Large at 16,5 covers 16-17: centre form is column 16 + half a square.
    assert.deepEqual([large.column, large.row], [16, 5]);
    if (protocol >= 1) assert.deepEqual([large.offsetX, large.offsetY], [0.5, 0.5]);
    // The centre point drawn by an older app is the footprint's true centre.
    if (protocol >= 1) assert.deepEqual(sceneTokenPoint(grid, large), sceneTokenPoint(grid, ogre));
    const huge = tokens.find((x) => x.id === "golem")!;
    assert.deepEqual([huge.column, huge.row, huge.offsetX], [3, 7, undefined]);
    // The stored table is unchanged.
    assert.equal(map(t).tokens!.find((x) => x.id === "ogre")!.anchor, "corner");
  }
  assert.equal(hasFootprintTokens(t), true);
  assert.equal(hasFootprintTokens(fixture()), false);
  // Archived reports are converted the same way.
  t.journal!.reports = [{ snapshot: JSON.stringify(fixture({}, [ogre])) } as never];
  const report = JSON.parse(tableForProtocol(t, 11).journal!.reports![0].snapshot);
  assert.equal(report.journal.world.maps[0].tokens[1].anchor, undefined);
});

test("older clients' pending drafts with footprint fields are refused with an update message", () => {
  const t = fixture({}, [ogre]);
  const draft = JSON.stringify([
    { kind: "map-token", mapId: "map", tokenId: "ogre", before: null, token: ogre },
  ]);
  for (const protocol of [0, 3, 10, 11])
    assert.throws(() => tabletopResponse({ table: t, draft }, protocol), /unfinished map actions/);
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft }, FOOTPRINT_PROTOCOL));
  // Other older-client drafts still load.
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft: "[]" }, 11));
});

test("an older client's centre-form move, token save and map save are applied in stored form", () => {
  const t = fixture({ playerMovement: true, snap: false }, [
    { ...ogre, sizeClass: "huge", column: 2, row: 2, locked: true },
  ]);
  const old = map(tableForProtocol(t, 11)).tokens!.find((x) => x.id === "ogre")!;
  // Move: centre form 3,3 -> 6,3 (a Huge token's centre square), applied as top-left 5,2.
  const [move] = upgradeFootprintCommands(t, [
    {
      id: "m",
      kind: "map-token-move",
      mapId: "map",
      grid: canonicalJson(grid),
      moves: [{ tokenId: "ogre", before: { column: old.column, row: old.row }, after: { column: 6, row: 3 } }],
      ignoreWalls: false,
    },
  ]);
  const moved = act(t, move as CommandInput);
  assert.deepEqual([token(moved, "ogre").column, token(moved, "ogre").row], [5, 2]);
  assert.equal(token(moved, "ogre").sizeClass, "huge");
  // Token save (protocol 1-11 form): before matches, fields are kept, position converted.
  const [save] = upgradeFootprintCommands(t, [
    { id: "s", kind: "map-token", mapId: "map", grid, tokenId: "ogre", before: old, token: { ...old, label: "Big ogre", column: 10 } },
  ]);
  const saved = act(t, save as CommandInput);
  assert.equal(token(saved, "ogre").label, "Big ogre");
  assert.deepEqual([token(saved, "ogre").column, token(saved, "ogre").anchor, token(saved, "ogre").locked], [9, "corner", true]);
  // Protocol 0 form: no tabletop fields; world.ts merges them back.
  const legacy = legacyTabletopToken(token(t, "ogre"));
  assert.equal("anchor" in legacy, false);
  const [save0] = upgradeFootprintCommands(t, [
    { id: "s0", kind: "map-token", mapId: "map", grid, tokenId: "ogre", before: legacy, token: { ...legacy, row: 6 } },
  ]);
  const saved0 = act(t, save0 as CommandInput);
  assert.deepEqual([token(saved0, "ogre").row, token(saved0, "ogre").sizeClass, token(saved0, "ogre").locked], [5, "huge", true]);
  // Map save keeps the footprint fields of tokens the older app can't see.
  const oldMap = map(tableForProtocol(t, 11));
  const [mapSave] = upgradeFootprintCommands(t, [
    { id: "ms", kind: "map-save", mapId: "map", before: oldMap, map: { ...oldMap, name: "Keep 2" } },
  ]);
  const savedMap = act(t, mapSave as CommandInput);
  assert.equal(map(savedMap).name, "Keep 2");
  assert.deepEqual(token(savedMap, "ogre"), token(t, "ogre"));
});

test("an older client can't express a snapped position for an even footprint and is told to update", () => {
  const t = fixture({ playerMovement: true }, [ogre]);
  const old = map(tableForProtocol(t, 11)).tokens!.find((x) => x.id === "ogre")!;
  assert.throws(
    () =>
      upgradeFootprintCommands(t, [
        {
          id: "m",
          kind: "map-token-move",
          mapId: "map",
          grid: canonicalJson(grid),
          moves: [{ tokenId: "ogre", before: { column: old.column, row: old.row, offsetX: 0.5, offsetY: 0.5 }, after: { column: 10, row: 3 } }],
          ignoreWalls: false,
        },
      ]),
    /Update Lootsplitter to move Ogre/,
  );
  // Commands about other tokens, and tables without footprints, are untouched.
  const plain = [{ id: "x", kind: "message", text: "hi" }];
  assert.equal(upgradeFootprintCommands(t, plain)[0], plain[0]);
  assert.equal(centreFormToken(map(t).tokens![0]), map(t).tokens![0]);
});

test("free offsets count toward the footprint bounds", () => {
  assert.equal(tokenInsideGrid(grid, { ...ogre, column: 18, row: 10 }), true);
  assert.equal(tokenInsideGrid(grid, { ...ogre, column: 18, row: 10, offsetX: 0.1 }), false);
  assert.equal(tokenInsideGrid(grid, { ...ogre, column: 0, row: 0, offsetX: -0.1 }), false);
});
