/**
 * Price breakdowns ("Why this price?"): the factors the engine already multiplies, listed in
 * whole copper. The commands that charge or pay a price call these same functions, so a breakdown
 * can never disagree with the amount moved (price-breakdown.test.ts proves it over generated
 * inputs). Nothing here is stored; it is computed from records the viewer already has.
 *
 * Rounding is unchanged: a shop's asking price rounds once (list × markup × black-market
 * premium), Charisma then rounds once, and the quantity multiplies the whole-copper unit price.
 */
import { charismaOffPercent, formatCopper, groupThousands, priceAfterCharisma } from "./money.ts";
import { shopAsking } from "./vendors.ts";
import { scaleFactors } from "./scale.ts";
import { charismaScore } from "./sheet.ts";
import { stockCategory } from "./merchant.ts";
import type { CharacterSheet } from "./sheet.ts";
import type { ItemCategory, Purse, RealmSettings, Shop, StockLine } from "./types.ts";

export type PriceFactor = {
  key: string;
  /** Plain words, e.g. "Shop sells at 110%". */
  label: string;
  /** Signed effect in copper on one unit (or on the whole deal for barter). */
  copper: number;
  /** Signed percent, when the factor is a rate. */
  percent?: number;
  /** DM-only detail: players see it folded into "Other adjustments". */
  dmOnly?: boolean;
};

export type Negotiator = { name: string; cha: number | null; percent: number; party: boolean };

export type PriceBreakdown = {
  base: { label: string; copper: number };
  /** The base itself is DM-only (an NPC's valuation): players see this label at 0 cp instead. */
  playerBase?: string;
  /** DM-only: how today's rates build the list price, when they reproduce it exactly. */
  listDerivation?: PriceFactor[];
  factors: PriceFactor[];
  unit: number;
  quantity: number;
  total: number;
  negotiator?: Negotiator;
  note?: string;
};

const pct = (rate: number) => Math.round((rate - 1) * 1000) / 10;

/** The Charisma score the shop and market commands use for a paying account. */
export function charismaFor(
  purse: Pick<Purse, "id" | "kind" | "sheet"> | undefined,
  sheets: Pick<CharacterSheet, "purseId" | "abilities">[] | undefined,
): number | null {
  if (purse?.kind === "party") return null;
  return (
    purse?.sheet?.scores.cha ??
    charismaScore(sheets?.find((s) => s.purseId === purse?.id) as CharacterSheet | undefined)
  );
}

export function negotiatorFor(
  purse: Pick<Purse, "id" | "kind" | "sheet" | "name"> | undefined,
  sheets: Pick<CharacterSheet, "purseId" | "abilities">[] | undefined,
): Negotiator | undefined {
  if (!purse) return undefined;
  const cha = charismaFor(purse, sheets);
  return { name: purse.name, cha, percent: cha === null ? 0 : charismaOffPercent(cha), party: purse.kind === "party" };
}

function charismaFactor(asking: number, cha: number | null, name?: string): PriceFactor | null {
  const unit = priceAfterCharisma(asking, cha);
  if (cha === null) return null;
  const percent = charismaOffPercent(cha);
  if (percent <= 0) return null;
  return {
    key: "charisma",
    label: `${name ? `${name} negotiates: ` : ""}Charisma ${Math.floor(Number(cha))}, ${percent}% off`,
    percent: -percent,
    copper: unit - asking,
  };
}

/** How today's realm and shop settings build a stock line's list price (DM-only), or none. */
export function listPriceDerivation(
  shop: Pick<Shop, "wealth" | "priceScale" | "category">,
  line: Pick<StockLine, "copper" | "baseCopper" | "rarity" | "category">,
  realm: Partial<RealmSettings> | undefined,
): PriceFactor[] | undefined {
  if (!realm || !(line.baseCopper > 0) || !line.rarity) return undefined;
  const category = stockCategory(line as StockLine, shop as Shop) as ItemCategory;
  let f;
  try {
    f = scaleFactors(line.baseCopper, {
      wealth: shop.wealth,
      rarity: line.rarity,
      priceScale: shop.priceScale,
      category,
      realm,
    });
  } catch {
    return undefined;
  }
  if (!f || f.copper !== line.copper) return undefined;
  const steps: [string, string, number][] = [
    ["wealth", `Shop wealth (${shop.wealth})`, f.wealth],
    ["rarity", `Rarity (${line.rarity})`, f.rarity],
    ["price-scale", "Shop price scale", f.priceScale],
    ["inflation", "Inflation", f.inflation],
    ["season", f.seasonName, f.season],
    ["shortage", "Shortage", f.shortage],
    ["war", "War", f.war],
    ["plague", "Plague", f.plague],
    ["roads", "Roads", f.roads],
  ];
  if (f.pressureLimit !== 1) steps.push(["limit", "Market pressure limit", f.pressureLimit]);
  const out: PriceFactor[] = [];
  let exact = line.baseCopper,
    shown = line.baseCopper;
  for (const [key, label, rate] of steps) {
    if (rate === 1) continue;
    exact *= rate;
    const now = Math.round(exact);
    out.push({ key, label, percent: pct(rate), copper: now - shown, dmOnly: true });
    shown = now;
  }
  if (shown !== f.copper) out.push({ key: "rounding", label: "Rounded to whole copper", copper: f.copper - shown, dmOnly: true });
  return out;
}

