import assert from "node:assert/strict";
import test from "node:test";

// 3D dice for the DM (owner choice 2026-11-06): the room poll's roll number and the DM-only read
// of new rolls. Disposable in-memory D1 with every migration; never a real campaign.
const { localAccountDb } = await import(new URL("../../../scripts/account-dev-db.mjs", import.meta.url).href);
const db = localAccountDb();
(globalThis as { __env__?: unknown }).__env__ = { DB: db };
const { openRoom, joinRoom, characterRoll, pollRoom, roomRollsSince } = await import("./cloud.server.ts");
const { tradeFixture } = await import("./test-fixtures/trade-economy.ts");

const roll = (code: string, token: string, purseId: string, key: string) =>
  characterRoll({ code, token, purseId, requestKey: `table-dice-roll-${key}`, revision: 0, kind: "custom", formula: "2d6+1", label: "Check" });

test("a DM's unchanged poll carries the room's latest roll number; a player's never does", async () => {
  const dm = await openRoom({ name: "DM", table: tradeFixture() });
  const player = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
  const poll = (seat: { token: string; seatId?: string }, revision: number, seatId: string, watchRolls = true) =>
    pollRoom({ code: dm.code, token: seat.token, knownRevision: revision, knownSeatId: seatId, watchRolls });
  const dmView = await pollRoom({ code: dm.code, token: dm.token });
  const pView = await pollRoom({ code: dm.code, token: player.token });
  assert.ok("table" in dmView && "table" in pView);
  const dmFirst = await poll(dm, dmView.revision, dmView.seatId);
  assert.ok("unchanged" in dmFirst);
  assert.equal(dmFirst.rollSeq, 0, "no rolls yet");
  await roll(dm.code, player.token, "a", "first-roll-00001");
  const dmAfter = await poll(dm, dmView.revision, dmView.seatId);
  assert.ok("unchanged" in dmAfter && dmAfter.rollSeq! > 0, "a roll moves the number without a new revision");
  const playerPoll = await poll(player, pView.revision, pView.seatId);
  assert.ok("unchanged" in playerPoll);
  assert.equal(playerPoll.rollSeq, undefined, "players never learn of other rolls");
  const notAsked = await poll(dm, dmView.revision, dmView.seatId, false);
  assert.equal("unchanged" in notAsked ? notAsked.rollSeq : "full", undefined, "only when asked");
});

test("only a DM reads new rolls, only this room's, oldest first, at most ten", async () => {
  const dm = await openRoom({ name: "DM", table: tradeFixture() });
  const player = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
  const other = await openRoom({ name: "Other DM", table: tradeFixture() });
  const otherPlayer = await joinRoom({ code: other.code, purseId: "a", name: "Elsewhere" });
  await roll(other.code, otherPlayer.token, "a", "other-room-00001");
  const start = await roomRollsSince({ code: dm.code, token: dm.token, after: 0 });
  assert.deepEqual(start.rolls, [], "another room's rolls are never read");
  for (let i = 0; i < 12; i++) await roll(dm.code, player.token, "a", `many-rolls-${String(i).padStart(5, "0")}`);
  const page = await roomRollsSince({ code: dm.code, token: dm.token, after: 0 });
  assert.equal(page.rolls.length, 10);
  assert.ok(page.rolls.every((r, i, all) => i === 0 || r.seq > all[i - 1]!.seq));
  const rest = await roomRollsSince({ code: dm.code, token: dm.token, after: page.rollSeq });
  assert.equal(rest.rolls.length, 2);
  const newest = rest.rolls.at(-1)!.roll as { total: number; dice: number[]; formula: string; characterId: string };
  assert.equal(newest.formula, "2d6+1");
  assert.equal(newest.characterId, "a");
  assert.equal(newest.total, newest.dice[0]! + newest.dice[1]! + 1);
  const none = await roomRollsSince({ code: dm.code, token: dm.token, after: rest.rollSeq });
  assert.deepEqual(none.rolls, []);
  assert.equal(none.rollSeq, rest.rollSeq);
  await assert.rejects(roomRollsSince({ code: dm.code, token: player.token, after: 0 }), /Only the DM/);
  await assert.rejects(roomRollsSince({ code: dm.code, token: "not-a-seat", after: 0 }), /Only the DM/);
});

test("account characters' rolls are read too, and the cursor always moves past what was read", async () => {
  const dm = await openRoom({ name: "DM", table: tradeFixture() });
  const insert = (id: string, characterId: string, at: number) =>
    db
      .prepare("INSERT INTO play_rolls(id,user_id,character_id,code,request_key,body,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(
        id,
        "account-user",
        characterId,
        dm.code,
        `key-${id}`,
        JSON.stringify({ id, characterId, character: "Arden", actor: "Account name", label: "Check", formula: "1d20", dice: [12], mode: "normal", modifier: 0, total: 12, source: "server" }),
        at,
      )
      .run();
  await db
    .prepare("INSERT OR IGNORE INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,0,0,0)")
    .bind("account-user", "Account name", "player@example.com")
    .run();
  await insert("acct-roll-1", "profile-arden", Date.now());
  await insert("camp-roll-1", `campaign:${dm.code}:a`, Date.now());
  const read = await roomRollsSince({ code: dm.code, token: dm.token, after: 0 });
  assert.deepEqual(read.rolls.map((r) => r.roll.characterId), ["profile-arden", "a"]);
  assert.ok(read.rollSeq > 0, "the cursor moves past account rolls");
  assert.equal(JSON.stringify(read).includes("Account name"), false, "no account names");
  const again = await roomRollsSince({ code: dm.code, token: dm.token, after: read.rollSeq });
  assert.deepEqual(again.rolls, []);
});

test("the DM's own rolls are never returned (they stay off the TV), but the cursor moves past them", async () => {
  const dm = await openRoom({ name: "DM", table: tradeFixture() });
  const player = await joinRoom({ code: dm.code, purseId: "a", name: "Arden's player" });
  await roll(dm.code, dm.token, "a", "dm-secret-roll-01");
  await roll(dm.code, player.token, "a", "player-roll-00001");
  const read = await roomRollsSince({ code: dm.code, token: dm.token, after: 0 });
  assert.equal(read.rolls.length, 1, "only the player's roll");
  const again = await roomRollsSince({ code: dm.code, token: dm.token, after: 0 });
  assert.equal(again.rollSeq, read.rollSeq);
  await roll(dm.code, dm.token, "a", "dm-secret-roll-02");
  const onlyDm = await roomRollsSince({ code: dm.code, token: dm.token, after: read.rollSeq });
  assert.deepEqual(onlyDm.rolls, []);
  assert.ok(onlyDm.rollSeq > read.rollSeq, "the cursor still moves past the DM's roll");
});
