/**
 * Return to party (owner-approved 2026-11-05): a departed or inactive character's items and coins
 * go back to the party, so nothing is stranded when a character leaves.
 *
 * "Leaving" today: the DM takes a character out of the party or hides it (Character locations,
 * `character-position`), starts its downtime, releases its player's seat (the character stays in
 * the party), or removes its account (its holdings are deleted). None of these moved holdings or
 * coins, and a character away from the party keeps its open treasure-pool claims, which are
 * ignored while it is away. This command is never automatic: the DM chooses which items and how
 * many coins go to the treasure pool or a party fund.
 *
 * One atomic `loot-return` (DM only) moves them: each moved item gets a ledger line on the
 * character and one on the fund, both naming the item as the party knows it; coins move exactly
 * (the same coins when no change is made, otherwise the existing exact-change rule); the
 * character's open pool claims are withdrawn with one event each; an attuned item that leaves
 * ends its attunement through `settleAttunement` (commands.ts), which logs it. Shared rooms run it
 * in commands.ts; the device runs the same command through `executeLocalCommand`.
 *
 * Fairness (loot-fairness.ts): a return is not loot received and does not reduce what the
 * departed character received, like Give. See `docs/FEATURE-INVENTORY.md`.
 */
import { z } from "zod";
import { canonicalJson } from "./canonical-json.ts";
import { characterPosition, characterVisible, inParty } from "./character-position.ts";
import { creditCoins, debitCoins, isNpc, partyFunds } from "./coin-split.ts";
import { assertCarried } from "./custody.ts";
import { knownUnitCopper, presentedHolding } from "./item-identity.ts";
import { movedUses } from "./item-uses.ts";
import { CHOICE_LABEL, hash, readLootClaims } from "./loot-claims.ts";
import type { LootClaims } from "./loot-claims-schema.ts";
import { formatCopper, toCopper } from "./money.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Coins, Holding, Purse } from "./types.ts";

export const MAX_RETURN_ITEMS = 100;
const id = z.string().min(1).max(150);

export const lootReturnCommand = z
  .object({
    id,
    kind: z.literal("loot-return"),
    /** The departed or inactive character. */
    purseId: id,
    /** The party fund that receives; `pool` puts the items in its treasure pool, unclaimed. */
    to: z.object({ fundId: id, pool: z.boolean() }).strict(),
    items: z
      .array(z.object({ holdingId: id, quantity: z.number().int().min(1).max(100000) }).strict())
      .max(MAX_RETURN_ITEMS),
    /** Whole copper. */
    copper: z.number().int().nonnegative().max(1e12),
    /** `returnFingerprint` of what the DM reviewed; anything changed since is refused. */
    expect: z.string().min(1).max(64),
  })
  .strict();
export type LootReturnCommand = z.infer<typeof lootReturnCommand>;

type Table = Pick<CloudTable, "purses" | "holdings" | "journal">;

/** Why this character cannot return items now, or null. */
export function departedProblem(t: Table, p: Purse | undefined): string | null {
  if (!p) return "This character no longer exists.";
  if (p.kind !== "character") return "Only a character's items and coins can be returned to the party.";
  if ((t.journal?.tradeEconomy?.exchanges ?? []).some((e) => e.purseId === p.id))
    return "An exchange treasury stays with its exchange.";
  if (inParty(t, p) && characterVisible(t, p))
    return `${p.name} is travelling with the party. Take them out of the party (or hide them) in Character locations first.`;
  return null;
}

/** True for a character away from the party or hidden (the DM may return its holdings). */
export function isDeparted(t: Table, p: Purse): boolean {
  return departedProblem(t, p) === null;
}

/** Why one holding cannot go back to the party, or null. */
export function returnableProblem(h: Holding): string | null {
  if (h.kind !== "item" || h.service || h.deed || h.property)
    return `${presentedHolding(h).name} is not a physical item. Properties stay with the character; transfer them with Give.`;
  if (h.custody || h.reservedFor)
    return `Retrieve ${presentedHolding(h).name} from its property first; stored or reserved goods cannot be returned.`;
  return null;
}

/** The character's items that may be returned, in name order. */
export function returnableHoldings(t: Table, purseId: string): Holding[] {
  return t.holdings
    .filter((h) => h.purseId === purseId && h.quantity > 0 && returnableProblem(h) === null)
    .sort(
      (a, b) =>
        presentedHolding(a).name.localeCompare(presentedHolding(b).name, "en", { numeric: true }) ||
        (a.id < b.id ? -1 : 1),
    );
}

