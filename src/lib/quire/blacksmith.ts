import type { CloudTable } from "./cloud.ts";
import { shopVisible } from "./vendors.ts";
import { actingGroups } from "./party-groups.ts";
import {
  assertContribution,
  money as serviceMoney,
  npcAtShop,
  presentAt,
  quoteFingerprint,
} from "./service-core.ts";
import {
  smithSkills,
  smithTermsSchema,
  type SmithProfile,
  type SmithDesign,
  type SmithOrder,
} from "./blacksmith-schema.ts";

type Table = Pick<CloudTable, "journal" | "purses" | "holdings" | "shops">;
function unique(keys: string[], label: string) {
  if (new Set(keys).size !== keys.length) throw Error(`Duplicate ${label}.`);
}
const money = (n: number) =>
  serviceMoney(n, "Smith price or value exceeds the supported copper range.");
/** Kept under its original name; the rule now lives in service-core (`presentAt`). */
export function smithHere(t: Table, locationId: string, purseId: string) {
  return presentAt(t, locationId, purseId);
}
export function smithEnchantments(p: SmithProfile) {
  return p.magicalForge
    ? p.enchantments.filter(
        (e) => e.approved && smithSkills.indexOf(e.minimumSkill) <= smithSkills.indexOf(p.skill),
      )
    : [];
}
export function smithAvailability(t: Table, p: SmithProfile, purseId: string) {
  const shop = t.shops.find((s) => s.id === p.shopId),
    npc = t.journal?.world?.npcs.find((n) => n.id === p.npcId);
  if (!shop || !shopVisible(shop, t, actingGroups(t, purseId)) || shop.closed)
    return "The smith's shop is closed or unavailable.";
  if (!npc?.blacksmithServices) return "The DM has not enabled this NPC's blacksmith services.";
  if (!npcAtShop(t, npc.id, shop.locationId))
    return "The smith is not available at this forge.";
  if (!smithHere(t, shop.locationId!, purseId))
    return "Visit the forge with the paying character and materials first.";
  return "";
}
export function smithQuote(t: Table, shopId: string, purseId: string, design: SmithDesign) {
  const profile = t.journal?.blacksmith?.profiles.find((p) => p.shopId === shopId);
  if (!profile) throw Error("The DM must configure this forge's services first.");
  const unavailable = smithAvailability(t, profile, purseId);
  if (unavailable) throw Error(unavailable);
  const item = profile.items.find((i) => i.key === design.itemKey);
  if (!item) throw Error("Choose a currently offered weapon or armor design.");
  unique(
    design.parts.map((p) => p.partKey),
    "chosen parts",
  );
  if (design.parts.length !== item.parts.length)
    throw Error("Choose every configured component exactly once.");
  const enchantment = design.enchantmentKey
    ? smithEnchantments(profile).find((e) => e.key === design.enchantmentKey)
    : undefined;
  if (design.enchantmentKey && !enchantment)
    throw Error("This enchantment needs a magical forge, sufficient skill and DM approval.");
  let suppliedValue = 0,
    materialValue = 0,
    partFees = 0,
    extraDays = 0;
  const description = [item.description],
    materials = [];
  for (const part of item.parts) {
    const choice = design.parts.find((p) => p.partKey === part.key),
      option = part.options.find((o) => o.key === choice?.optionKey);
    const material = profile.materials.find((m) => m.materialKey === choice?.materialKey);
    if (!choice || !option || !material || !part.materialKeys.includes(material.materialKey))
      throw Error(`Choose an offered style and material for ${part.name}.`);
    const valueCopper = money(material.unitCopper * material.rarityMultiplier * part.quantity);
    materialValue = money(materialValue + valueCopper);
    if (!choice.holdingId) suppliedValue = money(suppliedValue + valueCopper);
    else {
      assertContribution(t, choice.holdingId, purseId, {
        materialKey: material.materialKey,
        mismatch: "Contribute matching materials owned by the paying account.",
        equipped: "Unequip a material item before offering it to the smith.",
      });
    }
    materials.push({
      materialKey: material.materialKey,
      holdingId: choice.holdingId,
      quantity: part.quantity,
      name: material.name,
      unit: material.unit,
      rarity: material.rarity,
      valueCopper,
    });
    partFees = money(partFees + option.copper);
    extraDays += option.days;
    description.push(
      `${part.name}: ${option.name} in ${material.name} (${material.rarity}; ${part.quantity} ${material.unit}). ${option.description}`,
    );
  }
  for (const material of profile.materials) {
    const quantity = materials
      .filter((m) => m.materialKey === material.materialKey && !m.holdingId)
      .reduce((n, m) => n + m.quantity, 0);
    if (material.quantity !== null && quantity > material.quantity)
      throw Error(
        `The smith needs more ${material.name}. Offer your own inventory or choose another material.`,
      );
  }
  for (const holdingId of new Set(materials.flatMap((m) => (m.holdingId ? [m.holdingId] : [])))) {
    const quantity = materials
      .filter((m) => m.holdingId === holdingId)
      .reduce((n, m) => n + m.quantity, 0);
    if (quantity > t.holdings.find((h) => h.id === holdingId)!.quantity)
      throw Error("The offered inventory lot cannot supply all selected components.");
  }
  const engraving = design.engraving.trim();
  const labor = money(
    (item.laborCopper + partFees + (engraving ? profile.engravingCopper : 0)) *
      profile.priceMultiplier,
  );
  const costCopper = money(item.baseCopper + suppliedValue + labor + (enchantment?.copper ?? 0));
  const valueCopper = money(
    (item.baseCopper + materialValue + partFees) * profile.valueMultiplier +
      (enchantment?.valueCopper ?? 0),
  );
  const workDays = Math.max(
    1,
    Math.ceil(
      (item.laborDays +
        extraDays +
        (engraving ? profile.engravingDays : 0) +
        (enchantment?.days ?? 0)) *
        profile.timeMultiplier,
    ),
  );
  if (workDays > 3650)
    throw Error(
      "Commission duration exceeds 3650 campaign days. Review the smith's work settings.",
    );
  if (engraving) description.push(`Engraving: “${engraving}”.`);
  if (enchantment) description.push(`Enchantment: ${enchantment.name}. ${enchantment.description}`);
  const maker = t.journal!.world!.npcs.find((n) => n.id === profile.npcId)!;
  const shop = t.shops.find((s) => s.id === shopId)!;
  description.push(`Craftsmanship: ${profile.skill}. ${profile.quality}`);
  const terms = smithTermsSchema.parse({
    design,
    makerId: maker.id,
    makerName: maker.name,
    skill: profile.skill,
    quality: profile.quality,
    shopId,
    shopName: shop.name,
    locationId: shop.locationId!,
    costCopper,
    valueCopper,
    workDays,
    weight: item.weight,
    kind: item.kind,
    description: description.join("\n"),
    materials,
  });
  const f = t.journal?.finance ?? { day: 0, minuteOfDay: 0 };
  const before = quoteFingerprint({
    profile: { ...profile, enchantments: profile.enchantments.filter((e) => e.approved) },
    maker: { id: maker.id, name: maker.name, blacksmithServices: maker.blacksmithServices },
    terms,
    day: f.day,
    minute: f.minuteOfDay ?? 0,
    payer: t.purses.find((p) => p.id === purseId)?.coins,
    holdings: [...new Set(materials.flatMap((m) => (m.holdingId ? [m.holdingId] : [])))]
      .sort()
      .map((id) => t.holdings.find((h) => h.id === id)),
  });
  return {
    terms,
    before,
    laborCopper: labor,
    smithMaterialCopper: suppliedValue,
    contributedMaterialValue: materialValue - suppliedValue,
  };
}
export function smithDate(day: number, minute = 0) {
  return `campaign day ${day}, ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
export function smithDescription(o: SmithOrder) {
  return `${o.terms.description}\nMade by ${o.terms.makerName} at ${o.terms.shopName}.\nCommissioned ${smithDate(o.orderedDay, o.orderedMinute)}.\nCompleted ${smithDate(o.completedDay!, o.completedMinute)}.\nCommission record: ${o.id}.`;
}
export { previewSmith } from "./blacksmith-time.ts";
export { validateBlacksmith } from "./blacksmith-validation.ts";
