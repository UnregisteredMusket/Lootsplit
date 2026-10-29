// Online backups per campaign (owner decision 2026-10-28, migration 0028): each account keeps at
// most CAMPAIGN_BACKUP_LIMIT backups of one campaign; a new one replaces the campaign's oldest,
// only when confirmed, in the same batch and only once the new one is fully stored. Every case
// uses a disposable local D1 stand-in with every migration applied; never a real campaign.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { localAccountDb } from "./account-dev-db.mjs";
import { assertAdditiveSql } from "./production-migrations.mjs";
import { handleAccounts, LIBRARY_LIMITS } from "../cloudflare/accounts.mjs";
import { CAMPAIGN_BACKUP_LIMIT } from "../cloudflare/backup-rotation.mjs";
import { ACCOUNT_BACKUP_BYTES } from "../cloudflare/backup-parts.mjs";
import {
  backupToReplace,
  campaignBackupKey,
  CAMPAIGN_BACKUP_LIMIT as CLIENT_LIMIT,
} from "../src/lib/account/campaign-backups.ts";

const origin = "http://localhost:8080";
const payload = { kind: "quire", version: 2, purses: [], holdings: [], ledger: [], shops: [], stock: [] };

function setup() {
  const DB = localAccountDb();
  const env = {
    DB,
    ACCOUNT_SECRET: "only-a-disposable-test-secret-12345678901234567890",
    ACCOUNT_ORIGIN: origin,
    HOSTED_CAMPAIGN_LIMIT: "100",
  };
  let ip = 0;
  const call = async (path, body, cookie = "") => {
    const headers = { origin, "cf-connecting-ip": `192.0.2.${++ip}` };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await handleAccounts(
      new Request(origin + "/api/account/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
    return {
      response,
      data: await response.json(),
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  };
  const signup = async (email) => {
    const r = await call("auth/sign-up/email", { email, password: "a long unique test password", name: "Test DM" });
    assert.equal(r.response.status, 200, JSON.stringify(r.data));
    const id = (await call("library", undefined, r.cookie)).data.user.id;
    return { cookie: r.cookie, id };
  };
  const ids = async (userId) =>
    (await DB.prepare("SELECT id FROM library_backups WHERE user_id=? ORDER BY created_at,id").bind(userId).all()).results.map(
      (r) => r.id,
    );
  const seed = async (userId, id, at, key = null, body = "{}") =>
    DB.prepare("INSERT INTO library_backups(id,user_id,name,body,created_at,campaign_key) VALUES(?,?,?,?,?,?)")
      .bind(id, userId, `Backup ${id}`, body, at, key)
      .run();
  // A small shared room with the DM (and optionally a player) linked to their accounts.
  const room = async (code, dm, player) => {
    const value = {
      code,
      revision: 1,
      seats: [
        { id: "dm-seat", token: `${code}-dm`, role: "dm", purseIds: [] },
        { id: "player-seat", token: `${code}-player`, role: "player", purseIds: [] },
      ],
      table: { purses: [], holdings: [], ledger: [], shops: [], stock: [], notes: [] },
      drafts: {},
    };
    await DB.prepare("INSERT INTO campaign_rooms(code,revision,body) VALUES (?,1,?)").bind(code, JSON.stringify(value)).run();
    assert.equal((await call("link", { code, token: `${code}-dm`, name: `Campaign ${code}` }, dm.cookie)).response.status, 200);
    if (player)
      assert.equal(
        (await call("link", { code, token: `${code}-player`, name: `Campaign ${code}` }, player.cookie)).response.status,
        200,
      );
    return (await DB.prepare("SELECT revision FROM campaign_rooms WHERE code=?").bind(code).first()).revision;
  };
  const exists = async (code) => !!(await DB.prepare("SELECT code FROM campaign_rooms WHERE code=?").bind(code).first());
  return { DB, call, signup, ids, seed, room, exists };
}

test("0028 is additive and the limit is one constant shared by the Worker and the page", () => {
  const sql = readFileSync(new URL("../cloudflare/migrations/0028_library_backup_campaign.sql", import.meta.url), "utf8");
  assert.equal(assertAdditiveSql("0028_library_backup_campaign.sql", sql), 2);
  assert.equal(CAMPAIGN_BACKUP_LIMIT, 3);
  assert.equal(CLIENT_LIMIT, CAMPAIGN_BACKUP_LIMIT);
  assert.equal(campaignBackupKey("room:ABC123"), "room:ABC123");
  assert.equal(campaignBackupKey("device:5b1c-uuid"), "device:5b1c-uuid");
  for (const bad of ["", "room:", "other:x", "room:a b", "room:x'--", 7, null]) assert.equal(campaignBackupKey(bad), null);
  const rows = [
    { id: "c", name: "C", created_at: 3, campaign_key: "room:A" },
    { id: "a", name: "A", created_at: 1, campaign_key: "room:A" },
    { id: "x", name: "X", created_at: 0, campaign_key: "room:B" },
    { id: "b", name: "B", created_at: 2, campaign_key: "room:A" },
  ];
  assert.equal(backupToReplace(rows, "room:A")?.id, "a", "the page names the oldest of that campaign");
  assert.equal(backupToReplace(rows, "room:B"), null);
  assert.equal(backupToReplace(rows, null), null, "a backup without a campaign never rotates");
});

test("the 4th backup of a campaign replaces the oldest, only when confirmed, in one batch", async () => {
  const { DB, call, signup, ids } = setup();
  try {
    const dm = await signup("rotate@example.com");
    const key = "device:campaign-one";
    const saved = [];
    for (let i = 0; i < 3; i++) {
      const r = await call("backup", { name: `Save ${i}`, payload, campaignKey: key }, dm.cookie);
      assert.equal(r.response.status, 200, JSON.stringify(r.data));
      assert.equal(r.data.replaced, null);
      saved.push(r.data.id);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const library = (await call("library", undefined, dm.cookie)).data;
    assert.deepEqual(library.backupLimits, { perCampaign: 3 });
    assert.ok(library.backups.every((b) => b.campaign_key === key), "the library names each backup's campaign");
    // Not confirmed: refused with the backup it would replace; nothing changes.
    const unconfirmed = await call("backup", { name: "Save 3", payload, campaignKey: key }, dm.cookie);
    assert.equal(unconfirmed.response.status, 409);
    assert.match(unconfirmed.data.error, /replaces your oldest online backup of this campaign, “Save 0”/);
    assert.match(unconfirmed.data.error, /Download it first/);
    assert.equal(unconfirmed.data.replaces.id, saved[0]);
    assert.deepEqual(await ids(dm.id), saved);
    // Confirming a backup that is not the oldest is refused too.
    assert.equal((await call("backup", { name: "Save 3", payload, campaignKey: key, replace: saved[1] }, dm.cookie)).response.status, 409);
    assert.deepEqual(await ids(dm.id), saved);
    const rotated = await call("backup", { name: "Save 3", payload, campaignKey: key, replace: saved[0] }, dm.cookie);
    assert.equal(rotated.response.status, 200, JSON.stringify(rotated.data));
    assert.equal(rotated.data.replaced, saved[0]);
    assert.deepEqual(await ids(dm.id), [saved[1], saved[2], rotated.data.id], "the oldest is replaced, the rest kept");
    // A retried confirmation for the backup that is already gone removes nothing more.
    const retry = await call("backup", { name: "Save 4", payload, campaignKey: key, replace: saved[0] }, dm.cookie);
    assert.equal(retry.response.status, 409);
    assert.deepEqual(await ids(dm.id), [saved[1], saved[2], rotated.data.id]);
    // The new backup reads back.
    assert.deepEqual((await call("read-backup", { id: rotated.data.id }, dm.cookie)).data.payload, payload);
    assert.equal((await DB.prepare("SELECT campaign_key FROM library_backups WHERE id=?").bind(rotated.data.id).first()).campaign_key, key);
  } finally {
    DB.close();
  }
});

test("a failed new backup leaves the old one intact", async () => {
  const { DB, call, signup, ids, seed } = setup();
  try {
    const dm = await signup("failed@example.com");
    const key = "device:campaign-fail";
    for (let i = 0; i < 3; i++) await seed(dm.id, `old-${i}`, i, key);
    // The batch fails inside D1 (for example a row too large): it rolls back, the oldest stays.
    const original = DB.batch;
    DB.batch = async (statements) => {
      assert.equal(statements.length, 2, "the new backup and the removal are one batch");
      return original.call(DB, [
        ...statements.slice(0, 1),
        DB.prepare("INSERT INTO library_backups(id,user_id,name,body,created_at) VALUES(NULL,NULL,NULL,NULL,NULL)"),
        ...statements.slice(1),
      ]);
    };
    const failed = await call("backup", { name: "New", payload, campaignKey: key, replace: "old-0" }, dm.cookie);
    DB.batch = original;
    assert.equal(failed.response.status, 500);
    assert.deepEqual(await ids(dm.id), ["old-0", "old-1", "old-2"]);
    // The new backup does not fit even after the rotation: refused, nothing removed.
    await seed(dm.id, "filler", 10, null, "x".repeat(ACCOUNT_BACKUP_BYTES - 50));
    const full = await call("backup", { name: "New", payload, campaignKey: key, replace: "old-0" }, dm.cookie);
    assert.equal(full.response.status, 413);
    assert.match(full.data.error, /backup storage is full/);
    assert.deepEqual(await ids(dm.id), ["old-0", "old-1", "old-2", "filler"]);
  } finally {
    DB.close();
  }
});

test("a legacy account with 10 backups of one campaign keeps 9 of them after one new backup", async () => {
  const { DB, call, signup, ids, seed } = setup();
  try {
    const dm = await signup("legacy@example.com");
    const key = "device:legacy-campaign";
    for (let i = 0; i < 10; i++) await seed(dm.id, `legacy-${String(i).padStart(2, "0")}`, 100 + i, key);
    // Nothing is removed retroactively: reading the library changes nothing.
    assert.equal((await call("library", undefined, dm.cookie)).data.backups.length, 10);
    assert.equal((await ids(dm.id)).length, 10);
    const r = await call("backup", { name: "New", payload, campaignKey: key, replace: "legacy-00" }, dm.cookie);
    assert.equal(r.response.status, 200, JSON.stringify(r.data));
    const left = await ids(dm.id);
    assert.equal(left.length, 10);
    assert.deepEqual(left.slice(0, 9), Array.from({ length: 9 }, (_, i) => `legacy-0${i + 1}`.replace("legacy-010", "legacy-10")));
    assert.equal(left[9], r.data.id);
  } finally {
    DB.close();
  }
});

test("backups without a campaign never rotate and other campaigns' and accounts' backups are never touched", async () => {
  const { DB, call, signup, ids, seed } = setup();
  try {
    const a = await signup("owner-a@example.com"),
      b = await signup("owner-b@example.com");
    const key = "device:shared-name";
    for (let i = 0; i < 3; i++) await seed(a.id, `a-${i}`, i, key);
    for (let i = 0; i < 3; i++) await seed(a.id, `a-other-${i}`, i, "device:another-campaign");
    for (let i = 0; i < 3; i++) await seed(a.id, `a-none-${i}`, i);
    for (let i = 0; i < 3; i++) await seed(b.id, `b-${i}`, i, key);
    // An older app sends no campaign key (or an invalid one): saved, nothing replaced.
    for (const campaignKey of [undefined, "not a key", "room:x'--"]) {
      const r = await call("backup", { name: "Older app", payload, ...(campaignKey ? { campaignKey } : {}) }, a.cookie);
      assert.equal(r.response.status, 200);
      assert.equal(r.data.replaced, null);
    }
    assert.equal((await ids(a.id)).length, 12);
    // Account B cannot use account A's backup id to remove it, even with the same campaign key.
    const crossed = await call("backup", { name: "B", payload, campaignKey: key, replace: "a-0" }, b.cookie);
    assert.equal(crossed.response.status, 409);
    assert.equal(crossed.data.replaces.id, "b-0", "B is shown only its own oldest backup");
    assert.equal(
      (await call("read-backup", { id: "a-0" }, b.cookie)).response.status,
      404,
      "and still cannot read A's backup",
    );
    assert.ok(!(await call("library", undefined, b.cookie)).data.backups.some((x) => x.id.startsWith("a-")));
    assert.equal((await call("backup", { name: "B", payload, campaignKey: key, replace: "b-0" }, b.cookie)).response.status, 200);
    const rotated = await call("backup", { name: "A", payload, campaignKey: key, replace: "a-0" }, a.cookie);
    assert.equal(rotated.response.status, 200);
    const left = await ids(a.id);
    assert.ok(!left.includes("a-0"));
    for (const id of ["a-1", "a-2", "a-other-0", "a-other-1", "a-other-2", "a-none-0", "a-none-1", "a-none-2"])
      assert.ok(left.includes(id), `${id} is kept`);
    assert.deepEqual((await ids(b.id)).slice(0, 2), ["b-1", "b-2"]);
    // The removal path itself is unchanged: one's own backups only.
    await call("remove", { kind: "backup", id: "a-1" }, b.cookie);
    assert.ok((await ids(a.id)).includes("a-1"));
    // Signed out: no backup, no export.
    assert.equal((await call("backup", { name: "X", payload, campaignKey: key })).response.status, 401);
  } finally {
    DB.close();
  }
});

test("campaign deletion rotates the room's oldest backup instead of being refused", async () => {
  const { DB, call, signup, ids, seed, room, exists } = setup();
  try {
    const dm = await signup("delete-rotate@example.com"),
      player = await signup("delete-player@example.com");
    const revision = await room("ROTATE01", dm, player);
    const key = "room:ROTATE01";
    // A legacy deletion copy (no campaign_key) of this room counts as its backup too.
    await seed(dm.id, "legacy-deletion", 1, null);
    await DB.prepare("INSERT INTO campaign_deletion_backups(backup_id,user_id,source_code) VALUES('legacy-deletion',?,'ROTATE01')")
      .bind(dm.id)
      .run();
    await seed(dm.id, "room-2", 2, key);
    await seed(dm.id, "room-3", 3, key);
    await seed(dm.id, "elsewhere", 0, "room:OTHER001");
    const library = (await call("library", undefined, dm.cookie)).data;
    assert.equal(library.backups.find((b) => b.id === "legacy-deletion").campaign_key, key);
    const body = { action: "delete", code: "ROTATE01", confirm: "ROTATE01", revision };
    // A player cannot download or delete the DM's campaign.
    assert.equal((await call("campaign", { action: "export", code: "ROTATE01" }, player.cookie)).response.status, 403);
    assert.equal((await call("campaign", { ...body, replace: "legacy-deletion" }, player.cookie)).response.status, 403);
    // Not confirmed: refused, naming the backup; the campaign and every backup stay.
    const unconfirmed = await call("campaign", body, dm.cookie);
    assert.equal(unconfirmed.response.status, 409);
    assert.match(unconfirmed.data.error, /Deleting this campaign replaces your oldest online backup/);
    assert.equal(unconfirmed.data.replaces.id, "legacy-deletion");
    assert.ok(await exists("ROTATE01"));
    assert.equal((await ids(dm.id)).length, 4);
    const deleted = await call("campaign", { ...body, replace: "legacy-deletion" }, dm.cookie);
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data.replaced, "legacy-deletion");
    assert.ok(!(await exists("ROTATE01")));
    const left = await ids(dm.id);
    assert.deepEqual(left.sort(), ["elsewhere", "room-2", "room-3", deleted.data.backupId].sort());
    const copy = await DB.prepare("SELECT campaign_key FROM library_backups WHERE id=?").bind(deleted.data.backupId).first();
    assert.equal(copy.campaign_key, key);
    assert.ok(
      await DB.prepare("SELECT 1 FROM campaign_deletion_backups WHERE backup_id=?").bind(deleted.data.backupId).first(),
      "the new copy still offers shared recovery",
    );
    // The replaced copy's deletion record went with it (cascade).
    assert.equal(await DB.prepare("SELECT 1 FROM campaign_deletion_backups WHERE backup_id='legacy-deletion'").first(), null);
  } finally {
    DB.close();
  }
});

test("deletion is refused only when the copy does not fit even after rotation", async () => {
  const { DB, call, signup, ids, seed, room, exists } = setup();
  try {
    const dm = await signup("delete-full@example.com");
    const revision = await room("FULLDEL1", dm);
    const key = "room:FULLDEL1";
    // The room's oldest backup is large; removing it makes room, nothing else would.
    await seed(dm.id, "big-old", 1, key, "x".repeat(20_000));
    await seed(dm.id, "mid", 2, key);
    await seed(dm.id, "new", 3, key);
    const used = 20_000 + 4;
    await seed(dm.id, "filler", 0, null, "y".repeat(ACCOUNT_BACKUP_BYTES - used - 5_000));
    const body = { action: "delete", code: "FULLDEL1", confirm: "FULLDEL1", revision, replace: "big-old" };
    const deleted = await call("campaign", body, dm.cookie);
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.data));
    assert.ok(!(await exists("FULLDEL1")));
    assert.deepEqual((await ids(dm.id)).sort(), ["filler", "mid", "new", deleted.data.backupId].sort());

    // A second room whose oldest backup is small: the copy cannot fit even after rotation.
    const revision2 = await room("FULLDEL2", dm);
    for (let i = 0; i < 3; i++) await seed(dm.id, `small-${i}`, 10 + i, "room:FULLDEL2");
    await DB.prepare("UPDATE library_backups SET body=? WHERE id='filler'").bind("y".repeat(ACCOUNT_BACKUP_BYTES - 200)).run();
    const before = await ids(dm.id);
    const refused = await call(
      "campaign",
      { action: "delete", code: "FULLDEL2", confirm: "FULLDEL2", revision: revision2, replace: "small-0" },
      dm.cookie,
    );
    assert.equal(refused.response.status, 413);
    assert.match(refused.data.error, /even after it replaces this campaign's oldest online backup/);
    assert.match(refused.data.error, /Download a copy/);
    assert.match(refused.data.error, /not deleted/);
    assert.ok(await exists("FULLDEL2"), "the campaign is kept");
    assert.deepEqual(await ids(dm.id), before, "no backup was added or removed");
    // Download a copy still works, as the same device backup file the deletion copy holds.
    const exported = await call("campaign", { action: "export", code: "FULLDEL2" }, dm.cookie);
    assert.equal(exported.response.status, 200);
    assert.equal(exported.data.payload.kind, "quire");
    assert.equal(exported.data.payload.version, 2);
    assert.equal(exported.data.payload.campaignRecovery, undefined, "recovery records stay with the online copy");
    const { readQuireFile } = await import("../src/lib/quire/economy.ts");
    assert.equal(readQuireFile(exported.data.payload).kind, "quire", "Import reads the downloaded file");
    assert.deepEqual(await ids(dm.id), before, "downloading changes nothing");
  } finally {
    DB.close();
  }
});

test("a partial deletion copy leaves the replaced backup and the campaign intact", async () => {
  const db = localAccountDb();
  globalThis.__env__ = { DB: db, HOSTED_CAMPAIGN_LIMIT: "100" };
  const { openRoom } = await import("../src/lib/quire/cloud.server.ts");
  const { readRoom, updateRoom } = await import("../src/lib/quire/room-store.server.ts");
  const { tradeFixture } = await import("../src/lib/quire/test-fixtures/trade-economy.ts");
  const { campaignAction } = await import("../cloudflare/account-campaigns.mjs");
  const userId = "partial-dm",
    actor = { id: "partial-session" };
  await db.prepare(`INSERT INTO "user"(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,'DM','partial-dm@example.com',1,null,0,0)`).bind(userId).run();
  await db.prepare(`INSERT INTO "session"(id,expiresAt,token,createdAt,updatedAt,userId) VALUES(?,?,'partial-token',0,0,?)`).bind(actor.id, new Date(Date.now() + 86_400_000).toISOString(), userId).run();
  try {
    const dm = await openRoom({ name: "Partial DM", table: tradeFixture(), userId });
    const room = await readRoom(dm.code);
    const purse = room.table.purses[0].id;
    // About 1.6 MB of ledger: the deletion copy is stored in parts.
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
    for (let i = 0; i < 3; i++)
      await db.prepare("INSERT INTO library_backups(id,user_id,name,body,created_at,campaign_key) VALUES(?,?,?,'{}',?,?)").bind(`p-${i}`, userId, `P${i}`, i, `room:${dm.code}`).run();
    const before = await readRoom(dm.code);
    const body = { action: "delete", code: dm.code, confirm: dm.code, revision: before.revision, replace: "p-0" };
    // One part never arrives: the copy is incomplete, so nothing is replaced or deleted.
    const original = db.batch;
    db.batch = async (statements) => original.call(db, statements.filter((s, i) => i !== 2));
    await assert.rejects(campaignAction(db, userId, body, actor), (error) => error.status === 409);
    db.batch = original;
    assert.ok(await readRoom(dm.code), "the campaign is kept");
    assert.ok(await db.prepare("SELECT 1 FROM library_backups WHERE id='p-0'").first(), "the oldest backup is kept");
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM campaign_deletion_backups WHERE user_id=?").bind(userId).first()).n,
      0,
    );
    // Clean up the incomplete row the failed attempt left (as a person would remove it), then retry.
    await db.prepare("DELETE FROM library_backups WHERE user_id=? AND id NOT LIKE 'p-%'").bind(userId).run();
    const deleted = await campaignAction(db, userId, body, actor);
    assert.equal(deleted.replaced, "p-0");
    assert.equal(await readRoom(dm.code), null);
    assert.equal(await db.prepare("SELECT 1 FROM library_backups WHERE id='p-0'").first(), null);
    assert.ok(await db.prepare("SELECT 1 FROM library_backups WHERE id='p-1'").first());
  } finally {
    delete globalThis.__env__;
  }
});

test("the overall account limits still apply after rotation", async () => {
  const { DB, call, signup, ids, seed } = setup();
  try {
    const dm = await signup("overall@example.com");
    const key = "device:overall";
    for (let i = 0; i < 3; i++) await seed(dm.id, `k-${i}`, i, key);
    for (let i = 3; i < LIBRARY_LIMITS.backups; i++) await seed(dm.id, `n-${i}`, i);
    // At 20 backups: a rotation keeps the count at 20, so it is allowed; a new campaign is not.
    assert.equal((await call("backup", { name: "Rotated", payload, campaignKey: key, replace: "k-0" }, dm.cookie)).response.status, 200);
    assert.equal((await ids(dm.id)).length, LIBRARY_LIMITS.backups);
    const other = await call("backup", { name: "Other", payload, campaignKey: "device:new-one" }, dm.cookie);
    assert.equal(other.response.status, 413);
    assert.equal((await ids(dm.id)).length, LIBRARY_LIMITS.backups);
  } finally {
    DB.close();
  }
});
