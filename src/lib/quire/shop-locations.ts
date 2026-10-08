import { z } from "zod";
import { artworkSchema } from "./artwork.ts";
import type { Shop } from "./types.ts";

const id = z.string().min(1).max(150);
export const marketLocationSchema = z.object({
  id,
  kind: z.enum(["region", "city", "town", "area"]),
  parentId: id.nullable(),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  image: artworkSchema.optional(),
});
export type MarketLocation = z.infer<typeof marketLocationSchema>;
export const marketLocationsSchema = z
  .object({
    locations: z.array(marketLocationSchema),
    currentLocationId: id.nullable(),
  })
  .superRefine((market, ctx) => {
    const locations = new Map(market.locations.map((location) => [location.id, location]));
    if (locations.size !== market.locations.length)
      ctx.addIssue({ code: "custom", message: "Location IDs must be unique." });
    for (const location of market.locations) {
      const parent = location.parentId ? locations.get(location.parentId) : undefined;
      const valid =
        location.kind === "region"
          ? location.parentId === null
          : location.kind === "area"
            ? parent?.kind === "city" || parent?.kind === "town"
            : parent?.kind === "region";
      if (!valid)
        ctx.addIssue({
          code: "custom",
          message: "Choose a region for a city or town, and a city or town for an area.",
        });
    }
    if (market.currentLocationId && !locations.has(market.currentLocationId))
      ctx.addIssue({ code: "custom", message: "The party location no longer exists." });
  });
export type MarketLocations = z.infer<typeof marketLocationsSchema>;
export function readMarketLocations(value?: unknown): MarketLocations {
  return value === undefined
    ? { locations: [], currentLocationId: null }
    : marketLocationsSchema.parse(value);
}
export function locationPath(
  market: MarketLocations,
  locationId: string | null | undefined,
): MarketLocation[] {
  const byId = new Map(market.locations.map((location) => [location.id, location]));
  const path: MarketLocation[] = [],
    seen = new Set<string>();
  let location = locationId ? byId.get(locationId) : undefined;
  while (location && !seen.has(location.id)) {
    path.unshift(location);
    seen.add(location.id);
    location = location.parentId ? byId.get(location.parentId) : undefined;
  }
  return path;
}
export function locationLabel(market: MarketLocations, locationId: string | null | undefined) {
  return (
    locationPath(market, locationId)
      .map((location) => location.name)
      .join(" / ") || "Campaignwide"
  );
}
export function shopAvailableHere(
  shop: Pick<Shop, "locationId">,
  market: MarketLocations,
): boolean {
  if (!market.currentLocationId || !shop.locationId) return true;
  return locationPath(market, market.currentLocationId).some(
    (location) => location.id === shop.locationId,
  );
}
export function validateShopLocations(
  shops: Pick<Shop, "locationId">[],
  marketValue?: unknown,
): void {
  const market = readMarketLocations(marketValue);
  const ids = new Set(market.locations.map((location) => location.id));
  if (shops.some((shop) => shop.locationId && !ids.has(shop.locationId)))
    throw Error("A shop refers to a missing location. The current campaign was not changed.");
}
/** Public places follow the party's path; unrelated places stay with the DM. */
export function publicMarketLocations(market: MarketLocations): MarketLocations {
  return {
    currentLocationId: market.currentLocationId,
    locations: market.currentLocationId
      ? locationPath(market, market.currentLocationId)
      : market.locations,
  };
}
