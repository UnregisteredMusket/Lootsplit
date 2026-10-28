// Chunked library backups (sectioned storage step 3, migration 0027): a campaign whose deletion
// backup is larger than one D1 row is stored in parts and restored from them exactly. Every case
// uses a disposable local D1 stand-in with every migration applied; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import {
  BACKUP_INLINE_BYTES,
  BACKUP_PART_BYTES,
  backupParts,
  readBackupPayload,
} from "../cloudflare/backup-parts.mjs";

const bytes = (text) => new TextEncoder().encode(text).length;

test("0027 is additive", () => {
  const sql = readFileSync(new URL("../cloudflare/migrations/0027_library_backup_parts.sql", import.meta.url), "utf8");
  assert.equal(assertAdditiveSql("0027_library_backup_parts.sql", sql), 1);
});

test("backup parts split on character boundaries and join back byte for byte", () => {
  assert.equal(backupParts("{}"), null, "a small backup stays inline");
  const text = JSON.stringify({ notes: "é漢😀 ".repeat(Math.ceil((BACKUP_INLINE_BYTES * 1.4) / 10)) });
  const chunked = backupParts(text);
  assert.ok(chunked.parts.length >= 2);
  assert.ok(chunked.parts.every((part) => bytes(part) <= BACKUP_PART_BYTES));
  assert.equal(chunked.parts.join(""), text);
  assert.equal(chunked.marker.bytes, bytes(text));
  assert.equal(chunked.marker.sha256, createHash("sha256").update(text).digest("hex"));
});

test("a campaign too large for one backup row is deleted with a chunked backup and restored exactly", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db, HOSTED_CAMPAIGN_LIMIT: "100" };
  const { openRoom } = await import("../src/lib/quire/cloud.server.ts");
  const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
  const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
  const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
  const { restoreDeletedCampaign } = await import("../cloudflare/campaign-recovery.mjs");
  const userId = "backup-parts-dm",
    actor = { id: "backup-parts-session" };
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM','backup-parts-dm@example.com',1,null,0,0)`).bind(userId).run();
  await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'backup-parts-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
  try {
    const dm = await openRoom({ name: "Chunked DM", table: tradeFixture(), userId });
    // A long ledger (about 1.6 MB, multibyte text) makes the backup larger than one row allows.
    const room = await readRoom(dm.code);
    const purse = room.table.purses[0].id;
    room.table.ledger = Array.from({ length: 6_000 }, (_, i) => ({
      id: `l-${i}`,
      at: i,
      purseId: purse,
      shopId: null,
      summary: `Purchase ${i} – é漢😀 ${"rope ".repeat(30)}`,
      copper: -1 - (i % 97),
      transactionType: "purchase",
    }));
    const base = room.revision;
    room.revision++;
    await updateRoom(room, base);
    const before = await readRoom(dm.code);
    const deleted = await campaignAction(db, userId, { action: "delete", code: dm.code, confirm: dm.code, revision: before.revision }, actor);
    assert.equal(deleted.ok, true);
    const row = await db.prepare("SELECT body FROM library_backups WHERE id=?").bind(deleted.backupId).first();
    assert.ok(bytes(row.body) < 100_000, "the backup row holds only the marker and recovery records");
    const parts = (await db.prepare("SELECT part,body FROM library_backup_parts WHERE backup_id=? ORDER BY part").bind(deleted.backupId).all()).results;
    assert.ok(parts.length >= 2, `the campaign is stored in ${parts.length} parts`);
    const marker = JSON.parse(row.body).$backupParts;
    const joined = parts.map((p) => p.body).join("");
    assert.equal(createHash("sha256").update(joined).digest("hex"), marker.sha256, "parts join back byte for byte");
    const payload = await readBackupPayload(db, deleted.backupId, row.body);
    assert.deepEqual(payload.ledger, before.table.ledger);
    assert.ok(payload.campaignRecovery, "the recovery records come back with the campaign");
    assert.equal(Object.keys(payload).at(-1), "campaignRecovery", "in the same place an inline backup has them");
    const { campaignRecovery: _recovery, ...campaign } = payload;
    assert.equal(JSON.stringify(campaign), joined, "the payload is exactly the stored campaign");

    // The library's backup download reads the same payload.
    const restored = await restoreDeletedCampaign(db, userId, { id: deleted.backupId, requestKey: crypto.randomUUID() }, actor);
    const again = await readRoom(restored.code);
    assert.deepEqual(again.table.ledger, before.table.ledger);
    assert.deepEqual(again.table.purses.map((p) => p.coins), before.table.purses.map((p) => p.coins));

    // A damaged part is an error, never a partial backup.
    await db.prepare("UPDATE library_backup_parts SET body=substr(body,2) WHERE backup_id=? AND part=0").bind(deleted.backupId).run();
    await assert.rejects(readBackupPayload(db, deleted.backupId, row.body), /incomplete/);

    // Removing the backup (or the account) removes its parts.
    await db.prepare("DELETE FROM library_backups WHERE id=?").bind(deleted.backupId).run();
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM library_backup_parts").first()).n, 0);
  } finally {
    delete globalThis.__env__;
  }
});

test("account backup storage counts chunked parts toward the account's limit", async () => {
  const db = localAccountDb();
  const { accountBackupBytesSql } = await import("../cloudflare/backup-parts.mjs");
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES('quota','Q','quota@example.com',1,null,0,0)`).run();
  await db.prepare("INSERT INTO library_backups(id,user_id,name,body,created_at) VALUES('b','quota','B','{}',0)").run();
  await db.prepare("INSERT INTO library_backup_parts(backup_id,part,body) VALUES('b',0,?)").bind("x".repeat(5000)).run();
  const { n } = await db.prepare(`SELECT ${accountBackupBytesSql} AS n`).bind("quota", "quota").first();
  assert.equal(n, 5002);
});
