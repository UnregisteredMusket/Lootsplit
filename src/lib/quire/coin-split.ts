/**
 * Even coin split (future-development prompt 2, phase 1). One pure planner used by
 * every caller: the shared `coin-split` command (commands.ts, also run offline through
 * executeLocalCommand), both encounter award paths (cloudflare/encounters.mjs and
 * src/lib/encounters/local.ts) and the UI previews. All arithmetic is in whole copper:
 * share × n + remainder = amount, always.
 */
import { formatCopper, fromCopper, spendCoins, toCopper } from "./money.ts";
import { characterVisible, inParty } from "./character-position.ts";
import type { CloudTable } from "./cloud.ts";
import type { Coins, Purse } from "./types.ts";

export const SPLIT_RULES = ["party-fund", "source", "recipient", "rotate"] as const;
export type SplitRule = (typeof SPLIT_RULES)[number];
export const MAX_SPLIT_RECIPIENTS = 20;
export const MAX_SPLIT_COPPER = 1e12;

/** The minimal campaign shape the planner reads (a full table, a projection or an encounter view). */
export type SplitTable = Pick<CloudTable, "purses" | "journal">;
export type CoinSplitSettings = {
  remainderRule?: SplitRule;
  partyFundId?: string;
  rotation?: { lastPurseId: string };
};

export type CoinSplitInput = {
  /** Null for encounter coins, which have no source purse. */
  sourceId: string | null;
  copper: number;
  recipientIds: string[];
  rule: SplitRule;
  /** party-fund: the fund the DM chose (or, with no party fund, an encounter's leftover recipient). recipient: who gets it. */
  purseId?: string;
};

export type RemainderReason =
  | "none"
  | "source-is-fund"
  | "party-fund"
  | "no-fund-source"
  | "no-fund-recipient"
  | "source"
  | "recipient"
  | "rotate";

export type CoinSplitPlan = {
  sourceId: string | null;
  copper: number;
  recipientIds: string[];
  n: number;
  share: number;
  remainder: number;
  rule: SplitRule;
  /** Where the leftover ends up (the source when it stays), or null when there is none. */
  remainderTo: string | null;
  remainderMoves: boolean;
  reason: RemainderReason;
  /** The source is one of the recipients: its own share is not moved. */
  keptShare: boolean;
  /** Copper leaving the source (0 for encounter coins). */
  debit: number;
  /** Shares that move, one per recipient other than the source, in recipient order. */
  shares: Array<{ purseId: string; copper: number; index: number }>;
  /** New rotation pointer, when the rotate rule placed the leftover. */
  rotation: string | null;
  /** Any NPC among the recipients: the split's text and chat note stay DM-only. */
  npc: boolean;
};

export function coinSplitSettings(t: Pick<SplitTable, "journal">): CoinSplitSettings {
  return ((t.journal as { coinSplit?: CoinSplitSettings } | undefined)?.coinSplit ?? {}) as CoinSplitSettings;
}
/** Missing means "party fund" for new and existing campaigns (owner decision, 2026-10-22). */
export function defaultSplitRule(t: Pick<SplitTable, "journal">): SplitRule {
  return coinSplitSettings(t).remainderRule ?? "party-fund";
}

function treasuries(t: SplitTable): Set<string> {
  return new Set((t.journal?.tradeEconomy?.exchanges ?? []).map((e) => e.purseId));
}
export function isNpc(t: SplitTable, p: Purse): boolean {
  return p.kind === "character" && (p.control === "npc" || !!t.journal?.world?.npcs?.some((n) => n.id === p.id));
}
/** Party funds in Party order; exchange treasuries are never "the party fund". */
export function partyFunds(t: SplitTable): Purse[] {
  const exchange = treasuries(t);
  return t.purses.filter((p) => p.kind === "party" && !exchange.has(p.id) && !p.nonParty);
}
/**
 * "The party fund": the DM's saved choice if it is still a party fund, otherwise the first
 * party fund in Party order (the fund "Assign all to party inventory" uses). `projected` is
 * set by a player's client, whose projection may name a fund it cannot list.
 */
