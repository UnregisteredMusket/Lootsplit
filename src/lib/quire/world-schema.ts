import { z } from "zod";
import { serviceKinds } from "./services-schema.ts";
import { mapCombatBindingSchema } from "./map-combat-schema.ts";
import { connectedMapSchema } from "./connected-maps-schema.ts";
import { artworkSchema } from "./artwork.ts";
import { npcBarterConfigSchema, npcBarterStateSchema } from "./npc-barter-schema.ts";
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
    /** `alternating`: 5/10/5 — every second diagonal step costs two tiles (tabletop protocol 3+). */
    diagonal: z.enum(["equal", "euclidean", "orthogonal", "alternating"]).default("equal"),
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
/** Map distance units for a scale bar. */
export const mapScaleUnits = ["mi", "km", "ft"] as const;
/**
 * A two-point scale bar for an ungridded map (journey planner, tabletop protocol 6). `a` and `b`
 * are normalized points; `aspect` is the image's width ÷ height when it was calibrated, so
 * distances use the image's true proportions. A grid always wins when the map has one.
 */
export const mapScaleSchema = z
  .object({
    a: pointSchema,
    b: pointSchema,
    distance: z.number().finite().positive().max(1000000),
    unit: z.enum(mapScaleUnits),
    aspect: z.number().finite().min(0.01).max(100),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (Math.hypot((s.b.x - s.a.x) * s.aspect, s.b.y - s.a.y) < 0.001)
      ctx.addIssue({ code: "custom", message: "Drag the scale handles apart." });
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
    /** Scale-bar calibration for ungridded maps (tabletop protocol 6). */
    scale: mapScaleSchema.optional(),
    tokens: z.array(mapTokenSchema).max(200).optional(),
    encounterId: id.optional(),
  })
  .strict();
export const npcSchema = z
  .object({
    blacksmithServices: z.boolean().optional(),
    /** Service kinds this NPC offers (docs/SERVICES.md); the forge keeps `blacksmithServices`. */
    services: z.array(z.enum(serviceKinds)).max(serviceKinds.length).optional(),
    id,
    name,
    description: z.string().max(4000),
    locationId: id,
    visible: z.boolean(),
    barterAllowed: z.boolean(),
    controllerPurseId: id.nullable(),
    portrait: artworkSchema.optional(),
    /** NPC barter answers (docs/NPC-BARTER.md). Missing follows the campaign rules. */
    barter: npcBarterConfigSchema.optional(),
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
/* ---- Party journeys and travel settings (journey planner phase B; journey-schema.ts) ---- */
const travelCopper = z.number().int().min(0).max(1_000_000);
const paceMilesPerDay = z.number().int().min(1).max(200);
export const journeyStatuses = [
  "proposed",
  "planned",
  "active",
  "stopped",
  "arrived",
  "completed",
  "cancelled",
  "denied",
] as const;
/** A journey that still holds the party's plans: at most one per campaign. */
export const OPEN_JOURNEY_STATUSES = ["proposed", "planned", "active", "arrived"] as const;
export const pacePresets = ["slow", "normal", "fast"] as const;

export const travelSettingsSchema = z
  .object({
    paces: z.object({ slow: paceMilesPerDay, normal: paceMilesPerDay, fast: paceMilesPerDay }).strict(),
    forcedMarch: z
      .object({ allowed: z.boolean(), maxExtraHours: z.number().int().min(0).max(8) })
      .strict(),
    /** Catalogue prices snapshotted when the DM saves travel settings (whole copper). */
    /** Absent in a player's projection (prices are DM-only); defaults apply. */
    rations: z.object({ name: z.string().trim().min(1).max(160), unitCopper: travelCopper }).strict().optional(),
    mounts: z.object({ name: z.string().trim().min(1).max(160), unitCopper: travelCopper }).strict().optional(),
  })
  .strict();
export type TravelSettings = z.infer<typeof travelSettingsSchema>;
/** Owner defaults (2026-10-23): 18/24/30 mi/day, forced march off, catalogue rations and oats. */
export const DEFAULT_TRAVEL: Required<TravelSettings> = {
  paces: { slow: 18, normal: 24, fast: 30 },
  forcedMarch: { allowed: false, maxExtraHours: 0 },
  rations: { name: "Day's trail rations", unitCopper: 5 },
  mounts: { name: "Nosebag of oats", unitCopper: 8 },
};
export function readTravel(value?: unknown): Required<TravelSettings> {
  const parsed = value ? travelSettingsSchema.parse(value) : {};
  return { ...structuredClone(DEFAULT_TRAVEL), ...parsed } as Required<TravelSettings>;
}

export const journeyPointSchema = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), locationId: id.optional() })
  .strict();
