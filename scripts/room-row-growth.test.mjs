import assert from "node:assert/strict";
import { readStoredRoom } from "../cloudflare/room-storage.mjs";
import test from "node:test";
import { localAccountDb } from "./account-dev-db.mjs";
import { openRoom, joinRoom, roomState, submitCommands, choosePace } from "../src/lib/quire/cloud.server.ts";
import { readRoom, updateRoom, ROOM_BODY_LIMIT, ROOM_ROW_LIMIT } from "../src/lib/quire/room-store.server.ts";
import { archiveSession } from "../src/lib/quire/session-records.ts";
import { tradeFixture } from "../src/lib/quire/test-fixtures/trade-economy.ts";
import { ROOM_SUBMIT_LIMITS, takeSubmitAllowance } from "../src/lib/quire/room-submit-limit.ts";
import { campaignRecords } from "../cloudflare/campaign-records.mjs";
import { siteGameAnalytics } from "../cloudflare/game-analytics.mjs";
import { BUILTIN_LOGS } from "../cloudflare/monitor-journal.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import { readFileSync } from "node:fs";

// Disposable local D1 stand-in with every migration applied; never a real campaign.
const db = localAccountDb();
globalThis.__env__ = { DB: db };
db.prepare(
  `INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES('user-a','A','a@example.invalid',1,null,0,0)`,
).run();

const raw = async (code) =>
  (await db.prepare("SELECT body,revision FROM campaign_rooms WHERE code=?").bind(code).first());
const bytes = (text) => new TextEncoder().encode(text).length;
const message = (id, purseId, text, to = "party") => ({
  id,
  kind: "message",
  to,
  purseId,
  text,
});
const session = (id, name) => ({ id, kind: "session", name, end: false });

async function liveRoom() {
  const dm = await openRoom({ name: "Archive DM", table: tradeFixture() });
  const a = await joinRoom({ code: dm.code, purseId: "a", name: "A", userId: "user-a" });
  const b = await joinRoom({ code: dm.code, purseId: "b", name: "B" });
  await choosePace({ ...dm, live: true });
  return { dm, a: { code: dm.code, token: a.token, seatId: a.seatId }, b: { code: dm.code, token: b.token, seatId: b.seatId } };
}

test("migration 0019 is additive and passes the release checker", () => {
  const name = "0019_campaign_room_reports.sql";
  assert.equal(
    assertAdditiveSql(name, readFileSync(new URL(`../cloudflare/migrations/${name}`, import.meta.url), "utf8")),
    1,
  );
});