export function designatedPartyFund(t: SplitTable, projected = false): string | null {
  const funds = partyFunds(t);
  const saved = coinSplitSettings(t).partyFundId;
  if (saved && funds.some((p) => p.id === saved)) return saved;
  if (projected && saved && !t.purses.some((p) => p.id === saved)) return saved;
  return funds[0]?.id ?? null;
}

/** Why a purse cannot receive a share, or null when it can. NPCs are DM-only. */
export function recipientProblem(t: SplitTable, p: Purse | undefined, actor: "dm" | "player"): string | null {
  if (!p) return "A recipient no longer exists. Review the split again.";
  if (p.kind !== "character") return `${p.name} is a party fund; party funds are not split recipients.`;
  if (p.nonParty || treasuries(t).has(p.id)) return `${p.name} is not a party character.`;
  if (!characterVisible(t, p)) return "A recipient is not available. Review the split again.";
  if (!inParty(t, p)) return `${p.name} is not travelling with the party.`;
  if (actor !== "dm" && isNpc(t, p)) return "Only the DM can include NPCs in a split.";
  return null;
}
/** Characters a split may pay, in Party order. */
export function splitRecipients(t: SplitTable, actor: "dm" | "player"): Purse[] {
  return t.purses.filter((p) => recipientProblem(t, p, actor) === null);
}

/** The first recipient after the saved pointer, in Party order, wrapping around. */
export function nextInRotation(t: SplitTable, recipientIds: string[]): string | null {
  const order = new Map(t.purses.map((p, index) => [p.id, index]));
  const sorted = [...recipientIds].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  if (!sorted.length) return null;
  const last = coinSplitSettings(t).rotation?.lastPurseId;
  const at = last === undefined ? undefined : order.get(last);
  if (at === undefined) return sorted[0]!;
  return sorted.find((id) => (order.get(id) ?? -1) > at) ?? sorted[0]!;
}

/**
 * Plan a split. Throws an Error with a reader-facing message when the split is not allowed.
 * Nothing is changed; callers apply the plan in their own atomic transaction.
 */
