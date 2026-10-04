import test from "node:test";
import assert from "node:assert/strict";
import { rollLootTable } from "../src/lib/encounters/roll-table.mjs";
const table = { id: "loot", name: "Treasure", entries: [
  { weight: 2, loot: { name: "Potion" } }, { weight: 3, loot: { name: "Sword" } },
] };
test("physical weighted draws preserve totals and never generate dice", (t) => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("Must not roll"); });
  for (const [total, selected] of [[1,0], [2,0], [3,1], [5,1]]) {
    const r = rollLootTable(table, true, total, "server");
    assert.equal(r.total, total); assert.equal(r.selected, selected);
    assert.equal(r.source, "manual"); assert.deepEqual(r.dice, []);
  }
  for (const total of [null, undefined, "2", 0, 6, 1.5, NaN])
    assert.throws(() => rollLootTable(table, true, total, "app"), /whole-number/);
});
test("virtual weighted draws retain secure generation and source labels", (t) => {
  const random = t.mock.method(globalThis.crypto, "getRandomValues", (bytes) => { bytes[0] = 4; return bytes; });
  const r = rollLootTable(table, false, 1, "server");
  assert.equal(random.mock.callCount(), 1);
  assert.equal(r.source, "server"); assert.equal(r.total, 5);
  assert.deepEqual(r.dice, [5]); assert.equal(r.resultName, "Sword");
});
