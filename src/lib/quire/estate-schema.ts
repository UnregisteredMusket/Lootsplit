import { z } from "zod";
import type { Holding, StockLine } from "./types.ts";

const id = z.string().min(1).max(150);
export const estateKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/);
const name = z.string().trim().min(1).max(160);
const money = z.number().int().min(0).max(1e12);
const quantity = z.number().int().min(1).max(1e9);
const period = z.number().int().min(1).max(3650);
export const estateCapabilities = [
  "storage",
  "rental",
  "construction-site",
  "trade",
  "crafting",
  "lodging",
  "farming",
  "extraction",
  "stabling",
  "postal",
  "research",
  "training",
  "healing",
  "administration",
  "defense",
  "transport",
] as const;
export const materialSchema = z.object({ key: estateKey, name, unit: name }).strict();
const materialUse = z.object({ materialKey: estateKey, quantity }).strict();
const stageSchema = z
  .object({
    name,
    laborDays: quantity,
    laborCostCopper: money,
    materials: z.array(materialUse).max(100),
    requirement: z.string().max(1000).default(""),
  })
  .strict();
export const recipeSchema = z
  .object({
    key: estateKey,
    name,
    resultTemplateKey: estateKey.optional(),
    resultCondition: z.enum(["ready", "maintained", "repairs", "ruin"]).optional(),
    laborDays: quantity,
    laborCostCopper: money,
    materials: z.array(materialUse).max(100),
    stages: z.array(stageSchema).min(1).max(20).optional(),
    requirement: z.string().max(1000).optional(),
    output: z
      .object({
        name,
        quantity,
        unitCopper: money,
        weight: z.number().min(0).max(9999),
        materialKey: estateKey.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const estateTemplateSchema = z
  .object({
    key: estateKey,
    name,
    propertyType: z.enum([
      "residence",
      "inn",
      "keep",
      "tower",
      "homestead",
      "workshop",
      "land",
      "other",
    ]),
    capabilities: z.array(z.enum(estateCapabilities)).max(16),
    storage: z
      .object({
        defaultAccess: z.enum(["party-members", "owner"]),
        capacityWeight: z.number().finite().min(0).max(1e12).nullable(),
      })
      .strict()
      .optional(),
    rental: z
      .object({ incomeCopper: money, upkeepCopper: money, periodDays: period })
      .strict()
      .optional(),
    staff: z
      .array(
        z
          .object({
            role: name,
            minimum: z.number().int().min(0).max(1000),
            wageCopper: money,
            periodDays: period,
            purpose: z.enum(["operation", "automation"]),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    recipes: z.array(recipeSchema).max(100).optional(),
  })
  .strict();
export type EstateTemplate = z.infer<typeof estateTemplateSchema>;
export const siteSchema = z
  .object({
    propertyId: id,
    templateKey: estateKey,
    enabled: z.boolean(),
    access: z.enum(["party-members", "owner", "selected"]),
    accessPurseIds: z.array(id).max(100),
    withdrawalApproval: z.boolean().optional(),
    capacityWeight: z.number().finite().min(0).max(1e12).nullable(),
    completedTemplates: z.array(estateKey).max(100),
    notes: z.string().max(4000),
  })
  .strict();
export const jobSchema = z
  .object({
    id,
    propertyId: id,
    purseId: id,
    name,
    recipeKey: estateKey,
    recipe: recipeSchema,
    status: z.enum(["draft", "active", "paused", "blocked", "completed", "cancelled", "denied"]),
    stage: z.number().int().min(0).max(20),
    progress: z.number().int().min(0).max(1e11),
    paidProgress: z.number().int().min(0).max(1e11).default(0),
    paidCopper: money,
    assignments: z
      .array(z.object({ purseId: id, share: z.number().int().min(1).max(100) }).strict())
      .max(100),
    paidWorkers: z.number().int().min(0).max(100),
    approvedChecks: z.boolean(),
    checkNotes: z.string().max(2000),
    message: z.string().max(1000),
    requestedBy: id,
    createdDay: z.number().int().nonnegative(),
    completedDay: z.number().int().nonnegative().optional(),
  })
  .strict();
export const staffSchema = z
  .object({
    id,
    propertyId: id,
    name,
    role: name,
    npcId: id.optional(),
    wageCopper: money,
    periodDays: period,
    status: z.enum(["proposed", "active", "paused", "dismissed", "denied"]),
    manager: z.boolean(),
    duties: z
      .array(z.enum(["deliveries", "projects", "rent", "supplies", "staff", "reports"]))
      .max(6),
    budgetCopper: money,
    budgetPeriodDays: period,
    budgetStartDay: z.number().int().nonnegative(),
    budgetSpentCopper: money,
    notes: z.string().max(2000),
  })
  .strict();
export const rentalSchema = z
  .object({
    propertyId: id,
    tenant: z.string().max(160),
    occupied: z.boolean(),
    active: z.boolean(),
    incomeCopper: money,
    upkeepCopper: money,
    periodDays: period,
    notes: z.string().max(2000),
  })
  .strict();
export const orderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), text: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("report") }).strict(),
  z.object({ kind: z.literal("project"), jobId: id, active: z.boolean() }).strict(),
  z.object({ kind: z.literal("rent"), active: z.boolean() }).strict(),
  z.object({ kind: z.literal("staff"), staffId: id, active: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal("supply"),
      stockId: id,
      quantity: quantity.max(100000),
      materialKey: estateKey,
      deliveryDays: z.number().int().min(0).max(3650),
      deliveryCopper: money,
    })
    .strict(),
]);
export const letterSchema = z
  .object({
    id,
    propertyId: id,
    senderId: id,
    ownerId: id,
    managerId: id,
    originId: id,
    sentDay: z.number().int().nonnegative(),
    dueDay: z.number().int().nonnegative(),
    feeCopper: money,
    budgetCopper: money,
    order: orderSchema,
    status: z.enum(["in-transit", "delivered", "blocked", "cancelled"]),
    receipt: z.string().max(2000),
  })
  .strict();
export const shipmentSchema = z
  .object({
    id,
    propertyId: id,
    ownerId: id,
    holdingId: id,
    sentDay: z.number().int().nonnegative(),
    dueDay: z.number().int().nonnegative(),
    status: z.enum(["in-transit", "delivered", "blocked", "cancelled"]),
    message: z.string().max(1000),
  })
  .strict();
export const standingOrderSchema = z
  .object({
    id,
    propertyId: id,
    managerId: id,
    order: orderSchema,
    budgetCopper: money,
    periodDays: period,
    nextDay: z.number().int().nonnegative(),
    active: z.boolean(),
    receipt: z.string().max(2000),
  })
  .strict();
export const supplierSchema = z
  .object({
    id,
    propertyId: id,
    stockId: id,
    materialKey: estateKey,
    deliveryDays: z.number().int().min(0).max(3650),
    deliveryCopper: money,
    weight: z.number().min(0).max(9999),
  })
  .strict();
export const postalSchema = z
  .object({
    feeCopper: money,
    deliveryDays: z.number().int().min(0).max(3650),
    offices: z.array(z.object({ shopId: id, allowTown: z.boolean() }).strict()).max(500),
  })
  .strict();
export const estateSchema = z
  .object({
    templates: z.array(estateTemplateSchema).max(500).default([]),
    materials: z.array(materialSchema).max(500).default([]),
    sites: z.array(siteSchema).max(1000).default([]),
    withdrawals: z
      .array(
        z
          .object({
            id,
            propertyId: id,
            holdingId: id,
            purseId: id,
            requestedBy: id,
            quantity: quantity.max(100000),
            itemBefore: z.string().max(50000),
            status: z.enum(["pending", "approved", "fulfilled", "denied", "cancelled"]),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .max(2000)
      .default([]),
    jobs: z.array(jobSchema).max(1000).default([]),
    staff: z.array(staffSchema).max(1000).default([]),
    rentals: z.array(rentalSchema).max(1000).default([]),
    letters: z.array(letterSchema).max(2000).default([]),
    shipments: z.array(shipmentSchema).max(2000).default([]),
    standingOrders: z.array(standingOrderSchema).max(500).default([]),
    suppliers: z.array(supplierSchema).max(1000).default([]),
    postal: postalSchema.default({ feeCopper: 0, deliveryDays: 2, offices: [] }),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const [key, rows] of Object.entries(s)) {
      if (!Array.isArray(rows)) continue;
      const ids = rows.map((r: any) => r.id ?? r.key ?? r.propertyId);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: `Duplicate property operation identities in ${key}.`,
        });
    }
  });
export type Estate = z.infer<typeof estateSchema>;
export type EstateSite = z.infer<typeof siteSchema>;
export type EstateJob = z.infer<typeof jobSchema>;
export type EstateOrder = z.infer<typeof orderSchema>;
export function readEstate(value?: unknown): Estate {
  return estateSchema.parse(value ?? {});
}
export const custodySchema = z
  .object({ kind: z.enum(["property", "transit"]), propertyId: id, shipmentId: id.optional() })
  .strict();
export type zCustody = z.infer<typeof custodySchema>;
export const estateQuoteSchema = z.object({
  before: z.string(),
  state: estateSchema,
  holdings: z.array(
    z.custom<Holding>(
      (value) =>
        !!value &&
        typeof value === "object" &&
        typeof (value as Holding).id === "string" &&
        typeof (value as Holding).purseId === "string" &&
        Number.isSafeInteger((value as Holding).quantity),
    ),
  ),
  stock: z.array(
    z.custom<StockLine>(
      (value) =>
        !!value &&
        typeof value === "object" &&
        typeof (value as StockLine).id === "string" &&
        typeof (value as StockLine).shopId === "string",
    ),
  ),
  movements: z.array(
    z.object({
      id,
      purseId: id,
      copper: money,
      summary: z.string().max(500),
      shopId: id.optional(),
    }),
  ),
  notices: z.array(z.object({ propertyId: id, summary: z.string().max(1000) })),
});
export const estateCommands = [
  z.object({
    id,
    kind: z.literal("estate-template"),
    before: estateTemplateSchema.nullable(),
    template: estateTemplateSchema,
    materials: z.array(materialSchema).max(500),
  }),
  z.object({ id, kind: z.literal("estate-site"), before: siteSchema.nullable(), site: siteSchema }),
  z.object({
    id,
    kind: z.literal("estate-storage"),
    propertyId: id,
    holdingId: id,
    quantity: quantity.max(100000),
    direction: z.enum(["deposit", "withdraw"]),
    purseId: id,
    override: z.boolean().default(false),
    donate: z.boolean().optional(),
    approvalId: id.optional(),
  }),
  z.object({
    id,
    kind: z.literal("estate-withdrawal-review"),
    requestId: id,
    before: z.string(),
    status: z.enum(["approved", "denied", "cancelled"]),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    id,
    kind: z.literal("estate-material"),
    holdingId: id,
    materialKey: estateKey,
    weight: z.number().min(0).max(9999),
  }),
  z.object({ id, kind: z.literal("estate-job"), before: jobSchema.nullable(), job: jobSchema }),
  z.object({
    id,
    kind: z.literal("estate-job-resolution"),
    jobId: id,
    before: jobSchema,
    action: z.enum(["complete", "adjust"]),
    stage: z.number().int().min(0).max(19),
    progress: z.number().int().min(0).max(1e11),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    id,
    kind: z.literal("estate-staff"),
    before: staffSchema.nullable(),
    staff: staffSchema,
  }),
  z.object({
    id,
    kind: z.literal("estate-rent"),
    before: rentalSchema.nullable(),
    rental: rentalSchema,
  }),
  z.object({ id, kind: z.literal("estate-postal"), before: postalSchema, postal: postalSchema }),
  z.object({
    id,
    kind: z.literal("estate-supplier"),
    before: supplierSchema.nullable(),
    supplier: supplierSchema,
  }),
  z.object({
    id,
    kind: z.literal("estate-letter"),
    propertyId: id,
    senderId: id,
    managerId: id,
    budgetCopper: money,
    order: orderSchema,
  }),
  z.object({ id, kind: z.literal("estate-letter-cancel"), letterId: id }),
  z.object({
    id,
    kind: z.literal("estate-order"),
    before: standingOrderSchema.nullable(),
    order: standingOrderSchema,
  }),
  z.object({
    id,
    kind: z.literal("estate-delivery"),
    propertyId: id,
    purseId: id,
    stockId: id,
    quantity: quantity.max(100000),
    materialKey: estateKey,
    deliveryDays: z.number().int().min(0).max(3650),
    deliveryCopper: money,
  }),
  z.object({
    id,
    kind: z.literal("estate-shipment"),
    shipmentId: id,
    action: z.enum(["retry", "return"]),
    override: z.boolean().default(false),
  }),
  z.object({
    id,
    kind: z.literal("estate-handover"),
    propertyId: id,
    toId: id,
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({ id, kind: z.literal("estate-arrears"), ruleId: id, copper: money.min(1) }),
] as const;
export type EstateCommand = z.infer<(typeof estateCommands)[number]>;
