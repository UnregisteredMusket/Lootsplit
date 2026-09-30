import { BUY_RATE, scalePrice } from "./scale.ts";
import type { CatalogItem, ItemRarity, RealmSettings, ShopCategory, Wealth } from "./types.ts";

export type RarityFlags = Record<ItemRarity, boolean>;

export type ComposeInput = {
  category: ShopCategory;
  wealth: Wealth;
  flags: RarityFlags;
  priceScale: number;
  depth: number;
  realm: RealmSettings;
};

export type ShelfDraft = {
  name: string;
  copper: number;
  baseCopper: number;
  quantity: number | null;
  rarity: ItemRarity;
  notes: string;
};

const CAPS: Record<Wealth, Record<ItemRarity, number>> = {
  poor: { common: 8, uncommon: 2, rare: 1, magic: 1 },
  modest: { common: 7, uncommon: 4, rare: 2, magic: 1 },
  rich: { common: 5, uncommon: 4, rare: 3, magic: 3 },
  princely: { common: 3, uncommon: 3, rare: 4, magic: 4 },
};

const ORDER: ItemRarity[] = ["common", "uncommon", "rare", "magic"];

function shuffle<T>(rows: T[], rng: () => number): T[] {
  const next = [...rows];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const current = next[index]!;
    next[index] = next[swap]!;
    next[swap] = current;
  }
  return next;
}

function quantityFor(item: CatalogItem, wealth: Wealth, depth: number, rng: () => number): number | null {
  if (item.service) return null;
  const base = { common: 10, uncommon: 4, rare: 2, magic: 1 }[item.rarity];
  const bulk = { poor: 1.25, modest: 1, rich: 0.75, princely: 0.5 }[wealth];
  const jitter = 0.85 + rng() * 0.3;
  return Math.max(1, Math.round(base * bulk * depth * jitter));
}

export function composeShelf(catalog: CatalogItem[], input: ComposeInput, rng: () => number = Math.random): ShelfDraft[] {
  const depth = Math.min(1.8, Math.max(0.35, input.depth));
  const wanted = ORDER.filter((rarity) => input.flags[rarity]);
  const pool = catalog.filter((item) => wanted.includes(item.rarity) && (input.category === "mixed" || item.category === input.category));
  const shuffled = shuffle(pool, rng);
  const lines: ShelfDraft[] = [];
  for (const rarity of wanted) {
    const group = shuffled.filter((item) => item.rarity === rarity);
    let cap = Math.max(1, Math.round(CAPS[input.wealth][rarity] * depth));
    if (group.length > 1 && cap >= group.length) {
      const omit = 1 + Math.floor(rng() * Math.min(2, group.length - 1));
      cap = group.length - omit;
    }
    for (const item of group.slice(0, cap)) {
      lines.push({
        name: item.name,
        baseCopper: item.baseCopper,
        copper: scalePrice(item.baseCopper, {
          wealth: input.wealth,
          rarity: item.rarity,
          priceScale: input.priceScale,
          category: item.category,
          realm: input.realm,
        }),
        quantity: quantityFor(item, input.wealth, depth, rng),
        rarity: item.rarity,
        notes: item.service ? "Service" : "",
      });
    }
  }
  return lines.sort((a, b) => a.name.localeCompare(b.name));
}

export function suggestedBuyRate(wealth: Wealth): number {
  return BUY_RATE[wealth];
}
