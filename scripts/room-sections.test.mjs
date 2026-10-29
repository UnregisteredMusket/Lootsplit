// Sectioned shared-room storage (owner plan 2026-10-28, step 2b): a room above the inline threshold
// keeps its small top-level fields in campaign_rooms and its campaign parts in
// campaign_room_sections (cloudflare/room-storage.mjs). Every case uses a disposable local D1
// stand-in with every migration applied; never a real campaign or account.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import {
  ROOM_HISTORY_PAGE_ITEMS,
  ROOM_SECTION_MIN_BYTES,
  ROOM_SECTION_PART_BYTES,
  ROOM_SECTION_THRESHOLD,
  readMemberRooms,
  readRoomCore,
  readRoomSectionHashes,
  readRoomPaths,
  readRoomTables,
  readStoredRoom,
  readStoredRooms,
  roomDeleteStatement,
  roomSectionsDeletedStatement,
  roomStorageSizes,
  roomWriteStatements,
  setRoomSectionLimitsForTests,
} from "../cloudflare/room-storage.mjs";

// This file states its own limits: the production ones, even when the suites run with the
// LOOTSPLIT_TEST_ROOM_SECTION_* overrides that force every room write onto the sectioned path.
const DEFAULT_LIMITS = { threshold: ROOM_SECTION_THRESHOLD, min: ROOM_SECTION_MIN_BYTES, part: ROOM_SECTION_PART_BYTES, page: ROOM_HISTORY_PAGE_ITEMS };
setRoomSectionLimitsForTests(DEFAULT_LIMITS);

/** Every room's table fields, as site analytics iterates them. */
async function tablePage(db, fields) {
  const rows = [];
  for await (const row of readRoomTables(db, fields, { pageSize: 2 })) rows.push(row);
  return rows;
}
const bytes = (text) => new TextEncoder().encode(text).length;
const sectionRows = async (db, code) =>
  (await db.prepare("SELECT hash,part,length(CAST(body AS BLOB)) AS n FROM campaign_room_sections WHERE code=? ORDER BY hash,part").bind(code).all()).results;
const rawRow = (db, code) => db.prepare("SELECT revision,write_id,body FROM campaign_rooms WHERE code=?").bind(code).first();
/** Every hash the stored row's manifest references has all of its parts stored. */
async function assertComplete(db, code) {
  const row = await rawRow(db, code);
  const manifest = JSON.parse(row.body).$sections ?? [];
  const rows = await sectionRows(db, code);
  for (const entry of manifest)
    assert.equal(rows.filter((r) => r.hash === entry.hash).length, entry.parts, `section ${entry.path.join(".")} is complete`);
  return { manifest, rows };
}

const text = (n, seed) => `${seed} – é漢😀 `.repeat(Math.ceil(n / 16)).slice(0, n);
/** A large campaign: long ledger and chat, a big journal part and a test template, with multibyte text. */
function largeRoom(code, { ledger = 9000, notes = 3000, revision = 1 } = {}) {
  const table = {
    purses: [{ id: "party", name: "Party", kind: "party", coins: { cp: 1, sp: 0, ep: 0, gp: 5, pp: 0 } }],
    holdings: [],
    shops: [],
    stock: [],
    ledger: Array.from({ length: ledger }, (_, i) => ({ id: `l-${i}`, at: i, purseId: "party", shopId: null, summary: `Purchase ${i} ${text(40, "ledger")}`, copper: -1 - (i % 97), transactionType: "purchase" })),
    listings: [],
    loans: [],
    sheets: [],
    notes: Array.from({ length: notes }, (_, i) => ({ id: `n-${i}`, at: i, from: "dm", to: "party", purseId: "party", text: `Message ${i}: ${text(60, "chat")}` })),
    journal: {
      sessions: [{ id: "s", name: "Session", startedAt: 1 }],
      events: [],
      requests: [],
      tradeEconomy: { exchanges: Array.from({ length: 300 }, (_, i) => ({ id: `x-${i}`, name: text(150, "market") })) },
      world: { maps: [], npcs: [{ id: "spy", visible: false }] },
    },
  };
  return {
    code,
    revision,
    turn: 0,
    live: true,
    closed: false,
    ownerId: "owner",
    sessionId: "session-1",
    campaignName: "Saga ✨",
    seats: [{ id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [], userId: "owner" }],
    table,
    seen: { gifts: [], sales: [] },
    drafts: {},
    testTemplate: { ...table, ledger: [], notes: [] },
  };
}
const smallRoom = (code, revision = 1) => ({
  code,
  revision,
  turn: 0,
  live: true,
  ownerId: "owner",
  seats: [{ id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [] }],
  table: { purses: [], holdings: [], ledger: [], notes: [{ id: "hi", text: "Hello" }] },
  seen: { gifts: [], sales: [] },
});
async function create(db, room) {
  const write = roomWriteStatements(db, room, { create: true });
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  return write;
}

