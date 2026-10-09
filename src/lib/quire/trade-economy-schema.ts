import { z } from "zod";
import { goodsKey as estateKey } from "./goods-key.ts";

const id = z.string().min(1).max(150);
const name = z.string().trim().min(1).max(160);
const money = z.number().int().min(0).max(1e12);
const units = z.number().int().min(0).max(1e9);
export const tradeSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mode: z.enum(["classic", "automatic"]).default("classic"),
    volatility: z.number().int().min(0).max(100).default(20),
    hardshipChance: z.number().int().min(0).max(100).default(20),
    hardshipTypes: z
      .array(z.enum(["shortage", "roads", "war", "plague"]))
      .max(4)
      .default(["shortage", "roads"]),
    minMultiplier: z.number().min(0.05).max(10).default(0.25),
    maxMultiplier: z.number().min(0.05).max(10).default(4),
    bidRateBps: z.number().int().min(0).max(10000).default(6000),
    feedback: z.number().int().min(0).max(100).default(25),
  })
  .strict()
  .refine(
    (x) => x.minMultiplier <= x.maxMultiplier,
    "Minimum price must not exceed maximum price.",
  );
export const commoditySchema = z
  .object({
    id: estateKey,
    name,
    unit: name,
    description: z.string().max(4000).default(""),
    category: z.enum([
      "provisions",
      "smith",
      "cloth",
      "apothecary",
      "inn",
      "general",
      "curios",
      "stable",
      "scribe",
      "jewels",
    ]),
    baseCopper: money.min(1),
    weight: z.number().min(0).max(9999),
    materialKey: estateKey.optional(),
    active: z.boolean(),
  })
  .strict();
export const tradeOfferSchema = z
  .object({
    commodityId: estateKey,
    stock: units,
    targetStock: units,
    capacity: units,
    supply: z.number().int().min(1).max(1000),
    demand: z.number().int().min(1).max(1000),
    askCopper: money.min(1),
    bidCopper: money,
    lockPrice: z.boolean().default(false),
    lockStock: z.boolean().default(false),
    lockIndices: z.boolean().default(false),
  })
  .strict()
  .refine(
    (x) => x.stock <= x.capacity && x.targetStock <= x.capacity && x.bidCopper <= x.askCopper,
    "Stock must fit capacity and the buyback price must not exceed the selling price.",
  );
export const exchangeSchema = z
  .object({
    id,
    name,
    locationId: id.nullable(),
    purseId: id,
    open: z.boolean(),
    visible: z.boolean(),
    notes: z.string().max(4000).default(""),
    offers: z.array(tradeOfferSchema).max(500),
  })
  .strict();
const realmSchema = z
  .object({
    inflation: z.number().min(0.5).max(2.5),
    scarcity: z.number().min(0).max(2),
    gpDollars: z.number().min(25).max(2000),
    season: z.number().int().min(0).max(4),
    shortage: z.number().min(0).max(2),
    war: z.number().min(0).max(2),
    plague: z.number().min(0).max(2),
    roads: z.number().min(0).max(2),
  })
  .strict();
export const tradeDrawSchema = z
  .object({
    epoch: z.number().int().min(1),
    key: z.string().min(1).max(400),
    roll: z.number().int().min(1).max(100),
    source: z.enum(["server", "local"]),
  })
  .strict();
export const tradeReceiptSchema = z
  .object({
    id: z.string().min(1).max(300),
    at: z.number().int().nonnegative(),
    epoch: z.number().int().nonnegative(),
    exchangeId: id,
    commodityId: estateKey,
    name,
    unit: name,
    purseId: id,
    direction: z.enum(["buy", "sell"]),
    quantity: units.min(1),
    copper: money,
    origin: z.enum(["exchange", "shop", "manager"]),
    propertyId: id.optional(),
  })
  .strict();
export const tradeSeasonQuoteSchema = z
  .object({
    id,
    before: z.string(),
    fromEpoch: z.number().int().nonnegative(),
    season: z.number().int().min(0).max(4),
    mode: z.enum(["classic", "automatic"]),
    realm: realmSchema,
    exchanges: z.array(exchangeSchema).max(100),
    draws: z.array(tradeDrawSchema),
    hardship: z.string().max(1000),
    feedback: z.array(
      z.object({ exchangeId: id, commodityId: estateKey, bought: units, sold: units }),
    ),
  })
  .strict();
export const tradeEconomySchema = z
  .object({
    settings: tradeSettingsSchema.default(() => tradeSettingsSchema.parse({})),
    epoch: z.number().int().nonnegative().default(0),
    commodities: z.array(commoditySchema).max(500).default([]),
    exchanges: z.array(exchangeSchema).max(100).default([]),
    receipts: z.array(tradeReceiptSchema).default([]),
    draws: z.array(tradeDrawSchema).default([]),
    pendingSeason: tradeSeasonQuoteSchema.optional(),
    history: z
      .array(
        z
          .object({
            id,
            at: z.number().int().nonnegative(),
            day: z.number().int().nonnegative(),
            quote: tradeSeasonQuoteSchema,
            appliedExchanges: z.array(exchangeSchema),
            realm: realmSchema,
            reason: z.string().max(2000),
            source: z.enum(["downtime", "manual"]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type TradeEconomy = z.infer<typeof tradeEconomySchema>;
export type Commodity = z.infer<typeof commoditySchema>;
export type Exchange = z.infer<typeof exchangeSchema>;
export type TradeOffer = z.infer<typeof tradeOfferSchema>;
export type TradeSeasonQuote = z.infer<typeof tradeSeasonQuoteSchema>;
export type TradeExecution = { random?: (key: string) => number; source?: "server" | "local" };
export const readTradeEconomy = (raw?: unknown): TradeEconomy =>
  tradeEconomySchema.parse(raw ?? {});
const reason = z.string().trim().min(1).max(2000);
export const tradeCommands = [
  z
    .object({
      id,
      kind: z.literal("trade-settings"),
      before: tradeSettingsSchema,
      settings: tradeSettingsSchema,
      reason,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-commodity"),
      before: commoditySchema.nullable(),
      commodity: commoditySchema,
      reason,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-exchange"),
      before: exchangeSchema.nullable(),
      exchange: exchangeSchema,
      treasury: z.object({ name, copper: money }).strict().optional(),
      reason,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-funding"),
      exchangeId: id,
      beforeCopper: money,
      copper: money,
      reason,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-bind"),
      holdingId: id,
      before: estateKey.nullable(),
      commodityId: estateKey,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-stock-link"),
      stockId: id,
      before: z.string(),
      exchangeId: id.nullable(),
      commodityId: estateKey.nullable(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-buy"),
      exchangeId: id,
      commodityId: estateKey,
      purseId: id,
      quantity: units.min(1).max(100000),
      before: z.string(),
      propertyId: id.optional(),
      overrideLocation: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-sell"),
      exchangeId: id,
      commodityId: estateKey,
      holdingId: id,
      quantity: units.min(1).max(100000),
      before: z.string(),
      overrideLocation: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("trade-season-plan"),
      before: z.string(),
      season: z.number().int().min(0).max(4).optional(),
    })
    .strict(),
  z.object({ id, kind: z.literal("trade-season-cancel"), previewId: id }).strict(),
  z
    .object({
      id,
      kind: z.literal("trade-season-approve"),
      previewId: id,
      reason,
      exchanges: z.array(exchangeSchema).max(100).optional(),
      realm: realmSchema.optional(),
    })
    .strict(),
] as const;
export type TradeCommand = z.infer<(typeof tradeCommands)[number]>;
