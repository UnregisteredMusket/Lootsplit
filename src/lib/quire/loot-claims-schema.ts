/**
 * Party treasure pool and item claims (future-development prompt 2, phase 2): stored shapes only.
 * Every field is optional on existing records, so older saves, backups, rooms and awards load
 * unchanged. The engine lives in loot-claims.ts; the commands are registered in commands.ts.
 */
import { z } from "zod";

const id = z.string().min(1).max(150);
const at = z.number().int().nonnegative();
const whole = z.number().int().nonnegative().max(1e12);
const units = z.number().int().min(1).max(100000);

export const LOOT_CHOICES = ["need", "greed", "pass"] as const;
export type LootChoice = (typeof LOOT_CHOICES)[number];
export const lootChoiceSchema = z.enum(LOOT_CHOICES);
/** How an award was decided for one recipient: their claim, or the DM's own choice. */
export const lootAwardChoiceSchema = z.enum(["need", "greed", "pass", "dm"]);
export type LootAwardChoice = z.infer<typeof lootAwardChoiceSchema>;
export const LOOT_METHODS = ["manual", "random", "round-robin"] as const;
export type LootMethod = (typeof LOOT_METHODS)[number];
export const MAX_LOOT_LOTS = 50;
export const MAX_LOOT_ROLLS = 20;

/** A party-fund holding's treasure-pool marker. Absent on every holding that is not pooled. */
export const lootPoolMarkerSchema = z
  .object({
    at,
    source: z.enum(["encounter", "add-loot", "dm"]),
    encounterId: id.optional(),
    receiptId: id.optional(),
  })
  .strict();
export type LootPoolMarker = z.infer<typeof lootPoolMarkerSchema>;

/** One open claim: at most one per (lot, character). Removed when its lot leaves the pool. */
export const lootClaimSchema = z
  .object({
    holdingId: id,
    purseId: id,
    choice: lootChoiceSchema,
    at,
    /** "dm": marked by the DM for this character (one shared device at the table). */
    by: z.enum(["player", "dm"]),
    commandId: id,
  })
  .strict();
export type LootClaim = z.infer<typeof lootClaimSchema>;

export const lootClaimsSchema = z
  .object({
    claims: z.array(lootClaimSchema).max(20000).default([]),
    /** Round-robin: the last character who received a pool item. Separate from coin split's. */
    rotation: z.object({ lastPurseId: id }).strict().optional(),
  })
  .strict();
export type LootClaims = z.infer<typeof lootClaimsSchema>;

/** Journal event payload: one claim change (history; the open claim list stays small). */
export const lootClaimEventSchema = z
  .object({
    holdingId: id,
    purseId: id,
    name: z.string().max(200),
    choice: lootChoiceSchema,
    previous: lootChoiceSchema.nullable(),
    by: z.enum(["player", "dm"]),
  })
  .strict();

/** Journal event payload: a lot entered or left the pool without being resolved. */
export const lootPoolEventSchema = z
  .object({
    holdingId: id,
    name: z.string().max(200),
    quantity: units,
    pooled: z.boolean(),
    source: z.enum(["encounter", "add-loot", "dm"]).optional(),
    receiptId: id.optional(),
  })
  .strict();

const lotClaimSnapshot = z
  .object({ purseId: id, choice: lootChoiceSchema, at, by: z.enum(["player", "dm"]).optional() })
  .strict();
/** Journal event payload: one resolution's receipt, with the claims and rolls it used. */
export const lootResolutionSchema = z
  .object({
    id,
    method: z.enum(LOOT_METHODS),
    rolls: z.enum(["server", "local", "manual"]).optional(),
    lots: z
      .array(
        z
          .object({
            holdingId: id,
            fundId: id,
            name: z.string().max(200),
            poolQuantity: units,
            quantity: units,
            unitCopper: whole,
            tier: z.enum(["need", "greed"]).nullable(),
            claims: z.array(lotClaimSnapshot).max(100),
            /** Characters in the lot's tier who had not marked a claim (counted as Pass). */
            unmarked: z.array(id).max(100).default([]),
            rolls: z
              .array(z.object({ purseId: id, d100: z.array(z.number().int().min(1).max(100)).min(1).max(MAX_LOOT_ROLLS) }).strict())
              .max(100)
              .default([]),
            awards: z
              .array(z.object({ purseId: id, quantity: units, choice: lootAwardChoiceSchema, holdingId: id }).strict())
              .max(100),
            kept: z.number().int().nonnegative().max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_LOOT_LOTS),
    rotationAfter: id.optional(),
    /** An NPC received an item: party members see only the party lines. */
    npc: z.boolean().optional(),
  })
  .strict();
export type LootResolution = z.infer<typeof lootResolutionSchema>;

/** Ledger link: a 0 cp line per item moved, carrying the recorded value (Phase 3 fairness). */
export const lootLedgerSchema = z
  .object({
    id,
    holdingId: id,
    role: z.enum(["award", "added"]),
    choice: lootAwardChoiceSchema.optional(),
    quantity: units,
    unitCopper: whole,
  })
  .strict();
export type LootLedgerLink = z.infer<typeof lootLedgerSchema>;

const base = { id };
export const lootCommands = [
  z
    .object({
      ...base,
      kind: z.literal("loot-claim"),
      holdingId: id,
      purseId: id,
      choice: lootChoiceSchema,
      /** The choice the form showed (null when none); a claim changed elsewhere is refused. */
      before: lootChoiceSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("loot-pool-set"),
      holdingId: id,
      pooled: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("loot-resolve"),
      method: z.enum(LOOT_METHODS),
      lots: z
        .array(
          z
            .object({
              holdingId: id,
              quantity: units,
              /** Manual only: who receives how many (the units add up to `quantity`). */
              awards: z.array(z.object({ purseId: id, quantity: units }).strict()).min(1).max(100).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_LOOT_LOTS),
      /** Random only: rolled by the room server / DM device, or Pen & Paper totals from the DM. */
      rolls: z.enum(["server", "manual"]).optional(),
      manualRolls: z
        .array(
          z
            .object({
              holdingId: id,
              purseId: id,
              d100: z.array(z.number().int().min(1).max(100)).min(1).max(MAX_LOOT_ROLLS),
            })
            .strict(),
        )
        .max(1000)
        .optional(),
      /** The reviewed preview's fingerprint (lots, claims, party and pointer). */
      expect: z.string().min(1).max(64),
    })
    .strict(),
] as const;
export type LootCommand = z.infer<(typeof lootCommands)[number]>;
export const lootKinds = new Set(["loot-claim", "loot-pool-set", "loot-resolve"]);
