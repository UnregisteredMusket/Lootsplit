/**
 * XP and milestones (loot plan phase 6). One planner and one apply step for the DM-only
 * `xp-award` command: the shared engine (commands.ts) and the device path (economy.ts
 * executeLocalCommand) both run it. Experience lives on the character's play sheet
 * (`sheet.xp`, `sheet.milestoneLevel`, tabletop protocol 21); the level-up prompt is computed
 * from it and never changes the sheet's level (the person confirms that as a normal sheet edit).
 *
 * Arithmetic is whole numbers only: a split gives floor(total / n) each and the remainder goes
 * to the character the DM picked, or stays unawarded and the award's journal entry says so.
 */
import { z } from "zod";
import type { CloudTable } from "./cloud.ts";
import type { CharacterSheet } from "./sheet.ts";
import type { Purse } from "./types.ts";
import { MAX_SPLIT_RECIPIENTS, isNpc, recipientProblem } from "./coin-split.ts";
import { characterSheet, statsOnly } from "../characters/campaign-sheet.mjs";
import { sheetSchema } from "../characters/model.mjs";

/** The largest single award. */
export const MAX_XP_AWARD = 1_000_000;
/** The largest experience total a sheet stores (well beyond level 20's 355,000). */
export const MAX_SHEET_XP = 100_000_000;
export const MAX_LEVEL = 20;

/**
 * Experience needed to reach each level (index 0 = level 1), from the character advancement
 * table of the System Reference Document 5.2.1 (CC BY 4.0; credited in website/resources.ts).
 */
export const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000,
  165000, 195000, 225000, 265000, 305000, 355000,
] as const;

/** The level an experience total reaches (1–20). */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) if (xp >= XP_THRESHOLDS[i]!) level = i + 1;
  return level;
}
/** Experience needed for the level after `level`, or null at level 20. */
export function nextLevelXp(level: number): number | null {
  return level >= MAX_LEVEL ? null : XP_THRESHOLDS[Math.max(1, Math.floor(level))]!;
}

type Advancement = { level: number; xp?: number; milestoneLevel?: number };
/**
 * The level a character is ready to reach, or null when there is nothing to level up: the XP
 * threshold crossed or the level its milestones reached, whichever is higher, above the
 * sheet's level. Computed, never stored (docs/FOOTPRINT.md place 1).
 */
export function levelUpTarget(sheet: Advancement): number | null {
  const target = Math.max(
    sheet.xp !== undefined ? levelForXp(sheet.xp) : 0,
    sheet.milestoneLevel ?? 0,
  );
  return target > sheet.level ? Math.min(MAX_LEVEL, target) : null;
}

/** "2,700 XP · level 5 at 6,500" (and the milestone level), for a sheet that tracks either. */
export function xpReadout(sheet: Advancement): string {
  const n = (value: number) => value.toLocaleString("en-US");
  const parts: string[] = [];
  if (sheet.xp !== undefined) {
    const next = nextLevelXp(sheet.level);
    parts.push(`${n(sheet.xp)} XP${next !== null ? ` · level ${sheet.level + 1} at ${n(next)}` : ""}`);
  }
  if (sheet.milestoneLevel !== undefined) parts.push(`Milestones reach level ${sheet.milestoneLevel}`);
  return parts.join(" · ");
}

/** An imported 2014 sheet's Experience box, when it holds a plain number ("2,700"). */
export function importedXp(legacy: Pick<CharacterSheet, "experience"> | undefined): number | null {
  const text = legacy?.experience?.trim() ?? "";
  if (!/^[\d, ]+$/.test(text)) return null;
  const n = Number(text.replace(/[, ]/g, ""));
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, MAX_SHEET_XP) : null;
}

const id = z.string().min(1).max(150);
export const xpAwardCommand = z
  .object({
    id,
    kind: z.literal("xp-award"),
    /** "xp": experience points; "milestone": each recipient reaches this many milestones (levels). */
    unit: z.enum(["xp", "milestone"]),
    /** "each": every recipient gets `amount`; "split": `amount` is divided evenly (XP only). */
    rule: z.enum(["each", "split"]),
    amount: z.number().int().min(1).max(MAX_XP_AWARD),
    purseIds: z.array(id).min(1).max(MAX_SPLIT_RECIPIENTS),
    /** Split only: who gets the remainder; null or absent keeps it unawarded. */
    remainderTo: id.nullable().optional(),
    /** What it was for ("Defeated the ogre"), shown in the journal entry. */
    reason: z.string().trim().max(120).optional(),
  })
  .strict();
