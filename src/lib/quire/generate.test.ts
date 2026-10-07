import assert from "node:assert/strict";
import test from "node:test";
import { starterCatalog } from "./catalog-seed.ts";
import { composeShelf } from "./compose.ts";
import { readQuireFile } from "./economy.ts";
import { extractLexemes, goodsFromText } from "./extract.ts";
import { inventItemName, randomPerson, rngFrom } from "./names.ts";
import { DEFAULT_REALM, scalePrice } from "./scale.ts";

test("DM-selected assortment stocks every matching catalog item without rarity caps", () => {
  const catalog = Array.from({ length: 80 }, (_, i) => ({
    id: `bulk-${i}`, name: `Bulk item ${i}`, category: "general" as const,
    rarity: "common" as const, baseCopper: 10, notes: "", origin: "hand" as const, service: false,
  }));
  const lines = composeShelf(catalog, {
    category: "general", wealth: "modest", flags: { common: true, uncommon: false, rare: false, magic: false },
    priceScale: 1, depth: 0.4, realm: DEFAULT_REALM, selection: "all", quantity: 25,
  }, rngFrom(1));
  assert.equal(lines.length, 80);
  assert.ok(lines.every(line => line.quantity === 25));
});

test("DM item count is independent of units per item and respects available catalog", () => {
  const catalog = starterCatalog();
  const input = {
    category: "mixed" as const, wealth: "modest" as const,
    flags: { common: true, uncommon: true, rare: true, magic: true },
    priceScale: 1, depth: 1, realm: DEFAULT_REALM, selection: "count" as const, itemCount: 40,
  };
  const low = composeShelf(catalog, { ...input, quantity: 1 }, rngFrom(2));
  const high = composeShelf(catalog, { ...input, quantity: 100 }, rngFrom(2));
  assert.equal(low.length, 40);
  assert.deepEqual(low.map(x => x.name), high.map(x => x.name));
  const all = composeShelf(catalog, { ...input, itemCount: 500 }, rngFrom(2));
  assert.equal(all.length, catalog.length);
  assert.ok(high.filter(x => x.service).every(x => x.quantity === null));
});

test("scales prices by wealth and pushes rare goods when scarcity rises", () => {
  const calm = { ...DEFAULT_REALM };
  const modest = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "general", realm: calm });
  const poor = scalePrice(100, { wealth: "poor", rarity: "common", priceScale: 1, category: "general", realm: calm });
  const rich = scalePrice(100, { wealth: "rich", rarity: "common", priceScale: 1, category: "general", realm: calm });
  const rareFlat = scalePrice(100, { wealth: "modest", rarity: "rare", priceScale: 1, category: "general", realm: { ...calm, scarcity: 0 } });
  const rareTight = scalePrice(100, { wealth: "modest", rarity: "rare", priceScale: 1, category: "general", realm: { ...calm, scarcity: 1 } });
  assert.equal(modest, 100);
  assert.ok(poor < modest);
  assert.ok(rich > modest);
  assert.equal(rareFlat, 100);
  assert.ok(rareTight > rareFlat);
});

test("season, war, and the roads move the goods they should", () => {
  const winter = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "provisions", realm: { ...DEFAULT_REALM, season: 0 } });
  const summer = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "provisions", realm: { ...DEFAULT_REALM, season: 2 } });
  const peace = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "smith", realm: DEFAULT_REALM });
  const war = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "smith", realm: { ...DEFAULT_REALM, war: 2 } });
  const open = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "jewels", realm: DEFAULT_REALM });
  const shut = scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "jewels", realm: { ...DEFAULT_REALM, roads: 0 } });
  assert.ok(winter > summer);
  assert.ok(war > peace);
  assert.ok(shut > open);
  assert.equal(scalePrice(100, { wealth: "modest", rarity: "common", priceScale: 1, category: "general", realm: DEFAULT_REALM }), 100);
});

