import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Tabletop protocol 4 (2026-10-22): shared map images travel as references, loaded through the
// seat-authorized GET; older protocols keep receiving full inline envelopes.
const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE IF NOT EXISTS user(id TEXT PRIMARY KEY)");
for (const name of [
  "0001_campaign_rooms.sql", "0024_campaign_room_receipts.sql", "0026_campaign_room_sections.sql",
  "0007_character_play.sql",
  "0008_encounters.sql",
  "0012_campaign_room_images.sql",
  "0013_campaign_resource_documents.sql",
  "0019_campaign_room_reports.sql",
])
  sql.exec(readFileSync(new URL(`../../../cloudflare/migrations/${name}`, import.meta.url), "utf8"));
sql.exec(
  "CREATE TABLE IF NOT EXISTS library_members(user_id TEXT, code TEXT, seat_id TEXT, token TEXT, name TEXT, archived INTEGER, updated_at INTEGER, PRIMARY KEY(user_id,code))",
);
sql.exec("CREATE TABLE IF NOT EXISTS member_access(user_id TEXT PRIMARY KEY, status TEXT, ban_until INTEGER)");
let imageReads = 0;
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
      return {
        bind(...args: unknown[]) {
          values = args;
          return this;
        },
        async all() {
          if (query.includes("SELECT reference,image FROM campaign_room_images")) imageReads += values.length - 1;
          return {
            results: query.includes("FROM play_characters")
              ? []
              : sql.prepare(query).all(...(values as never[])),
          };
        },
        async first() {
          return sql.prepare(query).get(...(values as never[])) ?? null;
        },
        async run() {
          const r = sql.prepare(query).run(...(values as never[]));
          return { meta: { changes: Number(r.changes) } };
        },
      };
    },
  },
};
const { openRoom, joinRoom, roomState, pollRoom, submitCommands, choosePace, characterRoll, authorizedRoomImage } =
  await import("./cloud.server.ts");
const { tabletopResponse, IMAGE_REFERENCE_PROTOCOL } = await import("./tabletop-protocol.ts");
const { roomImageResponse } = await import("./room-image-route.server.ts");
const { restoreRoomImages } = await import("./room-image-cache.ts");
const { emptyCloudTable } = await import("./cloud.ts");
const { emptyCoins } = await import("./money.ts");

const RASTER = /data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]{8000,}/;
const grid = { columns: 10, rows: 10, feetPerTile: 5, diagonal: "equal" as const, x: 0, y: 0, width: 1, height: 1 };
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A realistic shared map: about 300 KB of base64 (the shared limit is 500,000 characters). */
const raster = (i: number) =>
  "data:image/png;base64," + (letters[i]! + letters[(i * 7 + 3) % 26]!).repeat(150_000);
