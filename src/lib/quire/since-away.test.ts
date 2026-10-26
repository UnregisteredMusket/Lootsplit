// "Since you were away" (plan P4, Q21): only the player's own characters, answers compared with
// the last visit, current chat and pool counts.
import assert from "node:assert/strict";
import test from "node:test";
import { awaySnapshot, sinceAway, type AwayTable } from "./since-away.ts";

const table = (over: Partial<NonNullable<AwayTable["journal"]>> = {}): AwayTable => ({
  holdings: [
    { id: "sword", name: "+1 Longsword", pool: { at: 1, source: "add-loot" } },
    { id: "potion", name: "Potion", pool: { at: 1, source: "add-loot" } },
    { id: "rope", name: "Rope" },
  ],
  journal: {
    requests: [
      { id: "r1", purseId: "mira", note: "New armour", status: "pending" },
      { id: "r2", purseId: "kael", note: "Kael's request", status: "pending" },
    ],
    lootClaims: { claims: [{ holdingId: "sword", purseId: "mira" }, { holdingId: "potion", purseId: "kael" }] },
    world: { journeys: [{ id: "j1", requestedBy: "mira", status: "proposed" }] },
    quests: { quests: [{ id: "q1", updatedAt: 100 }, { id: "q2", updatedAt: 500, archived: true }] },
    ...over,
  },
});

test("a first visit shows only current chat and pool claims", () => {
  assert.deepEqual(
    sinceAway(table(), ["mira"], null, 2).map((i) => i.text),
    ["2 unread messages", "1 item waiting for your claim"],
  );
  assert.deepEqual(sinceAway(table(), ["mira"], null, 0).map((i) => i.id), ["pool"]);
});

test("DM answers and quest updates since the last visit, for this player's characters only", () => {
  const before = awaySnapshot(table(), ["mira"], 50);
  assert.deepEqual(Object.keys(before.requests), ["r1"], "another player's request is not remembered");
  const after = table({
    requests: [
      { id: "r1", purseId: "mira", note: "New armour", status: "approved" },
      { id: "r2", purseId: "kael", note: "Kael's request", status: "denied" },
    ],
    world: { journeys: [{ id: "j1", requestedBy: "mira", status: "denied" }] },
  });
  assert.deepEqual(
    sinceAway(after, ["mira"], before, 0).map((i) => i.text),
    [
      "1 item waiting for your claim",
      "The DM approved your request: New armour",
      "The DM declined your journey",
      "1 quest updated",
    ],
  );
  // Nothing new: an answer already seen and an old quest stay quiet.
  const seen = awaySnapshot(after, ["mira"], 600);
  assert.deepEqual(sinceAway(after, ["mira"], seen, 0).map((i) => i.id), ["pool"]);
});

test("tables without a journal are quiet", () => {
  assert.deepEqual(sinceAway({ holdings: [], journal: null }, ["mira"], null, 0), []);
});
