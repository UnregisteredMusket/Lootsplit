/**
 * Factions, Renown and Favor (owner design 2026-11-05, PR A; the favor market is PR B).
 *
 * - A faction is a guild, cult, house or gang the DM names. It lives in `journal.factions` (at
 *   most `MAX_FACTIONS`, deleted ones included), outside every strict room schema, like
 *   `journal.quests`: older clients drop the key and `preserveJournalMetadata` keeps the stored
 *   list when they write the journal back. Factions change only through the DM's commands below,
 *   which shared rooms run in commands.ts and the device runs through `executeLocalCommand`.
 * - Renown is each character's standing with a faction: an integer from −1000 to 1000. Favor is a
 *   whole number ≥ 0 that characters later spend (PR B). A renown gain earns
 *   floor(gain × `favorRatePercent` / 100) Favor automatically (gain = the renown actually added,
 *   after the ±1000 clamp); a renown loss never removes Favor. The DM may also grant or remove
 *   Favor directly (never below 0). Standing is stored compactly as
 *   `standing[characterId] = [renown, favor]`, and a character at 0/0 has no entry.
 * - Tiers are a Fallout-karma-style ladder of named bands (Vilified … Idolized by default), each
 *   from its `min` up to the next tier's. The party's attitude is the median renown of the party's
 *   current characters (player characters travelling with the party and visible; departed,
 *   hidden, non-party and NPC characters are left out). An even count averages the two middle
 *   values, rounded toward 0.
 * - Prices: the median's tier sets a percent per faction (`priceByTier`, or a shop's own
 *   `shopPriceByTier` override), applied to every shop the faction controls directly or through
 *   its location (and that location's areas). Buying multiplies the asking price by
 *   (100 + percent) / 100; selling to the shop multiplies the payout by the inverse, so good
 *   standing makes goods cheaper and sales better. Two factions on one shop both apply. The rate
 *   joins market events in the same once-rounded pipeline (vendors.ts `shopAsking`,
 *   price-breakdown.ts), and each faction is its own labelled line in Why this price?.
 * - Players (`projectFactions`, called from `projectRecord`) get only visible factions; for each,
 *   only their own characters' standing and the party median's tier (never the median score: in
 *   an odd-sized party it is one character's exact renown, and in a party of two it gives the other
 *   score away). Renown and Favor lines of a faction hidden now are withheld too. Hidden factions still change prices: for each visible shop they
 *   change, `journal.factionAdjustments` carries the server's combined rate, shown as "Local
 *   standing", so the price a player sees always equals the charge.
 */
import { z } from "zod";
import { characterVisible, inParty } from "./character-position.ts";
import { isNpc } from "./coin-split.ts";
import { locationPath, readMarketLocations } from "./shop-locations.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Purse, Shop } from "./types.ts";
import { favorMarketSchema, favorRequestsSchema, projectFavorMarket } from "./favor-market-schema.ts";

export const MAX_FACTIONS = 100;
export const MIN_RENOWN = -1000;
export const MAX_RENOWN = 1000;
export const MAX_FAVOR = 1_000_000;
/** A tier's price change, in whole percent: −90% to +500%. */
export const MIN_TIER_PERCENT = -90;
export const MAX_TIER_PERCENT = 500;
/** Factions on one shop combine within ×0.1–×10, like market events. */
export const MIN_FACTION_RATE = 0.1;
export const MAX_FACTION_RATE = 10;
export const MAX_RENOWN_DELTA = 2000;
export const MAX_FACTION_CHANGES = 50;
/** The synthetic "Local standing" effect on a player's copy (never a DM faction ID). */
export const LOCAL_STANDING_ID = "~local-standing";

const id = z.string().min(1).max(150);
/** A faction's ID: letters, digits, "-" and "_" (the form uses a UUID). */
export const factionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/, "A faction ID uses letters, digits, - and _.");
const tierId = z.string().regex(/^[a-z0-9-]{1,40}$/, "A tier key uses lowercase letters, digits and -.");
const renown = z.number().int().min(MIN_RENOWN).max(MAX_RENOWN);
const favor = z.number().int().min(0).max(MAX_FAVOR);
const tierPercent = z.number().int().min(MIN_TIER_PERCENT).max(MAX_TIER_PERCENT);

