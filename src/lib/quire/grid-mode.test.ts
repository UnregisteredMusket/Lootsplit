import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, commandSchema, type CommandInput } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { mapGridSchema, type MapToken } from "./world-schema.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import { alignUndoMap, readMapTabletop } from "./tabletop.ts";
import {
  alignedGrid,
  automaticGrid,
  nearestSnapped,
  sceneTokenPoint,
  tokenSnapped,
} from "./tabletop-geometry.ts";
import {
  CURRENT_TABLETOP_PROTOCOL,
  GRID_MODE_PROTOCOL,
  tableForProtocol,
  tabletopResponse,
  upgradeOldClientCommands,
} from "./tabletop-protocol.ts";

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
const player: CloudSeat = { id: "p", token: "p-token", name: "P", role: "player", purseIds: ["hero"] };
const grid = mapGridSchema.parse({ columns: 20, rows: 12 });
const loose: MapToken[] = [
  { id: "a", kind: "other", label: "A", column: 3, row: 3, offsetX: 0.3, offsetY: -0.2, visibility: "party" },
  { id: "b", kind: "other", label: "B", column: 6, row: 2, offsetX: 0.4, offsetY: 0.35, visibility: "party", sizeClass: "large", anchor: "corner" },
  { id: "c", kind: "other", label: "C", column: 9, row: 9, visibility: "party" },
];
function fixture(settings: object = { snap: false }, tokens = loose): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [{ id: "hero", kind: "character", name: "Hero", coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }],
    journal: readJournal({
      world: {
        maps: [
          {
            id: "map",
            name: "Keep",
            image: "data:image/png;base64,AAAA",
            locationId: null,
            visible: true,
            anchors: [],
            markers: [],
            grid,
            tokens,
            tabletop: mapTabletopSchema.parse(settings),
          },
        ],
      },
    }),
  };
}
const map = (t: CloudTable) => t.journal!.world!.maps[0];
let seq = 0;
const act = (t: CloudTable, c: CommandInput, seat = dm) =>
  applyCommand(t, seat, commandSchema.parse({ ...c, id: `grid-${++seq}` }));
const place = <T extends object>(t: T, p: { offsetX?: number; offsetY?: number }) => {
  const r = { ...t, ...p } as T & { offsetX?: number; offsetY?: number };
  if (p.offsetX === undefined) delete r.offsetX;
  if (p.offsetY === undefined) delete r.offsetY;
  return r;
};
const pos = (t: MapToken) => ({ column: t.column, row: t.row, offsetX: t.offsetX, offsetY: t.offsetY });
const snapAll = (t: CloudTable) => {
  const moves = map(t)
    .tokens!.filter((x) => !tokenSnapped(x))
    .map((x) => ({ tokenId: x.id, before: pos(x), after: nearestSnapped(grid, x) }));
  return {
    moves,
    command: {
      kind: "map-grid-snap",
      mapId: "map",
      grid: canonicalJson(grid),
      before: map(t).tabletop ?? null,
      snap: true,
      moves,
    } as CommandInput,
  };
};

test("nearest squares move each token at most half a square and keep footprints inside", () => {
  for (const token of loose) {
    const next = place(token, nearestSnapped(grid, token));
    assert.ok(tokenSnapped(next));
    const a = sceneTokenPoint(grid, token),
      b = sceneTokenPoint(grid, next);
    assert.ok(Math.abs(a.x - b.x) * grid.columns <= 0.5 + 1e-9);
    assert.ok(Math.abs(a.y - b.y) * grid.rows <= 0.5 + 1e-9);
  }
  // A Large token at the right edge is kept inside.
  assert.deepEqual(nearestSnapped(grid, { column: 18, row: 0, offsetX: 0.4, sizeClass: "large", anchor: "corner" }), { column: 18, row: 0 });
  // Tiny takes the nearest quadrant.
  assert.deepEqual(nearestSnapped(grid, { column: 2, row: 2, offsetX: 0.1, offsetY: -0.4, sizeClass: "tiny" }), { column: 2, row: 2, offsetX: 0.25, offsetY: -0.25 });
});

