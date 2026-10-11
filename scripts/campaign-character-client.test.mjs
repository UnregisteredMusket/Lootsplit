import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { characterSheet } from "../src/lib/characters/campaign-sheet.mjs";

// Execute the real campaign detail reader with only its I/O dependencies replaced.
const source = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/characters/campaign-client.ts", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "")
    .replace("export async function characterRequest", "async function characterRequest")
    .replace('await import("../quire/cloud-client")', "({ requestCampaignRoll })"),
);

function fixture(replies) {
  const table = {
    purses: [
      {
        id: "hero",
        name: "Guest hero",
        kind: "character",
        editingAllowed: false,
        coins: { cp: 0, sp: 0, ep: 0, gp: 17, pp: 0 },
      },
    ],
    holdings: [
      {
        id: "sword",
        purseId: "hero",
        name: "Sword",
        quantity: 1,
        kind: "item",
        unitCopper: 100,
        notes: "",
      },
    ],
    sheets: [],
  };
  const room = { joined: true, code: "SYNTHETIC", pending: 1 };
  const seat = { role: "player", purseIds: ["hero"] };
  const calls = [];
  const forbidden = () => {
    throw Error("A sheet read must not write or use an account profile");
  };
  const dependencies = {
    canReadCharacter: () => true,
    accountRequest: forbidden,
    characterSheet,
    economySnapshot: async () => table,
    saveCampaignCharacter: forbidden,
    getSeat: () => seat,
    getCloudTable: () => room,
    queueCommand: forbidden,
    captureMutationScope: forbidden,
    assertMutationScope: forbidden,
    announceSheetChange: forbidden,
    requestCampaignRoll: async (input) => {
      calls.push(input);
      return replies.shift();
    },
  };
  const read = new Function(...Object.keys(dependencies), source + "\nreturn characterRequest;")(
    ...Object.values(dependencies),
  );
  return { read, table, room, calls };
}

test("a guest can retry an incomplete roll-policy response without losing the sheet, funds or pending actions", async () => {
  for (const malformed of [
    undefined,
    null,
    {},
    { manualAllowed: null },
    { manualAllowed: "true" },
  ]) {
    const h = fixture([malformed, { manualAllowed: false }]);
    const before = structuredClone({ table: h.table, room: h.room });
    await assert.rejects(
      h.read("sheets/detail", { id: "party:hero" }),
      /campaign roll settings.*Retry/i,
    );
    const detail = await h.read("sheets/detail", { id: "party:hero" });
    assert.equal(detail.body.name, "Guest hero");
    assert.equal(detail.campaign.manualAllowed, false);
    assert.equal(detail.campaign.editingAllowed, false);
    assert.equal(detail.campaign.coins.gp, 17);
    assert.equal(detail.campaign.holdings[0].id, "sword");
    assert.deepEqual({ table: h.table, room: h.room }, before);
    assert.deepEqual(h.calls, [
      { purseId: "hero", policy: true },
      { purseId: "hero", policy: true },
    ]);
  }
});

test("a valid policy retains the DM's manual-roll decision for a controlled campaign sheet", async () => {
  for (const manualAllowed of [true, false]) {
    const h = fixture([{ manualAllowed }]);
    const detail = await h.read("sheets/detail", { id: "party:hero" });
    assert.equal(detail.campaign.manualAllowed, manualAllowed);
  }
});
