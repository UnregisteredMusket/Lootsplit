/**
 * Black-market markup as players see it (owner, 2026-11-04): a description tier ("Fair Deal" …
 * "Highway Robbery") or the percent, as the DM chooses with `black-market-markup`. The tier is
 * based on the vendor's black-market premium alone (percent over list = premium − 1), never on the
 * shop's normal sell rate, which players already see as "Shop sells at X%". Nothing here is
 * stored; the copper amounts stay exactly as `shopAsking` charges them.
 */
import type { Shop } from "./types.ts";

/** How players see black-market markup. Missing (every older campaign) means descriptions. */
export type MarkupDisplay = "descriptions" | "percentages";
export const MARKUP_DISPLAYS: readonly MarkupDisplay[] = ["descriptions", "percentages"];

/** The tiers, by the highest percent over list each one covers (inclusive). */
export const MARKUP_TIERS: readonly { upTo: number; label: string }[] = [
  { upTo: 10, label: "Fair Deal" },
  { upTo: 25, label: "Slightly Above Average" },
  { upTo: 50, label: "Pricey" },
  { upTo: 100, label: "Steep" },
  { upTo: Infinity, label: "Highway Robbery" },
];

/** The premium a black-market vendor charges (the stored default is 1.5). */
export const blackMarketPremium = (shop: Pick<Shop, "blackMarketPremium">) => shop.blackMarketPremium ?? 1.5;

/**
 * Percent over list, to one decimal place, as the price breakdown shows it. Rounding first keeps
 * the boundaries exact: 1.1 is 10% (Fair Deal), not 10.000000000000009%.
 */
export const markupPercent = (premium: number) => Math.round((premium - 1) * 1000) / 10;

/** The description players see for a premium, e.g. 1.5 → "Pricey". */
export function markupTier(premium: number): string {
  const percent = markupPercent(premium);
  return MARKUP_TIERS.find((t) => percent <= t.upTo)!.label;
}

/** The stored setting, read leniently: anything but "percentages" is descriptions. */
export function markupDisplay(journal: { blackMarketMarkup?: MarkupDisplay } | undefined): MarkupDisplay {
  return journal?.blackMarketMarkup === "percentages" ? "percentages" : "descriptions";
}

/** "+50%" */
export const markupPercentText = (premium: number) => `+${markupPercent(premium)}%`;

/** What players see for a premium under the setting: "Pricey" or "+50%". */
export function playerMarkupText(premium: number, display: MarkupDisplay): string {
  return display === "percentages" ? markupPercentText(premium) : markupTier(premium);
}

/**
 * The shop card's note after "black market": players see the setting's form; the DM sees the
 * percent and the description players get, e.g. "+50%, players see Pricey".
 */
export function shopMarkupNote(premium: number, display: MarkupDisplay, dm: boolean): string {
  if (!dm) return playerMarkupText(premium, display);
  return display === "percentages"
    ? `${markupPercentText(premium)}, players see the percent`
    : `${markupPercentText(premium)}, players see ${markupTier(premium)}`;
}
