/**
 * Fairness ledger (future-development prompt 2, phase 3; mockups and decisions approved by the
 * owner on 2026-10-24). How much loot value each party character has received, per session and
 * campaign to date. Derived and read-only: it stores nothing and moves nothing.
 *
 * One pure module serves every reader: the Party → Fairness tab and breakdown (shared rooms and
 * the device), the treasure pool's "furthest behind" line, the Review Inbox favour preview and
 * the authoritative `loot-resolve` command (commands.ts in rooms, executeLocalCommand offline).
 * It reads only the table it is given. A player's client gives it the player's own projection,
 * so it can never show more than that seat already receives; the projection itself (see
 * `fairnessProjection`, used by session-records.ts) decides what an archived session adds.
 *
 * Owner decisions (2026-10-24):
 * - Counted: coin splits from a party fund or an encounter, encounter awards (one purse, split
 *   or item) and treasure-pool resolutions. Reversals subtract what they cancel.
 * - Not counted: purchases, sales, trades, Give, wages, loans, payments, downtime, DM
 *   adjustments, DM "Add loot" and a character splitting their own coins. An allowlist: a line
 *   this module does not recognise never counts.
 * - Older encounter items with no recorded value count as 0 cp, flagged and listed; never guessed.
 * - Average: the current party for campaign to date; that session's party for one session.
 * - Away and former characters are DM-only rows and are not compared. A player away from the
 *   party sees only their own totals. Party members see only counted receipts of others.
 */
import { characterVisible, inParty } from "./character-position.ts";
import { isNpc } from "./coin-split.ts";
import type { CloudTable } from "./cloud.ts";
import type { LedgerLine, Purse } from "./types.ts";

export type FairTable = Pick<CloudTable, "purses" | "ledger" | "journal">;
export type FairViewer = { dm: boolean; purseIds: string[] };
type Journal = NonNullable<CloudTable["journal"]>;
type Session = Journal["sessions"][number];

export type FairKind = "fund-split" | "encounter-split" | "encounter-coins" | "encounter-item" | "pool";
/** One counted receipt line for one character. Amounts are whole copper (negative for reversals). */
export type FairReceipt = {
  lineId: string;
  purseId: string;
  at: number;
  kind: FairKind;
  coins: number;
  items: number;
  /** Item units with no recorded value (older encounter awards), counted as 0 cp. */
  unvalued: number;
  label: string;
  detail: string;
  /** The split, award or resolution receipt this line belongs to (for Activity links). */
  receiptId?: string;
  /** This line cancels a counted line (its ID). */
  reversalOf?: string;
  /** A later reversal cancelled this line. */
  reversedBy?: string;
  period: string;
};
/** A line on a character's ledger that is not loot (shown to the DM and the character's own player). */
export type FairOther = { lineId: string; purseId: string; at: number; summary: string; copper: number; reason: string; period: string };
export type FairPeriod = {
  key: string;
  label: string;
  /** Session number in campaign order (null for "Between sessions" and unmatched archives). */
  number: number | null;
  live: boolean;
  inProgress: boolean;
  at: number;
  /** This viewer cannot read the session (not seated then, or an unreadable archive). */
  unavailable?: "not-seated" | "unreadable";
};
export type FairRow = {
  purseId: string;
  name: string;
  coins: number;
  items: number;
  total: number;
  unvalued: number;
  /** Gap against the average as an exact fraction num/den (null when not compared). */
  gap: { num: number; den: number } | null;
  /** First session in which the character was in the party, when after the first readable one. */
  joined: number | null;
  status: "party" | "away" | "former";
  mine: boolean;
};
export type FairnessView = {
  periods: FairPeriod[];
  period: string;
  rows: FairRow[];
  /** DM-only (and the viewer's own) characters not compared: away from the party or deleted. */
  others: FairRow[];
  compared: boolean;
  sum: number;
  coins: number;
  items: number;
  /** Compared characters (the average's divisor). */
  n: number;
  unvalued: Array<{ purseId: string; units: number }>;
  /** Sessions this viewer cannot read (unreadable archives are never dropped silently). */
  unreadable: number;
  /** The first readable session when it is later than Session 1 (a late-joining player). */
  fromSession: number | null;
  sessionCount: number;
};

