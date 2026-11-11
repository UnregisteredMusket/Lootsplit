/**
 * Sell and split (future-development prompt 2, phase 4; mockup approved by the owner on
 * 2026-11-03). One pure planner, used by the shared `sale-split` command (commands.ts, also run
 * offline through executeLocalCommand) and by the dialog's preview: price the chosen party-fund
 * items at one open shop exactly as Sell to shop does (value × today's market events × faction standing × buy rate,
 * rounded to whole copper per unit), then plan an even split of the proceeds with the coin-split planner. Nothing is sold
 * unless the split is also valid, so a sale is never left unsplit.
 */
import { planCoinSplit, partyFunds, type CoinSplitPlan, type SplitRule, type SplitTable } from "./coin-split.ts";
import { assertCarried } from "./custody.ts";
import { assertMerchantSale, hasMerchantPurse, merchantShortfall, revealPurse } from "./merchant.ts";
import { knownUnitCopper, presentedHolding } from "./item-identity.ts";
import { shopSellBreakdown, type PriceBreakdown } from "./price-breakdown.ts";
import { saleEvents } from "./market-events.ts";
import { factionEffects } from "./factions.ts";
import { settlementSaleLimit } from "./settlements.ts";
import type { Holding, Shop } from "./types.ts";

export const MAX_SALE_LOTS = 50;

export type SaleSplitTable = SplitTable & { holdings: Holding[]; shops: Shop[] };

export type SaleSplitInput = {
  fundId: string;
  shopId: string;
  lots: Array<{ holdingId: string; quantity: number }>;
  recipientIds: string[];
  rule: SplitRule;
  purseId?: string;
};

export type SaleLot = {
  holdingId: string;
  name: string;
  quantity: number;
  unitCopper: number;
  /** What the shop pays for one unit (whole copper). */
  unitPaid: number;
  paid: number;
  pooled: boolean;
  /** The DM sells this above the settlement's per-item limit (`shopSale`'s warning); display only. */
  warning?: string;
};

export type SaleSplitPlan = {
  fundId: string;
  shopId: string;
  shopName: string;
  lots: SaleLot[];
  proceeds: number;
  split: CoinSplitPlan;
};

/**
 * Selling `quantity` of `h` to `shop`, priced the one way every sale path uses (the shared `sell`
 * and `sale-split` commands, the player link's `sellToShop` in economy.ts, the sell form's
 * breakdown): today's market events, faction standing and the settlement's per-item sale cap
 * (settlements.ts, S2). `refused` is set when the settlement refuses the item. The DM is exempt
 * from the settlement cap (owner decision 2026-11-10): `actor` "dm" pays the full payout with a
 * `warning`; the shop's own per-item limit and purse still apply. The actor comes from the seat
 * (the shared engine's seat role, the device's own seat), never from a command field.
 */
export function shopSale(
  h: Pick<Holding, "unitCopper" | "category" | "unidentified">,
  shop: Shop,
  quantity: number,
  journal?: SaleSplitTable["journal"],
  purses: SaleSplitTable["purses"] = [],
  actor: "dm" | "player" = "player",
): PriceBreakdown {
  return shopSellBreakdown(shop, h.unitCopper, quantity, h, {
    events: saleEvents(journal, shop, h),
    factions: factionEffects(journal, purses, shop),
    settlementLimit: settlementSaleLimit(journal, shop),
    ...(actor === "dm" ? { settlementExempt: true } : {}),
  });
}

/**
 * What one unit of `h` fetches at `shop`: the Sell to shop rule (price-breakdown.ts), including
 * the off-list rate, purchase limit and the settlement's per-item cap. The shop's purse is checked for the whole sale. An
 * unidentified item is priced at its presented value and category, never its true ones.
 */
export function unitSalePrice(
  h: Pick<Holding, "unitCopper" | "category" | "unidentified">,
  shop: Shop,
  /** The campaign journal: today's market events change the payout (market-events.ts). */
  journal?: SaleSplitTable["journal"],
  /** The campaign's purses: the party's faction standing changes it too (factions.ts). */
  purses: SaleSplitTable["purses"] = [],
  /** The DM is exempt from the settlement cap (`shopSale`). */
  actor: "dm" | "player" = "player",
): number {
  return shopSale(h, shop, 1, journal, purses, actor).unit;
}

/**
 * Player projection of a shop's purse (session-records.ts): unless the DM shows it, the amount
 * and refill are removed and only whether the merchant can afford each readable lot remains.
 * Each lot is priced by `shopSale`, the one price every sale path charges (market events,
 * faction standing, off-list rate, purchase limit and the settlement cap), so the warning a
 * player sees matches what the server accepts (audit I1). Pass the campaign's journal and
 * purses; a lot the settlement refuses gets no entry (its refusal is shown instead).
 */
