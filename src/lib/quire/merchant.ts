import { formatCopper } from "./money.ts";
import { forSale, UNKNOWN_SALE } from "./item-identity.ts";
import type { Holding, Shop, StockLine } from "./types.ts";
export function isService(item: Pick<Holding, "notes"> & { service?: boolean }) {
  return item.service === true || /^service$/i.test(item.notes.trim());
}

/** The largest merchant purse (10,000,000,000 gp), within the finance quote's money bound. */
export const MAX_MERCHANT_PURSE = 1e12;

/** The shop's buy list (`acceptedCategories`, or its own category) takes this item at its normal rate. */
export function onBuyList(item: Pick<Holding, "category" | "unidentified">, shop: Shop): boolean {
  if (shop.acceptAnyCategory || shop.category === "mixed") return true;
  // Item identification: an unidentified item is judged by its presented category.
  item = forSale(item);
  const allowed = shop.acceptedCategories || [shop.category];
  return !!item.category && allowed.includes(item.category);
}

/** "Buys anything else at X% of its normal buy rate" (merchant purses, 2026-11-04); 0 when unset. */
export function offListPercent(shop: Pick<Shop, "offListPercent">): number {
  const p = shop.offListPercent;
  return typeof p === "number" && Number.isInteger(p) && p > 0 && p <= 100 ? p : 0;
}

export function assertMerchantSale(item: Pick<Holding, "notes" | "category" | "unitCopper" | "unidentified"> & { service?: boolean }, shop: Shop) {
  if (isService(item)) throw Error("Services cannot be resold.");
  // Item identification: an unidentified item sells at its presented value, so it needs one, and
  // shops judge it by its presented category, so a refusal never reveals the true one.
  if (item.unidentified && item.unidentified.value === undefined) throw Error(UNKNOWN_SALE);
  item = forSale(item);
  if (onBuyList(item, shop) || offListPercent(shop) > 0) return;
  throw Error(
    "This merchant does not buy that item category. Ask the DM to configure an exception.",
  );
}

/** A finite merchant purse is set (unset means unlimited, the behaviour before merchant purses). */
export function hasMerchantPurse(shop: Shop): shop is Shop & { merchantPurse: number } {
  return typeof shop.merchantPurse === "number";
}

export function merchantName(shop: Pick<Shop, "keeper" | "name">): string {
  return shop.keeper.trim() || shop.name;
}

/**
 * Why the shop cannot pay `copper` from its purse, or null when it can. `reveal` names the
 * remaining amount (the DM, or players when the DM shows the shop's purse); otherwise the message
 * says only that the merchant can't afford it.
 */
export function merchantShortfall(shop: Shop, copper: number, reveal: boolean): string | null {
  if (!hasMerchantPurse(shop) || copper <= shop.merchantPurse) return null;
  return reveal
    ? `${merchantName(shop)} has only ${formatCopper(shop.merchantPurse)} to spend.`
    : `${merchantName(shop)} can't afford that.`;
}

/** The DM sees the purse; players only when "Show the shop's purse to players" is on. */
export function revealPurse(shop: Pick<Shop, "showPurse">, role: "dm" | "player" | string): boolean {
  return role === "dm" || shop.showPurse === true;
}

/** Pay `copper` from the shop's purse (a sale to the shop). Throws with the shortfall message. */
export function payFromMerchant(shop: Shop, copper: number, reveal: boolean): void {
  const short = merchantShortfall(shop, copper, reveal);
  if (short) throw Error(short);
  if (hasMerchantPurse(shop)) shop.merchantPurse -= copper;
}

/** Add `copper` to the shop's purse (a purchase from the shop). Unlimited purses are unchanged. */
export function creditMerchant(shop: Shop, copper: number): void {
  if (!hasMerchantPurse(shop)) return;
  const next = shop.merchantPurse + copper;
  if (!Number.isSafeInteger(next) || next > MAX_MERCHANT_PURSE)
    throw Error("The merchant's purse cannot hold that much.");
  shop.merchantPurse = next;
}

/**
 * The purse after a restock: topped up to the DM's refill amount, never reduced (coins players
 * paid the merchant stay). Null when nothing changes or the shop has no refill set.
 */
export function merchantRefill(shop: Shop): { before: number; after: number } | null {
  if (!hasMerchantPurse(shop) || shop.merchantPurseRefill === undefined) return null;
  const after = Math.max(shop.merchantPurse, shop.merchantPurseRefill);
  return after === shop.merchantPurse ? null : { before: shop.merchantPurse, after };
}

/**
 * Homebrew starting purses matching a shop's wealth (Lootsplitter defaults, not official rules;
 * after video-game merchants: innkeepers 50–100 gp, blacksmiths 1,000 gp).
 */
export const MERCHANT_PURSE_PRESETS = [
  { wealth: "poor", label: "Poor (25 gp)", copper: 2_500 },
  { wealth: "modest", label: "Modest (100 gp)", copper: 10_000 },
  { wealth: "rich", label: "Wealthy (1,000 gp)", copper: 100_000 },
  { wealth: "princely", label: "Princely (10,000 gp)", copper: 1_000_000 },
] as const;

/**
 * What the sell form says before confirming, for any seat: null when the sale fits. Uses the
 * purse when this seat can read it, and the projected affordability otherwise.
 */
export function merchantSaleNotice(
  shop: Shop,
  holding: Pick<Holding, "id" | "quantity">,
  copper: number,
  quantity: number,
  role: string,
): string | null {
  if (hasMerchantPurse(shop)) return merchantShortfall(shop, copper, revealPurse(shop, role));
  const afford = shop.merchantAffords?.[holding.id];
  if (afford === "none") return `${merchantName(shop)} can't afford this item.`;
  if (afford === "some" && quantity > 1)
    return `${merchantName(shop)} may not afford ${quantity === holding.quantity ? "all of them" : "that many"}. If not, nothing is sold.`;
  return null;
}

export function stockCategory(stock: StockLine, shop: Shop) {
  return stock.category || (shop.category === "mixed" ? "general" : shop.category);
}
