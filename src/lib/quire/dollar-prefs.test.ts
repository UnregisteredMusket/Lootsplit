import assert from "node:assert/strict";
import test from "node:test";
import { dollarsChoiceFrom, dollarsShown, markDollarsChoice, modernDollarText } from "./dollar-prefs.ts";

test("a fresh device shows modern prices to DM seats only", () => {
  const fresh = { showDollars: true, dollarsChosen: dollarsChoiceFrom(null) };
  assert.equal(dollarsShown(fresh, "dm"), true);
  assert.equal(dollarsShown(fresh, "player"), false);
});

test("an existing stored choice is respected for both seats", () => {
  // Before this change only "off" could be a choice: the default was on.
  const off = { showDollars: false, dollarsChosen: dollarsChoiceFrom({ showDollars: false }) };
  assert.equal(dollarsShown(off, "dm"), false);
  assert.equal(dollarsShown(off, "player"), false);
  const oldDefault = { showDollars: true, dollarsChosen: dollarsChoiceFrom({ showDollars: true }) };
  assert.equal(dollarsShown(oldDefault, "dm"), true);
  assert.equal(dollarsShown(oldDefault, "player"), false);
  const chosenOn = { showDollars: true, dollarsChosen: dollarsChoiceFrom({ showDollars: true, dollarsChosen: true }) };
  assert.equal(dollarsShown(chosenOn, "player"), true);
});

test("setting Show dollars marks it as the device's choice; other patches do not", () => {
  assert.deepEqual(markDollarsChoice({ showDollars: true }), { showDollars: true, dollarsChosen: true });
  assert.deepEqual(markDollarsChoice({ appearance: "light" }), { appearance: "light" });
});

test("modern prices are labelled as an approximation", () => {
  assert.equal(modernDollarText("$12,500"), "≈ $12,500 modern");
});
