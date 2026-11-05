/**
 * XP from encounters (follow-up to XP and milestones, loot plan phase 6). The DM's encounter award
 * may give the party XP suggested from the encounter's enemies, or mark a milestone, through the
 * same planner and sheet write as the `xp-award` command (xp.ts). Both award paths call
 * `applyEncounterXp`: the shared Worker (cloudflare/encounters.mjs) inside the encounter award's
 * D1 batch, and the device (src/lib/encounters/local.ts) inside its IndexedDB transaction.
 *
 * Exactly once: the award's receipt keeps `xp` (`EncounterXpReceipt`). An encounter's XP is given
 * at most once, either with the loot transfer or later from "Award XP" on an awarded encounter
 * (for encounters awarded before this feature, or without XP).
 *
 * Whole numbers only. The default split is the `xp-award` rule: floor(total / n) each; the
 * remainder goes to the character the DM picks, otherwise it stays unawarded and the journal entry
 * says so. The DM may override the total, or every share (then the total is their sum).
 */
import { z } from "zod";
import type { CloudTable } from "./cloud.ts";
import { MAX_SPLIT_RECIPIENTS, isNpc } from "./coin-split.ts";
import { readJournal } from "./journal.ts";
import {
  MAX_XP_AWARD,
  applyXpPlan,
  importedXp,
  planXpAward,
  xpAwardSummary,
  type XpAwardPlan,
} from "./xp.ts";

/**
 * Experience points by challenge rating, from the System Reference Document 5.2.1 (CC BY 4.0;
 * credited in website/resources.ts). CR 0 is "0 or 10" there; Lootsplitter suggests 0 and the DM
 * can raise the total.
 */
export const CR_XP: ReadonlyArray<readonly [cr: number, xp: number]> = [
  [0, 0], [0.125, 25], [0.25, 50], [0.5, 100], [1, 200], [2, 450], [3, 700], [4, 1100],
  [5, 1800], [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900], [11, 7200], [12, 8400],
  [13, 10000], [14, 11500], [15, 13000], [16, 15000], [17, 18000], [18, 20000], [19, 22000],
  [20, 25000], [21, 33000], [22, 41000], [23, 50000], [24, 62000], [25, 75000], [26, 90000],
  [27, 105000], [28, 120000], [29, 135000], [30, 155000],
];
/** The XP for a challenge rating, or null when the table has no such rating (e.g. CR 1.5). */
export function xpForCr(cr: number): number | null {
  return CR_XP.find(([rating]) => rating === cr)?.[1] ?? null;
}

type Creature = { id: string; name: string; side: "enemy" | "ally"; cr: number; xp: number };
export type XpSuggestionRow = { id: string; name: string; xp: number; from: "xp" | "cr" | "none" };
/**
 * The suggested total: every enemy's own XP value when it has one (Open5e and imported stat
 * blocks carry it), else the XP for its CR, else nothing. Allies give no XP.
 */
export function suggestEncounterXp(combatants: Creature[]): { total: number; rows: XpSuggestionRow[] } {
  const rows = combatants
    .filter((c) => c.side === "enemy")
    .map((c): XpSuggestionRow => {
      if (Number.isSafeInteger(c.xp) && c.xp > 0) return { id: c.id, name: c.name, xp: c.xp, from: "xp" };
      const byCr = c.cr > 0 ? xpForCr(c.cr) : null;
      return byCr ? { id: c.id, name: c.name, xp: byCr, from: "cr" } : { id: c.id, name: c.name, xp: 0, from: "none" };
    });
  return { total: Math.min(MAX_XP_AWARD, rows.reduce((sum, r) => sum + r.xp, 0)), rows };
}

const id = z.string().min(1).max(120);
const purseIds = z
  .array(id)
  .min(1)
  .max(MAX_SPLIT_RECIPIENTS)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each character once.");
/**
 * "Reason players see": the party journal entry's note, validated and trimmed exactly like the
 * `xp-award` reason. The DM's chooser prefills the encounter's name, which can be a spoiler
 * ("Secret Lich Ambush"); cleared, the entry says "Encounter". Absent (older clients), the entry
 * names the encounter as before.
 */