/** Buying from a shop's stock: the `buy` command's price. */
export function shopBuyBreakdown(
  shop: Pick<Shop, "sellRate" | "blackMarket" | "blackMarketPremium">,
  copper: number,
  cha: number | null,
  quantity = 1,
  options: { negotiator?: Negotiator; listDerivation?: PriceFactor[] } = {},
): PriceBreakdown {
  const asking = shopAsking(shop, copper);
  const unit = priceAfterCharisma(asking, cha);
  const factors: PriceFactor[] = [];
  const marked = shop.sellRate === 1 ? copper : Math.round(copper * shop.sellRate);
  if (shop.sellRate !== 1)
    factors.push({ key: "markup", label: `Shop sells at ${Math.round(shop.sellRate * 1000) / 10}%`, percent: pct(shop.sellRate), copper: marked - copper });
  if (shop.blackMarket) {
    const premium = shop.blackMarketPremium ?? 1.5;
    factors.push({ key: "black-market", label: "Black-market premium", percent: pct(premium), copper: asking - marked, dmOnly: true });
  } else if (asking !== marked) factors.push({ key: "rounding", label: "Rounded to whole copper", copper: asking - marked });
  const c = charismaFactor(asking, cha, options.negotiator?.name);
  if (c) factors.push(c);
  return {
    base: { label: "List price", copper },
    ...(options.listDerivation ? { listDerivation: options.listDerivation } : {}),
    factors,
    unit,
    quantity,
    total: unit * quantity,
    ...(options.negotiator ? { negotiator: options.negotiator } : {}),
  };
}

/** Selling to a shop: the `sell` command's payout. */
export function shopSellBreakdown(
  shop: Pick<Shop, "buyRate">,
  unitCopper: number,
  quantity = 1,
): PriceBreakdown {
  const unit = Math.max(0, Math.round(unitCopper * shop.buyRate));
  return {
    base: { label: "Lot value", copper: unitCopper },
    factors:
      unit === unitCopper
        ? []
        : [{ key: "buy-rate", label: `Shop buys at ${Math.round(shop.buyRate * 1000) / 10}%`, percent: pct(shop.buyRate), copper: unit - unitCopper }],
    unit,
    quantity,
    total: unit * quantity,
  };
}

/** Buying a market listing (goods or property): the `listing` command's price. */
export function listingBreakdown(
  copper: number,
  cha: number | null,
  quantity = 1,
  options: { negotiator?: Negotiator } = {},
): PriceBreakdown {
  const asking = Math.max(0, Math.round(copper));
  const unit = priceAfterCharisma(copper, cha);
  const factors: PriceFactor[] = [];
  const c = charismaFactor(asking, cha, options.negotiator?.name);
  if (c) factors.push(c);
  return {
    base: { label: "Listed price", copper: asking },
    factors,
    unit,
    quantity,
    total: unit * quantity,
    ...(options.negotiator ? { negotiator: options.negotiator } : {}),
  };
}

/** A commodity exchange trade: this season's fixed ask (buy) or bid (sell). */
export function exchangeBreakdown(
  offer: { askCopper: number; bidCopper: number },
  direction: "buy" | "sell",
  quantity = 1,
): PriceBreakdown {
  const unit = direction === "buy" ? offer.askCopper : offer.bidCopper;
  return {
    base: { label: direction === "buy" ? "This season's ask" : "This season's bid", copper: unit },
    factors: [],
    unit,
    quantity,
    total: unit * quantity,
    note: "Exchange prices stay fixed for the season. Charisma does not change them.",
  };
}