test("grid mode on snaps every token in one DM command, and Undo restores them", () => {
  const t = fixture();
  const { command, moves } = snapAll(t);
  const on = act(t, command);
  assert.equal(readMapTabletop(map(on)).snap, true);
  assert.ok(map(on).tokens!.every(tokenSnapped));
  assert.equal(map(on).tokens!.find((x) => x.id === "c")!.column, 9, "snapped tokens are untouched");
  const undo = act(on, {
    kind: "map-grid-snap",
    mapId: "map",
    grid: canonicalJson(grid),
    before: map(on).tabletop!,
    snap: false,
    moves: moves.map((m) => ({ tokenId: m.tokenId, before: m.after, after: m.before })),
  });
  assert.equal(readMapTabletop(map(undo)).snap, false);
  assert.deepEqual(map(undo).tokens, map(t).tokens);
  // The same command twice is refused: the map changed in between (revision check).
  assert.throws(() => act(on, command), /Map configuration changed/);
});

test("grid mode snap refuses players, stale tokens, unsnapped targets and a changed grid", () => {
  const t = fixture();
  const { command } = snapAll(t);
  assert.throws(() => act(t, command, player), /Only the DM/);
  const c = command as Extract<CommandInput, { kind: "map-grid-snap" }>;
  assert.throws(
    () => act(t, { ...c, moves: [{ ...c.moves[0], before: { column: 0, row: 0 } }] }),
    /moved or changed/,
  );
  assert.throws(
    () => act(t, { ...c, moves: [{ ...c.moves[0], after: { column: 3, row: 3, offsetX: 0.2 } }] }),
    /on a square/,
  );
  assert.throws(() => act(t, { ...c, grid: canonicalJson({ ...grid, columns: 21 }) }), /grid changed/);
});

test("turning grid mode off never moves a token", () => {
  const t = fixture({ snap: true }, loose.map((x) => place(x, nearestSnapped(grid, x))));
  const off = act(t, {
    kind: "map-tabletop",
    mapId: "map",
    before: map(t).tabletop!,
    settings: { ...readMapTabletop(map(t)), snap: false },
  });
  assert.equal(readMapTabletop(map(off)).snap, false);
  assert.deepEqual(map(off).tokens, map(t).tokens);
});

test("aligning the grid keeps every token exactly where it is on the image", () => {
  const tokens: MapToken[] = [
    { id: "a", kind: "other", label: "A", column: 3, row: 3, offsetX: 0.3, offsetY: 0.3, visibility: "party" },
    { id: "b", kind: "other", label: "B", column: 6, row: 2, offsetX: 0.32, offsetY: 0.28, visibility: "party", sizeClass: "large", anchor: "corner" },
  ];
  const g = { ...grid, x: 0.05, width: 0.9, y: 0.05, height: 0.9 };
  const result = alignedGrid(g, tokens)!;
  for (const token of tokens) {
    const after = result.tokens.find((x) => x.id === token.id)!;
    const a = sceneTokenPoint(g, token),
      b = sceneTokenPoint(result.grid, after);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `${token.id} stays put`);
  }
  // Most tokens now sit near a square: the shared offset was taken up by the grid.
  assert.ok(result.tokens.every((x) => Math.abs(x.offsetX ?? 0) < 0.05));
  assert.ok(result.grid.x + result.grid.width <= 1 && result.grid.x >= 0);
});

test("ungridded maps get an automatic grid of about 40 px squares, or 5 ft from a scale bar", () => {
  const auto = automaticGrid({ width: 1200, height: 800 });
  assert.equal(auto.columns, 30);
  assert.equal(auto.rows, 20);
  assert.ok(Math.abs(auto.height - 1) < 1e-9);
  const scaled = automaticGrid(
    { width: 1000, height: 500 },
    { a: { x: 0, y: 0.5 }, b: { x: 0.5, y: 0.5 }, distance: 50, unit: "ft", aspect: 2 },
  );
  // 50 ft across half the image: 100 ft wide, 20 squares of 5 ft.
  assert.equal(scaled.columns, 20);
  assert.equal(scaled.rows, 10);
  assert.equal(mapGridSchema.safeParse(auto).success, true);
});

