// Streaming whole-campaign files (campaign-file-stream.mjs): Download a copy and the deletion
// recovery copy are produced one archived session at a time, byte for byte the file they were when
// built at once (with history pages, delta-stored and parts-stored sessions, map images inside
// sessions); a damaged session refuses the file with nothing sent; parts built from chunks equal
// parts built from the whole text. Disposable local D1 stand-in; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, submitCommands, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { readStoredRoom, setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
const { hydrateRoomImages } = await import("../cloudflare/room-images.mjs");
const { projectRecord } = await import("../src/lib/quire/session-records.ts");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
const { campaignFileStream } = await import("../cloudflare/campaign-file-stream.mjs");
const { backupParts, backupPartsFromChunks, readBackupPayload } = await import("../cloudflare/backup-parts.mjs");
const { setReportDeltasForTests, REPORT_DELTA_WRITES } = await import("../cloudflare/room-reports.mjs");
// Archived sessions stored as deltas too (the writer release), so streaming is checked with both.
setReportDeltasForTests(true);
test.after(() => setReportDeltasForTests(REPORT_DELTA_WRITES));

setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 32 });
test.after(() => setRoomSectionLimitsForTests({}));

// A fixed clock, so `exportedAt` is the same in both constructions.
const realNow = Date.now;
const fixed = () => {
  Date.now = () => 1_800_000_000_000;
};
test.after(() => {
  Date.now = realNow;
});

/** The file as it was built before streaming: the whole campaign hydrated and projected at once. */
async function wholeFile(code, wrapName) {
  const { room } = await readStoredRoom(db, code);
  const seat = room.seats.find((s) => s.role === "dm");
  const projected = projectRecord(await hydrateRoomImages(db, room.code, room.table), seat);
  const file = {
    ...projected,
    kind: "quire",
    version: 2,
    exportedAt: Date.now(),
    settings: room.table.realm,
    notes: (room.table.notes || []).filter((note) => note.to !== "player"),
    books: [],
    articles: [],
  };
  return JSON.stringify(wrapName === undefined ? file : { payload: file, name: wrapName });
}

let users = 0;
async function account() {
  const userId = `stream-user-${++users}`;
  const actor = { id: `stream-session-${users}` };
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?, 'S', ?, 1, null, 0, 0)`).bind(userId, `stream-${users}@example.com`).run();
  await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,?,0,0,?)`).bind(actor.id, new Date(realNow() + 86_400_000).toISOString(), `stream-token-${users}`, userId).run();
  return { userId, actor };
}
async function campaign(userId, sessions, lines = 120, entries = 200) {
  const table = tradeFixture();
  table.journal = { ...(table.journal ?? {}), entries: Array.from({ length: entries }, (_, i) => ({ id: `e-${i}`, at: i, authorId: "dm", purseId: "", visibility: i % 3 ? "party" : "dm", title: `Entry ${i}`, text: "Lore ".repeat(40), reportIds: [] })) };
  const dm = await openRoom({ name: "Stream DM", table, userId });
  const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
  const sessionId = (await readRoom(dm.code)).sessionId;
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "Arden", sessionId });
  await choosePace({ ...dm, live: true });
  const seatA = { code: dm.code, token: a.token };
  for (let n = 1; n <= sessions; n++) {
    await submitCommands({ ...dm, batchId: `s-${n}`, commands: [{ id: `s-${n}`, kind: "session", name: `Session ${n}`, end: false }] });
    for (let i = 0; i < lines; i += 60)
      await submitCommands({ ...seatA, batchId: `c-${n}-${i}`, commands: Array.from({ length: 60 }, (_, k) => ({ id: `m-${n}-${i + k}`, kind: "message", to: k % 7 ? "party" : "dm", purseId: "a", text: `Session ${n} line ${i + k}: ${"ü".repeat(30)}` })) });
    await submitCommands({ ...dm, batchId: `g-${n}`, commands: Array.from({ length: 40 }, (_, k) => ({ id: `g-${n}-${k}`, kind: "give", fromId: "a", toId: "b", copper: 1, holdingId: null, quantity: 0 })) });
    await submitCommands({ ...dm, batchId: `e-${n}`, commands: [{ id: `e-${n}`, kind: "session", name: `Session ${n}`, end: true }] });
  }
  await submitCommands({ ...seatA, batchId: "tail", commands: Array.from({ length: 50 }, (_, k) => ({ id: `t-${k}`, kind: "message", to: "party", purseId: "a", text: `Current ${k}` })) });
  return dm;
}

