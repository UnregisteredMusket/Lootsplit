import assert from "node:assert/strict";
import test from "node:test";
import { diceForDisplay, onDice, showDice } from "./dice-events.ts";
import { displayShowsRoll } from "./display-dice.ts";
import { noteRollSeq, resetTableDice } from "./table-dice.ts";

const base = { formula: "1d20+2", dice: [11], mode: "normal", modifier: 2, total: 13 };

test("a roll with an id is thrown once per page", () => {
  const seen: unknown[] = [];
  const stop = onDice((r) => seen.push(r));
  showDice({ ...base, id: "room:a:once-1" });
  showDice({ ...base, id: "room:a:once-1" });
  showDice({ ...base });
  showDice({ ...base });
  stop();
  assert.equal(seen.length, 3);
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
  ];
  const journal = {
    world: {
      npcs: [],
      characterPositions: [
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
