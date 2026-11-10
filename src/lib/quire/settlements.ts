/**
 * Settlement tiers, phase S1 (owner design 2026-11-10; shapes and commands in
 * settlements-schema.ts).
 *
 * - The DM gives a city or town a tier on the campaign's ladder (Pathfinder's eight sizes by
 *   default, or five simple steps), optionally a population in words, and optionally overrides of
 *   what a new shop there starts with: wealth, merchant purse and refill.
 * - An area (a city district) has no profile of its own: it shares its city's or town's, the way
 *   `globalMarketCity` lets a district share its city's market. Regions have none.
 * - Defaults apply only when a shop is created there (the shop composer and imported shop names);
 *   no command rewrites an existing shop's wealth or purse, and a place without a profile behaves
 *   exactly as before.
 * - Players (`projectSettlements`, called from `projectRecord`) receive the ladder, the names of
 *   the tiers their visible places use and only the profiles of places they can already see, with
 *   tier and population only; the new-shop overrides stay with the DM.
 *
 * Phase S2 (owner decisions 2026-11-10), limits:
 * - Per-item sale cap, OFF until the DM turns it on. Each tier has a limit (whole copper; the DM may
 *   change it per tier or per place): when one item's payout at a shop in that place is above it,
 *   the sale is refused (the default) or the shop pays the limit for each such item. Shops at a
 *   place without a tier, and campaign-wide shops, have no cap. `settlementSaleLimit` feeds
 *   `shopSellBreakdown`, so `sell` and `sale-split` (commands.ts, also the device), the player
 *   link's `sellToShop` (economy.ts) and the price breakdown players see all apply the same rule.
 *   Players' copies carry the mode and each visible place's effective limit, nothing else.
 * - Rarity cap on generated stock, ON for places with a tier unless the DM turns it off: the shop
 *   composer never generates stock above the place's rarest (`settlementMaxRarity`). Hand-added
 *   stock is never limited, and no existing shop is changed. DM-only; never sent to players.
 */
import { locationPath, readMarketLocations, type MarketLocation, type MarketLocations } from "./shop-locations.ts";
import {
  DEFAULT_SETTLEMENT_LADDER,
  MAX_SETTLEMENTS,
  SETTLEMENT_LADDERS,
  STOCK_RARITIES,
  settlementsSchema,
  type SettlementLimitSettings,
  type SettlementCommand,
  type SettlementLadderSettings,
  type SettlementProfile,
  type Settlements,
  type SettlementTier,
} from "./settlements-schema.ts";
import { BUY_RATE } from "./scale.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { SettlementSaleLimit } from "./price-breakdown.ts";
import type { ItemRarity, Shop, Wealth } from "./types.ts";

type JournalLike = { settlements?: unknown; market?: unknown } | undefined | null;

/** The stored settlements, read leniently: a campaign without them has none. */
export function readSettlements(value: unknown): Settlements {
  const parsed = settlementsSchema.parse(value ?? {});
  // Its own copy of `places`: commands edit it, and a parsed default must never be shared.
  return { ...parsed, places: { ...parsed.places } };
}
function safeSettlements(journal: JournalLike): Settlements {
  try {
    return readSettlements(journal?.settlements);
  } catch {
    return { places: {} };
  }
}

/** The campaign's ladder choice and tier names, defaults filled in. */
export function ladderSettings(s: Pick<Settlements, "ladder" | "names">): SettlementLadderSettings {
  return { ladder: s.ladder ?? DEFAULT_SETTLEMENT_LADDER, names: s.names ?? {} };
}
/** The ladder's tiers in order, with the DM's names. */
export function settlementTiers(s: Pick<Settlements, "ladder" | "names">): SettlementTier[] {
  const { ladder, names } = ladderSettings(s);
  return SETTLEMENT_LADDERS[ladder].tiers.map((t) => ({ ...t, name: names[t.id] ?? t.name }));
}

