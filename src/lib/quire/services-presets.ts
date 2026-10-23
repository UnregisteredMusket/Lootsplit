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

/** The offers a preset brings for this kind. Blank brings none. */
export function presetOffers(kind: ServiceKind, preset: ServicePreset): ServiceOffer[] {
  if (preset === "blank") return [];
  if (kind === "temple") return templeSpells.map((s) => templeOffer(s, preset));
  return [];
}

/**
 * Apply a preset to a provider: add the preset's offers that are missing and fill prices that are
 * still unset (0). Offers the DM edited keep their prices and settings.
 */
export function applyPreset(p: ServiceProvider, preset: ServicePreset): ServiceProvider {
  const offers = p.offers.map((o) => {
    const fill = presetOffers(p.kind, preset).find((x) => x.key === o.key);
    return fill && o.priceCopper === 0 && fill.priceCopper > 0 ? { ...o, priceCopper: fill.priceCopper } : o;
  });
  for (const o of presetOffers(p.kind, preset))
    if (!offers.some((x) => x.key === o.key)) offers.push(o);
  return { ...p, preset, offers };
}

export function newProvider(
  kind: ServiceKind,
  shop: { id: string; name: string },
  npcId: string,
  id: string,
  preset: ServicePreset = "srd-5.2.1",
): ServiceProvider {
  return applyPreset(
    { id, kind, preset, shopId: shop.id, npcId, name: shop.name, description: "", offers: [] },
    preset,
  );
}