test("0026 is additive and the section reads use its primary key", () => {
  const sql = readFileSync(new URL("../cloudflare/migrations/0026_campaign_room_sections.sql", import.meta.url), "utf8");
  assert.equal(assertAdditiveSql("0026_campaign_room_sections.sql", sql), 1);
});

test("a room above the threshold is stored sectioned and round-trips byte for byte", async () => {
  const db = localAccountDb();
  const room = largeRoom("BIG");
  const body = JSON.stringify(room);
  assert.ok(bytes(body) > ROOM_SECTION_THRESHOLD, "the fixture is above the inline threshold");
  const write = await create(db, room);
  const row = await rawRow(db, "BIG");
  assert.ok(row.body.startsWith('{"$sections":'), "the manifest leads the row");
  assert.ok(bytes(row.body) < 20_000, `the row keeps only small fields (${bytes(row.body)} bytes)`);
  const parsedRow = JSON.parse(row.body);
  assert.equal(parsedRow.table, null, "code that predates sectioning sees no table and fails loudly");
  assert.deepEqual(parsedRow.seats, room.seats, "seats stay on the row for light reads and SQL guards");
  const { manifest, rows } = await assertComplete(db, "BIG");
  const paths = manifest.map((entry) => entry.path.join("."));
  for (const path of ["table", "table.ledger", "table.notes", "table.journal.tradeEconomy", "testTemplate"])
    assert.ok(paths.includes(path), `${path} is its own section`);
  assert.ok(!paths.includes("table.purses"), "small parts stay in their parent section");
  assert.ok(rows.every((r) => r.n <= ROOM_SECTION_PART_BYTES), "every part fits the part size");
  // Step 4: the long ledger and chat are cut into sealed history pages of 512 lines; the room
  // keeps the newest one to two pages (a window of its own section here).
  const pages = (list) => manifest.filter((e) => e.path.join(".") === `$history.table.${list}`);
  assert.deepEqual(pages("ledger").map((e) => e.page), Array.from({ length: Math.floor(9000 / 512) - 1 }, (_, i) => i), "the ledger is paged");
  assert.ok(pages("ledger").every((e) => e.items === 512));
  assert.equal(pages("notes").length, Math.floor(3000 / 512) - 1, "the chat is paged");
  const read = await readStoredRoom(db, "BIG");
  assert.equal(read.body, body, "the stored body is byte-identical");
  assert.deepEqual(read.room, room);
  assert.deepEqual(read.version, write.version);
  const sizes = roomStorageSizes(body);
  assert.deepEqual(sizes, {
    sectioned: true,
    bytes: bytes(body),
    workingBytes: sizes.workingBytes,
    historyBytes: [...pages("ledger"), ...pages("notes")].reduce((sum, e) => sum + e.bytes, 0),
    liveBytes: sizes.workingBytes + sizes.historyBytes,
    rowBytes: bytes(row.body),
    sectionBytes: sizes.sectionBytes,
    sections: new Set(manifest.map((e) => e.hash)).size,
    pages: pages("ledger").length + pages("notes").length,
  });
  assert.ok(Math.abs(sizes.liveBytes - bytes(body)) < bytes(body) / 50, "working set and history pages add up to the campaign");
  // Light reads never touch sections.
  const queries = [];
  const metered = { ...db, prepare: (sql) => (queries.push(sql), db.prepare(sql)) };
  const core = await readRoomCore(metered, "BIG");
  assert.equal(core.campaignName, "Saga ✨");
  assert.deepEqual(core.seats, room.seats);
  assert.ok(!queries.some((q) => /campaign_room_sections/.test(q)));
});