export function planCoinSplit(
  t: SplitTable,
  input: CoinSplitInput,
  options: { actor: "dm" | "player"; projected?: boolean },
): CoinSplitPlan {
  const { copper, recipientIds, rule } = input;
  if (!Number.isSafeInteger(copper) || copper < 1 || copper > MAX_SPLIT_COPPER)
    throw Error("Enter a whole amount of at least 1 cp to split.");
  if (!recipientIds.length) throw Error("Tick at least one character to split with.");
  if (recipientIds.length > MAX_SPLIT_RECIPIENTS)
    throw Error(`A split can pay at most ${MAX_SPLIT_RECIPIENTS} characters.`);
  if (new Set(recipientIds).size !== recipientIds.length) throw Error("Each recipient can be ticked once.");
  if (!SPLIT_RULES.includes(rule)) throw Error("Choose where the leftover copper goes.");
  const byId = new Map(t.purses.map((p) => [p.id, p]));
  const source = input.sourceId === null ? null : byId.get(input.sourceId);
  if (input.sourceId !== null && !source) throw Error("Account no longer exists.");
  for (const id of recipientIds) {
    const problem = recipientProblem(t, byId.get(id), options.actor);
    if (problem) throw Error(problem);
  }
  const keptShare = !!source && recipientIds.includes(source.id);
  if (keptShare && recipientIds.length === 1) throw Error("Tick at least one other character to split with.");
  const n = recipientIds.length;
  const share = Math.floor(copper / n);
  const remainder = copper - share * n;
  if (share < 1) throw Error(`Too little to split: each share would be 0 cp. ${formatCopper(copper)} among ${n} needs at least ${n} cp.`);
  let remainderTo: string | null = null;
  let reason: RemainderReason = "none";
  let rotation: string | null = null;
  const funds = partyFunds(t);
  if (remainder > 0) {
    if (rule === "source") {
      if (!source) throw Error("Encounter coins have no source purse. Choose another leftover rule.");
      remainderTo = source.id;
      reason = "source";
    } else if (rule === "recipient") {
      if (!input.purseId || !recipientIds.includes(input.purseId))
        throw Error("Choose who gets the leftover copper from the ticked characters.");
      remainderTo = input.purseId;
      reason = "recipient";
    } else if (rule === "rotate") {
      remainderTo = nextInRotation(t, recipientIds);
      rotation = remainderTo;
      reason = "rotate";
    } else if (source?.kind === "party") {
      // A split from any party fund keeps its leftover in that fund.
      remainderTo = source.id;
      reason = "source-is-fund";
    } else if (input.purseId && (funds.length || (options.projected && designatedPartyFund(t, true)))) {
      const designated = designatedPartyFund(t, options.projected);
      if (options.actor !== "dm" && input.purseId !== designated)
        throw Error("Only the DM can send the leftover to a different party fund.");
      if (!funds.some((p) => p.id === input.purseId) && input.purseId !== designated)
        throw Error("Choose an existing party fund for the leftover copper.");
      remainderTo = input.purseId;
      reason = "party-fund";
    } else {
      const designated = designatedPartyFund(t, options.projected);
      if (designated) {
        remainderTo = designated;
        reason = "party-fund";
      } else if (source) {
        remainderTo = source.id;
        reason = "no-fund-source";
      } else {
        if (input.purseId && !recipientIds.includes(input.purseId))
          throw Error("Choose who gets the leftover copper from the ticked characters.");
        remainderTo = input.purseId ?? recipientIds[0]!;
        reason = "no-fund-recipient";
      }
    }
  }
  const remainderMoves = remainder > 0 && remainderTo !== (source?.id ?? null);
  const shares = recipientIds
    .map((purseId, index) => ({ purseId, copper: share, index }))
    .filter((row) => row.purseId !== source?.id);
  const debit = source ? share * shares.length + (remainderMoves ? remainder : 0) : 0;
  // Conservation: every split pays out exactly the amount, in whole copper.
  if (share * n + remainder !== copper || (source && debit > copper))
    throw Error("The split does not add up. Nothing was changed.");
  const npc = recipientIds.some((id) => isNpc(t, byId.get(id)!));
  return {
    sourceId: source?.id ?? null,
    copper,
    recipientIds: [...recipientIds],
    n,
    share,
    remainder,
    rule,
    remainderTo,
    remainderMoves,
    reason,
    keptShare,
    debit,
    shares,
    rotation,
    npc,
  };
}

/**
 * Add whole copper to a purse as gold, silver and copper (largest coins first, the app's standard
 * breakdown), keeping every coin the purse already holds: platinum and electrum are not converted.
 */
export function creditCoins(coins: Coins, copper: number): Coins {
  if (!Number.isSafeInteger(copper) || copper < 0) throw Error("Invalid split amount.");
  const add = fromCopper(copper);
  const next = { ...coins };
  for (const key of ["cp", "sp", "ep", "gp", "pp"] as const) next[key] = (next[key] || 0) + add[key];
  if (
    Object.values(next).some((v) => !Number.isSafeInteger(v) || v < 0) ||
    !Number.isSafeInteger(toCopper(next)) ||
    toCopper(next) > MAX_SPLIT_COPPER
  )
    throw Error("The split exceeds the supported coin balance.");
  return next;
}

/** Exact change from the source, smallest coins first (the existing payment rule). */
export function debitCoins(purse: Pick<Purse, "name" | "coins">, copper: number): Coins {
  const next = spendCoins(purse.coins, copper);
  if (!next)
    throw Error(
      `${purse.name} holds only ${formatCopper(toCopper(purse.coins))}. Lower the amount or use the whole balance, then review the split again.`,
    );
  return next;
}

export function ruleLabel(rule: SplitRule): string {
  return rule === "party-fund"
    ? "party fund"
    : rule === "source"
      ? "stays in source"
      : rule === "recipient"
        ? "chosen recipient"
        : "rotation";
}

