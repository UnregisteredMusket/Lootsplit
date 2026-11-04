import { knownUnitCopper, UNKNOWN_SALE } from "./item-identity.ts";
import type { Holding, Shop, StockLine } from "./types.ts";
export function isService(item: Pick<Holding, "notes"> & { service?: boolean }) {
  return item.service === true || /^service$/i.test(item.notes.trim());
}
export function assertMerchantSale(item: Holding, shop: Shop) {
  if (isService(item)) throw Error("Services cannot be resold.");
  // Item identification: an unidentified item sells at its presented value, so it needs one.
  if (knownUnitCopper(item) === null) throw Error(UNKNOWN_SALE);
  if (shop.acceptAnyCategory || shop.category === "mixed") return;
  const allowed = shop.acceptedCategories || [shop.category];
  if (!item.category || !allowed.includes(item.category))
    throw Error(
      "This merchant does not buy that item category. Ask the DM to configure an exception.",
    );
}
export function stockCategory(stock: StockLine, shop: Shop) {
  return stock.category || (shop.category === "mixed" ? "general" : shop.category);
}