async function sha(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
const referenceOf = async (image: string) => `/art/room-image-${await sha(image)}.webp`;

function campaign(prefix: string) {
  const table = emptyCloudTable();
  table.purses = [{ id: "hero", name: "Hero", kind: "character", coins: emptyCoins() }];
  const maps = Array.from({ length: 10 }, (_, i) => ({
    id: `${prefix}-map-${i}`,
    name: `Map ${i}`,
    image: raster(i + (prefix === "b" ? 13 : 0)),
    visible: true,
    locationId: null,
    type: "dungeon" as const,
    ...(i === 0 ? { grid, tokens: [] } : {}),
    anchors: [],
    markers: [],
  }));
  // An 11th, private map: never reachable by players.
  maps.push({ ...maps[1]!, id: `${prefix}-secret`, name: "Secret lair", image: raster(prefix === "b" ? 25 : 11), visible: false });
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
  } as never;
  return table;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const request = (code: string, hash: string, headers: Record<string, string> = {}) =>
  new Request(`https://lootsplit.test/api/room-image/${code}/${hash}`, { headers });

const host = await openRoom({ name: "Image DM", table: campaign("a") });
const guest = await joinRoom({ code: host.code, purseId: "hero", name: "Guest" });
const player = { code: host.code, token: guest.token };
await choosePace({ ...host, live: true });
const token = { id: "pc", kind: "character" as const, entityId: "hero", label: "Hero", column: 1, row: 1, visibility: "party" as const };
const add = { id: "add-token", kind: "map-token", mapId: "a-map-0", grid, tokenId: token.id, before: null, token };
await submitCommands({ ...host, batchId: "add", commands: [add] });
const other = await openRoom({ name: "Other DM", table: campaign("b") });
const otherGuest = await joinRoom({ code: other.code, purseId: "hero", name: "Other guest" });

test("a token move on a room with 10 maps sends references to protocol 4 and inline rasters to older clients", async () => {
  const move = { ...add, id: "move-token", before: token, token: { ...token, column: 4 } };
  const modern = tabletopResponse(
    await submitCommands({ ...host, batchId: "move", commands: [move], tabletopProtocol: 4 } as never),
    IMAGE_REFERENCE_PROTOCOL,
  );
  const maps = modern.table.journal!.world!.maps;
  assert.equal(maps.length, 11);
  for (const map of maps) assert.match(map.image, /^\/art\/room-image-[a-f0-9]{64}\.webp$/);
  assert.equal(maps[0]!.tokens![0]!.column, 4);
  assert.doesNotMatch(JSON.stringify(modern), RASTER);
  // The same response for an older client (protocol 3, 2 and none) keeps every inline raster.
  for (const protocol of [3, 2, undefined]) {
    const legacy = tabletopResponse(
      await submitCommands({ ...host, batchId: "move", commands: [move] }),
      protocol,
    );
    for (const [i, map] of legacy.table.journal!.world!.maps.entries())
      assert.equal(map.image, i === 10 ? raster(11) : raster(i), `protocol ${protocol}`);
  }

  // Reads after the move: the next poll (revision changed) and a full pull.
  imageReads = 0;
  const playerPoll = await pollRoom({ ...player, knownRevision: 0, tabletopProtocol: 4 });
  if (!("table" in playerPoll)) throw Error("A changed revision returns the full view.");
  const playerModern = tabletopResponse(playerPoll, 4);
  assert.equal(imageReads, 0, "protocol 4 reads load no map rasters from D1");
  assert.doesNotMatch(JSON.stringify(playerModern), RASTER);
  assert.equal(playerModern.table.journal!.world!.maps.length, 10, "the private map is not projected");
  const playerLegacy = tabletopResponse(await roomState({ ...player, tabletopProtocol: 3 }), 3);
  assert.match(JSON.stringify(playerLegacy), RASTER);
  const dmModern = tabletopResponse(await roomState({ ...host, tabletopProtocol: 4 }), 4);
  const dmLegacy = tabletopResponse(await roomState(host), 3);
  const sizes = {
    dmProtocol3: bytes(dmLegacy),
    dmProtocol4: bytes(dmModern),
    playerProtocol3: bytes(playerLegacy),
    playerProtocol4: bytes(playerModern),
  };
  console.log(`room-image bytes after a token move (10 shared maps + 1 private, ~300 KB each): ${JSON.stringify(sizes)}`);
  assert.ok(sizes.dmProtocol4 * 50 < sizes.dmProtocol3);
  assert.ok(sizes.playerProtocol4 * 50 < sizes.playerProtocol3);

  // Restoring references on the client yields exactly the protocol 3 table.
  const globalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string, init?: RequestInit) =>
    roomImageResponse(
      new Request("https://lootsplit.test" + input, init),
      { code: String(input).split("/")[3]!, hash: String(input).split("/")[4]! },
    )) as typeof fetch;
  try {
    const restored = await restoreRoomImages(playerModern.table, {
      campaignKey: "test",
      code: host.code,
      token: guest.token,
      ephemeral: true,
    });
    assert.deepEqual(restored.journal!.world!.maps, playerLegacy.table.journal!.world!.maps);
  } finally {
    globalThis.fetch = globalFetch;
  }
});