/** Whether a location can hold a profile: cities and towns. */
export function settlementKind(location: Pick<MarketLocation, "kind"> | undefined): boolean {
  return location?.kind === "city" || location?.kind === "town";
}
/**
 * The city or town whose profile applies at a location: itself, or for an area its city or
 * town. Regions and unknown places have none.
 */
export function settlementHome(market: MarketLocations, locationId: string | null | undefined): MarketLocation | undefined {
  return [...locationPath(market, locationId)].reverse().find(settlementKind);
}

export type SettlementHere = {
  location: MarketLocation;
  profile: SettlementProfile;
  tier: SettlementTier;
  /** True when the location asked about is an area sharing its city's or town's profile. */
  inherited: boolean;
};
/** The profile that applies at a location, or undefined (no profile, or a tier the ladder lacks). */
export function settlementAt(journal: JournalLike, locationId: string | null | undefined): SettlementHere | undefined {
  if (!journal?.settlements || !locationId) return undefined;
  let market: MarketLocations;
  try {
    market = readMarketLocations(journal.market);
  } catch {
    return undefined;
  }
  const home = settlementHome(market, locationId);
  if (!home) return undefined;
  const s = safeSettlements(journal);
  const profile = s.places[home.id];
  const tier = profile && settlementTiers(s).find((t) => t.id === profile.tier);
  if (!profile || !tier) return undefined;
  return { location: home, profile, tier, inherited: home.id !== locationId };
}

/** "Large city", or "Large city · about 12,000 people" with a population. */
export function settlementLabel(here: Pick<SettlementHere, "tier" | "profile">): string {
  return [here.tier.name, here.profile.population].filter(Boolean).join(" · ");
}

export type NewShopDefaults = {
  wealth: Wealth;
  /** The suggested buy rate for that wealth (the composer's own suggestion). */
  buyRate: number;
  merchantPurse?: number;
  merchantPurseRefill?: number;
  /** Where the defaults come from, for the form's note ("Port City · Large city"). */
  source: string;
};
/**
 * What a shop created at this location starts with: the tier's wealth (or the place's override)
 * and, when the DM set one, a merchant purse and refill. Undefined where no profile applies.
 * Only creation paths call this; existing shops are never changed by it.
 */
export function newShopDefaults(journal: JournalLike, locationId: string | null | undefined): NewShopDefaults | undefined {
  const here = settlementAt(journal, locationId);
  if (!here) return undefined;
  const wealth = here.profile.wealth ?? here.tier.wealth;
  return {
    wealth,
    buyRate: BUY_RATE[wealth],
    ...(here.profile.purse !== undefined ? { merchantPurse: here.profile.purse } : {}),
    ...(here.profile.purse !== undefined && here.profile.refill !== undefined ? { merchantPurseRefill: here.profile.refill } : {}),
    source: `${here.location.name} · ${here.tier.name}`,
  };
}

/** S2: the campaign's limits with defaults filled in (sale cap off, rarity cap on). */
export function limitSettings(s: Pick<Settlements, "limits">): SettlementLimitSettings {
  const l = s.limits ?? {};
  return { sale: l.sale ?? "off", saleLimits: l.saleLimits ?? {}, rarity: !l.rarityOff, maxRarity: l.maxRarity ?? {} };
}
/** S2: a tier's per-item sale limit: the DM's value for the tier, or the ladder's default. */
export function tierSaleLimit(s: Pick<Settlements, "limits">, tier: Pick<SettlementTier, "id" | "saleLimit">): number {
  return s.limits?.saleLimits?.[tier.id] ?? tier.saleLimit;
}
/** S2: a tier's rarest generated stock: the DM's value for the tier, or the ladder's default. */
export function tierMaxRarity(s: Pick<Settlements, "limits">, tier: Pick<SettlementTier, "id" | "maxRarity">): ItemRarity {
  return s.limits?.maxRarity?.[tier.id] ?? tier.maxRarity;
}
/** A place's per-item sale limit: its own override, else its tier's. */
function effectiveSaleLimit(s: Settlements, here: Pick<SettlementHere, "profile" | "tier">): number {
  return here.profile.saleLimit ?? tierSaleLimit(s, here.tier);
}

