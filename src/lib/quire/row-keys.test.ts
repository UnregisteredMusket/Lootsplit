import assert from "node:assert/strict";
import test from "node:test";
import { removeRowKey, syncRowKeys } from "./row-keys.ts";

test("row keys stay with their rows when an earlier row is removed", () => {
  let n = 0;
  const make = () => `k${++n}`;
  const keys = syncRowKeys([], 3, make);
  assert.deepEqual(keys, ["k1", "k2", "k3"]);
  removeRowKey(keys, 0);
  assert.deepEqual(syncRowKeys(keys, 2, make), ["k2", "k3"]);
  assert.deepEqual(syncRowKeys(keys, 3, make), ["k2", "k3", "k4"]);
  assert.deepEqual(syncRowKeys(keys, 1, make), ["k2"]);
  removeRowKey(keys, 5);
  assert.deepEqual(keys, ["k2"]);
});
