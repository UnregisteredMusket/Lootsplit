/**
 * Attunement (loot plan phase 5): items that require attunement, and which characters are
 * attuned to them.
 *
 * - `requiresAttunement` on an item holding is the requirement's text ("Requires attunement" or
 *   "Requires attunement: by a wizard"). The DM sets it in Edit item; Open5e items carry it from
 *   their import text (`attunementFromNotes`). Absent: the item doesn't require attunement.
 * - `attuned: true` on a holding held by a character means that character is attuned to it (one
 *   item of a stack). The count per character is computed, never stored.
 * - `attunementLimit` on a character purse (0 to 10) is the DM's per-character limit. Absent: 3.
 *
 * `item-attune` (the controlling player or the DM) attunes or ends attunement; past the limit
 * only the DM, with an explicit `override` that the journal event records. `attunement-limit`
 * (DM) sets the limit. When an attuned item leaves its character in any command (give, sell,
 * sell and split, used up, pooled, stored, removed), `settleAttunement` ends the attunement in the
 * same command; a receiver is never attuned. Each change is one journal event for that
 * character's purse, with no ledger line: attunement is a character change, not a money change.
 *
 * Holdings and purses are not strictly parsed (validation.ts), so older clients keep the fields.
 */
import { z } from "zod";
import type { Holding, Purse } from "./types.ts";

export const DEFAULT_ATTUNEMENT_LIMIT = 3;
export const MAX_ATTUNEMENT_LIMIT = 10;
export const requiresAttunementSchema = z.string().trim().min(1).max(200);
export const attunementLimitSchema = z.number().int().min(0).max(MAX_ATTUNEMENT_LIMIT);

const id = z.string().min(1).max(150);
export const attunementCommands = [
  /**
   * Attune (`attuned: true`) or end attunement (`false`). `expect` is what the actor was shown:
   * the holder and whether the item was attuned. `override` (DM only) attunes past the limit.
   */
  z
    .object({
      id,
      kind: z.literal("item-attune"),
      holdingId: id,
      attuned: z.boolean(),
      override: z.literal(true).optional(),
      expect: z.object({ purseId: id, attuned: z.boolean() }).strict(),
    })
    .strict(),
  /** DM: a character's attunement limit (0 to 10), or `null` for the default of 3. */
  z
    .object({
      id,
      kind: z.literal("attunement-limit"),
      purseId: id,
      limit: attunementLimitSchema.nullable(),
      expect: attunementLimitSchema.nullable(),
    })
    .strict(),
] as const;
export type AttunementCommand = z.infer<(typeof attunementCommands)[number]>;
export const attunementKinds = new Set<string>(attunementCommands.map((s) => s.shape.kind.value));

export function attunementLimit(purse: Pick<Purse, "attunementLimit"> | undefined): number {
  return purse?.attunementLimit ?? DEFAULT_ATTUNEMENT_LIMIT;
}
export function attunedCount(holdings: readonly Holding[], purseId: string): number {
  return holdings.filter((h) => h.attuned && h.purseId === purseId).length;
}
/** "Attuned 2/3" for a character. */
export function attunementSummary(purse: Pick<Purse, "id" | "attunementLimit">, holdings: readonly Holding[]): string {
  return `Attuned ${attunedCount(holdings, purse.id)}/${attunementLimit(purse)}`;
}

/** The Open5e import text in an item's notes ("Requires attunement: by a wizard"), as a field. */
export function attunementFromNotes(notes: string | undefined): { requiresAttunement?: string } {
  const line = notes?.split("\n").find((l) => /^Requires attunement\b/.test(l.trim()));
  const text = line?.trim().slice(0, 200);
  return text ? { requiresAttunement: text } : {};
}

/** A problem with a holding's attunement fields, or null (validation and the device's item edit). */
export function attunementProblem(holding: Pick<Holding, "kind" | "requiresAttunement" | "attuned">): string | null {
  if (holding.requiresAttunement !== undefined) {
    if (holding.kind !== "item") return "Only items can require attunement.";
    if (!requiresAttunementSchema.safeParse(holding.requiresAttunement).success)
      return "Attunement text must be 1 to 200 characters.";
  }
  if (holding.attuned !== undefined && (holding.attuned !== true || holding.requiresAttunement === undefined))
    return "Only an item that requires attunement can be attuned.";
  return null;
}
export function purseAttunementProblem(purse: Pick<Purse, "attunementLimit" | "kind">): string | null {
  if (purse.attunementLimit === undefined) return null;
  if (purse.kind !== "character") return "Only characters have an attunement limit.";
  return attunementLimitSchema.safeParse(purse.attunementLimit).success
    ? null
    : `The attunement limit must be a whole number from 0 to ${MAX_ATTUNEMENT_LIMIT}.`;
}

type Change = {
  entity: "holding" | "account";
  entityId: string;
  before: Record<string, number | string | boolean | null>;
  after: Record<string, number | string | boolean | null>;
};
type Event = (summary: string, kind: "management", purseId: string, change: Change) => void;
type Table = { holdings: Holding[]; purses: Purse[] };

