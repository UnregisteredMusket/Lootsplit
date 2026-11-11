// Account API edges (audit 2026-11-10, H7 and H10). H7: an online backup larger than one D1 row
// (2 MB) is stored in parts like a deletion copy (backup-parts.mjs, migration 0027) and reads,
// lists, rotates and removes like any backup; older single-row backups stay readable. H10: an
// unknown library entry kind, including an Object prototype name, is a normal 400, not a 500.
// Every case uses a disposable local D1 stand-in with every migration applied, made to refuse a
// value above D1's 2 MB row limit as D1 does; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import { saveLibraryBackup, removeLibraryEntry, readLibraryBackup } from "../cloudflare/accounts.mjs";
import { BACKUP_PART_BYTES } from "../cloudflare/backup-parts.mjs";

const ROW_LIMIT = 2_000_000;
const bytes = (value) => Buffer.byteLength(value);

/** The local D1 stand-in, refusing any bound value above D1's 2 MB row limit when written. */
function rowLimitedDb() {
  const db = localAccountDb();
  const prepare = db.prepare;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind;
    let args = [];
    statement.bind = (...values) => {
      args = values;
      bind.apply(statement, values);
      return statement;
    };
    const tooBig = () => {
      if (/^\s*(INSERT|UPDATE)/i.test(sql) && args.some((v) => typeof v === "string" && bytes(v) > ROW_LIMIT))
        throw new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG");
    };
    const { run, runSync } = statement;
    statement.run = async () => (tooBig(), run());
    statement.runSync = () => (tooBig(), runSync());
    return statement;
  };
  return db;
}

async function account(db, id) {
  await db
    .prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM',?,1,null,0,0)`)
    .bind(id, `${id}@example.com`)
    .run();
  return id;
}

const small = { kind: "quire", version: 2, purses: [], holdings: [], ledger: [], shops: [], stock: [] };
/** A device campaign of about `size` bytes (multibyte ledger text), as the backup request sends it. */
function campaign(size) {
  const summary = `Bought rope – é漢😀 ${"lantern oil ".repeat(20)}`;
  const entry = (i) => ({ id: `l-${i}`, at: i, purseId: "party", shopId: null, summary: `${i} ${summary}`, copper: -1 - (i % 97), transactionType: "purchase" });
  const count = Math.ceil(size / bytes(JSON.stringify(entry(0))));
  return { ...small, purses: [{ id: "party", name: "Party" }], ledger: Array.from({ length: count }, (_, i) => entry(i)) };
}
const rows = async (db, userId) =>
  (await db.prepare("SELECT id,body FROM library_backups WHERE user_id=? ORDER BY created_at,id").bind(userId).all()).results;
const partCount = async (db, id) =>
  Number((await db.prepare("SELECT COUNT(*) AS n FROM library_backup_parts WHERE backup_id=?").bind(id).first()).n);
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

test("H7: an online backup larger than one D1 row is stored in parts and restored exactly", async () => {
  const db = rowLimitedDb();
  try {
    const userId = await account(db, "big-backup-dm");
    const payload = campaign(3_000_000);
    const serialized = JSON.stringify(payload);
    assert.ok(bytes(serialized) > ROW_LIMIT && bytes(serialized) < 4_000_000, `backup is ${bytes(serialized)} bytes`);
    const saved = await saveLibraryBackup(db, userId, { name: "Large campaign", payload, campaignKey: "device:large" });
    assert.equal(saved.replaced, null);
    const [row] = await rows(db, userId);
    assert.equal(row.id, saved.id);
    assert.ok(bytes(row.body) < 1_000, "the row keeps only the parts marker");
    const parts = (await db.prepare("SELECT body FROM library_backup_parts WHERE backup_id=? ORDER BY part").bind(saved.id).all()).results;
    assert.ok(parts.length >= 3);
    assert.ok(parts.every((p) => bytes(p.body) <= BACKUP_PART_BYTES));
    assert.equal(parts.map((p) => p.body).join(""), serialized);
    // Read back (download and restore read the same endpoint) exactly as uploaded.
    assert.deepEqual(await readLibraryBackup(db, userId, { id: saved.id }), payload);
    // Another account cannot read it.
    await assert.rejects(readLibraryBackup(db, await account(db, "other-dm"), { id: saved.id }), (e) => e.status === 404);
    // Removing it removes its parts.
    assert.deepEqual(await removeLibraryEntry(db, userId, { kind: "backup", id: saved.id }), { ok: true });
    assert.equal((await rows(db, userId)).length, 0);
    assert.equal(await partCount(db, saved.id), 0);
  } finally {
    db.close();
  }
});

