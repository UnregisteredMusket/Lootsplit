/**
 * Party treasure pool and item claims (future-development prompt 2, phase 2).
 *
 * The pool is the set of party-fund holdings carrying a `pool` marker (owner decision,
 * 2026-10-23): no new purse kind, so every existing view keeps working. Players mark Need,
 * Greed or Pass; a claim never moves anything. The DM resolves lots one at a time or with an
 * assist (random among Need then Greed, or round-robin), and one atomic `loot-resolve` moves
 * the items with one receipt. One pure planner serves the command (shared rooms and, through
 * executeLocalCommand, the device), the Review Inbox preview and the tests.
 */
import { canonicalJson } from "./canonical-json.ts";
import { isNpc, partyFunds, designatedPartyFund, recipientProblem } from "./coin-split.ts";
import { formatCopper } from "./money.ts";
import { POOL_GUARD } from "./custody.ts";
import {
  lootClaimsSchema,
  MAX_LOOT_LOTS,
  MAX_LOOT_ROLLS,
  type LootAwardChoice,
  type LootChoice,
  type LootClaim,
  type LootClaims,
  type LootCommand,
  type LootMethod,
  type LootResolution,
} from "./loot-claims-schema.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Holding, Purse } from "./types.ts";

export { POOL_GUARD };
/** The minimal campaign shape the pool reads (a full table, a projection or a preview copy). */
export type LootTable = Pick<CloudTable, "purses" | "holdings" | "journal">;

export const CHOICE_LABEL: Record<LootAwardChoice, string> = {
  need: "Need",
  greed: "Greed",
  pass: "Pass",
  dm: "DM's choice",
};
export const METHOD_LABEL: Record<LootMethod, string> = {
  manual: "one at a time",
  random: "random among Need, then Greed",
  "round-robin": "round-robin",
};

export function readLootClaims(t: Pick<LootTable, "journal">): LootClaims {
  const raw = (t.journal as { lootClaims?: unknown } | undefined)?.lootClaims;
  return lootClaimsSchema.parse(raw ?? {});
}

