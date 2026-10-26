/**
 * Party → Funds & inventory (design plan D3 / P6): display-only grouping of holdings.
 *
 * Nothing here changes saved data. Identical rows are shown as one stack ("Potion of healing ×3")
 * that expands to the real holdings, and every action still runs on one holding with its own
 * command. Bulk actions are planned here so the page can show what will be skipped and resume an
 * interrupted run with the same command IDs (each holding moves at most once).
 */
import type { Holding, Purse } from "./types.ts";

export type InventoryGroupBy = "holder" | "category";

/** The category a row is shown under: its own, a catalogue match, or its kind. */
export function inventoryCategory(
  holding: Pick<Holding, "category" | "kind" | "name">,
  catalog: ReadonlyArray<{ name: string; category: string }> = [],
): string {
  return (
    holding.category ||
    (holding.kind === "property"
      ? "property"
      : catalog.find((c) => c.name.toLowerCase() === holding.name.toLowerCase())?.category) ||
    holding.kind
  );
}

/**
 * Rows stack only when a player could not tell them apart: same holder, name, unit value and
 * category, and the same state (equipped, pooled, stored or reserved, deed or property).
 */
export function stackKey(holding: Holding, category: string): string {
  return JSON.stringify([
    holding.purseId,
    holding.name.trim().toLowerCase(),
    holding.unitCopper,
    category.toLowerCase(),
    holding.kind,
    holding.equipped === true,
    !!holding.pool,
    holding.custody?.kind ?? "",
    holding.reservedFor ?? "",
    !!(holding.deed || holding.property || holding.service),
  ]);
}

export type InventoryStack = {
  key: string;
  category: string;
  holdings: Holding[];
  quantity: number;
  copper: number;
};

export type InventoryGroup = {
  key: string;
  label: string;
  stacks: InventoryStack[];
  quantity: number;
  copper: number;
};

export function stackHoldings(
  holdings: Holding[],
  classify: (holding: Holding) => string,
): InventoryStack[] {
  const stacks = new Map<string, InventoryStack>();
  for (const holding of holdings) {
    const category = classify(holding);
    const key = stackKey(holding, category);
    const stack = stacks.get(key) ?? { key, category, holdings: [], quantity: 0, copper: 0 };
    stack.holdings.push(holding);
    stack.quantity += holding.quantity;
    stack.copper += holding.quantity * holding.unitCopper;
    stacks.set(key, stack);
  }
  return [...stacks.values()];
}

/** Groups by holder (in the order of `purses`) or by category (alphabetical). */
export function groupInventory(
  holdings: Holding[],
  purses: Pick<Purse, "id" | "name">[],
  groupBy: InventoryGroupBy,
  classify: (holding: Holding) => string,
): InventoryGroup[] {
  const order = new Map(purses.map((purse, index) => [purse.id, index]));
  const label = (holding: Holding) =>
    groupBy === "holder"
      ? (purses.find((purse) => purse.id === holding.purseId)?.name ?? "Unassigned")
      : classify(holding);
  const keyOf = (holding: Holding) =>
    groupBy === "holder" ? holding.purseId : classify(holding).toLowerCase();
  const groups = new Map<string, { label: string; rows: Holding[] }>();
  for (const holding of holdings) {
    const key = keyOf(holding);
    const group = groups.get(key) ?? { label: label(holding), rows: [] };
    group.rows.push(holding);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const stacks = stackHoldings(group.rows, classify);
      return {
        key,
        label: group.label,
        stacks,
        quantity: stacks.reduce((sum, stack) => sum + stack.quantity, 0),
        copper: stacks.reduce((sum, stack) => sum + stack.copper, 0),
      };
    })
    .sort((a, b) =>
      groupBy === "holder"
        ? (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER)
        : a.label.localeCompare(b.label),
    );
}

export type BulkAction = "give" | "pool" | "remove";

/** Why one holding cannot take part in a bulk action, or null when it can. */
export function bulkRefusal(
  action: BulkAction,
  holding: Holding,
  context: { partyFundIds: ReadonlySet<string>; toId?: string },
): string | null {
  if (action === "give") {
    if (holding.pool) return "in the treasure pool";
    if (holding.custody || holding.reservedFor) return "stored or reserved at a property";
    if (context.toId && holding.purseId === context.toId) return "already held by the recipient";
    return null;
  }
  if (action === "pool") {
    if (holding.pool) return "already in the treasure pool";
    if (!context.partyFundIds.has(holding.purseId)) return "not held by a party fund";
    if (holding.kind !== "item" || holding.service || holding.deed || holding.property)
      return "not a physical item";
    if (holding.custody || holding.reservedFor) return "stored or reserved at a property";
    if (holding.equipped) return "equipped";
    return null;
  }
  if (holding.custody || holding.reservedFor) return "stored or reserved at a property";
  return null;
}

/** One bulk run: each holding keeps its own command ID for every retry or resume. */
export type BulkRun = {
  id: string;
  action: BulkAction;
  toId?: string;
  items: Array<{ holdingId: string; purseId: string; commandId: string; done?: boolean }>;
};

/**
 * What is left to send when a run resumes: items not confirmed done whose holding is still where
 * the run found it (a give that already landed, a removed holding or a pooled lot is skipped).
 */
export function remainingBulkItems(run: BulkRun, holdings: Holding[]): BulkRun["items"] {
  return run.items.filter((item) => {
    if (item.done) return false;
    const holding = holdings.find((h) => h.id === item.holdingId);
    if (!holding) return false;
    if (run.action === "give") return holding.purseId === item.purseId;
    if (run.action === "pool") return !holding.pool;
    return true;
  });
}

const BULK_STORAGE = "lootsplit.inventory-bulk.v1";

/** The interrupted run on this tab, if any (session storage; never required for correctness). */
export function readBulkRun(): BulkRun | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(BULK_STORAGE);
    if (!raw) return null;
    const run = JSON.parse(raw) as BulkRun;
    if (!run || !Array.isArray(run.items) || !["give", "pool", "remove"].includes(run.action))
      return null;
    return run;
  } catch {
    return null;
  }
}

export function writeBulkRun(run: BulkRun | null): void {
  try {
    if (run) globalThis.sessionStorage?.setItem(BULK_STORAGE, JSON.stringify(run));
    else globalThis.sessionStorage?.removeItem(BULK_STORAGE);
  } catch {
    // Storage blocked: an interrupted run then cannot offer Resume, and nothing runs twice.
  }
}