export const factionTierSchema = z.object({
  id: tierId,
  name: z.string().trim().min(1).max(40),
  /** The lowest renown in this tier; the first tier starts at −1000. */
  min: renown,
});
export type FactionTier = z.infer<typeof factionTierSchema>;
const tiersSchema = z
  .array(factionTierSchema)
  .min(2)
  .max(9)
  .superRefine((tiers, ctx) => {
    if (tiers[0] && tiers[0].min !== MIN_RENOWN)
      ctx.addIssue({ code: "custom", message: "The lowest tier starts at −1000." });
    for (let i = 1; i < tiers.length; i++)
      if (tiers[i]!.min <= tiers[i - 1]!.min)
        ctx.addIssue({ code: "custom", message: "Each tier starts above the one before it." });
    if (new Set(tiers.map((t) => t.id)).size !== tiers.length)
      ctx.addIssue({ code: "custom", message: "Each tier needs its own key." });
  });
const priceTableSchema = z.record(tierId, tierPercent);
export const factionControlsSchema = z.object({
  /** Market (Place hub) locations: every shop there and in its areas. */
  locationIds: z.array(id).max(100),
  shopIds: z.array(id).max(300),
});

/** What the DM edits (faction-save). Standing, visibility and revision change by their own commands. */
export const factionDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(1000),
    /** DM only; never sent to players. */
    note: z.string().max(1000).optional(),
    tiers: tiersSchema,
    /** Favor per 100 renown gained (100: 1 renown = 1 Favor). */
    favorRatePercent: z.number().int().min(0).max(1000),
    controls: factionControlsSchema,
    /** Tier key → percent change on prices at the shops it controls (e.g. −10, +25). */
    priceByTier: priceTableSchema,
    /** A shop's own percent per tier, replacing `priceByTier` at that shop. */
    shopPriceByTier: z.record(id, priceTableSchema).optional(),
  })
  .strict();
export type FactionDraft = z.infer<typeof factionDraftSchema>;

/**
 * A stored faction. Parsed with unknown keys stripped (not strict), so a later field never breaks
 * a reader of this version (PR A's readers drop `favorMarket` and `favorRequests` this way).
 */
export const factionSchema = z.object({
  id: factionIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000),
  note: z.string().max(1000).optional(),
  /** DM only until revealed. */
  hidden: z.literal(true).optional(),
  /** Deleted: kept so its history and standing stay readable; no longer prices or shows. */
  deleted: z.literal(true).optional(),
  tiers: tiersSchema,
  favorRatePercent: z.number().int().min(0).max(1000),
  controls: factionControlsSchema,
  priceByTier: priceTableSchema,
  shopPriceByTier: z.record(id, priceTableSchema).optional(),
  /** characterId → [renown, favor]; a character with neither has no entry. */
  standing: z.record(id, z.tuple([renown, favor])),
  /** The favor market (favor-market.ts, PR B): the DM's entries; none by default. */
  favorMarket: favorMarketSchema.optional(),
  /** Players' requests and the DM's purchases, decided ones kept as history. */
  favorRequests: favorRequestsSchema.optional(),
  /** The definition's revision (faction-save, visibility, delete); standing changes don't bump it. */
  revision: z.number().int().nonnegative(),
  /**
   * A player's copy only (projectFactions): the party median's tier. `renown` is accepted for
   * copies made by a later version but never sent. Never stored in a campaign.
   */
  party: z.object({ tier: tierId, renown: renown.optional() }).strict().optional(),
});
export type Faction = z.infer<typeof factionSchema>;
export const factionsSchema = z
  .array(factionSchema)
  .max(MAX_FACTIONS)
  .superRefine((list, ctx) => {
    if (new Set(list.map((f) => f.id)).size !== list.length)
      ctx.addIssue({ code: "custom", message: "Faction IDs must be unique." });
  });

/**
 * A player's copy only: the combined faction rate (buying) on one visible shop where a faction
 * they may not see takes part. At most one entry per shop.
 */
export const factionAdjustmentSchema = z
  .object({ shopId: id, rate: z.number().min(MIN_FACTION_RATE).max(MAX_FACTION_RATE) })
  .strict();
export type FactionAdjustment = z.infer<typeof factionAdjustmentSchema>;
export const factionAdjustmentsSchema = z.array(factionAdjustmentSchema);

const characterChanges = (min: number, max: number) =>
  z
    .array(
      z
        .object({
          characterId: id,
          delta: z.number().int().min(min).max(max).refine((n) => n !== 0, "Choose a change other than 0."),
        })
        .strict(),
    )
    .min(1)
    .max(MAX_FACTION_CHANGES);
