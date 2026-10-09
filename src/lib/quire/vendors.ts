import type { Shop } from "./types.ts";
import type { CloudTable } from "./cloud.ts";
import { readMarketLocations, shopAvailableHere } from "./shop-locations.ts";
export function shopVisible(
  shop: Pick<Shop, "blackMarket" | "locationId">,
  table: Pick<CloudTable, "journal">,
) {
  return (
    (!shop.blackMarket || table.journal?.world?.blackMarketActive === true) &&
    shopAvailableHere(shop, readMarketLocations(table.journal?.market))
  );
}
export function shopAsking(
  shop: Pick<Shop, "sellRate" | "blackMarket" | "blackMarketPremium">,
  copper: number,
) {
  const asking = Math.round(
    copper * shop.sellRate * (shop.blackMarket ? (shop.blackMarketPremium ?? 1.5) : 1),
  );
  if (!Number.isSafeInteger(asking) || asking < 0 || asking > 1e12)
    throw Error("The asking price exceeds the supported coin limit.");
  return asking;
}
