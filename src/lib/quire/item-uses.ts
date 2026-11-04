/**
 * Charges and consumables (loot plan phase 5): an optional `uses` counter on an item holding.
 *
 * - `item-use` spends one use of the holding's current item (the controlling player or the DM;
 *   pooled items: the DM only). When the last use is spent, `whenEmpty: "remove"` removes that
 *   item (a stack drops by one and the next item starts full); `"keep"` leaves it at 0.
 * - `item-recharge` (DM only) sets the current item's uses to any value from 0 to max.
 * - The DM sets or edits the counter itself in Edit item (an ordinary holding edit).
 *
 * Both commands write one journal event keyed by the command ID (no ledger line: no money
 * moves). Shared rooms run them in `commands.ts`; the device runs the same command through
 * `executeLocalCommand`. Holdings are not strictly parsed, so older clients keep the field.
 */
import { z } from "zod";
import type { Holding } from "./types.ts";

export const MAX_USES = 1000;
const count = z.number().int().min(0).max(MAX_USES);
export const holdingUsesSchema = z
  .object({
    current: count,
    max: count.min(1),
    whenEmpty: z.enum(["remove", "keep"]),
  })
  .strict()
  .refine((uses) => uses.current <= uses.max, { message: "Uses left can't be more than the maximum." });
export type HoldingUses = z.infer<typeof holdingUsesSchema>;

const expectSchema = z.object({ current: count, quantity: z.number().int().min(1).max(100000) }).strict();
export const itemUseCommands = [
  /** Spend one use of the holding's current item. `expect` is what the player was shown. */
  z.object({ id: z.string().min(1).max(150), kind: z.literal("item-use"), holdingId: z.string().min(1).max(150), expect: expectSchema }).strict(),
  /** DM: set the current item's uses left to `current` (0 to max). */
  z
    .object({
      id: z.string().min(1).max(150),
      kind: z.literal("item-recharge"),
      holdingId: z.string().min(1).max(150),
      expect: expectSchema,
      current: count,
    })
    .strict(),
] as const;
export type ItemUseCommand = z.infer<(typeof itemUseCommands)[number]>;

/** A problem with a holding's uses, or null. Used by validation and the device's item edit. */
export function usesProblem(holding: Pick<Holding, "kind" | "uses">): string | null {
  if (holding.uses === undefined) return null;
  if (holding.kind !== "item") return "Only items can track uses.";
  const parsed = holdingUsesSchema.safeParse(holding.uses);
  return parsed.success ? null : `Uses must be whole numbers from 0 to ${MAX_USES}, with uses left no more than the maximum.`;
}

export function usesLabel(uses: HoldingUses): string {
  return uses.current === 0 ? `0/${uses.max} uses · used up` : `${uses.current}/${uses.max} uses`;
}

/**
 * The uses a moved part of a stack carries. The current (partly used) item stays with the
 * source while any of the stack stays; moved items start full. A whole stack keeps its uses.
 */
export function movedUses(source: Holding, remaining: number): { uses?: HoldingUses } {
  if (!source.uses) return {};
  return { uses: remaining > 0 ? { ...source.uses, current: source.uses.max } : { ...source.uses } };
}

type Event = (
  summary: string,
  kind: "management",
  purseId: string,
  change: { entity: "holding"; entityId: string; before: Record<string, number | string>; after: Record<string, number | string> | null },
) => void;

/**
 * Apply an `item-use` or `item-recharge` to the table. `authorize` checks who may act on the
 * holding (commands.ts: the DM, or `own()` of the holder for a use of an unpooled item).
 */
export function applyItemUseCommand(
  t: { holdings: Holding[]; purses: { id: string; name: string }[] },
  cmd: ItemUseCommand,
  authorize: { dm: () => void; own: (purseId: string) => void; assertCarried: (h: Holding) => void },
  event: Event,
): void {
  const h = t.holdings.find((x) => x.id === cmd.holdingId);
  if (!h) throw Error("This item is no longer in the inventory.");
  if (cmd.kind === "item-recharge") authorize.dm();
  else if (h.pool) authorize.dm();
  else authorize.own(h.purseId);
  if (!h.uses) throw Error("This item doesn't track uses. The DM can add uses in Edit item.");
  if (h.uses.current !== cmd.expect.current || h.quantity !== cmd.expect.quantity)
    throw Error("This item changed. Review it and try again.");
  const holder = t.purses.find((p) => p.id === h.purseId)?.name ?? "Unassigned";
  const { max } = h.uses;
  const before = { current: h.uses.current, max, quantity: h.quantity };
  if (cmd.kind === "item-recharge") {
    if (cmd.current > max) throw Error(`Choose 0 to ${max} uses.`);
    if (cmd.current === h.uses.current) throw Error(`${h.name} already has ${cmd.current} of ${max} uses.`);
    h.uses = { ...h.uses, current: cmd.current };
    event(`Recharged ${h.name} (${holder}): ${before.current} → ${cmd.current} of ${max} uses`, "management", h.purseId, {
      entity: "holding",
      entityId: h.id,
      before,
      after: { current: cmd.current, max, quantity: h.quantity },
    });
    return;
  }
  // Stored, delivered or reserved goods are not in hand (custody.ts); the pool was checked above.
  authorize.assertCarried({ ...h, pool: undefined });
  if (h.uses.current === 0) throw Error(`${h.name} has no uses left. The DM can recharge it.`);
  const left = h.uses.current - 1;
  let summary: string;
  let after: Record<string, number | string> | null;
  if (left > 0 || h.uses.whenEmpty === "keep") {
    h.uses = { ...h.uses, current: left };
    after = { current: left, max, quantity: h.quantity };
    summary =
      left > 0
        ? `Used ${h.name} (${holder}): ${left} of ${max} uses left`
        : `Used the last use of ${h.name} (${holder}): 0 of ${max} left, kept until recharged`;
  } else if (h.quantity > 1) {
    h.quantity -= 1;
    h.uses = { ...h.uses, current: max };
    after = { current: max, max, quantity: h.quantity, removed: 1 };
    summary = `Used up one ${h.name} (${holder}): removed; ${h.quantity} left, the next at ${max} of ${max} uses`;
  } else {
    t.holdings.splice(t.holdings.indexOf(h), 1);
    after = null;
    summary = `Used up ${h.name} (${holder}): removed from the inventory`;
  }
  event(summary, "management", h.purseId, { entity: "holding", entityId: h.id, before, after });
}
