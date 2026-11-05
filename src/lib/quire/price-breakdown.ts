/**
 * Price breakdowns ("Why this price?"): the factors the engine already multiplies, listed in
 * whole copper. The commands that charge or pay a price call these same functions, so a breakdown
 * can never disagree with the amount moved (price-breakdown.test.ts proves it over generated
 * inputs). Nothing here is stored; it is computed from records the viewer already has.
 *
 * Rounding is unchanged: a shop's asking price rounds once (list × market events × markup ×
 * black-market premium), Charisma then rounds once, and the quantity multiplies the whole-copper
 * unit price. Named market events (market-events.ts) are listed one factor each, by name; a secret
 * one is DM-only, so players see it folded into "Other adjustments".
 */
import { charismaOffPercent, formatCopper, groupThousands, priceAfterCharisma } from "./money.ts";
import { shopAsking } from "./vendors.ts";
import { scaleFactors } from "./scale.ts";
import { charismaScore } from "./sheet.ts";
import { offListPercent, onBuyList, stockCategory } from "./merchant.ts";
import { forSale } from "./item-identity.ts";
import { blackMarketPremium, markupTier, type MarkupDisplay } from "./market-markup.ts";
import { eventRate, MAX_EVENT_RATE, MIN_EVENT_RATE, unlimitedEventRate, type MarketEventEffect } from "./market-events.ts";
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
  /**
   * What players see in place of `label` and `percent` (black-market markup, market-markup.ts):
   * a description without a percent, or the percent alone. The copper is unchanged.
   */
  player?: { label: string; percent?: number };
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

/**
 * Named market events, one factor each at its share of the running whole-copper total (the
 * price itself rounds once; the caller's last factor takes up any difference). A secret event
 * is DM-only, so players see it in Other adjustments. Returns the running exact and shown value.
 */
function eventFactors(factors: PriceFactor[], copper: number, events: readonly MarketEventEffect[], rate: number) {
  let exact = copper,
    shown = copper;
  const total = events.find((e) => e.total !== undefined);
  for (const e of events) {
    if (e.total !== undefined) continue;
    exact *= e.permille / 1000;
    const now = Math.round(exact);
    factors.push({
      key: `event-${e.id}`,
      label: e.secret ? `Market event: ${e.name} (secret: players see Other adjustments)` : `Market event: ${e.name}`,
      percent: pct(e.permille / 1000),
      copper: now - shown,
      ...(e.secret ? { dmOnly: true } : {}),
    });
    shown = now;
  }
  if (total) {
    // A player's copy: events they may not see, as the rest of the server's combined rate.
    exact = copper * rate;
    const now = Math.round(exact);
    factors.push({ key: "event-other", label: "Other adjustments", copper: now - shown, dmOnly: true });
    shown = now;
  } else if (events.length && rate !== unlimitedEventRate(events)) {
    exact = copper * rate;
    const now = Math.round(exact);
    factors.push({
      key: "event-limit",
      label: `Market events limited to ×${MIN_EVENT_RATE}–×${MAX_EVENT_RATE}`,
      copper: now - shown,
      ...(events.some((e) => e.secret) ? { dmOnly: true } : {}),
    });
    shown = now;
  }
  return { exact, shown };
}

