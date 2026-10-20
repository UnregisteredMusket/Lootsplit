import { z } from "zod";
import { mapCombatBindingSchema } from "./map-combat-schema.ts";
import { connectedMapSchema } from "./connected-maps-schema.ts";
import { artworkSchema } from "./artwork.ts";
import { mapTabletopSchema, tabletopSessionSchema, tabletopCommands, tokenTabletopFields } from "./tabletop-schema.ts";
const id = z.string().min(1).max(150),
  name = z.string().trim().min(1).max(160);
const copper = z.number().int().min(0).max(1e12);
export const characterPositionSchema = z
  .object({
    purseId: id,
    shipId: id.optional(),
    shipReturnInParty: z.boolean().optional(),
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
export const mapTypes = [
  "regional",
  "city",
  "dungeon",
  "property",
  "wilderness",
  "battle",
  "ship",
  "other",
] as const;
export const travelEnvironments = [
  "Roads",
  "Wilderness",
  "River",
  "Sea",
  "Coast",
  "Underground",
  "Dungeon",
  "Settlement",
  "Other",
] as const;
export const wildernessBiomes = [
  "Forest",
  "Grassland",
  "Desert",
  "Mountains",
  "Hills",
  "Swamp",
  "Arctic",
  "Tundra",
  "Jungle",
  "Savanna",
  "Coastal",
  "Underdark",
] as const;
export const partyMapPositionSchema = z
  .object({
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    mapId: id.optional(),
    environment: z.enum(travelEnvironments),
    biome: z.enum(wildernessBiomes).optional(),
    description: z.string().trim().max(200),
  })
  .strict()
  .superRefine((p, ctx) => {
    const full = p.mapId !== undefined && p.x !== undefined && p.y !== undefined,
      redacted = p.mapId === undefined && p.x === undefined && p.y === undefined;
    if (!full && !redacted)
      ctx.addIssue({ code: "custom", message: "Party map coordinates must be complete." });
    if (p.environment === "Wilderness" && !p.biome)
      ctx.addIssue({ code: "custom", message: "Choose a wilderness biome." });
    if (p.environment !== "Wilderness" && p.biome)
      ctx.addIssue({ code: "custom", message: "Biomes apply to wilderness positions." });
  });
export const mapGridSchema = z
  .object({
    columns: z.number().int().min(1).max(200),
    rows: z.number().int().min(1).max(200),
    feetPerTile: z.number().finite().min(0.1).max(1000000).default(5),
    diagonal: z.enum(["equal", "euclidean", "orthogonal"]).default("equal"),
    x: z.number().min(0).max(1).default(0),
    y: z.number().min(0).max(1).default(0),
    width: z.number().min(0.01).max(1).default(1),
    height: z.number().min(0.01).max(1).default(1),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.x + g.width > 1.000000001 || g.y + g.height > 1.000000001)
      ctx.addIssue({ code: "custom", message: "Grid must fit inside the map image." });
  });
export const mapTokenSchema = z
  .object({
    ...tokenTabletopFields,
    id,
    label: name,
    kind: z.enum(["character", "ship", "creature", "other"]),
    entityId: id.optional(),
    encounterId: id.optional(),
    combatantId: id.optional(),
    column: z.number().int().min(0).max(199),
    row: z.number().int().min(0).max(199),
    visibility: z.enum(["party", "dm"]),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (["character", "ship"].includes(t.kind) && !t.entityId)
      ctx.addIssue({ code: "custom", message: "Choose an existing character or ship." });
    if (t.kind === "creature" && (!t.encounterId || !t.combatantId))
      ctx.addIssue({ code: "custom", message: "Choose an encounter combatant." });
  });
export const campaignMapSchema = z
  .object({
    connected: connectedMapSchema.optional(),
    tabletop: mapTabletopSchema.optional(),
    id,
    name,
    image: artworkSchema,
    locationId: id.nullable(),
    visible: z.boolean(),
    anchors: z.array(mapAnchorSchema).max(500),
    markers: z.array(mapMarkerSchema).max(500),
    type: z.enum(mapTypes).optional(),
    propertyId: id.optional(),
    grid: mapGridSchema.optional(),
    tokens: z.array(mapTokenSchema).max(200).optional(),
    encounterId: id.optional(),
  })
  .strict();
export const npcSchema = z
  .object({
    blacksmithServices: z.boolean().optional(),
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
    combat: mapCombatBindingSchema.optional(),
    tabletop: tabletopSessionSchema.optional(),
    characterPositions: z.array(characterPositionSchema).max(10000).default([]),
    partyCharacters: z.array(z.object({ id, name }).strict()).max(10000).optional(),
    maps: z.array(campaignMapSchema).max(100).default([]),
    partyPosition: partyMapPositionSchema.optional(),
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
export type MapGrid = z.infer<typeof mapGridSchema>;
export type MapToken = z.infer<typeof mapTokenSchema>;
export type PartyMapPosition = z.infer<typeof partyMapPositionSchema>;
export type Npc = z.infer<typeof npcSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export const readWorld = (value?: unknown): World => worldSchema.parse(value ?? {});
export const worldCommands = [
  ...tabletopCommands,
  z.object({ id, kind: z.literal("map-combat-transition"), before: mapCombatBindingSchema.nullable(), binding: mapCombatBindingSchema.nullable(), beforeSession: tabletopSessionSchema.nullable() }).strict(),
  z.object({
    id,
    kind: z.literal("party-map-position"),
    before: partyMapPositionSchema.nullable(),
    beforeLocationId: id.nullable(),
    position: partyMapPositionSchema.nullable(),
  }),
  z.object({
    id,
    kind: z.literal("map-token"),
    mapId: id,
    grid: mapGridSchema,
    tokenId: id,
    before: mapTokenSchema.nullable(),
    token: mapTokenSchema.nullable(),
  }),
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
    durationMinutes: z.number().int().min(15).max(3650 * 1440).optional(),
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
