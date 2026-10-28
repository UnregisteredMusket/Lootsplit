import test from "node:test";
import assert from "node:assert/strict";
import { localAccountDb } from "./account-dev-db.mjs";
import {
  readRoomCore,
  readStoredRoom,
  readStoredRooms,
  roomDeleteStatement,
  roomVersionSql,
  roomWriteStatements,
  sameRoomVersion,
} from "../cloudflare/room-storage.mjs";

const room = (code, revision = 1, extra = {}) => ({
  code,
  revision,
  turn: 0,
  live: true,
  closed: false,
  ownerId: "owner",
  seats: [{ id: "dm", token: "dm-token", role: "dm", name: "DM", purseIds: [] }],
  table: { purses: [], holdings: [], ledger: [], notes: [] },
  ...extra,
});

async function fixture(...codes) {
  const db = localAccountDb();
  for (const code of codes) {
    const write = roomWriteStatements(db, room(code), { create: true });
    await db.batch(write.statements);
  }
  return db;
}
/** A dependent statement that records a marker only if the room write committed. */
function marker(db, write, label) {
  return db
    .prepare(
      `INSERT INTO play_policies(code,manual_allowed,updated_at) SELECT ?,1,0 WHERE ${write.committed.sql}`,
    )
    .bind(label, ...write.committed.args);
}
const markers = async (db) =>
  (await db.prepare("SELECT code FROM play_policies ORDER BY code").all()).results.map((r) => r.code);

test("a stored read returns the exact stored body and a version that every write changes", async () => {
  const db = await fixture("ALPHA");
  const first = await readStoredRoom(db, "ALPHA");
  assert.equal(first.body, JSON.stringify(room("ALPHA")));
  assert.deepEqual(first.room, room("ALPHA"));
  assert.ok(first.version.writeId, "creation sets a write id");
  const next = { ...first.room, revision: 2 };
  const write = roomWriteStatements(db, next, { expect: first.version });
  const batch = [...write.statements];
  assert.equal(write.changed(await db.batch(batch), batch), true);
  const second = await readStoredRoom(db, "ALPHA");
  assert.equal(second.version.revision, 2);
  assert.notEqual(second.version.writeId, first.version.writeId);
  assert.ok(sameRoomVersion(second.version, write.version));
  assert.equal(await readStoredRoom(db, "MISSING"), null);
  const many = await readStoredRooms(db, ["ALPHA", "MISSING", "ALPHA"]);
  assert.deepEqual([...many.keys()], ["ALPHA"]);
});

test("a write with a stale version changes nothing, including its dependent statements", async () => {
  const db = await fixture("ALPHA");
  const stale = await readStoredRoom(db, "ALPHA");
  // Another writer commits first.
  const other = roomWriteStatements(db, { ...stale.room, revision: 2 }, { expect: stale.version });
  await db.batch(other.statements);
  const write = roomWriteStatements(db, { ...stale.room, revision: 2, turn: 9 }, { expect: stale.version });
  const batch = [
    ...write.statements,
    marker(db, write, "dependent"),
    db
      .prepare(
        `INSERT INTO play_policies(code,manual_allowed,updated_at) SELECT 'read-guard',1,0 WHERE ${roomVersionSql(stale.version).sql}`,
      )
      .bind(...roomVersionSql(stale.version).args),
  ];
  const results = await db.batch(batch);
  assert.equal(write.changed(results, batch), false);
  assert.deepEqual(await markers(db), []);
  assert.equal((await readStoredRoom(db, "ALPHA")).room.turn, 0);
});

test("an identical body written in between still fails the version guard (stricter than body equality)", async () => {
  const db = await fixture("ALPHA");
  const read = await readStoredRoom(db, "ALPHA");
  // Same body and revision, but a new write: a body comparison would have passed.
  await db.batch(roomWriteStatements(db, read.room, { expect: read.version }).statements);
  assert.equal((await readStoredRoom(db, "ALPHA")).body, read.body);
  const write = roomWriteStatements(db, { ...read.room, revision: 2 }, { expect: read.version });
  const batch = [...write.statements];
  assert.equal(write.changed(await db.batch(batch), batch), false);
});

test("a false extraWhere changes nothing, including dependent statements", async () => {
  const db = await fixture("ALPHA");
  const read = await readStoredRoom(db, "ALPHA");
  const write = roomWriteStatements(db, { ...read.room, revision: 2 }, {
    expect: read.version,
    extraWhere: "EXISTS(SELECT 1 FROM site_roles WHERE user_id=?)",
    extraArgs: ["nobody"],
  });
  const batch = [...write.statements, marker(db, write, "dependent")];
  assert.equal(write.changed(await db.batch(batch), batch), false);
  assert.deepEqual(await markers(db), []);
  assert.equal((await readStoredRoom(db, "ALPHA")).version.revision, 1);
  // The same write with a true predicate commits with its dependents.
  const ok = roomWriteStatements(db, { ...read.room, revision: 2 }, {
    expect: read.version,
    extraWhere: "?=1",
    extraArgs: [1],
  });
  const okBatch = [...ok.statements, marker(db, ok, "dependent")];
  assert.equal(ok.changed(await db.batch(okBatch), okBatch), true);
  assert.deepEqual(await markers(db), ["dependent"]);
});

