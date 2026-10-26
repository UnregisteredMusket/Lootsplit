import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSrdIndex,
  matchSrdItem,
  srdKey,
  valueEquipment,
  type SrdRow,
} from "./srd-item-values.ts";

const data = JSON.parse(readFileSync(new URL("./srd-item-values.json", import.meta.url), "utf8"));
const index = buildSrdIndex(data.rows as SrdRow[]);
const price = (name: string, edition = "2014") =>
  matchSrdItem(index, name, edition)?.copper ?? null;
const item = (name: string, quantity = 1, extra = {}) => ({
  name,
  quantity,
  weight: 0,
  equipped: false,
  notes: "Imported: " + name,
  ...extra,
});

test("the bundled list covers both SRDs and every row is a whole-copper price", () => {
  assert.ok(data.rows.length > 1000);
  for (const [name, edition, copper, weight] of data.rows as SrdRow[]) {
    assert.ok(name && (edition === "2014" || edition === "2024"));
    assert.ok(Number.isSafeInteger(copper) && copper > 0, name);
    assert.ok(weight >= 0, name);
  }
});

test("keys even out case, apostrophes, plurals, articles and containers", () => {
  assert.equal(srdKey("Explorer’s Pack"), srdKey("explorers pack"));
  assert.equal(srdKey("Daggers"), srdKey("Dagger"));
  assert.equal(srdKey("a flask of oil"), "oil");
  assert.equal(srdKey("+1 Longsword"), srdKey("Longsword (+1)"));
});

test("common starting equipment gets its SRD price", () => {
  assert.equal(price("Longsword"), 1500);
  assert.equal(price("Daggers"), 200);
  assert.equal(price("Explorer's Pack"), 1000);
  assert.equal(price("Shield"), 1000);
  assert.equal(price("Chain mail"), 7500);
  assert.equal(price("Rations"), 50); // "Rations (1 day)"
  assert.equal(price("Torch"), 1);
  assert.equal(price("Arrows"), 5); // one arrow, not the bundle of 20
  assert.equal(price("Potion of Healing"), 5000);
  assert.equal(price("Hempen rope"), 100); // "Rope, hempen (50 feet)" by its words
});

test("magic items without a listed price use the SRD 5.2.1 rarity value", () => {
  const m = matchSrdItem(index, "+1 Longsword", "2024");
  assert.ok(m);
  assert.equal(m.basis, "rarity");
  assert.equal(m.copper, 40000); // uncommon, 400 gp
  assert.equal(price("Bag of Holding", "2024"), 40000);
});

test("the sheet's edition is preferred, and unknown names are left alone", () => {
  assert.equal(matchSrdItem(index, "Longsword", "2024")?.edition, "2024");
  assert.equal(matchSrdItem(index, "Longsword", "2014")?.edition, "2014");
  assert.equal(price("Grandmother's locket"), null);
  assert.equal(price(""), null);
});

test("valuing keeps entered values, fills weight, and reads leading counts", () => {
  const result = valueEquipment(
    index,
    [
      item("Longsword"),
      item("20 arrows"),
      item("Lucky coin"),
      item("Dagger", 2, { unitCopper: 150 }),
      item("Shield", 1, { weight: 5 }),
    ],
    "2014",
  );
  const [sword, arrows, coin, dagger, shield] = result.equipment;
  assert.equal(sword.unitCopper, 1500);
  assert.equal(sword.weight, 3);
  assert.match(sword.notes, /Value from SRD 5\.1 "Longsword", via Open5e\./);
  assert.equal(arrows.name, "arrows");
  assert.equal(arrows.quantity, 20);
  assert.equal(arrows.unitCopper, 5);
  assert.equal(coin.unitCopper, undefined);
  assert.equal(dagger.unitCopper, 150);
  assert.equal(shield.weight, 5);
  assert.deepEqual(result.unmatched, ["Lucky coin"]);
  assert.equal(result.valued.length, 3);
});

test("a key that means two different prices is never guessed", () => {
  const rows: SrdRow[] = [
    ["Widget (small)", "2014", 100, 1, "g"],
    ["Widget (large)", "2014", 900, 1, "g"],
  ];
  const tiny = buildSrdIndex(rows);
  assert.equal(matchSrdItem(tiny, "Widget", "2014"), null);
  assert.equal(matchSrdItem(tiny, "Widget (large)", "2014")?.copper, 900);
});