export const journeyLegSchema = z
  .object({
    environment: z.enum(travelEnvironments),
    biome: z.enum(wildernessBiomes).optional(),
    description: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((leg, ctx) => {
    if (leg.environment === "Wilderness" && !leg.biome)
      ctx.addIssue({ code: "custom", message: "Choose a wilderness biome for each wilderness leg." });
    if (leg.environment !== "Wilderness" && leg.biome)
      ctx.addIssue({ code: "custom", message: "Biomes apply to wilderness legs." });
  });
export const journeyFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grid"), grid: mapGridSchema }).strict(),
  z.object({ kind: z.literal("scale"), scale: mapScaleSchema }).strict(),
]);
export const journeySchema = z
  .object({
    id,
    status: z.enum(journeyStatuses),
    /** "dm", or the character purse that asked. */
    requestedBy: id,
    message: z.string().trim().max(500).optional(),
    reason: z.object({ text: z.string().trim().max(500), showToPlayer: z.boolean() }).strict().optional(),
    /** Absent only in a player's projection of a private map. */
    mapId: id.optional(),
    /** Normalized waypoints. Absent in a player's projection of a private or fogged map. */
    points: z.array(journeyPointSchema).min(2).max(100).optional(),
    /** Player projection of a fogged shared map: only the visible stretches of the route. */
    runs: z.array(z.array(journeyPointSchema.omit({ locationId: true })).min(2).max(2500)).max(200).optional(),
    legs: z.array(journeyLegSchema).min(1).max(99),
    originLocationId: id.nullable().optional(),
    destinationLocationId: id.nullable().optional(),
    pace: z.object({ preset: z.enum([...pacePresets, "custom"]), milesPerDay: paceMilesPerDay }).strict(),
    forcedMarchHours: z.number().int().min(0).max(8),
    costs: z
      .object({
        rations: z.boolean(),
        mounts: z.boolean(),
        payerId: id.nullable(),
        mountHoldingIds: z.array(id).max(50),
        /**
         * A stable's coach fare (services wave 2, tabletop protocol 9): charged once, with the
         * booking's `orderId-payment`, when the DM approves departure.
         */
        fare: z.object({ orderId: id, copper: z.number().int().min(0).max(1e12), payerId: id }).strict().optional(),
      })
      .strict(),
    /** Set when the journey is reviewed (downtime-plan); immutable once it is under way. */
    frozen: z
      .object({
        frame: journeyFrameSchema.optional(),
        fingerprint: z.string().max(5000).optional(),
        legDeciMiles: z.array(z.number().int().min(0).max(1e9)).max(99).optional(),
        durationMinutes: z.number().int().min(1).max(3650 * 1440),
        travellerIds: z.array(id).max(500),
        unitCopper: z.object({ rations: travelCopper, mounts: travelCopper }).strict().optional(),
      })
      .strict()
      .optional(),
    elapsedMinutes: z.number().int().min(0).max(3650 * 1440),
    downtimeIds: z.array(id).max(3650),
    createdAt: z.number(),
    decidedAt: z.number().optional(),
  })
  .strict()
  .superRefine((j, ctx) => {
    if (j.points && j.legs.length !== j.points.length - 1)
      ctx.addIssue({ code: "custom", message: "Each leg needs its terrain." });
    if (j.frozen?.legDeciMiles && j.frozen.legDeciMiles.length !== j.legs.length)
      ctx.addIssue({ code: "custom", message: "Frozen legs do not match the route." });
    if (j.frozen && j.elapsedMinutes > j.frozen.durationMinutes)
      ctx.addIssue({ code: "custom", message: "A journey cannot travel past its end." });
  });
export type Journey = z.infer<typeof journeySchema>;
export type JourneyPoint = z.infer<typeof journeyPointSchema>;
export type JourneyLeg = z.infer<typeof journeyLegSchema>;

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
    /** Party journeys, history kept (journey planner; tabletop protocol 7). */
    journeys: z.array(journeySchema).max(1000).optional(),
    /** DM travel settings (paces, forced march, cost prices); defaults when absent. */
    travel: travelSettingsSchema.optional(),
    npcs: z.array(npcSchema).max(500).default([]),
    trades: z.array(tradeSchema).default([]),
    conversations: z.array(conversationSchema).default([]),
    npcBarter: npcBarterStateSchema.optional(),
    blackMarketActive: z.boolean().default(false),
    /** DM setting: party players can read the coins of visible NPCs travelling with the party. Off when absent. */
    companionFundsVisible: z.boolean().optional(),
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
export type MapScale = z.infer<typeof mapScaleSchema>;
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
    kind: z.literal("companion-funds-visibility"),
    before: z.boolean(),
    visible: z.boolean(),
  }),
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