const reason = z.string().trim().min(1).max(200);

export const factionCommands = [
  /** DM: create (`revision` null; the new faction starts hidden) or edit a faction. */
  z
    .object({
      id,
      kind: z.literal("faction-save"),
      factionId: factionIdSchema,
      revision: z.number().int().nonnegative().nullable(),
      faction: factionDraftSchema,
    })
    .strict(),
  /** DM: reveal to players or hide again. */
  z
    .object({ id, kind: z.literal("faction-visibility"), factionId: factionIdSchema, revision: z.number().int().nonnegative(), hidden: z.boolean() })
    .strict(),
  /** DM: delete (kept as history) or restore. */
  z
    .object({ id, kind: z.literal("faction-delete"), factionId: factionIdSchema, revision: z.number().int().nonnegative(), deleted: z.boolean() })
    .strict(),
  /** DM: change renown for one character or the whole party in one command, with a reason. */
  z
    .object({ id, kind: z.literal("faction-renown"), factionId: factionIdSchema, characters: characterChanges(-MAX_RENOWN_DELTA, MAX_RENOWN_DELTA), reason })
    .strict(),
  /** DM: grant (or remove) Favor directly, never below 0, with a reason. */
  z
    .object({ id, kind: z.literal("faction-favor-grant"), factionId: factionIdSchema, characters: characterChanges(-MAX_FAVOR, MAX_FAVOR), reason })
    .strict(),
] as const;
export type FactionCommand = z.infer<(typeof factionCommands)[number]>;
export const factionKinds = new Set<string>(["faction-save", "faction-visibility", "faction-delete", "faction-renown", "faction-favor-grant"]);

/** Suggested ladder and prices (owner design): DM-editable per faction. */
export const DEFAULT_TIERS: FactionTier[] = [
  { id: "vilified", name: "Vilified", min: -1000 },
  { id: "hated", name: "Hated", min: -600 },
  { id: "disliked", name: "Disliked", min: -300 },
  { id: "neutral", name: "Neutral", min: -100 },
  { id: "liked", name: "Liked", min: 100 },
  { id: "admired", name: "Admired", min: 300 },
  { id: "idolized", name: "Idolized", min: 600 },
];
export const DEFAULT_PRICE_BY_TIER: Record<string, number> = {
  vilified: 50,
  hated: 25,
  disliked: 10,
  neutral: 0,
  liked: -5,
  admired: -10,
  idolized: -20,
};
export function defaultFactionDraft(): FactionDraft {
  return {
    name: "",
    description: "",
    tiers: DEFAULT_TIERS.map((t) => ({ ...t })),
    favorRatePercent: 100,
    controls: { locationIds: [], shopIds: [] },
    priceByTier: { ...DEFAULT_PRICE_BY_TIER },
  };
}

type JournalLike = { factions?: unknown; factionAdjustments?: unknown; market?: unknown } | undefined | null;
type PartyTable = { purses: Purse[]; journal?: CloudTable["journal"] | null };

/** The stored factions, read leniently: a campaign without them has none. */
export function readFactions(value: unknown): Faction[] {
  return value === undefined || value === null ? [] : factionsSchema.parse(value);
}
function safeFactions(journal: JournalLike): Faction[] {
  try {
    return readFactions(journal?.factions);
  } catch {
    return [];
  }
}

/** A character a faction can know: a player character (not an NPC, not a fund). */
export function factionCharacter(t: PartyTable, p: Purse | undefined): p is Purse {
  return !!p && p.kind === "character" && p.control !== "npc" && !isNpc(t as Pick<CloudTable, "purses" | "journal">, p);
}
/**
 * The party's current characters, whose renown makes the party median: player characters
 * travelling with the party and visible. Departed (out of the party), hidden and non-party
 * characters, NPCs and exchange treasuries are left out.
 */
export function factionParty(t: PartyTable): Purse[] {
  const table = t as Pick<CloudTable, "purses" | "journal">;
  const treasuries = new Set((t.journal?.tradeEconomy?.exchanges ?? []).map((e) => e.purseId));
  return t.purses.filter(
    (p) => factionCharacter(t, p) && !p.nonParty && !treasuries.has(p.id) && inParty(table, p) && characterVisible(table, p),
  );
}

