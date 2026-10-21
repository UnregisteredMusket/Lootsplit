import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberDraft } from "./number-draft.ts";

test("partial numeric input is kept as text instead of snapping to 0", () => {
  assert.equal(parseNumberDraft(""), null);
  assert.equal(parseNumberDraft("  "), null);
  assert.equal(parseNumberDraft("-"), null);
  assert.equal(parseNumberDraft("abc"), null);
  assert.equal(parseNumberDraft("-3"), -3);
  assert.equal(parseNumberDraft("0"), 0);
  assert.equal(parseNumberDraft("12"), 12);
  assert.equal(parseNumberDraft("1.5"), 1.5);
});
