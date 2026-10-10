import { z } from "zod";
import { artworkSchema } from "./artwork.ts";
const id = z.string().min(1).max(150),
  name = z.string().trim().min(1).max(160);
const copper = z.number().int().min(0).max(1e12);
export const characterPositionSchema = z
  .object({
    purseId: id,
    inParty: z.boolean(),
    locationId: id.nullable(),
    visible: z.boolean(),
    sheetVisible: z.boolean(),
    downtime: z
      .object({
        id,
        name: z.string().trim().min(1).max(200),
        startedMinute: z.number().int().nonnegative(),
        finishMinute: z.number().int().nonnegative(),
        returnInParty: z.boolean(),
        returnLocationId: id.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type CharacterPosition = z.infer<typeof characterPositionSchema>;
export const pointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .strict();
export const mapAnchorSchema = pointSchema.extend({ locationId: id }).strict();
export const mapMarkerSchema = pointSchema
  .extend({
    id,
    label: name,
    description: z.string().max(2000),
    visibility: z.enum(["party", "dm"]),
  })
  .strict();
export const campaignMapSchema = z
  .object({
    id,
    name,
    image: artworkSchema,
    locationId: id.nullable(),
    visible: z.boolean(),
    anchors: z.array(mapAnchorSchema).max(500),
    markers: z.array(mapMarkerSchema).max(500),
  })
  .strict();
export const npcSchema = z
  .object({
    id,
    name,
    description: z.string().max(4000),
    locationId: id,
    visible: z.boolean(),
    barterAllowed: z.boolean(),
    controllerPurseId: id.nullable(),
    portrait: artworkSchema.optional(),
  })
  .strict();
export const npcItemSchema = z
  .object({
    name,
    quantity: z.number().int().min(1).max(100000),
    unitCopper: copper,
    notes: z.string().max(4000),
    category: z.string().max(80).optional(),
    image: artworkSchema.optional(),
  })
  .strict();
export const npcImportSchema = z
  .object({
    format: z.literal("lootsplit.npcs"),
    schemaVersion: z.literal(1),
    npcs: z
      .array(
        z
          .object({
            name,
            description: z.string().max(4000),
            locationId: id,
            visible: z.boolean().default(true),
            barterAllowed: z.boolean().default(false),
            controllerPurseId: id.nullable().default(null),
            portrait: artworkSchema.optional(),
            copper: copper.default(0),
            inventory: z.array(npcItemSchema).max(500).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const offerSideSchema = z
  .object({
    purseId: id,
    copper,
    items: z
      .array(
        z
          .object({
            holdingId: id,
            quantity: z.number().int().min(1).max(100000),
            before: z.string().max(6000000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const tradeSchema = z
  .object({
    id,
    revision: z.number().int().nonnegative(),
    left: offerSideSchema,
    right: offerSideSchema,
    awaitingId: id,
    status: z.enum(["pending", "accepted", "declined", "cancelled"]),
    note: z.string().max(1000),
    at: z.number(),
    decidedAt: z.number().optional(),
  })
  .strict();
const conversationSchema = z
  .object({
    id,
    npcId: id,
    purseId: id,
    messages: z.array(
      z
        .object({
          id,
          author: z.enum(["character", "npc"]),
          text: z.string().trim().min(1).max(2000),
          at: z.number(),
        })
        .strict(),
    ),
  })
  .strict();
export const worldSchema = z
  .object({
    characterPositions: z.array(characterPositionSchema).max(10000).default([]),
    partyCharacters: z.array(z.object({ id, name }).strict()).max(10000).optional(),
    maps: z.array(campaignMapSchema).max(100).default([]),
    npcs: z.array(npcSchema).max(500).default([]),
    trades: z.array(tradeSchema).default([]),
    conversations: z.array(conversationSchema).default([]),
    blackMarketActive: z.boolean().default(false),
    timeHistory: z
      .array(
        z
          .object({
            id,
            sessionId: id,
            fromDay: z.number().int().nonnegative(),
            fromMinute: z.number().int().min(0).max(1439),
            hours: z.number().int().min(1).max(24),
            rest: z.enum(["none", "short", "long"]),
            purseIds: z.array(id),
            allowDowntime: z.boolean(),
            note: z.string().max(1000),
            at: z.number(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type World = z.infer<typeof worldSchema>;
export type CampaignMap = z.infer<typeof campaignMapSchema>;
export type Npc = z.infer<typeof npcSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export const readWorld = (value?: unknown): World => worldSchema.parse(value ?? {});
export const worldCommands = [
  z.object({
    id,
    kind: z.literal("character-position"),
    purseId: id,
    before: characterPositionSchema,
    inParty: z.boolean(),
    locationId: id.nullable(),
    visible: z.boolean(),
    sheetVisible: z.boolean(),
  }),
  z.object({
    id,
    kind: z.literal("character-downtime-start"),
    purseId: id,
    before: characterPositionSchema,
    name: z.string().trim().min(1).max(200),
    days: z.number().int().min(1).max(3650),
    locationId: id.nullable(),
  }),
  z.object({
    id,
    kind: z.literal("character-downtime-cancel"),
    purseId: id,
    before: characterPositionSchema,
  }),
  z.object({
    id,
    kind: z.literal("map-save"),
    before: campaignMapSchema.nullable(),
    map: campaignMapSchema.nullable(),
    mapId: id,
  }),
  z.object({
    id,
    kind: z.literal("map-marker"),
    mapId: id,
    markerId: id,
    before: mapMarkerSchema.nullable(),
    marker: mapMarkerSchema.nullable(),
  }),
  z.object({
    id,
    kind: z.literal("npc-create"),
    npc: npcSchema,
    copper,
    inventory: z.array(npcItemSchema).max(500),
  }),
  z.object({ id, kind: z.literal("npc-save"), before: npcSchema, npc: npcSchema }),
  z.object({ id, kind: z.literal("npc-import"), before: z.string(), document: npcImportSchema }),
  z.object({ id, kind: z.literal("npc-funds"), npcId: id, before: copper, copper }),
  z.object({ id, kind: z.literal("npc-item"), npcId: id, item: npcItemSchema }),
  z.object({
    id,
    kind: z.literal("npc-remove-item"),
    npcId: id,
    holdingId: id,
    before: z.string(),
  }),
  z.object({
    id,
    kind: z.literal("npc-message"),
    npcId: id,
    purseId: id,
    asNpc: z.boolean(),
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({
    id,
    kind: z.literal("trade-offer"),
    tradeId: id,
    revision: z.number().int().nonnegative().nullable(),
    actorId: id,
    left: offerSideSchema,
    right: offerSideSchema,
    note: z.string().max(1000),
  }),
  z.object({
    id,
    kind: z.literal("trade-decision"),
    tradeId: id,
    revision: z.number().int().nonnegative(),
    actorId: id,
    decision: z.enum(["accepted", "declined", "cancelled"]),
  }),
  z.object({ id, kind: z.literal("black-market"), before: z.boolean(), active: z.boolean() }),
  z.object({
    id,
    kind: z.literal("shop-black-market"),
    shopId: id,
    before: z.object({ hidden: z.boolean(), premium: z.number() }),
    hidden: z.boolean(),
    premium: z.number().min(1.01).max(100),
  }),
  z.object({
    id,
    kind: z.literal("session-time"),
    before: z.string(),
    hours: z.number().int().min(1).max(24),
    rest: z.enum(["none", "short", "long"]),
    purseIds: z.array(id).max(500),
    allowDowntime: z.boolean(),
    note: z.string().max(1000),
  }),
] as const;
export type WorldCommand = z.infer<(typeof worldCommands)[number]>;