export function standingOf(f: Pick<Faction, "standing">, characterId: string): { renown: number; favor: number } {
  const entry = f.standing[characterId];
  return { renown: entry?.[0] ?? 0, favor: entry?.[1] ?? 0 };
}
/** The median, rounded toward 0 for an even count; 0 for nobody. */
export function medianRenown(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.trunc((sorted[mid - 1]! + sorted[mid]!) / 2);
}
export function tierFor(tiers: readonly FactionTier[], score: number): FactionTier {
  let found = tiers[0]!;
  for (const t of tiers) if (score >= t.min) found = t;
  return found;
}
/** The party's attitude: median renown (undefined on a player's copy that isn't told it) and tier. */
export function partyAttitude(t: PartyTable, f: Faction): { tier: FactionTier; renown?: number; size: number } {
  if (f.party) {
    const tier = f.tiers.find((x) => x.id === f.party!.tier) ?? tierFor(f.tiers, f.party.renown ?? 0);
    return { tier, ...(f.party.renown !== undefined ? { renown: f.party.renown } : {}), size: 0 };
  }
  const party = factionParty(t);
  const score = medianRenown(party.map((p) => standingOf(f, p.id).renown));
  return { tier: tierFor(f.tiers, score), renown: score, size: party.length };
}

/** Whether a faction controls a shop directly or through its location (or a parent location). */
export function factionControlsShop(
  f: Pick<Faction, "controls">,
  shop: Pick<Shop, "id" | "locationId">,
  market: ReturnType<typeof readMarketLocations>,
): boolean {
  if (f.controls.shopIds.includes(shop.id)) return true;
  if (!f.controls.locationIds.length) return false;
  const controlled = new Set(f.controls.locationIds);
  return locationPath(market, shop.locationId).some((l) => controlled.has(l.id));
}

/** One faction's effect on one shop's prices, for a price breakdown. */
export type FactionEffect = {
  id: string;
  name: string;
  /** The party's tier name. */
  tier: string;
  /** Percent change on buying (selling pays the inverse). */
  percent: number;
  hidden?: true;
  /** A player's copy: the whole combined rate, replacing the product of the other effects. */
  total?: number;
};

/** A faction's percent at one shop for a tier: the shop's override, else the faction's. */
export function factionPercent(f: Pick<Faction, "priceByTier" | "shopPriceByTier">, shopId: string, tierKey: string): number {
  return f.shopPriceByTier?.[shopId]?.[tierKey] ?? f.priceByTier[tierKey] ?? 0;
}

/**
 * The factions that change a shop's prices today, in stored order. Commands, the device and
 * every screen call this. `purses` decides the party median; a player's copy uses the projected
 * party tier instead (and its "Local standing" rate for factions it may not see).
 */
export function factionEffects(journal: JournalLike, purses: Purse[], shop: Pick<Shop, "id" | "locationId">): FactionEffect[] {
  if (!journal?.factions && !journal?.factionAdjustments) return [];
  const factions = safeFactions(journal);
  const market = readMarketLocations(journal.market);
  const table = { purses, journal: journal as CloudTable["journal"] };
  const out: FactionEffect[] = [];
  for (const f of factions) {
    if (f.deleted || !factionControlsShop(f, shop, market)) continue;
    const { tier } = partyAttitude(table, f);
    const percent = factionPercent(f, shop.id, tier.id);
    if (percent === 0) continue;
    out.push({ id: f.id, name: f.name, tier: tier.name, percent, ...(f.hidden ? { hidden: true as const } : {}) });
  }
  const adjustment = findAdjustment(journal, factions, shop.id);
  if (adjustment !== undefined)
    out.push({ id: LOCAL_STANDING_ID, name: "Local standing", tier: "", percent: 0, hidden: true, total: adjustment });
  return out;
}

/**
 * Stored adjustments price only a player's projected copy, whose factions all carry the projected
 * `party`. A campaign with any real faction (the DM's copy, the server's) ignores them.
 */
function findAdjustment(journal: NonNullable<JournalLike>, factions: Faction[], shopId: string) {
  if (!journal.factionAdjustments || !factions.every((f) => f.party)) return undefined;
  try {
    return factionAdjustmentsSchema.parse(journal.factionAdjustments).find((a) => a.shopId === shopId)?.rate;
  } catch {
    return undefined;
  }
}

