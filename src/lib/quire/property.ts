import { z } from "zod";
import { artworkSchema } from "./artwork.ts";
import { readMarketLocations, locationPath, type MarketLocations } from "./shop-locations.ts";

export const PROPERTY_TYPES = {
  residence: "Residence",
  inn: "Inn & tavern",
  keep: "Keep & castle",
  tower: "Tower",
  homestead: "Homestead",
  workshop: "Workshop",
  land: "Land",
  other: "Other property",
} as const;
export const PROPERTY_CONDITIONS = {
  ready: "Ready to occupy",
  maintained: "Well maintained",
  repairs: "Needs repairs",
  ruin: "Ruined",
} as const;
export const propertyProfileSchema = z.object({
  type: z.enum(["residence", "inn", "keep", "tower", "homestead", "workshop", "land", "other"]),
  condition: z.enum(["ready", "maintained", "repairs", "ruin"]).optional(),
  rooms: z.number().int().min(0).max(10000).optional(),
  size: z.string().max(100).optional(),
  address: z.string().max(160).optional(),
  seller: z.string().max(160).optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  images: z.array(artworkSchema.max(100000)).max(3).optional(),
});
export type PropertyProfile = z.infer<typeof propertyProfileSchema>;
export const propertyFields = {
  locationId: z.string().min(1).max(150).optional(),
  property: propertyProfileSchema.optional(),
};
export const listingSchema = z
  .object({
    id: z.string().min(1).max(150),
    name: z.string().min(1),
    kind: z.enum(["item", "property"]),
    copper: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    quantity: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    notes: z.string(),
    ...propertyFields,
    estateTemplateKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/).optional(),
    estateAttachments: z.array(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/)).max(100).optional(),
    status: z.enum(["available", "reserved", "withdrawn"]).optional(),
  })
  .superRefine((listing, ctx) => {
    if (listing.kind !== "property" && (listing.locationId || listing.property || listing.status || listing.estateTemplateKey || listing.estateAttachments))
      ctx.addIssue({ code: "custom", message: "Property details belong to a property listing." });
  });
export type PropertyRecord = {
  kind: "item" | "property";
  locationId?: string;
  property?: PropertyProfile;
};

/** Listings use the same inheritance rules as shops; legacy unassigned records stay campaignwide. */
export function propertyAvailableHere(
  property: Pick<PropertyRecord, "locationId">,
  market: MarketLocations,
) {
  return (
    !market.currentLocationId ||
    !property.locationId ||
    locationPath(market, market.currentLocationId).some(
      (location) => location.id === property.locationId,
    )
  );
}
export function validatePropertyLocations(
  listings: PropertyRecord[],
  holdings: PropertyRecord[],
  value?: unknown,
) {
  const ids = new Set(readMarketLocations(value).locations.map((location) => location.id));
  for (const row of [...listings, ...holdings]) {
    if (row.property) propertyProfileSchema.parse(row.property);
    if (row.locationId && (row.kind !== "property" || !ids.has(row.locationId)))
      throw Error("A property refers to a missing location. The current campaign was not changed.");
  }
}
export function propertyStatus(listing: {
  quantity: number | null;
  status?: "available" | "reserved" | "withdrawn";
}) {
  return listing.quantity === 0
    ? "Sold out"
    : listing.status === "reserved"
      ? "Reserved"
      : listing.status === "withdrawn"
        ? "Withdrawn"
        : "For sale";
}
