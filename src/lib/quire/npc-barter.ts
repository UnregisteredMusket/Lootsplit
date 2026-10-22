import type { CloudSeat, CloudTable } from "./cloud.ts";
import type { Holding } from "./types.ts";
import { readWorld, type Npc } from "./world-schema.ts";
import { readFinance } from "./finance.ts";
import { toCopper, formatCopper } from "./money.ts";
import { barterEligible, npcAvailableHere, settleExchange } from "./world.ts";
import { characterSheet } from "../characters/campaign-sheet.mjs";
import { rollSpec } from "../characters/model.mjs";
import {
  barterAttemptSchema,
  npcBarterStateSchema,
  type BarterAttempt,
  type BarterLineKey,
  type BarterLines,
  type BarterMode,
  type BarterReply,
  type BarterRules,
  type BarterSide,
  type BarterStance,
  type NpcBarterCommand,
  type NpcBarterState,
} from "./npc-barter-schema.ts";
import type { TradeExecution } from "./trade-economy-schema.ts";

// The NPC barter engine (docs/NPC-BARTER.md). One pure quote function serves the
// client preview and the authoritative command, so the odds shown are the odds used.

export const DAY_MINUTES = 1440;
export const STANCE_SHIFT: Record<BarterStance, number> = { generous: -2, fair: 0, shrewd: 2 };

/** Default dialogue per stance. The DM can replace any line per NPC. */
export const STANCE_LINES: Record<BarterStance, Required<BarterLines>> = {
  generous: {
    greet:
      "Ah, a traveller! Come in out of the wind, love. I'm sure we can help each other.",
    barter: "A trade? Lovely. Show me what you've brought.",
    accept: "Done, and gladly. Pleasure doing business with you.",
    counter: "Oh, so close. Add {coins} and it's yours, my dear.",
    refuse: "I'd love to, truly, but I can't do it for that.",
    tooLow: "Oh, no, no. That wouldn't keep my shop open.",
    noInterest: "Bless you, but I've no use for {item}.",
    cooldown: "Let's not haggle ourselves sore. Come back after {time}, or bring me something better.",
    dm: "Let me think on that one. I'll send word.",
    bye: "Safe roads, and come back soon!",
  },
  fair: {
    greet: "Welcome. What can I do for you?",
    barter: "A trade, then. Let's see what you have.",
    accept: "Fair enough. We have a deal.",
    counter: "Close. Add {coins} and we have a deal.",
    refuse: "No. Not for that.",
    tooLow: "You're not serious. That's not worth my while.",
    noInterest: "I've no use for {item}.",
    cooldown: "Come back after {time}, or come back with a better offer.",
    dm: "I'll need to think about that. Leave it with me.",
    bye: "Safe travels.",
  },
  shrewd: {
    greet: "Mind the stock. You buying, or just looking?",
    barter: "Trade, is it? Go on. Impress me.",
    accept: "Hm. Fine. Don't tell the others I went this low.",
    counter: "Nearly. Another {coins} and you'll walk out with it.",
    refuse: "Ha. No.",
    tooLow: "Is that a joke? Make a real offer or move along.",
    noInterest: "{item}? What would I want with that?",
    cooldown: "Don't waste my time. Not before {time}, and not for less.",
    dm: "That's a bigger matter. I'll think on it.",
    bye: "Shut the door behind you.",
  },
};

export function readNpcBarter(world: { npcBarter?: unknown } | undefined): NpcBarterState {
  return npcBarterStateSchema.parse(world?.npcBarter ?? {});
}

export function campaignMinute(t: Pick<CloudTable, "journal">): number {
  const f = readFinance(t.journal?.finance);
  return f.day * DAY_MINUTES + (f.minuteOfDay ?? 0);
}

