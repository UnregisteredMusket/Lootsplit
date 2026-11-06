/**
 * Named market events (owner-approved 2026-11-05, comparable-tools research): the DM's named,
 * timed price multipliers, e.g. "Blight in the Riverlands: provisions ×1.8 for 21 days" or
 * "Harvest festival: provisions −10%".
 *
 * - An event has a name, a scope (the whole realm, one location with its areas, or one shop), an
 *   optional item category (missing = all items), a multiplier in whole permille (100–10,000,
 *   i.e. ×0.1–×10), a start and an end in campaign days (`journal.finance.day`, the Session Time
 *   day) and an optional DM note. It is active from its start day up to, not including, its end
 *   day, so "End now" (end day = today) stops it at once.
 * - It is applied when a shop's asking price is computed (price-breakdown.ts `shopBuyBreakdown`),
 *   never by rewriting stored stock prices, and rounds once with the shop's markup and premium.
 *   What a shop pays for an item sold to it (`shopSellBreakdown`, `sell` and `sale-split`) is
 *   multiplied the same way, by the item's (presented) category, rounding once with the buy rate.
 *   Market listings and exchange quotes are not shop prices and are unchanged.
 * - The DM adds, edits and ends events with `market-event` / `market-event-end` (stale-checked,
 *   one DM-only journal event each). Ended events stay in the campaign as history; nothing deletes
 *   them. Stored in `journal.marketEvents` (tabletop protocol 26), at most `MARKET_EVENT_LIMIT`.
 * - Players (session-records.ts `projectRecord`) receive only today's active events: an open event
 *   whose place they can see, by name without the DM's note and with today as its only day. Secret
 *   events and ones scoped to a place or shop hidden from them are never sent: for each visible
 *   shop they affect, `journal.marketAdjustments` carries the server's combined rate for that
 *   shop's goods (at most one entry per shop and category, so neither their number nor their
 *   order shows), which the player's prices use as the total, so they still equal the charge.
 */
import { z } from "zod";
import { locationPath, readMarketLocations, type MarketLocations } from "./shop-locations.ts";
import { forSale } from "./item-identity.ts";
import { offListPercent } from "./merchant.ts";
import type { Holding, ItemCategory, Shop, StockLine } from "./types.ts";

/** Ended events stay as history; this caps the stored list (about 250 bytes each). */
export const MARKET_EVENT_LIMIT = 300;
/** The combined effect of overlapping events stays within one event's bounds. */
export const MIN_EVENT_RATE = 0.1;
export const MAX_EVENT_RATE = 10;

export const EVENT_CATEGORIES = [
  "provisions",
  "smith",
  "cloth",
  "apothecary",
  "inn",
  "general",
  "curios",
  "stable",
  "scribe",
  "jewels",
] as const satisfies readonly ItemCategory[];

const id = z.string().min(1).max(150);
/**
 * A DM event's ID: letters, digits, "-" and "_" (the form uses a UUID). The synthetic
 * "Other adjustments" effect (`OTHER_ADJUSTMENTS_ID`) can never be one.
 */
