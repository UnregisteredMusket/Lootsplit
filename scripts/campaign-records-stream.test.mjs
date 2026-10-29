// Streamed account records (campaign-records.mjs, storage follow-up (c)): Account → Session
// records is produced one archived session at a time, byte for byte the response it was when every
// member campaign was hydrated whole (DM and player seats, banned and departed seats, sessions a
// seat was not in, map images inside sessions, delta-stored sessions, an unreadable session, the
// old-app protocol conversion); everything that refused the old read still refuses before the
// first byte. Disposable local D1 stand-in; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";

const db = localAccountDb();
globalThis.__env__ = { DB: db };
const { openRoom, joinRoom, submitCommands, choosePace } = await import("../src/lib/quire/cloud.server.ts");
const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
const { setRoomSectionLimitsForTests } = await import("../cloudflare/room-storage.mjs");
const { hydrateRoomImages } = await import("../cloudflare/room-images.mjs");
const { readMemberRooms } = await import("../cloudflare/room-storage.mjs");
const { readArchivedSnapshot } = await import("../src/lib/quire/journal.ts");
const { projectRecord } = await import("../src/lib/quire/session-records.ts");
const { tableForProtocol } = await import("../src/lib/quire/tabletop-protocol.ts");
const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
const { campaignRecordsStream } = await import("../cloudflare/campaign-records.mjs");
const { streamedJson } = await import("../cloudflare/campaign-file-stream.mjs");
const { setReportDeltasForTests, REPORT_DELTA_WRITES } = await import("../cloudflare/room-reports.mjs");
setReportDeltasForTests(true);
test.after(() => setReportDeltasForTests(REPORT_DELTA_WRITES));
setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 32 });
test.after(() => setRoomSectionLimitsForTests({}));

/** The response as the route built it before streaming: every member campaign hydrated whole. */
async function wholeRecords(user, protocol = Infinity) {
  const reports = [];
  for (const { member: m, stored } of await readMemberRooms(db, user)) {
    const room = await hydrateRoomImages(db, m.code, stored.room);
    if (room.blockedUsers?.[user] === "banned") continue;
    const seat = [...room.seats, ...(room.departed || [])].find((s) => s.id === m.seat_id && s.token === m.token);
    if (!seat || seat.status === "banned") continue;
    for (const r of room.table.journal?.reports || []) {
      if (r.seatIds && !r.seatIds.includes(seat.id)) continue;
      let snapshot, error;
      try { snapshot = projectRecord(readArchivedSnapshot(r.snapshot), seat); }
      catch { error = "This archived report cannot be read. Keep its original backup for recovery."; }
      reports.push({ id: r.id, code: m.code, campaign: m.name, name: r.name, at: r.at, snapshot, ...(error ? { error } : {}) });
    }
  }
  if (protocol < 10) for (const report of reports) if (report.snapshot) report.snapshot = tableForProtocol(report.snapshot, protocol);
  return JSON.stringify({ reports });
}
async function streamed(user, protocol) {
  const records = await campaignRecordsStream(db, user, protocol);
  return streamedJson(records.chunks).text();
}

