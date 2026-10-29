import assert from "node:assert/strict";
import { readStoredRoom } from "../cloudflare/room-storage.mjs";
import test from "node:test";
import { localAccountDb } from "./account-dev-db.mjs";
import { openRoom, roomState } from "../src/lib/quire/cloud.server.ts";
import { readCloudTableForImport } from "../src/lib/quire/cloud.ts";
import { readRoom, updateRoom, ROOM_BODY_LIMIT } from "../src/lib/quire/room-store.server.ts";
import { ROOM_LIVE_LIMIT } from "../src/lib/quire/room-size.ts";
import { archiveSession } from "../src/lib/quire/session-records.ts";
import { tradeFixture } from "../src/lib/quire/test-fixtures/trade-economy.ts";
import { campaignAction } from "../cloudflare/account-campaigns.mjs";
import { restoreDeletedCampaign } from "../cloudflare/campaign-recovery.mjs";
import { hydrateRoomImages } from "../cloudflare/room-images.mjs";

// Disposable local D1 stand-in with every migration applied; never a real campaign or account.
const db = localAccountDb();
// One synthetic DM restores many rooms here; the hosting limit has its own suite
// (hosted-campaign-limit.test.mjs), so this file raises it instead of closing rooms between cases.
globalThis.__env__ = { DB: db, HOSTED_CAMPAIGN_LIMIT: "100" };
const userId = "restore-dm",
  actor = { id: "restore-session" };
db.prepare(
  `INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM','restore-dm@example.invalid',1,null,0,0)`,
)
  .bind(userId)
  .run();
db.prepare(
  `INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'restore-session-token',0,0,?)`,
)
  .bind(actor.id, Date.now() + 86_400_000, userId)
  .run();

const bytes = (text) => new TextEncoder().encode(text).length;
const count = async (sql, ...args) => (await db.prepare(sql).bind(...args).first()).n;

/** A complete archived session whose snapshot carries about `kb` KB of party chat. */
function archivedSession(id, kb) {
  const table = tradeFixture();
  table.notes = Array.from({ length: Math.ceil((kb * 1000) / 560) }, (_, n) => ({
    id: `${id}-line-${n}`,
    at: n + 1,
    from: "dm",
    to: "party",
    purseId: "party",
    text: `${id} line ${n} `.padEnd(500, "x"),
  }));
  return archiveSession(table, id, `Session ${id}`, 1_000 + id.length);
}

/** A shared room with archived sessions, deleted through the guarded account flow. */
async function deletedCampaign(sessions, { legacyInline = false } = {}) {
  const dm = await openRoom({ name: "Restore DM", table: tradeFixture(), userId });
  // Opening a room as a signed-in DM links it to the account library.
  assert.ok(await db.prepare("SELECT 1 FROM library_members WHERE user_id=? AND code=?").bind(userId, dm.code).first());
  const room = await readRoom(dm.code);
  const base = room.revision;
  room.table.journal = { ...(room.table.journal || {}), reports: [] };
  for (const [id, kb] of sessions) {
    const report = archivedSession(id, kb);
    // Pre-change reports carried no seat list; current ones do.
    room.table.journal.reports.push(legacyInline ? report : { ...report, seatIds: [dm.seatId] });
  }
  room.revision++;
  if (legacyInline)
    // A pre-#177 row: snapshots inline in the room body, written directly.
    await db
      .prepare("UPDATE campaign_rooms SET body=?,revision=? WHERE code=?")
      .bind(JSON.stringify(room), room.revision, dm.code)
      .run();
  else await updateRoom(room, base);
  const stored = await db.prepare("SELECT revision FROM campaign_rooms WHERE code=?").bind(dm.code).first();
  const deleted = await campaignAction(
    db,
    userId,
    { action: "delete", code: dm.code, confirm: dm.code, revision: stored.revision },
    actor,
  );
  assert.equal(deleted.ok, true);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_rooms WHERE code=?", dm.code), 0);
  const backup = await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first();
  return { backupId: deleted.backupId, payload: JSON.parse(backup.body) };
}

/** What the restored room's table must hydrate to: the backup's table, unchanged byte for byte. */
function expectedTable(payload) {
  const table = readCloudTableForImport(structuredClone(payload));
  for (const purse of table.purses) {
    delete purse.profileId;
    delete purse.sheetReadOnlyForDm;
  }
  return table;
}

async function restore(backupId, requestKey = crypto.randomUUID()) {
  const membership = await restoreDeletedCampaign(db, userId, { id: backupId, requestKey }, actor);
  // The stored room through the storage API (assembled when sectioned).
  const stored = await readStoredRoom(db, membership.code);
  const row = { body: stored.body, revision: stored.version.revision };
  return { membership, row, requestKey };
}

async function assertHydratesIdentically(membership, row, payload) {
  const hydrated = await hydrateRoomImages(db, membership.code, JSON.parse(row.body));
  assert.equal(JSON.stringify(hydrated.table), JSON.stringify(expectedTable(payload)), "restored table hydrates byte for byte");
  const reports = hydrated.table.journal?.reports || [];
  assert.deepEqual(
    reports.map((r) => r.snapshot),
    (payload.journal?.reports || []).map((r) => r.snapshot),
    "every archived snapshot string is restored exactly",
  );
  // The authoritative reader and the DM's projected view see the same history.
  const live = await readRoom(membership.code);
  assert.deepEqual(
    live.table.journal?.reports?.map((r) => r.snapshot) ?? [],
    reports.map((r) => r.snapshot),
  );
  const view = await roomState({ code: membership.code, token: membership.token });
  assert.equal(view.table.journal?.reports?.length ?? 0, reports.length);
  assert.ok((view.table.journal?.reports || []).every((r) => typeof r.snapshot === "string" && !("snapshotReference" in r)));
}

