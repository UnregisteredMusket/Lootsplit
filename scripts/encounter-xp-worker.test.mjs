// XP from encounters, Worker level: "Award XP" on an awarded encounter (encounters/award-xp) is
// the DM's only, gives XP exactly once across a replay and a forced race, and loses no other
// write; the journal entry players see uses the DM's "Reason players see" (PR #434 review).
import test from "node:test";
import assert from "node:assert/strict";
import { readStoredRoom, roomWriteStatements } from "../cloudflare/room-storage.mjs";
import { handleEncounters } from "../cloudflare/encounters.mjs";
import { blankEncounter, blankLoot } from "../src/lib/encounters/model.mjs";
import { projectRecord } from "../src/lib/quire/session-records.ts";
import { localAccountDb } from "./account-dev-db.mjs";

const coins = () => ({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
const character = (id, name) => ({ id, name, kind: "character", coins: coins() });
/** A shared campaign with an encounter awarded the old way (loot only, no XP). */
async function awardedEncounter(name = "Secret Lich Ambush") {
  const db = localAccountDb();
  for (const user of ["dm", "player", "stranger"])
    await db
      .prepare("INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)")
      .bind(user, user, `${user}@example.com`)
      .run();
  const room = {
    code: "BATTLE",
    revision: 1,
    turn: 0,
    live: true,
    seats: [
      { id: "dmseat", token: "dm-token", role: "dm", name: "DM", purseIds: [] },
      { id: "playerseat", token: "player-token", role: "player", name: "Hero", purseIds: ["hero"] },
    ],
    table: {
      purses: [
        { id: "party", name: "Party fund", kind: "party", coins: { ...coins(), gp: 10 } },
        character("hero", "Hero"),
        character("ally", "Ally"),
      ],
      holdings: [],
      ledger: [],
      shops: [],
      stock: [],
      notes: [],
      sheets: [],
      loans: [],
      listings: [],
    },
    drafts: {},
    seen: { gifts: [], sales: [] },
  };
  await db.prepare("INSERT INTO campaign_rooms (code,revision,body) VALUES (?,1,?)").bind("BATTLE", JSON.stringify(room)).run();
  for (const u of ["dm", "player"])
    await db
      .prepare("INSERT INTO library_members VALUES (?,?,?,?,?,0,0)")
      .bind(u, "BATTLE", `${u}seat`, `${u}-token`, "Battle")
      .run();
  const call = (user, path, body = {}) => handleEncounters(db, user, `encounters${path}`, body);
  const id = crypto.randomUUID();
  await call("dm", "/create", { id, code: "BATTLE" });
  const e = blankEncounter();
  e.name = name;
  e.loot = [{ ...blankLoot(), name: "Sword", purseId: "hero" }];
  await call("dm", "/save", { id, revision: 0, encounter: e });
  await call("dm", "/conclude", { id, revision: 1 });
  await call("dm", "/award", { id, revision: 2 }); // an older award: loot, no XP
  return { db, call, id };
}
const xp = (total, extra = {}) => ({ unit: "xp", purseIds: ["hero", "ally"], total, ...extra });
const roomOf = async (db) => (await readStoredRoom(db, "BATTLE")).room;
const sheetXp = (room) => room.table.purses.filter((p) => p.kind === "character").map((p) => [p.id, p.sheet?.xp]);
const xpEvents = (room) => (room.table.journal?.events ?? []).filter((e) => /^(XP|Milestone) award/.test(e.summary));
/** Holds every db.batch until `count` batches are waiting, then runs them in order. */
function holdBatches(db, count, beforeRelease = async () => {}) {
  const batch = db.batch.bind(db);
  const waiting = [];
  db.batch = (statements) =>
    new Promise((resolve, reject) => {
      waiting.push(() => batch(statements).then(resolve, reject));
      if (waiting.length === count) {
        db.batch = batch;
        void beforeRelease().then(() => waiting.forEach((run) => run()));
      }
    });
  return () => (db.batch = batch);
}

test("award-xp: players and strangers are refused, and nothing changes", async () => {
  const { db, call, id } = await awardedEncounter();
  const before = await roomOf(db);
  for (const who of ["player", "stranger"])
    await assert.rejects(call(who, "/award-xp", { id, xp: xp(300) }), (e) => e.status === 403 || e.status === 404);
  const after = await roomOf(db);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(sheetXp(after), sheetXp(before));
  assert.equal(xpEvents(after).length, 0);
  const detail = await call("dm", "/detail", { id });
  assert.equal(detail.award.xp, undefined);
  db.close();
});

test("award-xp: a replay returns duplicate and never doubles the XP", async () => {
  const { db, call, id } = await awardedEncounter();
  const first = await call("dm", "/award-xp", { id, xp: xp(301) });
  assert.equal(first.duplicate, false);
  assert.equal(first.award.xp.total, 300); // 150 each, 1 XP unawarded
  const afterFirst = await roomOf(db);
  for (const again of [xp(301), xp(5000)]) {
    const replay = await call("dm", "/award-xp", { id, xp: again });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.award.xp.id, first.award.xp.id);
    assert.equal(replay.award.xp.total, 300);
  }
  const room = await roomOf(db);
  assert.equal(room.revision, afterFirst.revision);
  assert.deepEqual(sheetXp(room), [["hero", 150], ["ally", 150]]);
  assert.equal(xpEvents(room).length, 1);
  db.close();
});

test("award-xp: in a forced race exactly one award applies and the loser reports the winner's", async () => {
  const { db, call, id } = await awardedEncounter();
  const before = await roomOf(db);
  // Both requests read the room and the award before either batch runs.
  const release = holdBatches(db, 2);
  const out = await Promise.allSettled([
    call("dm", "/award-xp", { id, xp: xp(100) }),
    call("dm", "/award-xp", { id, xp: xp(900) }),
  ]);
  release();
  assert.deepEqual(out.map((o) => o.status), ["fulfilled", "fulfilled"], JSON.stringify(out.map((o) => o.reason?.message)));
  const [a, b] = out.map((o) => o.value);
  assert.deepEqual([a.duplicate, b.duplicate].sort(), [false, true]);
  const winner = a.duplicate ? b : a;
  const loser = a.duplicate ? a : b;
  // The loser's response carries the winner's receipt (the UI shows "XP was already awarded").
  assert.deepEqual(loser.award.xp, winner.award.xp);
  const room = await roomOf(db);
  const each = winner.award.xp.total / 2;
  assert.deepEqual(sheetXp(room), [["hero", each], ["ally", each]]);
  assert.equal(xpEvents(room).length, 1);
  assert.equal(room.revision, before.revision + 1);
  // The earlier loot award is intact.
  assert.deepEqual(room.table.holdings.map((h) => h.purseId), before.table.holdings.map((h) => h.purseId));
  assert.equal((await call("dm", "/detail", { id })).award.xp.id, winner.award.xp.id);
  db.close();
});

test("award-xp: a campaign write between the read and the batch is never lost", async () => {
  const { db, call, id } = await awardedEncounter();
  const release = holdBatches(db, 1, async () => {
    // Another device changes the campaign after Award XP has read it.
    const stored = await readStoredRoom(db, "BATTLE");
    const room = structuredClone(stored.room);
    room.revision += 1;
    room.table.notes.push({ id: "note-1", text: "Meanwhile at the inn", at: 1 });
    await db.batch(roomWriteStatements(db, room, { expect: stored.version }).statements);
  });
  await assert.rejects(call("dm", "/award-xp", { id, xp: xp(200) }), (e) => e.status === 409);
  release();
  const room = await roomOf(db);
  assert.deepEqual(room.table.notes.map((n) => n.id), ["note-1"]);
  assert.equal(xpEvents(room).length, 0);
  assert.equal((await call("dm", "/detail", { id })).award.xp, undefined);
  // Retrying after the conflict gives the XP once.
  assert.equal((await call("dm", "/award-xp", { id, xp: xp(200) })).duplicate, false);
  const after = await roomOf(db);
  assert.deepEqual(after.table.notes.map((n) => n.id), ["note-1"]);
  assert.deepEqual(sheetXp(after), [["hero", 100], ["ally", 100]]);
  db.close();
});

test("award-xp: players see the DM's reason, a neutral one when cleared, or the name from older clients", async () => {
  const summaries = async (reason) => {
    const { db, call, id } = await awardedEncounter();
    await call("dm", "/award-xp", { id, xp: xp(200, reason === undefined ? {} : { reason }) });
    const room = await roomOf(db);
    const player = projectRecord(room.table, room.seats[1]);
    const seen = xpEvents({ table: player }).map((e) => e.summary);
    db.close();
    return seen;
  };
  const [own] = await summaries("  The crypt  ");
  assert.match(own, /^XP award \(The crypt\): /);
  const [cleared] = await summaries("   ");
  assert.match(cleared, /^XP award \(Encounter\): /);
  assert.doesNotMatch(cleared, /Lich/);
  const [old] = await summaries(undefined);
  assert.match(old, /^XP award \(Secret Lich Ambush\): /);
  // Validated like xp-award's reason: at most 120 characters after trimming.
  const { db, call, id } = await awardedEncounter();
  await assert.rejects(call("dm", "/award-xp", { id, xp: xp(200, { reason: "x".repeat(121) }) }), (e) => e.status === 400);
  await assert.rejects(call("dm", "/award-xp", { id, xp: xp(200, { reason: 7 }) }), (e) => e.status === 400);
  assert.equal(xpEvents(await roomOf(db)).length, 0);
  db.close();
});

test("award with XP: the loot review's reason reaches the journal in the same award", async () => {
  const f = await awardedEncounter(); // the campaign only; a second, unawarded encounter below
  const id = crypto.randomUUID();
  await f.call("dm", "/create", { id, code: "BATTLE" });
  const e = blankEncounter();
  e.name = "Secret Lich Ambush";
  e.loot = [{ ...blankLoot(), name: "Shield", purseId: "ally" }];
  await f.call("dm", "/save", { id, revision: 0, encounter: e });
  await f.call("dm", "/conclude", { id, revision: 1 });
  const res = await f.call("dm", "/award", { id, revision: 2, xp: xp(50, { reason: "" }) });
  assert.equal(res.award.xp.total, 50);
  const room = await roomOf(f.db);
  const events = xpEvents({ table: projectRecord(room.table, room.seats[1]) });
  assert.equal(events.length, 1);
  assert.match(events[0].summary, /^XP award \(Encounter\): /);
  f.db.close();
});
