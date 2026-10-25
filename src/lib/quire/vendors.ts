import type { Shop } from "./types.ts";
import type { CloudTable } from "./cloud.ts";
import { shopAvailableHere } from "./shop-locations.ts";
import { groupMarket, groupRefs, groupTravelling } from "./party-groups.ts";
/**
 * The shop is open to buyers at the place of one of `groups` (split the party: pass the acting
 * character's group, see `actingGroups`). Without groups: any group's place, which is the
 * party's place when the party is whole.
 */
export function shopVisible(
  shop: Pick<Shop, "blackMarket" | "locationId">,
  table: Pick<CloudTable, "journal">,
  groups: string[] = groupRefs(table),
) {
  return (
    (!shop.blackMarket || table.journal?.world?.blackMarketActive === true) &&
    groups.some((g) => shopAvailableHere(shop, groupMarket(table, g), groupTravelling(table, g)))
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
