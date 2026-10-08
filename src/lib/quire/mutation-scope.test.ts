import test from "node:test";
import assert from "node:assert/strict";
import { captureDeviceMutationScope, assertDeviceMutationScope } from "./mutation-scope.ts";
import { setEphemeralCampaign } from "./guest-storage.ts";

test("device mutation scope uses live storage mapping/account and rejects identity changes", () => {
  const prior = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
  };
  const local = new Map([
    ["quire.campaign.v1", "main"],
    ["quire.campaigns.v1", JSON.stringify([{ id: "main", db: "quire-original" }])],
  ]);
  const ticket = new Map([["lootsplit.verified-account", "owner"]]);
  const storage = { getItem: (key: string) => local.get(key) ?? null };
  Object.assign(globalThis, {
    localStorage: storage,
    sessionStorage: { getItem: (key: string) => ticket.get(key) ?? null },
    window: { localStorage: storage },
  });
  try {
    const original = captureDeviceMutationScope();
    assert.deepEqual(original, {
      campaignId: "main",
      databaseName: "quire-original",
      accountId: "owner",
      ephemeral: false,
    });
    assert.doesNotThrow(() => assertDeviceMutationScope(original));
    local.set("quire.campaigns.v1", JSON.stringify([{ id: "main", db: "quire-remapped" }]));
    assert.throws(() => assertDeviceMutationScope(original), /campaign or account changed/);
    local.set("quire.campaigns.v1", JSON.stringify([{ id: "main", db: "quire-original" }]));
    ticket.set("lootsplit.verified-account", "another-owner");
    assert.throws(() => assertDeviceMutationScope(original), /campaign or account changed/);
    ticket.set("lootsplit.verified-account", "owner");
    setEphemeralCampaign(true);
    assert.equal(captureDeviceMutationScope().databaseName, "guest-memory");
    assert.throws(() => assertDeviceMutationScope(original), /campaign or account changed/);
  } finally {
    setEphemeralCampaign(false);
    Object.assign(globalThis, prior);
  }
});
