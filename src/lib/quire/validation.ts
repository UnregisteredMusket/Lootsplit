import { z } from "zod";
import { sheetSchema, inventoryFields } from "../characters/model.mjs";
const id = z.string().min(1);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const coinsSchema = z.object({ cp: amount, sp: amount, ep: amount, gp: amount, pp: amount });
export const artworkSchema = z
  .string()
  .max(500000)
  .regex(/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|\/art\/[a-z0-9-]+\.webp)$/);
const purse = z.object({
  sheet: sheetSchema.optional(),
  sheetRevision: z.number().int().nonnegative().optional(),
  editingAllowed: z.boolean().optional(),
  editBaseline: sheetSchema.optional(),
  profileId: z.string().max(150).optional(),
  sheetReadOnlyForDm: z.boolean().optional(),
  id,
  name: z.string(),
  kind: z.enum(["party", "character"]),
  portrait: artworkSchema.optional(),
  coins: coinsSchema,
  control: z.enum(["player", "npc"]).optional(),
});
export const holdingSchema = z.object({
  ...inventoryFields,
  service: z.boolean().optional(),
  purseId: id,
  image: artworkSchema.optional(),
  category: z.string().max(80).optional(),
  weight: z.number().min(0).max(9999).optional(),
  equipped: z.boolean().optional(),
});

const shop = z.object({
  acceptedCategories: z.array(z.string().max(80)).max(20).optional(),
  acceptAnyCategory: z.boolean().optional(),
  id,
  closed: z.boolean().optional(),
  image: artworkSchema.optional(),
  name: z.string(),
  keeper: z.string(),
  place: z.string(),
  notes: z.string(),
  sellRate: z.number().finite().nonnegative(),
  buyRate: z.number().finite().nonnegative(),
});
const stock = z.object({
  service: z.boolean().optional(),
  category: z.string().max(80).optional(),
  id,
  shopId: id,
  name: z.string(),
  copper: amount,
  quantity: amount.nullable(),
  notes: z.string(),
});
const ledger = z.object({
  transactionType: z
    .enum(["transfer", "purchase", "sale", "loan", "payment", "adjustment", "void"])
    .optional(),
  id,
  purseId: id,
  shopId: z.string().nullable(),
  summary: z.string(),
  copper: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  at: z.number().finite(),
});
export function validateEconomyRows(value: {
  purses: unknown;
  holdings: unknown;
  shops: unknown;
  stock: unknown;
  ledger: unknown;
}): void {
  const schemas = { purses: purse, holdings: holdingSchema, shops: shop, stock, ledger };
  for (const key of Object.keys(schemas) as (keyof typeof schemas)[]) {
    const rows = value[key];
    if (!z.array(schemas[key]).safeParse(rows).success)
      throw new Error(
        `The ${key} contain invalid or missing data. The current campaign was not changed.`,
      );
    const ids = (rows as { id: string }[]).map((row) => row.id);
    if (new Set(ids).size !== ids.length)
      throw new Error(`The ${key} contain duplicate IDs. The current campaign was not changed.`);
  }
}
