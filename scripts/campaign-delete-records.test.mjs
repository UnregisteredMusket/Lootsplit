// Deleting a shared campaign (audit 2026-11-10, C3 and C5; owner decision 2026-11-11): the deletion
// batch also removes the campaign's stored map images, command receipts, manual-roll policy, roll
// history and the deleting DM's encounters, all of which its recovery copy already holds, and only
// once the room row is gone (guarded like the room's sections). Other campaigns' rows and another
// account's encounters stay. Refusals name their one cause. A disposable local D1 stand-in only.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { blankEncounter } from "../src/lib/encounters/model.mjs";

const OTHER = "OTHERCAMP1";
const count = async (db, sql, ...args) => Number((await db.prepare(sql).bind(...args).first()).n);
async function campaignRows(db, code) {
  return {
    images: await count(db, "SELECT COUNT(*) AS n FROM campaign_room_images WHERE code=?", code),
    receipts: await count(db, "SELECT COUNT(*) AS n FROM campaign_room_receipts WHERE code=?", code),
    policies: await count(db, "SELECT COUNT(*) AS n FROM play_policies WHERE code=?", code),
    rolls: await count(db, "SELECT COUNT(*) AS n FROM play_rolls WHERE code=?", code),
    encounters: await count(db, "SELECT COUNT(*) AS n FROM dm_encounters WHERE code=?", code),
    encounterRolls: await count(db, "SELECT COUNT(*) AS n FROM dm_encounter_rolls r JOIN dm_encounters e ON e.id=r.encounter_id WHERE e.code=?", code),
    encounterAwards: await count(db, "SELECT COUNT(*) AS n FROM dm_encounter_awards a JOIN dm_encounters e ON e.id=a.encounter_id WHERE e.code=?", code),
  };
}
async function seedRecords(db, code, userId, prefix) {
  await db.prepare("INSERT INTO campaign_room_images(code,reference,image) VALUES (?,?,?)").bind(code, `${prefix}-map`, "data:image/png;base64,AAAA").run();
  await db.prepare("INSERT INTO play_policies(code,manual_allowed,updated_at) VALUES (?,1,1)").bind(code).run();
  await db
    .prepare("INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) VALUES (?,NULL,?,?,?,?,1)")
    .bind(`${prefix}-roll`, `campaign:${code}:p1`, code, `${prefix}-key`, JSON.stringify({ id: `${prefix}-roll`, total: 12 }))
    .run();
  await db
    .prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,created_at,updated_at) VALUES (?,?,?,?,'awarded',1,1)")
    .bind(`${prefix}-enc`, userId, code, JSON.stringify(blankEncounter()))
    .run();
  await db.prepare("INSERT INTO dm_encounter_rolls(encounter_id,request_key,body,created_at) VALUES (?,?,?,1)").bind(`${prefix}-enc`, `${prefix}-r`, "{}").run();
  await db.prepare("INSERT INTO dm_encounter_awards(encounter_id,receipt_id,body,created_at) VALUES (?,?,?,1)").bind(`${prefix}-enc`, `${prefix}-award`, "{}").run();
  await db
    .prepare("INSERT INTO campaign_room_receipts(code,seat_id,kind,key,hash,created_at) VALUES (?,?,'command',?,NULL,1)")
    .bind(code, "seat", `${prefix}-receipt`)
    .run();
}

