// Large shared campaigns (sectioned storage step 3C): a campaign near the 4 MB cap is written,
// stored sectioned, synced section by section to the DM and a player, changed and synced again;
// a 6 MB campaign round-trips at the storage and sync layers while the application cap refuses
// to grow it; one oversized archived session is refused by the row limit. Disposable local D1
// stand-in with every migration applied; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, roomState, pollRoom, submitCommands } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom, updateRoom, ROOM_BODY_LIMIT, ROOM_ROW_LIMIT } = await import("../src/lib/quire/room-store.server.ts");
const { ROOM_LIVE_LIMIT } = await import("../src/lib/quire/room-size.ts");
const { readStoredRoom, roomWriteStatements, ROOM_SECTION_THRESHOLD, ROOM_HISTORY_PAGE_ITEMS, setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
// Real history pages even when suites force tiny ones: these campaigns are sized against the
// real row limit, which a manifest of thousands of tiny pages would exceed.
setRoomSectionLimitsForTests({ page: ROOM_HISTORY_PAGE_ITEMS });
const { encodeRoomImages } = await import("../cloudflare/room-images.mjs");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { roomViewResponse, readViewSections, clearViewSectionCacheForTests } = await import("../src/lib/quire/view-sections.server.ts");
const { createRoomSync } = await import("../src/lib/quire/room-sync.ts");
const { getRoomLoading, subscribeRoomLoading, LOADING_SCREEN_BYTES } = await import("../src/lib/quire/room-loading.ts");

const bytes = (text) => Buffer.byteLength(text);
/** Ledger, chat and journal notes adding up to about `target` stored bytes. */
function grow(room, target, { prefix = "" } = {}) {
  const per = (share, size) => Math.round((target * share) / size);
  room.table.ledger = Array.from({ length: per(0.45, 200) }, (_, i) => ({ id: `${prefix}l-${i}`, at: i, purseId: i % 2 ? "a" : "party", shopId: null, summary: `Bought supplies ${i}: rope, lantern oil and rations`, copper: -1 - (i % 97), transactionType: "purchase" }));
  room.table.notes = Array.from({ length: per(0.35, 160) }, (_, i) => ({ id: `${prefix}n-${i}`, at: i, from: "dm", to: "party", purseId: "", text: `Session chatter ${i}: the caravan moves north at dawn.` }));
  room.table.journal.entries = Array.from({ length: per(0.2, 600) }, (_, i) => ({ id: `${prefix}e-${i}`, at: i, authorId: "dm", purseId: "", visibility: i % 4 ? "party" : "dm", title: `Entry ${i}`, text: `${i % 4 ? "Lore" : "DM-SECRET"} `.repeat(100), reportIds: [] }));
}
function client() {
  const fetched = { calls: 0, chars: 0 };
  const sync = createRoomSync({
    readSections: async ({ data }) => {
      const result = await readViewSections(data);
      fetched.calls++;
      fetched.chars += Object.values(result.sections).join("").length;
      return result;
    },
    fullRead: async ({ data }) => roomViewResponse(await roomState(data), data),
  });
  const pull = sync.roomRead(async ({ data }) => roomViewResponse(await roomState(data), data));
  const poll = sync.roomRead(async ({ data }) => {
    const result = await pollRoom(data);
    return "table" in result ? roomViewResponse(result, data) : result;
  });
  return { sync, pull, poll, fetched };
}
const fullView = async (seat) => (await roomViewResponse(await roomState(seat), { tabletopProtocol: 10 })).table;

test("a campaign near the cap round-trips through write, sectioned storage, section sync and view", async () => {
  clearViewSectionCacheForTests();
  const dm = await openRoom({ name: "Big DM", table: tradeFixture() });
  const joined = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
  const player = { code: dm.code, token: joined.token };
  const room = await readRoom(dm.code);
  grow(room, ROOM_BODY_LIMIT * 0.92);
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  const stored = await readStoredRoom(db, dm.code);
  const size = bytes(stored.body);
  assert.ok(size > ROOM_SECTION_THRESHOLD * 2 && size <= ROOM_BODY_LIMIT, `stored ${size} bytes`);
  assert.notEqual(stored.version.sections, null, "stored sectioned");
  assert.deepEqual(stored.room.table.ledger, room.table.ledger);

  for (const [name, seat] of [["DM", dm], ["player", player]]) {
    const c = client();
    const progress = [];
    const stop = subscribeRoomLoading(() => progress.push(getRoomLoading()));
    const view = await c.pull({ data: { ...seat, tabletopProtocol: 11 } });
    stop();
    const full = await fullView(seat);
    assert.deepEqual(view.table, full, `the ${name}'s synced view equals the full protocol 10 view`);
    const largest = Math.max(...progress.filter(Boolean).map((p) => p.totalBytes));
    assert.ok(largest >= LOADING_SCREEN_BYTES, `the ${name}'s first load is large enough for the loading screen (${largest})`);
    assert.ok(c.fetched.calls >= 2, `fetched in ${c.fetched.calls} batches`);
    if (name === "player") assert.ok(!JSON.stringify(view.table).includes("DM-SECRET"), "DM-only entries never reach the player");

    // One chat line: the next poll transfers one chat chunk, not the campaign.
    c.fetched.chars = 0;
    await submitCommands({ ...dm, batchId: `line-${name}`, commands: [{ id: `line-${name}`, kind: "message", to: "party", purseId: "", text: `Hello ${name}` }] });
    let transferred = 0;
    const counted = c.sync.roomRead(async ({ data }) => {
      const result = await pollRoom(data);
      const response = "table" in result ? await roomViewResponse(result, data) : result;
      transferred = JSON.stringify(response).length;
      return response;
    });
    const next = await counted({ data: { ...seat, tabletopProtocol: 11, knownRevision: view.revision, knownSeatId: view.seatId } });
    assert.ok(next.table.notes.some((n) => n.id === `line-${name}`));
    assert.deepEqual(next.table, await fullView(seat));
    const total = JSON.stringify(full).length;
    assert.ok(transferred + c.fetched.chars < total / 20, `catch-up moved ${transferred + c.fetched.chars} of ${total} characters`);
  }
});

test("a 6 MB campaign round-trips at the storage and sync layers; the caps refuse what is too large", async () => {
  clearViewSectionCacheForTests();
  const dm = await openRoom({ name: "Huge DM", table: tradeFixture() });
  const room = await readRoom(dm.code);
  grow(room, 6_000_000);
  room.revision++;
  // Written below the application guard, as storage would hold it.
  const encoded = await encodeRoomImages(room);
  assert.ok(bytes(encoded.body) > ROOM_BODY_LIMIT);
  const write = roomWriteStatements(db, room, { expect: (await readStoredRoom(db, dm.code)).version, body: encoded.body });
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  assert.equal((await readStoredRoom(db, dm.code)).body, encoded.body, "stored byte for byte");
  const c = client();
  const view = await c.pull({ data: { ...dm, tabletopProtocol: 11 } });
  assert.deepEqual(view.table, await fullView(dm));
  // History on demand (step 4): a campaign's long ledger and chat are history pages, so only its
  // journal notes and newest lines count toward the working-set cap, and the rest toward the live
  // campaign cap. One just below the live cap saves.
  const current = await readRoom(dm.code);
  grow(current, ROOM_LIVE_LIMIT * 0.9, { prefix: "live" });
  current.table.journal.entries = current.table.journal.entries.slice(0, 100);
  current.table.notes.push({ id: "more", at: 1, from: "dm", to: "party", purseId: "", text: "One more" });
  const base = current.revision;
  current.revision++;
  await updateRoom(current, base);
  assert.ok((await readRoom(dm.code)).table.notes.some((n) => n.id === "more"));
  // Journal notes every read loads, above the working-set cap: refused, nothing changed.
  const stored = (await readStoredRoom(db, dm.code)).body;
  const heavy = await readRoom(dm.code);
  grow(heavy, 22_000_000, { prefix: "h" });
  heavy.table.ledger = heavy.table.ledger.slice(0, 10);
  heavy.table.notes = heavy.table.notes.slice(0, 10);
  heavy.revision++;
  await assert.rejects(updateRoom(heavy, heavy.revision - 1), (error) => error.status === 413 && /current records; the limit is 4\.0 MB/.test(error.message));
  // A current session's history above the live cap: refused, nothing changed.
  const long = await readRoom(dm.code);
  grow(long, ROOM_LIVE_LIMIT * 2, { prefix: "x" });
  long.table.journal.entries = [];
  long.revision++;
  await assert.rejects(updateRoom(long, long.revision - 1), (error) => error.status === 413 && /current session history is too large/.test(error.message) && /end the session/.test(error.message));
  assert.equal((await readStoredRoom(db, dm.code)).body, stored);
});

test("an archived session larger than a row is stored in parts and read back exactly", async () => {
  const dm = await openRoom({ name: "Report DM", table: tradeFixture() });
  const room = await readRoom(dm.code);
  const snapshot = JSON.stringify({ ...structuredClone(room.table), notes: [{ id: "n", at: 1, from: "dm", to: "party", purseId: "", text: "é漢😀 ".repeat(ROOM_ROW_LIMIT / 8) }] });
  room.table.journal.reports = [{ id: "huge-report", name: "Huge", at: 1, snapshot }];
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  const parts = (await db.prepare("SELECT part,length(CAST(body AS BLOB)) AS n FROM campaign_room_report_parts WHERE code=? ORDER BY part").bind(dm.code).all()).results;
  assert.ok(parts.length >= 2 && parts.every((p) => p.n <= 1_000_000), "stored in parts of at most 1 MB");
  const marker = (await db.prepare("SELECT body FROM campaign_room_reports WHERE code=?").bind(dm.code).first()).body;
  assert.ok(marker.length < 200 && marker.startsWith('{"$reportParts":'), "the report row keeps a small marker");
  assert.equal((await readRoom(dm.code)).table.journal.reports[0].snapshot, snapshot, "read back byte for byte");
  // A damaged part is never read as history.
  await db.prepare("UPDATE campaign_room_report_parts SET body=body||' ' WHERE code=? AND part=0").bind(dm.code).run();
  await assert.rejects(readRoom(dm.code), /incomplete/);
});
