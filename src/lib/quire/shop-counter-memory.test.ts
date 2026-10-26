import assert from "node:assert/strict";
import test from "node:test";
import {
  initialPayer,
  readDeviceFlag,
  rememberPayer,
  rememberedPayer,
  writeDeviceFlag,
} from "./shop-counter-memory.ts";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

test("the last payer is remembered per shop and per campaign", () => {
  const s = memory();
  rememberPayer("main", "lantern", "mira", s);
  rememberPayer("other", "lantern", "bram", s);
  rememberPayer("main", "forge", "party", s);
  assert.equal(rememberedPayer("main", "lantern", s), "mira");
  assert.equal(rememberedPayer("other", "lantern", s), "bram");
  assert.equal(rememberedPayer("main", "forge", s), "party");
  assert.equal(rememberedPayer("main", "unknown", s), "");
});

test("a remembered purse the seat can no longer spend falls back to the party, then the first", () => {
  const purses = [
    { id: "mira", kind: "character" },
    { id: "party", kind: "party" },
  ];
  assert.equal(initialPayer(purses, "mira"), "mira");
  assert.equal(initialPayer(purses, "gone"), "party");
  assert.equal(initialPayer([{ id: "mira", kind: "character" }], "gone"), "mira");
  assert.equal(initialPayer([], "gone"), "");
});

test("blocked or corrupt storage never throws", () => {
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(rememberedPayer("main", "lantern", throwing), "");
  rememberPayer("main", "lantern", "mira", throwing);
  assert.equal(readDeviceFlag("x", true, throwing), true);
  writeDeviceFlag("x", false, throwing);
  const corrupt = memory();
  corrupt.setItem("lootsplit.shop-payer.v1", "[not json");
  assert.equal(rememberedPayer("main", "lantern", corrupt), "");
  assert.equal(rememberedPayer("main", "lantern", null), "");
});

test("device flags round-trip and default when unset", () => {
  const s = memory();
  assert.equal(readDeviceFlag("open", false, s), false);
  writeDeviceFlag("open", true, s);
  assert.equal(readDeviceFlag("open", false, s), true);
  writeDeviceFlag("open", false, s);
  assert.equal(readDeviceFlag("open", true, s), false);
});

test("the payer map stays bounded, forgetting the oldest shops first", () => {
  const s = memory();
  for (let i = 0; i < 210; i++) rememberPayer("main", `shop-${i}`, "mira", s);
  assert.equal(rememberedPayer("main", "shop-0", s), "");
  assert.equal(rememberedPayer("main", "shop-209", s), "mira");
  assert.equal(Object.keys(JSON.parse(s.data.get("lootsplit.shop-payer.v1")!)).length, 200);
});
