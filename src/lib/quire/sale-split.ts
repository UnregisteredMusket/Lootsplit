/**
 * Sell and split (future-development prompt 2, phase 4; mockup approved by the owner on
 * 2026-11-03). One pure planner, used by the shared `sale-split` command (commands.ts, also run
 * offline through executeLocalCommand) and by the dialog's preview: price the chosen party-fund
 * items at one open shop exactly as Sell to shop does (value × buy rate, rounded to whole copper
 * per unit), then plan an even split of the proceeds with the coin-split planner. Nothing is sold
 * unless the split is also valid, so a sale is never left unsplit.
 */
import { planCoinSplit, partyFunds, type CoinSplitPlan, type SplitRule, type SplitTable } from "./coin-split.ts";
import { assertCarried } from "./custody.ts";
import { assertMerchantSale } from "./merchant.ts";
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
};

export type SaleSplitPlan = {
  fundId: string;
  shopId: string;
  shopName: string;
  lots: SaleLot[];
  proceeds: number;
  split: CoinSplitPlan;
};

/** What one unit of `h` fetches at `shop`: the Sell to shop rule. */
export function unitSalePrice(h: Pick<Holding, "unitCopper">, shop: Pick<Shop, "buyRate">): number {
  return Math.round(h.unitCopper * shop.buyRate);
}

/**
 * Why `h` cannot be sold from the fund at `shop` in a sell-and-split, or null when it can.
 * Pooled items are the DM's to sell (the treasure-pool rule, owner decision 2026-10-23).
 */
export function saleProblem(h: Holding, shop: Shop, actor: "dm" | "player"): string | null {
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
  if (unitSalePrice(h, shop) < 1) return `${shop.name} pays nothing for this item.`;
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
  options: { actor: "dm" | "player"; projected?: boolean },
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
    const h = t.holdings.find((x) => x.id === lot.holdingId);
    if (!h || h.purseId !== fund.id) throw Error(`An item is no longer in ${fund.name}. Review the sale again.`);
    if (!Number.isSafeInteger(lot.quantity) || lot.quantity < 1) throw Error("Sell a whole number of each item.");
    if (lot.quantity > h.quantity) throw Error(`Only ${h.quantity} × ${h.name} ${h.quantity === 1 ? "is" : "are"} in ${fund.name}.`);
    const problem = saleProblem(h, shop, options.actor);
    if (problem) throw Error(`${h.name}: ${problem}`);
    const unitPaid = unitSalePrice(h, shop);
    lots.push({
      holdingId: h.id,
      name: h.name,
      quantity: lot.quantity,
      unitCopper: h.unitCopper,
      unitPaid,
      paid: unitPaid * lot.quantity,
      pooled: !!h.pool,
    });
  }
  const proceeds = lots.reduce((sum, l) => sum + l.paid, 0);
  if (!Number.isSafeInteger(proceeds)) throw Error("The sale exceeds the supported coin balance.");
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
