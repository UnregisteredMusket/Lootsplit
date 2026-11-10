/**
 * Settlement tiers, phases S1 and S2 (owner design and decisions 2026-11-10): stored shapes, the
 * two tier ladders and the DM's commands. A settlement profile says how big a city or town is (its tier on the campaign's
 * ladder), optionally its population in words, and optionally the defaults a NEW shop there starts
 * with (wealth, merchant purse and refill).
 *
 * Profiles live in `journal.settlements.places`, keyed by market location ID, outside the strict
 * market location schema (shop-locations.ts), like `journal.quests`: older clients' journal parser
 * drops the key without error and `preserveJournalMetadata` keeps the stored copy when they write
 * the journal back, so no tabletop protocol bump is needed. Stored profiles are parsed with unknown
 * keys stripped (not strict) so a later field (sale caps, rarity caps: S2/S3) never breaks this
 * version. Settlements change only through the commands below (settlements.ts), which shared rooms
 * and the device run through the same `applyCommand`.
 *
 * A tier only sets defaults when a shop is created; it never rewrites a shop's stored wealth or
 * purse. A place without a profile behaves exactly as before.
 *
 * S2 (limits, `journal.settlements.limits` and two optional profile fields): a per-item sale cap
 * (off unless the DM turns it on; refuse or pay at the limit) and a rarity cap on generated shop
 * stock (on for places with a tier unless the DM turns it off). Both read the tier's default here,
 * the DM's per-tier value in `limits`, or the place's own override (`saleLimit`, `maxRarity`).
 */
import { z } from "zod";
import { MAX_MERCHANT_PURSE } from "./merchant.ts";
import type { ItemRarity, Wealth } from "./types.ts";

const id = z.string().min(1).max(150);
const tierId = z.string().regex(/^[a-z0-9-]{1,40}$/, "A tier key uses lowercase letters, digits and -.");
const wealth = z.enum(["poor", "modest", "rich", "princely"]);
const copper = z.number().int().min(0).max(MAX_MERCHANT_PURSE);
/** A per-item sale limit: whole copper, at least 1 cp (0 would make every sale free or refused). */
const limitCopper = z.number().int().min(1).max(MAX_MERCHANT_PURSE);
/** The catalog's four stock rarities (types.ts `ItemRarity`), lowest first. */
export const STOCK_RARITIES = ["common", "uncommon", "rare", "magic"] as const satisfies readonly ItemRarity[];
const rarity = z.enum(STOCK_RARITIES);

/** At most one profile per market location; a campaign rarely has more than a few dozen. */
export const MAX_SETTLEMENTS = 1000;
export const MAX_POPULATION_TEXT = 60;
export const MAX_TIER_NAME = 40;

export type SettlementTier = {
  id: string;
  name: string;
  wealth: Wealth;
  /** S2: the most a shop here pays for one item, whole copper (Pathfinder 1e base value). */
  saleLimit: number;
  /** S2: the rarest generated stock here (owner's suggestion; "very rare" and "legendary" are the catalog's "magic"). */
  maxRarity: ItemRarity;
};
export const settlementLadderIds = ["pf1", "simple"] as const;
export type SettlementLadderId = (typeof settlementLadderIds)[number];

/**
 * The ladders a DM chooses from (per campaign), each tier with the shop wealth a new shop there
 * starts with. Pathfinder 1e's eight settlement sizes are the default.
 */
export const SETTLEMENT_LADDERS: Record<SettlementLadderId, { name: string; tiers: readonly SettlementTier[] }> = {
  pf1: {
    name: "Eight sizes (Pathfinder)",
    tiers: [
      { id: "thorp", name: "Thorp", wealth: "poor", saleLimit: 5_000, maxRarity: "common" },
      { id: "hamlet", name: "Hamlet", wealth: "poor", saleLimit: 20_000, maxRarity: "common" },
      { id: "village", name: "Village", wealth: "modest", saleLimit: 50_000, maxRarity: "uncommon" },
      { id: "small-town", name: "Small town", wealth: "modest", saleLimit: 100_000, maxRarity: "uncommon" },
      { id: "large-town", name: "Large town", wealth: "rich", saleLimit: 200_000, maxRarity: "rare" },
      { id: "small-city", name: "Small city", wealth: "rich", saleLimit: 400_000, maxRarity: "rare" },
      { id: "large-city", name: "Large city", wealth: "princely", saleLimit: 800_000, maxRarity: "magic" },
      { id: "metropolis", name: "Metropolis", wealth: "princely", saleLimit: 1_600_000, maxRarity: "magic" },
    ],
  },
  simple: {
    name: "Five steps",
    tiers: [
      { id: "village", name: "Village", wealth: "poor", saleLimit: 50_000, maxRarity: "common" },
      { id: "town", name: "Town", wealth: "modest", saleLimit: 100_000, maxRarity: "uncommon" },
      { id: "city", name: "City", wealth: "rich", saleLimit: 400_000, maxRarity: "rare" },
      { id: "large-city", name: "Large city", wealth: "princely", saleLimit: 800_000, maxRarity: "magic" },
      { id: "capital", name: "Capital", wealth: "princely", saleLimit: 1_600_000, maxRarity: "magic" },
    ],
  },
};
export const DEFAULT_SETTLEMENT_LADDER: SettlementLadderId = "pf1";

