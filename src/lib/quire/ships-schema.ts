import { z } from "zod";
import { mapGridSchema } from "./world-schema.ts";

const id = z.string().min(1).max(150),
  name = z.string().trim().min(1).max(160);
const copper = z.number().int().min(0).max(1e12),
  count = z.number().int().min(0).max(1e9);
export const shipComponentSchema = z
  .object({
    id,
    name,
    kind: z.enum(["hull", "helm", "movement", "weapon", "other"]),
    ac: count.max(100),
    hp: count,
    maxHp: count.min(1),
    threshold: count,
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.hp > c.maxHp)
      ctx.addIssue({ code: "custom", message: "Current HP cannot exceed maximum HP." });
  });
export const shipStatsSchema = z
  .object({
    vesselType: name,
    size: name,
    dimensions: z.string().max(160),
    lengthFeet: count.min(1),
    str: count.max(30),
    dex: count.max(30),
    con: count.max(30),
    speedFeet: count,
    milesPerDay: z.number().finite().min(0).max(10000),
    minimumCrew: count.max(1000),
    passengers: count.max(10000),
    cargoWeight: z.number().finite().min(0).max(1e12),
    components: z.array(shipComponentSchema).min(1).max(30),
    defenses: z.string().max(2000),
    actions: z.string().max(4000),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.components.filter((c) => c.kind === "hull").length !== 1 ||
      new Set(s.components.map((c) => c.id)).size !== s.components.length
    )
      ctx.addIssue({
        code: "custom",
        message: "A ship needs one hull and unique component identities.",
      });
  });
export const shipUpgradeSchema = z
  .object({
    key: id,
    name,
    laborDays: count.min(1).max(3650),
    laborCopper: copper,
    materials: z.array(z.object({ materialKey: id, quantity: count.min(1) }).strict()).max(100),
    cargoWeight: z.number().finite().min(0).max(1e12),
    speedFeet: count,
    milesPerDay: z.number().finite().min(0).max(10000),
    passengers: count.max(10000),
    hullHp: count,
    hullAc: count.max(100),
    component: shipComponentSchema.optional(),
  })
  .strict();
export const shipDefaultsSchema = z
  .object({
    stats: shipStatsSchema,
    sailingCopper: copper,
    dockedCopper: copper,
    storedCopper: copper,
    repairCopperPerHp: copper,
    repairHpPerDay: count.min(1),
    repairMaterials: z
      .array(z.object({ materialKey: id, quantity: count.min(1) }).strict())
      .max(100),
    upgrades: z.array(shipUpgradeSchema).max(100),
  })
  .strict();
export const vesselSchema = shipDefaultsSchema
  .extend({
    propertyId: id,
    mode: z.enum(["docked", "dry-storage", "shipyard", "sailing"]),
    facilityId: id.nullable(),
    installed: z.array(id).max(100),
    arrearsCopper: copper,
    expenseRemainder: count.max(1439),
    dmNotes: z.string().max(4000),
  })
  .strict();
export const shipyardDefaultsSchema = z
  .object({
    slots: count.min(1).max(1000),
    maxLengthFeet: count.min(1),
    maxDimensions: z.string().max(160),
    dockCopper: copper,
    dryCopper: copper,
    yardCopper: copper,
    repair: z.boolean(),
    upgrades: z.boolean(),
  })
  .strict();
export const facilitySchema = shipyardDefaultsSchema
  .extend({
    id,
    propertyId: id.nullable(),
    name,
    locationId: id,
    public: z.boolean(),
    accessPurseIds: z.array(id).max(100),
  })
  .strict();
export const voyageSchema = z
  .object({
    id,
    propertyId: id,
    originId: id,
    destinationId: id,
    destinationFacilityId: id.nullable(),
    durationMinutes: count.min(1).max(3650 * 1440),
    elapsedMinutes: count.max(3650 * 1440),
    budgetCopper: copper,
    spentCopper: copper,
    travelExpenseRemainder: count.max(1439).default(0),
    payerId: id,
    captainId: id.nullable(),
    crewPurseIds: z.array(id).max(1000),
    status: z.enum([
      "proposed",
      "active",
      "blocked",
      "arrived",
      "cancelled",
      "dm-overridden",
      "denied",
    ]),
    message: z.string().max(1000),
    requestedBy: id,
    routeVersion: z.literal(1),
    routeNotes: z.string().max(2000),
    mapRoute: z
      .object({
        mapId: id,
        grid: mapGridSchema,
        points: z
          .array(
            z
              .object({
                column: z.number().int().min(0).max(199),
                row: z.number().int().min(0).max(199),
              })
              .strict(),
          )
          .min(2)
          .max(100),
      })
      .strict()
      .superRefine((r, ctx) => {
        if (r.points.some((p) => p.column >= r.grid.columns || p.row >= r.grid.rows))
          ctx.addIssue({ code: "custom", message: "Ship route must fit inside its grid." });
      })
      .optional(),
  })
  .strict();
export const boardingRequestSchema = z
  .object({
    id,
    propertyId: id,
    purseId: id,
    action: z.enum(["board", "disembark"]),
    status: z.enum(["pending", "approved", "denied"]),
    requestedBy: id,
  })
  .strict();
