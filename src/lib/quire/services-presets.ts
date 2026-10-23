import type { ServiceComponent, ServiceKind, ServiceOffer, ServiceProvider } from "./services-schema.ts";

// Editable price presets for service providers. Prices are whole copper (1 gp = 100 cp).
// SRD 5.2.1 and SRD 5.1 are by Wizards of the Coast, licensed CC-BY-4.0 (credited in
// src/lib/website/resources.ts). Effects are record only: nothing here changes a sheet.

export type ServicePreset = ServiceProvider["preset"];
const gp = (n: number) => n * 100;
const diamond = (min: number, label = "Diamond"): ServiceComponent => ({
  key: label === "Diamond" ? "diamond" : "diamond-dust",
  label,
  materialKey: "diamond",
  minCopper: gp(min),
  quantity: 1,
  perUnit: false,
  consumed: true,
  supply: "either",
  supplyCopper: gp(min),
});
type Spell = {
  key: string;
  name: string;
  level: number;
  description: string;
  castingMinutes?: number;
  component?: ServiceComponent;
  review?: "dm";
  draft?: boolean;
};
/** SRD 5.2.1 Spellcasting Services (p.102) and each spell's material component. */
const templeSpells: Spell[] = [
  { key: "cure-wounds", name: "Cure Wounds", level: 1, description: "Healing for one creature. The DM applies the hit points." },
  { key: "lesser-restoration", name: "Lesser Restoration", level: 2, description: "Ends one disease or one of the Blinded, Deafened, Paralyzed or Poisoned conditions, as the DM rules." },
  { key: "remove-curse", name: "Remove Curse", level: 3, description: "Ends curses on one creature or object, as the DM rules." },
  { key: "revivify", name: "Revivify", level: 3, description: "Returns a creature that died within the last minute, as the DM rules.", component: diamond(300) },
  {
    key: "greater-restoration",
    name: "Greater Restoration",
    level: 5,
    description: "Removes a reduction, curse or petrification, as the DM rules.",
    component: diamond(100, "Diamond dust"),
    draft: true,
  },
  {
    key: "raise-dead",
    name: "Raise Dead",
    level: 5,
    description: "Returns a creature dead no longer than 10 days, as the DM rules.",
    castingMinutes: 60,
    component: diamond(500),
    review: "dm",
  },
  {
    key: "resurrection",
    name: "Resurrection",
    level: 7,
    description: "Returns a creature dead no longer than a century, as the DM rules.",
    castingMinutes: 60,
    component: diamond(1000),
    review: "dm",
  },
];
/** SRD 5.2.1 Spellcasting Services: cost by spell level. */
export const srd521SpellCopper = [gp(30), gp(50), gp(200), gp(300), gp(2000), gp(2000), gp(20000), gp(20000), gp(20000), gp(20000)];

function templeOffer(s: Spell, preset: ServicePreset): ServiceOffer {
  // SRD 5.1 (p.75) gives no fixed rates: levels 1-2 "might cost 10 to 50 gold pieces", so they
  // take the top of that range and higher levels stay unpriced drafts for the DM to set.
  const price = preset === "srd-5.1" ? (s.level <= 2 ? gp(50) : 0) : srd521SpellCopper[s.level];
  const draft = s.draft || (preset === "srd-5.1" && s.level > 2);
  return {
    key: s.key,
    name: s.name,
    description: s.description,
    approved: !draft,
    priceCopper: price,
    spellLevel: s.level,
    time: { kind: "instant", ...(s.castingMinutes ? { castingMinutes: s.castingMinutes } : {}) },
    review: s.review ?? "auto",
    ...(s.component ? { components: [s.component] } : {}),
    output: { kind: "record" },
  };
}

export const workshopSpecialties = ["Scribe", "Alchemist"] as const;
export type WorkshopSpecialty = (typeof workshopSpecialties)[number];

/** SRD 5.2.1 Spell Scroll Costs (p.103-104): days and scribing cost by level; price is double (p.206). */
export const scrollTable = [
  { level: 0, days: 1, costGp: 15 },
  { level: 1, days: 1, costGp: 25 },
  { level: 2, days: 3, costGp: 100 },
  { level: 3, days: 5, costGp: 150 },
  { level: 4, days: 10, costGp: 1000 },
  { level: 5, days: 25, costGp: 1500 },
  { level: 6, days: 40, costGp: 10000 },
  { level: 7, days: 50, costGp: 12500 },
  { level: 8, days: 60, costGp: 15000 },
  { level: 9, days: 120, costGp: 50000 },
];
const scrollSpells: [string, string, number][] = [
  ["bless", "Bless", 1],
  ["cure-wounds", "Cure Wounds", 1],
  ["shield", "Shield", 1],
  ["misty-step", "Misty Step", 2],
  ["lesser-restoration", "Lesser Restoration", 2],
  ["fireball", "Fireball", 3],
  ["counterspell", "Counterspell", 3],
  ["remove-curse", "Remove Curse", 3],
];
function scrollOffer([key, name, level]: [string, string, number], preset: ServicePreset): ServiceOffer {
  const row = scrollTable[level];
  // SRD 5.1 has no scroll-scribing rule: the offers stay unpriced drafts for the DM.
  const price = preset === "srd-5.1" ? 0 : gp(row.costGp * 2);
  return {
    key: `scroll-${key}`,
    name: `Scroll of ${name}`,
    description: `A spell scroll of ${name} (level ${level}).`,
    approved: preset !== "srd-5.1",
    priceCopper: price,
    spellLevel: level,
    time: { kind: "downtime-days", days: row.days, perUnit: true },
    review: "auto",
    maxUnits: 1,
    output: {
      kind: "holding",
      name: `Spell Scroll of ${name}`,
      unitCopper: price,
      weight: 0,
      category: "scribe",
      notes: `Spell scroll (${level === 0 ? "cantrip" : `level ${level}`}): ${name}. The DM rules how it is used.`,
    },
  };
}
/** Brews: SRD 5.2.1 Brewing Potions of Healing (1 day, 25 gp materials) and the crafting rule
 * (half the price in materials, gp ÷ 10 days, rounded up); SRD 5.1 crafting is 5 gp a day. */