const ENCOUNTER_ITEM = /^Encounter loot: (\d+) × (.+) \((.*)\)$/;
const SPLIT_FROM = /^Split (?:share|leftover) from (.+?)(?: \([^()]*rule\))?$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** A party player character: never NPCs, non-party accounts, exchange treasuries or party funds. */
export function fairnessEligible(t: Pick<FairTable, "purses" | "journal">, p: Purse): boolean {
  if (p.kind !== "character" || p.nonParty || isNpc(t, p)) return false;
  if ((t.journal?.tradeEconomy?.exchanges ?? []).some((e) => e.purseId === p.id)) return false;
  return characterVisible(t, p);
}

/** Exact gap rounded half away from zero, for display only. */
export function roundGap(gap: { num: number; den: number }): number {
  const sign = gap.num < 0 ? -1 : 1;
  const abs = Math.abs(gap.num);
  return sign * Math.floor((2 * abs + gap.den) / (2 * gap.den)) || 0;
}

type SplitSource = "fund" | "other";
/** What one table (a live table or one archived snapshot) contributes. Cached per snapshot. */
type Digest = {
  counted: Array<Omit<FairReceipt, "period" | "reversedBy">>;
  voids: Array<{ line: LedgerLine }>;
  others: Array<Omit<FairOther, "period">>;
  /** Eligible characters in the party in this table. */
  party: Array<{ id: string; name: string }>;
  /** Eligible characters in this table, wherever they were. */
  eligible: string[];
  names: Record<string, string>;
  lines: Map<string, LedgerLine>;
};

function partyFundIds(t: Pick<FairTable, "purses" | "journal">): Set<string> {
  const exchange = new Set((t.journal?.tradeEconomy?.exchanges ?? []).map((e) => e.purseId));
  return new Set(t.purses.filter((p) => p.kind === "party" && !p.nonParty && !exchange.has(p.id)).map((p) => p.id));
}

/** Where each split came from: a party fund or anything else (a character's own coins, an NPC). */
function splitSources(t: FairTable, extra?: Record<string, SplitSource>): Map<string, SplitSource> {
  const funds = partyFundIds(t);
  const out = new Map<string, SplitSource>(Object.entries(extra ?? {}));
  for (const line of t.ledger)
    if (line.split?.role === "source") out.set(line.split.id, funds.has(line.purseId) ? "fund" : "other");
  for (const event of t.journal?.events ?? [])
    if (event.split && !out.has(event.split.id) && t.purses.some((p) => p.id === event.split!.sourceId))
      out.set(event.split.id, funds.has(event.split.sourceId) ? "fund" : "other");
  return out;
}

function classify(
  line: LedgerLine,
  sourceOf: (line: LedgerLine) => SplitSource | undefined,
): Omit<FairReceipt, "period" | "reversedBy" | "lineId" | "purseId" | "at"> | null {
  if (line.transactionType === "void") return null;
  if (line.award) {
    const tag = line.award;
    const name = line.summary.replace(/^Encounter loot: /, "");
    if (tag.role === "coins")
      return line.copper > 0
        ? { kind: "encounter-coins", coins: line.copper, items: 0, unvalued: 0, label: `Encounter award · ${name}`, detail: "All coins to one purse", receiptId: tag.receiptId }
        : null;
    const quantity = tag.quantity ?? 1;
    return {
      kind: "encounter-item",
      coins: 0,
      items: quantity * (tag.unitCopper ?? 0),
      unvalued: tag.unitCopper === undefined ? quantity : 0,
      label: `Encounter award · ${name}`,
      detail: tag.unitCopper === undefined ? "No value was recorded" : "Item at its value when awarded",
      receiptId: tag.receiptId,
    };
  }
  if (line.loot) {
    if (line.loot.role !== "award") return null;
    const item = line.summary.replace(/^Treasure pool: /, "").replace(/ \([^()]*\)$/, "");
    return {
      kind: "pool",
      coins: 0,
      items: line.loot.quantity * line.loot.unitCopper,
      unvalued: 0,
      label: `Treasure pool · ${item}`,
      detail: `${line.loot.choice === "dm" ? "DM's choice" : line.loot.choice ? line.loot.choice[0]!.toUpperCase() + line.loot.choice.slice(1) : "Awarded"} · value when claimed`,
      receiptId: line.loot.id,
    };
  }
  if (line.split) {
    if (line.split.role === "source" || line.copper <= 0) return null;
    if (line.transactionType === "adjustment") {
      const name = line.summary.replace(/^Encounter loot (?:share|leftover): /, "").replace(/ \([^()]*rule\)$/, "");
      return {
        kind: "encounter-split",
        coins: line.copper,
        items: 0,
        unvalued: 0,
        label: `Encounter award · ${name}`,
        detail: line.split.role === "remainder" ? "Leftover copper from an even split" : "Split evenly",
        receiptId: line.split.id,
      };
    }
    if (sourceOf(line) !== "fund") return null;
    const from = SPLIT_FROM.exec(line.summary)?.[1] ?? "a party fund";
    return {
      kind: "fund-split",
      coins: line.copper,
      items: 0,
      unvalued: 0,
      label: `Coin split from ${from}`,
      detail: line.split.role === "remainder" ? "Leftover copper" : "Even share",
      receiptId: line.split.id,
    };
  }
  // Older encounter awards (before the award tag): recognised by the summary both paths wrote.
  if ((!line.transactionType || line.transactionType === "adjustment") && line.summary.startsWith("Encounter loot: ")) {
    const item = ENCOUNTER_ITEM.exec(line.summary);
    if (line.copper === 0 && item)
      return {
        kind: "encounter-item",
        coins: 0,
        items: 0,
        unvalued: Number(item[1]) || 1,
        label: `Encounter award · ${item[1]} × ${item[2]} (${item[3]})`,
        detail: "Older award: no value was recorded (counts as 0 cp)",
      };
    if (line.copper > 0)
      return {
        kind: "encounter-coins",
        coins: line.copper,
        items: 0,
        unvalued: 0,
        label: `Encounter award · ${line.summary.replace(/^Encounter loot: /, "")}`,
        detail: "All coins to one purse",
      };
  }
  return null;
}