test("sessions archived after this change do not grow the room row; reports still project per seat", async () => {
  const { dm, a, b } = await liveRoom();
  await submitCommands({ ...dm, batchId: "s1", commands: [session("session-1", "One")] });
  const sizes = [];
  for (let i = 1; i <= 4; i++) {
    // Each session carries ~12 KB of chat plus a DM-only message from A that B must never read.
    // (Four sessions of chat stay inside A's message-text allowance.)
    await submitCommands({
      ...a,
      batchId: `chat-${i}`,
      commands: [
        ...Array.from({ length: 25 }, (_, n) => message(`m-${i}-${n}`, "a", `Session ${i} line ${n} `.padEnd(500, "x"))),
        message(`secret-${i}`, "a", `A private note for the DM ${i}`, "dm"),
      ],
    });
    // End (archive) and start the next session as separate commands. (Starting a session while one
    // is active archives it but currently drops the new start; that is tracked separately.)
    await submitCommands({ ...dm, batchId: `end-${i}`, commands: [{ ...session(`end-${i}`, `S${i}`), end: true }] });
    await submitCommands({ ...dm, batchId: `s${i + 1}`, commands: [session(`session-${i + 1}`, `S${i + 1}`)] });
    const stored = await raw(dm.code);
    assert.equal(stored.body.includes('"snapshot"'), false, "no archived snapshot is stored inline");
    // Command/batch receipts back idempotency and are measured separately (not pruned here).
    const { commands: _c, commandHashes: _ch, batches: _b, batchHashes: _bh, ...rest } = JSON.parse(stored.body);
    sizes.push(bytes(JSON.stringify(rest)));
  }
  // Four archived sessions of ~12 KB each; apart from receipts the row grows only by the small references.
  for (let i = 1; i < sizes.length; i++)
    assert.ok(sizes[i] - sizes[i - 1] < 2000, `room row grew by ${sizes[i] - sizes[i - 1]} bytes per session`);
  const rows = (await db
    .prepare("SELECT reference,length(body) AS n FROM campaign_room_reports WHERE code=?")
    .bind(dm.code)
    .all());
  assert.equal(rows.results.length, 4);
  assert.ok(rows.results.every((r) => /^session-report:[a-f0-9]{64}$/.test(r.reference) && r.n > 12000));

  const host = (await roomState(dm)).table.journal .reports ;
  assert.equal(host.length, 4);
  for (const [i, report] of host.entries()) {
    const snapshot = JSON.parse(report.snapshot);
    assert.equal(snapshot.notes.filter((n) => n.id.startsWith(`m-${i + 1}-`)).length, 25);
    assert.ok(snapshot.notes.some((n) => n.id === `secret-${i + 1}`));
    assert.equal("snapshotReference" in report, false, "storage references never reach clients");
  }
  const player = (await roomState(b)).table.journal .reports ;
  assert.equal(player.length, 4);
  for (const report of player) {
    const notes = JSON.parse(report.snapshot).notes;
    assert.equal(notes.filter((n) => n.id.startsWith("m-")).length, 25);
    assert.equal(notes.some((n) => n.id.startsWith("secret-")), false, "per-seat projection still applies");
  }
  // A seat that joins later does not receive earlier sessions' reports.
  const late = await joinRoom({ code: dm.code, purseId: "party", name: "Late" }).catch(() => null);
  if (late) assert.equal((await roomState({ code: dm.code, token: late.token })).table.journal?.reports?.length ?? 0, 0);
  // Account records and analytics read the stored reports too.
  const records = await campaignRecords(db, "user-a");
  assert.equal(records.reports.filter((r) => r.code === dm.code).length, 4);
  assert.ok(records.reports.every((r) => !r.error));
  const analytics = await siteGameAnalytics(db);
  assert.ok(analytics.metrics.sessions >= 4);
  // Every later write keeps the same references and stores no duplicate rows.
  await submitCommands({ ...a, batchId: "after", commands: [message("after-1", "a", "Still here")] });
  const again = (await db.prepare("SELECT COUNT(*) AS n FROM campaign_room_reports WHERE code=?").bind(dm.code).first());
  assert.equal(again.n, 4);
});

