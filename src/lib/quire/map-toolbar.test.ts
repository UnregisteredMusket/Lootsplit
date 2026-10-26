import assert from "node:assert/strict";
import test from "node:test";
import { mapLayout, nextRovingIndex, readToolNames, toolNamesVisible } from "./map-toolbar.ts";

test("map layout: rails on desktop and landscape phones, the bottom bar on phones", () => {
  assert.equal(mapLayout(1280, 800), "desktop");
  assert.equal(mapLayout(1440, 900), "desktop");
  assert.equal(mapLayout(1280, 680), "short");
  assert.equal(mapLayout(390, 844), "phone");
  assert.equal(mapLayout(320, 640), "phone");
  assert.equal(mapLayout(844, 390), "landscape");
  assert.equal(mapLayout(651, 900), "desktop");
});

test("roving focus moves along the toolbar's own axis and wraps", () => {
  assert.equal(nextRovingIndex(5, 0, "ArrowDown", "vertical"), 1);
  assert.equal(nextRovingIndex(5, 0, "ArrowUp", "vertical"), 4);
  assert.equal(nextRovingIndex(5, 4, "ArrowDown", "vertical"), 0);
  assert.equal(nextRovingIndex(5, 2, "ArrowRight", "vertical"), undefined);
  assert.equal(nextRovingIndex(5, 2, "ArrowRight", "horizontal"), 3);
  assert.equal(nextRovingIndex(5, 2, "ArrowLeft", "horizontal"), 1);
  assert.equal(nextRovingIndex(5, 2, "Home", "horizontal"), 0);
  assert.equal(nextRovingIndex(5, 2, "End", "vertical"), 4);
  assert.equal(nextRovingIndex(0, 0, "End", "vertical"), undefined);
  assert.equal(nextRovingIndex(3, 1, "Enter", "vertical"), undefined);
});

test("tool names show at first use until dismissed; unknown values are first use", () => {
  assert.equal(readToolNames(null), "first-use");
  assert.equal(readToolNames("garbage"), "first-use");
  assert.equal(readToolNames("hidden"), "hidden");
  assert.equal(readToolNames("shown"), "shown");
  assert.equal(toolNamesVisible("first-use"), true);
  assert.equal(toolNamesVisible("hidden"), false);
});
