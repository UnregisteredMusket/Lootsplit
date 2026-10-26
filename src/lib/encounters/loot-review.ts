/**
 * Loot review helpers (design plan D1, QoL Q2 and Q3; docs/ENCOUNTERS.md).
 *
 * Everything here is presentation or draft state. Nothing moves money or items: the award is still
 * the single `encounters/award` request, guarded by its stored receipt. Copper stays the stored unit.
 */
import { formatCopper, parsePrice } from "../quire/money.ts";

type Row = { id: string; code: string; name: string; status: string };
type Loot = { id: string; quantity: number; unitCopper: number; purseId: string; pool?: boolean };

/** The Loot & rewards tab of one encounter, opened directly (the Desk card, design plan D1). */
export const lootReviewHref = (id: string) =>
  `/encounters?encounter=${encodeURIComponent(id)}&review=1`;

/** Encounters in this campaign that wait for the DM's loot review (Desk card and its count). */
export function lootReviewEncounters<T extends Row>(rows: readonly T[], code: string): T[] {
  return rows.filter((row) => row.code === code && row.status === "review");
}

/** The one encounter to open directly: exactly one active or reviewable encounter, else none. */
export function soleOpenEncounter<T extends Row>(rows: readonly T[], code: string): T | null {
  const open = rows.filter(
    (row) => row.code === code && (row.status === "active" || row.status === "review"),
  );
  return open.length === 1 ? open[0]! : null;
}

/** Loot reviews first, then active battles, then the rest, each keeping its saved order. */
export function sortForReview<T extends { status: string }>(rows: readonly T[]): T[] {
  const rank = (status: string) => (status === "review" ? 0 : status === "active" ? 1 : 2);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row.status) - rank(b.row.status) || a.index - b.index)
    .map(({ row }) => row);
}

/** The largest per-item value the encounter schema accepts (10,000 gp). */
export const MAX_ITEM_COPPER = 1_000_000;

/**
 * A DM-typed item value in gold: "250" or "2.5" or "2.05" is gold (at most two decimals, so the
 * result is whole copper), and "2 gp 5 sp" or "75 cp" use the named coins. Returns copper, or null.
 */
export function parseGpValue(raw: string): number | null {
  const text = raw.trim().replace(/,/g, "");
  if (!text) return null;
  const plain = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  let copper: number | null;
  if (plain) copper = Number(plain[1]) * 100 + Number((plain[2] ?? "").padEnd(2, "0"));
  else if (/^[\d.\s]+$/.test(text)) copper = null;
  else copper = parsePrice(text);
  return copper !== null && Number.isSafeInteger(copper) && copper >= 0 && copper <= MAX_ITEM_COPPER
    ? copper
    : null;
}

/** The gold text an input shows for a stored copper value: 25000 → "250", 205 → "2.05". */
export function gpInputText(copper: number): string {
  const whole = Math.floor(copper / 100),
    rest = copper % 100;
  return rest ? `${whole}.${String(rest).padStart(2, "0")}` : String(whole);
}

/** The live echo under a value input: "= 250 gp", or "= 250 gp each · 500 gp" for several. */
export function valueEcho(unitCopper: number, quantity: number): string {
  const each = formatCopper(unitCopper);
  return quantity > 1
    ? `= ${each} each · ${formatCopper(unitCopper * quantity)}`
    : `= ${each}`;
}

/**
 * Bulk "Assign selected to…" and "Send selected to treasure pool" (Q2). Exactly the per-row
 * semantics: a recipient clears the pool flag; the pool clears the recipient. Draft state only.
 */
export function assignLoot<T extends Loot>(
  loot: readonly T[],
  ids: ReadonlySet<string>,
  target: { purseId: string } | { pool: true },
): T[] {
  return loot.map((item) => {
    if (!ids.has(item.id)) return item;
    const { pool: _pool, ...rest } = item;
    return ("pool" in target
      ? { ...rest, purseId: "", pool: true }
      : { ...rest, purseId: target.purseId }) as T;
  });
}

/** Total listed value of the items (quantity × value each), in copper. */
export function lootValueCopper(loot: readonly Loot[]): number {
  return loot.reduce((sum, item) => sum + item.quantity * item.unitCopper, 0);
}

/** One line for the sticky footer: who receives what, and what still needs a recipient. */
export function recipientSummary(preview: {
  recipients: { name: string }[];
  pool?: { items: unknown[] };
  unresolved: unknown[];
  unresolvedCoins: boolean;
}): string {
  const parts: string[] = [];
  const names = preview.recipients.map((r) => r.name);
  if (names.length)
    parts.push(
      names.length > 3 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", "),
    );
  if (preview.pool) parts.push(`${preview.pool.items.length} to the treasure pool`);
  if (preview.unresolved.length) parts.push(`${preview.unresolved.length} unassigned`);
  if (preview.unresolvedCoins) parts.push("coins unassigned");
  return parts.join(" · ") || "Nothing to transfer";
}

/** Q3: the last coin recipient per campaign. A convenience in this browser only, never authority. */
const recipientKey = (campaign: string) => `lootsplit.award.coinRecipient.${campaign}`;
export function readLastCoinRecipient(campaign: string): string {
  try {
    return globalThis.localStorage?.getItem(recipientKey(campaign)) ?? "";
  } catch {
    return "";
  }
}
export function rememberCoinRecipient(campaign: string, purseId: string): void {
  try {
    if (purseId) globalThis.localStorage?.setItem(recipientKey(campaign), purseId);
  } catch {
    // Storage blocked or full: nothing to remember, and nothing breaks.
  }
}