test("an old room with inline snapshots still loads, projects, and moves them out on its next write", async () => {
  const { dm, a, b } = await liveRoom();
  await submitCommands({ ...a, batchId: "legacy-chat", commands: [message("legacy-1", "a", "Legacy party line"), message("legacy-dm", "a", "Legacy DM line", "dm")] });
  // Write a pre-change room directly: the archived snapshot is inline in the room body.
  // Read through the storage API (assembled when sectioned); written back as one inline row.
  const legacy = (await readStoredRoom(db, dm.code)).room;
  archiveSession(legacy.table, "legacy-session", "Legacy session");
  legacy.table.journal.reports[0].seatIds = legacy.seats.map((s) => s.id);
  legacy.revision++;
  await db.prepare("UPDATE campaign_rooms SET body=?,revision=? WHERE code=?").bind(JSON.stringify(legacy), legacy.revision, dm.code).run();
  assert.ok((await raw(dm.code)).body.includes('"snapshot"'));

  const before = (await roomState(dm)).table.journal .reports [0].snapshot;
  assert.ok(JSON.parse(before).notes.some((n) => n.id === "legacy-dm"));
  const playerBefore = JSON.parse((await roomState(b)).table.journal .reports [0].snapshot);
  assert.ok(playerBefore.notes.some((n) => n.id === "legacy-1"));
  assert.equal(playerBefore.notes.some((n) => n.id === "legacy-dm"), false);

  // Lazy migration: the next ordinary write moves the snapshot out; nothing is lost.
  await submitCommands({ ...a, batchId: "legacy-next", commands: [message("legacy-2", "a", "Next line")] });
  const migrated = await readStoredRoom(db, dm.code);
  assert.equal(migrated.body.includes('"snapshot"'), false);
  assert.equal((await roomState(dm)).table.journal .reports [0].snapshot, before, "snapshot restored byte for byte");
  // And it still archives new sessions alongside the old one.
  await submitCommands({ ...dm, batchId: "legacy-s2", commands: [session("legacy-s2", "Second")] });
  await submitCommands({ ...dm, batchId: "legacy-s3", commands: [{ ...session("legacy-s3", "Second"), end: true }] });
  const reports = (await roomState(dm)).table.journal .reports ;
  assert.equal(reports.length, 2);
  assert.equal(reports[0].snapshot, before);
  assert.ok(JSON.parse(reports[1].snapshot).notes.some((n) => n.id === "legacy-2"));
});

test("a missing stored snapshot stops the read instead of degrading the campaign", async () => {
  const { dm, a } = await liveRoom();
  await submitCommands({ ...a, batchId: "gone-chat", commands: [message("gone-1", "a", "Line")] });
  await submitCommands({ ...dm, batchId: "gone-s1", commands: [session("gone-s1", "One")] });
  await submitCommands({ ...dm, batchId: "gone-s2", commands: [{ ...session("gone-s2", "One"), end: true }] });
  const stored = await raw(dm.code);
  // Simulate an unreadable store in this disposable database only.
  db.exec(`DELETE FROM campaign_room_reports WHERE code='${dm.code}'`);
  await assert.rejects(roomState(dm), /archived session report is missing/);
  assert.deepEqual(await raw(dm.code), stored, "the stored room was not changed");
});

test("the per-seat submit limit rejects a message flood and leaves the row small", async () => {
  const { dm, a, b } = await liveRoom();
  const flood = (i) => ({
    ...a,
    batchId: `flood-${i}`,
    commands: Array.from({ length: 100 }, (_, n) => message(`flood-${i}-${n}`, "a", "y".repeat(500))),
  });
  let accepted = 0,
    refused = 0;
  for (let i = 0; i < 45; i++)
    try {
      await submitCommands(flood(i));
      accepted++;
    } catch (error) {
      assert.match(error.message, /sending changes too quickly/);
      refused++;
    }
  assert.equal(accepted, 1, "one full batch of 100 maximum-length messages always fits");
  assert.equal(refused, 44);
  assert.ok(bytes((await raw(dm.code)).body) < 200_000);
  // Retrying the committed batch is idempotent and never limited.
  assert.ok((await submitCommands(flood(0))).revision > 0);
  // Other seats keep their own budget.
  await submitCommands({ ...b, batchId: "b-ok", commands: [message("b-ok", "b", "I can still talk")] });
  await submitCommands({ ...dm, batchId: "dm-ok", commands: [message("dm-ok", "party", "So can I")] });
});

test("the per-seat batch budget refuses a burst of tiny submits beyond its capacity", async () => {
  const { a } = await liveRoom();
  const { capacity, perSecond } = ROOM_SUBMIT_LIMITS.batches;
  const started = Date.now();
  let accepted = 0,
    refused = null;
  for (let i = 0; i < capacity + 40 && !refused; i++)
    try {
      await submitCommands({ ...a, batchId: `tiny-${i}`, commands: [message(`tiny-${i}`, "a", "hi")] });
      accepted++;
    } catch (error) {
      refused = error;
    }
  assert.match(refused?.message ?? "", /sending changes too quickly/);
  // The whole burst capacity is usable; only the refill earned while the loop ran adds to it.
  const refill = ((Date.now() - started) / 1000) * perSecond;
  assert.ok(accepted >= capacity && accepted <= capacity + Math.ceil(refill), `${accepted} accepted`);
});

