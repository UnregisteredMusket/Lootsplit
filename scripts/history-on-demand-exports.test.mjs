// History on demand, part exports (split from one file so the parts run in parallel;
// shared setup in history-on-demand-setup.mjs). Disposable local D1 stand-in only; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { NEW, OLD, ROOM_HISTORY_PAGE_ITEMS, ROOM_SECTION_THRESHOLD, buy, campaignAction, db, history, liveRoom, manifest, message, openRoom, readRoom, readStoredRoom, roomState, send, setRoomSectionLimitsForTests, shopTable, updateRoom } from "./history-on-demand-setup.mjs";
test("an existing large room migrates to history pages on its next write, keeping every line", async () => {
  // Stored before step 4: sectioned, without history pages.
  setRoomSectionLimitsForTests({ threshold: ROOM_SECTION_THRESHOLD, min: undefined, page: 10_000_000 });
  const seats = await liveRoom("Legacy DM");
  const room = await readRoom(seats.dm.code);
  room.table.ledger = Array.from({ length: 15000 }, (_, i) => ({ id: `old-${i}`, at: i, purseId: "a", shopId: null, summary: `Old purchase ${i} of rope and lantern oil`, copper: -1, transactionType: "purchase" }));
  room.table.notes = Array.from({ length: 4000 }, (_, i) => ({ id: `chat-${i}`, at: i, from: "dm", to: "party", purseId: "", text: `Old chatter line ${i}` }));
  const base = room.revision;
  room.revision++;
  await updateRoom(room, base);
  const legacy = await readStoredRoom(db, seats.dm.code);
  assert.ok(legacy.version.sections.length > 0 && !legacy.version.sections.some((e) => e.path[0] === "$history"), "a step 3 room");
  // The release with step 4: the next write pages it.
  setRoomSectionLimitsForTests({ threshold: ROOM_SECTION_THRESHOLD, min: undefined, page: ROOM_HISTORY_PAGE_ITEMS });
  assert.equal((await roomState({ ...seats.dm, ...NEW })).history, undefined, "read as it is until written");
  await send(seats.dm, "first-after-release", [message("first-after-release", "", "Hello again")]);
  const migrated = await readStoredRoom(db, seats.dm.code);
  const ledgerPages = migrated.version.sections.filter((e) => e.path.join(".") === "$history.table.ledger");
  assert.equal(ledgerPages.length, Math.floor(15000 / ROOM_HISTORY_PAGE_ITEMS) - 1);
  assert.deepEqual(migrated.room.table.ledger, legacy.room.table.ledger, "every ledger line kept, in order");
  assert.deepEqual(migrated.room.table.notes.slice(0, -1), legacy.room.table.notes, "every chat line kept, in order");
  assert.equal(migrated.body, JSON.stringify(migrated.room), "the whole stored body round-trips");
  const view = await roomState({ ...seats.dm, ...NEW });
  assert.ok(view.table.ledger.length < 2 * ROOM_HISTORY_PAGE_ITEMS && view.history.ledger);
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
});