/** "3 items and 42 gp" (what the prompt says the character left with), or null when nothing. */
export function departedSummary(t: Table, p: Purse): string | null {
  const items = returnableHoldings(t, p.id).length;
  const copper = toCopper(p.coins);
  const parts = [
    ...(items ? [`${items} item${items === 1 ? "" : "s"}`] : []),
    ...(copper ? [formatCopper(copper)] : []),
  ];
  return parts.length ? parts.join(" and ") : null;
}

/**
 * What a reviewed return depends on: the character, its placement, coins, every holding and its
 * open pool claims, and the receiving fund. A form reviewed before any of these changed is refused.
 */
export function returnFingerprint(t: Table, purseId: string, fundId: string): string {
  const p = t.purses.find((x) => x.id === purseId);
  const fund = t.purses.find((x) => x.id === fundId);
  return hash(
    canonicalJson({
      purse: p ? [p.id, p.name, p.kind, p.coins, characterPosition(t, p)] : null,
      fund: fund ? [fund.id, fund.name, fund.kind] : null,
      holdings: t.holdings
        .filter((h) => h.purseId === purseId)
        .map((h) => [h.id, h.name, h.quantity, h.unitCopper, !!h.attuned, !!h.equipped, h.uses?.current ?? null])
        .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
      claims: readLootClaims(t)
        .claims.filter((c) => c.purseId === purseId)
        .map((c) => [c.holdingId, c.choice])
        .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    }),
  );
}

type JournalEvent = NonNullable<CloudTable["journal"]>["events"][number];
type EventFn = (summary: string, kind: "management", purseId?: string) => void;

/** The coins that leave: the same coins when no change is needed, else the exact-change rule. */
function moveCoins(from: Purse, to: Purse, copper: number): void {
  if (!copper) return;
  const after = debitCoins(from, copper);
  const moved: Coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  let exact = true;
  for (const unit of ["cp", "sp", "ep", "gp", "pp"] as const) {
    moved[unit] = from.coins[unit] - after[unit];
    if (moved[unit] < 0) exact = false;
  }
  const credited = exact
    ? Object.fromEntries((["cp", "sp", "ep", "gp", "pp"] as const).map((u) => [u, to.coins[u] + moved[u]]))
    : creditCoins(to.coins, copper);
  if (toCopper(credited as Coins) !== toCopper(to.coins) + copper || toCopper(after) !== toCopper(from.coins) - copper)
    throw Error("The coins do not add up. Nothing moved.");
  if (toCopper(credited as Coins) > 1e12) throw Error("The party fund cannot hold that many coins.");
  from.coins = after;
  to.coins = credited as Coins;
}

