import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { applyCloudTable, blankPurse, economySnapshot, saveCampaignCharacter } from "./economy.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { emptyCloudTable } from "./cloud.ts";
import { captureDeviceMutationScope, assertDeviceMutationScope } from "./mutation-scope.ts";

test("an account/campaign switch during sheet reads aborts before writes and preserves both campaigns", async () => {
  const prior = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const local = new Map<string, string>([
    ["quire.campaign.v1", "first"],
    [
      "quire.campaigns.v1",
      JSON.stringify([
        { id: "first", db: "quire-sheet-first" },
        { id: "second", db: "quire-sheet-second" },
      ]),
    ],
  ]);
  const ticket = new Map<string, string>([["lootsplit.verified-account", "owner"]]);
  const storage = {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
  };
  const win = Object.assign(new EventTarget(), { localStorage: storage });
  Object.assign(globalThis, {
    window: win,
    localStorage: storage,
    sessionStorage: { getItem: (key: string) => ticket.get(key) ?? null },
  });
  const getAll = IDBObjectStore.prototype.getAll;
  try {
    const first = {
      ...emptyCloudTable(),
      purses: [{ ...blankPurse("character"), id: "same-id", name: "First character" }],
    };
    const second = {
      ...emptyCloudTable(),
      purses: [
        {
          ...blankPurse("character"),
          id: "same-id",
          name: "Second character",
          coins: { cp: 0, sp: 0, ep: 0, gp: 31, pp: 0 },
        },
      ],
    };
    await applyCloudTable(first);
    local.set("quire.campaign.v1", "second");
    await applyCloudTable(second);
    const newTarget = await economySnapshot();
    local.set("quire.campaign.v1", "first");
    const original = await economySnapshot();
    const scope = captureDeviceMutationScope(),
      before = characterSheet(original.purses[0], original.holdings);
    let switched = false,
      checked = false;
    IDBObjectStore.prototype.getAll = function (...args: Parameters<typeof getAll>) {
      const read = getAll.apply(this, args);
      if (!switched && this.name === "holdings")
        read.addEventListener(
          "success",
          () => {
            switched = true;
            local.set("quire.campaign.v1", "second");
            ticket.set("lootsplit.verified-account", "another-owner");
          },
          { once: true },
        );
      return read;
    };
    await assert.rejects(
      saveCampaignCharacter({ purseId: "same-id", before, sheet: { ...before, hp: 1 } }, () => {
        checked = true;
        assertDeviceMutationScope(scope);
      }),
      /campaign or account changed/,
    );
    assert.equal(switched, true, "Switch occurs inside an actual asynchronous database read");
    assert.equal(checked, true, "Scope is checked inside the atomic save after its source reads");
    IDBObjectStore.prototype.getAll = getAll;
    assert.deepEqual(await economySnapshot(), newTarget);
    local.set("quire.campaign.v1", "first");
    ticket.set("lootsplit.verified-account", "owner");
    assert.deepEqual(await economySnapshot(), original);
  } finally {
    IDBObjectStore.prototype.getAll = getAll;
    Object.assign(globalThis, prior);
  }
});