function notCountedReason(line: LedgerLine): string {
  if (line.transactionType === "purchase" || line.purchase || line.listingPurchase) return "Purchases are not counted";
  if (line.transactionType === "sale") return "Sales are not counted";
  if (line.trade) return "Trades are not counted";
  if (line.transactionType === "loan") return "Loans are not counted";
  if (line.transactionType === "payment") return "Payments are not counted";
  if (line.split) return "A split of a character's own coins is not counted (it was counted when first received)";
  if (/wage|downtime/i.test(line.summary)) return "Wages and downtime are not counted";
  if (line.transactionType === "transfer" || /^(Gave |Transfer )/.test(line.summary)) return "Give between characters is not loot";
  if (line.transactionType === "void") return "Reversal of a line that does not count";
  return "Not loot (DM adjustment or other record)";
}

/**
 * Digest one table. `extension` is an archived session's fairness extension from the player
 * projection (party members get other party characters' counted lines and split sources).
 */
function digest(t: FairTable, extension?: FairnessExtension): Digest {
  const lines = new Map<string, LedgerLine>();
  for (const line of t.ledger) lines.set(line.id, line);
  for (const line of extension?.lines ?? []) if (!lines.has(line.id)) lines.set(line.id, line);
  const all = { ...t, ledger: [...lines.values()] };
  const sources = splitSources(all, extension?.sources);
  const byName = new Map<string, SplitSource>();
  const funds = partyFundIds(t);
  for (const p of t.purses) if (!byName.has(p.name)) byName.set(p.name, funds.has(p.id) ? "fund" : "other");
  const sourceOf = (line: LedgerLine): SplitSource | undefined => {
    const known = sources.get(line.split!.id);
    if (known) return known;
    const name = SPLIT_FROM.exec(line.summary)?.[1];
    // A source this viewer cannot name is not a character it can list: it can only be a party
    // fund outside the projection (a player away from the party keeps their own shares).
    return name ? (byName.get(name) ?? "fund") : undefined;
  };
  const names: Record<string, string> = {};
  for (const p of t.purses) names[p.id] = p.name;
  for (const p of extension?.party ?? []) names[p.id] ??= p.name;
  const characters = new Set(t.purses.filter((p) => p.kind === "character").map((p) => p.id));
  for (const p of extension?.party ?? []) characters.add(p.id);
  const counted: Digest["counted"] = [];
  const voids: Digest["voids"] = [];
  const others: Digest["others"] = [];
  for (const line of lines.values()) {
    if (line.transactionType === "void" && line.reversalOf) {
      voids.push({ line });
      continue;
    }
    const c = classify(line, sourceOf);
    if (c) counted.push({ ...c, lineId: line.id, purseId: line.purseId, at: line.at });
    else if (characters.has(line.purseId) && (line.copper !== 0 || !line.loot))
      others.push({ lineId: line.id, purseId: line.purseId, at: line.at, summary: line.summary, copper: line.copper, reason: notCountedReason(line) });
  }
  const party = extension
    ? [
        ...extension.party,
        ...t.purses
          .filter((p) => fairnessEligible(t, p) && inParty(t, p) && !extension.party.some((x) => x.id === p.id))
          .map((p) => ({ id: p.id, name: p.name })),
      ]
    : t.purses.filter((p) => fairnessEligible(t, p) && inParty(t, p)).map((p) => ({ id: p.id, name: p.name }));
  const eligible = [...new Set([...party.map((p) => p.id), ...t.purses.filter((p) => fairnessEligible(t, p)).map((p) => p.id)])];
  return { counted, voids, others, party, eligible, names, lines };
}