const reason = z.string().trim().max(120).optional();
/** What the DM chose for an encounter's XP (sent with the award request; never stored as a draft). */
export const encounterXpSchema = z.discriminatedUnion("unit", [
  z
    .object({
      unit: z.literal("xp"),
      purseIds,
      /** The total XP: the suggestion or the DM's own. */
      total: z.number().int().min(1).max(MAX_XP_AWARD),
      /** Even split only: who gets the remainder; null or absent keeps it unawarded. */
      remainderTo: id.nullable().optional(),
      /** The DM's own share for each of `purseIds`, in order; their sum is `total`. */
      shares: z.array(z.number().int().min(0).max(MAX_XP_AWARD)).max(MAX_SPLIT_RECIPIENTS).optional(),
      reason,
    })
    .strict(),
  // "Mark milestone": one milestone to each chosen character.
  z.object({ unit: z.literal("milestone"), purseIds, reason }).strict(),
]);
export type EncounterXpInput = z.infer<typeof encounterXpSchema>;

/** What the award's receipt keeps: who got what, once. */
export const encounterXpReceiptSchema = z.object({
  id: z.string().max(200),
  at: z.number(),
  unit: z.enum(["xp", "milestone"]),
  total: z.number().int().nonnegative(),
  shares: z.array(z.object({ purseId: z.string().max(120), gain: z.number().int().nonnegative() })).max(MAX_SPLIT_RECIPIENTS),
  remainder: z.number().int().nonnegative().optional(),
  remainderTo: z.string().max(120).nullable().optional(),
});
export type EncounterXpReceipt = z.infer<typeof encounterXpReceiptSchema>;

/**
 * The shares alone, for the DM's preview (no sheets needed): the even split with its remainder,
 * or the DM's own shares. Throws a reader-facing message for an award that can't be given.
 */
export function encounterXpShares(input: EncounterXpInput): {
  shares: { purseId: string; gain: number }[];
  remainder: number;
  remainderTo: string | null;
} {
  const n = input.purseIds.length;
  if (!n) throw Error("Choose at least one character.");
  if (input.unit === "milestone")
    return { shares: input.purseIds.map((purseId) => ({ purseId, gain: 1 })), remainder: 0, remainderTo: null };
  if (input.shares) {
    if (input.shares.length !== n) throw Error("Enter a share for each chosen character.");
    const sum = input.shares.reduce((a, b) => a + b, 0);
    if (sum !== input.total) throw Error("The shares must add up to the total.");
    if (sum < 1) throw Error("Give at least 1 XP.");
    if (input.remainderTo) throw Error("Your own shares have no remainder.");
    return { shares: input.purseIds.map((purseId, i) => ({ purseId, gain: input.shares![i]! })), remainder: 0, remainderTo: null };
  }
  const each = Math.floor(input.total / n);
  const remainder = input.total - each * n;
  const remainderTo = remainder > 0 ? (input.remainderTo ?? null) : null;
  if (remainderTo !== null && !input.purseIds.includes(remainderTo))
    throw Error("Give the remainder to one of the chosen characters, or keep it unawarded.");
  if (each === 0 && remainderTo === null)
    throw Error("That total is too small to split among them. Award more or choose who gets it.");
  return {
    shares: input.purseIds.map((purseId) => ({ purseId, gain: each + (purseId === remainderTo ? remainder : 0) })),
    remainder,
    remainderTo,
  };
}

type XpTable = Pick<CloudTable, "purses" | "journal" | "sheets">;

/**
 * Whether the party tracks milestones instead of XP. XP and milestones has no campaign setting;
 * the party's sheets say it: some party character has a milestone level and none tracks XP
 * (the play sheet's XP or an imported sheet's Experience number). Computed, never stored.
 */