/** NPC barter: the coins that bring an offer up to the NPC's accept line, in steps of 10 cp. */
export function sweetenCopper(given: number, received: number, acceptPercent: number): number {
  const target = Math.ceil((given * acceptPercent) / 100);
  return Math.ceil(Math.max(0, target - received) / 10) * 10;
}

export function barterSweetenBreakdown(
  addCopper: number,
  options: {
    npcName: string;
    /** DM only: the NPC's valuation. Players' quotes do not carry these. */
    given?: number;
    received?: number;
    acceptPercent?: number;
  },
): PriceBreakdown {
  const { given, received, acceptPercent } = options;
  const factors: PriceFactor[] = [];
  if (given !== undefined && received !== undefined && acceptPercent !== undefined) {
    const target = Math.ceil((given * acceptPercent) / 100);
    const gap = Math.max(0, target - received);
    factors.push(
      { key: "accept-line", label: `${options.npcName} accepts at ${acceptPercent}% of what they give`, percent: acceptPercent - 100, copper: target - given, dmOnly: true },
      { key: "received", label: `${options.npcName} values your side at ${cp(received)}`, copper: -Math.min(target, received), dmOnly: true },
    );
    if (addCopper !== gap) factors.push({ key: "rounding", label: "Rounded up to the next 10 cp", copper: addCopper - gap, dmOnly: true });
    return { base: { label: `What ${options.npcName} gives, valued`, copper: given }, playerBase: "Coins to add", factors, unit: addCopper, quantity: 1, total: addCopper };
  }
  // A player's quote never carries the valuation: the whole amount is the hidden part.
  return {
    base: { label: "Coins to add", copper: 0 },
    factors: addCopper ? [{ key: "valuation", label: `${options.npcName}'s private valuation`, copper: addCopper, dmOnly: true }] : [],
    unit: addCopper,
    quantity: 1,
    total: addCopper,
    note: "Rounded up to the next 10 cp. Adding it makes the offer one they accept without a roll.",
  };
}

/**
 * What a player may see: DM-only factors (black-market premium, list-price rates, an NPC's
 * valuation) fold into one "Other adjustments" line without their detail. Totals are unchanged.
 */
export function viewerBreakdown(b: PriceBreakdown, dm: boolean): PriceBreakdown {
  if (dm) return b;
  const { listDerivation: _derivation, playerBase, ...rest } = b;
  const base = playerBase ? { label: playerBase, copper: 0 } : b.base;
  const hiddenBase = playerBase ? b.base.copper : 0;
  const hidden = b.factors.filter((f) => f.dmOnly);
  if (!hidden.length && !hiddenBase) return { ...rest, base };
  const other = hiddenBase + hidden.reduce((n, x) => n + x.copper, 0);
  const factors: PriceFactor[] = [];
  let folded = false;
  const fold = () => {
    if (folded) return;
    folded = true;
    if (other) factors.push({ key: "other", label: "Other adjustments", copper: other });
  };
  if (hiddenBase) fold();
  for (const f of b.factors) {
    if (!f.dmOnly) factors.push(f);
    else fold();
  }
  return { ...rest, base, factors };
}

/** Whole copper, as the breakdown speaks: "2,106 cp". */
export function cp(copper: number) {
  return `${groupThousands(copper)} cp`;
}
function signed(copper: number) {
  return `${copper < 0 ? "−" : "+"}${cp(Math.abs(copper))}`;
}

/** Plain lines for the disclosure and for tests, e.g. "Shop sells at 110%: +1 cp". */
export function breakdownLines(b: PriceBreakdown): string[] {
  const lines = [`${b.base.label}: ${cp(b.base.copper)}`];
  for (const f of b.listDerivation ?? []) lines.push(`  ${f.label}${f.percent !== undefined ? ` ${f.percent >= 0 ? "+" : "−"}${Math.abs(f.percent)}%` : ""}: ${signed(f.copper)}`);
  for (const f of b.factors) lines.push(`${f.label}: ${signed(f.copper)}`);
  if (b.quantity !== 1) lines.push(`${cp(b.unit)} each × ${b.quantity}`);
  const coins = formatCopper(b.total);
  lines.push(`Total: ${cp(b.total)}${coins === cp(b.total) ? "" : ` (${coins})`}`);
  return lines;
}
