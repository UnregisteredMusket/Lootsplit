import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand } from "./commands.ts";
import { readJournal } from "./journal.ts";
import { canonicalJson } from "./canonical-json.ts";
import { mapGridSchema, type MapGrid } from "./world-schema.ts";
import { mapTabletopSchema } from "./tabletop-schema.ts";
import { diagonalTiles, sceneDistance, sceneRouteDistance } from "./tabletop-geometry.ts";
import { routeDistance, routePosition, tileDistance, tilePoint } from "./map-tiles.ts";
import { legacyDiagonals, tableForProtocol, tabletopResponse } from "./tabletop-protocol.ts";

const grid = (diagonal: MapGrid["diagonal"]): MapGrid =>
  mapGridSchema.parse({ columns: 20, rows: 20, diagonal });
const at = (column: number, row: number) => ({ column, row });

test("the alternating rule counts 5/10/5 and old rules are unchanged", () => {
  const alternating = grid("alternating");
  // 1, 2, 3 and 4 diagonal steps: 5, 15, 20, 30 ft.
  assert.deepEqual(
    [1, 2, 3, 4].map((n) => tileDistance(alternating, at(0, 0), at(n, n))),
    [5, 15, 20, 30],
  );
  // Straight steps cost one tile; mixed moves count only their diagonal part twice.
  assert.equal(tileDistance(alternating, at(0, 0), at(6, 0)), 30);
  assert.equal(tileDistance(alternating, at(1, 1), at(4, 5)), 25); // 3 diagonal + 1 straight
  assert.equal(tileDistance(alternating, at(4, 5), at(1, 1)), 25);
  // Existing rules give their previous answers.
  assert.equal(tileDistance(grid("equal"), at(1, 1), at(4, 5)), 20);
  assert.equal(tileDistance(grid("orthogonal"), at(1, 1), at(4, 5)), 35);
  assert.equal(tileDistance(grid("euclidean"), at(1, 1), at(4, 5)), 25);
  // An old grid without the field still defaults to one tile per diagonal.
  assert.equal(mapGridSchema.parse({ columns: 5, rows: 5 }).diagonal, "equal");
  assert.deepEqual(diagonalTiles(3, 4, "equal"), { tiles: 4, carry: 0 });
});

test("the alternation continues across waypoints for routes and measurements", () => {
  const alternating = grid("alternating");
  // Two single diagonal legs are the same as one two-step diagonal: 5 + 10.
  assert.equal(routeDistance(alternating, [at(0, 0), at(1, 1), at(2, 2)]), 15);
  assert.equal(routeDistance(alternating, [at(0, 0), at(1, 1), at(3, 1), at(4, 2)]), 5 + 10 + 10);
  assert.equal(routeDistance(grid("equal"), [at(0, 0), at(1, 1), at(2, 2)]), 10);
  // Route progress uses the same leg lengths.
  const route = { grid: alternating, points: [at(0, 0), at(1, 1), at(2, 2)] };
  const third = routePosition(route, 1 / 3),
    end = tilePoint(alternating, at(1, 1));
  assert.ok(Math.abs(third.x - end.x) < 1e-12 && Math.abs(third.y - end.y) < 1e-12);
  // Scene measurement (normalized points at tile centres).
  const p = (column: number, row: number) => tilePoint(alternating, at(column, row));
  assert.equal(sceneDistance(alternating, p(0, 0), p(2, 2)), 15);
  assert.equal(sceneRouteDistance(alternating, [p(0, 0), p(1, 1), p(2, 2), p(3, 3)]), 20);
  assert.equal(sceneRouteDistance(grid("equal"), [p(0, 0), p(1, 1), p(2, 2), p(3, 3)]), 15);
  // Vision ranges keep using straight-line distance.
  assert.ok(Math.abs(sceneDistance(alternating, p(0, 0), p(3, 4), "euclidean") - 25) < 1e-9);
});

const dm: CloudSeat = { id: "dm", token: "dm-token", name: "DM", role: "dm", purseIds: [] };
function table(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        kind: "character" as const,
        name: "Hero",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
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
            grid: grid("alternating"),
            tokens: [
              {
                id: "t",
                kind: "character",
                entityId: "hero",
                label: "Hero",
                column: 1,
                row: 1,
                visibility: "party",
              },
            ],
            tabletop: mapTabletopSchema.parse({}),
          },
        ],
      },
    }),
  };
}

test("older apps see an alternating grid as one tile per diagonal and cannot erase it", () => {
  const t = table();
  const legacy = tableForProtocol(t, 2);
  assert.equal(legacy.journal!.world!.maps[0].grid!.diagonal, "equal");
  assert.equal(tableForProtocol(t, 0).journal!.world!.maps[0].grid!.diagonal, "equal");
  assert.equal(tableForProtocol(t, 3).journal!.world!.maps[0].grid!.diagonal, "alternating");
  assert.equal(t.journal!.world!.maps[0].grid!.diagonal, "alternating", "stored grid unchanged");
  // Its save of the unchanged grid keeps the alternating rule.
  const before = legacy.journal!.world!.maps[0];
  const saved = applyCommand(t, dm, {
    id: "legacy-save",
    kind: "map-save",
    mapId: "map",
    before,
    map: { ...before, name: "Renamed keep" },
  });
  assert.equal(saved.journal!.world!.maps[0].name, "Renamed keep");
  assert.equal(saved.journal!.world!.maps[0].grid!.diagonal, "alternating");
  // Its token moves use the grid fingerprint it can see.
  const moved = applyCommand(t, dm, {
    id: "legacy-move",
    kind: "map-token-move",
    mapId: "map",
    grid: canonicalJson(before.grid),
    moves: [{ tokenId: "t", before: { column: 1, row: 1 }, after: { column: 2, row: 2 } }],
    ignoreWalls: false,
  });
  assert.equal(moved.journal!.world!.maps[0].tokens![0].column, 2);
  // A current client can still switch the rule deliberately.
  const current = t.journal!.world!.maps[0];
  const changed = applyCommand(t, dm, {
    id: "modern-save",
    kind: "map-save",
    mapId: "map",
    before: current,
    map: { ...current, grid: { ...current.grid!, diagonal: "equal" } },
  });
  assert.equal(changed.journal!.world!.maps[0].grid!.diagonal, "equal");
  // Pending commands with the new rule are not handed to older apps.
  const draft = JSON.stringify([
    { id: "x", kind: "map-save", mapId: "map", before: null, map: current },
  ]);
  assert.throws(() => tabletopResponse({ table: t, draft }, 2), /updated Lootsplitter client/);
  assert.deepEqual(legacyDiagonals({ diagonal: "alternating" }), { diagonal: "alternating" });
});
