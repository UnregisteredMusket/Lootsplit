import test from "node:test";
import assert from "node:assert/strict";
import { barterRollsToThrow } from "./npc-barter-dice.ts";

const roll = { dice: [12], kept: 12, total: 14, source: "server" };

test("checks rolled before the screen loaded are never replayed", () => {
  const requested = new Set<string>();
  const first = barterRollsToThrow([{ id: "old", roll }, { id: "queued" }], null, requested);
  assert.deepEqual(first.throwNow, []);
  assert.deepEqual([...first.known], ["old"]);
  // The same list again (a re-render or poll) throws nothing.
  assert.deepEqual(barterRollsToThrow([{ id: "old", roll }, { id: "queued" }], first.known, requested).throwNow, []);
});

test("a check the server rolls for a player's offer while the DM watches is thrown once", () => {
  const requested = new Set<string>();
  const { known } = barterRollsToThrow([{ id: "old", roll }], null, requested);
  const next = barterRollsToThrow([{ id: "old", roll }, { id: "auto", roll }], known, requested);
  assert.deepEqual(next.throwNow.map((a) => a.id), ["auto"]);
  assert.deepEqual(barterRollsToThrow([{ id: "old", roll }, { id: "auto", roll }], next.known, requested).throwNow, []);
});

test("a roll the DM asks for is thrown when it arrives, even for a check seen earlier", () => {
  const requested = new Set<string>();
  const { known } = barterRollsToThrow([{ id: "queued" }, { id: "old", roll }], null, requested);
  requested.add("queued");
  // Not rolled yet: nothing thrown, the request waits.
  assert.deepEqual(barterRollsToThrow([{ id: "queued" }], known, requested).throwNow, []);
  assert.ok(requested.has("queued"));
  const rolled = barterRollsToThrow([{ id: "queued", roll }, { id: "old", roll }], known, requested);
  assert.deepEqual(rolled.throwNow.map((a) => a.id), ["queued"]);
  assert.equal(requested.size, 0);
  // A DM re-roll of a check already in the baseline is still thrown.
  requested.add("old");
  assert.deepEqual(barterRollsToThrow([{ id: "old", roll }], rolled.known, requested).throwNow.map((a) => a.id), ["old"]);
});
