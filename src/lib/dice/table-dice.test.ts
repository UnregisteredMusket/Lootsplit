import assert from "node:assert/strict";
import test from "node:test";
import { diceForDisplay, onDice, showDice } from "./dice-events.ts";
import { displayShowsRoll } from "./display-dice.ts";
import { noteRollSeq, resetTableDice } from "./table-dice.ts";

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