test("H7: small and older single-row backups are unchanged and still read", async () => {
  const db = rowLimitedDb();
  try {
    const userId = await account(db, "small-backup-dm");
    const saved = await saveLibraryBackup(db, userId, { name: "Small", payload: small, campaignKey: "device:small" });
    const [row] = await rows(db, userId);
    assert.equal(row.body, JSON.stringify(small), "a backup that fits one row stays one row");
    assert.equal(await partCount(db, saved.id), 0);
    assert.deepEqual(await readLibraryBackup(db, userId, { id: saved.id }), small);
    // A backup saved before this change (no campaign key, inline body).
    await db
      .prepare("INSERT INTO library_backups(id,user_id,name,body,created_at) VALUES('legacy',?,'Old',?,1)")
      .bind(userId, JSON.stringify({ ...small, purses: [{ id: "p", name: "Old purse" }] }))
      .run();
    assert.equal((await readLibraryBackup(db, userId, { id: "legacy" })).purses[0].name, "Old purse");
  } finally {
    db.close();
  }
});

test("H7: a large backup rotates within the campaign's 3 backups, only when confirmed", async () => {
  const db = rowLimitedDb();
  try {
    const userId = await account(db, "rotate-large-dm");
    const key = "device:rotate-large";
    const big = campaign(2_200_000);
    const saved = [];
    for (let i = 0; i < 3; i++) {
      saved.push((await saveLibraryBackup(db, userId, { name: `Save ${i}`, payload: i === 0 ? big : small, campaignKey: key })).id);
      await tick();
    }
    assert.ok((await partCount(db, saved[0])) >= 2);
    await assert.rejects(
      saveLibraryBackup(db, userId, { name: "Save 3", payload: big, campaignKey: key }),
      (e) => e.status === 409 && e.replaces?.id === saved[0],
    );
    assert.deepEqual((await rows(db, userId)).map((r) => r.id), saved, "nothing changed without confirmation");
    const rotated = await saveLibraryBackup(db, userId, { name: "Save 3", payload: big, campaignKey: key, replace: saved[0] });
    assert.equal(rotated.replaced, saved[0]);
    assert.deepEqual((await rows(db, userId)).map((r) => r.id), [saved[1], saved[2], rotated.id]);
    assert.equal(await partCount(db, saved[0]), 0, "the replaced backup's parts went with it");
    assert.deepEqual(await readLibraryBackup(db, userId, { id: rotated.id }), big);
  } finally {
    db.close();
  }
});

test("H7: a large backup that would not complete keeps the replaced backup", async () => {
  const db = rowLimitedDb();
  try {
    const userId = await account(db, "partial-large-dm");
    const key = "device:partial";
    const saved = [];
    for (let i = 0; i < 3; i++) {
      saved.push((await saveLibraryBackup(db, userId, { name: `Save ${i}`, payload: small, campaignKey: key })).id);
      await tick();
    }
    // The last part fails inside D1: the batch rolls back, nothing is stored or removed.
    const original = db.batch;
    db.batch = async (statements) =>
      original.call(db, [
        ...statements.slice(0, -2),
        db.prepare("INSERT INTO library_backup_parts(backup_id,part,body) VALUES(NULL,NULL,NULL)"),
        ...statements.slice(-2),
      ]);
    await assert.rejects(saveLibraryBackup(db, userId, { name: "Big", payload: campaign(2_200_000), campaignKey: key, replace: saved[0] }));
    db.batch = original;
    assert.deepEqual((await rows(db, userId)).map((r) => r.id), saved);
    assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM library_backup_parts").first()).n), 0);
  } finally {
    db.close();
  }
});

test("H7: a large backup counts toward the account's backup storage, parts included", async () => {
  const db = rowLimitedDb();
  try {
    const userId = await account(db, "quota-large-dm");
    const payload = campaign(2_500_000);
    const chars = JSON.stringify(payload).length;
    // Fill the account to just below the point where this backup would no longer fit.
    const { ACCOUNT_BACKUP_BYTES } = await import("../cloudflare/backup-parts.mjs");
    await db
      .prepare("INSERT INTO library_backups(id,user_id,name,body,created_at) VALUES('filler',?,'Filler',printf('%.*c',?,'x'),1)")
      .bind(userId, Math.min(1_900_000, ACCOUNT_BACKUP_BYTES - chars + 10))
      .run();
    for (let i = 0, left = ACCOUNT_BACKUP_BYTES - chars + 10 - 1_900_000; left > 0; i++, left -= 1_000_000)
      await db
        .prepare("INSERT INTO library_backup_parts(backup_id,part,body) VALUES('filler',?,printf('%.*c',?,'x'))")
        .bind(i, Math.min(1_000_000, left))
        .run();
    await assert.rejects(
      saveLibraryBackup(db, userId, { name: "Too much", payload, campaignKey: "device:quota" }),
      (e) => e.status === 413 && /backup storage is full/.test(e.message),
    );
    assert.deepEqual((await rows(db, userId)).map((r) => r.id), ["filler"]);
  } finally {
    db.close();
  }
});

test("H10: an unknown library entry kind is a 400, prototype names included", async () => {
  const db = rowLimitedDb();
  try {
    const userId = await account(db, "remove-kinds-dm");
    for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "nonsense", undefined])
      await assert.rejects(removeLibraryEntry(db, userId, { kind, id: "x" }), (e) => e.status === 400 && e.message === "Unknown library entry.", String(kind));
    for (const kind of ["backup", "character", "membership"])
      assert.deepEqual(await removeLibraryEntry(db, userId, { kind, id: "missing" }), { ok: true });
  } finally {
    db.close();
  }
});