export function projectMerchantPurse(
  shop: Shop,
  holdings: Holding[],
  journal?: SaleSplitTable["journal"],
  purses: SaleSplitTable["purses"] = [],
): Shop {
  if (!hasMerchantPurse(shop) || shop.showPurse) return shop;
  const projected: Shop = { ...shop, purseLimited: true, merchantAffords: {} };
  for (const h of holdings) {
    if (h.kind !== "item") continue;
    try {
      assertMerchantSale(h, shop);
    } catch {
      continue;
    }
    const sale = shopSale(h, shop, 1, journal, purses, "player");
    if (sale.refused || sale.unit < 1) continue;
    projected.merchantAffords![h.id] =
      sale.unit * h.quantity <= shop.merchantPurse ? "all" : sale.unit <= shop.merchantPurse ? "some" : "none";
  }
  delete projected.merchantPurse;
  delete projected.merchantPurseRefill;
  return projected;
}

/**
 * Why `h` cannot be sold from the fund at `shop` in a sell-and-split, or null when it can.
 * Pooled items are the DM's to sell (the treasure-pool rule, owner decision 2026-10-23).
 */
export function saleProblem(
  h: Holding,
  shop: Shop,
  actor: "dm" | "player",
  journal?: SaleSplitTable["journal"],
  purses: SaleSplitTable["purses"] = [],
): string | null {
  if (h.kind !== "item" || h.deed || h.property) return "Sell properties one at a time with Sell to shop.";
  if (h.pool && actor !== "dm")
    return "This item is in the treasure pool. Only the DM can sell it before it is resolved.";
  try {
    assertCarried(h, true);
    assertMerchantSale(h, shop);
  } catch (error) {
    return error instanceof Error ? error.message : "This item can't be sold here.";
  }
  if (h.equipped) return "Unequip this item before selling it.";
  const sale = shopSale(h, shop, 1, journal, purses, actor);
  // Settlement limits (S2): above the place's per-item limit, with "refuse" chosen (never the DM).
  if (sale.refused) return sale.refused;
  if (sale.unit < 1) return `${shop.name} pays nothing for this item.`;
  return null;
}

/**
 * Plan a sell-and-split. Throws an Error with a reader-facing message when it is not allowed.
 * Shop availability (closed, black market, the party's location) is checked by the command,
 * which knows the acting seat; the dialog lists only shops open to it.
 */
export function planSaleSplit(
  t: SaleSplitTable,
  input: SaleSplitInput,
  options: { actor: "dm" | "player"; projected?: boolean; skipPurse?: boolean },
): SaleSplitPlan {
  const fund = t.purses.find((p) => p.id === input.fundId);
  if (!fund) throw Error("Account no longer exists.");
  if (!partyFunds(t).some((p) => p.id === fund.id) && !(options.projected && fund.kind === "party"))
    throw Error("Sell and split works from a party fund.");
  const shop = t.shops.find((s) => s.id === input.shopId);
  if (!shop) throw Error("Item or shop no longer exists.");
  if (shop.closed) throw Error("This shop is closed.");
  if (!input.lots.length) throw Error("Choose at least one item to sell.");
  if (input.lots.length > MAX_SALE_LOTS) throw Error(`Sell at most ${MAX_SALE_LOTS} items at once.`);
  if (new Set(input.lots.map((l) => l.holdingId)).size !== input.lots.length)
    throw Error("Each item can be chosen once per sale.");
  const lots: SaleLot[] = [];
  for (const lot of input.lots) {
    const found = t.holdings.find((x) => x.id === lot.holdingId);
    // Item identification: names and prices as presented (item-identity.ts).
    const h = found && presentedHolding(found);
    if (!h || h.purseId !== fund.id) throw Error(`An item is no longer in ${fund.name}. Review the sale again.`);
    if (!Number.isSafeInteger(lot.quantity) || lot.quantity < 1) throw Error("Sell a whole number of each item.");
    if (lot.quantity > h.quantity) throw Error(`Only ${h.quantity} × ${h.name} ${h.quantity === 1 ? "is" : "are"} in ${fund.name}.`);
    const problem = saleProblem(h, shop, options.actor, t.journal, t.purses);
    if (problem) throw Error(`${h.name}: ${problem}`);
    const sale = shopSale(h, shop, 1, t.journal, t.purses, options.actor);
    const unitPaid = sale.unit;
    lots.push({
      holdingId: h.id,
      name: h.name,
      quantity: lot.quantity,
      unitCopper: h.unitCopper,
      unitPaid,
      paid: unitPaid * lot.quantity,
      pooled: !!h.pool,
      ...(sale.warning ? { warning: sale.warning } : {}),
    });
  }
  const proceeds = lots.reduce((sum, l) => sum + l.paid, 0);
  if (!Number.isSafeInteger(proceeds)) throw Error("The sale exceeds the supported coin balance.");
  // Merchant purse: the whole sale fits it or nothing is sold.
  const short = options.skipPurse ? null : merchantShortfall(shop, proceeds, revealPurse(shop, options.actor));
  if (short) throw Error(short);
  const split = planCoinSplit(
    t,
    {
      sourceId: fund.id,
      copper: proceeds,
      recipientIds: input.recipientIds,
      rule: input.rule,
      ...(input.purseId ? { purseId: input.purseId } : {}),
    },
    options,
  );
  return { fundId: fund.id, shopId: shop.id, shopName: shop.name, lots, proceeds, split };
}

export function lotLabel(l: Pick<SaleLot, "name" | "quantity">): string {
  return l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name;
}
