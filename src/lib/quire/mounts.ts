import type { Holding } from "./types.ts";

/**
 * Whether a holding looks like a riding or pack animal (horse, pony, mule…), by name or category.
 * Shared by the journey planner's mount picker and stable bookings so both find the same animals.
 */
export function mountLike(h: Pick<Holding, "name"> & { category?: string }) {
  return /horse|pony|mule|donkey|camel|ox|mount|steed|mare|stallion|riding|pack animal/i.test(`${h.name} ${h.category ?? ""}`);
}