export function formatCampaignMinute(minute: number): string {
  const day = Math.floor(minute / DAY_MINUTES),
    m = minute % DAY_MINUTES;
  return `Campaign day ${day}, ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** An NPC answers barter itself when it allows bartering and has no player controller. */
export function npcAnswersBarter(npc: Npc): boolean {
  return npc.barterAllowed && !npc.controllerPurseId;
}

export function npcBarterMode(npc: Npc, rules: BarterRules): BarterMode {
  return npc.barter?.mode ?? rules.mode;
}

export function npcBarterStance(npc: Npc, rules: BarterRules): BarterStance {
  return npc.barter?.stance ?? rules.stance;
}

export function npcLineTemplate(npc: Npc, rules: BarterRules, key: BarterLineKey): string {
  return npc.barter?.lines?.[key] ?? STANCE_LINES[npcBarterStance(npc, rules)][key];
}

export function fillLine(
  template: string,
  vars: { coins?: string; time?: string; item?: string; character?: string },
): string {
  return template
    .replace(/\{(coins|time|item|character)\}/g, (_, k: keyof typeof vars) => vars[k] ?? "")
    .slice(0, 600);
}

/** Memory key: the player account, or the character when the DM acts for it. */
export function barterAccount(seat: Pick<CloudSeat, "role" | "id" | "userId">, purseId: string) {
  if (seat.role === "dm") return `character:${purseId}`;
  return seat.userId ? `account:${seat.userId}` : `seat:${seat.id}`;
}

export type Advantage = "normal" | "advantage" | "disadvantage";
export type CharacterCheck = { bonus: number; cha: number | null; advantage: Advantage; sheet: boolean };

/** Charisma (Persuasion): the sheet's bonus, CHA ≥ 16 advantage, CHA ≤ 8 disadvantage. */
export function persuasionCheck(t: Pick<CloudTable, "purses" | "sheets">, purseId: string): CharacterCheck {
  const purse = t.purses.find((p) => p.id === purseId);
  const legacy = t.sheets?.find((s) => s.purseId === purseId);
  if (!purse || (!purse.sheet && !legacy)) return { bonus: 0, cha: null, advantage: "normal", sheet: false };
  const sheet = characterSheet(purse, [], legacy);
  const formula = rollSpec(sheet, "skill", "Persuasion").formula;
  const bonus = Number(/^1d20([+-]\d+)?$/.exec(formula.replace(/\s/g, ""))?.[1] ?? 0);
  const cha = Math.floor(Number(sheet.scores.cha));
  const advantage: Advantage = cha >= 16 ? "advantage" : cha <= 8 ? "disadvantage" : "normal";
  return { bonus: Number.isFinite(bonus) ? bonus : 0, cha: Number.isFinite(cha) ? cha : null, advantage, sheet: true };
}

/** Chance of meeting the DC, in thousandths, from the exact d20 distribution. */
export function successChance(dc: number, bonus: number, advantage: Advantage): number {
  const need = dc - bonus;
  const p = Math.max(0, Math.min(20, 21 - need)) / 20;
  const chance = advantage === "advantage" ? 1 - (1 - p) ** 2 : advantage === "disadvantage" ? p * p : p;
  return Math.round(chance * 1000);
}

export function oddsWords(chance: number): string {
  if (chance >= 950) return "Almost certain";
  if (chance >= 750) return "Very likely";
  if (chance >= 550) return "Likely";
  if (chance >= 450) return "About even";
  if (chance >= 250) return "Unlikely";
  if (chance >= 50) return "Very unlikely";
  return "Almost impossible";
}

/** DC from fairness (thousandths): 10 + 25 × (1 − r), plus stance and repeats, kept within 5–25. */
export function barterDc(ratio: number, stanceShift: number, repeats: number, repeatDc: number): number {
  const base = Math.round((35000 - 25 * Math.min(ratio, 1400)) / 1000);
  return Math.max(5, Math.min(25, base + stanceShift + repeats * repeatDc));
}

export type Band = "too-low" | "low" | "close" | "fair" | "generous";
export function fairnessBand(ratio: number, rules: BarterRules): Band {
  if (ratio >= rules.acceptPercent * 10) return "generous";
  if (ratio >= 1000) return "fair";
  if (ratio >= 850) return "close";
  if (ratio >= rules.refusePercent * 10) return "low";
  return "too-low";
}

/** Marker position (0–100) on the five-band fairness scale. */
export function fairnessPosition(ratio: number, rules: BarterRules): number {
  const stops: [number, number][] = [
    [300, 0],
    [rules.refusePercent * 10, 20],
    [Math.max(rules.refusePercent * 10 + 1, 850), 50],
    [1000, 66],
    [rules.acceptPercent * 10, 80],
    [rules.acceptPercent * 10 + 300, 100],
  ];
  if (ratio <= stops[0][0]) return 0;
  for (let i = 1; i < stops.length; i++)
    if (ratio <= stops[i][0]) {
      const [a, pa] = stops[i - 1],
        [b, pb] = stops[i];
      return Math.round(pa + ((pb - pa) * (ratio - a)) / Math.max(1, b - a));
    }
  return 100;
}

/** A failed attempt starts the cooldown and counts toward repeat DC increases. */
export function attemptFailed(a: BarterAttempt): boolean {
  if (a.cleared) return false;
  if (a.status === "refused") return true;
  return a.status === "declined" && a.counterCopper !== undefined && !!a.roll && a.roll.total < a.quote.dc;
}

function goodKey(h: Pick<Holding, "commodityId" | "name">) {
  return h.commodityId ? `c:${h.commodityId}` : `n:${h.name.trim().toLocaleLowerCase()}`;
}

export type BarterOfferInput = {
  npcId: string;
  purseId: string;
  give: BarterSide;
  ask: BarterSide;
};

export type BarterQuote = {
  mode: BarterMode;
  kind: "accept" | "check" | "refuse" | "dm";
  received: number;
  given: number;
  ratio: number;
  dc: number;
  bonus: number;
  advantage: Advantage;
  cha: number | null;
  chance: number;
  need: number;
  repeat: number;
  combined: boolean;
  band: Band;
  position: number;
  addCopper: number;
  locked: { until: number } | null;
  unwanted: string[];
  unreferenced: string[];
  reasons: string[];
};

/** What a player may see: no valuation, rules or other players' memory. */
export type PublicBarterQuote = Omit<BarterQuote, "received" | "given" | "ratio">;
export function publicQuote(q: BarterQuote): PublicBarterQuote {
  const { received: _r, given: _g, ratio: _ratio, ...rest } = q;
  return rest;
}

/**
 * The authoritative quote. Throws for an offer that cannot be made at all.
 * `values` are DM per-deal valuations (copper per unit) for goods without a reference price.
 */
export function quoteNpcBarter(
  t: CloudTable,
  seat: Pick<CloudSeat, "role" | "id" | "userId">,
  input: BarterOfferInput,
  options: { values?: { holdingId: string; copper: number }[]; excludeAttemptId?: string; ignoreCaps?: boolean } = {},
): BarterQuote {
  const world = readWorld(t.journal?.world);
  const state = readNpcBarter(world);
  const rules = state.rules;
  const npc = world.npcs.find((n) => n.id === input.npcId);
  if (!npc) throw Error("This NPC is no longer here.");
  if (!npcAnswersBarter(npc)) throw Error(`${npc.name} doesn't trade on their own. Use Trading & Barter.`);
  if (seat.role !== "dm" && !npcAvailableHere(npc, t)) throw Error(`${npc.name} isn't here right now.`);
  const character = t.purses.find((p) => p.id === input.purseId);
  if (!character || character.kind !== "character" || character.nonParty || character.control === "npc")
    throw Error("Choose one of the party's characters.");
  if (input.give.purseId !== input.purseId || input.ask.purseId !== input.npcId)
    throw Error("The offer's sides don't match this conversation.");
  const now = campaignMinute(t);
  const mine = (a: BarterAttempt) =>
    a.npcId === npc.id &&
    a.id !== options.excludeAttemptId &&
    (rules.partyMemory || a.account === barterAccount(seat, input.purseId) || a.purseId === input.purseId);
  const recent = state.attempts.filter((a) => a.npcId === npc.id && a.id !== options.excludeAttemptId && a.minute >= now - DAY_MINUTES);
  const reasons: string[] = [];
  const unwanted: string[] = [],
    unreferenced: string[] = [];
  let given = input.ask.copper;
  for (const item of input.ask.items) {
    const h = t.holdings.find((h) => h.id === item.holdingId && h.purseId === npc.id);
    if (!h) throw Error("An item you asked for is no longer available. Review the offer.");
    given += h.unitCopper * item.quantity;
  }
  // Units of each good already received from the party in the window count toward the cap.
  const units = new Map<string, number>();
  const accepted = recent.filter((a) => a.status === "accepted");
  for (const a of accepted)
    for (const item of a.give.items) {
      try {
        const h = JSON.parse(item.before) as Holding;
        units.set(goodKey(h), (units.get(goodKey(h)) ?? 0) + item.quantity);
      } catch {
        /* A malformed snapshot counts nothing. */
      }
    }
  let received = input.give.copper;
  const wants = npc.barter?.wants;
  for (const item of input.give.items) {
    const h = t.holdings.find((h) => h.id === item.holdingId && h.purseId === input.purseId);
    if (!h) throw Error("An item you offered is no longer in your inventory. Review the offer.");
    if (wants && !wants.includes(h.category ?? "")) {
      unwanted.push(h.name);
      continue;
    }
    const override = options.values?.find((v) => v.holdingId === h.id);
    if (h.valueSource === "player" && !override) {
      unreferenced.push(h.name);
      continue;
    }
    const key = goodKey(h),
      already = units.get(key) ?? 0,
      counted = Math.max(0, Math.min(item.quantity, rules.unitCap - already));
    units.set(key, already + item.quantity);
    if (counted < item.quantity) reasons.push(`${npc.name} only wants ${rules.unitCap} ${h.name} a day.`);
    const unit = override ? override.copper : h.unitCopper;
    received += Math.floor((unit * counted * rules.receivePercent) / 100);
  }
  if (!given && !received && !input.give.items.length && !input.ask.items.length)
    throw Error("Put something in the offer first.");
  let combined = false;
  if (rules.combineTrades && accepted.length) {
    combined = true;
    for (const a of accepted) {
      received += a.quote.received;
      given += a.quote.given;
    }
    reasons.push(`Judged together with ${accepted.length === 1 ? "an earlier trade" : `${accepted.length} earlier trades`} with ${npc.name} today.`);
  }
  const ratio = given ? Math.min(1e9, Math.floor((received * 1000) / given)) : received ? 1e9 : 0;
  const failed = state.attempts.filter((a) => mine(a) && a.minute >= now - DAY_MINUTES && attemptFailed(a));
  const repeat = failed.length;
  const stance = npcBarterStance(npc, rules);
  const dc = barterDc(ratio, STANCE_SHIFT[stance], repeat, rules.repeatDc);
  const check = persuasionCheck(t, input.purseId);
  const chance = successChance(dc, check.bonus, check.advantage);
  const lastFail = failed.sort((a, b) => b.minute - a.minute)[0];
  const locked =
    lastFail && rules.cooldownMinutes > 0 && lastFail.minute + rules.cooldownMinutes > now && ratio < lastFail.quote.ratio + 100
      ? { until: lastFail.minute + rules.cooldownMinutes }
      : null;
  const giveWindow = accepted.reduce((s, a) => s + a.quote.given, 0);
  const thisGiven = combined ? given - giveWindow : given;
  let kind: BarterQuote["kind"];
  if (!options.ignoreCaps && unreferenced.length && rules.unreferencedToDm) {
    kind = "dm";
    reasons.push(`${unreferenced.join(", ")}: no reference price, so the DM values it.`);
  } else if (!options.ignoreCaps && (thisGiven > rules.offerCapCopper || giveWindow + thisGiven > rules.dailyCapCopper)) {
    kind = "dm";
    reasons.push(`Bigger than ${npc.name} trades on their own: the DM decides.`);
  } else if (!options.ignoreCaps && repeat >= rules.attemptsBeforeQueue) {
    kind = "dm";
    reasons.push(`Too many tries with ${npc.name} today: the DM decides.`);
  } else if (ratio >= rules.acceptPercent * 10) kind = "accept";
  else if (ratio < rules.refusePercent * 10) kind = "refuse";
  else kind = "check";
  if (unwanted.length) reasons.push(`${npc.name} shows no interest in ${unwanted.join(", ")}.`);
  const target = Math.ceil((given * rules.acceptPercent) / 100);
  const addCopper = kind === "check" || kind === "refuse" ? Math.ceil(Math.max(0, target - received) / 10) * 10 : 0;
  return {
    mode: npcBarterMode(npc, rules),
    kind,
    received,
    given,
    ratio,
    dc,
    bonus: check.bonus,
    advantage: check.advantage,
    cha: check.cha,
    chance,
    need: dc - check.bonus,
    repeat,
    combined,
    band: fairnessBand(ratio, rules),
    position: fairnessPosition(ratio, rules),
    addCopper,
    locked,
    unwanted,
    unreferenced,
    reasons,
  };
}

