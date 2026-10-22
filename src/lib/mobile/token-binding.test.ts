import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_TOKEN, ACCOUNT_TOKEN_INSTALL, applyTokenBinding } from "./token-binding.ts";

function store(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

test("a token restored onto another installation is dropped; campaign data stays", () => {
  const storage = store({ [ACCOUNT_TOKEN]: "restored", [ACCOUNT_TOKEN_INSTALL]: "old-install", "quire.campaigns": "[1]" });
  assert.equal(applyTokenBinding(storage, "new-install"), true);
  assert.equal(storage.map.has(ACCOUNT_TOKEN), false);
  assert.equal(storage.map.get(ACCOUNT_TOKEN_INSTALL), "new-install");
  assert.equal(storage.map.get("quire.campaigns"), "[1]");
});

test("the same installation keeps its token", () => {
  const storage = store({ [ACCOUNT_TOKEN]: "mine", [ACCOUNT_TOKEN_INSTALL]: "this-install" });
  assert.equal(applyTokenBinding(storage, "this-install"), false);
  assert.equal(storage.map.get(ACCOUNT_TOKEN), "mine");
});

test("data from before the binding existed is adopted, not signed out", () => {
  const storage = store({ [ACCOUNT_TOKEN]: "upgraded" });
  assert.equal(applyTokenBinding(storage, "this-install"), false);
  assert.equal(storage.map.get(ACCOUNT_TOKEN), "upgraded");
  assert.equal(storage.map.get(ACCOUNT_TOKEN_INSTALL), "this-install");
});

test("an unknown install id never signs out", () => {
  const storage = store({ [ACCOUNT_TOKEN]: "kept", [ACCOUNT_TOKEN_INSTALL]: "old-install" });
  assert.equal(applyTokenBinding(storage, ""), false);
  assert.equal(storage.map.get(ACCOUNT_TOKEN), "kept");
  assert.equal(storage.map.get(ACCOUNT_TOKEN_INSTALL), "old-install");
});
