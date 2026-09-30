import type { ItemCategory, ItemRarity, Lexeme, ShopCategory } from "./types.ts";

const GIVEN = [
  "Ada", "Bram", "Cress", "Dain", "Elspeth", "Fenn", "Galva", "Holt", "Isen", "Joren",
  "Kestrel", "Lira", "Moss", "Nim", "Orla", "Perrin", "Quill", "Rowan", "Sable", "Tamsin",
  "Ulric", "Vesper", "Wren", "Ysolde", "Cade", "Maret", "Osric", "Bryn", "Hesta", "Leif",
];

const FAMILY = [
  "Ash", "Barrow", "Cole", "Dunn", "Ell", "Flint", "Grey", "Hale", "Kett", "Marsh",
  "Nye", "Oak", "Pell", "Reed", "Sallow", "Tanner", "Vale", "Wick", "Yarn", "Crowe",
];

const PLACES = [
  "Brine", "Hollowford", "Redwick", "Marrow", "Larkspur", "Ostlen", "Graymere", "Pellam",
  "Silt", "Harrowgate", "Cinderford", "Yarrow", "Lower market", "River gate", "Dock road",
];

const SHOP_TITLES: Record<ShopCategory, string[]> = {
  mixed: ["The Open Counter", "Crossing Goods", "Whatever's Left", "The Shared Stall"],
  provisions: ["Salt & Crumb", "The Second Loaf", "Barrel Row", "Dry Goods"],
  smith: ["Cinder & Nail", "The Sparrow Anvil", "Last Bell Forge", "Hinge & Hammer"],
  cloth: ["Wool & Hem", "The Mended Cloak", "Second Skin", "Threadmarket"],
  apothecary: ["Bitter Cup", "The Green Jar", "Fever & Fennel", "Stillroom"],
  inn: ["The Late Lamp", "The Long Table", "Ash & Ale", "Common Room"],
  general: ["Rope & Tallow", "The Useful", "Pack & Pocket", "Oddment"],
  curios: ["Pale Window", "The Unlabeled Box", "Relic & Rumor", "Glass Oddities"],
  stable: ["Hay & Harness", "The Far Yard", "Slow Hoof", "Tack Room"],
  scribe: ["Ink & Margin", "The Quiet Desk", "Copyhouse", "Quill Lane"],
  jewels: ["Small Bright", "The Locked Case", "Wire & Stone", "Second Setting"],
};

const ADJECTIVES = ["ash", "river", "old", "fine", "rough", "pale", "ember", "salt", "iron", "quiet", "oat", "mended", "copper"];
const MAGIC_ADJECTIVES = ["warded", "oathbound", "whispering", "true", "unburnt", "last"];

const NOUNS: Record<ItemCategory, string[]> = {
  provisions: ["loaf", "crock", "ration", "cheese", "honey", "salt", "biscuit", "cask"],
  smith: ["hinge", "nail", "blade", "hook", "tongs", "helm", "buckle", "poker"],
  cloth: ["cloak", "hood", "gloves", "belt", "hem", "mantle", "shirt", "boots"],
  apothecary: ["vial", "salve", "draught", "poultice", "tincture", "herb", "jar", "tea"],
  inn: ["supper", "room", "ale", "breakfast", "pallet", "stew", "tap", "key"],
  general: ["rope", "lantern", "pot", "tinderbox", "sack", "needle", "soap", "blanket"],
  curios: ["cameo", "charm", "reliquary", "clasp", "tooth", "glass", "idol", "locket"],
  stable: ["bridle", "nosebag", "harness", "shoe", "blanket", "comb", "bit", "halter"],
  scribe: ["quire", "ink", "map", "seal", "ledger", "quill", "charter", "margin"],
  jewels: ["ring", "brooch", "chain", "setting", "pearl", "band", "pin", "bead"],
};

export function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rows: readonly T[], rng: () => number): T {
  return rows[Math.floor(rng() * rows.length)] ?? rows[0]!;
}

export function randomPerson(rng: () => number = Math.random): string {
  return `${pick(GIVEN, rng)} ${pick(FAMILY, rng)}`;
}

export function randomPlace(rng: () => number = Math.random): string {
  return pick(PLACES, rng);
}

export function randomShopTitle(category: ShopCategory, place: string, rng: () => number = Math.random): string {
  const title = pick(SHOP_TITLES[category], rng);
  const where = place.trim();
  if (where && rng() < 0.4) return `${title} · ${where}`;
  return title;
}

export function nameFromLexicon(kind: Lexeme["kind"], lexicon: Lexeme[], fallback: (rng: () => number) => string, rng: () => number): string {
  const pool = lexicon.filter((row) => row.kind === kind);
  if (pool.length > 0 && rng() < 0.6) return pick(pool, rng).name;
  return fallback(rng);
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function inventItemName(category: ItemCategory, rarity: ItemRarity, taken: Set<string>, rng: () => number): string {
  const adjectives = rarity === "magic" ? MAGIC_ADJECTIVES : ADJECTIVES;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const name = titleCase(`${pick(adjectives, rng)} ${pick(NOUNS[category], rng)}`);
    if (!taken.has(name.toLowerCase())) return name;
  }
  return titleCase(`${pick(adjectives, rng)} ${pick(NOUNS[category], rng)} of ${pick(FAMILY, rng)}`);
}
