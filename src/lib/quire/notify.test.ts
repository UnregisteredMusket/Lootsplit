import assert from "node:assert/strict";
import test from "node:test";
import { noteIsForSeat } from "./notify.ts";

const note = (from: "dm" | "player", to: "dm" | "party", purseId: string) => ({ id: "1", from, to, purseId, text: "Hello" });

test("the dungeon master is told about player messages only", () => {
  const seat = { role: "dm" as const, purseIds: [] };
  assert.equal(noteIsForSeat(note("player", "dm", "ivo"), seat), true);
  assert.equal(noteIsForSeat(note("player", "party", "ivo"), seat), true);
  assert.equal(noteIsForSeat(note("dm", "party", "ivo"), seat), false);
});

test("a player hears the dungeon master and the rest of the party", () => {
  const seat = { role: "player" as const, purseIds: ["ivo"] };
  assert.equal(noteIsForSeat(note("dm", "party", ""), seat), true);
  assert.equal(noteIsForSeat(note("dm", "dm", "ivo"), seat), true);
  assert.equal(noteIsForSeat(note("dm", "dm", "sera"), seat), false);
  assert.equal(noteIsForSeat(note("player", "party", "sera"), seat), true);
  assert.equal(noteIsForSeat(note("player", "party", "ivo"), seat), false);
  assert.equal(noteIsForSeat(note("player", "dm", "ivo"), seat), false);
});