test("protocol 14: older clients don't see the hidden-grid flag and their saves keep it", () => {
  assert.equal(GRID_MODE_PROTOCOL, 14);
  assert.ok(CURRENT_TABLETOP_PROTOCOL >= GRID_MODE_PROTOCOL);
  const t = fixture({ snap: false, gridHidden: true });
  assert.equal(map(tableForProtocol(t, 14)).tabletop!.gridHidden, true);
  const old = tableForProtocol(t, 13);
  assert.equal("gridHidden" in map(old).tabletop!, false);
  assert.equal(map(t).tabletop!.gridHidden, true, "the stored table is unchanged");
  // An older client's scene save is compared without the flag and keeps it.
  const [command] = upgradeOldClientCommands(
    t,
    [{ id: "x", kind: "map-tabletop", mapId: "map", before: map(old).tabletop, settings: { ...map(old).tabletop!, playerMovement: true } }],
    12,
  );
  const saved = act(t, command as CommandInput);
  assert.equal(map(saved).tabletop!.gridHidden, true);
  assert.equal(map(saved).tabletop!.playerMovement, true);
  // Pending grid mode drafts ask older clients to finish on the updated website.
  for (const draft of [[{ kind: "map-grid-snap" }], [{ kind: "map-tabletop", settings: { gridHidden: true } }]])
    assert.throws(() => tabletopResponse({ table: t, draft: JSON.stringify(draft) }, 13), /unfinished map actions/);
  assert.doesNotThrow(() => tabletopResponse({ table: t, draft: JSON.stringify([{ kind: "map-grid-snap" }]) }, 14));
});

// Privacy review 2026-10-29 (finding A2): the align-grid Undo never erases later changes.
test("align-grid Undo restores the grid only while nothing changed since the align", () => {
  const player: CloudSeat = { id: "p", token: "p", name: "P", role: "player", purseIds: ["mira"] };
  const tok: MapToken = { id: "tv", kind: "character", entityId: "torvald", label: "torvald", column: 4, row: 4, offsetX: 0.3, offsetY: 0.3, visibility: "party" };
  let t: CloudTable = {
    ...emptyCloudTable(),
    purses: ["mira", "torvald"].map((id) => ({ id, kind: "character" as const, name: id, coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } })),
    journal: readJournal({ world: { maps: [{ id: "m", name: "M", image: "data:image/png;base64,AAAA", locationId: null, visible: true, anchors: [], markers: [], grid: mapGridSchema.parse({ columns: 20, rows: 12 }), tokens: [tok], tabletop: { ...readMapTabletop({}), snap: false } }] } }),
  };
  const run = (c: object, seat: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] }) =>
    (t = applyCommand(t, seat, commandSchema.parse({ ...c, id: `align-${Math.random()}` })));
  const previous = t.journal!.world!.maps[0];
  const aligned = alignedGrid(previous.grid!, previous.tokens!)!;
  const next = { ...previous, grid: aligned.grid, tokens: aligned.tokens, tabletop: { ...readMapTabletop(previous), snap: true } };
  run({ kind: "map-save", mapId: "m", before: previous, map: next });
  // Nothing changed: Undo restores the grid and the tokens' places.
  const restored = alignUndoMap(t.journal!.world!.maps[0], next, previous)!;
  assert.ok(restored);
  assert.deepEqual(restored.grid, previous.grid);
  assert.equal(readMapTabletop(restored).snap, false);
  // A token moves after the align: Undo is no longer available, so the move stays.
  const placed = t.journal!.world!.maps[0].tokens![0];
  const at = { column: placed.column, row: placed.row, ...(placed.offsetX !== undefined ? { offsetX: placed.offsetX } : {}), ...(placed.offsetY !== undefined ? { offsetY: placed.offsetY } : {}) };
  run({ kind: "map-token-move", mapId: "m", grid: canonicalJson(t.journal!.world!.maps[0].grid), moves: [{ tokenId: "tv", before: at, after: { column: placed.column + 1, row: placed.row } }] });
  assert.equal(alignUndoMap(t.journal!.world!.maps[0], next, previous), undefined);
  assert.equal(t.journal!.world!.maps[0].tokens![0].column, placed.column + 1);
  void player;
});