test("exports and deletion copies hold the complete history, byte for byte as without pages", async () => {
  const userId = "history-user";
  const actor = { id: "history-session" };
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?, 'H', 'history@example.com', 1, null, 0, 0)`).bind(userId).run();
  await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'history-session-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
  const payloads = [];
  for (const page of [16, 1_000_000]) {
    setRoomSectionLimitsForTests({ threshold: 0, min: 0, page });
    const seats = await liveRoom("Export DM", shopTable(), userId);
    const { dm } = seats;
    await history(seats, 200, "x");
    await send(dm, "s1", [{ id: "session-1", kind: "session", name: "One", end: false }]);
    await send(dm, "end-1", [{ id: "end-1", kind: "session", name: "One", end: true }]);
    await history(seats, 120, "y");
    const exported = await (await campaignAction(db, userId, { action: "export", code: dm.code }, actor)).json();
    const normalize = (value) => JSON.parse(JSON.stringify(value).split(dm.code).join("CODE"));
    payloads.push({ page, exported: normalize(exported.payload), pages: (await manifest(dm.code)).filter((e) => e.path[0] === "$history").length });
    // The deletion copy: the same file plus its recovery records.
    const revision = (await readStoredRoom(db, dm.code)).version.revision;
    const deleted = await campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision }, actor);
    assert.equal(deleted.ok, true);
    const { readBackupPayload } = await import("../cloudflare/backup-parts.mjs");
    const backup = await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first();
    const payload = await readBackupPayload(db, deleted.backupId, backup.body);
    assert.equal(payload.ledger.length, exported.payload.ledger.length);
    assert.equal(payload.notes.length, exported.payload.notes.length);
  }
  setRoomSectionLimitsForTests({ threshold: 0, min: 0, page: 64 });
  assert.ok(payloads[0].pages > 10 && payloads[1].pages === 0);
  // Room codes, seat IDs and clock times differ between the two campaigns; nothing else may.
  const strip = (p) => JSON.stringify(p.exported).replace(/[0-9a-f-]{36}/g, "ID").replace(/\b1[6-9]\d{11}\b/g, "T");
  assert.ok(strip(payloads[0]) === strip(payloads[1]), "the exported campaign is the same with and without history pages");
  assert.ok(payloads[0].exported.ledger.length >= 120 && payloads[0].exported.journal.reports.length === 1);
  assert.ok(JSON.parse(payloads[0].exported.journal.reports[0].snapshot).ledger.length >= 200, "the archived session is complete");
});

test("past the total-size warning threshold a session still ends; the owner is warned and the DM gets a notice", async () => {
  const { ROOM_TOTAL_LIMIT } = await import("../src/lib/quire/room-size.ts");
  const seats = await liveRoom("Total warning DM");
  await send(seats.dm, "cap-s1", [{ id: "cap-s1", kind: "session", name: "One", end: false }]);
  await history(seats, 100, "cap");
  // Archived sessions already stored up to the threshold (a stand-in row: only its size counts here).
  await db.prepare("INSERT INTO campaign_room_reports(code,reference,body) VALUES (?,?,?)").bind(seats.dm.code, "session-report:padding", "x".repeat(ROOM_TOTAL_LIMIT)).run();
  const logsBefore = (await db.prepare("SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='room-storage'").first()).n;
  // Never refused: the session is archived as always.
  await send(seats.dm, "cap-e1", [{ id: "cap-e1", kind: "session", name: "One", end: true }]);
  assert.ok((await readRoom(seats.dm.code)).table.journal.reports.some((r) => r.name === "One"), "the session was archived");
  const logs = await db.prepare("SELECT body FROM owner_monitor_logs WHERE source='room-storage'").all();
  assert.equal(logs.results.length, logsBefore + 1, "one owner-monitor entry");
  const body = JSON.parse(logs.results.at(-1).body);
  assert.equal(body.warning, "total");
  assert.equal(body.refusal, undefined, "a warning, not a refusal");
  assert.equal(body.totalLimit, ROOM_TOTAL_LIMIT);
  assert.ok(body.totalBytes > ROOM_TOTAL_LIMIT);
  // The DM's view carries the notice (old and new protocols); players never see it.
  for (const protocol of [NEW, OLD]) {
    const dm = await roomState({ ...seats.dm, ...protocol });
    assert.ok(dm.storageWarning.totalBytes > ROOM_TOTAL_LIMIT && dm.storageWarning.limit === ROOM_TOTAL_LIMIT);
    assert.equal((await roomState({ ...seats.a, ...protocol })).storageWarning, undefined);
  }
  // Play goes on, and the notice stays until an archive finds the total below the threshold.
  await send(seats.dm, "cap-more", [buy("cap-more-buy"), message("cap-more-msg", "a", "Still playing")]);
  assert.ok((await roomState({ ...seats.dm, ...NEW })).storageWarning);
  await db.prepare("DELETE FROM campaign_room_reports WHERE reference='session-report:padding'").run();
  await send(seats.dm, "cap-s2", [{ id: "cap-s2", kind: "session", name: "Two", end: false }]);
  await send(seats.dm, "cap-e2", [{ id: "cap-e2", kind: "session", name: "Two", end: true }]);
  assert.equal((await roomState({ ...seats.dm, ...NEW })).storageWarning, undefined, "cleared below the threshold");
});

test("a table whose archived sessions are not loaded is never uploaded as a campaign", async () => {
  const { readJournal } = await import("../src/lib/quire/journal.ts");
  const table = shopTable();
  table.journal = readJournal({ ...(table.journal ?? {}), reports: [{ id: "r1", name: "One", at: 1, snapshot: "", deferred: true }] });
  await assert.rejects(openRoom({ name: "Rehost DM", table }), /not loaded on this device.*Nothing was changed/);
  table.journal.reports = [{ id: "r1", name: "One", at: 1, snapshot: "\u0000lootsplit-deferred-report:session-report:abc" }];
  await assert.rejects(openRoom({ name: "Rehost DM", table }), /not loaded on this device/);
});