/** Apply `item-attune` or `attunement-limit`. `authorize` is commands.ts's `dm()` and `own()`. */
export function applyAttunementCommand(
  t: Table,
  cmd: AttunementCommand,
  seat: { role: string },
  authorize: { dm: () => void; own: (purseId: string) => unknown; assertCarried: (h: Holding) => void },
  event: Event,
): void {
  if (cmd.kind === "attunement-limit") {
    authorize.dm();
    const p = t.purses.find((x) => x.id === cmd.purseId);
    if (!p) throw Error("Account no longer exists.");
    if (p.kind !== "character") throw Error("Only characters have an attunement limit.");
    if ((p.attunementLimit ?? null) !== cmd.expect) throw Error("This character changed. Review it and try again.");
    const before = attunementLimit(p);
    if (cmd.limit === null || cmd.limit === DEFAULT_ATTUNEMENT_LIMIT) delete p.attunementLimit;
    else p.attunementLimit = cmd.limit;
    const after = attunementLimit(p);
    if (before === after) throw Error(`${p.name}'s attunement limit is already ${after}.`);
    const count = attunedCount(t.holdings, p.id);
    event(
      `Attunement limit for ${p.name}: ${before} → ${after}${count > after ? ` (attuned to ${count}; nothing ends automatically)` : ""}`,
      "management",
      p.id,
      { entity: "account", entityId: p.id, before: { attunementLimit: before }, after: { attunementLimit: after } },
    );
    return;
  }
  const h = t.holdings.find((x) => x.id === cmd.holdingId);
  if (!h) throw Error("This item is no longer in the inventory.");
  authorize.own(h.purseId);
  if (cmd.override && seat.role !== "dm") throw Error("Only the DM can attune past the limit.");
  if (h.purseId !== cmd.expect.purseId || !!h.attuned !== cmd.expect.attuned)
    throw Error("This item changed. Review it and try again.");
  const p = t.purses.find((x) => x.id === h.purseId);
  if (!p) throw Error("Account no longer exists.");
  const limit = attunementLimit(p);
  if (!cmd.attuned) {
    if (!h.attuned) throw Error(`${p.name} isn't attuned to ${h.name}.`);
    delete h.attuned;
    const count = attunedCount(t.holdings, p.id);
    event(`Ended attunement to ${h.name} (${p.name}): attuned ${count}/${limit}`, "management", p.id, {
      entity: "holding",
      entityId: h.id,
      before: { attuned: true },
      after: { attuned: false },
    });
    return;
  }
  if (h.attuned) throw Error(`${p.name} is already attuned to ${h.name}.`);
  if (p.kind !== "character") throw Error("Only a character can attune to an item. Give it to a character first.");
  if (h.pool) throw Error("An item in the treasure pool can't be attuned. Resolve the pool first.");
  if (h.kind !== "item" || !h.requiresAttunement)
    throw Error("This item doesn't require attunement. The DM can mark it in Edit item.");
  authorize.assertCarried(h);
  const count = attunedCount(t.holdings, p.id);
  if (count >= limit && !cmd.override)
    throw Error(
      `${p.name} is already attuned to ${count} of ${limit} items. End an attunement first${seat.role === "dm" ? ", or choose Attune past the limit" : ", or ask the DM to attune past the limit"}.`,
    );
  h.attuned = true;
  const over = count + 1 > limit;
  event(
    `Attuned ${p.name} to ${h.name}: attuned ${count + 1}/${limit}${over ? ` (DM override past the limit of ${limit})` : ""}`,
    "management",
    p.id,
    {
      entity: "holding",
      entityId: h.id,
      before: { attuned: false },
      after: { attuned: true, ...(over ? { override: true } : {}) },
    },
  );
}

/** The attuned holdings before a command: id → holder and name. */
export function attunedBefore(holdings: readonly Holding[]): Map<string, { purseId: string; name: string }> {
  return new Map(holdings.filter((h) => h.attuned).map((h) => [h.id, { purseId: h.purseId, name: h.name }]));
}

/**
 * After any command: a holding that became attuned without `item-attune` (a copy made by Give,
 * a purchase or an award) is not attuned; an attuned item that left its character, was pooled,
 * stored or reserved, or was removed ends its attunement with one event for that character.
 * `allowed` is the holding an `item-attune` just attuned.
 */
export function settleAttunement(
  t: Table,
  before: Map<string, { purseId: string; name: string }>,
  allowed: string | null,
  event: Event,
): void {
  const ended = (purseId: string, holdingId: string, name: string, why: string) => {
    const p = t.purses.find((x) => x.id === purseId);
    const who = p?.name ?? "Unassigned";
    event(
      `Attunement ended: ${name} (${who}) ${why}; attuned ${attunedCount(t.holdings, purseId)}/${attunementLimit(p)}`,
      "management",
      purseId,
      { entity: "holding", entityId: holdingId, before: { attuned: true }, after: { attuned: false } },
    );
  };
  const present = new Set<string>();
  for (const h of t.holdings) {
    present.add(h.id);
    if (!h.attuned) continue;
    const was = before.get(h.id);
    if (!was) {
      if (h.id !== allowed) delete h.attuned;
      continue;
    }
    const holder = t.purses.find((p) => p.id === h.purseId);
    const why =
      h.purseId !== was.purseId
        ? "left the character"
        : h.pool
          ? "went into the treasure pool"
          : h.custody || h.reservedFor
            ? "is no longer carried"
            : holder?.kind !== "character"
              ? "is no longer held by a character"
              : h.kind !== "item" || !h.requiresAttunement
                ? "no longer requires attunement"
                : null;
    if (!why) continue;
    delete h.attuned;
    ended(was.purseId, h.id, was.name, why);
  }
  for (const [holdingId, was] of before)
    if (!present.has(holdingId)) ended(was.purseId, holdingId, was.name, "left the character");
}