/**
 * S2: the per-item sale cap at a shop, or undefined when none applies (the cap is off, the shop is
 * campaign-wide, or its place has no tier). Feeds `shopSellBreakdown` in every sale path.
 */
export function settlementSaleLimit(journal: JournalLike, shop: Pick<Shop, "locationId">): SettlementSaleLimit | undefined {
  if (!journal?.settlements || !shop.locationId) return undefined;
  const s = safeSettlements(journal);
  const mode = limitSettings(s).sale;
  if (mode === "off") return undefined;
  const here = settlementAt(journal, shop.locationId);
  if (!here) return undefined;
  return { copper: effectiveSaleLimit(s, here), mode, place: here.location.name };
}

/**
 * S2: the rarest stock the shop composer may generate for a new shop at this location, or
 * undefined (the rarity cap is off, or the place has no tier). Hand-added stock is never limited.
 */
export function settlementMaxRarity(
  journal: JournalLike,
  locationId: string | null | undefined,
): { rarity: ItemRarity; source: string } | undefined {
  const here = settlementAt(journal, locationId);
  if (!here) return undefined;
  const s = safeSettlements(journal);
  if (!limitSettings(s).rarity) return undefined;
  return { rarity: here.profile.maxRarity ?? tierMaxRarity(s, here.tier), source: `${here.location.name} · ${here.tier.name}` };
}
/** Whether a rarity is at or below a cap (the catalog's order: common, uncommon, rare, magic). */
export function rarityAllowed(rarity: ItemRarity, cap: ItemRarity | undefined): boolean {
  return cap === undefined || STOCK_RARITIES.indexOf(rarity) <= STOCK_RARITIES.indexOf(cap);
}

/** S2: an older app (protocol < 32) priced this sale without the settlement's limit. */
export const OLD_CLIENT_SETTLEMENT_PRICE =
  "This town's shops now pay less for this item, and this older Lootsplitter app can't show the new price. Finish this on the updated website; nothing was sold.";
/** The sale cap's wording in the DM's history line. */
export function saleCapLabel(mode: SettlementLimitSettings["sale"]): string {
  return mode === "off" ? "off" : mode === "refuse" ? "refuse pricier items" : "pay the limit";
}

const STALE = "This place's settlement changed elsewhere. Refresh before saving; nothing was saved.";
const STALE_LADDER = "The settlement ladder changed elsewhere. Refresh before saving; nothing was saved.";
const STALE_LIMITS = "The settlement limits changed elsewhere. Refresh before saving; nothing was saved.";

function store(journal: { settlements?: unknown }, s: Settlements) {
  if (s.limits && !Object.keys(s.limits).length) delete s.limits;
  const empty = !Object.keys(s.places).length && !s.ladder && !(s.names && Object.keys(s.names).length) && !s.limits;
  if (empty) delete journal.settlements;
  else journal.settlements = settlementsSchema.parse(s);
}

/**
 * Apply a settlement command (DM only). Shared rooms and the device both run it through
 * `applyCommand` (commands.ts), so the result and the errors are identical. One DM-only history
 * line per change. Shops are never touched.
 */