test("submit allowance refills over time and counts message text once", () => {
  const first = takeSubmitAllowance(undefined, 0, 50_000);
  assert.equal(first.batches, ROOM_SUBMIT_LIMITS.batches.capacity - 1);
  assert.equal(takeSubmitAllowance(first, 1000, 50_000), null, "a second full batch must wait");
  const later = takeSubmitAllowance(first, 1_000_000, 50_000);
  assert.ok(later, "the budget refills");
  assert.equal(takeSubmitAllowance({ batches: 0.5, chars: 60_000, at: 0 }, 0, 0), null);
  assert.ok(takeSubmitAllowance({ batches: 0.5, chars: 60_000, at: 0 }, 1000, 0));
});

test("staged messages count once, not again on re-stage or commit", async () => {
  const dm = await openRoom({ name: "Turn DM", table: tradeFixture() });
  const joined = await joinRoom({ code: dm.code, purseId: "a", name: "A2" });
  const a = { code: dm.code, token: joined.token };
  // Turn-based: it is the DM's turn, but messages may be staged out of turn.
  const queued = Array.from({ length: 100 }, (_, n) => message(`staged-${n}`, "a", "z".repeat(500)));
  await submitCommands({ ...a, batchId: "stage-1", commands: queued, stage: true });
  await submitCommands({ ...a, batchId: "stage-2", commands: queued, stage: true });
  await submitCommands({ ...a, batchId: "commit", commands: queued });
  const room = await readRoom(dm.code);
  assert.equal(room .table.notes.filter((n) => n.id.startsWith("staged-")).length, 100);
});

test("the size guard refuses an oversized room write, logs it to monitoring and changes nothing", async () => {
  assert.ok(BUILTIN_LOGS.some(([id, , mode]) => id === "room-storage" && mode === "event"));
  const { dm } = await liveRoom();
  const before = await raw(dm.code);
  const room = (await readRoom(dm.code));
  room.table.notes.push(
    // Above the campaign cap (room-size.ts), whatever it is.
    ...Array.from({ length: Math.ceil(ROOM_BODY_LIMIT / 500) + 200 }, (_, i) => ({
      id: `bulk-${i}`,
      at: i,
      from: "dm",
      to: "party",
      purseId: "party",
      text: "w".repeat(500),
    })),
  );
  room.revision++;
  await assert.rejects(updateRoom(room, before.revision), (error) => {
    assert.match(error.message, /too large to save online/);
    assert.match(error.message, /Nothing was changed/);
    assert.equal(error.status, 413);
    return true;
  });
  assert.deepEqual(await raw(dm.code), before);
  const logs = (await db
    .prepare("SELECT id,summary,body FROM owner_monitor_logs WHERE source='room-storage'")
    .all());
  assert.equal(logs.results.length, 1);
  const body = JSON.parse(logs.results[0].body);
  assert.ok(body.bytes > ROOM_BODY_LIMIT && body.limit === ROOM_BODY_LIMIT);
  assert.ok(body.parts.notes > ROOM_BODY_LIMIT);
  assert.equal(body.rowLimit, ROOM_ROW_LIMIT);
  assert.equal(body.storage.sectioned, true, "the refused room would have been stored sectioned");
  assert.equal(JSON.stringify(logs.results[0]).includes(dm.code), false, "the join code is not logged");
  // A repeated refusal in the same half-hour shares the entry instead of flooding monitoring.
  await assert.rejects(updateRoom(room, before.revision), /too large/);
  const count = (await db.prepare("SELECT COUNT(*) AS n FROM owner_monitor_logs WHERE source='room-storage'").first());
  assert.equal(count.n, 1);
});
