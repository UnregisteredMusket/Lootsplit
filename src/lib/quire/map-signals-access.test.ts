// 2026-10-28 live-campaign load audit, F6: map signals authorize from a light D1 read (seats,
// closed/view-only flags and the one map's visibility metadata) instead of fetching and parsing
// the whole room body on every poll, and expired pings are reclaimed by writes and the minute cron,
// never by reads. These tests prove the allow/deny results are identical to the previous
// whole-body rule and measure what one signal read costs.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { emptyCloudTable, type CloudRoom } from "./cloud.ts";
import { emptyCoins } from "./money.ts";
import { mapAccessible, readMapTabletop, sceneViewers } from "./tabletop.ts";
import { scenePointVisible } from "./tabletop-geometry.ts";
import { mapSignalPollDelay, PING_DURATION } from "./map-signals.ts";
import { expireMapPings } from "../../../cloudflare/map-ping-expiry.mjs";
import { readStoredRoom, roomWriteStatements } from "../../../cloudflare/room-storage.mjs";

const sql = new DatabaseSync(":memory:");
const migrations = new URL("../../../cloudflare/migrations/", import.meta.url);
for (const file of readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .sort())
  sql.exec(readFileSync(new URL(file, migrations), "utf8"));

// Instrumented D1 stand-in: counts statements and the bytes each returns to the Worker.
const meter = { on: false, queries: [] as string[], bytes: 0 };
const size = (v: unknown) => (v == null ? 0 : Buffer.byteLength(JSON.stringify(v)));
(globalThis as { __env__?: unknown }).__env__ = {
  DB: {
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      let values: unknown[] = [];
      const note = (result: unknown) => {
        if (meter.on) {
          meter.queries.push(query);
          meter.bytes += size(result);
        }
        return result;
      };
      return {
        bind(...args: unknown[]) {
          values = args;
          return this;
        },
        async all() {
          const results = query.includes("FROM play_characters")
            ? []
            : sql.prepare(query).all(...(values as never[]));
          note(results);
          return { results };
        },
        async first() {
          return note(sql.prepare(query).get(...(values as never[])) ?? null);
        },
        async run() {
          const r = sql.prepare(query).run(...(values as never[]));
          note(null);
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
  },
};

const grid = {
  columns: 10,
  rows: 10,
  feetPerTile: 5,
  diagonal: "equal" as const,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};
const baseMap = {
  name: "Map",
  image: "data:image/png;base64,aA==",
  locationId: null,
  anchors: [],
  markers: [],
};
// Points across the map: revealed and in sight, revealed but out of sight, fogged, wall-blocked.
const points = [
  { x: 0.05, y: 0.05 },
  { x: 0.15, y: 0.1 },
  { x: 0.35, y: 0.35 },
  { x: 0.45, y: 0.9 },
  { x: 0.7, y: 0.2 },
  { x: 0.9, y: 0.9 },
  { x: 0.25, y: 0.75 },
  { x: 0.55, y: 0.05 },
];
function campaign() {
  const table = emptyCloudTable();
  table.purses = [
    { id: "hero", name: "Hero", kind: "character", coins: emptyCoins() },
    { id: "rogue", name: "Rogue", kind: "character", coins: emptyCoins() },
    { id: "spy", name: "Hidden NPC", kind: "character", coins: emptyCoins(), control: "npc" },
  ] as typeof table.purses;
  const token = (id: string, entityId: string, column: number, row: number, extra = {}) => ({
    id,
    label: entityId,
    kind: "character" as const,
    entityId,
    column,
    row,
    visibility: "party" as const,
    ...extra,
  });
  const fog = {
    enabled: true,
    base: "concealed" as const,
    shapes: [
      { id: "left", kind: "rectangle" as const, reveal: true, a: { x: 0, y: 0 }, b: { x: 0.5, y: 1 } },
      { id: "pit", kind: "rectangle" as const, reveal: false, a: { x: 0.3, y: 0.3 }, b: { x: 0.4, y: 0.4 } },
    ],
  };
  const maps = [
    { ...baseMap, id: "open-map", visible: true },
    {
      ...baseMap,
      id: "fog-map",
      visible: true,
      grid,
      tokens: [
        token("t-hero", "hero", 1, 1, { vision: { enabled: true, rangeFeet: 25, darkvisionFeet: 0 } }),
        token("t-spy", "spy", 8, 8),
      ],
      tabletop: { fog, vision: "party", ambientLight: true, lights: [], walls: [
        { id: "w", a: { x: 0.2, y: 0 }, b: { x: 0.2, y: 0.5 } },
      ] },
    },
    {
      ...baseMap,
      id: "solo-map",
      visible: true,
      grid,
      tokens: [token("t-hero", "hero", 1, 1), token("t-rogue", "rogue", 7, 2, { vision: { enabled: true, rangeFeet: 20, darkvisionFeet: 10 } })],
      tabletop: { vision: "individual", ambientLight: true },
    },
    { ...baseMap, id: "secret-map", visible: false },
  ];
  table.journal = {
    sessions: [],
    events: [],
    requests: [],
    world: {
      characterPositions: [],
      maps,
      npcs: [],
      trades: [],
      timeHistory: [],
      conversations: [],
      blackMarketActive: false,
    },
  } as unknown as typeof table.journal;
  return table;
}

/** The previous rule, verbatim: the whole stored body parsed, then the same visibility helpers. */
async function previousDecision(code: string, token: string, mapId: string, point?: { x: number; y: number }) {
  // The whole stored room (assembled when sectioned), through the storage API.
  const room = (await readStoredRoom(storageDb(), code))?.room as CloudRoom;
  if (!room || room.closed) return "room";
  const seat = room.seats.find((s) => s.token === token);
  if (!seat) return "seat";
  const map = room.table.journal?.world?.maps.find((m) => m.id === mapId);
  if (!map || !mapAccessible(room.table, map, seat)) return "map";
  if (!point) return "ok";
  const visible =
    seat.role === "dm" ||
    scenePointVisible(point, readMapTabletop(map), map.grid, sceneViewers(room.table, map, seat));
  return visible ? "ok" : "hidden";
}
async function currentDecision(
  input: { code: string; token: string },
  mapId: string,
  point?: { x: number; y: number },
) {
  const { mapSignals } = await import("./map-signals.server.ts");
  try {
    await mapSignals({
      ...input,
      mapId,
      ...(point ? { ping: { id: crypto.randomUUID(), mapId, ...point, color: "red" } } : {}),
    });
    return "ok";
  } catch (error) {
    const message = (error as Error).message;
    if (/room is unavailable/.test(message)) return "room";
    if (/not seated/.test(message)) return "seat";
    if (/map is unavailable/.test(message)) return "map";
    if (/visible point/.test(message)) return "hidden";
    return message;
  }
}
const storageDb = () => (globalThis as unknown as { __env__: { DB: never } }).__env__.DB;
/** Sets one JSON path of the stored room (same revision), written through the storage API. */
async function edit(code: string, path: string, value: unknown) {
  const stored = (await readStoredRoom(storageDb(), code))!;
  const body = (sql.prepare("SELECT json_set(?,?,json(?)) AS body").get(stored.body, path, JSON.stringify(value)) as { body: string }).body;
  await (storageDb() as { batch: (s: unknown[]) => Promise<unknown> }).batch(
    roomWriteStatements(storageDb(), JSON.parse(body), { expect: stored.version, body }).statements,
  );
}

test("map signal access matches the previous whole-room rule for DM, players, hidden maps, fog and vision", async () => {
  const { openRoom, joinRoom } = await import("./cloud.server.ts");
  const host = await openRoom({ name: "Signals DM", table: campaign() });
  const hero = await joinRoom({ code: host.code, purseId: "hero", name: "Hero player" });
  const rogue = await joinRoom({ code: host.code, purseId: "rogue", name: "Rogue player" });
  const seats = {
    dm: host,
    hero: { code: host.code, token: hero.token },
    rogue: { code: host.code, token: rogue.token },
    forged: { code: host.code, token: "forged" },
  };
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += 1000); // never trips the 500 ms per-seat ping limit
  const variants: [string, () => void][] = [
    // Raw NPC records (not a full NPC sheet): only `visible` matters to the rule.
    ["players browse freely; the NPC is hidden", () => edit(host.code, "$.table.journal.world.npcs", [{ id: "spy", visible: false }])],
    ["the DM shows one map", () => edit(host.code, "$.table.journal.world.tabletop", { activeMapId: "fog-map", playerBrowsing: false })],
    ["the hidden NPC becomes visible", () => edit(host.code, "$.table.journal.world.npcs[0].visible", true)],
    ["a position hides the hero", () => edit(host.code, "$.table.journal.world.characterPositions", [{ purseId: "hero", inParty: true, locationId: null, visible: false, sheetVisible: true }])],
    ["browsing returns", () => edit(host.code, "$.table.journal.world.tabletop", { activeMapId: "fog-map", playerBrowsing: true })],
  ];
  const outcomes = new Set<string>();
  let compared = 0;
  try {
    for (const [label, apply] of variants) {
      await apply();
      for (const [who, seat] of Object.entries(seats))
        for (const mapId of ["open-map", "fog-map", "solo-map", "secret-map", "missing-map"])
          for (const point of [undefined, ...points]) {
            const expected = await previousDecision(host.code, seat.token, mapId, point);
            const actual = await currentDecision(seat, mapId, point);
            assert.equal(actual, expected, `${label}: ${who} on ${mapId} at ${JSON.stringify(point)}`);
            outcomes.add(`${who}:${expected}`);
            compared++;
          }
    }
  } finally {
    Date.now = realNow;
  }
  // The comparison covered every kind of answer, not only "ok".
  for (const expected of ["dm:ok", "hero:ok", "hero:hidden", "hero:map", "rogue:hidden", "forged:seat"])
    assert.ok(outcomes.has(expected), expected);
  assert.ok(compared > 500);
});

test("players read only pings at points they can see; DM-only maps stay DM-only", async () => {
  const { openRoom, joinRoom } = await import("./cloud.server.ts");
  const { mapSignals } = await import("./map-signals.server.ts");
  const host = await openRoom({ name: "Read DM", table: campaign() });
  const hero = await joinRoom({ code: host.code, purseId: "hero", name: "Hero player" });
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => (now += 600);
  try {
    for (const point of points)
      await mapSignals({ ...host, mapId: "fog-map", ping: { id: crypto.randomUUID(), mapId: "fog-map", ...point, color: "blue" } });
    await mapSignals({ ...host, mapId: "secret-map", ping: { id: crypto.randomUUID(), mapId: "secret-map", x: 0.1, y: 0.1, color: "red" } });
    now -= 600 * 3; // all pings still live
    const dm = await mapSignals({ ...host, mapId: "fog-map" });
    const player = await mapSignals({ code: host.code, token: hero.token, mapId: "fog-map" });
    assert.equal(dm.pings.length, points.length);
    const decisions = await Promise.all(points.map((p) => previousDecision(host.code, hero.token, "fog-map", p)));
    const expected = points.filter((_, index) => decisions[index] === "ok");
    assert.ok(expected.length > 0 && expected.length < points.length);
    assert.deepEqual(
      player.pings.map((p) => [p.x, p.y]).sort(),
      expected.map((p) => [p.x, p.y]).sort(),
    );
    await assert.rejects(mapSignals({ code: host.code, token: hero.token, mapId: "secret-map" }), /map is unavailable/);
    assert.equal((await mapSignals({ ...host, mapId: "secret-map" })).pings.length, 1);
  } finally {
    Date.now = realNow;
  }
});

test("a signal read costs one light query and no write, even in a megabyte room", async () => {
  const { openRoom, joinRoom } = await import("./cloud.server.ts");
  const { mapSignals } = await import("./map-signals.server.ts");
  const host = await openRoom({ name: "Heavy DM", table: campaign() });
  const hero = await joinRoom({ code: host.code, purseId: "hero", name: "Hero player" });
  // A heavy campaign: about a megabyte of chat history in the stored body.
  await edit(host.code, "$.table.notes", Array.from({ length: 2000 }, (_, i) => ({ id: `n${i}`, text: "x".repeat(500) })));
  const stored = (await readStoredRoom(storageDb(), host.code))!;
  const body = Buffer.byteLength(stored.body);
  assert.ok(body > 1_000_000);
  // The light read is the inline path; a sectioned room (when suites force the sectioning
  // threshold to 0) reads the same projections from only the sections holding them (step 3):
  // the row and section statements, still within the byte budget.
  const sectioned = stored.version.sections !== null;
  await mapSignals({ ...host, mapId: "fog-map", ping: { id: crypto.randomUUID(), mapId: "fog-map", x: 0.1, y: 0.1, color: "red" } });
  for (const seat of [host, { code: host.code, token: hero.token }]) {
    meter.on = true;
    meter.queries = [];
    meter.bytes = 0;
    const result = await mapSignals({ code: host.code, token: seat.token, mapId: "fog-map" });
    meter.on = false;
    assert.equal(result.pings.length, 1);
    assert.equal(meter.queries.length, sectioned ? 4 : 2, "authorization read (row, then sections) plus the ping read");
    assert.ok(!meter.queries.some((q) => /DELETE|INSERT|UPDATE/i.test(q)), "a read never writes");
    assert.ok(!meter.queries.some((q) => /SELECT\s+body\s*,\s*revision/i.test(q)), "the room body is never fetched");
    // The row's manifest lists every history page (step 4), about 160 bytes each; a megabyte of
    // chat is two pages at the real page size, hundreds when suites force tiny pages.
    const pages = (stored.version.sections ?? []).filter((e) => e.path[0] === "$history").length;
    assert.ok(meter.bytes < 8_000 + 200 * pages, `a signal read returned ${meter.bytes} bytes from a ${body}-byte room (${pages} history pages)`);
  }
});

test("expired pings are ignored by reads and reclaimed by the next ping and by the minute cron", async () => {
  const { openRoom } = await import("./cloud.server.ts");
  const { mapSignals } = await import("./map-signals.server.ts");
  const host = await openRoom({ name: "Expiry DM", table: campaign() });
  const count = () => (sql.prepare("SELECT count(*) AS n FROM campaign_map_pings WHERE code=?").get(host.code) as { n: number }).n;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const ping = () => ({ id: crypto.randomUUID(), mapId: "open-map", x: 0.5, y: 0.5, color: "green" });
  try {
    await mapSignals({ ...host, mapId: "open-map", ping: ping() });
    now += PING_DURATION + 1;
    assert.deepEqual((await mapSignals({ ...host, mapId: "open-map" })).pings, []);
    assert.equal(count(), 1, "the read filtered the expired ping without deleting it");
    await mapSignals({ ...host, mapId: "open-map", ping: ping() });
    assert.equal(count(), 1, "a new ping reclaims expired rows before it is stored");
    now += PING_DURATION + 1;
    const db = (globalThis as unknown as { __env__: { DB: Parameters<typeof expireMapPings>[0] } }).__env__.DB;
    // Across rooms: this one and any other expired signals.
    assert.ok((await expireMapPings(db, now)) >= 1);
    assert.equal(count(), 0);
    assert.equal(await expireMapPings(db, now), 0);
  } finally {
    Date.now = realNow;
  }
  const worker = readFileSync(new URL("../../../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /expireMapPings\(env\.DB, controller\.scheduledTime\)/);
  const server = readFileSync(new URL("./map-signals.server.ts", import.meta.url), "utf8");
  assert.equal([...server.matchAll(/expireMapPings\(/g)].length, 1, "one cleanup call, on the insert path");
});

test("the map signal poll is quick only while pings are active", () => {
  const now = 1_800_000_000_000;
  assert.equal(mapSignalPollDelay(0, now), 3000, "no ping seen yet");
  assert.equal(mapSignalPollDelay(now - 2000, now), 1000, "a ping seen or sent recently");
  assert.equal(mapSignalPollDelay(now - 9999, now), 1000);
  assert.equal(mapSignalPollDelay(now - 10_000, now), 3000, "quiet for ten seconds");
});