const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/, "A market event ID uses letters, digits, - and _.");
export const OTHER_ADJUSTMENTS_ID = "~other-adjustments";
const day = z.number().int().nonnegative().max(1e9);
export const marketEventScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("realm") }).strict(),
  z.object({ kind: z.literal("location"), locationId: id }).strict(),
  z.object({ kind: z.literal("shop"), shopId: id }).strict(),
]);
export const marketEventSchema = z
  .object({
    id: eventId,
    name: z.string().trim().min(1).max(80),
    scope: marketEventScopeSchema,
    /** Missing: every item. */
    category: z.enum(EVENT_CATEGORIES).optional(),
    /** The multiplier in whole permille: 1800 is ×1.8 (+80%), 900 is ×0.9 (−10%). */
    permille: z.number().int().min(100).max(10000),
    startDay: day,
    /** The first day it no longer applies. */
    endDay: day,
    /** Players see only "Other adjustments", and no list entry. */
    secret: z.literal(true).optional(),
    /** The DM's note; never sent to players. */
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((e) => e.endDay >= e.startDay, { message: "An event can't end before it starts." });
export type MarketEvent = z.infer<typeof marketEventSchema>;
export type MarketEventScope = MarketEvent["scope"];
export const marketEventsSchema = z
  .array(marketEventSchema)
  .max(MARKET_EVENT_LIMIT)
  .superRefine((events, ctx) => {
    if (new Set(events.map((e) => e.id)).size !== events.length)
      ctx.addIssue({ code: "custom", message: "Market event IDs must be unique." });
  });

export const marketEventCommands = [
  /** DM: add (`before` null) or edit an event that hasn't ended. */
  z
    .object({
      id,
      kind: z.literal("market-event"),
      eventId,
      before: marketEventSchema.nullable(),
      after: marketEventSchema,
    })
    .strict(),
  /** DM: End now. The end day becomes today (or the start day of one that hasn't started). */
  z.object({ id, kind: z.literal("market-event-end"), eventId, before: marketEventSchema }).strict(),
] as const;
/**
 * A player's copy only (projectMarketEvents): the combined rate of every active event on one
 * visible shop's goods of one category, as the server computes it (`eventRate`, clamped), sent
 * where an event the player may not see takes part. Missing category: the shop's goods without an
 * entry of their own. Valid on `day` only. One entry per shop and category at most (11 per shop).
 */
export const marketAdjustmentSchema = z
  .object({
    shopId: id,
    category: z.enum(EVENT_CATEGORIES).optional(),
    rate: z.number().min(MIN_EVENT_RATE).max(MAX_EVENT_RATE),
    day,
  })
  .strict();
export type MarketAdjustment = z.infer<typeof marketAdjustmentSchema>;
/** No count limit: it is bounded by the shops (11 per shop), never by the DM's event list. */
export const marketAdjustmentsSchema = z.array(marketAdjustmentSchema);

export type MarketEventCommand = z.infer<(typeof marketEventCommands)[number]>;
export const marketEventKinds = new Set<string>(["market-event", "market-event-end"]);

type JournalLike = { finance?: unknown; market?: unknown; marketEvents?: unknown; marketAdjustments?: unknown } | undefined | null;

/** The campaign's Session Time day (finance.ts `day`; missing means day 0). */
export function campaignDay(journal: JournalLike): number {
  const value = (journal?.finance as { day?: unknown } | undefined)?.day;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The stored events, read leniently: a campaign without them has none. */
export function readMarketEvents(value: unknown): MarketEvent[] {
  return value === undefined || value === null ? [] : marketEventsSchema.parse(value);
}

export type EventStatus = "upcoming" | "active" | "ended";
export function eventStatus(e: Pick<MarketEvent, "startDay" | "endDay">, today: number): EventStatus {
  // An upcoming event ended early (End now) keeps endDay = startDay: it never applied.
  if (today >= e.endDay || e.endDay <= e.startDay) return "ended";
  return today < e.startDay ? "upcoming" : "active";
}

/** Whether an event's scope and category cover a shop's line (category undefined: any item). */
export function eventCovers(
  e: Pick<MarketEvent, "scope" | "category">,
  shop: Pick<Shop, "id" | "locationId">,
  category: string | undefined,
  market: MarketLocations,
): boolean {
  if (e.category && e.category !== category) return false;
  if (e.scope.kind === "realm") return true;
  if (e.scope.kind === "shop") return e.scope.shopId === shop.id;
  const locationId = e.scope.locationId;
  return locationPath(market, shop.locationId).some((l) => l.id === locationId);
}

/**
 * What a price needs from an event. On a player's copy, events they may not see come as one
 * "Other adjustments" effect whose `total` is the combined rate of every event on the line.
 */
export type MarketEventEffect = Pick<MarketEvent, "id" | "name" | "permille" | "secret"> & {
  /** The whole combined rate (already clamped); replaces the product of the other effects. */
  total?: number;
};

/** The category key a rate is decided by: one of the event categories, or none. */
const categoryKey = (category: string | undefined) =>
  (EVENT_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as MarketEvent["category"]) : undefined;

/** The item category a stock line is priced as (merchant.ts `stockCategory`). */
function lineCategory(line: Pick<StockLine, "category">, shop: Pick<Shop, "category">): string {
  return line.category || (shop.category === "mixed" ? "general" : shop.category);
}

/**
 * Today's active events that change a shop line's asking price, in a fixed order (start day,
 * then ID). Commands and screens both call this.
 */
export function lineEvents(
  journal: JournalLike,
  shop: Pick<Shop, "id" | "locationId" | "category">,
  line: Pick<StockLine, "category">,
): MarketEventEffect[] {
  return categoryEvents(journal, shop, lineCategory(line, shop));
}

/**
 * Today's active events that change what a shop pays for an item sold to it (`sell`,
 * `sale-split`), by the item's category; an unidentified item by its presented one. An item
 * without a category is covered only by all-items events.
 */
export function saleEvents(
  journal: JournalLike,
  shop: Pick<Shop, "id" | "locationId">,
  item: Pick<Holding, "category" | "unidentified">,
): MarketEventEffect[] {
  return categoryEvents(journal, shop, forSale(item).category || undefined);
}

function categoryEvents(
  journal: JournalLike,
  shop: Pick<Shop, "id" | "locationId">,
  category: string | undefined,
): MarketEventEffect[] {
  if (!journal?.marketEvents && !journal?.marketAdjustments) return [];
  const today = campaignDay(journal);
  const open = activeCovering(journal, shop, category, today);
  const adjustment = findAdjustment(journal, shop.id, categoryKey(category), today);
  return adjustment === undefined
    ? open
    : [...open, { id: OTHER_ADJUSTMENTS_ID, name: "Other adjustments", permille: 1000, secret: true, total: adjustment }];
}

function activeCovering(
  journal: NonNullable<JournalLike>,
  shop: Pick<Shop, "id" | "locationId">,
  category: string | undefined,
  today: number,
): MarketEventEffect[] {
  let events: MarketEvent[];
  try {
    events = readMarketEvents(journal.marketEvents);
  } catch {
    return [];
  }
  if (!events.length) return [];
  const market = readMarketLocations(journal.market);
  return events
    .filter((e) => eventStatus(e, today) === "active" && eventCovers(e, shop, category, market))
    .sort((a, b) => a.startDay - b.startDay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, name: e.name, permille: e.permille, ...(e.secret ? { secret: true as const } : {}) }));
}

/**
 * Whether stored `marketAdjustments` may be priced with: only on a player's projected copy, whose
 * events are all projected ones (`projectMarketEvents`: today's events with today as their only day
 * and no DM note). A campaign with any real schedule (the DM's copy, the server's) ignores them,
 * so adjustments that reached a whole campaign can never price it.
 */
function playerCopy(journal: NonNullable<JournalLike>, today: number): boolean {
  let events: MarketEvent[];
  try {
    events = readMarketEvents(journal.marketEvents);
  } catch {
    return false;
  }
  return events.every((e) => e.startDay === today && e.endDay === today + 1 && e.note === undefined);
}

/** A player's copy: the shop's combined rate for this category (or its default entry) today. */
function findAdjustment(journal: NonNullable<JournalLike>, shopId: string, key: MarketEvent["category"], today: number) {
  if (!journal.marketAdjustments || !playerCopy(journal, today)) return undefined;
  let list: MarketAdjustment[];
  try {
    list = marketAdjustmentsSchema.parse(journal.marketAdjustments);
  } catch {
    return undefined;
  }
  const mine = list.filter((a) => a.shopId === shopId && a.day === today);
  return (mine.find((a) => key !== undefined && a.category === key) ?? mine.find((a) => a.category === undefined))?.rate;
}

/**
 * An older app (protocol < 26) shows prices without market events; it is never charged them.
 * The wording matches the faction refusal (factions.ts) and names no cause, so an older app can't
 * tell a hidden market event or a hidden faction from any other price change (review of #438).
 */
export const OLD_CLIENT_EVENT_PRICE =
  "This price has changed, and this older Lootsplitter app can't show the new one. Finish this on the updated website; nothing was charged or paid.";

/**
 * The product of the events' multipliers, kept within ×0.1–×10 (`eventRate`). No events: exactly
 * 1. Multiplied in ascending permille order, so the same events give the same rate in any order
 * (a player's projected copy lists hidden events differently from the DM's).
 */
export function unlimitedEventRate(events: readonly Pick<MarketEventEffect, "permille" | "total">[]): number {
  const total = events.find((e) => e.total !== undefined)?.total;
  if (total !== undefined) return total;
  let rate = 1;
  for (const permille of events.map((e) => e.permille).sort((a, b) => a - b)) rate *= permille / 1000;
  return rate;
}
export function eventRate(events: readonly Pick<MarketEventEffect, "permille" | "total">[]): number {
  if (!events.length) return 1;
  return Math.min(MAX_EVENT_RATE, Math.max(MIN_EVENT_RATE, unlimitedEventRate(events)));
}

/** "×1.8 (+80%)" or "×0.9 (−10%)". */
export function effectText(permille: number): string {
  const percent = Math.round((permille - 1000) / 10 * 10) / 10;
  return `×${permille / 1000} (${percent >= 0 ? "+" : "−"}${Math.abs(percent)}%)`;
}

export function scopeText(
  e: Pick<MarketEvent, "scope" | "category">,
  names: { location?: (id: string) => string | undefined; shop?: (id: string) => string | undefined } = {},
): string {
  const where =
    e.scope.kind === "realm"
      ? "Whole realm"
      : e.scope.kind === "location"
        ? (names.location?.(e.scope.locationId) ?? "A location")
        : (names.shop?.(e.scope.shopId) ?? "A shop");
  return `${where} · ${e.category ? CATEGORY_LABELS[e.category] : "all items"}`;
}
const CATEGORY_LABELS: Record<(typeof EVENT_CATEGORIES)[number], string> = {
  provisions: "provisions",
  smith: "smith goods",
  cloth: "cloth",
  apothecary: "apothecary goods",
  inn: "inn services",
  general: "general goods",
  curios: "curios",
  stable: "stable goods",
  scribe: "scribe goods",
  jewels: "jewels",
};

type EventTable = {
  shops: Pick<Shop, "id" | "name">[];
  journal?: { finance?: unknown; market?: unknown; marketEvents?: unknown; events: unknown[] } | null;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Apply `market-event` or `market-event-end` (DM only). Shared rooms run it in commands.ts; the
 * device runs the same command through `executeLocalCommand`. One DM-only journal event each.
 */
export function applyMarketEventCommand(
  t: EventTable,
  cmd: MarketEventCommand,
  dm: () => void,
  log: (summary: string) => void,
): void {
  dm();
  const journal = t.journal as { finance?: unknown; market?: unknown; marketEvents?: MarketEvent[] };
  const events = readMarketEvents(journal.marketEvents);
  const today = campaignDay(journal);
  const current = events.find((e) => e.id === cmd.eventId);
  if (cmd.kind === "market-event-end") {
    if (!current || !same(current, cmd.before))
      throw Error("This market event changed. Refresh before ending it.");
    if (eventStatus(current, today) === "ended") throw Error("This market event has already ended.");
    current.endDay = Math.max(today, current.startDay);
    journal.marketEvents = events;
    log(`Market event ended on day ${current.endDay}: ${current.name}`);
    return;
  }
  const after = cmd.after;
  if (after.id !== cmd.eventId) throw Error("Choose one market event to change.");
  if (cmd.before === null) {
    if (current) throw Error("This market event already exists. Refresh before adding it again.");
    if (events.length >= MARKET_EVENT_LIMIT)
      throw Error(`A campaign keeps at most ${MARKET_EVENT_LIMIT} market events, ended ones included.`);
  } else {
    if (!current || !same(current, cmd.before))
      throw Error("This market event changed. Refresh before editing it.");
    if (eventStatus(current, today) === "ended") throw Error("Ended market events stay as recorded.");
  }
  if (after.endDay <= after.startDay) throw Error("A market event lasts at least one day.");
  if (after.endDay - after.startDay > 3650) throw Error("A market event lasts at most 3,650 days.");
  if (after.scope.kind === "location") {
    const locationId = after.scope.locationId;
    if (!readMarketLocations(journal.market).locations.some((l) => l.id === locationId))
      throw Error("Choose an existing location for this market event.");
  }
  if (after.scope.kind === "shop") {
    const shopId = after.scope.shopId;
    if (!t.shops.some((s) => s.id === shopId)) throw Error("Choose an existing shop for this market event.");
  }
  const stored = marketEventSchema.parse(after);
  journal.marketEvents = current ? events.map((e) => (e.id === stored.id ? stored : e)) : [...events, stored];
  log(
    `Market event ${current ? "edited" : "added"}: ${stored.name}, ${effectText(stored.permille)}, days ${stored.startDay}–${stored.endDay}${stored.secret ? " (secret)" : ""}`,
  );
}

/**
 * The category keys a shop's prices are looked up by (`categoryKey`; undefined: goods of no event
 * category): its visible stock lines and what it buys (its buy list, or anything when it buys
 * every category or takes off-list items; merchant.ts `onBuyList`, `offListPercent`).
 */
function shopCategoryKeys(
  shop: Pick<Shop, "id" | "category" | "acceptAnyCategory" | "acceptedCategories" | "offListPercent">,
  stock: readonly Pick<StockLine, "shopId" | "category">[],
): Set<MarketEvent["category"]> {
  const keys = new Set<MarketEvent["category"]>();
  for (const line of stock) if (line.shopId === shop.id) keys.add(categoryKey(lineCategory(line, shop)));
  if (shop.acceptAnyCategory || shop.category === "mixed" || offListPercent(shop) > 0) {
    keys.add(undefined);
    for (const category of EVENT_CATEGORIES) keys.add(category);
  } else for (const category of shop.acceptedCategories || [shop.category]) keys.add(categoryKey(category));
  return keys;
}

/**
 * A player's events (projectRecord): today's active events only, each with today as its only day
 * (upcoming and ended ones, and real schedules, stay with the DM). An open event whose place the
 * seat can see is sent by name without the DM's note. Secret events and ones whose location or
 * shop is hidden from the seat are never sent; where they take part in a visible shop's price,
 * `adjustments` carries that shop's combined rate (the server's `eventRate`, clamped) per
 * category, at most one entry per shop and category. An entry is sent only for a category the
 * shop has a visible line in (stock it sells, or goods it buys), and only where the rate differs
 * from the open events' alone, so a hidden event that changes no price the player can see (×1.0,
 * events that cancel out, or the ×10 clamp) leaves no trace. A copy projected again keeps its own.
 */
export function projectMarketEvents(
  journal: JournalLike,
  visible: {
    shops: Pick<Shop, "id" | "locationId" | "category" | "acceptAnyCategory" | "acceptedCategories" | "offListPercent">[];
    stock: readonly Pick<StockLine, "shopId" | "category">[];
    locationIds: Set<string>;
  },
): { events: MarketEvent[]; adjustments: MarketAdjustment[] } | undefined {
  if (!journal?.marketEvents && !journal?.marketAdjustments) return undefined;
  let events: MarketEvent[];
  try {
    events = readMarketEvents(journal.marketEvents);
  } catch {
    return { events: [], adjustments: [] };
  }
  const today = campaignDay(journal);
  const shopIds = new Set(visible.shops.map((s) => s.id));
  const active = events.filter((e) => eventStatus(e, today) === "active");
  const shown = (e: MarketEvent) =>
    !e.secret &&
    (e.scope.kind === "realm" ||
      (e.scope.kind === "location" && visible.locationIds.has(e.scope.locationId)) ||
      (e.scope.kind === "shop" && shopIds.has(e.scope.shopId)));
  const out = active.filter(shown).map(({ note: _note, ...open }) => ({ ...open, startDay: today, endDay: today + 1 }));
  // Already a player's copy (an archive or device copy projected again): keep its adjustments.
  // Only a player's copy has its own (playerCopy); a campaign with real events ignores stored ones.
  let kept: MarketAdjustment[] = [];
  try {
    if (playerCopy(journal, today))
      kept = marketAdjustmentsSchema.parse(journal.marketAdjustments ?? []).filter((a) => shopIds.has(a.shopId));
  } catch {
    kept = [];
  }
  const hidden = active.filter((e) => !shown(e));
  const open = active.filter(shown);
  const adjustments: MarketAdjustment[] = [...kept];
  if (hidden.length) {
    const market = readMarketLocations(journal.market);
    for (const shop of visible.shops) {
      const touches = hidden.filter((e) => eventCovers({ scope: e.scope }, shop, undefined, market));
      if (!touches.length || kept.some((a) => a.shopId === shop.id)) continue;
      // Only categories this shop has a visible line in; the others have no price to show.
      const keys = shopCategoryKeys(shop, visible.stock);
      const rateFor = (events: MarketEvent[], category: MarketEvent["category"]) =>
        eventRate(events.filter((e) => eventCovers(e, shop, category, market)));
      // The player's copy prices with the open events alone where no entry is sent: send one only
      // where the hidden events change that rate (not at ×1.0, cancelling out, or under the clamp).
      const changed = (category: MarketEvent["category"]) => rateFor(active, category) !== rateFor(open, category);
      // The shop's default: goods of no event category, and any category without its own entry.
      const fallback = keys.has(undefined) && changed(undefined) ? rateFor(active, undefined) : undefined;
      if (fallback !== undefined) adjustments.push({ shopId: shop.id, rate: fallback, day: today });
      for (const category of EVENT_CATEGORIES) {
        if (!keys.has(category)) continue;
        const rate = rateFor(active, category);
        // With a default entry, a category the default would misprice needs its own (that
        // reveals nothing the default doesn't); without one, only a changed rate does.
        const needed = fallback !== undefined ? rate !== fallback : changed(category);
        if (needed) adjustments.push({ shopId: shop.id, category, rate, day: today });
      }
    }
  }
  return { events: out, adjustments };
}
