import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolveFantasyIcon } from "../src/lib/icons/resolve.ts";
const catalog = JSON.parse(readFileSync(new URL("../src/lib/icons/catalog.json", import.meta.url)));
test("all pinned SRD records and generic categories resolve to local assets", () => {
  assert.equal(Object.keys(catalog.records).length, 3013);
  for (const [id, spec] of Object.entries(catalog.records)) {
    const [kind, ...key] = id.split(":");
    const result = resolveFantasyIcon({ kind, key: key.join(":") });
    assert.equal(result.icon, spec.icon, id);
    assert.ok(existsSync(new URL("../public" + result.src, import.meta.url)), id);
  }
  for (const group of Object.values(catalog.categories))
    for (const icon of Object.values(group))
      assert.ok(existsSync(new URL("../public/icons/game-icons/" + icon, import.meta.url)), icon);
  for (const icon of Object.values(catalog.ui))
    assert.ok(existsSync(new URL("../public/icons/game-icons/" + icon, import.meta.url)), icon);
});
test("source identity wins over renamed labels; older spell URLs and editions still work", () => {
  const spec = catalog.records["spells:srd_fireball"];
  assert.equal(
    resolveFantasyIcon({
      kind: "spells",
      name: "Custom title",
      source: "https://api.open5e.com/v2/spells/srd_fireball/",
    }).icon,
    spec.icon,
  );
  assert.equal(
    resolveFantasyIcon({ id: "open5e:spells:srd_fireball", name: "Shield" }).icon,
    spec.icon,
  );
  assert.equal(
    resolveFantasyIcon({ name: "Longsword (2024)" }).icon,
    resolveFantasyIcon({ name: "Longsword" }).icon,
  );
  assert.notEqual(
    resolveFantasyIcon({ kind: "spells", name: "Shield" }).icon,
    resolveFantasyIcon({ kind: "items", name: "Shield" }).icon,
  );
});
test("new/custom records and unsafe dictionary keys use generic icons without changing input", () => {
  const input = { kind: "creatures", name: "Unknown homebrew creature", type: "Undead" };
  const before = structuredClone(input);
  assert.equal(resolveFantasyIcon(input).icon, catalog.categories.creatureTypes.undead);
  assert.deepEqual(input, before);
  assert.equal(
    resolveFantasyIcon({ kind: "spells", name: "Custom ward", school: "Abjuration" }).icon,
    catalog.categories.spellSchools.abjuration,
  );
  assert.equal(
    resolveFantasyIcon({ kind: "__proto__", name: "__proto__", category: "constructor" }).icon,
    catalog.defaults.items,
  );
  assert.equal(
    resolveFantasyIcon({ category: "apothecary" }, { categoryOnly: true }).icon,
    catalog.categories.itemCategories.potion,
  );
  assert.equal(
    resolveFantasyIcon({ name: "Giant Rat", kind: "creatures" }).icon,
    resolveFantasyIcon({ name: "Rat", kind: "creatures" }).icon,
  );
});