/**
 * One place's profile. `tier` is a key on the campaign's ladder; `population` is short free text
 * ("about 2,000"). `wealth`, `purse` and `refill` are DM-only overrides of what a new shop here
 * starts with (whole copper). Unknown keys are stripped, so later fields never break this reader.
 */
export const settlementProfileSchema = z.object({
  tier: tierId,
  population: z.string().trim().min(1).max(MAX_POPULATION_TEXT).optional(),
  wealth: wealth.optional(),
  purse: copper.optional(),
  refill: copper.optional(),
  /** S2, DM-only: this place's own per-item sale limit (whole copper), instead of its tier's. */
  saleLimit: limitCopper.optional(),
  /** S2, DM-only: this place's own rarest generated stock, instead of its tier's. */
  maxRarity: rarity.optional(),
});
export type SettlementProfile = z.infer<typeof settlementProfileSchema>;

/** The campaign's ladder and the DM's tier names (tier key → name); missing means the default. */
export const settlementLadderSettingsSchema = z
  .object({
    ladder: z.enum(settlementLadderIds),
    names: z.record(tierId, z.string().trim().min(1).max(MAX_TIER_NAME)),
  })
  .strict();
export type SettlementLadderSettings = z.infer<typeof settlementLadderSettingsSchema>;

/** S2: what happens when one item's payout is above the place's limit (owner: refuse by default). */
export const saleCapModes = ["off", "refuse", "pay-limit"] as const;
export type SaleCapMode = (typeof saleCapModes)[number];
/**
 * S2, the campaign's limits as the DM's form and command carry them, defaults filled in: the sale
 * cap (off by default), the DM's per-tier sale limits (tier key → copper; a missing tier uses its
 * default), whether generated stock is capped by rarity (on by default) and the DM's per-tier
 * rarest stock.
 */
export const settlementLimitSettingsSchema = z
  .object({
    sale: z.enum(saleCapModes),
    saleLimits: z.record(tierId, limitCopper),
    rarity: z.boolean(),
    maxRarity: z.record(tierId, rarity),
  })
  .strict();
export type SettlementLimitSettings = z.infer<typeof settlementLimitSettingsSchema>;
/**
 * S2, stored: only what differs from the defaults (missing `sale` is off, missing `rarityOff` is
 * on). Unknown keys are stripped so a later phase's fields never break this reader. A player's
 * copy holds `sale` only, with each visible place's effective limit on its profile.
 */
export const settlementLimitsSchema = z.object({
  sale: z.enum(["refuse", "pay-limit"]).optional(),
  saleLimits: z.record(tierId, limitCopper).optional(),
  rarityOff: z.literal(true).optional(),
  maxRarity: z.record(tierId, rarity).optional(),
});
export type SettlementLimits = z.infer<typeof settlementLimitsSchema>;

export const settlementsSchema = z.object({
  ladder: z.enum(settlementLadderIds).optional(),
  names: z.record(tierId, z.string().trim().min(1).max(MAX_TIER_NAME)).optional(),
  limits: settlementLimitsSchema.optional(),
  places: z
    .record(id, settlementProfileSchema)
    .default({})
    .refine((places) => Object.keys(places).length <= MAX_SETTLEMENTS, `A campaign keeps at most ${MAX_SETTLEMENTS} settlement profiles.`),
});
export type Settlements = z.infer<typeof settlementsSchema>;

export const settlementCommands = [
  /**
   * DM: set (`profile`) or clear (null) one city's or town's profile. `before` is the profile the
   * DM saw (null when there was none): a change made elsewhere meanwhile refuses the command.
   */
  z
    .object({
      id,
      kind: z.literal("settlement-profile"),
      locationId: id,
      before: settlementProfileSchema.strict().nullable(),
      profile: settlementProfileSchema.strict().nullable(),
    })
    .strict(),
  /** DM: choose the campaign's ladder and rename its tiers. `before` is what the DM saw. */
  z
    .object({
      id,
      kind: z.literal("settlement-ladder"),
      before: settlementLadderSettingsSchema,
      after: settlementLadderSettingsSchema,
    })
    .strict(),
  /**
   * S2, DM: the sale cap (off, refuse or pay at the limit), per-tier sale limits, the rarity cap
   * on generated stock and per-tier rarest stock. `before` is what the DM saw.
   */
  z
    .object({
      id,
      kind: z.literal("settlement-limits"),
      before: settlementLimitSettingsSchema,
      after: settlementLimitSettingsSchema,
    })
    .strict(),
] as const;
export type SettlementCommand = z.infer<(typeof settlementCommands)[number]>;
export const settlementKinds: ReadonlySet<string> = new Set(settlementCommands.map((c) => c.shape.kind.value));
