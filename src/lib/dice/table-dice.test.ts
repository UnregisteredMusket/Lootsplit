import assert from "node:assert/strict";
import test from "node:test";
import { diceForDisplay, onDice, showDice } from "./dice-events.ts";
import { displayShowsRoll } from "./display-dice.ts";
import { noteRollSeq, replyRollSeq, resetTableDice, watchRoomRolls } from "./table-dice.ts";

const base = { formula: "1d20+2", dice: [11], mode: "normal", modifier: 2, total: 13 };

test("a roll with an id is thrown once per page, with where it came from", () => {
  const seen: unknown[] = [];
  const origins: string[] = [];
  const stop = onDice((r, origin) => {
    seen.push(r);
    origins.push(origin);
  });
  showDice({ ...base, id: "room:a:once-1" });
  showDice({ ...base, id: "room:a:once-1" });
  showDice({ ...base });
  showDice({ ...base, id: "room:a:table-1" }, "table");
  stop();
  assert.equal(seen.length, 3);
  assert.deepEqual(origins, ["own", "own", "table"]);
});

test("the display copy carries no seat or account names", () => {
  const copy = diceForDisplay({ ...base, id: "x", character: "Arden", label: "Check", actor: "Dana's account", characterId: "a" } as never);
  assert.deepEqual(Object.keys(copy).sort(), ["character", "dice", "formula", "id", "label", "mode", "modifier", "source", "total"].sort());
  assert.ok(!JSON.stringify(copy).includes("Dana"));
});

test("the TV display throws only visible party characters' rolls", () => {
  const purses = [
    { id: "a", name: "Arden", kind: "character", coins: {} },
    { id: "away", name: "Away", kind: "character", coins: {}, nonParty: true },
    { id: "npc", name: "Guide", kind: "character", control: "npc", coins: {} },
    { id: "hidden", name: "Hidden", kind: "character", coins: {} },
    { id: "party", name: "Party", kind: "party", coins: {} },
    { id: "resting", name: "Resting", kind: "character", coins: {} },
    { id: "veiled", name: "Veiled", kind: "character", coins: {} },
  ];
  const journal = {
    world: {
      npcs: [{ id: "veiled", visible: false }],
      characterPositions: [
        { purseId: "resting", inParty: true, locationId: null, visible: true, sheetVisible: true, downtime: { finishMinute: 99 } },
        { purseId: "hidden", inParty: true, locationId: null, visible: false, sheetVisible: true },
        { purseId: "npc", inParty: true, locationId: null, visible: true, sheetVisible: false },
      ],
    },
  };
  const t = { purses, journal } as never;
  assert.equal(displayShowsRoll(t, "a"), true);
  assert.equal(displayShowsRoll(t, "away"), false, "a character away from the party");
  assert.equal(displayShowsRoll(t, "hidden"), false, "a hidden character");
  assert.equal(displayShowsRoll(t, "npc"), false, "an NPC whose sheet the party cannot see");
  assert.equal(displayShowsRoll(t, "party"), false);
  assert.equal(displayShowsRoll(t, "resting"), false, "a character on downtime");
  assert.equal(displayShowsRoll(t, "veiled"), false, "an NPC record the DM hid");
  assert.equal(displayShowsRoll(t, undefined), false);
  assert.equal(displayShowsRoll(t, "missing"), false);
});

test("a room with no rolls yet reads nothing", async () => {
  resetTableDice();
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  await noteRollSeq({ code: "ROOM1", token: "t" }, 0);
  await noteRollSeq({ code: "ROOM1", token: "t" }, 0);
  await noteRollSeq({ code: "ROOM1", token: "t" }, undefined);
  stop();
  assert.equal(seen.length, 0);
});

test("a read that never answers stops blocking the next rolls after ten seconds", async () => {
  resetTableDice();
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  const seat = { code: "ROOM2", token: "t" };
  const t0 = 1_000_000;
  const roll = (seq: number, at: number) => ({ seq, roll: { ...base, id: `ROOM2:a:${seq}`, characterId: "a", character: "A", label: "Check", source: "server", at } });
  await noteRollSeq(seat, 0, t0, async () => ({ rolls: [], rollSeq: 0 }));
  let reads = 0;
  // The first read hangs; the poll that follows within ten seconds waits for it.
  void noteRollSeq(seat, 1, t0 + 2000, () => {
    reads++;
    return new Promise(() => {});
  });
  await noteRollSeq(seat, 1, t0 + 4000, async () => {
    reads++;
    return { rolls: [roll(1, t0 + 1000)], rollSeq: 1 };
  });
  assert.equal(reads, 1);
  // Ten seconds on, a new read goes ahead and throws the roll.
  await noteRollSeq(seat, 1, t0 + 13000, async () => {
    reads++;
    return { rolls: [roll(1, t0 + 1000)], rollSeq: 1 };
  });
  stop();
  assert.equal(reads, 2);
  assert.equal(seen.length, 1);
});

