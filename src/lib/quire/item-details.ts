/**
 * Item details at award time (loot plan phase 5 follow-up, docs/FEATURE-INVENTORY.md): the DM can
 * set an item's charges (`uses`), attunement requirement (`requiresAttunement`) and presented
 * record (`unidentified`) in the same step that creates it, instead of editing it afterwards.
 *
 * These are the holding's own fields with the holding's own schemas (item-uses.ts, attunement.ts,
 * item-identity.ts); nothing here is a parallel field. Each creation path copies them onto the
 * new holding inside its one atomic write:
 * - encounter awards (cloudflare/encounters.mjs, src/lib/encounters/local.ts, and the treasure-pool
 *   rows in loot-claims.ts `encounterPoolRows`), from the loot row (`lootSchema`);
 * - Add loot (Party → Add loot, into a character, a party fund or the treasure pool), a holding
 *   save on the device and a `patch` in a shared room (economy.ts `saveHolding`);
 * - an NPC's inventory lot (`npc-item`, world.ts).
 *
 * Absent fields mean what they always meant, so older loot rows, drafts and commands create
 * exactly the holding they created before.
 */
import { z } from "zod";
import { requiresAttunementSchema } from "./attunement.ts";
import { holdingUsesSchema, MAX_USES, type HoldingUses } from "./item-uses.ts";
import { presentedRecord, unidentifiedSchema, type Unidentified } from "./item-identity.ts";

/** The optional fields, as a zod shape to spread into an award or create schema. */
export const itemDetailsShape = {
  uses: holdingUsesSchema.optional(),
  requiresAttunement: requiresAttunementSchema.optional(),
  unidentified: unidentifiedSchema.optional(),
};
export const itemDetailsSchema = z.object(itemDetailsShape).strict();
export type ItemDetails = { uses?: HoldingUses; requiresAttunement?: string; unidentified?: Unidentified };

/** Whether `value` carries any of the fields (old rows and commands carry none). */
export function hasItemDetails(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.uses !== undefined || v.requiresAttunement !== undefined || v.unidentified !== undefined;
}

/**
 * The fields to put on a new holding, copied from an award row or form. Only fields that are
 * set are returned, so an item without them creates the same holding as before. The presented
 * record never carries lineage IDs from a client (`ids` is the server's bookkeeping).
 */
export function itemDetailsFor(item: ItemDetails): ItemDetails {
  return {
    ...(item.uses ? { uses: { current: item.uses.current, max: item.uses.max, whenEmpty: item.uses.whenEmpty } } : {}),
    ...(item.requiresAttunement !== undefined ? { requiresAttunement: item.requiresAttunement } : {}),
    ...(item.unidentified ? { unidentified: presentedRecord(item.unidentified) } : {}),
  };
}

/** A problem with the fields for a new holding of `kind`, or null. Same rules as Edit item. */
export function itemDetailsProblem(kind: string, item: ItemDetails): string | null {
  if (!hasItemDetails(item)) return null;
  if (kind !== "item") return "Only items can have charges, attunement or an unidentified record.";
  if (item.uses !== undefined && !holdingUsesSchema.safeParse(item.uses).success)
    return `Uses must be whole numbers from 0 to ${MAX_USES}, with uses left no more than the maximum.`;
  if (item.requiresAttunement !== undefined && !requiresAttunementSchema.safeParse(item.requiresAttunement).success)
    return "Attunement text must be 1 to 200 characters.";
  if (item.unidentified !== undefined && !unidentifiedSchema.safeParse(item.unidentified).success)
    return "Enter the name players see (1 to 160 characters) for an unidentified item.";
  return null;
}

/** "3/3 uses · requires attunement · unidentified": a short summary for a collapsed form. */
export function itemDetailsLabel(item: ItemDetails): string {
  return [
    item.uses ? `${item.uses.current}/${item.uses.max} uses` : "",
    item.requiresAttunement ? "requires attunement" : "",
    item.unidentified ? "unidentified" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
