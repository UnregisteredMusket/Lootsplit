/**
 * Settlement tiers, phase S1 (owner design 2026-11-10): stored shapes, the two tier ladders and the
 * DM's commands. A settlement profile says how big a city or town is (its tier on the campaign's
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
 */
import { z } from "zod";
import { MAX_MERCHANT_PURSE } from "./merchant.ts";
import type { Wealth } from "./types.ts";

const id = z.string().min(1).max(150);
const tierId = z.string().regex(/^[a-z0-9-]{1,40}$/, "A tier key uses lowercase letters, digits and -.");
const wealth = z.enum(["poor", "modest", "rich", "princely"]);
const copper = z.number().int().min(0).max(MAX_MERCHANT_PURSE);

/** At most one profile per market location; a campaign rarely has more than a few dozen. */
export const MAX_SETTLEMENTS = 1000;
export const MAX_POPULATION_TEXT = 60;
export const MAX_TIER_NAME = 40;

export type SettlementTier = { id: string; name: string; wealth: Wealth };
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
      { id: "thorp", name: "Thorp", wealth: "poor" },
      { id: "hamlet", name: "Hamlet", wealth: "poor" },
      { id: "village", name: "Village", wealth: "modest" },
      { id: "small-town", name: "Small town", wealth: "modest" },
      { id: "large-town", name: "Large town", wealth: "rich" },
      { id: "small-city", name: "Small city", wealth: "rich" },
      { id: "large-city", name: "Large city", wealth: "princely" },
      { id: "metropolis", name: "Metropolis", wealth: "princely" },
    ],
  },
  simple: {
    name: "Five steps",
    tiers: [
      { id: "village", name: "Village", wealth: "poor" },
      { id: "town", name: "Town", wealth: "modest" },
      { id: "city", name: "City", wealth: "rich" },
      { id: "large-city", name: "Large city", wealth: "princely" },
      { id: "capital", name: "Capital", wealth: "princely" },
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

export const settlementsSchema = z.object({
  ladder: z.enum(settlementLadderIds).optional(),
  names: z.record(tierId, z.string().trim().min(1).max(MAX_TIER_NAME)).optional(),
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
] as const;
export type SettlementCommand = z.infer<(typeof settlementCommands)[number]>;
export const settlementKinds: ReadonlySet<string> = new Set(settlementCommands.map((c) => c.shape.kind.value));
