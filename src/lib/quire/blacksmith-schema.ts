import { z } from "zod";
import { goodsKey } from "./goods-key.ts";

const id = z.string().min(1).max(150);
const name = z.string().trim().min(1).max(160);
const copper = z.number().int().min(0).max(1e12);
const days = z.number().int().min(0).max(3650);
const multiplier = z.number().finite().min(0).max(1000);
export const smithSkills = ["apprentice", "journeyman", "expert", "master", "legendary"] as const;
export const materialRarities = ["common", "uncommon", "rare", "very rare", "legendary"] as const;
export const smithMaterialSchema = z
  .object({
    materialKey: goodsKey,
    name,
    unit: name,
    rarity: z.enum(materialRarities),
    unitCopper: copper,
    rarityMultiplier: multiplier,
    quantity: z.number().int().min(0).max(1e9).nullable(),
  })
  .strict();
export const smithPartSchema = z
  .object({
    key: goodsKey,
    name,
    quantity: z.number().int().min(1).max(100000),
    materialKeys: z.array(goodsKey).min(1).max(100),
    options: z
      .array(
        z
          .object({
            key: goodsKey,
            name,
            description: z.string().max(500),
            copper,
            days,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const smithItemSchema = z
  .object({
    key: goodsKey,
    name,
    kind: z.enum(["weapon", "armor"]),
    baseCopper: copper,
    laborCopper: copper,
    laborDays: days.min(1),
    weight: z.number().finite().min(0).max(9999),
    description: z.string().max(1500),
    parts: z.array(smithPartSchema).min(1).max(30),
  })
  .strict();
export const smithEnchantmentSchema = z
  .object({
    key: goodsKey,
    name,
    description: z.string().max(1500),
    minimumSkill: z.enum(smithSkills),
    approved: z.boolean(),
    copper,
    days,
    valueCopper: copper,
  })
  .strict();
export const smithProfileSchema = z
  .object({
    shopId: id,
    npcId: id,
    skill: z.enum(smithSkills),
    magicalForge: z.boolean(),
    priceMultiplier: multiplier,
    valueMultiplier: multiplier,
    timeMultiplier: multiplier.min(0.01),
    quality: z.string().trim().min(1).max(1000),
    engravingCopper: copper,
    engravingDays: days,
    materials: z.array(smithMaterialSchema).min(1).max(100),
    items: z.array(smithItemSchema).min(1).max(100),
    enchantments: z.array(smithEnchantmentSchema).max(100),
  })
  .strict();
export const smithDesignSchema = z
  .object({
    itemKey: goodsKey,
    name,
    engraving: z.string().max(500),
    enchantmentKey: goodsKey.nullable(),
    parts: z
      .array(
        z
          .object({
            partKey: goodsKey,
            optionKey: goodsKey,
            materialKey: goodsKey,
            holdingId: id.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export const smithTermsSchema = z
  .object({
    design: smithDesignSchema,
    makerId: id,
    makerName: name,
    skill: z.enum(smithSkills),
    quality: z.string().max(1000),
    shopId: id,
    shopName: name,
    locationId: id,
    costCopper: copper,
    valueCopper: copper,
    workDays: days.min(1),
    weight: z.number().min(0).max(9999),
    kind: z.enum(["weapon", "armor"]),
    description: z.string().max(24000),
    materials: z
      .array(
        z
          .object({
            materialKey: goodsKey,
            quantity: z.number().int().min(1).max(3000000),
            holdingId: id.nullable(),
            name,
            unit: name,
            rarity: z.enum(materialRarities),
            valueCopper: copper,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export const smithOrderSchema = z
  .object({
    id,
    purseId: id,
    terms: smithTermsSchema,
    orderedDay: z.number().int().nonnegative(),
    orderedMinute: z.number().int().min(0).max(1439),
    progressDays: days,
    status: z.enum(["active", "paused", "ready", "claimed", "cancelled"]),
    completedDay: z.number().int().nonnegative().optional(),
    completedMinute: z.number().int().min(0).max(1439).optional(),
    claimedDay: z.number().int().nonnegative().optional(),
    message: z.string().max(1000),
  })
  .strict();
export const blacksmithSchema = z
  .object({
    profiles: z.array(smithProfileSchema).max(500).default([]),
    orders: z.array(smithOrderSchema).max(5000).default([]),
  })
  .strict();
export type SmithProfile = z.infer<typeof smithProfileSchema>;
export type SmithDesign = z.infer<typeof smithDesignSchema>;
export type SmithOrder = z.infer<typeof smithOrderSchema>;
export type Blacksmith = z.infer<typeof blacksmithSchema>;
export const readBlacksmith = (value?: unknown) => blacksmithSchema.parse(value ?? {});
export const smithQuoteSchema = z
  .object({
    before: z.string(),
    state: blacksmithSchema,
    notices: z.array(z.object({ orderId: id, purseId: id, summary: z.string().max(1000) })),
  })
  .strict();
export const smithCommands = [
  z
    .object({
      id,
      kind: z.literal("smith-profile"),
      shopId: id,
      before: smithProfileSchema.nullable(),
      profile: smithProfileSchema.nullable(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("smith-order"),
      shopId: id,
      purseId: id,
      design: smithDesignSchema,
      before: z.string().max(6000000),
    })
    .strict(),
  z.object({ id, kind: z.literal("smith-claim"), orderId: id, before: smithOrderSchema }).strict(),
  z
    .object({
      id,
      kind: z.literal("smith-control"),
      orderId: id,
      before: smithOrderSchema,
      action: z.enum(["pause", "resume", "cancel"]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict(),
] as const;
export type SmithCommand = z.infer<(typeof smithCommands)[number]>;

/** Fictional, editable examples: no automatic combat modifiers or official rules. */
export function defaultSmith(shopId: string, npcId: string): SmithProfile {
  const options = [
    { key: "plain", name: "Plain", description: "A clean, practical finish", copper: 0, days: 0 },
    {
      key: "ornate",
      name: "Ornate",
      description: "Decorative hand-finished detailing",
      copper: 200,
      days: 1,
    },
  ];
  const part = (key: string, name: string, materialKeys: string[]) => ({
    key,
    name,
    quantity: 1,
    materialKeys,
    options,
  });
  return smithProfileSchema.parse({
    shopId,
    npcId,
    skill: "journeyman",
    magicalForge: false,
    priceMultiplier: 1,
    valueMultiplier: 1,
    timeMultiplier: 1,
    quality: "Sound, serviceable craftsmanship",
    engravingCopper: 100,
    engravingDays: 1,
    materials: [
      {
        materialKey: "steel",
        name: "Steel",
        unit: "piece",
        rarity: "common",
        unitCopper: 100,
        rarityMultiplier: 1,
        quantity: 20,
      },
      {
        materialKey: "wood",
        name: "Timber",
        unit: "piece",
        rarity: "common",
        unitCopper: 25,
        rarityMultiplier: 1,
        quantity: 20,
      },
      {
        materialKey: "leather",
        name: "Leather",
        unit: "piece",
        rarity: "common",
        unitCopper: 50,
        rarityMultiplier: 1,
        quantity: 20,
      },
    ],
    items: [
      {
        key: "sword",
        name: "Custom sword",
        kind: "weapon",
        baseCopper: 1000,
        laborCopper: 500,
        laborDays: 3,
        weight: 3,
        description: "A sword made to the commissioned design.",
        parts: [
          part("blade", "Blade", ["steel"]),
          part("handle", "Handle", ["wood", "leather"]),
          part("pommel", "Pommel", ["steel"]),
          part("hilt", "Hilt", ["steel"]),
          part("crossguard", "Crossguard", ["steel"]),
        ],
      },
      {
        key: "armor",
        name: "Custom armor",
        kind: "armor",
        baseCopper: 2000,
        laborCopper: 1000,
        laborDays: 5,
        weight: 20,
        description: "Armor fitted to the commissioned design.",
        parts: [
          part("plates", "Plates", ["steel"]),
          part("helmet", "Helmet", ["steel"]),
          part("gauntlets", "Gauntlets", ["steel"]),
          part("lining", "Lining", ["leather"]),
          part("straps", "Straps", ["leather"]),
          part("buckles", "Buckles", ["steel"]),
        ],
      },
    ],
    enchantments: [],
  });
}