export type XpAwardCommand = z.infer<typeof xpAwardCommand>;
export type XpAwardInput = Omit<XpAwardCommand, "id" | "kind">;

type XpTable = Pick<CloudTable, "purses" | "journal" | "sheets">;
export type XpAwardPlan = {
  unit: "xp" | "milestone";
  rule: "each" | "split";
  amount: number;
  shares: { purseId: string; name: string; gain: number; before: number; after: number; level: number; ready: number | null }[];
  /** Split only: what floor() left over, and who gets it (null = unawarded). */
  remainder: number;
  remainderTo: string | null;
  /** Any NPC among the recipients: the journal entry is DM-only, as for a coin split. */
  npc: boolean;
};

/** The play sheet the award changes: the stored one, or the sheet the character already shows. */
function playSheet(t: XpTable, p: Purse) {
  return p.sheet ?? statsOnly(characterSheet(p, [], t.sheets.find((s) => s.purseId === p.id)));
}
/** Current experience: the play sheet's, else the imported sheet's Experience box, else 0. */
export function currentXp(t: Pick<XpTable, "sheets">, p: Purse): number {
  return p.sheet?.xp ?? importedXp(t.sheets.find((s) => s.purseId === p.id)) ?? 0;
}

/** The preview and the command both use this: every check, and exactly who gets what. */
export function planXpAward(t: XpTable, input: XpAwardInput): XpAwardPlan {
  const { unit, rule, amount, purseIds } = input;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_XP_AWARD)
    throw Error(`Enter a whole number from 1 to ${MAX_XP_AWARD.toLocaleString("en-US")}.`);
  if (unit === "milestone" && (rule !== "each" || amount > MAX_LEVEL - 1))
    throw Error("Give 1 to 19 milestones to each chosen character.");
  if (!purseIds.length) throw Error("Choose at least one character.");
  if (purseIds.length > MAX_SPLIT_RECIPIENTS)
    throw Error(`Choose at most ${MAX_SPLIT_RECIPIENTS} characters.`);
  if (new Set(purseIds).size !== purseIds.length) throw Error("Choose each character once.");
  const byId = new Map(t.purses.map((p) => [p.id, p]));
  const recipients = purseIds.map((purseId) => {
    const p = byId.get(purseId);
    const problem = recipientProblem(t, p, "dm");
    if (problem) throw Error(problem.replace("split recipients", "XP recipients"));
    return p!;
  });
  const n = recipients.length;
  const share = rule === "split" ? Math.floor(amount / n) : amount;
  const remainder = rule === "split" ? amount - share * n : 0;
  const remainderTo = remainder > 0 ? (input.remainderTo ?? null) : null;
  if (remainderTo !== null && !purseIds.includes(remainderTo))
    throw Error("Give the remainder to one of the chosen characters, or keep it unawarded.");
  if (rule === "split" && share === 0 && remainderTo === null)
    throw Error("That total is too small to split among them. Award more or choose who gets it.");
  const shares = recipients.map((p) => {
    const sheet = playSheet(t, p);
    if (unit === "milestone") {
      const before = Math.max(sheet.milestoneLevel ?? sheet.level, sheet.level);
      const after = Math.min(MAX_LEVEL, before + amount);
      return {
        purseId: p.id, name: p.name, gain: amount, before, after, level: sheet.level,
        ready: levelUpTarget({ ...sheet, milestoneLevel: after }),
      };
    }
    const gain = share + (p.id === remainderTo ? remainder : 0);
    const before = currentXp(t, p);
    const after = before + gain;
    if (after > MAX_SHEET_XP) throw Error(`${p.name} can't hold more than ${MAX_SHEET_XP.toLocaleString("en-US")} XP.`);
    return {
      purseId: p.id, name: p.name, gain, before, after, level: sheet.level,
      ready: levelUpTarget({ ...sheet, xp: after }),
    };
  });
  return { unit, rule, amount, shares, remainder, remainderTo, npc: recipients.some((p) => isNpc(t, p)) };
}