/** Party order for the pool: by name, then ID. Storage order differs between rooms and devices. */
export function lootOrder(a: Pick<Purse, "id" | "name">, b: Pick<Purse, "id" | "name">): number {
  return (
    a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Why a character cannot claim, or null. Only visible party player characters claim. */
export function claimantProblem(t: LootTable, p: Purse | undefined): string | null {
  if (!p) return "This character no longer exists.";
  if (p.kind !== "character" || isNpc(t, p))
    return "Only party player characters claim treasure-pool items. The DM can still give items to NPCs.";
  const problem = recipientProblem(t, p, "player");
  return problem ? problem.replace("Review the split again.", "Review the pool again.") : null;
}
/** Characters who may claim, in pool order. */
export function lootClaimants(t: LootTable): Purse[] {
  return t.purses.filter((p) => claimantProblem(t, p) === null).sort(lootOrder);
}
/** The party funds a pooled lot may sit in. */
export function poolFunds(t: LootTable): Purse[] {
  return partyFunds(t);
}
/** The fund an award or Add loot pools into: the DM's choice if still a party fund, else the designated fund. */
export function poolFund(t: LootTable, preferred?: string | null): string | null {
  if (preferred && partyFunds(t).some((p) => p.id === preferred)) return preferred;
  return designatedPartyFund(t);
}
export function isPooled(h: Pick<Holding, "pool">): boolean {
  return !!h.pool;
}
/** Pooled lots that sit in a party fund, in fund order then name. */
export function pooledLots(t: LootTable): Holding[] {
  const funds = partyFunds(t).map((p) => p.id);
  return t.holdings
    .filter((h) => h.pool && h.quantity > 0 && funds.includes(h.purseId))
    .sort(
      (a, b) =>
        funds.indexOf(a.purseId) - funds.indexOf(b.purseId) ||
        a.name.localeCompare(b.name, "en", { numeric: true }) ||
        (a.id < b.id ? -1 : 1),
    );
}
/** Open claims on a lot by current claimants, in pool order. */
export function lotClaims(t: LootTable, holdingId: string, state = readLootClaims(t)): LootClaim[] {
  const claimants = lootClaimants(t);
  const order = new Map(claimants.map((p, i) => [p.id, i]));
  return state.claims
    .filter((c) => c.holdingId === holdingId && order.has(c.purseId))
    .sort((a, b) => order.get(a.purseId)! - order.get(b.purseId)!);
}

/** FNV-1a (two 32-bit lanes): a short, deterministic fingerprint shared by client and server. */
function hash(text: string): string {
  let a = 0x811c9dc5,
    b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * What a reviewed resolution depends on: the selected lots, every open claim on them, the party
 * that may claim and (for round-robin) the pointer. A preview made before any of these changed
 * is refused ("Claims changed. Nothing moved.").
 */
export function lootFingerprint(
  t: LootTable,
  lots: Array<{ holdingId: string; quantity: number }>,
  method: LootMethod,
): string {
  const state = readLootClaims(t);
  return hash(
    canonicalJson({
      method,
      party: lootClaimants(t).map((p) => [p.id, p.name]),
      rotation: method === "round-robin" ? (state.rotation?.lastPurseId ?? null) : null,
      lots: lots.map((lot) => {
        const h = t.holdings.find((x) => x.id === lot.holdingId);
        return [
          lot.holdingId,
          lot.quantity,
          h ? [h.purseId, h.name, h.quantity, h.unitCopper, !!h.pool] : null,
          lotClaims(t, lot.holdingId, state).map((c) => [c.purseId, c.choice]),
        ];
      }),
    }),
  );
}

export type LootPlanInput = {
  method: LootMethod;
  lots: Array<{ holdingId: string; quantity: number; awards?: Array<{ purseId: string; quantity: number }> }>;
};
/** A d100 for (lot, character, round); undefined while a Pen & Paper total is not entered yet. */
export type LootRoll = (holdingId: string, purseId: string, round: number) => number | undefined;
export type LotPlan = Omit<LootResolution["lots"][number], "awards"> & {
  awards: Array<{ purseId: string; quantity: number; choice: LootAwardChoice }>;
  /** This lot needs dice (its units do not split evenly over its tier). */
  needsRolls: boolean;
  /** Rolls still to enter (Pen & Paper), as (character, round). */
  missing: Array<{ purseId: string; round: number }>;
};
export type LootPlan = {
  method: LootMethod;
  lots: LotPlan[];
  rotationAfter: string | null;
  npc: boolean;
  /** Units moving out of the pool. */
  moved: number;
  missing: number;
};

/**
 * Plan a resolution. Throws an Error with a reader-facing message when it is not allowed.
 * Nothing is changed. Without `roll`, lots that need dice are planned with no awards and
 * `needsRolls` set (the server-roll preview, which cannot show results).
 */
export function planLootResolution(t: LootTable, input: LootPlanInput, roll?: LootRoll): LootPlan {
  if (!input.lots.length) throw Error("Choose at least one treasure-pool item to resolve.");
  if (input.lots.length > MAX_LOOT_LOTS) throw Error(`Resolve at most ${MAX_LOOT_LOTS} items at once.`);
  if (new Set(input.lots.map((l) => l.holdingId)).size !== input.lots.length)
    throw Error("Each item can be resolved once per resolution.");
  const state = readLootClaims(t);
  const claimants = lootClaimants(t);
  const byId = new Map(t.purses.map((p) => [p.id, p]));
  const funds = new Set(partyFunds(t).map((p) => p.id));
  let pointer = state.rotation?.lastPurseId ?? null;
  let npc = false;
  const lots: LotPlan[] = [];
  for (const lot of input.lots) {
    const h = t.holdings.find((x) => x.id === lot.holdingId);
    if (!h || !h.pool || !funds.has(h.purseId))
      throw Error(
        `${h?.name ?? "An item"} is no longer in the treasure pool. Claims changed. Nothing moved; review again.`,
      );
    if (!Number.isSafeInteger(lot.quantity) || lot.quantity < 1 || lot.quantity > h.quantity)
      throw Error(`Only ${h.quantity} × ${h.name} ${h.quantity === 1 ? "is" : "are"} in the pool.`);
    const claims = lotClaims(t, h.id, state);
    const choiceOf = new Map(claims.map((c) => [c.purseId, c.choice]));
    const need = claimants.filter((p) => choiceOf.get(p.id) === "need").map((p) => p.id);
    const greed = claimants.filter((p) => choiceOf.get(p.id) === "greed").map((p) => p.id);
    const unmarked = claimants.filter((p) => !choiceOf.has(p.id)).map((p) => p.id);
    const awards = new Map<string, number>();
    const rolls = new Map<string, number[]>();
    const missing: LotPlan["missing"] = [];
    let tier: "need" | "greed" | null = null;
    let needsRolls = false;
    if (input.method === "manual") {
      if (!lot.awards?.length) throw Error(`Choose who receives ${h.name}.`);
      let total = 0;
      for (const award of lot.awards) {
        const p = byId.get(award.purseId);
        const problem = recipientProblem(t, p, "dm");
        if (problem) throw Error(problem.replace("Review the split again.", "Review the pool again."));
        if (!Number.isSafeInteger(award.quantity) || award.quantity < 1)
          throw Error("Give each recipient a whole number of items.");
        if (awards.has(award.purseId)) throw Error("List each recipient once per item.");
        awards.set(award.purseId, award.quantity);
        total += award.quantity;
        if (isNpc(t, p!)) npc = true;
      }
      if (total !== lot.quantity)
        throw Error(`${h.name}: the recipients' items must add up to ${lot.quantity}.`);
    } else {
      if (lot.awards) throw Error("Only one-at-a-time resolutions name recipients.");
      const tierIds = need.length ? need : greed;
      tier = need.length ? "need" : greed.length ? "greed" : null;
      if (!tierIds.length)
        throw Error(`No claims on ${h.name}: resolve it yourself or keep it in the pool.`);
      if (input.method === "round-robin") {
        const tierPurses = tierIds.map((id) => byId.get(id)!);
        for (let unit = 0; unit < lot.quantity; unit++) {
          const last = pointer ? byId.get(pointer) : undefined;
          const next =
            (last ? tierPurses.find((p) => lootOrder(p, last) > 0) : undefined) ?? tierPurses[0]!;
          awards.set(next.id, (awards.get(next.id) ?? 0) + 1);
          pointer = next.id;
        }
      } else {
        // Each claimant in the tier gets floor(units / n); the extra units go highest roll first.
        const n = tierIds.length;
        const base = Math.floor(lot.quantity / n);
        const extra = lot.quantity - base * n;
        let winners: string[] = [];
        if (extra > 0) {
          needsRolls = true;
          const top = roll ? pickTop(tierIds, extra, 1, h.id, roll, rolls, missing) : null;
          if (top) winners = top;
        }
        if (extra === 0 || winners.length === extra)
          for (const id of tierIds) {
            const units = base + (winners.includes(id) ? 1 : 0);
            if (units > 0) awards.set(id, units);
          }
      }
    }
    const awardRows = [...awards]
      .map(([purseId, quantity]) => ({
        purseId,
        quantity,
        choice: (choiceOf.get(purseId) === "need" || choiceOf.get(purseId) === "greed"
          ? choiceOf.get(purseId)
          : "dm") as LootAwardChoice,
      }))
      .sort((a, b) => lootOrder(byId.get(a.purseId)!, byId.get(b.purseId)!));
    const moved = awardRows.reduce((sum, a) => sum + a.quantity, 0);
    const settled = awardRows.length > 0;
    // Unit conservation: what moves plus what stays equals what was in the pool.
    if (settled && (moved !== lot.quantity || moved + (h.quantity - lot.quantity) !== h.quantity))
      throw Error("The resolution does not add up. Nothing moved.");
    lots.push({
      holdingId: h.id,
      fundId: h.purseId,
      name: h.name.slice(0, 200),
      poolQuantity: h.quantity,
      quantity: lot.quantity,
      unitCopper: h.unitCopper,
      tier,
      claims: claims.map((c) => ({ purseId: c.purseId, choice: c.choice, at: c.at, ...(c.by === "dm" ? { by: "dm" as const } : {}) })),
      unmarked: input.method === "manual" ? [] : unmarked,
      rolls: [...rolls].map(([purseId, d100]) => ({ purseId, d100 })),
      awards: awardRows,
      kept: h.quantity - lot.quantity,
      needsRolls,
      missing,
    });
  }
  return {
    method: input.method,
    lots,
    rotationAfter: input.method === "round-robin" ? pointer : null,
    npc,
    moved: lots.reduce((sum, l) => sum + l.awards.reduce((s, a) => s + a.quantity, 0), 0),
    missing: lots.reduce((sum, l) => sum + l.missing.length, 0),
  };
}

/**
 * The `k` highest of `ids` by d100. Ties that straddle the cut re-roll among the tied
 * characters only (round + 1). Returns null while a roll is missing.
 */
function pickTop(
  ids: string[],
  k: number,
  round: number,
  holdingId: string,
  roll: LootRoll,
  rolls: Map<string, number[]>,
  missing: LotPlan["missing"],
): string[] | null {
  if (round > MAX_LOOT_ROLLS) throw Error("Too many tied rolls. Resolve this item yourself.");
  const value = new Map<string, number>();
  for (const id of ids) {
    const v = roll(holdingId, id, round);
    if (v === undefined) {
      missing.push({ purseId: id, round });
      continue;
    }
    if (!Number.isInteger(v) || v < 1 || v > 100) throw Error("Each d100 total must be a whole number from 1 to 100.");
    rolls.set(id, [...(rolls.get(id) ?? []), v]);
    value.set(id, v);
  }
  if (value.size !== ids.length) return null;
  const sorted = [...ids].sort((a, b) => value.get(b)! - value.get(a)!);
  const winners: string[] = [];
  let i = 0;
  while (winners.length < k) {
    const v = value.get(sorted[i]!)!;
    const group = sorted.filter((id) => value.get(id) === v);
    const remaining = k - winners.length;
    if (group.length <= remaining) {
      winners.push(...group);
      i += group.length;
    } else {
      const sub = pickTop(group, remaining, round + 1, holdingId, roll, rolls, missing);
      if (!sub) return null;
      winners.push(...sub);
    }
  }
  return winners;
}

type Execution = {
  random?: (key: string) => number;
  source?: "server" | "local";
  preview?: boolean;
  manualRolls?: boolean;
};
type EventFn = (
  summary: string,
  kind?: "management",
  purseId?: string,
) => void;

const label = (choice: LootChoice) => CHOICE_LABEL[choice];
const list = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");

/** Apply one loot command to a private working copy (the caller commits all or nothing). */
export function applyLootCommand(
  t: CloudTable,
  seat: CloudSeat,
  cmd: LootCommand,
  at: number,
  execution: Execution,
  event: EventFn,
): void {
  const journal = t.journal!;
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can perform this action.");
  };
  const lastEvent = () => journal.events[journal.events.length - 1]!;
  if (cmd.kind === "loot-claim") {
    const h = t.holdings.find((x) => x.id === cmd.holdingId);
    if (!h || !h.pool || !partyFunds(t).some((p) => p.id === h.purseId))
      throw Error("The DM resolved this item or took it out of the treasure pool. Nothing changed.");
    const p = t.purses.find((x) => x.id === cmd.purseId);
    if (seat.role !== "dm" && !seat.purseIds.includes(cmd.purseId))
      throw Error("You can only claim for your own characters.");
    const problem = claimantProblem(t, p);
    if (problem) throw Error(problem);
    const state = readLootClaims(t);
    const existing = state.claims.find((c) => c.holdingId === h.id && c.purseId === p!.id);
    const previous = existing?.choice ?? null;
    if (previous !== cmd.before)
      throw Error("This claim changed on another device. Review it again.");
    if (previous === cmd.choice) return;
    const by = seat.role === "dm" ? ("dm" as const) : ("player" as const);
    state.claims = [
      ...state.claims.filter((c) => c !== existing),
      { holdingId: h.id, purseId: p!.id, choice: cmd.choice, at, by, commandId: cmd.id },
    ];
    (journal as { lootClaims?: LootClaims }).lootClaims = state;
    event(
      previous
        ? `${p!.name} changed ${label(previous)} → ${label(cmd.choice)} on ${h.name}${by === "dm" ? " (marked by the DM)" : ""}`
        : `${p!.name} marked ${label(cmd.choice)} on ${h.name}${by === "dm" ? " (marked by the DM)" : ""}`,
      "management",
      p!.id,
    );
    lastEvent().lootClaim = { holdingId: h.id, purseId: p!.id, name: h.name.slice(0, 200), choice: cmd.choice, previous, by };
    return;
  }
  if (cmd.kind === "loot-pool-set") {
    dm();
    const h = t.holdings.find((x) => x.id === cmd.holdingId);
    if (!h) throw Error("Item no longer exists.");
    if (cmd.pooled) {
      if (h.pool) throw Error("This item is already in the treasure pool.");
      assertPoolable(t, h);
      h.pool = { at, source: "dm" };
    } else {
      if (!h.pool) throw Error("This item is not in the treasure pool.");
      delete h.pool;
      dropClaims(t, h.id);
    }
    const fund = t.purses.find((p) => p.id === h.purseId);
    event(
      cmd.pooled
        ? `Put in the treasure pool: ${h.name} × ${h.quantity}`
        : `Taken out of the treasure pool (kept in ${fund?.name ?? "the party fund"}): ${h.name} × ${h.quantity}`,
      "management",
      h.purseId,
    );
    lastEvent().lootPool = {
      holdingId: h.id,
      name: h.name.slice(0, 200),
      quantity: h.quantity,
      pooled: cmd.pooled,
      ...(cmd.pooled ? { source: "dm" as const } : {}),
    };
    return;
  }
  // loot-resolve
  dm();
  if (lootFingerprint(t, cmd.lots, cmd.method) !== cmd.expect)
    throw Error("Claims changed. Nothing moved. Review the new preview and confirm again.");
  if (cmd.method !== "random" && (cmd.rolls || cmd.manualRolls))
    throw Error("Only random resolutions use rolls.");
  if (cmd.method === "random" && !cmd.rolls) throw Error("Choose server rolls or Pen & Paper rolls.");
  if (cmd.rolls === "manual" && execution.manualRolls !== true)
    throw Error("The DM has disabled manual rolls for this campaign.");
  if (cmd.rolls === "server" && cmd.manualRolls) throw Error("Server rolls cannot carry entered totals.");
  const entered = new Map((cmd.manualRolls ?? []).map((r) => [`${r.holdingId}\n${r.purseId}`, r.d100]));
  const roll: LootRoll | undefined =
    cmd.method !== "random"
      ? undefined
      : cmd.rolls === "manual"
        ? (holdingId, purseId, round) => entered.get(`${holdingId}\n${purseId}`)?.[round - 1]
        : (holdingId, purseId, round) => {
            if (!execution.random || !execution.source)
              throw Error(
                "Treasure-pool rolls are made by the room server or the DM's device. Send the resolution directly.",
              );
            return execution.random(`loot-${holdingId}-${purseId}-${round}`);
          };
  const plan = planLootResolution(t, { method: cmd.method, lots: cmd.lots }, roll);
  if (plan.missing) throw Error("Enter every d100 total, including tie-breaks, before resolving.");
  const state = readLootClaims(t);
  const name = (id: string) => t.purses.find((p) => p.id === id)?.name ?? "a character";
  const receiptLots: LootResolution["lots"] = [];
  for (const [i, lot] of plan.lots.entries()) {
    const h = t.holdings.find((x) => x.id === lot.holdingId)!;
    if (!lot.awards.length) throw Error(`${h.name} could not be resolved. Nothing moved.`);
    h.quantity -= lot.quantity;
    const { pool: _pool, equipped: _equipped, ...item } = h;
    const awards: LootResolution["lots"][number]["awards"] = [];
    for (const [j, award] of lot.awards.entries()) {
      const newId = `${cmd.id}-${i}-${j}`;
      if (t.holdings.some((x) => x.id === newId)) throw Error("This resolution was already recorded.");
      t.holdings.push({ ...item, id: newId, purseId: award.purseId, quantity: award.quantity });
      t.ledger.push({
        id: newId,
        at,
        purseId: award.purseId,
        shopId: null,
        summary: `Treasure pool: ${h.name} × ${award.quantity} (${CHOICE_LABEL[award.choice]})`,
        copper: 0,
        transactionType: "transfer",
        loot: {
          id: cmd.id,
          holdingId: newId,
          role: "award",
          choice: award.choice,
          quantity: award.quantity,
          unitCopper: h.unitCopper,
        },
      });
      awards.push({ ...award, holdingId: newId });
    }
    if (h.quantity === 0) {
      t.holdings = t.holdings.filter((x) => x.id !== h.id);
      state.claims = state.claims.filter((c) => c.holdingId !== h.id);
    }
    const { needsRolls: _n, missing: _m, ...stored } = lot;
    receiptLots.push({ ...stored, awards });
  }
  if (plan.rotationAfter) state.rotation = { lastPurseId: plan.rotationAfter };
  (journal as { lootClaims?: LootClaims }).lootClaims = state;
  const recipients = [...new Set(plan.lots.flatMap((l) => l.awards.map((a) => a.purseId)))];
  const fundId = plan.lots[0]!.fundId;
  event(
    `Treasure pool resolved: ${plan.lots.length} item${plan.lots.length === 1 ? "" : "s"} to ${recipients.length} character${recipients.length === 1 ? "" : "s"} (${METHOD_LABEL[plan.method]})`,
    "management",
    fundId,
  );
  lastEvent().lootResolution = {
    id: cmd.id,
    method: plan.method,
    ...(cmd.rolls ? { rolls: cmd.rolls === "manual" ? ("manual" as const) : execution.source! } : {}),
    lots: receiptLots,
    ...(plan.rotationAfter ? { rotationAfter: plan.rotationAfter } : {}),
    ...(plan.npc ? { npc: true } : {}),
  };
  const parts = plan.lots.map((lot) => {
    const to = list(lot.awards.map((a) => `${name(a.purseId)}${a.quantity > 1 ? ` × ${a.quantity}` : ""}`));
    const rolled = lot.rolls.length
      ? ` (${[...lot.rolls].sort((a, b) => b.d100.at(-1)! - a.d100.at(-1)!).map((r) => r.d100.join("/")).join(" vs ")})`
      : "";
    return `${lot.name} to ${to}${rolled}`;
  });
  const count = plan.lots.length;
  const full = `The DM resolved ${count} treasure-pool item${count === 1 ? "" : "s"}: ${parts.join(", ")}.`;
  const text =
    full.length <= 500
      ? full
      : `The DM resolved ${count} treasure-pool items for ${recipients.length} characters (${plan.moved} items). See Activity for each line.`;
  // A resolution that gave an item to an NPC posts its note to the DM only (as coin split does).
  const npcId = recipients.find((id) => {
    const p = t.purses.find((x) => x.id === id);
    return !!p && isNpc(t, p);
  });
  t.notes.push({
    id: cmd.id + "-note",
    at,
    from: "dm",
    to: plan.npc ? "dm" : "party",
    purseId: plan.npc && npcId ? npcId : fundId,
    text,
  });
}

/** Why a holding cannot enter the pool (thrown), or nothing. */
export function assertPoolable(t: LootTable, h: Holding): void {
  if (!partyFunds(t).some((p) => p.id === h.purseId))
    throw Error("Only items held by a party fund can go in the treasure pool.");
  if (h.kind !== "item" || h.service || h.deed || h.property)
    throw Error("Only physical items can go in the treasure pool.");
  if (h.custody || h.reservedFor)
    throw Error("Retrieve this item from its property first; stored or reserved goods cannot go in the pool.");
  if (h.equipped) throw Error("Unequip this item before putting it in the treasure pool.");
}

function dropClaims(t: LootTable, holdingId: string) {
  const state = readLootClaims(t);
  if (!state.claims.some((c) => c.holdingId === holdingId)) return;
  state.claims = state.claims.filter((c) => c.holdingId !== holdingId);
  (t.journal as { lootClaims?: LootClaims }).lootClaims = state;
}

/**
 * Invariants after every command: a pooled lot stays an unequipped physical item in a party
 * fund, and open claims refer only to lots still in the pool (a lot the DM deleted or took out
 * loses its open claims; their history stays in the journal events).
 */
export function validateLootPool(t: LootTable): void {
  for (const h of t.holdings) {
    if (!h.pool) continue;
    const p = t.purses.find((x) => x.id === h.purseId);
    if (!p || p.kind !== "party") throw Error(POOL_GUARD);
    if (h.kind !== "item" || h.custody || h.reservedFor || h.deed || h.equipped) throw Error(POOL_GUARD);
  }
  const raw = (t.journal as { lootClaims?: unknown } | undefined)?.lootClaims;
  if (!raw) return;
  const state = readLootClaims(t);
  const pooled = new Set(t.holdings.filter((h) => h.pool).map((h) => h.id));
  const kept = state.claims.filter((c) => pooled.has(c.holdingId));
  if (kept.length !== state.claims.length) {
    state.claims = kept;
    (t.journal as { lootClaims?: LootClaims }).lootClaims = state;
  }
}

/** A short "2 Need, 1 Greed, 1 not yet" line for a lot. */
export function claimSummary(t: LootTable, holdingId: string): string {
  const claims = lotClaims(t, holdingId);
  const count = (choice: LootChoice) => claims.filter((c) => c.choice === choice).length;
  const unmarked = lootClaimants(t).length - claims.length;
  return [
    count("need") ? `${count("need")} Need` : "",
    count("greed") ? `${count("greed")} Greed` : "",
    count("pass") ? `${count("pass")} Pass` : "",
    unmarked > 0 ? `${unmarked} not yet` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function formatLotValue(h: Pick<Holding, "unitCopper" | "quantity">): string {
  return h.quantity > 1
    ? `${formatCopper(h.unitCopper)} each`
    : formatCopper(h.unitCopper);
}