test("room image GET honors seat, campaign, hidden map and guest authorization, with ETag revalidation", async () => {
  const shared = await referenceOf(raster(2)),
    hidden = await referenceOf(raster(11)),
    elsewhere = await referenceOf(raster(13)),
    hash = (reference: string) => reference.slice("/art/room-image-".length, -".webp".length);
  // Guest player seat: shared map readable, exact stored text, strong ETag, private no-cache.
  const ok = await roomImageResponse(request(host.code, hash(shared), { "x-lootsplit-seat": guest.token }), {
    code: host.code,
    hash: hash(shared),
  });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), raster(2));
  assert.equal(ok.headers.get("etag"), `"${hash(shared)}"`);
  assert.equal(ok.headers.get("cache-control"), "private, no-cache");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  const revalidated = await roomImageResponse(
    request(host.code, hash(shared), { "x-lootsplit-seat": guest.token, "if-none-match": `"${hash(shared)}"` }),
    { code: host.code, hash: hash(shared) },
  );
  assert.equal(revalidated.status, 304);
  assert.equal(await revalidated.text(), "");
  // Hidden map: unreachable for the player, readable by the DM's projection.
  const secret = await roomImageResponse(request(host.code, hash(hidden), { "x-lootsplit-seat": guest.token }), {
    code: host.code,
    hash: hash(hidden),
  });
  assert.equal(secret.status, 404);
  assert.equal(secret.headers.get("cache-control"), "no-store");
  assert.ok(!(await secret.text()).includes("data:"));
  assert.deepEqual(await authorizedRoomImage({ ...host, reference: hidden }), { image: raster(11) });
  // A revalidation never bypasses authorization.
  const secretEtag = await roomImageResponse(
    request(host.code, hash(hidden), { "x-lootsplit-seat": guest.token, "if-none-match": `"${hash(hidden)}"` }),
    { code: host.code, hash: hash(hidden) },
  );
  assert.equal(secretEtag.status, 404);
  // Another campaign's image under this room, or this room's image with the other room's seat.
  assert.equal(
    (await roomImageResponse(request(host.code, hash(elsewhere), { "x-lootsplit-seat": guest.token }), { code: host.code, hash: hash(elsewhere) })).status,
    404,
  );
  assert.deepEqual(await authorizedRoomImage({ ...host, reference: elsewhere }), { status: 404 });
  assert.equal(
    (await roomImageResponse(request(host.code, hash(shared), { "x-lootsplit-seat": otherGuest.token }), { code: host.code, hash: hash(shared) })).status,
    403,
  );
  assert.equal(
    (await roomImageResponse(request(other.code, hash(shared), { "x-lootsplit-seat": otherGuest.token }), { code: other.code, hash: hash(shared) })).status,
    404,
  );
  // No seat, a forged seat, malformed input, unknown rooms and other methods.
  assert.equal((await roomImageResponse(request(host.code, hash(shared)), { code: host.code, hash: hash(shared) })).status, 403);
  assert.equal(
    (await roomImageResponse(request(host.code, hash(shared), { "x-lootsplit-seat": "forged" }), { code: host.code, hash: hash(shared) })).status,
    403,
  );
  assert.equal((await roomImageResponse(request(host.code, "nothex", { "x-lootsplit-seat": guest.token }), { code: host.code, hash: "nothex" })).status, 404);
  assert.equal(
    (await roomImageResponse(request("ZZZZZZZZ", hash(shared), { "x-lootsplit-seat": guest.token }), { code: "ZZZZZZZZ", hash: hash(shared) })).status,
    404,
  );
  assert.equal(
    (await roomImageResponse(new Request(`https://lootsplit.test/api/room-image/${host.code}/${hash(shared)}`, { method: "POST" }), { code: host.code, hash: hash(shared) })).status,
    405,
  );
});

test("a map image reference inside a submitted command is refused before it can be stored", async () => {
  const shared = await referenceOf(raster(3));
  const room = await roomState(host);
  const map = room.table.journal!.world!.maps[3]!;
  await assert.rejects(
    submitCommands({
      ...host,
      batchId: "reference-save",
      commands: [{ id: "reference-save", kind: "map-save", mapId: map.id, before: map, map: { ...map, image: shared } }],
    }),
    /has not finished loading/,
  );
  assert.equal((await roomState(host)).table.journal!.world!.maps[3]!.image, raster(3));
});

test("server rolls still pass the stored-body guard after protocol 4 reads (#131)", async () => {
  await roomState({ ...player, tabletopProtocol: 4 });
  const roll = await characterRoll({
    code: host.code,
    token: guest.token,
    purseId: "hero",
    requestKey: "roll-after-reference-read",
    revision: 0,
    kind: "custom",
    formula: "1d20",
    label: "Check",
  });
  assert.ok(roll.total >= 1 && roll.total <= 20);
});
