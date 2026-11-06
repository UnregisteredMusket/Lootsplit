import test from "node:test";
import assert from "node:assert/strict";
import { throwDice } from "../characters/model.mjs";
import {
  ANIMATED_SIDES,
  diceCaption,
  diceThrow,
  percentileFaces,
  percentileValue,
  shownValues,
} from "./three-d-dice.ts";

test("every standard die is thrown as itself, forced to the recorded values", () => {
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    const t = diceThrow({ formula: `3d${sides}+2`, dice: [1, sides, 2], mode: "normal", modifier: 2, total: sides + 5 })!;
    assert.equal(t.notation, `3d${sides}@1,${sides},2`);
    assert.deepEqual(t.thrown.map((d) => d.type), Array(3).fill(`d${sides}`));
    assert.ok(t.results.every((r) => r.kept));
  }
});

test("a d100 is a tens die and a units die that read back to the same value", () => {
  assert.deepEqual(percentileFaces(57), { tens: 50, units: 7 });
  assert.deepEqual(percentileFaces(100), { tens: 100, units: 10 }); // 00 and 0
  assert.deepEqual(percentileFaces(7), { tens: 100, units: 7 }); // 00 and 7
  assert.deepEqual(percentileFaces(10), { tens: 10, units: 10 }); // 10 and 0
  for (let v = 1; v <= 100; v++) {
    const f = percentileFaces(v);
    assert.equal(percentileValue(f.tens, f.units), v, `value ${v}`);
  }
  const t = diceThrow({ formula: "2d100", dice: [57, 100], mode: "normal", modifier: 0, total: 157 })!;
  assert.equal(t.notation, "2d100+2d10@50,100,7,10");
  assert.deepEqual(shownValues(t, t.thrown.map((d) => d.face)), [57, 100]);
});

test("advantage and disadvantage throw two d20s and keep the right one", () => {
  const adv = diceThrow({ formula: "1d20+5", dice: [4, 17], mode: "advantage", modifier: 5, total: 22 })!;
  assert.equal(adv.notation, "2d20@4,17");
  assert.deepEqual(adv.results.map((r) => r.kept), [false, true]);
  const dis = diceThrow({ formula: "1d20+5", dice: [4, 17], mode: "disadvantage", modifier: 5, total: 9 })!;
  assert.deepEqual(dis.results.map((r) => r.kept), [true, false]);
  const tie = diceThrow({ formula: "1d20", dice: [12, 12], mode: "advantage", modifier: 0, total: 12 })!;
  assert.equal(tie.results.filter((r) => r.kept).length, 1);
  assert.match(diceCaption({ formula: "1d20+5", dice: [4, 17], mode: "advantage", modifier: 5, total: 22, label: "Stealth" }, adv), /^Stealth: 22 \(\(4\) \+ 17 \+ 5 · advantage\)$/);
});

test("what is not animated: manual totals, fixed numbers, odd dice, too many dice, bad values", () => {
  assert.equal(diceThrow({ formula: "1d20", dice: [], mode: "manual", modifier: 0, total: 14, source: "manual" }), null);
  assert.equal(diceThrow({ formula: "1", dice: [], mode: "normal", modifier: 1, total: 1 }), null);
  assert.equal(diceThrow({ formula: "1d3", dice: [2], mode: "normal", modifier: 0, total: 2 }), null);
  assert.equal(diceThrow({ formula: "1d2", dice: [2], mode: "normal", modifier: 0, total: 2 }), null);
  assert.equal(diceThrow({ formula: "21d6", dice: Array(21).fill(3), mode: "normal", modifier: 0, total: 63 }), null);
  assert.equal(diceThrow({ formula: "1d6", dice: [7], mode: "normal", modifier: 0, total: 7 }), null);
  assert.equal(diceThrow({ formula: "not dice", dice: [3], mode: "normal", modifier: 0, total: 3 }), null);
});

test("every real roll of an animated size maps to a throw that shows exactly its dice", () => {
  for (const sides of ANIMATED_SIDES)
    for (let i = 0; i < 200; i++) {
      const mode = sides === 20 ? (["normal", "advantage", "disadvantage"] as const)[i % 3] : "normal";
      const formula = mode === "normal" ? `${1 + (i % 8)}d${sides}${i % 2 ? "+3" : "-1"}` : "1d20+4";
      const roll = throwDice(formula, mode);
      const t = diceThrow({ formula, ...roll })!;
      assert.ok(t, formula);
      assert.deepEqual(shownValues(t, t.thrown.map((d) => d.face)), roll.dice);
      const kept = t.results.filter((r) => r.kept).map((r) => r.value);
      assert.equal(kept.reduce((a, b) => a + b, 0) + roll.modifier, roll.total);
    }
});

test("treasure pool d100s: separate dice where the highest wins", () => {
  const roll = { formula: "3d100", dice: [42, 97, 5], mode: "highest", modifier: 0, total: 97, label: "Ruby: highest d100" };
  const t = diceThrow(roll)!;
  assert.equal(t.notation, "3d100+3d10@40,90,100,2,7,5");
  assert.deepEqual(t.results.map((r) => r.kept), [false, true, false]);
  assert.equal(diceCaption(roll, t), "Ruby: highest d100: 97 ((42), 97, (5) · highest wins)");
  // A total that is not the highest die is not thrown.
  assert.equal(diceThrow({ ...roll, total: 144 }), null);
});
