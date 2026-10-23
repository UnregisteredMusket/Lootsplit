import type { Holding } from "./types.ts";
/** Owner decision (2026-10-23): nobody gives, sells, lists or equips a pooled item until the DM resolves it. */
export const POOL_GUARD =
  "This item is in the treasure pool. The DM resolves it from Review Inbox, or takes it out of the pool first.";
export function assertNotPooled(h: Pick<Holding, "pool">) {
  if (h.pool) throw Error(POOL_GUARD);
}
/**
 * The item is in hand: not stored, reserved or in the treasure pool. `allowPooled` is only for
 * the DM deleting an item or an account (its open claims are dropped with it).
 */
export function assertCarried(h: Holding, allowPooled = false) {
  if (!allowPooled) assertNotPooled(h);
  if (h.custody || h.reservedFor)
    throw Error(
      "Retrieve this item from its property first. Goods in storage, delivery or reserved for work cannot be equipped, consumed, sold or given remotely.",
    );
}