test("parts split on character boundaries, never inside a multibyte character", async () => {
  const db = localAccountDb();
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, part: 7 });
  try {
    const room = smallRoom("TINY");
    room.table.notes = [{ id: "u", text: "é漢😀".repeat(50) + "x" }, { id: "v", text: "\ud800 lone surrogate" }];
    room.campaignName = "名前";
    await create(db, room);
    const { rows } = await assertComplete(db, "TINY");
    assert.ok(rows.length > 20, "many small parts");
    assert.ok(rows.every((r) => r.n <= 7));
    const read = await readStoredRoom(db, "TINY");
    assert.equal(read.body, JSON.stringify(room));
    assert.deepEqual(read.room, room);
  } finally {
    setRoomSectionLimitsForTests(DEFAULT_LIMITS);
  }
});

test("an inline room is stored and read exactly as before, and old inline rows read unchanged", async () => {
  const db = localAccountDb();
  const room = smallRoom("SMALL");
  const write = await create(db, room);
  assert.equal(write.statements.length, 1, "an inline create is one statement, as before");
  assert.equal((await rawRow(db, "SMALL")).body, JSON.stringify(room));
  assert.deepEqual(await sectionRows(db, "SMALL"), []);
  const read = await readStoredRoom(db, "SMALL");
  assert.equal(read.version.sections, null);
  // An inline update of an inline read is the row write plus the (indexed, usually empty) orphan
  // cleanup guarded on its write_id (step 3: cleanup no longer trusts that an inline read means
  // no section rows exist).
  const next = roomWriteStatements(db, { ...read.room, revision: 2 }, { expect: read.version });
  assert.equal(next.statements.length, 2);
  // A row written before migration 0024 (no write_id) by an older server.
  const legacy = { ...smallRoom("LEGACY"), commands: ["dm:old"], table: { purses: [{ id: "p", coins: { gp: 1 } }] } };
  await db.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,?,?)").bind("LEGACY", 3, JSON.stringify(legacy)).run();
  const old = await readStoredRoom(db, "LEGACY");
  assert.equal(old.body, JSON.stringify(legacy));
  assert.deepEqual(old.room, legacy);
  assert.equal(old.version.writeId, null);
  const page = await tablePage(db, ["purses", "ledger"]);
  assert.deepEqual(page.find((r) => r.code === "LEGACY").fields, { purses: JSON.stringify(legacy.table.purses), ledger: null });
});