/** The unclamped product of the effects' buying rates, in ascending percent order. */
export function unlimitedFactionRate(effects: readonly Pick<FactionEffect, "percent" | "total">[]): number {
  const total = effects.find((e) => e.total !== undefined)?.total;
  if (total !== undefined) return total;
  let numerator = 1,
    denominator = 1;
  for (const percent of effects.map((e) => e.percent).sort((a, b) => a - b)) {
    numerator *= 100 + percent;
    denominator *= 100;
  }
  return numerator / denominator;
}
/** What buying is multiplied by: exactly 1 without factions, else within ×0.1–×10. */
export function factionBuyRate(effects: readonly Pick<FactionEffect, "percent" | "total">[]): number {
  if (!effects.length) return 1;
  return Math.min(MAX_FACTION_RATE, Math.max(MIN_FACTION_RATE, unlimitedFactionRate(effects)));
}
/** What a sale to the shop is multiplied by: the inverse of buying (exactly 1 without factions). */
export function factionSaleRate(effects: readonly Pick<FactionEffect, "percent" | "total">[]): number {
  if (!effects.length) return 1;
  return 1 / factionBuyRate(effects);
}

/** IDs of factions players may not see now (hidden or deleted-while-hidden). */
export function hiddenFactionIds(t: { journal?: unknown }): Set<string> {
  const journal = t.journal as JournalLike;
  return new Set(safeFactions(journal).filter((f) => f.hidden).map((f) => f.id));
}

/** An older app (protocol < 29) shows prices without factions; it is never charged them. */
export const OLD_CLIENT_FACTION_PRICE =
  "This price has changed, and this older Lootsplitter app can't show the new one. Finish this on the updated website; nothing was charged or paid.";