/** The reply a player must choose for this quote (or "dm", which is always allowed). */
export function replyFor(q: Pick<BarterQuote, "kind">): BarterReply {
  return q.kind === "check" ? "persuade" : q.kind === "accept" ? "offer" : q.kind === "refuse" ? "too-low" : "dm";
}

function rollD20s(execution: TradeExecution, seat: Pick<CloudSeat, "role">, advantage: Advantage) {
  if (!execution.random || !execution.source)
    throw Error("NPC barter checks are rolled by the room server or the DM's device. Send the offer directly.");
  if (execution.source === "local" && seat.role !== "dm")
    throw Error("Barter checks need the DM's device or a shared room.");
  const draw = (n: number) => {
    const r = execution.random!(`npc-barter-d20-${n}`);
    if (!Number.isInteger(r) || r < 1 || r > 100) throw Error("Invalid random result.");
    // d100 → d20 without bias: 100 is a multiple of 20.
    return ((r - 1) % 20) + 1;
  };
  const dice = advantage === "normal" ? [draw(1)] : [draw(1), draw(2)];
  const kept = advantage === "advantage" ? Math.max(...dice) : advantage === "disadvantage" ? Math.min(...dice) : dice[0];
  return { dice, kept, source: execution.source };
}

export function applyNpcBarterCommand(
  t: CloudTable,
  seat: CloudSeat,
  cmd: NpcBarterCommand,
  at: number,
  execution: TradeExecution,
) {
  const journal = t.journal!;
  const world = (journal.world = readWorld(journal.world));
  const state = (world.npcBarter = readNpcBarter(world));
  const dm = () => {
    if (seat.role !== "dm") throw Error("Only the DM can perform this action.");
  };
  const npcOf = (id: string) => {
    const npc = world.npcs.find((n) => n.id === id);
    if (!npc) throw Error("This NPC is no longer here.");
    return npc;
  };
  let attemptPurse = "";
  const line = (npc: Npc, key: BarterLineKey, vars: Parameters<typeof fillLine>[1] = {}) => ({
    key,
    text: fillLine(npcLineTemplate(npc, state.rules, key), {
      character: t.purses.find((p) => p.id === attemptPurse)?.name,
      ...vars,
    }),
  });
  const settle = (a: BarterAttempt, receipt: string, extra = 0) => {
    const give = { ...a.give, copper: a.give.copper + extra };
    const payer = t.purses.find((p) => p.id === give.purseId);
    if (!payer || toCopper(payer.coins) < give.copper)
      throw Error("You can't afford those coins right now. Review the offer.");
    settleExchange(t, give, a.ask, receipt, at);
    a.status = "accepted";
    a.settled = receipt;
  };
  const outcomeOfRoll = (a: BarterAttempt, npc: Npc, receipt: string) => {
    const roll = a.roll!;
    if (roll.total >= a.quote.dc) {
      settle(a, receipt);
      a.lines.push(line(npc, "accept"));
    } else if (state.rules.counterMargin > 0 && roll.total >= a.quote.dc - state.rules.counterMargin) {
      const fresh = quoteFor(a, { ignoreCaps: true });
      a.counterCopper = Math.max(10, fresh.addCopper);
      a.status = "countered";
      a.lines.push(line(npc, "counter", { coins: formatCopper(a.counterCopper) }));
    } else {
      a.status = "refused";
      a.lines.push(line(npc, "refuse"));
      if (state.rules.cooldownMinutes > 0)
        a.lines.push(line(npc, "cooldown", { time: formatCampaignMinute(a.minute + state.rules.cooldownMinutes) }));
    }
  };
  const quoteFor = (a: BarterAttempt, options: { values?: { holdingId: string; copper: number }[]; ignoreCaps?: boolean } = {}) =>
    quoteNpcBarter(t, seat.role === "dm" ? { role: "dm", id: seat.id } : seat, { npcId: a.npcId, purseId: a.purseId, give: a.give, ask: a.ask }, {
      excludeAttemptId: a.id,
      values: options.values ?? a.values,
      ignoreCaps: options.ignoreCaps,
    });
  const attemptOf = (id: string, revision: number) => {
    const a = state.attempts.find((a) => a.id === id);
    if (!a || a.revision !== revision) throw Error("This barter changed. Review it again.");
    attemptPurse = a.purseId;
    return a;
  };
  if (cmd.kind === "npc-barter-rules") {
    dm();
    if (state.revision !== cmd.revision) throw Error("The barter rules changed. Reload before saving.");
    state.rules = cmd.rules;
    state.revision++;
    journal.events.push({ id: cmd.id + "-event", at, summary: "NPC barter rules updated.", kind: "management" });
    return;
  }
  if (cmd.kind === "npc-barter-npc") {
    dm();
    const npc = npcOf(cmd.npcId);
    if (JSON.stringify(npc.barter ?? null) !== JSON.stringify(cmd.before))
      throw Error("This NPC's barter settings changed. Reload before saving.");
    if (cmd.config) npc.barter = cmd.config;
    else delete npc.barter;
    return;
  }
  if (cmd.kind === "npc-barter-offer") {
    attemptPurse = cmd.purseId;
    if (seat.role !== "dm" && !seat.purseIds.includes(cmd.purseId))
      throw Error("Only this character's player or the DM can make this offer.");
    if (state.attempts.some((a) => a.id === cmd.id)) throw Error("This offer was already made.");
    const npc = npcOf(cmd.npcId);
    if (!npcAvailableHere(npc, t)) throw Error(`${npc.name} isn't here right now.`);
    barterEligible(t, { left: cmd.give, right: cmd.ask });
    const payer = t.purses.find((p) => p.id === cmd.purseId)!;
    if (toCopper(payer.coins) < cmd.give.copper) throw Error("You can't afford those coins right now.");
    const q = quoteNpcBarter(t, seat, cmd);
    if (q.locked)
      throw Error(
        `${npc.name} won't consider this or a worse offer until ${formatCampaignMinute(q.locked.until)}. Make the offer clearly better, or wait.`,
      );
    const expected = replyFor(q);
    if (cmd.reply !== "dm" && cmd.reply !== expected)
      throw Error("The offer changed while you were choosing. Review the replies again.");
    const a = barterAttemptSchema.parse({
      id: cmd.id,
      npcId: npc.id,
      purseId: cmd.purseId,
      account: barterAccount(seat, cmd.purseId),
      at,
      minute: campaignMinute(t),
      revision: 0,
      mode: q.mode,
      reply: cmd.reply,
      give: cmd.give,
      ask: cmd.ask,
      quote: {
        received: q.received,
        given: q.given,
        ratio: q.ratio,
        dc: q.dc,
        kind: q.kind,
        bonus: q.bonus,
        advantage: q.advantage,
        chance: q.chance,
        repeat: q.repeat,
        combined: q.combined,
        reasons: q.reasons,
      },
      status: "queued",
      lines: [],
    });
    if (cmd.reply === "dm" || q.kind === "dm" || q.mode === "dm") {
      a.lines.push(line(npc, "dm"));
    } else if (q.kind === "accept") {
      if (q.mode === "confirm") {
        a.status = "confirm";
        a.lines.push(line(npc, "dm"));
      } else {
        settle(a, cmd.id);
        a.lines.push(line(npc, "accept"));
      }
    } else if (q.kind === "refuse") {
      a.status = "refused";
      a.lines.push(q.unwanted.length && !q.received ? line(npc, "noInterest", { item: q.unwanted[0] }) : line(npc, "tooLow"));
      if (state.rules.cooldownMinutes > 0)
        a.lines.push(line(npc, "cooldown", { time: formatCampaignMinute(a.minute + state.rules.cooldownMinutes) }));
    } else {
      const r = rollD20s(execution, seat, q.advantage);
      a.roll = { ...r, total: r.kept + q.bonus };
      if (q.mode === "confirm") {
        a.status = "confirm";
        a.lines.push(line(npc, "dm"));
      } else outcomeOfRoll(a, npc, cmd.id);
    }
    if (a.status !== "queued" && a.status !== "confirm") a.decidedAt = at;
    state.attempts.push(a);
    return;
  }
  if (cmd.kind === "npc-barter-decide") {
    const a = attemptOf(cmd.attemptId, cmd.revision);
    if (seat.role !== "dm" && !seat.purseIds.includes(a.purseId))
      throw Error("Only this character's player or the DM can answer.");
    const npc = npcOf(a.npcId);
    if (cmd.decision === "cancel") {
      if (a.status !== "queued") throw Error("Only an offer waiting for the DM can be cancelled.");
      a.status = "cancelled";
    } else {
      if (a.status !== "countered" || a.counterCopper === undefined) throw Error("There is no counter-offer to answer.");
      if (state.rules.cooldownMinutes > 0 && campaignMinute(t) > a.minute + state.rules.cooldownMinutes)
        throw Error("This counter-offer has lapsed. Make a fresh offer.");
      if (cmd.decision === "accept-counter") {
        if (!npcAvailableHere(npc, t)) throw Error(`${npc.name} isn't here right now.`);
        settle(a, cmd.id, a.counterCopper);
        a.lines.push(line(npc, "accept"));
      } else a.status = "declined";
    }
    a.revision++;
    a.decidedAt = at;
    return;
  }
  if (cmd.kind === "npc-barter-resolve") {
    dm();
    const a = attemptOf(cmd.attemptId, cmd.revision);
    const npc = npcOf(a.npcId);
    if (cmd.action === "confirm" || cmd.action === "overrule") {
      if (a.status !== "confirm") throw Error("This result isn't waiting for confirmation.");
      const success = a.roll ? a.roll.total >= a.quote.dc : a.quote.kind === "accept";
      if (cmd.action === "confirm") {
        if (a.roll) outcomeOfRoll(a, npc, cmd.id);
        else {
          settle(a, cmd.id);
          a.lines.push(line(npc, "accept"));
        }
      } else {
        if (!cmd.reason) throw Error("Give a reason for overruling the roll.");
        if (success) {
          a.status = "declined";
          a.lines.push(line(npc, "refuse"));
        } else {
          settle(a, cmd.id);
          a.lines.push(line(npc, "accept"));
        }
      }
    } else {
      if (a.status !== "queued") throw Error("This offer is no longer waiting for the DM.");
      if (cmd.values) a.values = cmd.values;
      if (cmd.action === "roll") {
        const q = quoteFor(a, { values: cmd.values, ignoreCaps: true });
        a.quote = { ...a.quote, received: q.received, given: q.given, ratio: q.ratio, dc: q.dc, bonus: q.bonus, advantage: q.advantage, chance: q.chance };
        if (q.kind === "accept") {
          settle(a, cmd.id);
          a.lines.push(line(npc, "accept"));
        } else if (q.kind === "refuse") {
          a.status = "refused";
          a.lines.push(line(npc, "tooLow"));
        } else {
          const r = rollD20s(execution, seat, q.advantage);
          a.roll = { ...r, total: r.kept + q.bonus };
          outcomeOfRoll(a, npc, cmd.id);
        }
      } else if (cmd.action === "accept") {
        settle(a, cmd.id);
        a.lines.push(line(npc, "accept"));
      } else if (cmd.action === "decline") {
        a.status = "declined";
        a.lines.push(line(npc, "refuse"));
      } else {
        if (!cmd.counterCopper) throw Error("Enter the extra coins for the counter-offer.");
        a.counterCopper = cmd.counterCopper;
        a.status = "countered";
        a.lines.push(line(npc, "counter", { coins: formatCopper(cmd.counterCopper) }));
      }
    }
    if (cmd.reason) a.dmReason = cmd.reason;
    if (cmd.showReason !== undefined) a.showReason = cmd.showReason;
    a.revision++;
    a.decidedAt = at;
    return;
  }
  if (cmd.kind === "npc-barter-clear-wait") {
    dm();
    const a = attemptOf(cmd.attemptId, cmd.revision);
    a.cleared = true;
    a.revision++;
  }
}

