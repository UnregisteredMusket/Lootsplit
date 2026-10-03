import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { blankSheet } from "../characters/model.mjs";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { applyCommand } from "./commands.ts";
import { emptyCloudTable } from "./cloud.ts";
import {
  blankPurse,
  createCampaignCharacter,
  economySnapshot,
  saveCampaignCharacter,
  setCoins,
  saveHolding,
  applyCloudTable,
  snapshot,
  restore,
} from "./economy.ts";
import { emptyCoins } from "./money.ts";
const dm = { id: "dm", token: "dm", name: "DM", role: "dm" as const, purseIds: [] };
const player = { ...dm, id: "player", role: "player" as const, purseIds: ["hero"] };
const fixture = () => ({
  ...emptyCloudTable(),
  purses: [{ ...blankPurse("character"), id: "hero" }],
  holdings: [
    {
      id: "sword",
      purseId: "hero",
      name: "Sword",
      kind: "item" as const,
      quantity: 1,
      unitCopper: 100,
      notes: "",
      weight: 2,
    },
  ],
});
function edit(
  t: ReturnType<typeof fixture>,
  actor: import("./cloud.ts").CloudSeat = player,
  patch = {},
  before = characterSheet(t.purses[0], t.holdings),
) {
  return applyCommand(t, actor, {
    id: crypto.randomUUID(),
    kind: "character",
    purseId: "hero",
    before,
    sheet: { ...before, ...patch },
  });
}
test("party creation produces a playable sheet with exactly the same identity, wallet and inventory; backups retain it", async () => {
  await applyCloudTable(emptyCloudTable());
  const id = await createCampaignCharacter({
    ...blankSheet(),
    name: "Unified",
    hp: 10,
    maxHp: 115,
    coins: { ...emptyCoins(), gp: 4 },
    equipment: [{ name: "Axe", quantity: 2, weight: 3, equipped: true, notes: "" }],
  });
  let t = await economySnapshot(),
    p = t.purses.find((p) => p.id === id)!;
  let s = characterSheet(p, t.holdings);
  assert.equal(s.hp, 10);
  assert.equal(s.maxHp, 115);
  assert.equal(s.coins.gp, 4);
  assert.equal(s.equipment[0].quantity, 2);
  assert.deepEqual(p.sheet?.coins, emptyCoins());
  assert.deepEqual(p.sheet?.equipment, []);
  await setCoins(id, { ...emptyCoins(), gp: 8 });
  await saveHolding({ ...t.holdings[0], quantity: 5 });
  t = await economySnapshot();
  p = t.purses.find((p) => p.id === id)!;
  s = characterSheet(p, t.holdings);
  assert.equal(s.coins.gp, 8);
  assert.equal(s.equipment[0].quantity, 5);
  await saveCampaignCharacter({
    purseId: id,
    before: s,
    sheet: {
      ...s,
      hp: 7,
      coins: { ...s.coins, gp: 9 },
      equipment: s.equipment.map((i) => ({ ...i, quantity: 3 })),
    },
  });
  t = await economySnapshot();
  assert.equal(t.purses[0].coins.gp, 9);
  assert.equal(t.holdings[0].quantity, 3);
  const copy = await snapshot();
  await applyCloudTable(emptyCloudTable());
  await restore(copy);
  assert.deepEqual(await economySnapshot(), t);
});
test("player HP and equipment metadata edits work, financial and identity forgery do not", () => {
  const t = fixture(),
    before = characterSheet(t.purses[0], t.holdings);
  assert.equal(edit(t, player, { hp: 4 }).purses[0].sheet?.hp, 4);
  assert.equal(
    edit(t, player, { equipment: before.equipment.map((i) => ({ ...i, equipped: true })) })
      .holdings[0].equipped,
    true,
  );
  for (const patch of [
    { coins: { ...before.coins, gp: 100 } },
    {
      equipment: [
        ...before.equipment,
        { name: "Forged sword", quantity: 1, weight: 0, equipped: false, notes: "" },
      ],
    },
    { equipment: before.equipment.map((i) => ({ ...i, quantity: 99 })) },
    { equipment: before.equipment.map((i) => ({ ...i, unitCopper: 99999 })) },
    { scores: { ...before.scores, cha: 30 } },
  ])
    assert.throws(() => edit(t, player, patch), /Only the DM|Charisma/);
  assert.throws(() => edit(t, { ...player, purseIds: ["other"] }, { hp: 5 }), /control/);
  assert.deepEqual(characterSheet(t.purses[0], t.holdings), before);
});
test("saving HP cannot overwrite simultaneous funds changes; stale financial edits and duplicate item IDs are rejected", () => {
  const t = fixture(),
    before = characterSheet(t.purses[0], t.holdings);
  t.purses[0].coins.gp = 17;
  const next = edit(t, dm, { hp: 5 }, before);
  assert.equal(next.purses[0].coins.gp, 17);
  assert.throws(
    () => edit(t, dm, { coins: { ...before.coins, gp: 4 } }, before),
    /changed elsewhere/,
  );
  const current = characterSheet(t.purses[0], t.holdings);
  assert.throws(
    () => edit(t, dm, { equipment: [...current.equipment, ...current.equipment] }),
    /Duplicate/,
  );
  assert.throws(
    () => edit(t, dm, { equipment: [{ ...current.equipment[0], id: "someone-elses" }] }),
    /Unknown/,
  );
});
test("old campaign characters receive a sheet without inventing HP or changing their wealth", () => {
  const p = {
    id: "old",
    kind: "character" as const,
    name: "Ivo",
    coins: { ...emptyCoins(), gp: 47 },
  };
  const s = characterSheet(p, []);
  assert.equal(s.name, "Ivo");
  assert.equal(s.hp, 0);
  assert.equal(s.maxHp, 0);
  assert.equal(s.coins.gp, 47);
});

test("existing inventory text and IDs remain lossless while players save unrelated HP", async () => {
  const t = fixture();
  t.holdings[0] = {
    ...t.holdings[0],
    id: "item-".repeat(40),
    name: "  " + "Long item description ".repeat(12) + "  ",
    notes: "Notes and enchantment details. ".repeat(600),
  };
  const before = characterSheet(t.purses[0], t.holdings);
  const next = edit(t, player, { hp: 3 }, before);
  assert.equal(next.purses[0].sheet?.hp, 3);
  assert.deepEqual(next.holdings, t.holdings);
  assert.throws(
    () =>
      edit(t, player, { equipment: before.equipment.map((h) => ({ ...h, quantity: 99 })) }, before),
    /Only the DM/,
  );
  assert.throws(
    () =>
      edit(
        t,
        player,
        { equipment: before.equipment.map((h) => ({ ...h, name: "Revalued item" })) },
        before,
      ),
    /Only the DM/,
  );
  await applyCloudTable(t);
  await saveCampaignCharacter({ purseId: "hero", before, sheet: { ...before, hp: 3 } });
  const saved = await economySnapshot();
  assert.equal(saved.purses[0].sheet?.hp, 3);
  assert.deepEqual(saved.holdings, t.holdings);
});