let users = 0;
async function user() {
  const id = `records-user-${++users}`;
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?, 'R', ?, 1, null, 0, 0)`).bind(id, `records-${users}@example.com`).run();
  return id;
}
const IMAGE = "data:image/png;base64," + "QUJD".repeat(2_500);

/** A campaign with archived sessions, one player joining after the first session. */
async function campaign(dmUser, playerUser, sessions = 3) {
  const table = tradeFixture();
  table.journal = {
    ...(table.journal ?? {}),
    world: { ...(table.journal?.world ?? {}), maps: [{ id: "atlas", name: "Atlas", image: IMAGE, visible: true, locationId: null, anchors: [], markers: [] }] },
  };
  const dm = await openRoom({ name: "Records DM", table, userId: dmUser });
  const sessionId = (await readRoom(dm.code)).sessionId;
  await choosePace({ ...dm, live: true });
  let player;
  for (let n = 1; n <= sessions; n++) {
    if (n === 2) player = await joinRoom({ code: dm.code, purseId: "a", name: "Arden", sessionId, userId: playerUser });
    await submitCommands({ ...dm, batchId: `s-${n}`, commands: [{ id: `s-${n}`, kind: "session", name: `Session ${n}`, end: false }] });
    await submitCommands({ ...dm, batchId: `m-${n}`, commands: Array.from({ length: 30 }, (_, k) => ({ id: `m-${n}-${k}`, kind: "message", to: k % 3 ? "party" : "dm", purseId: "a", text: `Session ${n} line ${k} ü` })) });
    await submitCommands({ ...dm, batchId: `g-${n}`, commands: Array.from({ length: 20 }, (_, k) => ({ id: `g-${n}-${k}`, kind: "give", fromId: "a", toId: "b", copper: 1, holdingId: null, quantity: 0 })) });
    await submitCommands({ ...dm, batchId: `e-${n}`, commands: [{ id: `e-${n}`, kind: "session", name: `Session ${n}`, end: true }] });
  }
  return { dm, player };
}

test("records stream byte for byte the response they were, for DMs and players across campaigns", async () => {
  const dmUser = await user(), playerUser = await user();
  const first = await campaign(dmUser, playerUser, 3);
  await campaign(dmUser, playerUser, 2);
  const images = await db.prepare("SELECT COUNT(*) AS n FROM campaign_room_images WHERE code=?").bind(first.dm.code).first();
  assert.ok(images.n > 0, "map artwork is stored by reference");
  for (const who of [dmUser, playerUser]) {
    const expected = await wholeRecords(who);
    assert.equal(await streamed(who), expected);
    const reports = JSON.parse(expected).reports;
    assert.ok(reports.length > 0 && reports.every((r) => !r.error));
    for (const protocol of [2, 9]) assert.equal(await streamed(who, protocol), await wholeRecords(who, protocol), `protocol ${protocol}`);
  }
  // The player was not in the first session of either campaign.
  assert.equal(JSON.parse(await streamed(playerUser)).reports.length, 3);
  assert.ok(JSON.parse(await streamed(dmUser)).reports.some((r) => JSON.parse(JSON.stringify(r.snapshot)).journal.world.maps[0].image === IMAGE), "images inside sessions are restored");
  const response = streamedJson((await campaignRecordsStream(db, dmUser)).chunks);
  assert.equal(response.headers.get("content-type"), "application/json");
});

test("banned and departed seats, and an account with no campaigns, match the old response", async () => {
  const dmUser = await user(), playerUser = await user(), nobody = await user();
  const { dm } = await campaign(dmUser, playerUser, 2);
  assert.equal(await streamed(nobody), '{"reports":[]}');
  assert.equal(await streamed(nobody), await wholeRecords(nobody));
  const room = await readRoom(dm.code);
  room.blockedUsers = { ...(room.blockedUsers ?? {}), [playerUser]: "banned" };
  room.revision++;
  await updateRoom(room, room.revision - 1);
  assert.equal(await streamed(playerUser), await wholeRecords(playerUser));
  assert.equal(JSON.parse(await streamed(playerUser)).reports.length, 0);
});

test("an unreadable session is listed with its error, as before", async () => {
  const dmUser = await user();
  const { dm } = await campaign(dmUser, await user(), 2);
  const room = await readRoom(dm.code);
  // A session whose snapshot is valid JSON but not a readable archived campaign.
  room.table.journal.reports.push({ ...room.table.journal.reports[0], id: "odd", name: "Odd", snapshot: JSON.stringify({ purses: "nope" }) });
  room.revision++;
  await updateRoom(room, room.revision - 1);
  const expected = await wholeRecords(dmUser);
  assert.ok(JSON.parse(expected).reports.some((r) => r.error));
  assert.equal(await streamed(dmUser), expected);
});

test("a damaged session or a missing image refuses before anything is sent, with the same message", async () => {
  const dmUser = await user(), playerUser = await user();
  const { dm } = await campaign(dmUser, playerUser, 2);
  const [first] = (await db.prepare("SELECT reference FROM campaign_room_reports WHERE code=? ORDER BY rowid").bind(dm.code).all()).results;
  const body = (await db.prepare("SELECT body FROM campaign_room_reports WHERE code=? AND reference=?").bind(dm.code, first.reference).first()).body;
  await db.prepare("UPDATE campaign_room_reports SET reference='moved' WHERE code=? AND reference=?").bind(dm.code, first.reference).run();
  for (const who of [dmUser, playerUser]) {
    const old = await wholeRecords(who).then(() => null, (e) => e.message);
    assert.ok(old, "the old read refused");
    await assert.rejects(campaignRecordsStream(db, who), (e) => e.message === old);
  }
  await db.prepare("UPDATE campaign_room_reports SET reference=? WHERE code=? AND reference='moved'").bind(first.reference, dm.code).run();
  assert.equal(await streamed(dmUser), await wholeRecords(dmUser));
  assert.ok(body.length > 0);
  // The map is removed from the working campaign, so only archived sessions still refer to it.
  const room = await readRoom(dm.code);
  room.table.journal.world.maps = [];
  room.revision++;
  await updateRoom(room, room.revision - 1);
  assert.equal(await streamed(dmUser), await wholeRecords(dmUser));
  await db.prepare("DELETE FROM campaign_room_images WHERE code=?").bind(dm.code).run();
  for (const who of [dmUser, playerUser]) {
    const old = await wholeRecords(who).then(() => null, (e) => e.message);
    assert.match(old ?? "", /campaign image is missing/);
    await assert.rejects(campaignRecordsStream(db, who), (e) => e.message === old);
  }
});

test("records hold one archived session at a time", async () => {
  const dmUser = await user();
  await campaign(dmUser, await user(), 3);
  const records = await campaignRecordsStream(db, dmUser);
  let reads = 0;
  const realPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/FROM campaign_room_reports WHERE code=\? AND reference IN/.test(sql)) reads++;
    return realPrepare(sql);
  };
  try {
    const seen = [];
    for await (const chunk of records.chunks()) seen.push({ chunk, reads });
    const entries = seen.filter((c) => c.chunk.includes('"snapshot":{'));
    assert.equal(entries.length, 3);
    assert.ok(entries[0].reads >= 1 && entries[0].reads <= 2, "only the first session read before its entry");
    for (let i = 1; i < entries.length; i++) {
      const step = entries[i].reads - entries[i - 1].reads;
      assert.ok(step >= 1 && step <= 2, "each further session read just before its own entry");
    }
  } finally {
    db.prepare = realPrepare;
  }
});

test("a missing resource pack, inside a session or in the working campaign, refuses before anything is sent", async () => {
  // Integrity review of #388: a pack missing from inside an archived session was found only while
  // the response was already streaming (HTTP 200 and part of the body, then an error).
  const dmUser = await user(), playerUser = await user();
  const { dm } = await campaign(dmUser, playerUser, 2);
  const room = await readRoom(dm.code);
  const base = room.table.journal.reports.at(-1);
  const snap = JSON.parse(base.snapshot);
  snap.resourceLibrary = { packs: [{ format: "lootsplit.resource-pack", name: "Bestiary", items: [] }] };
  room.table.journal.reports.push({ ...base, id: "packed", name: "Packed", snapshot: JSON.stringify(snap) });
  room.revision++;
  await updateRoom(room, room.revision - 1);
  assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM campaign_resource_documents WHERE code=?").bind(dm.code).first()).n > 0, "the pack is stored by reference");
  assert.equal(await streamed(dmUser), await wholeRecords(dmUser), "intact: identical");
  await db.prepare("DELETE FROM campaign_resource_documents WHERE code=?").bind(dm.code).run();
  for (const who of [dmUser, playerUser]) {
    const old = await wholeRecords(who).then(() => null, (e) => e.message);
    assert.match(old ?? "", /resource pack is missing/);
    await assert.rejects(campaignRecordsStream(db, who), (e) => e.message === old);
  }
  // A pack in the working campaign only (sessions without packs).
  const other = await campaign(dmUser, await user(), 1);
  const live = await readRoom(other.dm.code);
  live.table.journal.resourceLibrary = { packs: [{ format: "lootsplit.resource-pack", name: "Live pack", items: [] }] };
  live.revision++;
  await updateRoom(live, live.revision - 1);
  await db.prepare("DELETE FROM campaign_resource_documents WHERE code=?").bind(other.dm.code).run();
  const old = await wholeRecords(dmUser).then(() => null, (e) => e.message);
  assert.match(old ?? "", /resource pack is missing/);
  await assert.rejects(campaignRecordsStream(db, dmUser), (e) => e.message === old);
});
