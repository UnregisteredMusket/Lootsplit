import assert from "node:assert/strict";
import test from "node:test";
import {
  assignLoot,
  gpInputText,
  lootReviewEncounters,
  lootValueCopper,
  parseGpValue,
  readLastCoinRecipient,
  recipientSummary,
  rememberCoinRecipient,
  soleOpenEncounter,
  sortForReview,
  valueEcho,
} from "./loot-review.ts";

const row = (id: string, status: string, code = "ROOM") => ({ id, code, name: id, status });

test("the Desk counts every loot review in this campaign, zero or many", () => {
  assert.deepEqual(lootReviewEncounters([], "ROOM"), []);
  const rows = [row("a", "review"), row("b", "draft"), row("c", "review"), row("d", "review", "OTHER"), row("e", "awarded")];
  assert.deepEqual(lootReviewEncounters(rows, "ROOM").map((r) => r.id), ["a", "c"]);
  assert.deepEqual(lootReviewEncounters(rows, "device"), []);
});

test("Encounters opens directly only with exactly one active or reviewable encounter", () => {
  assert.equal(soleOpenEncounter([], "ROOM"), null);
  assert.equal(soleOpenEncounter([row("a", "draft"), row("b", "awarded")], "ROOM"), null);
  assert.equal(soleOpenEncounter([row("a", "draft"), row("b", "review")], "ROOM")?.id, "b");
  assert.equal(soleOpenEncounter([row("a", "active"), row("b", "draft")], "ROOM")?.id, "a");
  assert.equal(soleOpenEncounter([row("a", "active"), row("b", "review")], "ROOM"), null);
  assert.equal(soleOpenEncounter([row("a", "review", "OTHER")], "ROOM"), null);
});

test("the list puts loot reviews first, then active battles, keeping saved order", () => {
  const rows = [row("d1", "draft"), row("a1", "active"), row("r1", "review"), row("x", "awarded"), row("r2", "review")];
  assert.deepEqual(sortForReview(rows).map((r) => r.id), ["r1", "r2", "a1", "d1", "x"]);
});

test("gold values become whole copper, and nothing else is accepted", () => {
  assert.equal(parseGpValue("250"), 25000);
  assert.equal(parseGpValue("2.5"), 250);
  assert.equal(parseGpValue("2.05"), 205);
  assert.equal(parseGpValue("0.01"), 1);
  assert.equal(parseGpValue("1,250"), 125000);
  assert.equal(parseGpValue("2 gp 5 sp"), 250);
  assert.equal(parseGpValue("75 cp"), 75);
  assert.equal(parseGpValue("0"), 0);
  for (const bad of ["", "  ", "2.005", "-3", "abc", "1.2.3", "10001", "1e3"]) assert.equal(parseGpValue(bad), null, bad);
  assert.equal(parseGpValue("10000"), 1_000_000);
  for (const copper of [0, 1, 5, 99, 100, 205, 25000, 1_000_000]) assert.equal(parseGpValue(gpInputText(copper)), copper);
  assert.equal(gpInputText(25000), "250");
  assert.equal(gpInputText(205), "2.05");
});

test("the live echo reads in coins", () => {
  assert.equal(valueEcho(25000, 1), "= 250 gp");
  assert.equal(valueEcho(250, 3), "= 2 gp, 5 sp each · 7 gp, 5 sp");
});

test("bulk assignment uses the per-row recipient and treasure-pool semantics", () => {
  const loot = [
    { id: "a", quantity: 1, unitCopper: 100, purseId: "", pool: true },
    { id: "b", quantity: 2, unitCopper: 50, purseId: "hero" },
    { id: "c", quantity: 1, unitCopper: 7, purseId: "" },
  ];
  const assigned = assignLoot(loot, new Set(["a", "c"]), { purseId: "party" });
  assert.deepEqual(assigned, [
    { id: "a", quantity: 1, unitCopper: 100, purseId: "party" },
    loot[1],
    { id: "c", quantity: 1, unitCopper: 7, purseId: "party" },
  ]);
  assert.equal("pool" in assigned[0]!, false);
  const pooled = assignLoot(loot, new Set(["b"]), { pool: true });
  assert.deepEqual(pooled[1], { id: "b", quantity: 2, unitCopper: 50, purseId: "", pool: true });
  assert.equal(pooled[0], loot[0]);
  assert.deepEqual(assignLoot(loot, new Set(), { pool: true }), loot);
  assert.equal(lootValueCopper(loot), 207);
});

test("the footer summary names recipients, the pool and what is left", () => {
  assert.equal(recipientSummary({ recipients: [], unresolved: [], unresolvedCoins: false }), "Nothing to transfer");
  assert.equal(
    recipientSummary({ recipients: [{ name: "Aria" }, { name: "Bram" }], pool: { items: [1, 2] }, unresolved: [1], unresolvedCoins: true }),
    "Aria, Bram · 2 to the treasure pool · 1 unassigned · coins unassigned",
  );
  assert.equal(
    recipientSummary({ recipients: ["A", "B", "C", "D"].map((name) => ({ name })), unresolved: [], unresolvedCoins: false }),
    "A, B and 2 more",
  );
});

test("the remembered coin recipient survives blocked storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    });
    assert.equal(readLastCoinRecipient("ROOM"), "");
    rememberCoinRecipient("ROOM", "aria");
    rememberCoinRecipient("ROOM", "");
    assert.equal(readLastCoinRecipient("ROOM"), "aria");
    assert.equal(readLastCoinRecipient("device:other"), "");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    assert.equal(readLastCoinRecipient("ROOM"), "");
    assert.doesNotThrow(() => rememberCoinRecipient("ROOM", "bram"));
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