test("a write uploads only the sections whose content changed", async () => {
  const db = localAccountDb();
  await create(db, largeRoom("DELTA"));
  const read = await readStoredRoom(db, "DELTA");
  const before = await sectionRows(db, "DELTA");
  const next = structuredClone(read.room);
  next.revision = 2;
  next.table.notes.push({ id: "new", at: 1e6, from: "dm", to: "party", purseId: "party", text: "One more line" });
  const write = roomWriteStatements(db, next, { expect: read.version });
  const notes = write.version.sections.find((e) => e.path.join(".") === "table.notes");
  // The row, the changed chat section's parts, and the cleanup of what it replaced (sections, and
  // the line IDs of history pages it no longer references, step 4).
  assert.equal(write.statements.length, 1 + notes.parts + 2);
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  const after = await sectionRows(db, "DELTA");
  assert.equal(after.length, before.length, "the replaced chat section was removed, nothing else changed");
  const unchanged = before.filter((r) => after.some((a) => a.hash === r.hash && a.part === r.part));
  assert.equal(unchanged.length, before.length - notes.parts);
  assert.deepEqual((await readStoredRoom(db, "DELTA")).room, next);
  await assertComplete(db, "DELTA");

  // A revision-only writer (updateRoom) passes the stored hashes it read, with the same effect.
  const again = structuredClone(next);
  again.revision = 3;
  again.table.notes.at(-1).text = "Edited";
  const present = await readRoomSectionHashes(db, "DELTA");
  const revisionOnly = roomWriteStatements(db, again, { expect: { revision: 2 }, present });
  assert.equal(revisionOnly.statements.length, 1 + notes.parts + 2);
  assert.equal(revisionOnly.changed(await db.batch(revisionOnly.statements), revisionOnly.statements), true);
  assert.deepEqual((await readStoredRoom(db, "DELTA")).room, again);
  // Without what is stored, every section is sent again (still correct, never duplicated).
  const blind = roomWriteStatements(db, { ...again, revision: 4 }, { expect: { revision: 3 } });
  assert.ok(blind.statements.length > revisionOnly.statements.length);
  assert.equal(blind.changed(await db.batch(blind.statements), blind.statements), true);
  const blindRows = await sectionRows(db, "DELTA");
  assert.equal(new Set(blindRows.map((r) => `${r.hash}:${r.part}`)).size, blindRows.length, "no part stored twice");
  await assertComplete(db, "DELTA");
});

test("a write that loses its race leaves the stored room unchanged, readable and complete", async () => {
  const db = localAccountDb();
  await create(db, largeRoom("RACE"));
  const read = await readStoredRoom(db, "RACE");
  const first = structuredClone(read.room);
  first.revision = 2;
  first.table.ledger.push({ id: "winner", at: 1, purseId: "party", shopId: null, summary: "Winner", copper: -1, transactionType: "purchase" });
  const second = structuredClone(read.room);
  second.revision = 2;
  second.table.notes.push({ id: "loser", at: 1, from: "dm", to: "party", purseId: "party", text: "Lost" });
  const a = roomWriteStatements(db, first, { expect: read.version });
  const b = roomWriteStatements(db, second, { expect: read.version });
  assert.equal(a.changed(await db.batch(a.statements), a.statements), true);
  const rowsAfterWinner = await sectionRows(db, "RACE");
  assert.equal(b.changed(await db.batch(b.statements), b.statements), false);
  assert.deepEqual(await sectionRows(db, "RACE"), rowsAfterWinner, "the loser stored and deleted nothing");
  const stored = await readStoredRoom(db, "RACE");
  assert.deepEqual(stored.room, first);
  assert.deepEqual(stored.version, a.version);
  await assertComplete(db, "RACE");

  // A revision-only writer whose idea of the stored sections is stale is refused, not written
  // with a missing part.
  const stale = new Map((read.version.sections ?? []).map((e) => [e.hash, e.parts]));
  const lateWrite = structuredClone(read.room);
  lateWrite.revision = 3;
  const late = roomWriteStatements(db, lateWrite, { expect: { revision: 2 }, present: stale });
  assert.equal(late.changed(await db.batch(late.statements), late.statements), false);
  assert.deepEqual((await readStoredRoom(db, "RACE")).room, first);
  await assertComplete(db, "RACE");
});

test("a room moves between inline and sectioned as it grows and shrinks", async () => {
  const db = localAccountDb();
  await create(db, smallRoom("GROW"));
  let read = await readStoredRoom(db, "GROW");
  const big = { ...largeRoom("GROW"), revision: 2 };
  let write = roomWriteStatements(db, big, { expect: read.version });
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  read = await readStoredRoom(db, "GROW");
  assert.notEqual(read.version.sections, null);
  assert.deepEqual(read.room, big);
  assert.ok((await sectionRows(db, "GROW")).length > 0);
  // Shrinks below the threshold (for example after a session is archived): inline again, and
  // its sections are removed in the same batch.
  const small = { ...smallRoom("GROW"), revision: 3 };
  write = roomWriteStatements(db, small, { expect: { revision: 2 } });
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  assert.equal((await rawRow(db, "GROW")).body, JSON.stringify(small));
  assert.deepEqual(await sectionRows(db, "GROW"), []);
  assert.deepEqual((await readStoredRoom(db, "GROW")).room, small);
});

