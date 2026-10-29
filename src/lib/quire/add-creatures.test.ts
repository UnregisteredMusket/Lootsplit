// Privacy review 2026-10-29 (finding B10): Add creatures here never duplicates combatants on retry.
import assert from "node:assert/strict";
import test from "node:test";
import { attemptKey, creatureAttempt, withCombatants } from "./add-creatures.ts";

test("a retried Add creatures reuses its IDs and adds each combatant once", () => {
  let n = 0;
  const id = () => `id-${++n}`;
  const picks = [{ key: "goblin", count: 2 }, { key: "ogre", count: 1 }];
  const first = creatureAttempt(null, picks, "new", id);
  assert.equal(first.combatantIds.length, 3);
  assert.equal(first.tokenIds.length, 3);
  // The same picks and encounter: the same attempt (a retry after a lost response).
  assert.equal(creatureAttempt(first, picks, "new", id), first);
  // Different picks or another encounter: a new attempt.
  assert.notEqual(creatureAttempt(first, [{ key: "goblin", count: 3 }], "new", id).key, first.key);
  assert.equal(creatureAttempt(first, picks, "enc-1", id).encounterId, "enc-1");
  // After the new encounter was created, the retry names it and keeps the same IDs.
  const created = { ...first, key: attemptKey(picks, first.encounterId) };
  assert.equal(creatureAttempt(created, picks, first.encounterId, id), created);
  // The save was applied before the response was lost: the retry adds nothing.
  const joining = first.combatantIds.map((cid) => ({ id: cid, name: cid }));
  const once = withCombatants([{ id: "pc", name: "Mira" }], joining);
  assert.equal(once.added, 3);
  const again = withCombatants(once.combatants, joining);
  assert.equal(again.added, 0);
  assert.equal(again.combatants.length, 4);
});