test("a poor smith stocks staples and skips magic unless asked", () => {
  const catalog = starterCatalog();
  const off = composeShelf(
    catalog,
    {
      category: "smith",
      wealth: "poor",
      flags: { common: true, uncommon: true, rare: false, magic: false },
      priceScale: 1,
      depth: 1,
      realm: DEFAULT_REALM,
    },
    rngFrom(4),
  );
  assert.ok(off.length > 0);
  assert.equal(off.some((line) => line.rarity === "magic"), false);
  assert.ok(off.every((line) => catalog.some((item) => item.name === line.name && item.category === "smith")));
  const on = composeShelf(
    catalog,
    {
      category: "smith",
      wealth: "poor",
      flags: { common: false, uncommon: false, rare: false, magic: true },
      priceScale: 1,
      depth: 1,
      realm: DEFAULT_REALM,
    },
    rngFrom(4),
  );
  assert.equal(on.length, 1);
  assert.equal(on[0]?.rarity, "magic");
  assert.ok((on[0]?.copper ?? 0) > (on[0]?.baseCopper ?? 0));
  const first = composeShelf(catalog, { category: "smith", wealth: "modest", flags: { common: true, uncommon: true, rare: false, magic: false }, priceScale: 1, depth: 1, realm: DEFAULT_REALM }, rngFrom(1)).map((line) => line.name);
  const second = composeShelf(catalog, { category: "smith", wealth: "modest", flags: { common: true, uncommon: true, rare: false, magic: false }, priceScale: 1, depth: 1, realm: DEFAULT_REALM }, rngFrom(2)).map((line) => line.name);
  assert.notDeepEqual(first.slice().sort(), second.slice().sort());
});

test("reads kingdoms, cities, inns, and named people from prose", () => {
  const hits = extractLexemes([
    {
      title: "Nedda Pell",
      text: "The Kingdom of Oster sits on the continent of Vellum. The city of Brine exports salt. Travelers stop at the Gilded Eel Inn. A clerk named Sera Voss keeps the books. The Duchy of Holm watches the road.",
    },
  ]);
  const has = (kind: string, name: string) => hits.some((hit) => hit.kind === kind && hit.name === name);
  assert.equal(has("person", "Nedda Pell"), true);
  assert.equal(has("country", "Oster"), true);
  assert.equal(has("continent", "Vellum"), true);
  assert.equal(has("place", "Brine"), true);
  assert.equal(has("shop", "Gilded Eel Inn"), true);
  assert.equal(has("person", "Sera Voss"), true);
  assert.equal(has("region", "Holm"), true);
});

test("turns a printed price into an index good", () => {
  const goods = goodsFromText([{ text: "A flask of lamp oil costs 1 sp." }]);
  assert.equal(goods[0]?.name, "Flask of lamp oil");
  assert.equal(goods[0]?.copper, 10);
  assert.equal(goods[0]?.rarity, "common");
});

test("suggests only coherent priced goods", () => {
  const goods = goodsFromText([
    {
      text: [
        "Longsword 15 gp",
        "Hempen rope, 50 ft — 1 gp",
        "LAMP OIL",
        "1 sp",
        "Bread 2 cp, cheese 1 sp",
        "The king paid the messenger 20 gp for the news.",
        "The chest contains 200 gp and a ruby.",
        "A laborer earns 2 sp per day.",
        "The trap deals 2d6 gp of stolen coin.",
        "You find 15 gp in the drawer.",
        "Reward 50 gp",
      ].join("\n"),
    },
  ]);
  const names = goods.map((good) => good.name);
  assert.deepEqual(names.sort(), ["Bread", "Cheese", "Hempen rope, 50 ft", "Lamp oil", "Longsword"]);
  assert.equal(goods.find((good) => good.name === "Longsword")?.copper, 1500);
  assert.equal(goods.find((good) => good.name === "Lamp oil")?.copper, 10);
});

test("random names are two words and invented goods do not repeat", () => {
  const rng = rngFrom(9);
  const person = randomPerson(rng);
  assert.equal(person.split(" ").length, 2);
  const taken = new Set<string>();
  const first = inventItemName("smith", "common", taken, rng);
  taken.add(first.toLowerCase());
  const second = inventItemName("smith", "common", taken, rng);
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
});

test("still reads an older Quire copy", () => {
  const file = readQuireFile({
    kind: "quire",
    version: 1,
    exportedAt: 1,
    books: [],
    articles: [],
    purses: [],
    holdings: [],
    shops: [],
    stock: [],
    ledger: [],
  });
  assert.equal(file.version, 1);
  assert.equal(file.catalog, undefined);
});
