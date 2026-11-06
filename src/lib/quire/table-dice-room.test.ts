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