const brews: { key: string; name: string; gp: number; weight: number; herbs?: boolean }[] = [
  { key: "potion-of-healing", name: "Potion of Healing", gp: 50, weight: 0.5, herbs: true },
  { key: "antitoxin", name: "Antitoxin", gp: 50, weight: 0 },
  { key: "alchemists-fire", name: "Alchemist's Fire", gp: 50, weight: 1 },
  { key: "acid", name: "Acid", gp: 25, weight: 1 },
  { key: "holy-water", name: "Holy Water", gp: 25, weight: 1 },
  { key: "basic-poison", name: "Basic Poison", gp: 100, weight: 0 },
];
function brewOffer(b: (typeof brews)[number], preset: ServicePreset): ServiceOffer {
  const days =
    preset === "srd-5.1" ? Math.ceil(b.gp / 5) : b.key === "potion-of-healing" ? 1 : Math.ceil(b.gp / 10);
  const herbs: ServiceComponent | undefined = b.herbs
    ? {
        key: "healing-herbs",
        label: "Healing herbs",
        materialKey: "healing-herbs",
        minCopper: 0,
        quantity: 1,
        perUnit: true,
        consumed: true,
        supply: "either",
        supplyCopper: gp(b.gp / 2),
      }
    : undefined;
  return {
    key: b.key,
    name: b.name,
    description: `${b.name}, brewed to order.`,
    approved: true,
    // With herbs the price covers the work; the herbs cost half the price unless brought.
    priceCopper: herbs ? gp(b.gp / 2) : gp(b.gp),
    time: { kind: "downtime-days", days, perUnit: true },
    review: "auto",
    maxUnits: 5,
    ...(herbs ? { components: [herbs] } : {}),
    output: { kind: "holding", name: b.name, unitCopper: gp(b.gp), weight: b.weight, category: "apothecary", notes: `${b.name}. The DM rules its effect.` },
  };
}

/** SRD 5.2.1 Food, Drink and Lodging (p.101-102): a night per person and each meal, by lifestyle. */
const innTiers: [string, string, number, number, number][] = [
  // key, name, night cp, meal cp (5.2.1, each), food per day cp (5.1)
  ["squalid", "Squalid", 7, 1, 3],
  ["poor", "Poor", 10, 2, 6],
  ["modest", "Modest", 50, 10, 30],
  ["comfortable", "Comfortable", 80, 20, 50],
  ["wealthy", "Wealthy", 200, 30, 80],
  ["aristocratic", "Aristocratic", 400, 60, 200],
];
function innOffer(preset: ServicePreset): ServiceOffer {
  return {
    key: "stay",
    name: "Rooms and meals",
    // SRD 5.1 prices food per day rather than per meal: one "meal" a day is a full day's food.
    description:
      preset === "srd-5.1"
        ? "A night's lodging per guest; meals are a day's food per guest (SRD 5.1)."
        : "A night's lodging per guest, and meals each day.",
    approved: true,
    priceCopper: 0,
    time: { kind: "per-night", maxNights: 14 },
    review: "auto",
    output: { kind: "record" },
    tiers: innTiers.map(([key, name, night, meal, day]) => ({
      key,
      name,
      nightCopper: night,
      mealCopper: preset === "srd-5.1" ? day : meal,
      offered: true,
    })),
  };
}

/** The offers a preset brings for this kind (and workshop specialty). Blank brings none. */
export function presetOffers(kind: ServiceKind, preset: ServicePreset, specialty?: string): ServiceOffer[] {
  if (preset === "blank") return [];
  if (kind === "temple") return templeSpells.map((s) => templeOffer(s, preset));
  if (kind === "inn") return [innOffer(preset)];
  if (kind === "workshop" && specialty === "Scribe") return scrollSpells.map((s) => scrollOffer(s, preset));
  if (kind === "workshop" && specialty === "Alchemist") return brews.map((b) => brewOffer(b, preset));
  return [];
}

/**
 * Apply a preset to a provider: add the preset's offers that are missing and fill prices that are
 * still unset (0). Offers the DM edited keep their prices and settings.
 */
export function applyPreset(p: ServiceProvider, preset: ServicePreset): ServiceProvider {
  const offers = p.offers.map((o) => {
    const fill = presetOffers(p.kind, preset, p.specialty).find((x) => x.key === o.key);
    return fill && o.priceCopper === 0 && fill.priceCopper > 0 ? { ...o, priceCopper: fill.priceCopper } : o;
  });
  for (const o of presetOffers(p.kind, preset, p.specialty))
    if (!offers.some((x) => x.key === o.key)) offers.push(o);
  return { ...p, preset, offers };
}

export function newProvider(
  kind: ServiceKind,
  shop: { id: string; name: string },
  npcId: string,
  id: string,
  preset: ServicePreset = "srd-5.2.1",
  specialty?: string,
): ServiceProvider {
  return applyPreset(
    { id, kind, preset, ...(specialty ? { specialty } : {}), shopId: shop.id, npcId, name: shop.name, description: "", offers: [] },
    preset,
  );
}
