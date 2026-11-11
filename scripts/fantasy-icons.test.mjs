import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { iconLookup, loadIconCatalog, resolveFantasyIcon } from "../src/lib/icons/resolve.ts";
const read = (name) => JSON.parse(readFileSync(new URL(`../src/lib/icons/${name}`, import.meta.url)));
// Record and name tables load on demand (audit F5); the rest is always bundled.
const catalog = { ...read("catalog-core.json"), ...read("catalog.json") };
test("record and name tables load on demand; before that icons fall back to family or category", async () => {
  assert.equal(iconLookup(), null, "nothing loaded at import");
  const fireball = { id: "open5e:spells:srd_fireball", name: "Fireball", school: "Evocation" };
  const before = resolveFantasyIcon(fireball);
  assert.equal(before.icon, catalog.categories.spellSchools.evocation);
  assert.equal(before.matchedBy, "category");
  // Family rules and UI symbols are always available.
  assert.equal(resolveFantasyIcon({ name: "Arrows" }).icon, "lorc/arrowhead.svg");
  assert.equal(resolveFantasyIcon({}, { ui: Object.keys(catalog.ui)[0] }).icon, Object.values(catalog.ui)[0]);
  const [first, second] = [loadIconCatalog(), loadIconCatalog()];
  assert.equal(first, second, "loaded once");
  await first;
  assert.equal(resolveFantasyIcon(fireball).icon, catalog.records["spells:srd_fireball"].icon);
  assert.equal(resolveFantasyIcon(fireball).matchedBy, "source");
  // A render that must match the server (hydration) can still ask for the placeholder.
  assert.equal(resolveFantasyIcon(fireball, { lookup: null }).icon, before.icon);
});
test("all pinned SRD records and generic categories resolve to local assets", async () => {
  await loadIconCatalog();
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
  // Name rules (e.g. "bag of holding") point at shipped files too, or /catalog shows 404s.
  for (const [kind, rules] of Object.entries(catalog.rules))
    for (const [name, icon] of rules)
      assert.ok(existsSync(new URL("../public/icons/game-icons/" + icon, import.meta.url)), `${kind}: ${name} → ${icon}`);
});
test("source identity wins over renamed labels; older spell URLs and editions still work", async () => {
  await loadIconCatalog();
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
test("new/custom records and unsafe dictionary keys use generic icons without changing input", async () => {
  await loadIconCatalog();
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
test("plural custom item names use their item family, not the shop category (design plan P6)", async () => {
  await loadIconCatalog();
  const arrows = resolveFantasyIcon({ name: "Arrows", category: "smith" });
  assert.equal(arrows.icon, resolveFantasyIcon({ name: "Arrow" }).icon);
  assert.notEqual(arrows.icon, resolveFantasyIcon({ category: "smith" }, { categoryOnly: true }).icon);
  assert.equal(arrows.matchedBy, "family");
  assert.equal(
    resolveFantasyIcon({ name: "Torches" }).icon,
    resolveFantasyIcon({ name: "Torch" }).icon,
  );
});
