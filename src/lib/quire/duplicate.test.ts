import assert from "node:assert/strict";
import test from "node:test";
import { copyName, shelfCopy, shopSettingsCopy } from "./duplicate.ts";
import { duplicateEncounter } from "../encounters/duplicate.ts";
import { blankCombatant, blankEncounter, blankLoot } from "../encounters/model.mjs";
import type { Shop, StockLine } from "./types.ts";

test("Copy names stay within the limit", () => {
  assert.equal(copyName("The Brass Lantern"), "The Brass Lantern (copy)");
  assert.equal(copyName("x".repeat(200), 120).length, 120);
  assert.equal(copyName("  "), "Untitled (copy)");
});

test("A shop copy keeps prices, quantities and notes but no trade links or schedule", () => {
  const stock: StockLine[] = [
    { id: "s1", shopId: "a", name: "Rope", copper: 100, baseCopper: 90, quantity: 5, rarity: "common", notes: "50 ft", category: "general" },
    { id: "s2", shopId: "a", name: "Timber", copper: 40, baseCopper: 40, quantity: null, rarity: "common", notes: "", commodityId: "timber", tradeExchangeId: "harbor" },
  ];
  const shelf = shelfCopy(stock);
  assert.deepEqual(shelf[0], { category: "general", name: "Rope", copper: 100, baseCopper: 90, quantity: 5, rarity: "common", notes: "50 ft" });
  assert.equal("commodityId" in shelf[1], false);
  assert.equal(shelf[1].quantity, null);
  const shop = { id: "a", name: "Lantern", keeper: "", place: "", notes: "", sellRate: 1, buyRate: 0.5, wealth: "modest", category: "general", priceScale: 1, acceptAnyCategory: true, schedule: { rules: [] } } as unknown as Shop;
  const copy = shopSettingsCopy(shop, "b", "Lantern (copy)");
  assert.equal(copy.id, "b");
  assert.equal(copy.acceptAnyCategory, true);
  assert.equal("schedule" in copy, false);
});

test("An encounter copy keeps combatants and loot and resets combat progress", () => {
  const goblin = { ...blankCombatant(), name: "Goblin", hp: 2, maxHp: 7, initiative: 14, conditions: "Prone" };
  const e = { ...blankEncounter(), name: "Ambush", round: 3, activeId: goblin.id, combatants: [goblin], loot: [{ ...blankLoot(), name: "Ruby", unitCopper: 5000 }] };
  const copy = duplicateEncounter(e);
  assert.equal(copy.name, "Ambush (copy)");
  assert.equal(copy.round, 1);
  assert.equal(copy.activeId, "");
  assert.deepEqual(copy.combatants.map((c) => [c.name, c.hp, c.initiative, c.conditions]), [["Goblin", 7, null, ""]]);
  assert.deepEqual(copy.loot, e.loot);
  assert.notEqual(copy.loot, e.loot);
});
