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
 * - Players (`projectSettlements`, called from `projectRecord`) receive the ladder, tier names and
 *   only the profiles of places they can already see, with tier and population only; the
 *   new-shop overrides stay with the DM.
 */
import { locationPath, readMarketLocations, type MarketLocation, type MarketLocations } from "./shop-locations.ts";
import {
  DEFAULT_SETTLEMENT_LADDER,
  MAX_SETTLEMENTS,
  SETTLEMENT_LADDERS,
  settlementsSchema,
  type SettlementCommand,
  type SettlementLadderSettings,
  type SettlementProfile,
  type Settlements,
  type SettlementTier,
} from "./settlements-schema.ts";
import { BUY_RATE } from "./scale.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Wealth } from "./types.ts";

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

const STALE = "This place's settlement changed elsewhere. Refresh before saving; nothing was saved.";
const STALE_LADDER = "The settlement ladder changed elsewhere. Refresh before saving; nothing was saved.";

function store(journal: { settlements?: unknown }, s: Settlements) {
  const empty = !Object.keys(s.places).length && !s.ladder && !(s.names && Object.keys(s.names).length);
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
    store(journal, next);
    log(`Settlement ladder saved: ${SETTLEMENT_LADDERS[cmd.after.ladder].name}`);
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
 * A player's settlements (projectRecord): the ladder and tier names, and for each place the seat
 * can see (`visibleLocationIds`, the projected market) only its tier and population. The new-shop
 * overrides (wealth, purse, refill) are the DM's.
 */
export function projectSettlements(journal: { settlements?: unknown }, visibleLocationIds: ReadonlySet<string>): void {
  if (!journal.settlements) return;
  const s = safeSettlements(journal);
  const places = Object.fromEntries(
    Object.entries(s.places)
      .filter(([locationId]) => visibleLocationIds.has(locationId))
      .map(([locationId, p]) => [locationId, { tier: p.tier, ...(p.population ? { population: p.population } : {}) }]),
  );
  if (!Object.keys(places).length) {
    delete journal.settlements;
    return;
  }
  journal.settlements = {
    ...(s.ladder ? { ladder: s.ladder } : {}),
    ...(s.names && Object.keys(s.names).length ? { names: s.names } : {}),
    places,
  };
}
