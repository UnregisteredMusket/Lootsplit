import assert from "node:assert/strict";
import test from "node:test";
import { copperEcho } from "./copper-echo.ts";

test("the copper echo shows grouped gold for whole copper and nothing for partial text", () => {
  assert.equal(copperEcho("25000"), "= 250 gp");
  assert.equal(copperEcho(150), "= 1 gp, 5 sp");
  assert.equal(copperEcho(7), "= 7 cp");
  assert.equal(copperEcho(1572700), "= 15,727 gp");
  for (const partial of ["", " ", "0", "-", "1.5", "abc", "1e3", "NaN"])
    assert.equal(copperEcho(partial), "");
  assert.equal(copperEcho(Number.NaN), "");
});
