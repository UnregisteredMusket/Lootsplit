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
 *   Sale payouts, market listings and exchange quotes are not list prices and are unchanged.
 * - The DM adds, edits and ends events with `market-event` / `market-event-end` (stale-checked,
 *   one DM-only journal event each). Ended events stay in the campaign as history; nothing deletes
 *   them. Stored in `journal.marketEvents` (tabletop protocol 26), at most `MARKET_EVENT_LIMIT`.
 * - Players (session-records.ts `projectRecord`) receive only today's active events: an open event
 *   whose place they can see, by name without the DM's note; a secret event, or one scoped to a
 *   place or shop hidden from them, only as an unnamed "Other adjustments" entry per visible shop
 *   it affects, so their prices still equal the charge.
 */
import { z } from "zod";
import { locationPath, readMarketLocations, type MarketLocations } from "./shop-locations.ts";
import type { Shop, StockLine } from "./types.ts";

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
] as const;

const id = z.string().min(1).max(150);
const day = z.number().int().nonnegative().max(1e9);
export const marketEventScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("realm") }).strict(),
  z.object({ kind: z.literal("location"), locationId: id }).strict(),
  z.object({ kind: z.literal("shop"), shopId: id }).strict(),
]);
export const marketEventSchema = z
  .object({
    id,
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
      eventId: id,
      before: marketEventSchema.nullable(),
      after: marketEventSchema,
    })
    .strict(),
  /** DM: End now. The end day becomes today (or the start day of one that hasn't started). */
  z.object({ id, kind: z.literal("market-event-end"), eventId: id, before: marketEventSchema }).strict(),
] as const;
export type MarketEventCommand = z.infer<(typeof marketEventCommands)[number]>;
export const marketEventKinds = new Set<string>(["market-event", "market-event-end"]);

type JournalLike = { finance?: unknown; market?: unknown; marketEvents?: unknown } | undefined | null;

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
  if (today >= e.endDay) return "ended";
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

/** What a price needs from an event; players' unnamed entries carry "Other adjustments". */
export type MarketEventEffect = Pick<MarketEvent, "id" | "name" | "permille" | "secret">;

/** The item category a stock line is priced as (merchant.ts `stockCategory`). */
function lineCategory(line: Pick<StockLine, "category">, shop: Pick<Shop, "category">): string {
  return line.category || (shop.category === "mixed" ? "general" : shop.category);
}

/**
 * Today's active events that change a shop line's asking price, in a fixed order (start day,
 * then ID) so every engine multiplies them identically. Commands and screens both call this.
 */
export function lineEvents(
  journal: JournalLike,
  shop: Pick<Shop, "id" | "locationId" | "category">,
  line: Pick<StockLine, "category">,
): MarketEventEffect[] {
  if (!journal?.marketEvents) return [];
  let events: MarketEvent[];
  try {
    events = readMarketEvents(journal.marketEvents);
  } catch {
    return [];
  }
  const today = campaignDay(journal);
  const market = readMarketLocations(journal.market);
  const category = lineCategory(line, shop);
  return events
    .filter((e) => eventStatus(e, today) === "active" && eventCovers(e, shop, category, market))
    .sort((a, b) => a.startDay - b.startDay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, name: e.name, permille: e.permille, ...(e.secret ? { secret: true as const } : {}) }));
}

/** The product of the events' multipliers, kept within ×0.1–×10. No events: exactly 1. */
export function unlimitedEventRate(events: readonly Pick<MarketEventEffect, "permille">[]): number {
  let rate = 1;
  for (const e of events) rate *= e.permille / 1000;
  return rate;
}
export function eventRate(events: readonly Pick<MarketEventEffect, "permille">[]): number {
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
 * A player's events (projectRecord): today's active events only. An open event whose place the
 * seat can see is sent by name without the DM's note; a secret event, or one whose location or
 * shop is hidden from the seat, becomes one unnamed "Other adjustments" entry per visible shop it
 * affects (so the seat's prices equal the charge), with today as its only day.
 */
export function projectMarketEvents(
  journal: JournalLike,
  visible: { shops: Pick<Shop, "id" | "locationId" | "category">[]; locationIds: Set<string> },
): MarketEvent[] | undefined {
  if (!journal?.marketEvents) return undefined;
  let events: MarketEvent[];
  try {
    events = readMarketEvents(journal.marketEvents);
  } catch {
    return [];
  }
  const today = campaignDay(journal);
  const market = readMarketLocations(journal.market);
  const shopIds = new Set(visible.shops.map((s) => s.id));
  const out: MarketEvent[] = [];
  let hidden = 0;
  for (const e of events) {
    if (eventStatus(e, today) !== "active") continue;
    const placeVisible =
      e.scope.kind === "realm" ||
      (e.scope.kind === "location" && visible.locationIds.has(e.scope.locationId)) ||
      (e.scope.kind === "shop" && shopIds.has(e.scope.shopId));
    if (!e.secret && placeVisible) {
      const { note: _note, ...open } = e;
      out.push(open);
      continue;
    }
    for (const shop of visible.shops)
      if (eventCovers({ scope: e.scope }, shop, undefined, market))
        out.push({
          id: `other-adjustment-${++hidden}`,
          name: "Other adjustments",
          scope: { kind: "shop", shopId: shop.id },
          ...(e.category ? { category: e.category } : {}),
          permille: e.permille,
          startDay: today,
          endDay: today + 1,
          secret: true,
        });
  }
  return out;
}