test("a backup with large archived sessions restores into a small row and hydrates identically", async () => {
  const { backupId, payload } = await deletedCampaign([
    ["alpha", 420],
    ["bravo", 420],
    ["charlie", 420],
  ]);
  assert.ok(bytes(JSON.stringify(payload)) > 1_200_000, "the genuine deletion backup carries the snapshots inline");
  const { membership, row, requestKey } = await restore(backupId);
  assert.equal(row.revision, 1);
  assert.equal(row.body.includes('"snapshot"'), false, "no archived snapshot is stored inline");
  assert.ok(bytes(row.body) < 100_000, `restored row is ${bytes(row.body)} bytes`);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_room_reports WHERE code=?", membership.code), 3);
  await assertHydratesIdentically(membership, row, payload);
  // Retrying the committed restore returns the same campaign and stores nothing twice.
  const again = await restoreDeletedCampaign(db, userId, { id: backupId, requestKey }, actor);
  assert.equal(again.code, membership.code);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_room_reports WHERE code=?", membership.code), 3);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_recoveries WHERE backup_id=?", backupId), 1);
});

test("a backup whose snapshots exceed D1's 2 MB row limit restores with a small row", async () => {
  const { backupId, payload } = await deletedCampaign([["delta", 300]]);
  // Older or larger deletion backups can hold more history than one D1 row; extend this genuine
  // backup in the disposable database only.
  for (const id of ["echo", "foxtrot", "golf", "hotel", "india"])
    payload.journal.reports.push({ ...archivedSession(id, 450), seatIds: [payload.journal.reports[0].seatIds[0]] });
  const body = JSON.stringify(payload);
  assert.ok(bytes(body) > 2_000_000, `backup is ${bytes(body)} bytes`);
  await db.prepare("UPDATE library_backups SET body=? WHERE id=?").bind(body, backupId).run();
  const { membership, row } = await restore(backupId);
  assert.ok(bytes(row.body) < 100_000, `restored row is ${bytes(row.body)} bytes`);
  assert.equal(row.body.includes('"snapshot"'), false);
  const reportRows = await db
    .prepare("SELECT length(CAST(body AS BLOB)) AS n FROM campaign_room_reports WHERE code=?")
    .bind(membership.code)
    .all();
  assert.equal(reportRows.results.length, 6);
  assert.ok(reportRows.results.every((r) => r.n < ROOM_BODY_LIMIT));
  await assertHydratesIdentically(membership, row, payload);
});

test("a legacy backup (inline snapshots without seat lists, or no history) still restores", async () => {
  const legacy = await deletedCampaign([["legacy", 40]], { legacyInline: true });
  assert.equal("seatIds" in legacy.payload.journal.reports[0], false);
  const restored = await restore(legacy.backupId);
  assert.equal(restored.row.body.includes('"snapshot"'), false, "restore stores the current shape");
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_room_reports WHERE code=?", restored.membership.code), 1);
  await assertHydratesIdentically(restored.membership, restored.row, legacy.payload);

  const empty = await deletedCampaign([]);
  const plain = await restore(empty.backupId);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_room_reports WHERE code=?", plain.membership.code), 0);
  await assertHydratesIdentically(plain.membership, plain.row, empty.payload);
});

test("a single snapshot above the row budget restores in parts (step 4) and hydrates identically", async () => {
  const { backupId, payload } = await deletedCampaign([["lima", 20]]);
  payload.journal.reports.push({ ...archivedSession("mike", 1_900), seatIds: payload.journal.reports[0].seatIds });
  await db.prepare("UPDATE library_backups SET body=? WHERE id=?").bind(JSON.stringify(payload), backupId).run();
  const { membership, row } = await restore(backupId);
  assert.ok(await count("SELECT COUNT(*) AS n FROM campaign_room_report_parts WHERE code=?", membership.code) >= 2);
  await assertHydratesIdentically(membership, row, payload);
});

test("a single snapshot above the live campaign budget is refused with nothing created and the backup kept", async () => {
  const { backupId, payload } = await deletedCampaign([["juliet", 20]]);
  payload.journal.reports.push({ ...archivedSession("kilo", ROOM_LIVE_LIMIT / 1000 + 200), seatIds: payload.journal.reports[0].seatIds });
  const body = JSON.stringify(payload);
  await db.prepare("UPDATE library_backups SET body=? WHERE id=?").bind(body, backupId).run();
  const rooms = await count("SELECT COUNT(*) AS n FROM campaign_rooms"),
    reports = await count("SELECT COUNT(*) AS n FROM campaign_room_reports"),
    members = await count("SELECT COUNT(*) AS n FROM library_members");
  await assert.rejects(
    restoreDeletedCampaign(db, userId, { id: backupId, requestKey: crypto.randomUUID() }, actor),
    (error) => {
      assert.equal(error.status, 413);
      assert.match(error.message, /too large to restore online/);
      assert.match(error.message, /No campaign was created/);
      return true;
    },
  );
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_rooms"), rooms);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_room_reports"), reports);
  assert.equal(await count("SELECT COUNT(*) AS n FROM library_members"), members);
  assert.equal(await count("SELECT COUNT(*) AS n FROM campaign_recoveries WHERE backup_id=?", backupId), 0);
  assert.equal((await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(backupId).first()).body, body);
});
