import test from "node:test";
import assert from "node:assert/strict";
import { blankSheet } from "../characters/model.mjs";
import { compareImportedSheet } from "./sheet-import-comparison.ts";
test("import comparison identifies changed stats and preserves financial exclusions", () => {
  const current = blankSheet(),
    incoming = structuredClone(current);
  incoming.scores.str = 18;
  incoming.coins.gp = 900;
  incoming.equipment = [
    { name: "Private sword", quantity: 1, notes: "", weight: 1, equipped: false },
  ];
  const changes = compareImportedSheet(current, incoming).flatMap((g) => g.changes);
  assert.deepEqual(changes, [{ field: "Scores: STR", before: "10", after: "18" }]);
  assert.equal(current.coins.gp, 0);
});
test("uniquely named attacks compare by name and retain order changes", () => {
  const current = blankSheet();
  current.attacks = [
    { name: "Sword", bonus: 2, damage: "1d6", notes: "" },
    { name: "Bow", bonus: 3, damage: "1d8", notes: "" },
  ];
  const incoming = structuredClone(current);
  incoming.attacks.reverse();
  incoming.attacks[0].bonus = 4;
  const rows = compareImportedSheet(current, incoming).flatMap((g) => g.changes);
  assert.equal(rows.length, 2);
  assert.match(rows[0].field, /Bow/);
  assert.match(rows[1].field, /order/);
  const ambiguous = structuredClone(current);
  ambiguous.attacks[1].name = "Sword";
  assert.equal(
    compareImportedSheet(current, ambiguous).flatMap((g) => g.changes)[0].field,
    "Attacks",
  );
});