// The missed rolls of 2026-11-07 (dice-3d-table audit: the player's dice settled, the DM's never
// did). Each case below failed before the fix.
const tableRoll = (room: string, seq: number, at: number) => ({
  seq,
  roll: { ...base, id: `${room}:a:${seq}`, characterId: "a", character: "A", label: "Check", source: "server", at },
});

test("a full poll reply's roll number counts as much as an unchanged one's", () => {
  assert.equal(replyRollSeq({ unchanged: true, revision: 4, rollSeq: 7 }), 7);
  assert.equal(replyRollSeq({ code: "ROOM", revision: 5, table: {}, draft: "[]", rollSeq: 8 }), 8, "a full reply");
  assert.equal(replyRollSeq({ code: "ROOM", revision: 5, table: {}, draft: "[]" }), undefined, "players and older servers");
  for (const rollSeq of [-1, 1.5, "8", null]) assert.equal(replyRollSeq({ rollSeq }), undefined);
  assert.equal(replyRollSeq(undefined), undefined);
});

test("a roll made before the DM's screen first hears back is thrown, however late that answer", async () => {
  resetTableDice();
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  const seat = { code: "ROOM3", token: "t" };
  const t0 = 2_000_000;
  // The screen starts asking at t0; the room keeps answering in full (the DM's own writes, other
  // seats' actions) until t0 + 9 s, by when the player's roll (t0 + 1 s) is 8 s old.
  watchRoomRolls(seat.code, t0);
  await noteRollSeq(seat, 1, t0 + 9000, async () => ({ rolls: [tableRoll("ROOM3", 1, t0 + 1000)], rollSeq: 1, now: t0 + 9000 }));
  stop();
  assert.equal(seen.length, 1);
});

test("a DM's device clock running fast still shows players' rolls", async () => {
  resetTableDice();
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  const seat = { code: "ROOM4", token: "t" };
  const device = 5_000_000;
  const server = device - 60_000; // the device clock is a minute ahead of the server's
  await noteRollSeq(seat, 0, device, async () => ({ rolls: [], rollSeq: 0, now: server }));
  await noteRollSeq(seat, 1, device + 4000, async () => ({ rolls: [tableRoll("ROOM4", 1, server + 3000)], rollSeq: 1, now: server + 4000 }));
  stop();
  assert.equal(seen.length, 1);
});

test("a DM's device clock running slow never replays rolls made before the screen opened", async () => {
  resetTableDice();
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  const seat = { code: "ROOM5", token: "t" };
  const device = 5_000_000;
  const server = device + 60_000; // the device clock is a minute behind the server's
  // Opening the campaign: the last roll was made 30 s ago.
  await noteRollSeq(seat, 3, device, async () => ({ rolls: [tableRoll("ROOM5", 3, server - 30_000)], rollSeq: 3, now: server }));
  assert.equal(seen.length, 0, "an old roll is not replayed");
  // A roll made afterwards is thrown.
  await noteRollSeq(seat, 4, device + 2000, async () => ({ rolls: [tableRoll("ROOM5", 4, server + 1500)], rollSeq: 4, now: server + 2000 }));
  stop();
  assert.equal(seen.length, 1);
});

test("opening a campaign still throws a roll made just before, and only that once", async () => {
  resetTableDice();
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  const seat = { code: "ROOM6", token: "t" };
  const t0 = 7_000_000;
  let reads = 0;
  const read = async () => {
    reads++;
    return { rolls: [tableRoll("ROOM6", 2, t0 - 2000)], rollSeq: 2, now: t0 };
  };
  await noteRollSeq(seat, 2, t0, read);
  await noteRollSeq(seat, 2, t0 + 2000, read);
  stop();
  assert.equal(reads, 1, "the cursor moved past it");
  assert.equal(seen.length, 1);
});
