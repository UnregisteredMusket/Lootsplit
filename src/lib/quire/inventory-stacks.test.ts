// Party inventory display (design plan D3 / P6): stacking is display only, grouping order, bulk
// eligibility and resume never re-sends a holding that already moved.
import assert from "node:assert/strict";
import test from "node:test";
import {
  bulkRefusal,
  groupInventory,
  inventoryCategory,
  remainingBulkItems,
  stackHoldings,
  type BulkRun,
} from "./inventory-stacks.ts";
import type { Holding } from "./types.ts";

const h = (id: string, extra: Partial<Holding> = {}): Holding => ({
  id,
  purseId: "mira",
  name: "Potion of healing",
  kind: "item",
  quantity: 1,
  unitCopper: 5000,
  notes: "",
  category: "apothecary",
  ...extra,
});
const classify = (x: Holding) => inventoryCategory(x);

test("identical rows stack without changing the holdings", () => {
  const rows = [h("a"), h("b", { quantity: 2 }), h("c", { name: "Arrows", unitCopper: 5, quantity: 40 })];
  const before = JSON.stringify(rows);
  const stacks = stackHoldings(rows, classify);
  assert.equal(stacks.length, 2);
  const potions = stacks.find((s) => s.holdings[0]!.name === "Potion of healing")!;
  assert.equal(potions.quantity, 3);
  assert.equal(potions.copper, 15000);
  assert.deepEqual(potions.holdings.map((x) => x.id), ["a", "b"]);
  assert.equal(JSON.stringify(rows), before);
});

test("rows differing in holder, value, category or state stay apart", () => {
  const rows = [
    h("a"),
    h("b", { purseId: "bram" }),
    h("c", { unitCopper: 4000 }),
    h("d", { category: "curios" }),
    h("e", { equipped: true }),
    h("f", { pool: { at: 1, source: "dm" } }),
    h("g", { name: "potion of healing " }),
  ];
  const stacks = stackHoldings(rows, classify);
  assert.equal(stacks.length, 6);
  assert.deepEqual(stacks[0]!.holdings.map((x) => x.id), ["a", "g"]);
});

test("groups by holder in purse order, or by category alphabetically", () => {
  const purses = [
    { id: "party", name: "Party fund" },
    { id: "mira", name: "Mira Ashfall" },
  ];
  const rows = [h("a"), h("b", { purseId: "party", name: "Tent", category: "general", unitCopper: 200 })];
  assert.deepEqual(
    groupInventory(rows, purses, "holder", classify).map((g) => g.label),
    ["Party fund", "Mira Ashfall"],
  );
  assert.deepEqual(
    groupInventory(rows, purses, "category", classify).map((g) => g.label),
    ["apothecary", "general"],
  );
  assert.equal(groupInventory([h("z", { purseId: "gone" })], purses, "holder", classify)[0]!.label, "Unassigned");
});

test("bulk eligibility mirrors the command rules", () => {
  const funds = new Set(["party"]);
  assert.equal(bulkRefusal("pool", h("a"), { partyFundIds: funds }), "not held by a party fund");
  assert.equal(bulkRefusal("pool", h("a", { purseId: "party" }), { partyFundIds: funds }), null);
  assert.equal(bulkRefusal("pool", h("a", { purseId: "party", equipped: true }), { partyFundIds: funds }), "equipped");
  assert.equal(bulkRefusal("give", h("a", { pool: { at: 1, source: "dm" } }), { partyFundIds: funds }), "in the treasure pool");
  assert.equal(bulkRefusal("give", h("a"), { partyFundIds: funds, toId: "mira" }), "already held by the recipient");
  assert.equal(bulkRefusal("remove", h("a", { reservedFor: "x" }), { partyFundIds: funds }), "stored or reserved at a property");
});

test("a resumed run skips holdings that already moved, were removed or pooled", () => {
  const run: BulkRun = {
    id: "run",
    action: "give",
    toId: "bram",
    items: [
      { holdingId: "a", purseId: "mira", commandId: "c1", done: true },
      { holdingId: "b", purseId: "mira", commandId: "c2" },
      { holdingId: "c", purseId: "mira", commandId: "c3" },
      { holdingId: "d", purseId: "mira", commandId: "c4" },
    ],
  };
  // b landed but the reply was lost (now Bram's); c is gone; d is still Mira's.
  const left = remainingBulkItems(run, [h("a", { purseId: "bram" }), h("b", { purseId: "bram" }), h("d")]);
  assert.deepEqual(left.map((x) => [x.holdingId, x.commandId]), [["d", "c4"]]);
  const pool: BulkRun = { ...run, action: "pool", items: [{ holdingId: "a", purseId: "party", commandId: "p1" }, { holdingId: "b", purseId: "party", commandId: "p2" }] };
  assert.deepEqual(
    remainingBulkItems(pool, [h("a", { purseId: "party", pool: { at: 1, source: "dm" } }), h("b", { purseId: "party" })]).map((x) => x.holdingId),
    ["b"],
  );
});