/** Buying from a shop's stock: the `buy` command's price. */
export function shopBuyBreakdown(
  shop: Pick<Shop, "sellRate" | "blackMarket" | "blackMarketPremium">,
  copper: number,
  cha: number | null,
  quantity = 1,
  options: {
    negotiator?: Negotiator;
    listDerivation?: PriceFactor[];
    /** How players see the black-market markup (the campaign setting; missing = descriptions). */
    markup?: MarkupDisplay;
    /** Today's active market events for this line (market-events.ts `lineEvents`). */
    events?: readonly MarketEventEffect[];
  } = {},
): PriceBreakdown {
  const events = options.events ?? [];
  const rate = eventRate(events);
  const asking = shopAsking(shop, copper, rate);
  const unit = priceAfterCharisma(asking, cha);
  const factors: PriceFactor[] = [];
  const { exact, shown } = eventFactors(factors, copper, events, rate);
  const marked = shop.sellRate === 1 ? shown : Math.round(exact * shop.sellRate);
  if (shop.sellRate !== 1)
    factors.push({ key: "markup", label: `Shop sells at ${Math.round(shop.sellRate * 1000) / 10}%`, percent: pct(shop.sellRate), copper: marked - shown });
  if (shop.blackMarket) {
    // Players see the markup (owner, 2026-11-04): as a description or as the percent, by the
    // DM's setting. The DM's label always carries the percent and what players are shown.
    const premium = blackMarketPremium(shop);
    const percent = pct(premium),
      tier = markupTier(premium),
      percents = options.markup === "percentages";
    factors.push({
      key: "black-market",
      label: `Black-market markup +${percent}% (players see ${percents ? "the percent" : `"${tier}"`})`,
      percent,
      copper: asking - marked,
      player: percents
        ? { label: `Black-market markup +${percent}%`, percent }
        : { label: `Black-market markup: ${tier}` },
    });
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

/**
 * Selling to a shop: the `sell` and `sale-split` payout. With the item's category it also applies
 * the merchant-purse rules (merchant.ts): the off-list rate for categories outside the shop's buy
 * list (rounded down) and the per-item purchase limit. The purse itself only refuses a sale; it
 * never changes the price, so it is not a factor.
 */
export function shopSellBreakdown(
  shop: Pick<Shop, "buyRate"> & Partial<Pick<Shop, "acceptAnyCategory" | "acceptedCategories" | "category" | "offListPercent" | "purchaseLimit">>,
  unitCopper: number,
  quantity = 1,
  item?: { category?: string; unidentified?: import("./item-identity.ts").Unidentified },
  options: {
    /** Today's active market events for this item (market-events.ts `saleEvents`). */
    events?: readonly MarketEventEffect[];
  } = {},
): PriceBreakdown {
  // Item identification: an unidentified item is priced at its presented value and category, so
  // no factor (lot value, off-list rate, limit) shows the true ones.
  if (item?.unidentified) {
    unitCopper = item.unidentified.value ?? 0;
    item = forSale(item);
  }
  // Named market events multiply the value with the buy rate, rounded once (as buying does).
  const events = options.events ?? [];
  const rate = eventRate(events);
  const rated = Math.max(0, Math.round(unitCopper * rate * shop.buyRate));
  const factors: PriceFactor[] = [];
  const { shown } = eventFactors(factors, unitCopper, events, rate);
  if (rated !== shown)
    factors.push(
      shop.buyRate === 1
        ? { key: "rounding", label: "Rounded to whole copper", copper: rated - shown }
        : { key: "buy-rate", label: `Shop buys at ${Math.round(shop.buyRate * 1000) / 10}%`, percent: pct(shop.buyRate), copper: rated - shown },
    );
  let unit = rated;
  const full = shop as Shop;
  if (item && shop.category !== undefined && !onBuyList(item, full) && offListPercent(full)) {
    const percent = offListPercent(full);
    unit = Math.floor((rated * percent) / 100);
    factors.push({ key: "off-list", label: `Not on its buy list: ${percent}% of its rate (rounded down)`, percent: percent - 100, copper: unit - rated });
  }
  if (shop.purchaseLimit !== undefined && unit > shop.purchaseLimit) {
    factors.push({ key: "purchase-limit", label: `Pays at most ${cp(shop.purchaseLimit)} for one item`, copper: shop.purchaseLimit - unit });
    unit = shop.purchaseLimit;
  }
  return {
    base: { label: "Lot value", copper: unitCopper },
    factors,
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
 * What a player may see: DM-only factors (list-price rates, an NPC's valuation) fold into one
 * "Other adjustments" line without their detail; a factor with a player form (black-market
 * markup) shows that form. Totals are unchanged.
 */
export function viewerBreakdown(b: PriceBreakdown, dm: boolean): PriceBreakdown {
  if (dm) return b;
  const { listDerivation: _derivation, playerBase, ...shown } = b;
  // Factors with a player form (black-market markup) show it, without the DM's wording.
  const rest = {
    ...shown,
    factors: shown.factors.map((f) => {
      if (!f.player) return f;
      const { player, percent: _percent, ...plain } = f;
      return { ...plain, label: player.label, ...(player.percent !== undefined ? { percent: player.percent } : {}) };
    }),
  };
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
  for (const f of rest.factors) {
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
