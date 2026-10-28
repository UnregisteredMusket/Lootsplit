import assert from "node:assert/strict";
import test from "node:test";
import { headerHiddenAfterScroll } from "./landscape.ts";

test("The landscape header hides scrolling down, returns scrolling up and near the top", () => {
  const at = (hidden: boolean, lastY: number) => ({ hidden, lastY, header: 60 });
  assert.equal(headerHiddenAfterScroll(at(false, 100), 200), true);
  assert.equal(headerHiddenAfterScroll(at(true, 400), 300), false);
  // Jitter within 8 px keeps the current state.
  assert.equal(headerHiddenAfterScroll(at(true, 400), 395), true);
  assert.equal(headerHiddenAfterScroll(at(false, 400), 405), false);
  // Within the header's own height it always shows.
  assert.equal(headerHiddenAfterScroll(at(true, 300), 40), false);
});