/** Apply `loot-return` to a private working copy (the caller commits all or nothing). */
export function applyLootReturn(
  t: CloudTable,
  seat: Pick<CloudSeat, "role">,
  cmd: LootReturnCommand,
  at: number,
  event: EventFn,
): void {
  if (seat.role !== "dm") throw Error("Only the DM can return a character's items and coins to the party.");
  const p = t.purses.find((x) => x.id === cmd.purseId);
  const problem = departedProblem(t, p);
  if (problem) throw Error(problem);
  const character = p!;
  const fund = partyFunds(t).find((x) => x.id === cmd.to.fundId);
  if (!fund) throw Error("Choose an existing party fund.");
  if (returnFingerprint(t, character.id, fund.id) !== cmd.expect)
    throw Error(`${character.name}'s items, coins or claims changed. Nothing moved. Review the return again.`);
  if (new Set(cmd.items.map((i) => i.holdingId)).size !== cmd.items.length)
    throw Error("List each item once.");
  const state = readLootClaims(t);
  const claims = state.claims.filter((c) => c.purseId === character.id);
  if (!cmd.items.length && !cmd.copper && !claims.length)
    throw Error("Choose items or coins to return.");
  if (cmd.copper > toCopper(character.coins))
    throw Error(`${character.name} holds only ${formatCopper(toCopper(character.coins))}.`);

  // Shown names: an unidentified item is named as the party knows it (item-identity.ts). Lines,
  // events and the note the party reads never name a hidden character or an NPC (whose holdings
  // and balance are DM-only).
  const who = characterVisible(t, character) && !isNpc(t, character) ? character.name : null;
  const where = cmd.to.pool ? `the treasure pool (${fund.name})` : fund.name;
  const journal = t.journal!;
  const lastEvent = (): JournalEvent => journal.events[journal.events.length - 1]!;
  let units = 0;
  for (const [i, line] of cmd.items.entries()) {
    const h = t.holdings.find((x) => x.id === line.holdingId);
    if (!h || h.purseId !== character.id) throw Error(`An item is no longer with ${character.name}. Review the return again.`);
    const why = returnableProblem(h);
    if (why) throw Error(why);
    assertCarried(h);
    if (line.quantity > h.quantity)
      throw Error(`${character.name} has only ${h.quantity} × ${presentedHolding(h).name}.`);
    const newId = `${cmd.id}-item-${i}`;
    if (t.holdings.some((x) => x.id === newId)) throw Error("This return was already recorded.");
    h.quantity -= line.quantity;
    // A returned item is unequipped and never attuned; settleAttunement ends the attunement of
    // a whole attuned stack that leaves (one logged event), as Give does.
    const { attuned: _attuned, equipped: _equipped, pool: _pool, ...item } = h;
    const moved: Holding = {
      ...item,
      id: newId,
      purseId: fund.id,
      quantity: line.quantity,
      ...movedUses(h, h.quantity),
      ...(cmd.to.pool ? { pool: { at, source: "dm" as const, receiptId: cmd.id } } : {}),
    };
    t.holdings.push(moved);
    const shown = presentedHolding(moved);
    const unitCopper = knownUnitCopper(moved) ?? 0;
    t.ledger.push({
      id: `${cmd.id}-out-${i}`,
      at,
      purseId: character.id,
      shopId: null,
      summary: `Returned to the party: ${shown.name} × ${line.quantity} (to ${where})`.slice(0, 500),
      copper: 0,
      transactionType: "transfer",
    });
    t.ledger.push({
      id: `${cmd.id}-in-${i}`,
      at,
      purseId: fund.id,
      shopId: null,
      summary: `Returned ${who ? `by ${who}` : "to the party"}: ${shown.name} × ${line.quantity}${cmd.to.pool ? " (treasure pool)" : ""}`.slice(0, 500),
      copper: 0,
      transactionType: "transfer",
      // A pooled return is "added" to the pool, as Add loot is: never counted as received.
      ...(cmd.to.pool
        ? { loot: { id: cmd.id, holdingId: newId, role: "added" as const, quantity: line.quantity, unitCopper } }
        : {}),
    });
    if (cmd.to.pool) {
      event(
        `Put in the treasure pool${who ? ` (returned by ${who})` : ""}: ${shown.name} × ${line.quantity}`.slice(0, 500),
        "management",
        fund.id,
      );
      lastEvent().lootPool = {
        holdingId: newId,
        name: shown.name.slice(0, 200),
        quantity: line.quantity,
        pooled: true,
        source: "dm",
        receiptId: cmd.id,
      };
    }
    units += line.quantity;
  }
  t.holdings = t.holdings.filter((h) => h.quantity > 0);

  if (cmd.copper) {
    moveCoins(character, fund, cmd.copper);
    t.ledger.push({
      id: `${cmd.id}-coins-out`,
      at,
      purseId: character.id,
      shopId: null,
      summary: `Returned to the party: ${formatCopper(cmd.copper)} (to ${fund.name})`,
      copper: -cmd.copper,
      transactionType: "transfer",
    });
    t.ledger.push({
      id: `${cmd.id}-coins-in`,
      at,
      purseId: fund.id,
      shopId: null,
      summary: `Returned ${who ? `by ${who}` : "to the party"}: ${formatCopper(cmd.copper)}`,
      copper: cmd.copper,
      transactionType: "transfer",
    });
  }

  // Open claims are withdrawn, one event each on the character (never dropped silently).
  for (const c of claims) {
    const lot = t.holdings.find((x) => x.id === c.holdingId);
    const name = lot ? presentedHolding(lot).name : "an item";
    event(
      `Withdrawn: ${character.name}'s ${CHOICE_LABEL[c.choice]} claim on ${name} (${character.name} left the party).`.slice(0, 500),
      "management",
      character.id,
    );
  }
  if (claims.length) {
    state.claims = state.claims.filter((c) => c.purseId !== character.id);
    (journal as { lootClaims?: LootClaims }).lootClaims = state;
  }

  const parts = [
    ...(cmd.items.length ? [`${cmd.items.length} item${cmd.items.length === 1 ? "" : "s"} (${units} in all)`] : []),
    ...(cmd.copper ? [formatCopper(cmd.copper)] : []),
  ];
  event(
    `${character.name} returned to the party: ${parts.join(" and ") || "no items or coins"} to ${where}${claims.length ? `; ${claims.length} open claim${claims.length === 1 ? "" : "s"} withdrawn` : ""}.`,
    "management",
    character.id,
  );
  if (cmd.to.pool && cmd.items.length)
    t.notes.push({
      id: cmd.id + "-note",
      at,
      from: "dm",
      to: "party",
      purseId: fund.id,
      text: `${cmd.items.length === 1 ? "An item is" : `${cmd.items.length} items are`} back in the treasure pool${who ? ` from ${who}` : ""}. Mark Need, Greed or Pass on Party → Treasure pool.`,
    });
}
