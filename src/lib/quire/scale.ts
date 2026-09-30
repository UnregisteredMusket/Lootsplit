import { formatCopper, formatDollars } from "./money.ts";
import type { ItemCategory, ItemRarity, RealmSettings, Wealth } from "./types.ts";

export const DEFAULT_REALM: RealmSettings = {
  inflation: 1,
  scarcity: 1,
  gpDollars: 250,
  season: 1,
  shortage: 0,
  war: 0,
  plague: 0,
  roads: 1,
};

export const SEASON_NAMES = ["Winter", "Spring", "Summer", "Harvest", "Autumn"] as const;

export const WEALTH_RATE: Record<Wealth, number> = {
  poor: 0.55,
  modest: 1,
  rich: 1.65,
  princely: 2.75,
};

const RARITY_BEND: Record<ItemRarity, number> = {
  common: 0,
  uncommon: 0.25,
  rare: 0.7,
  magic: 1.35,
};

const SEASON_RATE: Record<ItemCategory, readonly number[]> = {
  provisions: [1.5, 1, 0.85, 0.7, 1.2],
  inn: [1.3, 1, 0.95, 1.15, 1.05],
  cloth: [1.25, 1, 0.9, 1, 1.15],
  stable: [1.35, 1, 1, 0.9, 1.2],
  smith: [1.05, 1, 1, 1, 1.05],
  apothecary: [1.2, 1, 0.95, 1, 1.15],
  general: [1.1, 1, 1, 0.95, 1.05],
  curios: [1, 1, 1.05, 1, 1],
  scribe: [1, 1, 1, 1, 1],
  jewels: [1, 1, 1.05, 1.1, 1],
};

const SHORTAGE_WEIGHT: Record<ItemCategory, number> = {
  provisions: 0.45,
  smith: 0.3,
  cloth: 0.25,
  apothecary: 0.35,
  general: 0.2,
  inn: 0.15,
  stable: 0.25,
  jewels: 0,
  curios: 0.05,
  scribe: 0.1,
};

const WAR_WEIGHT: Record<ItemCategory, number> = {
  smith: 0.55,
  stable: 0.4,
  provisions: 0.3,
  apothecary: 0.2,
  general: 0.15,
  scribe: 0.15,
  inn: 0.1,
  cloth: 0.1,
  jewels: -0.15,
  curios: -0.1,
};

const PLAGUE_WEIGHT: Record<ItemCategory, number> = {
  apothecary: 0.6,
  provisions: 0.25,
  curios: 0.2,
  inn: -0.3,
  jewels: -0.1,
  stable: 0.05,
  general: 0.05,
  cloth: 0,
  smith: 0,
  scribe: 0,
};

const ROAD_WEIGHT: Record<ItemCategory, number> = {
  jewels: 0.35,
  curios: 0.3,
  cloth: 0.2,
  scribe: 0.15,
  provisions: 0.12,
  smith: 0.1,
  apothecary: 0.1,
  general: 0.08,
  inn: 0.05,
  stable: 0.05,
};