test("raw writers that predate sectioning keep a sectioned room intact", async () => {
  // A previous-release raw writer (account link, character play) parses the row, edits its own
  // top-level field and writes the row back: the manifest and placeholders survive.
  const db = localAccountDb();
  const room = largeRoom("OLDCODE");
  await create(db, room);
  const row = await rawRow(db, "OLDCODE");
  const parsed = JSON.parse(row.body);
  parsed.seats[0].userId = "linked";
  parsed.revision = 2;
  await db
    .prepare("UPDATE campaign_rooms SET revision=?,body=?,write_id=? WHERE code=? AND revision=1")
    .bind(2, JSON.stringify(parsed), "old-release-write", "OLDCODE")
    .run();
  const read = await readStoredRoom(db, "OLDCODE");
  assert.equal(read.room.seats[0].userId, "linked");
  assert.deepEqual(read.room.table, room.table, "the campaign is still assembled from its sections");
  // A full inline body written over it (the previous release's form) is read as written.
  const inline = { ...smallRoom("OLDCODE"), revision: 3 };
  await db.prepare("UPDATE campaign_rooms SET revision=3,body=?,write_id='old-inline' WHERE code=?").bind(JSON.stringify(inline), "OLDCODE").run();
  assert.deepEqual((await readStoredRoom(db, "OLDCODE")).room, inline);
  // The orphaned sections go with the next write of unknown previous form, or with the room.
  const next = roomWriteStatements(db, { ...inline, revision: 4 }, { expect: { revision: 3 } });
  await db.batch(next.statements);
  assert.deepEqual(await sectionRows(db, "OLDCODE"), []);
});

test("a 5 MB campaign can be stored and read at the storage layer (step 3 can raise the cap)", async () => {
  const db = localAccountDb();
  const room = largeRoom("HUGE", { ledger: 30_000, notes: 12_000 });
  const body = JSON.stringify(room);
  assert.ok(bytes(body) > 5_000_000, `${bytes(body)} bytes`);
  const write = await create(db, room);
  assert.ok(write.statements.length > 5);
  const row = await rawRow(db, "HUGE");
  assert.ok(bytes(row.body) < 20_000);
  const { rows } = await assertComplete(db, "HUGE");
  assert.ok(rows.every((r) => r.n <= ROOM_SECTION_PART_BYTES), "every row stays far below D1's 2 MB");
  const read = await readStoredRoom(db, "HUGE");
  assert.equal(read.body, body);
});

