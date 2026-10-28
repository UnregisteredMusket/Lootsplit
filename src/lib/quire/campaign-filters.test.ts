import assert from "node:assert/strict";
import test from "node:test";
import { filterStorageItem, readFilters, writeFilters } from "./campaign-filters.ts";

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const defaults = { holder: "", category: "", equipped: false };

test("Filters are remembered per campaign and list", () => {
  const store = memory();
  writeFilters("a", "inventory", { holder: "mira", category: "", equipped: true }, defaults, store);
  assert.deepEqual(readFilters("a", "inventory", defaults, store), { holder: "mira", category: "", equipped: true });
  assert.deepEqual(readFilters("b", "inventory", defaults, store), defaults);
  assert.deepEqual(readFilters("a", "review-inbox", { type: "all" }, store), { type: "all" });
  // Back to the defaults: nothing is stored.
  writeFilters("a", "inventory", defaults, defaults, store);
  assert.equal(store.data.has(filterStorageItem("a", "inventory")), false);
});

test("Broken, mistyped or blocked storage falls back to the defaults", () => {
  const store = memory();
  store.setItem(filterStorageItem("a", "inventory"), "{oops");
  assert.deepEqual(readFilters("a", "inventory", defaults, store), defaults);
  store.setItem(filterStorageItem("a", "inventory"), JSON.stringify({ holder: 5, equipped: true, extra: 1 }));
  assert.deepEqual(readFilters("a", "inventory", defaults, store), { holder: "", category: "", equipped: true });
  const blocked = {
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("blocked");
    },
    removeItem: () => {
      throw Error("blocked");
    },
  };
  assert.deepEqual(readFilters("a", "inventory", defaults, blocked), defaults);
  assert.doesNotThrow(() => writeFilters("a", "inventory", { ...defaults, holder: "x" }, defaults, blocked));
});