export const shipWorkSchema = z
  .object({
    jobId: id,
    propertyId: id,
    facilityId: id,
    effect: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("repair"), componentId: id, hp: count.min(1) }).strict(),
      z.object({ kind: z.literal("upgrade"), upgrade: shipUpgradeSchema }).strict(),
    ]),
    recipeFingerprint: z.string(),
    applied: z.boolean(),
  })
  .strict();
export const fleetSchema = z
  .object({
    vessels: z.array(vesselSchema).max(1000).default([]),
    facilities: z.array(facilitySchema).max(1000).default([]),
    voyages: z.array(voyageSchema).default([]),
    boarding: z.array(boardingRequestSchema).default([]),
    aboard: z
      .array(z.object({ purseId: id, propertyId: id, returnInParty: z.boolean(), /** Split the party (protocol 10): the group to rejoin on landing. */ returnGroupId: id.optional() }).strict())
      .default([]),
    work: z.array(shipWorkSchema).default([]),
  })
  .strict()
  .superRefine((f, ctx) => {
    for (const [rows, key] of [
      [f.vessels, "propertyId"],
      [f.facilities, "id"],
      [f.voyages, "id"],
      [f.boarding, "id"],
      [f.aboard, "purseId"],
      [f.work, "jobId"],
    ] as const) {
      const ids = rows.map((r) => (r as unknown as Record<string, string>)[key]);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: "Duplicate fleet identities." });
    }
  });
export type Fleet = z.infer<typeof fleetSchema>;
export type Vessel = z.infer<typeof vesselSchema>;
export type ShipStats = z.infer<typeof shipStatsSchema>;
export type ShipFacility = z.infer<typeof facilitySchema>;
export type ShipVoyage = z.infer<typeof voyageSchema>;
export const readFleet = (value?: unknown) => fleetSchema.parse(value ?? {});
export const shipCommands = [
  z.object({ id, kind: z.literal("ship-name"), propertyId: id, before: z.string(), name }).strict(),
  z
    .object({
      id,
      kind: z.literal("ship-configure"),
      before: vesselSchema.nullable(),
      vessel: vesselSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-facility"),
      before: facilitySchema.nullable(),
      facility: facilitySchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-berth"),
      propertyId: id,
      before: z.string(),
      facilityId: id.nullable(),
      mode: z.enum(["docked", "dry-storage", "shipyard"]),
    })
    .strict(),
  z
    .object({
      id,
      /** Split the party (tabletop protocol 10): a whole group boards or lands together and stays in the party. */
      kind: z.literal("ship-board-group"),
      propertyId: id,
      groupId: id,
      action: z.enum(["board", "disembark"]),
      before: z.string(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-board"),
      propertyId: id,
      purseId: id,
      action: z.enum(["board", "disembark"]),
      before: z.string(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-board-review"),
      requestId: id,
      before: boardingRequestSchema,
      approve: z.boolean(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-voyage"),
      before: voyageSchema.nullable(),
      voyage: voyageSchema,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-damage"),
      propertyId: id,
      componentId: id,
      damage: count.min(1),
      before: z.string(),
      reason: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-teleport"),
      propertyId: id,
      destinationId: id,
      facilityId: id.nullable(),
      before: z.string(),
      reason: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-work"),
      propertyId: id,
      before: z.string(),
      payerId: id,
      componentId: id.optional(),
      hp: count.min(1).optional(),
      upgradeKey: id.optional(),
      assignments: z
        .array(z.object({ purseId: id, share: count.min(1).max(100) }).strict())
        .max(100),
      paidWorkers: count.max(100),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("ship-arrears"),
      propertyId: id,
      payerId: id,
      copper: copper.min(1),
    })
    .strict(),
] as const;
export type ShipCommand = z.infer<(typeof shipCommands)[number]>;

/** Editable demonstration values, not an official vehicle or economic rules preset. */
export const defaultShip = (): z.infer<typeof shipDefaultsSchema> => ({
  stats: {
    vesselType: "Custom sailing ship",
    size: "Gargantuan",
    dimensions: "DM-defined",
    lengthFeet: 60,
    str: 20,
    dex: 10,
    con: 20,
    speedFeet: 30,
    milesPerDay: 48,
    minimumCrew: 1,
    passengers: 10,
    cargoWeight: 10000,
    components: [
      { id: "hull", name: "Hull", kind: "hull", ac: 15, hp: 200, maxHp: 200, threshold: 10 },
      { id: "helm", name: "Helm", kind: "helm", ac: 15, hp: 50, maxHp: 50, threshold: 0 },
      { id: "sails", name: "Sails", kind: "movement", ac: 12, hp: 100, maxHp: 100, threshold: 0 },
    ],
    defenses: "DM-defined resistances and immunities",
    actions: "DM-defined actions and installed weapons",
  },
  sailingCopper: 0,
  dockedCopper: 0,
  storedCopper: 0,
  repairCopperPerHp: 10,
  repairHpPerDay: 20,
  repairMaterials: [],
  upgrades: [
    {
      key: "cargo-expansion",
      name: "Cargo expansion",
      laborDays: 3,
      laborCopper: 10000,
      materials: [],
      cargoWeight: 1000,
      speedFeet: 0,
      milesPerDay: 0,
      passengers: 0,
      hullHp: 0,
      hullAc: 0,
    },
  ],
});