test("multi-room and member reads assemble sectioned rooms, and re-read one replaced in between", async () => {
  const db = localAccountDb();
  await create(db, largeRoom("MANY1"));
  await create(db, smallRoom("MANY2"));
  for (const code of ["MANY1", "MANY2"])
    await db
      .prepare("INSERT INTO library_members(user_id,code,seat_id,token,name,archived,updated_at) VALUES ('owner',?,'dm','dm-token','Campaign',0,0)")
      .bind(code)
      .run()
      .catch(async () => {
        await db.prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('owner','Owner','owner@example.com',0,0,0)").run();
        await db.prepare("INSERT INTO library_members(user_id,code,seat_id,token,name,archived,updated_at) VALUES ('owner',?,'dm','dm-token','Campaign',0,0)").bind(code).run();
      });
  const rooms = await readStoredRooms(db, ["MANY1", "MANY2", "NONE"]);
  assert.deepEqual([...rooms.keys()].sort(), ["MANY1", "MANY2"]);
  assert.deepEqual(rooms.get("MANY1").room, largeRoom("MANY1"));
  const members = await readMemberRooms(db, "owner");
  assert.deepEqual(members.map((m) => m.stored.room.code).sort(), ["MANY1", "MANY2"]);
  assert.deepEqual(members.find((m) => m.member.code === "MANY1").stored.room, largeRoom("MANY1"));
  // A write lands between the row read and the section read: the room is read again consistently.
  const current = await readStoredRoom(db, "MANY1");
  const changed = structuredClone(current.room);
  changed.revision = 2;
  changed.table.ledger = changed.table.ledger.slice(1);
  changed.table.notes = changed.table.notes.slice(1);
  let raced = false;
  const racing = {
    ...db,
    prepare(sql) {
      if (!raced && /FROM campaign_room_sections WHERE code=\? AND hash IN \(SELECT value/.test(sql)) {
        raced = true;
        const write = roomWriteStatements(db, changed, { expect: current.version });
        return { bind: () => ({ all: async () => (await db.batch(write.statements), db.prepare(sql).bind("MANY1", "[]").all()) }) };
      }
      return db.prepare(sql);
    },
  };
  const reread = await readStoredRooms(racing, ["MANY1"]);
  assert.equal(raced, true);
  assert.deepEqual(reread.get("MANY1").room, changed);
  // Table pages for site analytics read the same parts from either form.
  const page = await tablePage(db, ["ledger", "purses", "journal"]);
  const many1 = page.find((r) => r.code === "MANY1");
  assert.equal(many1.fields.ledger, JSON.stringify(changed.table.ledger));
  assert.equal(many1.fields.journal, JSON.stringify(changed.table.journal));
});

test("deleting a sectioned room removes its sections, only once the room is gone", async () => {
  const db = localAccountDb();
  await create(db, largeRoom("GONE"));
  const read = await readStoredRoom(db, "GONE");
  const stale = { revision: 0 };
  const [refused] = await db.batch([roomDeleteStatement(db, "GONE", { expect: stale }), roomSectionsDeletedStatement(db, "GONE")]);
  assert.equal(refused.meta.changes, 0);
  assert.ok((await sectionRows(db, "GONE")).length > 0, "a refused delete keeps every section");
  await db.batch([roomDeleteStatement(db, "GONE", { expect: read.version }), roomSectionsDeletedStatement(db, "GONE")]);
  assert.equal(await readStoredRoom(db, "GONE"), null);
  assert.deepEqual(await sectionRows(db, "GONE"), []);
});

test("delete with backup, restore and test-mode reset work on sectioned rooms", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db, HOSTED_CAMPAIGN_LIMIT: "100" };
  const { openRoom, submitCommands, roomState } = await import("../src/lib/quire/cloud.server.ts");
  const { readRoom, deleteRoom } = await import("../src/lib/quire/room-store.server.ts");
  const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
  const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
  const { restoreDeletedCampaign } = await import("../cloudflare/campaign-recovery.mjs");
  const { ownerTestMode } = await import("../cloudflare/test-mode.mjs");
  const { readCloudTableForImport } = await import("../src/lib/quire/cloud.ts");
  const userId = "sections-dm",
    actor = { id: "sections-session" };
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM','sections-dm@example.com',1,null,0,0)`).bind(userId).run();
  await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'sections-session-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
  await db.prepare("INSERT INTO site_roles(user_id,role,granted_at) VALUES (?,'owner',0)").bind(userId).run();
  setRoomSectionLimitsForTests({ threshold: 0, min: 0 });
  try {
    // Play a little in a sectioned room: chat and a money transfer.
    const dm = await openRoom({ name: "Sectioned DM", table: tradeFixture(), userId });
    await submitCommands({ ...dm, batchId: "chat", commands: [{ id: "chat-1", kind: "message", to: "party", purseId: "", text: "Hello" }] });
    assert.ok((await sectionRows(db, dm.code)).length > 1, "the room is stored sectioned");
    await assertComplete(db, dm.code);
    assert.ok((await roomState(dm)).table.notes.some((n) => n.id === "chat-1"));
    // Delete with its recovery backup: the backup holds the whole assembled campaign.
    const before = await readRoom(dm.code);
    const deleted = await campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision: before.revision }, actor);
    assert.equal(deleted.ok, true);
    assert.equal(await readStoredRoom(db, dm.code), null);
    assert.deepEqual(await sectionRows(db, dm.code), [], "the deleted room's sections are gone");
    const backup = JSON.parse((await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first()).body);
    assert.ok(backup.notes.some((n) => n.id === "chat-1"), "the backup carries the campaign's messages");
    assert.deepEqual(backup.ledger, before.table.ledger);
    assert.deepEqual(backup.purses.map((p) => p.coins), before.table.purses.map((p) => p.coins));
    // Restore it into a new sectioned room.
    const restored = await restoreDeletedCampaign(db, userId, { id: deleted.backupId, requestKey: crypto.randomUUID() }, actor);
    const room = await readRoom(restored.code);
    assert.ok((await sectionRows(db, restored.code)).length > 1);
    await assertComplete(db, restored.code);
    assert.deepEqual(room.table.ledger, readCloudTableForImport(structuredClone(backup)).ledger);
    await deleteRoom(restored.code, room.revision);
    assert.deepEqual(await sectionRows(db, restored.code), []);
    // Owner Test mode: create, change, reset; the reset restores the template from its section.
    const testRoom = await ownerTestMode(db, userId, { action: "create", characters: 2, gold: 20, hp: 15 }, actor.id);
    const stored = await readStoredRoom(db, testRoom.code);
    assert.notEqual(stored.version.sections, null);
    const changed = structuredClone(stored.room);
    changed.table.ledger.push({ id: "fake", purseId: changed.table.purses[0].id, at: 1, shopId: null, summary: "purchase", copper: -100, transactionType: "purchase" });
    changed.revision++;
    await db.batch(roomWriteStatements(db, changed, { expect: stored.version }).statements);
    await ownerTestMode(db, userId, { action: "reset", code: testRoom.code, revision: changed.revision }, actor.id);
    const reset = (await readStoredRoom(db, testRoom.code)).room;
    assert.deepEqual(reset.table.ledger, []);
    assert.deepEqual(reset.table, reset.testTemplate);
    await assertComplete(db, testRoom.code);
  } finally {
    setRoomSectionLimitsForTests(DEFAULT_LIMITS);
    delete globalThis.__env__;
  }
});

