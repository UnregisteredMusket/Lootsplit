import type { ItemCategory, ItemRarity, LexemeKind, ShopCategory, Wealth } from "./types.ts";

export const CATEGORIES: Array<{ value: ItemCategory; label: string }> = [
  { value: "provisions", label: "Provisions" },
  { value: "smith", label: "Smith" },
  { value: "cloth", label: "Cloth" },
  { value: "apothecary", label: "Apothecary" },
  { value: "inn", label: "Inn" },
  { value: "general", label: "General" },
  { value: "curios", label: "Curios" },
  { value: "stable", label: "Stable" },
  { value: "scribe", label: "Scribe" },
  { value: "jewels", label: "Jewels" },
];

export const SHOP_KINDS: Array<{ value: ShopCategory; label: string }> = [
  { value: "mixed", label: "Mixed market" },
  ...CATEGORIES,
];

export const WEALTHS: Array<{ value: Wealth; label: string }> = [
  { value: "poor", label: "Poor" },
  { value: "modest", label: "Modest" },
  { value: "rich", label: "Rich" },
  { value: "princely", label: "Princely" },
];

export const RARITIES: Array<{ value: ItemRarity; label: string }> = [
  { value: "common", label: "Common" },
  { value: "uncommon", label: "Uncommon" },
  { value: "rare", label: "Rare" },
  { value: "magic", label: "Magic" },
];

export const LEXEME_KINDS: Array<{ value: LexemeKind; label: string }> = [
  { value: "person", label: "Person" },
  { value: "place", label: "Place" },
  { value: "shop", label: "Shop" },
  { value: "region", label: "Region" },
  { value: "country", label: "Country" },
  { value: "continent", label: "Continent" },
];

export function labelOf<T extends string>(options: Array<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