test("parts built from chunks are exactly the parts of the whole text", async () => {
  const text = JSON.stringify({ a: "x".repeat(1_200_000), b: "é€😀".repeat(400_000), c: [1, 2, 3] });
  const whole = backupParts(text);
  for (const size of [997, 65_536, 999_999, 1_000_001, 3_000_000]) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    // Never split a surrogate pair across chunks (the stream never does: it yields whole JSON values).
    const safe = chunks.reduce((list, chunk) => {
      const last = list.at(-1);
      if (last && /[\ud800-\udbff]$/.test(last)) list[list.length - 1] = last + chunk;
      else list.push(chunk);
      return list;
    }, []);
    const built = await backupPartsFromChunks((async function* () { yield* safe; })());
    assert.equal(built.text, null);
    assert.deepEqual(built.chunked, whole, `chunk size ${size}`);
  }
  const small = await backupPartsFromChunks((async function* () { yield "{"; yield '"a":1}'; })());
  assert.deepEqual(small, { text: '{"a":1}', chunked: null });
});

test("Download a copy streams byte for byte the file it was, with paged history and delta-stored sessions", async () => {
  const { userId, actor } = await account();
  const dm = await campaign(userId, 4);
  fixed();
  try {
    const response = await campaignAction(db, userId, { action: "export", code: dm.code }, actor);
    assert.ok(response instanceof Response);
    assert.equal(response.headers.get("content-type"), "application/json");
    const streamed = await response.text();
    const expected = await wholeFile(dm.code, (await db.prepare("SELECT name FROM library_members WHERE user_id=? AND code=?").bind(userId, dm.code).first()).name);
    assert.equal(streamed, expected);
    const payload = JSON.parse(streamed).payload;
    assert.equal(payload.journal.reports.length, 4);
    assert.ok(payload.journal.reports.every((r) => JSON.parse(r.snapshot).notes.length > 0), "every archived session complete");
  } finally {
    Date.now = realNow;
  }
});

test("the deletion copy is the same file, stored in parts when large, and reads back exactly", async () => {
  const { userId, actor } = await account();
  const dm = await campaign(userId, 1, 60, 4000);
  fixed();
  let expected;
  try {
    expected = await wholeFile(dm.code);
    const revision = (await readStoredRoom(db, dm.code)).version.revision;
    const deleted = await campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision }, actor);
    assert.equal(deleted.ok, true);
    const row = await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first();
    assert.ok(row.body.startsWith('{"$backupParts":'), "large enough to be stored in parts");
    const parts = await db.prepare("SELECT body FROM library_backup_parts WHERE backup_id=? ORDER BY part").bind(deleted.backupId).all();
    assert.equal(parts.results.map((p) => p.body).join(""), expected, "the stored campaign text is byte for byte the file");
    const payload = await readBackupPayload(db, deleted.backupId, row.body);
    assert.ok(payload.campaignRecovery, "with its recovery records");
  } finally {
    Date.now = realNow;
  }
});

test("a damaged archived session refuses the file before anything is sent, and nothing is deleted", async () => {
  const { userId, actor } = await account();
  const dm = await campaign(userId, 2);
  const [first] = (await db.prepare("SELECT reference FROM campaign_room_reports WHERE code=? ORDER BY rowid").bind(dm.code).all()).results;
  await db.prepare("UPDATE campaign_room_reports SET body='{\"broken\":' WHERE code=? AND reference=?").bind(dm.code, first.reference).run();
  await assert.rejects(campaignAction(db, userId, { action: "export", code: dm.code }, actor), /cannot be safely backed up/);
  const revision = (await readStoredRoom(db, dm.code)).version.revision;
  await assert.rejects(campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision }, actor), /cannot be safely backed up/);
  assert.ok(await readStoredRoom(db, dm.code), "the campaign is kept");
});

test("streaming holds one archived session at a time", async () => {
  const { userId } = await account();
  const dm = await campaign(userId, 3);
  const { room } = await readStoredRoom(db, dm.code);
  const seat = room.seats.find((s) => s.role === "dm");
  const file = await campaignFileStream(db, room, seat, (projected) => projected);
  let reads = 0;
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/FROM campaign_room_reports WHERE code=\? AND reference IN/.test(sql)) reads++;
    return realPrepare(sql);
  };
  try {
    const chunks = [];
    for await (const chunk of file.chunks()) chunks.push({ chunk, reads });
    // Each archived session is read just before its own chunk, not all up front.
    const reportChunks = chunks.filter((c) => c.chunk.includes('"snapshot":"{'));
    assert.equal(reportChunks.length, 3);
    // (A delta-stored session also reads its base: one or two reads per session.)
    assert.ok(reportChunks[0].reads >= 1 && reportChunks[0].reads <= 2, "only the first session read before its chunk");
    for (let i = 1; i < reportChunks.length; i++) {
      const step = reportChunks[i].reads - reportChunks[i - 1].reads;
      assert.ok(step >= 1 && step <= 2, "each further session read just before its own chunk");
    }
  } finally {
    db.prepare = realPrepare;
  }
});