export function campaignXpMode(t: Pick<XpTable, "purses" | "journal"> & { sheets?: XpTable["sheets"] }): "xp" | "milestone" {
  const party = t.purses.filter((p) => p.kind === "character" && !p.nonParty && !isNpc(t, p));
  const milestones = party.some((p) => p.sheet?.milestoneLevel !== undefined);
  const xp = party.some(
    (p) => p.sheet?.xp !== undefined || importedXp((t.sheets ?? []).find((s) => s.purseId === p.id)) !== null,
  );
  return milestones && !xp ? "milestone" : "xp";
}

/** The plan both paths apply: the xp-award planner, for the even split or each own share. */
export function planEncounterXp(t: XpTable, input: EncounterXpInput): XpAwardPlan {
  const split = encounterXpShares(input);
  if (input.unit === "milestone")
    return planXpAward(t, { unit: "milestone", rule: "each", amount: 1, purseIds: input.purseIds });
  if (!input.shares)
    return planXpAward(t, {
      unit: "xp",
      rule: "split",
      amount: input.total,
      purseIds: input.purseIds,
      ...(split.remainderTo ? { remainderTo: split.remainderTo } : {}),
    });
  // The DM's own shares: every recipient checked exactly as `xp-award` checks it.
  const checked = planXpAward(t, { unit: "xp", rule: "each", amount: 1, purseIds: input.purseIds });
  const shares = split.shares.map((share, i) =>
    share.gain > 0
      ? planXpAward(t, { unit: "xp", rule: "each", amount: share.gain, purseIds: [share.purseId] }).shares[0]!
      : { ...checked.shares[i]!, gain: 0, after: checked.shares[i]!.before, ready: null },
  );
  return { unit: "xp", rule: "split", amount: input.total, shares, remainder: 0, remainderTo: null, npc: checked.npc };
}

/** What a cleared "Reason players see" shows players. */
export const ENCOUNTER_XP_NEUTRAL_REASON = "Encounter";
/** The journal entry's note: the DM's "Reason players see", else (older requests) the encounter name. */
export function encounterXpReason(input: Pick<EncounterXpInput, "reason">, encounterName: string): string | undefined {
  if (input.reason !== undefined) return input.reason.trim().slice(0, 120) || ENCOUNTER_XP_NEUTRAL_REASON;
  return encounterName.trim().slice(0, 120) || undefined;
}
/**
 * Gives an encounter's XP or milestone to a private working copy of the campaign (callers commit
 * it in their own atomic write): the DM only, the same sheet write and the same one journal entry
 * as `xp-award` (DM-only when an NPC is included). Returns the receipt the award keeps.
 */
export function applyEncounterXp(
  t: XpTable,
  seat: { role: string },
  raw: unknown,
  /** `reason`: the encounter's name, used only when the request has no "Reason players see". */
  options: { id: string; at: number; reason: string },
): { plan: XpAwardPlan; receipt: EncounterXpReceipt } {
  if (seat.role !== "dm") throw Error("Only the DM can award XP or milestones.");
  const parsed = encounterXpSchema.safeParse(raw);
  if (!parsed.success) throw Error(parsed.error.issues[0]?.message || "Check the XP award.");
  const input = parsed.data;
  if (input.unit === "xp" && campaignXpMode(t) === "milestone")
    throw Error("This party levels by milestones. Mark a milestone instead of awarding XP.");
  const plan = applyXpPlan(t, planEncounterXp(t, input));
  const journal = (t.journal = readJournal(t.journal));
  const reason = encounterXpReason(input, options.reason);
  journal.events.push({
    id: `${options.id}-event-${journal.events.length}`,
    at: options.at,
    summary: xpAwardSummary(plan, reason),
    kind: "management",
    ...(plan.npc ? { dmOnly: true } : {}),
  });
  return {
    plan,
    receipt: {
      id: options.id,
      at: options.at,
      unit: plan.unit,
      total: plan.unit === "xp" ? plan.shares.reduce((sum, s) => sum + s.gain, 0) : plan.shares.length,
      shares: plan.shares.map((s) => ({ purseId: s.purseId, gain: s.gain })),
      ...(plan.remainder > 0 ? { remainder: plan.remainder, remainderTo: plan.remainderTo } : {}),
    },
  };
}