test("partial reads return only the requested values, from only the sections that hold them (step 3)", async () => {
  const db = localAccountDb();
  const room = largeRoom("PART");
  room.table.journal.world = {
    maps: [{ id: "m1", name: "Keep", image: "/art/room-image-" + "a".repeat(64) + ".webp", tokens: [{ id: "t" }] }, { id: "m2", name: "Road", image: "x" }],
    npcs: [{ id: "spy", visible: false }],
    characterPositions: [],
    tabletop: { activeMapId: "m1" },
    filler: text(40_000, "world"),
  };
  await create(db, room);
  const manifest = JSON.parse((await rawRow(db, "PART")).body).$sections;
  assert.ok(manifest.some((e) => e.path.join(".") === "table.journal.world"), "the world is its own section");
  // Count what each statement returns to the Worker.
  let received = 0;
  const seen = new Set();
  const counting = {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          statement.bind(...args);
          return this;
        },
        async first() {
          const row = await statement.first();
          received += bytes(JSON.stringify(row ?? null));
          return row;
        },
        async all() {
          const rows = await statement.all();
          received += bytes(JSON.stringify(rows.results));
          for (const row of rows.results) if (row.hash) seen.add(row.hash);
          return rows;
        },
      };
    },
  };
  const read = await readRoomPaths(
    counting,
    "PART",
    [
      { path: ["seats"] },
      { path: ["table", "purses"] },
      { path: ["table", "journal", "world", "tabletop"] },
      {
        path: ["table", "journal", "world"],
        sql: (source, at, arg) =>
          `SELECT json_remove(m.value,'$.image','$.tokens') FROM json_each(${source},${at}||'.maps') m WHERE json_extract(m.value,'$.id')=${arg(0)} LIMIT 1`,
      },
      { path: ["table", "missing"] },
    ],
    ["m1"],
  );
  assert.deepEqual(read.values, [room.seats, room.table.purses, { activeMapId: "m1" }, { id: "m1", name: "Keep" }, null]);
  assert.equal(read.version.revision, 1);
  // The row's manifest lists the history pages too (step 4), about 150 bytes each.
  assert.ok(received < 8_000, `a map-signal style read receives ${received} bytes of a ${bytes(JSON.stringify(room))}-byte room`);

  // A value with larger parts split out below it (the journal) is assembled from just those sections.
  received = 0;
  const journal = await readRoomPaths(counting, "PART", [{ path: ["table", "journal"] }, { path: ["table", "ledger"] }]);
  assert.deepEqual(journal.values, [room.table.journal, room.table.ledger]);
  const notesHash = manifest.find((e) => e.path.join(".") === "table.notes").hash;
  const templateHash = manifest.find((e) => e.path.join(".") === "testTemplate").hash;
  assert.ok(!seen.has(notesHash) && !seen.has(templateHash), "the chat and test template sections are never read");
  // Inline rooms answer the same reads in one statement.
  await create(db, smallRoom("PSMALL"));
  const small = await readRoomPaths(db, "PSMALL", [{ path: ["table", "notes"] }, { path: ["table", "journal", "world"] }]);
  assert.deepEqual(small.values, [[{ id: "hi", text: "Hello" }], null]);
  assert.equal(small.version.sections, null);
  assert.equal(await readRoomPaths(db, "NOPE", [{ path: ["seats"] }]), null);
  await assert.rejects(readRoomPaths(db, "PART", [{ path: ["table", "x') --"] }]), /Invalid room path/);
});

