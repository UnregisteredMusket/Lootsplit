import assert from "node:assert/strict";
import test from "node:test";
import { emptyCloudTable, readCloudTable, type CloudTable, type CloudSeat } from "./cloud.ts";
import { applyCommand, type CommandInput } from "./commands.ts";
import { readJournal, preserveJournalMetadata, readArchivedSnapshot } from "./journal.ts";
import {
  campaignMapSchema,
  mapGridSchema,
  partyMapPositionSchema,
  type CampaignMap,
} from "./world-schema.ts";
import {
  mapType,
  tileAt,
  tilePoint,
  tileDistance,
  routeDistance,
  routePosition,
} from "./map-tiles.ts";
import { projectRecord } from "./session-records.ts";
import { canonicalJson } from "./canonical-json.ts";
import { shopVisible } from "./vendors.ts";
const dm: CloudSeat = { id: "dm", token: "dm", name: "DM", role: "dm", purseIds: [] },
  player: CloudSeat = { id: "pc", token: "pc", name: "Player", role: "player", purseIds: ["hero"] };
let n = 0;
const act = (t: CloudTable, c: CommandInput, s = dm) =>
  applyCommand(t, s, { ...c, id: `tile-${++n}` });
const grid = mapGridSchema.parse({ columns: 10, rows: 10 });
const map: CampaignMap = {
  id: "map",
  name: "Keep",
  image: "data:image/png;base64,aA==",
  visible: true,
  locationId: "city",
  anchors: [],
  markers: [],
  type: "dungeon",
  grid,
  tokens: [],
};
function fixture(): CloudTable {
  return {
    ...emptyCloudTable(),
    purses: [
      {
        id: "hero",
        kind: "character",
        name: "Hero",
        coins: { cp: 10000, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
      {
        id: "hidden",
        kind: "character",
        name: "Secret Hero",
        coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    ],
    journal: readJournal({
      market: {
        currentLocationId: "city",
        locations: [
          { id: "region", name: "Region", kind: "region", parentId: null, description: "" },
          { id: "city", name: "City", kind: "city", parentId: "region", description: "" },
        ],
      },
      world: {
        maps: [map],
        characterPositions: [
          {
            purseId: "hidden",
            inParty: true,
            locationId: null,
            visible: false,
            sheetVisible: false,
          },
        ],
      },
    }),
  };
}
test("legacy maps remain readable and categories/grid calibration default safely", () => {
  const old = { ...map };
  delete old.grid;
  delete old.tokens;
  delete old.type;
  assert.deepEqual(campaignMapSchema.parse(old), old);
  assert.equal(mapType(old, fixture()), "city");
  assert.equal(mapType({ ...old, locationId: null }, fixture()), "regional");
  assert.equal(grid.feetPerTile, 5);
  assert.equal(mapGridSchema.safeParse({ ...grid, columns: 201 }).success, false);
  assert.equal(mapGridSchema.safeParse({ ...grid, x: 0.4, width: 0.7 }).success, false);
  assert.deepEqual(tileAt(grid, { x: 1, y: 1 }), { column: 9, row: 9 });
  const aligned = { ...grid, x: 0.2, y: 0.1, width: 0.5, height: 0.8 };
  assert.equal(tileAt(aligned, { x: 0.1, y: 0.1 }), undefined);
  assert.deepEqual(tileAt(aligned, tilePoint(aligned, { column: 4, row: 8 })), {
    column: 4,
    row: 8,
  });
  assert.equal(tileDistance(grid, { column: 1, row: 1 }, { column: 4, row: 5 }), 20);
  assert.equal(
    tileDistance({ ...grid, diagonal: "orthogonal" }, { column: 1, row: 1 }, { column: 4, row: 5 }),
    35,
  );
  assert.equal(
    tileDistance({ ...grid, diagonal: "euclidean" }, { column: 1, row: 1 }, { column: 4, row: 5 }),
    25,
  );
});
test("free travel placement is DM-only, stale safe, biome checked and closes located shops", () => {
  let t = fixture();
  const position = {
    mapId: "map",
    x: 0.3,
    y: 0.4,
    environment: "Wilderness" as const,
    biome: "Forest" as const,
    description: "Old trail",
  };
  const cmd: CommandInput = {
    kind: "party-map-position",
    before: null,
    beforeLocationId: "city",
    position,
  };
  assert.throws(() => act(t, cmd, player), /Only the DM/);
  assert.equal(partyMapPositionSchema.safeParse({ ...position, biome: undefined }).success, false);
  t = act(t, cmd);
  assert.equal(t.journal!.market!.currentLocationId, null);
  assert.deepEqual(t.journal!.world!.partyPosition, position);
  assert.equal(shopVisible({ locationId: "city" }, t), false);
  assert.equal(shopVisible({}, t), true);
  assert.throws(() => act(t, cmd), /party moved/);
  assert.throws(
    () => act(t, { kind: "party-location", before: null, locationId: "city" }),
    /travel position changed/,
  );
  const pub = projectRecord(t, player);
  assert.deepEqual(readCloudTable(pub)!.journal!.world!.partyPosition, position);
  assert.deepEqual(
    readArchivedSnapshot(JSON.stringify(t))!.journal!.world!.partyPosition,
    position,
  );
  const old = t.journal!.world!.maps[0];
  assert.throws(
    () => act(t, { kind: "map-save", mapId: old.id, before: old, map: null }),
    /free party position/,
  );
  t = act(t, {
    kind: "party-location",
    before: null,
    beforePosition: canonicalJson(position),
    locationId: "city",
  });
  assert.equal(t.journal!.world!.partyPosition, undefined);
  assert.equal(shopVisible({ locationId: "city" }, t), true);
});
test("private travel maps redact coordinates while keeping travel access restrictions", () => {
  let t = fixture();
  t.journal!.world!.maps[0].visible = false;
  t.shops = [
    {
      id: "shop",
      name: "Remote",
      keeper: "Keeper",
      notes: "",
      place: "City",
      category: "mixed",
      wealth: "modest",
      priceScale: 1,
      buyRate: 1,
      sellRate: 1,
      closed: false,
      locationId: "city",
    },
  ];
  t = act(t, {
    kind: "party-map-position",
    before: null,
    beforeLocationId: "city",
    position: { mapId: "map", x: 0.2, y: 0.3, environment: "Roads", description: "Pass" },
  });
  const publicTable = projectRecord(t, player);
  assert.deepEqual(publicTable.journal!.world!.maps, []);
  assert.deepEqual(publicTable.journal!.world!.partyPosition, {
    environment: "Roads",
    description: "Pass",
  });
  assert.deepEqual(publicTable.shops, []);
  readCloudTable(publicTable);
});
test("combat moves are DM-only and reject stale positions, invalid references and resized grids", () => {
  let t = fixture();
  const token = {
    id: "hero-token",
    kind: "character" as const,
    entityId: "hero",
    label: "Hero",
    column: 1,
    row: 2,
    visibility: "party" as const,
  };
  const add: CommandInput = {
    kind: "map-token",
    mapId: "map",
    grid,
    tokenId: token.id,
    before: null,
    token,
  };
  assert.throws(() => act(t, add, player), /Only the DM/);
  t = act(t, add);
  assert.throws(() => act(t, add), /moved or changed/);
  const move: CommandInput = { ...add, before: token, token: { ...token, column: 4 } };
  const prior = {
    purses: t.purses,
    holdings: t.holdings,
    market: t.journal!.market,
    finance: t.journal!.finance,
  };
  t = act(t, move);
  assert.deepEqual(
    {
      purses: t.purses,
      holdings: t.holdings,
      market: t.journal!.market,
      finance: t.journal!.finance,
    },
    prior,
  );
  assert.throws(() => act(t, move), /moved or changed/);
  assert.throws(
    () => act(t, { ...add, tokenId: "bad", token: { ...token, id: "bad", entityId: "missing" } }),
    /character is missing/,
  );
  assert.throws(
    () =>
      act(t, {
        ...add,
        tokenId: "outside",
        token: { ...token, id: "outside", kind: "other", entityId: undefined, column: 10 },
      }),
    /fit inside/,
  );
  assert.throws(() => act(t, { ...add, grid: { ...grid, feetPerTile: 10 } }), /grid changed/);
  const m = t.journal!.world!.maps[0];
  assert.throws(
    () =>
      act(t, {
        kind: "map-save",
        mapId: "map",
        before: m,
        map: { ...m, grid: { ...grid, columns: 2 } },
      }),
    /fit inside/,
  );
});
test("player projections exclude secret and hidden-character tokens and preserve public board backups", () => {
  const t = fixture();
  t.journal!.world!.maps[0].encounterId = "private-encounter";
  t.journal!.world!.maps[0].tokens = [
    {
      id: "a",
      kind: "character",
      entityId: "hero",
      label: "Hero",
      column: 1,
      row: 1,
      visibility: "party",
    },
    {
      id: "b",
      kind: "character",
      entityId: "hidden",
      label: "Secret Hero",
      column: 2,
      row: 1,
      visibility: "party",
    },
    {
      id: "c",
      kind: "creature",
      encounterId: "private-encounter",
      combatantId: "enemy",
      label: "Secret enemy",
      column: 3,
      row: 1,
      visibility: "dm",
    },
  ];
  const projected = projectRecord(t, player);
  assert.deepEqual(
    projected.journal!.world!.maps[0].tokens!.map((t) => t.id),
    ["a"],
  );
  assert.equal(projected.journal!.world!.maps[0].encounterId, undefined);
  assert.ok(!JSON.stringify(projected).includes("Secret enemy"));
  readCloudTable(projected);
  const legacy = structuredClone(t.journal!);
  for (const m of legacy.world!.maps) {
    delete m.grid;
    delete m.tokens;
    delete m.type;
    delete m.encounterId;
  }
  const saved = preserveJournalMetadata(legacy, t.journal!);
  assert.deepEqual(saved.world!.maps[0], t.journal!.world!.maps[0]);
});
test("route interpolation uses the existing elapsed fraction, supports bends and clamps endpoints", () => {
  const route = {
    grid,
    points: [
      { column: 0, row: 0 },
      { column: 4, row: 0 },
      { column: 4, row: 4 },
    ],
  };
  assert.equal(routeDistance(grid, route.points), 40);
  assert.deepEqual(routePosition(route, 0.5), tilePoint(grid, { column: 4, row: 0 }));
  assert.deepEqual(routePosition(route, -1), tilePoint(grid, { column: 0, row: 0 }));
  assert.deepEqual(routePosition(route, 2), tilePoint(grid, { column: 4, row: 4 }));
});
