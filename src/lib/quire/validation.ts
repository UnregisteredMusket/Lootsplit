import { shopScheduleSchema } from "./shop-schedule.ts";
import { characterPermissionsSchema } from "../characters/permissions.mjs";
import { z } from "zod";
import { artworkSchema } from "./artwork.ts";
import { validateShopLocations, type MarketLocations } from "./shop-locations.ts";
export { artworkSchema } from "./artwork.ts";
import { sheetSchema, inventoryFields } from "../characters/model.mjs";
import { toCopper } from "./money.ts";
import { propertyFields, validatePropertyLocations, type PropertyRecord } from "./property.ts";
import { propertyDeedSchema } from "./property-deed.ts";
const id = z.string().min(1);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const coinsSchema = z
  .object({ cp: amount, sp: amount, ep: amount, gp: amount, pp: amount })
  .refine((coins) => Number.isSafeInteger(toCopper(coins)), {
    message: "The combined coin balance must be exactly representable in whole copper. Export the original save before repairing an oversized balance.",
  });
const purse = z.object({
  sheet: sheetSchema.optional(),
  sheetRevision: z.number().int().nonnegative().optional(),
  editingAllowed: z.boolean().optional(),
  permissions: characterPermissionsSchema.optional(),
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
  ...propertyFields,
  deed: propertyDeedSchema.optional(),
  service: z.boolean().optional(),
  purseId: id,
  image: artworkSchema.optional(),
  category: z.string().max(80).optional(),
  weight: z.number().min(0).max(9999).optional(),
  equipped: z.boolean().optional(),
});

const shop = z.object({
  locationId: z.string().min(1).max(150).optional(),
  schedule: shopScheduleSchema.optional(),
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
  reversalOf: id.optional(),
  purchase: z.object({ stockId: id, quantity: amount.positive(), holding: holdingSchema.nullable() }).optional(),
  listingPurchase: z.object({ listingId: id, quantity: amount.positive(), holding: holdingSchema }).optional(),
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
    if (key === "holdings" && (rows as import("./types.ts").Holding[]).some(holding => holding.deed && (holding.kind !== "property" || holding.deed.ownerId !== holding.purseId)))
      throw Error("A deed must belong to its property owner. The current campaign was not changed.");
  }
}


/** Validate every durable store before a replacement transaction is opened. */
export function validateBackupRows(value: Record<string, unknown>): void {
  const book = z.object({ id, title: z.string(), fileName: z.string(), pageCount: amount,
    articleCount: amount, importedAt: z.number().finite() });
  const article = z.object({ id, bookId: id, title: z.string(), text: z.string(),
    pageStart: amount, pageEnd: amount, favorite: z.boolean().optional() });
  const catalog = z.object({ id, name: z.string(), category: z.string(), rarity: z.string(),
    baseCopper: amount, notes: z.string(), origin: z.string(), service: z.boolean().optional() });
  const lexicon = z.object({ id, name: z.string(), kind: z.enum(["person", "place", "shop", "continent", "country", "region"]),
    bookId: z.string(), notes: z.string() });
  for (const [key, schema] of Object.entries({ books: book, articles: article, catalog, lexicon })) {
    if (value[key] === undefined && (key === "catalog" || key === "lexicon")) continue;
    if (!z.array(schema).safeParse(value[key]).success)
      throw Error(`The ${key} contain invalid or missing data. The current campaign was not changed.`);
    const ids = (value[key] as { id: string }[]).map(row => row.id);
    if (new Set(ids).size !== ids.length)
      throw Error(`The ${key} contain duplicate IDs. The current campaign was not changed.`);
  }
}

/** Live assets need owners; historical ledger and settled agreements may retain deleted IDs. */
export function validateBackupReferences(value: {
  purses: { id: string }[]; holdings: ({ id: string; purseId: string } & PropertyRecord)[];
  listings?: PropertyRecord[];
  shops: { id: string; locationId?: string }[]; stock: { shopId: string }[];
  books: { id: string }[]; articles: { bookId: string }[];
  sheets?: { purseId: string }[]; loans?: { purseId: string; status: string }[];
  journal?: { market?: MarketLocations; requests?: { purseId: string; status: string }[]; finance?: {
    loans: { purseId: string; lenderId: string; principal: number; interest: number }[];
    rules: { purseId: string; holdingId: string; active: boolean; arrears: number }[];
  } };
}): string[] {
  validateShopLocations(value.shops, value.journal?.market);
  validatePropertyLocations(value.listings ?? [], value.holdings, value.journal?.market);
  const diagnostics: string[] = [];
  const purses = new Set(value.purses.map(row => row.id)), shops = new Set(value.shops.map(row => row.id)),
    books = new Set(value.books.map(row => row.id)), holdings = new Set(value.holdings.map(row => row.id));
  const requireReference = (valid: boolean, label: string) => {
    if (!valid) throw Error(`The backup has a missing ${label} reference. The current campaign was not changed.`);
  };
  for (const row of value.holdings) requireReference(purses.has(row.purseId), "holding owner");
  for (const row of value.stock) requireReference(shops.has(row.shopId), "stock shop");
  for (const row of value.articles) requireReference(books.has(row.bookId), "article book");
  // removePurse deliberately keeps imported sheets and request history. They are not live assets.
  for (const row of value.sheets || []) if (!purses.has(row.purseId))
    diagnostics.push(`Retained imported character history for removed account ${row.purseId}.`);
  for (const row of [...(value.loans || []), ...(value.journal?.requests || [])])
    if (!purses.has(row.purseId))
      diagnostics.push(`Retained financial request history for removed account ${row.purseId}.`);
  for (const row of value.journal?.finance?.loans || []) if (row.principal + row.interest > 0) {
    requireReference(purses.has(row.purseId), "borrower");
    if (row.lenderId) requireReference(purses.has(row.lenderId), "lender");
  }
  for (const row of value.journal?.finance?.rules || []) if (row.active || row.arrears > 0) {
    requireReference(purses.has(row.purseId), "finance account");
    // A transferred property can deliberately leave an agreement paused for review.
    if (row.active && row.holdingId && !holdings.has(row.holdingId))
      diagnostics.push(`Retained finance agreement for missing inventory source ${row.holdingId}. Update or pause it before settlement.`);
  }
  return diagnostics;
}