test("a partial read is consistent: a write landing in between is re-read", async () => {
  const db = localAccountDb();
  await create(db, largeRoom("PRACE"));
  const current = await readStoredRoom(db, "PRACE");
  const changed = structuredClone(current.room);
  changed.revision = 2;
  changed.table.ledger = changed.table.ledger.slice(5);
  let raced = false;
  const racing = {
    ...db,
    prepare(sql) {
      if (!raced && sql.includes("UNION ALL") && sql.includes("'p'")) {
        raced = true;
        const write = roomWriteStatements(db, changed, { expect: current.version });
        return { bind: (...args) => ({ all: async () => (await db.batch(write.statements), db.prepare(sql).bind(...args).all()) }) };
      }
      return db.prepare(sql);
    },
  };
  const read = await readRoomPaths(racing, "PRACE", [{ path: ["table", "ledger"] }]);
  assert.equal(raced, true);
  assert.equal(read.version.revision, 2);
  assert.deepEqual(read.values[0], changed.table.ledger);
});

test("orphaned sections are removed by the next committed write, even after an inline read", async () => {
  const db = localAccountDb();
  await create(db, largeRoom("ORPH"));
  // A previous-release Worker writes the whole room inline over the sectioned one.
  const whole = structuredClone((await readStoredRoom(db, "ORPH")).room);
  whole.revision = 2;
  whole.table.ledger = [];
  whole.table.notes = [];
  whole.testTemplate = null;
  whole.table.journal.tradeEconomy = { exchanges: [] };
  await db.prepare("UPDATE campaign_rooms SET revision=2,body=?,write_id='old-release' WHERE code=?").bind(JSON.stringify(whole), "ORPH").run();
  assert.ok((await sectionRows(db, "ORPH")).length > 0, "orphans remain after the old-release write");
  const read = await readStoredRoom(db, "ORPH");
  assert.equal(read.version.sections, null, "the room now reads inline");
  // A losing write (stale version) deletes nothing.
  const stale = roomWriteStatements(db, { ...read.room, revision: 3 }, { expect: { ...read.version, writeId: "someone-else" } });
  assert.equal(stale.changed(await db.batch(stale.statements), stale.statements), false);
  assert.ok((await sectionRows(db, "ORPH")).length > 0);
  const write = roomWriteStatements(db, { ...read.room, revision: 3 }, { expect: read.version });
  assert.equal(write.changed(await db.batch(write.statements), write.statements), true);
  assert.deepEqual(await sectionRows(db, "ORPH"), [], "the next committed inline write removed the orphans");
});