export function applySettlementCommand(
  t: Pick<CloudTable, "journal">,
  seat: Pick<CloudSeat, "role">,
  cmd: SettlementCommand,
  log: (summary: string) => void,
): void {
  if (seat.role !== "dm") throw Error("Only the DM can change settlements.");
  const journal = t.journal as { settlements?: unknown; market?: unknown };
  const s = readSettlements(journal.settlements);
  if (cmd.kind === "settlement-ladder") {
    const current = ladderSettings(s);
    if (JSON.stringify(sortedSettings(current)) !== JSON.stringify(sortedSettings(cmd.before))) throw Error(STALE_LADDER);
    const keys = new Set(SETTLEMENT_LADDERS[cmd.after.ladder].tiers.map((x) => x.id));
    if (Object.keys(cmd.after.names).some((k) => !keys.has(k))) throw Error("Each name belongs to one of this ladder's tiers.");
    const stranded = Object.values(s.places).filter((p) => !keys.has(p.tier)).length;
    if (stranded)
      throw Error(
        `${stranded} ${stranded === 1 ? "place uses a tier" : "places use tiers"} this ladder doesn't have. Change or clear ${stranded === 1 ? "its tier" : "their tiers"} first; nothing was saved.`,
      );
    // Names equal to the default are not stored.
    const defaults = new Map(SETTLEMENT_LADDERS[cmd.after.ladder].tiers.map((x) => [x.id, x.name]));
    const names = Object.fromEntries(Object.entries(cmd.after.names).filter(([k, v]) => defaults.get(k) !== v));
    const next: Settlements = { places: s.places };
    if (cmd.after.ladder !== DEFAULT_SETTLEMENT_LADDER) next.ladder = cmd.after.ladder;
    if (Object.keys(names).length) next.names = names;
    // S2: the limits stay; the DM's per-tier values follow the tiers the new ladder has.
    if (s.limits) next.limits = limitsFor(limitSettings(s), cmd.after.ladder);
    store(journal, next);
    log(`Settlement ladder saved: ${SETTLEMENT_LADDERS[cmd.after.ladder].name}`);
    return;
  }
  if (cmd.kind === "settlement-limits") {
    const current = limitSettings(s);
    if (JSON.stringify(sortedLimits(current)) !== JSON.stringify(sortedLimits(cmd.before))) throw Error(STALE_LIMITS);
    const ladder = ladderSettings(s).ladder;
    const keys = new Set(SETTLEMENT_LADDERS[ladder].tiers.map((x) => x.id));
    if ([...Object.keys(cmd.after.saleLimits), ...Object.keys(cmd.after.maxRarity)].some((k) => !keys.has(k)))
      throw Error("Each limit belongs to one of this campaign's tiers. Refresh; nothing was saved.");
    const limits = limitsFor(cmd.after, ladder);
    const next: Settlements = { ...s };
    if (Object.keys(limits).length) next.limits = limits;
    else delete next.limits;
    store(journal, next);
    log(`Settlement limits saved: sale cap ${saleCapLabel(cmd.after.sale)}; rarity cap ${cmd.after.rarity ? "on" : "off"}`);
    return;
  }
  const market = readMarketLocations(journal.market);
  const location = market.locations.find((l) => l.id === cmd.locationId);
  const current = s.places[cmd.locationId] ?? null;
  if (JSON.stringify(sortedProfile(current)) !== JSON.stringify(sortedProfile(cmd.before))) throw Error(STALE);
  if (!cmd.profile) {
    if (!current) return;
    delete s.places[cmd.locationId];
    store(journal, s);
    log(`Settlement profile cleared: ${location?.name ?? "a removed place"}`);
    return;
  }
  if (!location) throw Error("This place no longer exists. Refresh.");
  if (!settlementKind(location)) throw Error("Only cities and towns have a settlement tier; an area shares its city's or town's.");
  const tier = settlementTiers(s).find((x) => x.id === cmd.profile!.tier);
  if (!tier) throw Error("Choose a tier from this campaign's ladder.");
  if (cmd.profile.refill !== undefined && cmd.profile.purse === undefined)
    throw Error("Set a merchant purse before its refill.");
  if (!current && Object.keys(s.places).length >= MAX_SETTLEMENTS)
    throw Error(`A campaign keeps at most ${MAX_SETTLEMENTS} settlement profiles.`);
  s.places[cmd.locationId] = cmd.profile;
  store(journal, s);
  log(`Settlement tier saved: ${location.name} · ${tier.name}`);
}
const sortedProfile = (p: SettlementProfile | null) =>
  p && Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