export function validateNpcBarter(t: Pick<CloudTable, "journal">) {
  const state = readNpcBarter(readWorld(t.journal?.world));
  const ids = state.attempts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw Error("Duplicate NPC barter attempt IDs.");
}

/** Player projection: only their own attempts, without valuation, memory keys or DM notes. */
export function projectNpcBarter(
  world: ReturnType<typeof readWorld>,
  seat: Pick<CloudSeat, "purseIds">,
): void {
  const configured = world.npcBarter !== undefined;
  const state = readNpcBarter(world);
  const rules = state.rules;
  for (const npc of world.npcs) {
    if (!npcAnswersBarter(npc)) {
      delete npc.barter;
      continue;
    }
    // Untouched campaigns keep the Fair defaults the client already knows.
    if (!configured && !npc.barter) continue;
    // Players hear the greeting and farewell; the stance, mode and wants stay with the DM.
    npc.barter = {
      lines: {
        greet: npcLineTemplate(npc, rules, "greet"),
        barter: npcLineTemplate(npc, rules, "barter"),
        bye: npcLineTemplate(npc, rules, "bye"),
      },
    };
  }
  if (!configured) return;
  world.npcBarter = {
    rules: npcBarterStateSchema.parse({}).rules,
    revision: 0,
    attempts: state.attempts
      .filter((a) => seat.purseIds.includes(a.purseId))
      .map((a) => {
        const { values: _values, dmReason, showReason, ...rest } = a;
        return {
          ...rest,
          account: "private",
          quote: { ...a.quote, received: 0, given: 0, ratio: 0 },
          ...(showReason && dmReason ? { dmReason, showReason } : {}),
        };
      }),
  };
}