/** Archived snapshots are immutable: digest each one once per page load or server isolate. */
const CACHE_LIMIT = 400;
const snapshotCache = new Map<string, Digest | null>();
function cached(snapshot: string, build: () => Digest | null): Digest | null {
  const hit = snapshotCache.get(snapshot);
  if (hit !== undefined) {
    snapshotCache.delete(snapshot);
    snapshotCache.set(snapshot, hit);
    return hit;
  }
  const value = build();
  snapshotCache.set(snapshot, value);
  if (snapshotCache.size > CACHE_LIMIT) snapshotCache.delete(snapshotCache.keys().next().value!);
  return value;
}
/** Test hook: the number of digested snapshots held in memory. */
export function fairnessCacheSize(): number {
  return snapshotCache.size;
}

/** The fairness part of a player's projected archived session (session-records.ts). */
export type FairnessExtension = {
  v: 1;
  /** That session's party characters this viewer may compare (empty for a player away now). */
  party: Array<{ id: string; name: string }>;
  /** Counted lines (and their reversals) of those characters. */
  lines: LedgerLine[];
  /** Where the visible splits came from: a party fund or not. */
  sources: Record<string, SplitSource>;
};

function readSnapshot(snapshot: string): { table: FairTable; extension?: FairnessExtension } | null {
  try {
    const raw: unknown = JSON.parse(snapshot);
    if (!isRecord(raw) || !Array.isArray(raw.purses) || !Array.isArray(raw.ledger)) return null;
    const ext = raw.fairness;
    return {
      table: { purses: raw.purses as Purse[], ledger: raw.ledger as LedgerLine[], journal: (isRecord(raw.journal) ? raw.journal : { sessions: [], requests: [], events: [] }) as Journal },
      ...(isRecord(ext) && ext.v === 1 && Array.isArray(ext.party) && Array.isArray(ext.lines)
        ? { extension: { v: 1, party: ext.party as FairnessExtension["party"], lines: ext.lines as LedgerLine[], sources: (isRecord(ext.sources) ? ext.sources : {}) as FairnessExtension["sources"] } }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Is this archived snapshot line inside its session (the same rule as journal.ts selectSessionLedgerRows)? */
function inSession(session: Session | undefined, line: { id: string; at: number }): boolean {
  if (!session) return false;
  const start = session.startLedgerIds;
  const end = session.endLedgerIds;
  return (start ? !start.includes(line.id) : line.at >= session.startedAt) && (end ? end.includes(line.id) : !session.endedAt || line.at < session.endedAt);
}

type Index = {
  periods: FairPeriod[];
  receipts: FairReceipt[];
  others: FairOther[];
  /** Period key → that period's party. */
  party: Map<string, Array<{ id: string; name: string }>>;
  names: Map<string, string>;
  /** Characters that were party player characters in any readable table (for "Former character"). */
  everEligible: Set<string>;
};

/** Collect every readable receipt in campaign order. Cheap after the first call per snapshot. */
function buildIndex(t: FairTable): Index {
  const journal = t.journal;
  const sessions = [...(journal?.sessions ?? [])].sort((a, b) => a.startedAt - b.startedAt);
  const number = new Map(sessions.map((s, i) => [s.id, i + 1]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const reports = [...(journal?.reports ?? [])].sort((a, b) => a.at - b.at);
  const periods = new Map<string, FairPeriod>();
  for (const s of sessions)
    periods.set(s.id, {
      key: s.id,
      label: `Session ${number.get(s.id)} · ${s.name}`,
      number: number.get(s.id)!,
      live: !s.endedAt,
      inProgress: !s.endedAt,
      at: s.startedAt,
      ...(s.endedAt && !reports.some((r) => r.id === s.id) ? { unavailable: "not-seated" as const } : {}),
    });
  const receipts: FairReceipt[] = [];
  const others: FairOther[] = [];
  const party = new Map<string, Array<{ id: string; name: string }>>();
  const names = new Map<string, string>();
  const seen = new Set<string>();
  const everEligible = new Set<string>();
  const add = (d: Digest, periodOf: (line: { id: string; at: number }) => string) => {
    for (const [id, name] of Object.entries(d.names)) if (!names.has(id)) names.set(id, name);
    for (const id of d.eligible) everEligible.add(id);
    for (const r of d.counted) {
      if (seen.has(r.lineId)) continue;
      seen.add(r.lineId);
      receipts.push({ ...r, period: periodOf({ id: r.lineId, at: r.at }) });
    }
    for (const o of d.others) {
      if (seen.has(o.lineId)) continue;
      seen.add(o.lineId);
      others.push({ ...o, period: periodOf({ id: o.lineId, at: o.at }) });
    }
    return d;
  };
  const voids: Array<{ line: LedgerLine; period: string }> = [];
  for (const report of reports) {
    const session = sessionById.get(report.id);
    const key = session ? session.id : `report:${report.id}`;
    const d = report.error !== undefined
      ? null
      : cached(report.snapshot, () => {
          const read = readSnapshot(report.snapshot);
          return read ? digest(read.table, read.extension) : null;
        });
    if (!d) {
      periods.set(key, {
        key,
        label: session ? `Session ${number.get(session.id)} · ${session.name}` : report.name,
        number: session ? number.get(session.id)! : null,
        live: false,
        inProgress: false,
        at: report.at,
        unavailable: "unreadable",
      });
      continue;
    }
    if (session) {
      const p = periods.get(key)!;
      delete p.unavailable;
      party.set(key, d.party);
    }
    const periodOf = (line: { id: string; at: number }) => (session && inSession(session, line) ? session.id : "between");
    add(d, periodOf);
    for (const v of d.voids) voids.push({ line: v.line, period: periodOf(v.line) });
  }
  const active = sessions.find((s) => !s.endedAt);
  const live = digest(t);
  if (active) party.set(active.id, live.party);
  const livePeriod = (line: { id: string; at: number }) => (active && inSession(active, line) ? active.id : "between");
  add(live, livePeriod);
  for (const v of live.voids) voids.push({ line: v.line, period: livePeriod(v.line) });
  // Reversals of counted lines subtract what they cancel, in the period they were recorded.
  const byLine = new Map(receipts.map((r) => [r.lineId, r]));
  for (const { line, period } of voids) {
    if (seen.has(line.id)) continue;
    const original = byLine.get(line.reversalOf!);
    seen.add(line.id);
    if (!original) {
      others.push({ lineId: line.id, purseId: line.purseId, at: line.at, summary: line.summary, copper: line.copper, reason: notCountedReason(line), period });
      continue;
    }
    original.reversedBy = line.id;
    receipts.push({
      ...original,
      lineId: line.id,
      at: line.at,
      coins: -original.coins,
      items: -original.items,
      unvalued: -original.unvalued,
      label: `Reversal · ${original.label}`,
      detail: line.summary,
      reversalOf: original.lineId,
      reversedBy: undefined,
      period,
    });
  }
  if (receipts.some((r) => r.period === "between") || others.some((o) => o.period === "between"))
    periods.set("between", { key: "between", label: "Between sessions", number: null, live: false, inProgress: false, at: 0 });
  for (const report of reports)
    if (!sessionById.has(report.id) && periods.get(`report:${report.id}`)?.unavailable !== "unreadable")
      periods.delete(`report:${report.id}`);
  return {
    periods: [...periods.values()].sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.at - b.at),
    receipts: receipts.sort((a, b) => a.at - b.at || (a.lineId < b.lineId ? -1 : 1)),
    others: others.sort((a, b) => a.at - b.at),
    party,
    names,
    everEligible,
  };
}

/** Memoised per table object (the UI passes the same arrays until something changes). */
const indexCache = new WeakMap<object, { ledger: unknown; journal: unknown; purses: unknown; index: Index }>();
function indexOf(t: FairTable): Index {
  const hit = indexCache.get(t.ledger);
  if (hit && hit.journal === t.journal && hit.purses === t.purses) return hit.index;
  const index = buildIndex(t);
  indexCache.set(t.ledger, { ledger: t.ledger, journal: t.journal, purses: t.purses, index });
  return index;
}

function sumRow(receipts: FairReceipt[], purseId: string) {
  let coins = 0,
    items = 0,
    unvalued = 0;
  for (const r of receipts)
    if (r.purseId === purseId) {
      coins += r.coins;
      items += r.items;
      unvalued += r.unvalued;
    }
  return { coins, items, total: coins + items, unvalued };
}

/**
 * The Fairness table for one period ("campaign", a session ID or "between") as `viewer` may see
 * it. Rows are sorted lowest total first; gaps are exact fractions (round with `roundGap`).
 */
export function fairnessLedger(t: FairTable, viewer: FairViewer, period = "campaign"): FairnessView {
  const index = indexOf(t);
  const periodKeys = new Set(index.periods.map((p) => p.key));
  const key = period === "campaign" || periodKeys.has(period) ? period : "campaign";
  const receipts = key === "campaign" ? index.receipts : index.receipts.filter((r) => r.period === key);
  const current = new Map(t.purses.map((p) => [p.id, p]));
  const eligibleNow = t.purses.filter((p) => fairnessEligible(t, p));
  const partyNow = new Set(eligibleNow.filter((p) => inParty(t, p)).map((p) => p.id));
  const mine = (id: string) => viewer.purseIds.includes(id);
  const viewerInParty = viewer.dm || viewer.purseIds.some((id) => partyNow.has(id));
  const sessionParty = key === "campaign" || key === "between" ? null : index.party.get(key);
  const comparedIds = viewerInParty
    ? sessionParty
      ? sessionParty.map((p) => p.id).filter((id) => viewer.dm || current.has(id))
      : [...partyNow]
    : [];
  const received = new Set(receipts.map((r) => r.purseId));
  const otherIds = new Set<string>();
  if (viewer.dm) {
    for (const p of eligibleNow) if (!comparedIds.includes(p.id)) otherIds.add(p.id);
    // Former characters: receipts for a party character no longer in the campaign.
    for (const id of received) if (!current.has(id) && !comparedIds.includes(id) && index.everEligible.has(id)) otherIds.add(id);
  }
  // A player's own characters that are not compared (away from the party).
  for (const id of viewer.purseIds) {
    const p = current.get(id);
    if (p && !comparedIds.includes(id) && fairnessEligible(t, p)) otherIds.add(id);
  }
  const numbered = index.periods.filter((p) => p.number !== null && !p.unavailable);
  const firstReadable = numbered[0]?.number ?? null;
  const joinedOf = (id: string): number | null => {
    if (key !== "campaign") return null;
    const first = numbered.find((p) => (index.party.get(p.key) ?? []).some((x) => x.id === id));
    return first && firstReadable !== null && first.number! > firstReadable ? first.number : null;
  };
  const make = (id: string, status: FairRow["status"]): FairRow => ({
    purseId: id,
    name: current.get(id)?.name ?? index.names.get(id) ?? sessionParty?.find((p) => p.id === id)?.name ?? "Former character",
    ...sumRow(receipts, id),
    gap: null,
    joined: status === "party" ? joinedOf(id) : null,
    status,
    mine: mine(id),
  });
  const rows = comparedIds.map((id) => make(id, "party"));
  const n = rows.length;
  const sum = rows.reduce((s, r) => s + r.total, 0);
  if (n) for (const r of rows) r.gap = { num: r.total * n - sum, den: n };
  rows.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  const others = [...otherIds].map((id) => make(id, current.has(id) ? "away" : "former")).sort((a, b) => a.name.localeCompare(b.name));
  // The summary adds up the compared characters (or, for a player away, their own).
  const shown = n ? rows : others.filter((r) => r.mine);
  const unreadable = index.periods.filter((p) => p.unavailable === "unreadable").length;
  return {
    periods: index.periods,
    period: key,
    rows,
    others,
    compared: n > 0,
    sum: shown.reduce((s, r) => s + r.total, 0),
    coins: shown.reduce((s, r) => s + r.coins, 0),
    items: shown.reduce((s, r) => s + r.items, 0),
    n,
    unvalued: shown.filter((r) => r.unvalued > 0).map((r) => ({ purseId: r.purseId, units: r.unvalued })),
    unreadable,
    fromSession: firstReadable !== null && firstReadable > 1 && !viewer.dm ? firstReadable : null,
    sessionCount: index.periods.filter((p) => p.number !== null).length,
  };
}

/**
 * One character's receipts for a period, newest session first. Party members viewing another
 * character get only the counted receipts; the DM and the character's own player also get the
 * lines that are on the ledger but do not count (owner decision, 2026-10-24).
 */
export function fairnessReceipts(
  t: FairTable,
  viewer: FairViewer,
  purseId: string,
  period = "campaign",
): { groups: Array<{ period: FairPeriod; receipts: FairReceipt[] }>; others: FairOther[] | null } {
  const view = fairnessLedger(t, viewer, period);
  if (![...view.rows, ...view.others].some((r) => r.purseId === purseId)) return { groups: [], others: null };
  const index = indexOf(t);
  const inPeriod = (p: string) => view.period === "campaign" || p === view.period;
  const receipts = index.receipts.filter((r) => r.purseId === purseId && inPeriod(r.period));
  const order = [...view.periods].reverse();
  const groups = order
    .map((p) => ({ period: p, receipts: receipts.filter((r) => r.period === p.key).reverse() }))
    .filter((g) => g.receipts.length);
  const others = viewer.dm || viewer.purseIds.includes(purseId) ? index.others.filter((o) => o.purseId === purseId && inPeriod(o.period)).reverse() : null;
  return { groups, others };
}

/**
 * Totals used by "Favour whoever is behind": campaign to date, or the session in progress.
 * Computed from the table the command runs against (never from the client). DM view: every
 * character's received total, whether or not it is compared.
 */
export function fairnessStandings(t: FairTable, basis: "campaign" | "session"): Map<string, number> {
  let period = "campaign";
  if (basis === "session") {
    const active = (t.journal?.sessions ?? []).find((s) => !s.endedAt);
    if (!active) throw Error("No session is running. Favour whoever is behind using campaign-to-date totals instead.");
    period = active.id;
  }
  const index = indexOf(t);
  const out = new Map<string, number>();
  for (const r of index.receipts) if (period === "campaign" || r.period === period) out.set(r.purseId, (out.get(r.purseId) ?? 0) + r.coins + r.items);
  return out;
}

/** "Ambrose is furthest behind", for the treasure pool card (party members and the DM). */
export function furthestBehind(t: FairTable, viewer: FairViewer): FairRow | null {
  const view = fairnessLedger(t, viewer, "campaign");
  if (view.n < 2) return null;
  const row = view.rows[0]!;
  return row.gap && row.gap.num < 0 ? row : null;
}

/**
 * The fairness extension of one archived session in a player's projection (session-records.ts).
 * The projected snapshot keeps only the seat's own ledger lines; a seat with a character in the
 * party now also receives the counted lines (never other lines) of that session's party
 * characters who are still visible player characters, so it can compare totals as the owner
 * decided. A seat away from the party receives only the split sources of its own lines.
 */
export function fairnessProjection(
  snapshot: string,
  raw: FairTable,
  outer: Pick<FairTable, "purses" | "journal">,
  seat: { purseIds: string[] },
  viewerInParty: boolean,
  ownLines: LedgerLine[],
): FairnessExtension {
  const d = cached(snapshot, () => digest(raw));
  const sources = splitSources(raw);
  const visible = new Set(outer.purses.filter((p) => fairnessEligible(outer, p)).map((p) => p.id));
  const party = viewerInParty && d ? d.party.filter((p) => visible.has(p.id)) : [];
  const ids = new Set(party.map((p) => p.id));
  const counted = new Set((d?.counted ?? []).filter((r) => ids.has(r.purseId) && !seat.purseIds.includes(r.purseId)).map((r) => r.lineId));
  const lines: LedgerLine[] = [];
  for (const id of counted) lines.push(d!.lines.get(id)!);
  for (const v of d?.voids ?? []) if (counted.has(v.line.reversalOf!)) lines.push(v.line);
  const splits = new Set([...ownLines, ...lines].flatMap((l) => (l.split ? [l.split.id] : [])));
  return {
    v: 1,
    party: party.map((p) => ({ id: p.id, name: outer.purses.find((x) => x.id === p.id)?.name ?? p.name })),
    lines,
    sources: Object.fromEntries([...sources].filter(([id]) => splits.has(id))),
  };
}
