import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  parseMarketNames,
  previewMarketNames,
  marketNameFingerprint,
} from "./market-name-import.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { emptyCloudTable, type CloudSeat, type CloudTable } from "./cloud.ts";
import { applyCommand, type Command } from "./commands.ts";
import {
  blankShop,
  applyCloudTable,
  executeLocalCommand,
  economySnapshot,
  snapshot,
  readQuireFile,
  restore,
} from "./economy.ts";
import { DM_SEAT, setSeat } from "./table.ts";

const dm: CloudSeat = { id: "dm", token: "dm", role: "dm", name: "DM", purseIds: [] };
const guest: CloudSeat = { ...dm, id: "guest", role: "player" };
const csv =
  'region,city,town,area,shop\r\nGreen Coast,Port,,Docks,"Salt, Rope & ""Nails"""\r\nGreen Coast,,Oakford,,The Kettle\r\nDesert,,Oakford,,The Kettle';
function table(): CloudTable {
  return {
    ...emptyCloudTable(),
    shops: [
      {
        ...blankShop(),
        id: "legacy",
        name: "Legacy",
        image: "/art/shop-default.webp",
        buyRate: 0.77,
      },
    ],
    journal: { sessions: [], requests: [], events: [] },
  };
}
function command(
  source = table(),
  rows = parseMarketNames(csv, "region", null),
): Extract<Command, { kind: "market-name-import" }> {
  return {
    kind: "market-name-import",
    id: "import",
    rows,
    before: marketNameFingerprint(readMarketLocations(source.journal?.market), source.shops),
  };
}
test("quoted CSV and TSV build complete paths; plain lists and JSON keep selected type/parent", () => {
  const rows = parseMarketNames(csv, "region", null);
  assert.equal(rows[0].name, 'Salt, Rope & "Nails"');
  assert.deepEqual(
    rows[0].path.map((row) => row.kind),
    ["region", "city", "area"],
  );
  assert.equal(
    parseMarketNames('region\tcity\tshop\nCoast\tPort\t"The\nLantern"', "shop", null)[0].name,
    "The\nLantern",
  );
  assert.deepEqual(
    parseMarketNames("Port\r\nTown\n", "town", "coast").map((row) => row.parentId),
    ["coast", "coast"],
  );
  assert.equal(
    parseMarketNames('[{"region":"Coast","town":"Town","shop":"Inn"}]', "region", null)[0].path
      .length,
    2,
  );
  assert.equal(parseMarketNames('["Town"]', "town", "coast")[0].parentId, "coast");
  assert.equal(
    parseMarketNames('"region","shop"\nCoast,Inn', "region", null, "csv")[0].kind,
    "shop",
  );
});
test("malformed and oversized imports fail before creating anything", () => {
  for (const input of [
    "",
    "region,wrong\nCoast,Port",
    "region,shop\nCoast,Inn,extra",
    'region,shop\nCoast,"unfinished',
    "region,region\nA,B",
    "region,city,town\nA,B,C",
    '[{"region":4}]',
    '[{"unknown":"A"}]',
    "[broken",
    "x".repeat(161),
    Array(501).fill("Name").join("\n"),
    "x".repeat(128001),
  ])
    assert.throws(() => parseMarketNames(input, "region", null));
  assert.throws(
    () => parseMarketNames("name,type\nA,region", "region", null, "csv"),
    /column headers/,
  );
});
test("matching reuses parents and names at their exact location; repeat imports preserve configuration", () => {
  const source = table(),
    imported = applyCommand(source, dm, command(source));
  assert.equal(imported.journal!.market!.locations.length, 6);
  assert.equal(imported.shops.length, 4);
  assert.ok(imported.shops.slice(1).every((shop) => shop.closed && shop.category === "general"));
  assert.deepEqual(imported.shops[0], source.shops[0]);
  assert.deepEqual(imported.stock, source.stock);
  const next = applyCommand(imported, dm, {
    ...command(source),
    id: "repeat",
    before: marketNameFingerprint(imported.journal!.market!, imported.shops),
  });
  assert.deepEqual(next, imported);
  assert.deepEqual(source, table(), "Source is unchanged");
});
test("server permissions and stale previews reject atomically; concurrent stock/settings/image edits survive", () => {
  const source = table(),
    cmd = command(source);
  assert.throws(() => applyCommand(source, guest, cmd), /Only the DM/);
  const renamed = structuredClone(source);
  renamed.shops[0].name = "Renamed";
  assert.throws(() => applyCommand(renamed, dm, cmd), /fresh import preview/);
  const edited = structuredClone(source);
  edited.shops[0].buyRate = 0.3;
  edited.shops[0].image = "/art/portrait-default.webp";
  const next = applyCommand(edited, dm, cmd);
  assert.deepEqual(next.shops[0], edited.shops[0]);
  assert.deepEqual(source, table());
});
test("missing/invalid parents, ambiguous duplicates and forged ancestry never partially commit", () => {
  const source = table();
  for (const rows of [
    parseMarketNames("city,shop\nPort,Inn", "shop", null),
    parseMarketNames("area\nDocks", "area", null),
    parseMarketNames("Town", "town", "missing"),
    [{ kind: "shop" as const, name: "Inn", parentId: "missing", path: [] }],
  ])
    assert.throws(() => applyCommand(source, dm, command(source, rows)));
  const market = readMarketLocations({
    currentLocationId: null,
    locations: [
      {
        id: "a",
        kind: "region",
        parentId: null,
        name: "Cöast",
        description: "Original",
        image: "/art/shop-default.webp",
      },
    ],
  });
  const plan = previewMarketNames(
    market,
    [],
    parseMarketNames("CO\u0308AST\nCöast", "region", null),
    "unicode",
  );
  assert.equal(plan.locations.length, 0);
  const ambiguous = {
    ...market,
    locations: [...market.locations, { ...market.locations[0], id: "b" }],
  };
  assert.throws(
    () => previewMarketNames(ambiguous, [], parseMarketNames("Cöast", "region", null), "ambiguous"),
    /ambiguous/,
  );
  assert.deepEqual(source, table());
});
test("device import is one transaction and complete backups retain imported hierarchy and closed shops", async () => {
  setSeat(DM_SEAT);
  const source = table();
  await applyCloudTable(source);
  const { id: _id, ...input } = command(source);
  await executeLocalCommand(input);
  const imported = await economySnapshot();
  assert.equal(imported.journal!.market!.locations.length, 6);
  assert.equal(imported.shops.length, 4);
  const backup = readQuireFile(await snapshot());
  await applyCloudTable(emptyCloudTable());
  await restore(backup);
  assert.deepEqual((await economySnapshot()).shops, imported.shops);
  const before = await economySnapshot();
  await assert.rejects(executeLocalCommand({ ...input, before: "stale" }), /fresh import preview/);
  assert.deepEqual(await economySnapshot(), before);
});