const sortedRecord = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
const sortedLimits = (l: SettlementLimitSettings) => ({
  sale: l.sale,
  saleLimits: sortedRecord(l.saleLimits),
  rarity: l.rarity,
  maxRarity: sortedRecord(l.maxRarity),
});
/**
 * The stored form of the DM's limits on a ladder: only what differs from the defaults, and only
 * for that ladder's tiers.
 */
function limitsFor(l: SettlementLimitSettings, ladder: SettlementLadderSettings["ladder"]): NonNullable<Settlements["limits"]> {
  const tiers = new Map(SETTLEMENT_LADDERS[ladder].tiers.map((t) => [t.id, t]));
  const saleLimits = Object.fromEntries(Object.entries(l.saleLimits).filter(([k, v]) => tiers.has(k) && tiers.get(k)!.saleLimit !== v));
  const maxRarity = Object.fromEntries(Object.entries(l.maxRarity).filter(([k, v]) => tiers.has(k) && tiers.get(k)!.maxRarity !== v));
  return {
    ...(l.sale !== "off" ? { sale: l.sale } : {}),
    ...(Object.keys(saleLimits).length ? { saleLimits } : {}),
    ...(!l.rarity ? { rarityOff: true as const } : {}),
    ...(Object.keys(maxRarity).length ? { maxRarity } : {}),
  };
}
const sortedSettings = (s: SettlementLadderSettings) => ({
  ladder: s.ladder,
  names: Object.fromEntries(Object.entries(s.names).sort(([a], [b]) => a.localeCompare(b))),
});

/**
 * A location removed, or changed to a region or an area, keeps no profile (market-location
 * command, commands.ts). True when a profile was removed.
 */
export function dropSettlementProfile(journal: { settlements?: unknown }, locationId: string): boolean {
  if (!journal.settlements) return false;
  const s = safeSettlements(journal);
  if (!s.places[locationId]) return false;
  delete s.places[locationId];
  store(journal, s);
  return true;
}

/**
 * A player's settlements (projectRecord): the ladder, and for each place the seat can see
 * (`visibleLocationIds`, the projected market) only its tier and population, plus the names of the
 * tiers those places use (privacy review of S1: a renamed tier no visible place uses is the DM's).
 * The new-shop overrides (wealth, purse, refill) and the rarity cap are the DM's. S2: when the
 * sale cap is on, the mode and each visible place's effective limit (players see the limit in the
 * breakdown of a sale they make there); never the per-tier table or other places' limits.
 */
export function projectSettlements(journal: { settlements?: unknown }, visibleLocationIds: ReadonlySet<string>): void {
  if (!journal.settlements) return;
  const s = safeSettlements(journal);
  const tiers = settlementTiers(s);
  const sale = limitSettings(s).sale;
  const places = Object.fromEntries(
    Object.entries(s.places)
      .filter(([locationId]) => visibleLocationIds.has(locationId))
      .map(([locationId, p]) => {
        const tier = tiers.find((t) => t.id === p.tier);
        return [
          locationId,
          {
            tier: p.tier,
            ...(p.population ? { population: p.population } : {}),
            ...(sale !== "off" && tier ? { saleLimit: effectiveSaleLimit(s, { profile: p, tier }) } : {}),
          },
        ];
      }),
  );
  if (!Object.keys(places).length) {
    delete journal.settlements;
    return;
  }
  const used = new Set(Object.values(places).map((p) => p.tier));
  const names = Object.fromEntries(Object.entries(s.names ?? {}).filter(([tier]) => used.has(tier)));
  journal.settlements = {
    ...(s.ladder ? { ladder: s.ladder } : {}),
    ...(Object.keys(names).length ? { names } : {}),
    ...(sale !== "off" ? { limits: { sale } } : {}),
    places,
  };
}