/** "+10%" or "−5%". */
export function percentText(percent: number): string {
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent)}%`;
}

type FactionTable = Pick<CloudTable, "purses" | "shops" | "journal">;
const STALE = "This faction changed on another device. Refresh before saving; nothing was saved.";

function assertDraft(t: FactionTable, draft: FactionDraft) {
  const tierKeys = new Set(draft.tiers.map((x) => x.id));
  const known = (table: Record<string, number>) => Object.keys(table).every((k) => tierKeys.has(k));
  if (!known(draft.priceByTier)) throw Error("Each price belongs to one of this faction's tiers.");
  const shops = new Set(t.shops.map((s) => s.id));
  const locations = new Set(readMarketLocations(t.journal?.market).locations.map((l) => l.id));
  if (draft.controls.shopIds.some((s) => !shops.has(s))) throw Error("Choose existing shops for this faction.");
  if (draft.controls.locationIds.some((l) => !locations.has(l))) throw Error("Choose existing locations for this faction.");
  if (new Set(draft.controls.shopIds).size !== draft.controls.shopIds.length || new Set(draft.controls.locationIds).size !== draft.controls.locationIds.length)
    throw Error("Each shop and location can be listed once.");
  for (const [shopId, table] of Object.entries(draft.shopPriceByTier ?? {})) {
    if (!shops.has(shopId)) throw Error("A shop price belongs to an existing shop.");
    if (!known(table)) throw Error("Each shop price belongs to one of this faction's tiers.");
  }
}

/**
 * Apply a faction command (DM only). Shared rooms run it in commands.ts; the device runs the same
 * command through `executeLocalCommand`. Every renown or Favor change writes one history event per
 * character (who, change, reason), on that character's purse so its player reads their own; a
 * hidden faction's are DM-only. Definition changes write one DM-only event.
 */
export function applyFactionCommand(
  t: FactionTable,
  seat: Pick<CloudSeat, "role">,
  cmd: FactionCommand,
  log: (summary: string, options: { purseId?: string; dmOnly?: boolean; factionId?: string }) => void,
): void {
  if (seat.role !== "dm") throw Error("Only the DM can change factions.");
  const journal = t.journal as { factions?: Faction[] } & NonNullable<CloudTable["journal"]>;
  const factions = readFactions(journal.factions);
  const current = factions.find((f) => f.id === cmd.factionId);
  const save = () => (journal.factions = factions);
  if (cmd.kind === "faction-save") {
    assertDraft(t, cmd.faction);
    const d = cmd.faction;
    const fields = {
      name: d.name,
      description: d.description,
      ...(d.note?.trim() ? { note: d.note.trim() } : {}),
      tiers: d.tiers,
      favorRatePercent: d.favorRatePercent,
      controls: d.controls,
      priceByTier: d.priceByTier,
      ...(d.shopPriceByTier && Object.keys(d.shopPriceByTier).length ? { shopPriceByTier: d.shopPriceByTier } : {}),
    };
    if (cmd.revision === null) {
      if (current) throw Error("This faction already exists. Refresh before adding it again.");
      if (factions.length >= MAX_FACTIONS)
        throw Error(`A campaign keeps at most ${MAX_FACTIONS} factions, deleted ones included.`);
      factions.push(factionSchema.parse({ id: cmd.factionId, ...fields, hidden: true, standing: {}, revision: 0 }));
      save();
      log(`Faction added (hidden from players): ${d.name}`, { dmOnly: true });
      return;
    }
    if (!current || current.revision !== cmd.revision) throw Error(STALE);
    if (current.deleted) throw Error("Restore this faction before editing it.");
    const next = factionSchema.parse({
      id: current.id,
      ...fields,
      ...(current.hidden ? { hidden: true } : {}),
      standing: current.standing,
      // The favor market changes only through its own commands (favor-market.ts).
      ...(current.favorMarket ? { favorMarket: current.favorMarket } : {}),
      ...(current.favorRequests ? { favorRequests: current.favorRequests } : {}),
      revision: current.revision + 1,
    });
    factions[factions.indexOf(current)] = next;
    save();
    log(`Faction edited: ${next.name}`, { dmOnly: true });
    return;
  }
  if (!current) throw Error("This faction no longer exists. Refresh.");
  if (cmd.kind === "faction-visibility" || cmd.kind === "faction-delete") {
    if (current.revision !== cmd.revision) throw Error(STALE);
    if (cmd.kind === "faction-visibility") {
      if (current.deleted) throw Error("Restore this faction first.");
      if (!!current.hidden === cmd.hidden) return;
      if (cmd.hidden) current.hidden = true;
      else delete current.hidden;
      log(`Faction ${cmd.hidden ? "hidden from players" : "revealed to players"}: ${current.name}`, { dmOnly: true });
    } else {
      if (!!current.deleted === cmd.deleted) return;
      if (cmd.deleted) current.deleted = true;
      else delete current.deleted;
      log(`Faction ${cmd.deleted ? "deleted (kept as history)" : "restored"}: ${current.name}`, { dmOnly: true });
    }
    current.revision += 1;
    save();
    return;
  }
  if (current.deleted) throw Error("Restore this faction before changing renown or Favor.");
  const ids = cmd.characters.map((c) => c.characterId);
  if (new Set(ids).size !== ids.length) throw Error("Each character can be listed once.");
  const characters = cmd.characters.map((c) => {
    const p = t.purses.find((x) => x.id === c.characterId);
    if (!factionCharacter(t, p)) throw Error("Choose player characters for renown and Favor.");
    return p;
  });
  // All-or-nothing: every change is checked before any is applied.
  const planned = cmd.characters.map((c, i) => {
    const before = standingOf(current, c.characterId);
    if (cmd.kind === "faction-renown") {
      const renown = Math.min(MAX_RENOWN, Math.max(MIN_RENOWN, before.renown + c.delta));
      const gain = Math.max(0, renown - before.renown);
      const earned = Math.floor((gain * current.favorRatePercent) / 100);
      return { p: characters[i]!, before, renown, favor: Math.min(MAX_FAVOR, before.favor + earned), earned };
    }
    const favor = before.favor + c.delta;
    if (favor < 0) throw Error(`${characters[i]!.name} has only ${before.favor} Favor with ${current.name}.`);
    if (favor > MAX_FAVOR) throw Error(`Favor stays at most ${MAX_FAVOR.toLocaleString("en")}.`);
    return { p: characters[i]!, before, renown: before.renown, favor, earned: 0 };
  });
  const dmOnly = !!current.hidden;
  for (const step of planned) {
    if (step.renown === 0 && step.favor === 0) delete current.standing[step.p.id];
    else current.standing[step.p.id] = [step.renown, step.favor];
    const tier = tierFor(current.tiers, step.renown).name;
    const summary =
      cmd.kind === "faction-renown"
        ? `${step.p.name}: renown with ${current.name} ${signedNumber(step.renown - step.before.renown)} (now ${plainNumber(step.renown)}, ${tier})${step.earned ? ` · +${step.earned} Favor` : ""} · ${cmd.reason}`
        : `${step.p.name}: Favor with ${current.name} ${signedNumber(step.favor - step.before.favor)} (now ${step.favor}) · ${cmd.reason}`;
    log(summary.slice(0, 500), { purseId: step.p.id, factionId: current.id, ...(dmOnly ? { dmOnly: true } : {}) });
  }
  save();
}
const plainNumber = (n: number) => (n < 0 ? `−${-n}` : String(n));
const signedNumber = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/**
 * A player's factions (projectRecord). Runs on the whole campaign `table` (the median, hidden
 * factions and controls are decided there) and writes into the projected `journal`:
 * - only visible, undeleted factions, without the DM's note;
 * - `standing` holds only the seat's own characters;
 * - `party` carries the party median's tier (not the score);
 * - prices only for the party's tier, and controls only for shops and locations the seat can see;
 * - `factionAdjustments` gives, per visible shop where a hidden faction changes the rate, the
 *   server's combined rate, so the player's price equals the charge.
 * A copy projected again (an archive, a player's device) keeps its own projected values.
 */
export function projectFactions(
  table: PartyTable,
  journal: NonNullable<CloudTable["journal"]>,
  seat: Pick<CloudSeat, "purseIds">,
  visible: { shops: Pick<Shop, "id" | "locationId">[]; locationIds: Set<string> },
  /** Factions hidden now (an archived session is projected with today's hidden factions). */
  hiddenNow: ReadonlySet<string> = new Set(),
): void {
  const target = journal as { factions?: Faction[]; factionAdjustments?: FactionAdjustment[] };
  const source = table.journal as JournalLike;
  if (!source?.factions && !source?.factionAdjustments) {
    delete target.factions;
    delete target.factionAdjustments;
    return;
  }
  const all = safeFactions(source);
  const market = readMarketLocations(source.market);
  const own = new Set(seat.purseIds);
  const alreadyProjected = all.every((f) => f.party);
  // A seat without a character (a guest holding no seat) gets no faction at all; prices still
  // match the charge through the combined rate below.
  const shown = own.size ? all.filter((f) => !f.hidden && !f.deleted && !hiddenNow.has(f.id)) : [];
  const factions = shown.map((f): Faction => {
    const { tier } = partyAttitude(table, f);
    const shops = visible.shops.filter((s) => factionControlsShop(f, s, market)).map((s) => s.id);
    const overrides = Object.fromEntries(
      shops.flatMap((shopId) => {
        const v = f.shopPriceByTier?.[shopId]?.[tier.id];
        return v === undefined ? [] : [[shopId, { [tier.id]: v }]];
      }),
    );
    const projected: Faction = {
      id: f.id,
      name: f.name,
      description: f.description,
      tiers: f.tiers,
      favorRatePercent: f.favorRatePercent,
      controls: { locationIds: f.controls.locationIds.filter((l) => visible.locationIds.has(l)), shopIds: shops },
      priceByTier: f.priceByTier[tier.id] === undefined ? {} : { [tier.id]: f.priceByTier[tier.id]! },
      ...(Object.keys(overrides).length ? { shopPriceByTier: overrides } : {}),
      standing: Object.fromEntries(Object.entries(f.standing).filter(([characterId]) => own.has(characterId))),
      revision: 0,
      // The party's tier only: the median score itself is one character's exact renown in an
      // odd-sized party (and gives the other's away in a party of two), so it stays with the DM.
      party: f.party ? { tier: f.party.tier } : { tier: tier.id },
    };
    // The favor market: visible entries without secrets or notes, and only this seat's requests.
    projectFavorMarket(f, projected, own);
    return projected;
  });
  const adjustments: FactionAdjustment[] = [];
  const shopIds = new Set(visible.shops.map((s) => s.id));
  if (alreadyProjected) {
    try {
      adjustments.push(...factionAdjustmentsSchema.parse(source.factionAdjustments ?? []).filter((a) => shopIds.has(a.shopId)));
    } catch {
      /* An unreadable copy prices without them. */
    }
  } else if (shown.length !== all.filter((f) => !f.deleted).length) {
    const projectedJournal = { factions, market: source.market };
    for (const shop of visible.shops) {
      const full = factionBuyRate(factionEffects(source, table.purses, shop));
      const seen = factionBuyRate(factionEffects(projectedJournal, [], shop));
      if (full !== seen) adjustments.push({ shopId: shop.id, rate: full });
    }
  }
  if (factions.length) target.factions = factions;
  else delete target.factions;
  if (adjustments.length) target.factionAdjustments = adjustments;
  else delete target.factionAdjustments;
}