test("C3: deleting a campaign removes its images, receipts, roll policy, rolls and the DM's encounters", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db, HOSTED_CAMPAIGN_LIMIT: "100" };
  try {
    const { openRoom, submitCommands } = await import("../src/lib/quire/cloud.server.ts");
    const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
    const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
    const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
    const userId = "delete-dm",
      otherUser = "co-dm",
      actor = { id: "delete-session" };
    for (const [id, email] of [[userId, "delete-dm@example.com"], [otherUser, "co-dm@example.com"]])
      await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM',?,1,null,0,0)`).bind(id, email).run();
    await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'delete-session-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
    const dm = await openRoom({ name: "Doomed", table: tradeFixture(), userId });
    // A real command writes the room's own receipts.
    await submitCommands({ ...dm, batchId: "chat", commands: [{ id: "chat-1", kind: "message", to: "party", purseId: "", text: "Hello" }] });
    await seedRecords(db, dm.code, userId, "mine");
    // Another account's encounter under the same code is not in this DM's recovery copy: it stays.
    await db.prepare("INSERT INTO dm_encounters(id,user_id,code,body,status,created_at,updated_at) VALUES ('theirs',?,?,?,'draft',1,1)").bind(otherUser, dm.code, JSON.stringify(blankEncounter())).run();
    // Another campaign's rows are never touched.
    await seedRecords(db, OTHER, userId, "other");
    const before = await campaignRows(db, dm.code);
    assert.ok(before.receipts > 0, "the room wrote receipts");
    const otherBefore = await campaignRows(db, OTHER);

    // A refused deletion (stale revision) removes nothing.
    const room = await readRoom(dm.code);
    await assert.rejects(
      campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision: room.revision - 1 }, actor),
      /changed/,
    );
    assert.deepEqual(await campaignRows(db, dm.code), before);

    const deleted = await campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision: room.revision }, actor);
    assert.equal(deleted.ok, true);
    assert.deepEqual(await campaignRows(db, dm.code), {
      images: 0,
      receipts: 0,
      policies: 0,
      rolls: 0,
      encounters: 1,
      encounterRolls: 0,
      encounterAwards: 0,
    });
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM dm_encounters WHERE id='theirs'"), 1);
    assert.deepEqual(await campaignRows(db, OTHER), otherBefore);
    // The recovery copy holds what was removed (restore puts it back under a new code).
    const backup = JSON.parse((await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first()).body);
    const recovery = backup.campaignRecovery;
    assert.equal(recovery.policy.manual_allowed, 1);
    assert.deepEqual(recovery.encounters.map((e) => e.id), ["mine-enc"]);
    assert.equal(recovery.encounterRolls.length, 1);
    assert.equal(recovery.encounterAwards.length, 1);
    assert.deepEqual(recovery.characterRolls.map((r) => r.id), ["mine-roll"]);
  } finally {
    delete globalThis.__env__;
  }
});

test("C5: an oversized recovery copy and changed access are refused with their own messages", async () => {
  const { DELETE_TOO_LARGE, DELETE_ACCESS_CHANGED } = await import("../cloudflare/account-campaigns.mjs");
  assert.match(DELETE_TOO_LARGE, /too large/);
  assert.doesNotMatch(DELETE_TOO_LARGE, /access/i);
  assert.match(DELETE_TOO_LARGE, /not deleted/);
  assert.match(DELETE_ACCESS_CHANGED, /access/i);
  assert.doesNotMatch(DELETE_ACCESS_CHANGED, /size|large/i);
  assert.match(DELETE_ACCESS_CHANGED, /not deleted/);
});

test("C5: a deletion refused in its transaction names access or a campaign change, never size", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db, HOSTED_CAMPAIGN_LIMIT: "100" };
  try {
    const { openRoom } = await import("../src/lib/quire/cloud.server.ts");
    const { readRoom } = await import("../src/lib/quire/room-store.server.ts");
    const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
    const { campaignAction, DELETE_ACCESS_CHANGED } = await import("../cloudflare/account-campaigns.mjs");
    const userId = "race-dm",
      actor = { id: "race-session" };
    await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM','race-dm@example.com',1,null,0,0)`).bind(userId).run();
    const signIn = () =>
      db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'race-session-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
    await signIn();
    const dm = await openRoom({ name: "Raced", table: tradeFixture(), userId });
    /** The same database, with `meanwhile` run just before the deletion's batch commits. */
    const racing = (meanwhile) => ({
      ...db,
      prepare: (sql) => db.prepare(sql),
      async batch(statements) {
        if (statements.length > 3 && meanwhile) {
          const once = meanwhile;
          meanwhile = null;
          await once();
        }
        return db.batch(statements);
      },
    });
    const del = async (target) => {
      const room = await readRoom(dm.code);
      return campaignAction(target, userId, { action: "delete", code: dm.code, confirm: dm.code, revision: room.revision }, actor).then(
        () => "",
        (e) => e.message,
      );
    };
    // Signed out on another device while the copy was being made.
    const signedOut = await del(racing(() => db.prepare("DELETE FROM session WHERE id=?").bind(actor.id).run()));
    assert.equal(signedOut, DELETE_ACCESS_CHANGED);
    await signIn();
    // Someone played meanwhile.
    const changed = await del(
      racing(() => db.prepare("UPDATE campaign_rooms SET revision=revision+1 WHERE code=?").bind(dm.code).run()),
    );
    assert.equal(changed, "The campaign changed. Refresh before deleting it.");
    assert.ok(await readRoom(dm.code), "the campaign was not deleted");
  } finally {
    delete globalThis.__env__;
  }
});