test("a two-room batch commits both rooms or neither", async () => {
  const db = await fixture("ALPHA", "BETA");
  const alpha = await readStoredRoom(db, "ALPHA"),
    beta = await readStoredRoom(db, "BETA");
  // BETA moves on before the batch: the whole two-room change must fail atomically.
  await db.batch(roomWriteStatements(db, { ...beta.room, revision: 2 }, { expect: beta.version }).statements);
  // The character-play pattern: a first statement acquires a claim only if both rooms are as
  // read, and each room write requires that claim, so the rooms commit together or not at all.
  const pair = (x, y, label) => {
    const gx = roomVersionSql(x.version),
      gy = roomVersionSql(y.version);
    return db
      .prepare(`INSERT INTO play_policies(code,manual_allowed,updated_at) SELECT ?,1,0 WHERE ${gx.sql} AND ${gy.sql}`)
      .bind(label, ...gx.args, ...gy.args);
  };
  const claimed = { extraWhere: "EXISTS(SELECT 1 FROM play_policies WHERE code=?)" };
  const a = roomWriteStatements(db, { ...alpha.room, revision: 2, turn: 5 }, { expect: alpha.version, ...claimed, extraArgs: ["claim-1"] });
  const b = roomWriteStatements(db, { ...beta.room, revision: 2, turn: 5 }, { expect: beta.version, ...claimed, extraArgs: ["claim-1"] });
  const stale = [pair(alpha, beta, "claim-1"), ...a.statements, ...b.statements];
  const staleResults = await db.batch(stale);
  assert.equal(a.changed(staleResults, stale) || b.changed(staleResults, stale), false);
  assert.equal((await readStoredRoom(db, "ALPHA")).room.turn, 0, "neither room changed");
  assert.equal((await readStoredRoom(db, "BETA")).room.turn, 0);
  // With current versions both commit.
  const alpha2 = await readStoredRoom(db, "ALPHA"),
    beta2 = await readStoredRoom(db, "BETA");
  const a2 = roomWriteStatements(db, { ...alpha2.room, revision: 2, turn: 6 }, { expect: alpha2.version, ...claimed, extraArgs: ["claim-2"] });
  const b2 = roomWriteStatements(db, { ...beta2.room, revision: 3, turn: 6 }, { expect: beta2.version, ...claimed, extraArgs: ["claim-2"] });
  const batch = [pair(alpha2, beta2, "claim-2"), ...a2.statements, ...b2.statements];
  const results = await db.batch(batch);
  assert.equal(a2.changed(results, batch) && b2.changed(results, batch), true);
  assert.equal((await readStoredRoom(db, "ALPHA")).room.turn, 6);
  assert.equal((await readStoredRoom(db, "BETA")).room.turn, 6);
});

test("revision-only and unversioned writes keep their callers' guards", async () => {
  const db = await fixture("ALPHA");
  const read = await readStoredRoom(db, "ALPHA");
  const wrong = roomWriteStatements(db, { ...read.room, revision: 5 }, { expect: { revision: 4 } });
  assert.equal(wrong.changed(await db.batch(wrong.statements), wrong.statements), false);
  const right = roomWriteStatements(db, { ...read.room, revision: 2 }, { expect: { revision: 1 } });
  assert.equal(right.changed(await db.batch(right.statements), right.statements), true);
  assert.throws(() => roomWriteStatements(db, read.room, { expect: null }), /another guard/);
  assert.throws(() => roomWriteStatements(db, read.room, {}), /must state/);
  assert.throws(
    () => roomWriteStatements(db, { ...read.room, code: "BETA" }, { expect: read.version }),
    /another campaign/,
  );
  const unversioned = roomWriteStatements(db, { ...read.room, revision: 3 }, {
    expect: null,
    extraWhere: "?=1",
    extraArgs: [1],
  });
  assert.equal(unversioned.changed(await db.batch(unversioned.statements), unversioned.statements), true);
  // A create on an existing code fails, as before.
  await assert.rejects(db.batch(roomWriteStatements(db, room("ALPHA"), { create: true }).statements), /UNIQUE/);
});

test("the light read returns top-level fields only, with their stored types", async () => {
  const db = localAccountDb();
  await db.batch(
    roomWriteStatements(db, room("ALPHA", 3, { closed: true, viewOnly: false, campaignName: "Saga" }), {
      create: true,
    }).statements,
  );
  const core = await readRoomCore(db, "ALPHA");
  assert.equal(core.closed, true);
  assert.equal(core.viewOnly, false);
  assert.equal(core.campaignName, "Saga");
  assert.equal(core.ownerId, "owner");
  assert.equal(core.revision, 3);
  assert.equal(core.sessionId, undefined);
  assert.equal("table" in core, false);
  assert.deepEqual(core.seats, room("ALPHA").seats);
  assert.equal(await readRoomCore(db, "MISSING"), null);
});

test("a guarded delete removes the room only at the read version", async () => {
  const db = await fixture("ALPHA");
  const read = await readStoredRoom(db, "ALPHA");
  await db.batch(roomWriteStatements(db, { ...read.room, revision: 2 }, { expect: read.version }).statements);
  assert.equal((await roomDeleteStatement(db, "ALPHA", { expect: read.version }).run()).meta.changes, 0);
  const current = await readStoredRoom(db, "ALPHA");
  assert.equal((await roomDeleteStatement(db, "ALPHA", { expect: current.version }).run()).meta.changes, 1);
  assert.equal(await readStoredRoom(db, "ALPHA"), null);
});