/** One line describing where the leftover went, for previews, receipts and notes. */
export function remainderText(plan: CoinSplitPlan, name: (id: string) => string): string {
  if (!plan.remainder || !plan.remainderTo) return "";
  const left = formatCopper(plan.remainder);
  const to = name(plan.remainderTo);
  switch (plan.reason) {
    case "source-is-fund":
      return `The ${left} left over stayed in ${to} (party fund).`;
    case "no-fund-source":
      return `This campaign has no party fund, so the ${left} left over stayed with ${to}.`;
    case "no-fund-recipient":
      return `This campaign has no party fund, so the ${left} left over went to ${to}.`;
    case "source":
      return `The ${left} left over stayed in ${to}.`;
    case "party-fund":
      return `The ${left} left over went to ${to} (party fund).`;
    case "recipient":
      return `The ${left} left over went to ${to} (chosen recipient).`;
    case "rotate":
      return `The ${left} left over went to ${to} (rotation).`;
    default:
      return "";
  }
}

/** The source line's note when the leftover did not move. */
function stayedText(plan: CoinSplitPlan): string {
  const left = formatCopper(plan.remainder);
  return plan.reason === "source-is-fund"
    ? `The ${left} left over stayed here (party fund).`
    : plan.reason === "no-fund-source"
      ? `This campaign has no party fund, so the ${left} left over stayed here.`
      : `The ${left} left over stayed here.`;
}

export type SplitLedgerMeta ={ id: string; role: "source" | "share" | "remainder"; keptShare?: number };

/**
 * Apply a planned fund split to a table that is already a private working copy (the caller's
 * transaction commits it all or nothing). Writes one ledger line per moved amount, all carrying
 * the same split ID, and returns the lines it wrote.
 */
export function applyFundSplit(
  t: CloudTable,
  plan: CoinSplitPlan,
  splitId: string,
  at: number,
  /** A player's client preview: purses outside its projection are not written (the room's reply replaces it). */
  projected = false,
): CloudTable["ledger"] {
  const name = (id: string) => t.purses.find((p) => p.id === id)?.name ?? "an account";
  const source = t.purses.find((p) => p.id === plan.sourceId);
  if (!source) throw Error("Account no longer exists.");
  if (plan.debit > 0) source.coins = debitCoins(source, plan.debit);
  const lines: CloudTable["ledger"] = [];
  const line = (
    suffix: string,
    purseId: string,
    copper: number,
    summary: string,
    split: SplitLedgerMeta,
  ) => {
    const row = { id: `${splitId}-${suffix}`, at, purseId, shopId: null, summary, copper, transactionType: "transfer" as const, split };
    lines.push(row);
    t.ledger.push(row);
  };
  const stays = plan.remainder > 0 && !plan.remainderMoves;
  line(
    "source",
    source.id,
    -plan.debit,
    plan.npc
      ? "Coin split"
      : [
          `Split: ${plan.n} shares of ${formatCopper(plan.share)}.`,
          plan.keptShare ? `${source.name} kept its own share.` : "",
          stays ? stayedText(plan) : plan.remainderMoves ? remainderText(plan, name) : "",
        ]
          .filter(Boolean)
          .join(" "),
    { id: splitId, role: "source", ...(plan.keptShare ? { keptShare: plan.share } : {}) },
  );
  for (const row of plan.shares) {
    const p = t.purses.find((p) => p.id === row.purseId);
    if (!p) throw Error("A recipient no longer exists. Review the split again.");
    p.coins = creditCoins(p.coins, row.copper);
    line(`share-${row.index}`, p.id, row.copper, `Split share from ${source.name}`, { id: splitId, role: "share" });
  }
  let hidden = false;
  if (plan.remainderMoves && plan.remainderTo && projected && !t.purses.some((p) => p.id === plan.remainderTo))
    hidden = true;
  else if (plan.remainderMoves && plan.remainderTo) {
    const p = t.purses.find((p) => p.id === plan.remainderTo);
    if (!p) throw Error("The leftover's recipient no longer exists. Review the split again.");
    p.coins = creditCoins(p.coins, plan.remainder);
    line("remainder", p.id, plan.remainder, `Split leftover from ${source.name} (${ruleLabel(plan.rule)} rule)`, {
      id: splitId,
      role: "remainder",
    });
  }
  if (!hidden && lines.reduce((sum, l) => sum + l.copper, 0) !== 0)
    throw Error("The split does not add up. Nothing was changed.");
  return lines;
}