export const BUY_RATE: Record<Wealth, number> = {
  poor: 0.3,
  modest: 0.5,
  rich: 0.6,
  princely: 0.75,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampScale(value: number): number {
  return clamp(value, 0.25, 3, 1);
}

export function clampRealm(settings: Partial<RealmSettings> | null | undefined): RealmSettings {
  const season = Math.round(clamp(Number(settings?.season), 0, 4, DEFAULT_REALM.season));
  return {
    inflation: clamp(Number(settings?.inflation), 0.5, 2.5, 1),
    scarcity: clamp(Number(settings?.scarcity), 0, 2, 1),
    gpDollars: clamp(Number(settings?.gpDollars), 25, 2000, 250),
    season,
    shortage: clamp(Number(settings?.shortage), 0, 2, 0),
    war: clamp(Number(settings?.war), 0, 2, 0),
    plague: clamp(Number(settings?.plague), 0, 2, 0),
    roads: clamp(Number(settings?.roads), 0, 2, 1),
  };
}

export function pressureFor(category: ItemCategory, settings: Partial<RealmSettings> | null | undefined): number {
  const realm = clampRealm(settings);
  const season = SEASON_RATE[category][realm.season] ?? 1;
  const shortage = 1 + realm.shortage * SHORTAGE_WEIGHT[category];
  const war = 1 + realm.war * WAR_WEIGHT[category];
  const plague = 1 + realm.plague * PLAGUE_WEIGHT[category];
  const roads = 1 + (1 - realm.roads) * ROAD_WEIGHT[category];
  return clamp(season * shortage * war * plague * roads, 0.35, 4, 1);
}

export function scalePrice(
  baseCopper: number,
  input: {
    wealth: Wealth;
    rarity: ItemRarity;
    priceScale: number;
    category: ItemCategory;
    realm: Partial<RealmSettings>;
  },
): number {
  const realm = clampRealm(input.realm);
  const rarity = 1 + RARITY_BEND[input.rarity] * realm.scarcity;
  const raw =
    baseCopper * WEALTH_RATE[input.wealth] * rarity * clampScale(input.priceScale) * realm.inflation * pressureFor(input.category, realm);
  return Math.max(1, Math.round(raw));
}

export function scarcityNote(scarcity: number): string {
  const rare = Math.round((1 + RARITY_BEND.rare * scarcity) * 100);
  const magic = Math.round((1 + RARITY_BEND.magic * scarcity) * 100);
  return `Rare items are about ${rare}% of the list price. Magic items are about ${magic}%. A shop's own price adjustment applies after that.`;
}

export function realmNote(settings: Partial<RealmSettings>, options?: { dollars?: boolean }): string {
  const realm = clampRealm(settings);
  const bits: string[] = [SEASON_NAMES[realm.season] ?? "Spring"];
  if (realm.shortage >= 1.5) bits.push("severe shortage");
  else if (realm.shortage >= 0.5) bits.push("shortage");
  if (realm.war >= 1.5) bits.push("heavy war");
  else if (realm.war >= 0.5) bits.push("war");
  if (realm.plague >= 1.5) bits.push("plague");
  else if (realm.plague >= 0.5) bits.push("illness");
  if (realm.roads <= 0.5) bits.push("roads closed");
  else if (realm.roads >= 1.5) bits.push("roads busy");
  const dollars = options?.dollars === false ? "" : ` 1 gp is about ${formatDollars(100, realm.gpDollars)}.`;
  return `${bits.join(" · ")}.${dollars}`;
}

export function basketNote(settings: Partial<RealmSettings>, options?: { dollars?: boolean }): string {
  const realm = clampRealm(settings);
  const loaf = scalePrice(2, { wealth: "modest", rarity: "common", priceScale: 1, category: "provisions", realm });
  const mail = scalePrice(7500, { wealth: "modest", rarity: "rare", priceScale: 1, category: "smith", realm });
  if (options?.dollars === false) {
    return `Example: a shop of average wealth charges ${formatCopper(loaf)} for a barley loaf and ${formatCopper(mail)} for a mail shirt.`;
  }
  return `Example: a shop of average wealth charges ${formatCopper(loaf)} (${formatDollars(loaf, realm.gpDollars)}) for a barley loaf and ${formatCopper(mail)} (${formatDollars(mail, realm.gpDollars)}) for a mail shirt.`;
}

const LIST_BASE: Record<ItemRarity, number> = {
  common: 18,
  uncommon: 180,
  rare: 2200,
  magic: 14000,
};

const LIST_BEND: Record<ItemCategory, number> = {
  provisions: 0.45,
  smith: 1.1,
  cloth: 0.8,
  apothecary: 0.9,
  inn: 0.7,
  general: 0.85,
  curios: 1.5,
  stable: 1,
  scribe: 0.75,
  jewels: 1.8,
};

export function inventedListPrice(category: ItemCategory, rarity: ItemRarity, rng: () => number): number {
  const jitter = 0.75 + rng() * 0.5;
  return Math.max(1, Math.round(LIST_BASE[rarity] * LIST_BEND[category] * jitter));
}