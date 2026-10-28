import type { Shop, StockLine } from "./types.ts";
import type { ShelfDraft } from "./compose.ts";

/**
 * Duplicate (design Q9): copies made through the existing create paths. A copy never carries
 * money, held items, history or links that belong to the original (trade-exchange stock links,
 * shop schedules, NPC funds and inventory, a controlling character).
 */

/** "Name (copy)", within the record's name limit. */
export function copyName(name: string, max = 120): string {
  const suffix = " (copy)";
  const base = name.trim() || "Untitled";
  return (base.length + suffix.length > max ? base.slice(0, max - suffix.length).trimEnd() : base) + suffix;
}

/** The copy's shelf: every stock line with its price, quantity and notes, unlinked from trade. */
export function shelfCopy(stock: StockLine[]): ShelfDraft[] {
  return stock.map((line) => ({
    ...(line.service ? { service: true } : {}),
    ...(line.category ? { category: line.category } : {}),
    name: line.name,
    copper: line.copper,
    baseCopper: line.baseCopper,
    quantity: line.quantity,
    rarity: line.rarity,
    notes: line.notes,
  }));
}

/** Shop settings for the copy (applied after it is created); not its schedule or identity. */
export function shopSettingsCopy(shop: Shop, id: string, name: string): Shop {
  const { schedule: _schedule, ...rest } = shop;
  return { ...rest, id, name };
}