/** The saved part of an encounter award that describes a split. Copper converts with fromCopper. */
export type EncounterCoinSplitReceipt = {
  coinShares: Array<{ purseId: string; copper: number }>;
  coinRemainder?: { purseId: string; copper: number; rule: SplitRule };
  coinSplitId: string;
};

/** The encounter draft's optional split choice. */
export type EncounterCoinSplit = {
  purseIds: string[];
  remainderRule: "party-fund" | "recipient" | "rotate";
  remainderPurseId?: string;
};

export function encounterSplitInput(split: EncounterCoinSplit, copper: number): CoinSplitInput {
  return {
    sourceId: null,
    copper,
    recipientIds: split.purseIds,
    rule: split.remainderRule,
    ...(split.remainderPurseId ? { purseId: split.remainderPurseId } : {}),
  };
}

/**
 * Credit an encounter's split coins into `purses` (mutated in place: the caller's transaction is
 * atomic) and return the ledger lines and the receipt fields. One planner and one credit helper
 * serve the shared Worker and the device path.
 */
export function applyEncounterSplit(
  t: SplitTable,
  split: EncounterCoinSplit,
  copper: number,
  receiptId: string,
  at: number,
  encounterName: string,
): {
  plan: CoinSplitPlan;
  ledger: CloudTable["ledger"];
  receipt: EncounterCoinSplitReceipt;
  touched: string[];
} {
  const plan = planCoinSplit(t, encounterSplitInput(split, copper), { actor: "dm" });
  const ledger: CloudTable["ledger"] = [];
  const touched = new Set<string>();
  const credit = (purseId: string, amount: number) => {
    const p = t.purses.find((p) => p.id === purseId);
    if (!p) throw Error("Choose an existing recipient for every item and coin award.");
    p.coins = creditCoins(p.coins, amount);
    touched.add(p.id);
  };
  for (const row of plan.shares) {
    credit(row.purseId, row.copper);
    ledger.push({
      id: `${receiptId}-share-${row.index}`,
      at,
      purseId: row.purseId,
      shopId: null,
      summary: `Encounter loot share: ${encounterName}`,
      copper: row.copper,
      transactionType: "adjustment",
      split: { id: receiptId, role: "share" },
    });
  }
  if (plan.remainderMoves && plan.remainderTo) {
    credit(plan.remainderTo, plan.remainder);
    ledger.push({
      id: `${receiptId}-remainder`,
      at,
      purseId: plan.remainderTo,
      shopId: null,
      summary: `Encounter loot leftover: ${encounterName} (${ruleLabel(plan.rule)} rule)`,
      copper: plan.remainder,
      transactionType: "adjustment",
      split: { id: receiptId, role: "remainder" },
    });
  }
  if (ledger.reduce((sum, l) => sum + l.copper, 0) !== copper)
    throw Error("The split does not add up. Nothing was changed.");
  if (plan.rotation) {
    const journal = ((t as { journal?: Record<string, unknown> }).journal ??= {} as never) as Record<string, unknown>;
    journal.coinSplit = { ...(journal.coinSplit as object | undefined), rotation: { lastPurseId: plan.rotation } };
  }
  return {
    plan,
    ledger,
    touched: [...touched],
    receipt: {
      coinShares: plan.shares.map((s) => ({ purseId: s.purseId, copper: s.copper })),
      ...(plan.remainderMoves && plan.remainderTo
        ? { coinRemainder: { purseId: plan.remainderTo, copper: plan.remainder, rule: plan.rule } }
        : {}),
      coinSplitId: receiptId,
    },
  };
}