const number = (n: number) => n.toLocaleString("en-US");
/** The award's one journal entry: who got what, and any remainder kept unawarded. */
export function xpAwardSummary(plan: XpAwardPlan, reason?: string): string {
  const what = reason ? ` (${reason})` : "";
  const list = (parts: string[]) =>
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  let text: string;
  if (plan.unit === "milestone") {
    const each = plan.amount === 1 ? "a milestone" : `${plan.amount} milestones`;
    // Names only: players can't read each other's sheets, so the shared text never says a level.
    text = `Milestone award${what}: ${each} to ${list(plan.shares.map((s) => s.name))}`;
  } else if (plan.rule === "each") {
    text = `XP award${what}: ${number(plan.amount)} XP each to ${list(plan.shares.map((s) => s.name))}`;
  } else {
    const leftover =
      plan.remainder > 0 && plan.remainderTo === null ? `; ${number(plan.remainder)} XP not awarded` : "";
    text = `XP award${what}: ${number(plan.amount)} XP split among ${plan.shares.length}: ${list(
      plan.shares.map((s) => `${s.name} ${number(s.gain)}`),
    )}${leftover}`;
  }
  if (text.length <= 500) return text;
  // A long roster is summarized by count rather than cut off (the journal keeps 500 characters).
  const total = plan.shares.reduce((sum, s) => sum + s.gain, 0);
  return plan.unit === "milestone"
    ? `Milestone award${what}: ${plan.amount} to each of ${plan.shares.length} characters`
    : `XP award${what}: ${number(total)} XP to ${plan.shares.length} characters${
        plan.remainder > 0 && plan.remainderTo === null ? `; ${number(plan.remainder)} XP not awarded` : ""
      }`;
}

const ADVANCEMENT = ["xp", "milestoneLevel"] as const;
const SHEET_FIELDS = ["sheet", "editBaseline"] as const;
const lacks = (current: Purse, row: unknown, field: (typeof SHEET_FIELDS)[number]) => {
  const stored = current[field];
  const sent = row && typeof row === "object" ? (row as Record<string, unknown>)[field] : undefined;
  return stored && sent && typeof sent === "object"
    ? ADVANCEMENT.filter((k) => stored[k] !== undefined && !(k in sent))
    : [];
};
/**
 * A whole-purse write (a DM `patch`) from a client older than protocol 21 carries the purse's
 * sheets without `xp` / `milestoneLevel`. When its baseline lacks the stored values, its baseline
 * and its new row get them, so the write neither conflicts nor erases them.
 */
export function keepPurseAdvancement(
  current: Purse,
  before: unknown,
  after: unknown,
): { before: unknown; after: unknown } {
  if (!SHEET_FIELDS.some((field) => lacks(current, before, field).length)) return { before, after };
  const fill = (row: unknown) => {
    if (!row || typeof row !== "object") return row;
    const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const field of SHEET_FIELDS) {
      const missing = lacks(current, row, field);
      if (missing.length)
        copy[field] = {
          ...(copy[field] as object),
          ...Object.fromEntries(missing.map((k) => [k, current[field]![k]])),
        };
    }
    return copy;
  };
  return { before: fill(before), after: fill(after) };
}

/**
 * Applies the award to the table (a private transaction snapshot; callers commit it with their
 * revision check). The DM only, checked here, so the server enforces it for every client.
 * Returns the plan so the caller writes the one journal entry.
 */
export function applyXpAward(t: XpTable, seat: { role: string }, cmd: XpAwardCommand): XpAwardPlan {
  if (seat.role !== "dm") throw Error("Only the DM can award XP or milestones.");
  const plan = planXpAward(t, cmd);
  for (const share of plan.shares) {
    const p = t.purses.find((x) => x.id === share.purseId)!;
    const sheet = playSheet(t, p);
    p.sheet = sheetSchema.parse(
      statsOnly({
        ...sheet,
        ...(plan.unit === "xp" ? { xp: share.after } : { milestoneLevel: share.after }),
      }),
    );
    p.sheetRevision = (p.sheetRevision || 0) + 1;
  }
  return plan;
}
