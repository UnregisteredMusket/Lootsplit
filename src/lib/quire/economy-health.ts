/**
 * Economy health (owner-approved 2026-11-05, from the comparable-tools research): a DM-only,
 * read-only view of where the party's money comes from and where it goes, computed on read from
 * the ledger the campaign already keeps. It stores nothing, adds no command and moves nothing.
 *
 * - The party is the player characters and the party funds. NPCs, location accounts (nonParty)
 *   and exchange treasuries are outside it, so money moving to or from them is a faucet or sink.
 * - Faucets (money entering the party's hands) and sinks (money leaving it) are classified from
 *   the existing line kinds and markers: transaction type, split / award / trade / loot tags,
 *   finance rule and loan IDs, quest reward links, and the summaries the commands write.
 * - Transfers inside the party (Give, splits from a party fund, party-fund loans, barter between
 *   party members) are neither: they are shown separately and excluded from the totals.
 * - A line this module does not recognise is "Unclassified" with its count, never dropped.
 *   Item-only lines (0 cp) are not money and are not counted.
 * - Conservation: for every period, faucets − sinks + transfers' net + unclassified's net equals
 *   the change in the party's coins recorded on its ledger lines.
 * - Archived sessions a shared room has not loaded (history on demand) are counted, never
 *   fetched here: the view says how many and the DM can load them.
 */
import { characterSheet } from "../characters/campaign-sheet.mjs";
import type { CloudTable } from "./cloud.ts";
import { knownUnitCopper } from "./item-identity.ts";
import { toCopper } from "./money.ts";
import type { LedgerLine, Purse } from "./types.ts";

export type HealthTable = Pick<CloudTable, "purses" | "ledger" | "journal" | "holdings"> & { sheets?: CloudTable["sheets"] };
type Journal = NonNullable<CloudTable["journal"]>;
type Session = Journal["sessions"][number];

export const FAUCETS = {
  encounter: "Encounter loot",
  sales: "Sales and trade",
  income: "Property, ship and other income",
  quests: "Quest rewards",
  loans: "Loans received",
  grants: "DM grants",
  "from-others": "From people outside the party",
} as const;
export const SINKS = {
  purchases: "Purchases",
  upkeep: "Upkeep, wages and rent",
  services: "Services and fees",
  travel: "Travel and provisions",
  repayments: "Loan repayments",
  deductions: "DM deductions and recorded payments",
  "to-others": "To people outside the party",
} as const;
export type FaucetCategory = keyof typeof FAUCETS;
export type SinkCategory = keyof typeof SINKS;
export type FlowCategory = FaucetCategory | SinkCategory;
export type Bucket = FlowCategory | "transfer" | "unclassified";
export const isFaucet = (c: Bucket): c is FaucetCategory => c in FAUCETS;
export const isSink = (c: Bucket): c is SinkCategory => c in SINKS;

/** One classified movement of the party's coins. `copper` is the signed change of party coins. */
export type FlowEntry = {
  bucket: Bucket;
  copper: number;
  lineIds: string[];
  at: number;
  summary: string;
  /** Unclassified: why the line could not be classified. */
  reason?: string;
  /** Transfers: copper that moved between party purses (counted once). */
  moved?: number;
  period: string;
};

export type NetWorth = {
  coins: number;
  /** Items held by party purses; unidentified items at their presented value (as players see it). */
  items: number;
  total: number;
  /** Unidentified item units with no presented value (counted as 0 cp). */
  unvalued: number;
  /** Properties and ships held by party purses: listed, not part of net worth. */
  property: number;
};

export type PeriodFlows = {
  key: string;
  label: string;
  kind: "session" | "between" | "week";
  /** Session number in campaign order (sessions only). */
  number: number | null;
  inProgress: boolean;
  /** Archived session not loaded on this device (history on demand), or unreadable. */
  unavailable?: "not-loaded" | "unreadable";
  faucets: Record<FaucetCategory, number>;
  sinks: Record<SinkCategory, number>;
  faucetTotal: number;
  sinkTotal: number;
  /** faucetTotal − sinkTotal. */
  net: number;
  transfers: { count: number; moved: number; net: number };
  unclassified: { count: number; net: number };
  /** Σ copper of every party line in the period (the change of party coins on the ledger). */
  coinChange: number;
  /** Party net worth at the end of the period (archived sessions and now), when known. */
  worth: NetWorth | null;
};

export type WealthGuide = {
  /** Player characters compared (party characters with a sheet level). */
  characters: Array<{ purseId: string; name: string; level: number; guideCopper: number }>;
  guideCopper: number;
  worthCopper: number;
};

export type EconomyHealth = {
  sessions: PeriodFlows[];
  weeks: PeriodFlows[];
  campaign: PeriodFlows;
  entries: FlowEntry[];
  unclassified: FlowEntry[];
  /** Archived sessions listed without their contents (shared rooms load them on request). */
  notLoaded: number;
  unreadable: number;
  trend: Array<{ key: string; label: string; worth: NetWorth }>;
  now: NetWorth;
  wealth: WealthGuide;
  /** The in-game day now (campaign clock). */
  day: number;
};

const emptyFaucets = (): Record<FaucetCategory, number> =>
  Object.fromEntries(Object.keys(FAUCETS).map((k) => [k, 0])) as Record<FaucetCategory, number>;
const emptySinks = (): Record<SinkCategory, number> =>
  Object.fromEntries(Object.keys(SINKS).map((k) => [k, 0])) as Record<SinkCategory, number>;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** Exchange treasuries are accounts of the world, never the party's. */
function treasuryIds(t: Pick<HealthTable, "journal">): Set<string> {
  return new Set((t.journal?.tradeEconomy?.exchanges ?? []).map((e) => e.purseId));
}
function npc(t: Pick<HealthTable, "journal">, p: Purse): boolean {
  return p.kind === "character" && (p.control === "npc" || !!t.journal?.world?.npcs?.some((n) => n.id === p.id));
}
/** The party's purses: player characters (wherever they are) and party funds. */
export function partyPurses(t: Pick<HealthTable, "purses" | "journal">): Set<string> {
  const exchange = treasuryIds(t);
  return new Set(t.purses.filter((p) => !p.nonParty && !exchange.has(p.id) && (p.kind === "party" || !npc(t, p))).map((p) => p.id));
}

/** Party net worth of one table: coins plus items (unidentified at their presented value). */
export function netWorth(t: Pick<HealthTable, "purses" | "journal" | "holdings">): NetWorth {
  const party = partyPurses(t);
  let coins = 0,
    items = 0,
    unvalued = 0,
    property = 0;
  for (const p of t.purses) if (party.has(p.id)) coins += toCopper(p.coins);
  for (const h of t.holdings ?? []) {
    if (!party.has(h.purseId)) continue;
    if (h.kind === "property") {
      property += h.quantity * h.unitCopper;
      continue;
    }
    const unit = knownUnitCopper(h);
    if (unit === null) unvalued += h.quantity;
    else items += h.quantity * unit;
  }
  return { coins, items, total: coins + items, unvalued, property };
}

/** What the classifier knows about the campaign beyond one line. */
type Context = {
  ruleIds: Map<string, "income" | "expense">;
  ruleNames: Map<string, "income" | "expense">;
  loanIds: Set<string>;
  questLines: Set<string>;
  questReceipts: Set<string>;
};

function context(tables: Array<Pick<HealthTable, "journal">>, current: Pick<HealthTable, "journal">): Context {
  const ctx: Context = { ruleIds: new Map(), ruleNames: new Map(), loanIds: new Set(), questLines: new Set(), questReceipts: new Set() };
  for (const t of [current, ...tables]) {
    for (const r of t.journal?.finance?.rules ?? []) {
      if (!ctx.ruleIds.has(r.id)) ctx.ruleIds.set(r.id, r.kind);
      if (!ctx.ruleNames.has(r.name)) ctx.ruleNames.set(r.name, r.kind);
    }
    for (const l of t.journal?.finance?.loans ?? []) ctx.loanIds.add(l.id);
  }
  for (const q of current.journal?.quests?.quests ?? [])
    for (const link of q.rewardLinks ?? []) {
      if (link.kind === "ledger") ctx.questLines.add(link.id);
      else if (link.kind === "encounter-award") ctx.questReceipts.add(link.id);
    }
  return ctx;
}

const endsWithId = (lineId: string, ids: Iterable<string>) => {
  for (const id of ids) if (lineId.endsWith(`-${id}`)) return id;
  return null;
};

/** Lines that move coins between two accounts: grouped and judged together. */
function transferKey(line: LedgerLine): string | null {
  if (line.trade) return null;
  if (line.split && line.transactionType !== "adjustment") return `split:${line.split.id}`;
  const legacy = !line.transactionType && /^(Transfer (sent|received)$|Gave )/.test(line.summary);
  if (line.transactionType !== "transfer" && !legacy) return null;
  let id = line.id;
  if (id.endsWith(`-${line.purseId}`)) id = id.slice(0, -line.purseId.length - 1);
  return `t:${id.replace(/-(received|lender|borrower)$/, "")}`;
}

type Judged = { bucket: Bucket; reason?: string };

/** Finance and property payments: recognised by the rule, loan or operation that wrote them. */
function payment(line: LedgerLine, ctx: Context): Judged {
  const finance = line.summary.startsWith("Finance: ");
  const text = finance ? line.summary.slice("Finance: ".length) : line.summary;
  if (finance) {
    const rule = endsWithId(line.id, ctx.ruleIds.keys());
    if (rule) return { bucket: ctx.ruleIds.get(rule) === "income" ? "income" : "upkeep" };
    if (endsWithId(line.id, ctx.loanIds) || /: (manual repayment|repayment)$/.test(text)) return { bucket: "repayments" };
    if (/: loan received$/.test(text)) return { bucket: "loans" };
    if (line.id.includes(":journey") || /: coach fare$/.test(text)) return { bucket: "travel" };
  }
  if (/^Property materials: /.test(text)) return { bucket: "purchases" };
  if (/^(Property work: |Property arrears: )|: maintenance, storage and provisions|^Ship maintenance arrears$/.test(text)) return { bucket: "upkeep" };
  if (/^(Postage: |Rumour · |Lesson · |Commission )/.test(text)) return { bucket: "services" };
  if (finance && /-(payment|fee)$/.test(line.id)) return { bucket: "services" };
  if (line.summary.startsWith("Payment approved: ")) return { bucket: "services" };
  if (finance) {
    // A finance rule renamed or removed since: "<receipt>: <rule name>".
    for (const [name, kind] of ctx.ruleNames) if (text.endsWith(`: ${name}`)) return { bucket: kind === "income" ? "income" : "upkeep" };
    return { bucket: "unclassified", reason: "A finance entry whose agreement is no longer recorded" };
  }
  // The DM's own posting (Party → Record a payment): a grant or a recorded payment by its sign.
  return { bucket: line.copper > 0 ? "grants" : "deductions" };
}

function single(line: LedgerLine, ctx: Context): Judged {
  if (line.trade) return { bucket: line.copper > 0 ? "sales" : "purchases" };
  if (line.award || (line.split && line.transactionType === "adjustment")) return { bucket: "encounter" };
  const type = line.transactionType;
  if (!type) {
    if (/^Encounter loot/.test(line.summary)) return { bucket: "encounter" };
    if (/^Bought /.test(line.summary)) return { bucket: "purchases" };
    if (/^Sold /.test(line.summary)) return { bucket: "sales" };
    return { bucket: "unclassified", reason: "An older entry recorded without a kind" };
  }
  if (type === "sale") return { bucket: "sales" };
  if (type === "purchase" || line.purchase || line.listingPurchase) return { bucket: "purchases" };
  if (type === "loan") return { bucket: line.copper > 0 ? "loans" : "repayments" };
  if (type === "adjustment") {
    if (/^Encounter loot/.test(line.summary)) return { bucket: "encounter" };
    return { bucket: line.copper > 0 ? "grants" : "deductions" };
  }
  if (type === "payment") return payment(line, ctx);
  return { bucket: "unclassified", reason: "An entry of a kind this view does not know" };
}

/** A quest reward link turns an incoming line into a quest reward (the DM linked it). */
function questOverride(line: LedgerLine, judged: Judged, ctx: Context): Judged {
  if (!isFaucet(judged.bucket)) return judged;
  const receipt = line.award?.receiptId ?? (line.transactionType === "adjustment" ? line.split?.id : undefined);
  if (ctx.questLines.has(line.id) || (receipt && ctx.questReceipts.has(receipt))) return { bucket: "quests" };
  return judged;
}

/** Classify one table's ledger into flow entries (party lines only). */
function classifyTable(
  ledger: readonly LedgerLine[],
  party: Set<string>,
  ctx: Context,
  periodOf: (line: LedgerLine) => string,
  known: Map<string, Bucket>,
): FlowEntry[] {
  const out: FlowEntry[] = [];
  const groups = new Map<string, LedgerLine[]>();
  const voids: LedgerLine[] = [];
  for (const line of ledger) {
    if (line.transactionType === "void" && line.reversalOf) {
      voids.push(line);
      continue;
    }
    const key = transferKey(line);
    if (key) {
      const g = groups.get(key);
      if (g) g.push(line);
      else groups.set(key, [line]);
      continue;
    }
    if (!party.has(line.purseId) || line.copper === 0) continue;
    const judged = questOverride(line, single(line, ctx), ctx);
    known.set(line.id, judged.bucket);
    out.push({ ...judged, copper: line.copper, lineIds: [line.id], at: line.at, summary: line.summary, period: periodOf(line) });
  }
  for (const lines of groups.values()) {
    const ours = lines.filter((l) => party.has(l.purseId) && l.copper !== 0);
    if (!ours.length) continue;
    const theirs = lines.some((l) => !party.has(l.purseId));
    const net = ours.reduce((s, l) => s + l.copper, 0);
    const first = ours[0]!;
    const base = { at: first.at, summary: first.summary, period: periodOf(first) };
    const inward = ours.reduce((s, l) => s + Math.max(0, l.copper), 0);
    if (net === 0) {
      for (const l of ours) known.set(l.id, "transfer");
      out.push({ ...base, bucket: "transfer", copper: 0, moved: inward, lineIds: ours.map((l) => l.id) });
      continue;
    }
    let bucket: Bucket;
    let reason: string | undefined;
    if (!theirs) {
      bucket = "unclassified";
      reason = "A transfer whose other side is not on the ledger";
    } else {
      const text = lines.map((l) => l.summary).join("\n");
      const loanLine = ours.some((l) => endsWithId(l.id, ctx.loanIds));
      if (/loan (received|advanced)/.test(text) && net > 0) bucket = "loans";
      else if (loanLine || /repayment/.test(text)) bucket = net > 0 ? "loans" : "repayments";
      else bucket = net > 0 ? "from-others" : "to-others";
    }
    for (const l of ours) known.set(l.id, bucket);
    out.push({ ...base, bucket, copper: net, lineIds: ours.map((l) => l.id), ...(reason ? { reason } : {}) });
    // Part of the group that stayed inside the party (a split that also paid an NPC).
    const inside = inward - Math.max(0, net);
    if (theirs && inside > 0) out.push({ ...base, bucket: "transfer", copper: 0, moved: inside, lineIds: [] });
  }
  for (const line of voids) {
    if (!party.has(line.purseId) || line.copper === 0) continue;
    const original = known.get(line.reversalOf!);
    out.push({
      bucket: original ?? "unclassified",
      ...(original ? {} : { reason: "A reversal of an entry that is not loaded" }),
      ...(original === "transfer" ? { moved: 0 } : {}),
      copper: line.copper,
      lineIds: [line.id],
      at: line.at,
      summary: line.summary,
      period: periodOf(line),
    });
  }
  return out;
}

/** Is this line inside the session (the same rule as journal.ts selectSessionLedgerRows)? */
function inSession(session: Session, line: { id: string; at: number }): boolean {
  const start = session.startLedgerIds;
  const end = session.endLedgerIds;
  return (start ? !start.includes(line.id) : line.at >= session.startedAt) && (end ? end.includes(line.id) : !session.endedAt || line.at < session.endedAt);
}

type Snapshot = { table: HealthTable } | null;
const CACHE_LIMIT = 300;
const snapshots = new Map<string, Snapshot>();
/** Archived snapshots are immutable: parse each once per page load (keyed by report and size). */
function readSnapshot(report: { id: string; snapshot: string }): Snapshot {
  const key = `${report.id}:${report.snapshot.length}`;
  if (snapshots.has(key)) return snapshots.get(key)!;
  let value: Snapshot = null;
  try {
    const raw: unknown = JSON.parse(report.snapshot);
    if (isRecord(raw) && Array.isArray(raw.purses) && Array.isArray(raw.ledger))
      value = {
        table: {
          purses: raw.purses as Purse[],
          ledger: raw.ledger as LedgerLine[],
          holdings: (Array.isArray(raw.holdings) ? raw.holdings : []) as HealthTable["holdings"],
          journal: (isRecord(raw.journal) ? raw.journal : { sessions: [], requests: [], events: [] }) as Journal,
        },
      };
  } catch {
    value = null;
  }
  snapshots.set(key, value);
  if (snapshots.size > CACHE_LIMIT) snapshots.delete(snapshots.keys().next().value!);
  return value;
}

/**
 * The in-game day of a real time, from the campaign clock's history: approved downtime and
 * session time advances. Lines written by a clock change belong to the day it started from.
 */
export function dayClock(journal: Journal | undefined): (at: number) => number {
  const f = journal?.finance;
  const anchors: Array<{ at: number; from: number; to: number }> = [];
  for (const d of f?.downtime ?? [])
    if (d.status === "applied" && d.appliedAt !== undefined) anchors.push({ at: d.appliedAt, from: d.fromDay, to: d.fromDay + d.days });
  for (const h of journal?.world?.timeHistory ?? [])
    anchors.push({ at: h.at, from: h.fromDay, to: h.fromDay + Math.floor(((h.fromMinute ?? 0) + h.hours * 60) / 1440) });
  anchors.sort((a, b) => a.at - b.at);
  const today = f?.day ?? 0;
  return (at: number) => {
    let day = anchors.length ? anchors[0]!.from : today;
    for (const a of anchors) {
      if (a.at < at) day = a.to;
      else if (a.at === at) {
        day = a.from;
        break;
      } else break;
    }
    return day;
  };
}

function summarise(key: string, label: string, kind: PeriodFlows["kind"], entries: FlowEntry[], extra: Partial<PeriodFlows> = {}): PeriodFlows {
  const p: PeriodFlows = {
    key,
    label,
    kind,
    number: null,
    inProgress: false,
    faucets: emptyFaucets(),
    sinks: emptySinks(),
    faucetTotal: 0,
    sinkTotal: 0,
    net: 0,
    transfers: { count: 0, moved: 0, net: 0 },
    unclassified: { count: 0, net: 0 },
    coinChange: 0,
    worth: null,
    ...extra,
  };
  for (const e of entries) {
    p.coinChange += e.copper;
    if (isFaucet(e.bucket)) p.faucets[e.bucket] += e.copper;
    else if (isSink(e.bucket)) p.sinks[e.bucket] -= e.copper;
    else if (e.bucket === "transfer") {
      p.transfers.count += e.lineIds.length;
      p.transfers.moved += e.moved ?? 0;
      p.transfers.net += e.copper;
    } else {
      p.unclassified.count += e.lineIds.length;
      p.unclassified.net += e.copper;
    }
  }
  p.faucetTotal = Object.values(p.faucets).reduce((s, n) => s + n, 0);
  p.sinkTotal = Object.values(p.sinks).reduce((s, n) => s + n, 0);
  p.net = p.faucetTotal - p.sinkTotal;
  return p;
}

/**
 * SRD 5.2.1 "Starting at Higher Levels" (Character Creation): the gold a character created at a
 * level receives, as the average of the table's dice, in copper. The table's magic items are not
 * counted. Advisory only, like the encounter-difficulty estimate.
 */
export function srdStartingGold(level: number): number {
  if (level >= 17) return (20000 + 1375) * 100;
  if (level >= 11) return (5000 + 1375) * 100;
  if (level >= 5) return Math.round((500 + 137.5) * 100);
  return 0;
}

function wealthGuide(t: HealthTable, worth: NetWorth, targetPerLevel?: (level: number) => number): WealthGuide {
  const party = partyPurses(t);
  const guide = targetPerLevel ?? srdStartingGold;
  const characters = t.purses
    .filter((p) => p.kind === "character" && party.has(p.id))
    .map((p) => {
      const level = Number(characterSheet(p, [], t.sheets?.find((s) => s.purseId === p.id)).level) || 1;
      return { purseId: p.id, name: p.name, level, guideCopper: guide(level) };
    });
  return { characters, guideCopper: characters.reduce((s, c) => s + c.guideCopper, 0), worthCopper: worth.total };
}

/**
 * The economy-health view of a table the DM holds (the live campaign with whatever archived
 * sessions this device has loaded). `targetPerLevel` is the DM's own per-character target in
 * copper, in place of the SRD table.
 */
export function economyHealth(t: HealthTable, options: { targetPerLevel?: (level: number) => number } = {}): EconomyHealth {
  const journal = t.journal;
  const sessions = [...(journal?.sessions ?? [])].sort((a, b) => a.startedAt - b.startedAt);
  const number = new Map(sessions.map((s, i) => [s.id, i + 1]));
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const reports = [...(journal?.reports ?? [])].sort((a, b) => a.at - b.at);
  const loaded: Array<{ report: (typeof reports)[number]; table: HealthTable }> = [];
  let notLoaded = 0,
    unreadable = 0;
  const status = new Map<string, PeriodFlows["unavailable"]>();
  for (const report of reports) {
    if (report.deferred) {
      notLoaded++;
      status.set(report.id, "not-loaded");
      continue;
    }
    const read = report.error === undefined ? readSnapshot(report) : null;
    if (!read) {
      unreadable++;
      status.set(report.id, "unreadable");
      continue;
    }
    loaded.push({ report, table: read.table });
  }
  const ctx = context(loaded.map((l) => l.table), t);
  const known = new Map<string, Bucket>();
  const entries: FlowEntry[] = [];
  const worthAt = new Map<string, NetWorth>();
  const periodFor = (session: Session | undefined, next: string) => (line: LedgerLine) =>
    session && inSession(session, line) ? session.id : `between:${next}`;
  for (const { report, table } of loaded) {
    const session = byId.get(report.id);
    entries.push(...classifyTable(table.ledger, partyPurses(table), ctx, periodFor(session, report.id), known));
    worthAt.set(report.id, netWorth(table));
  }
  const active = sessions.find((s) => !s.endedAt);
  entries.push(...classifyTable(t.ledger, partyPurses(t), ctx, periodFor(active, active?.id ?? "now"), known));
  const now = netWorth(t);
  if (active) worthAt.set(active.id, now);

  const byPeriod = new Map<string, FlowEntry[]>();
  for (const e of entries) {
    const list = byPeriod.get(e.period);
    if (list) list.push(e);
    else byPeriod.set(e.period, [e]);
  }
  const rows: PeriodFlows[] = [];
  const ordered = [...sessions.map((s) => s.id), ...reports.filter((r) => !byId.has(r.id)).map((r) => r.id)];
  for (const id of ordered) {
    const s = byId.get(id);
    const name = s?.name ?? reports.find((r) => r.id === id)?.name ?? "Archived session";
    const label = s ? `Session ${number.get(id)} · ${name}` : name;
    const between = byPeriod.get(`between:${id}`);
    if (between?.length) rows.push(summarise(`between:${id}`, `Before ${label}`, "between", between));
    const unavailable = status.get(id);
    const ended = !!s?.endedAt;
    rows.push(
      summarise(id, label, "session", byPeriod.get(id) ?? [], {
        number: number.get(id) ?? null,
        inProgress: !!s && !ended,
        worth: worthAt.get(id) ?? null,
        ...(unavailable ? { unavailable } : {}),
      }),
    );
  }
  const after = byPeriod.get("between:now");
  if (after?.length) rows.push(summarise("between:now", "Since the last session", "between", after, { worth: now }));

  const clock = dayClock(journal);
  const weekly = new Map<number, FlowEntry[]>();
  for (const e of entries) {
    const week = Math.floor(clock(e.at) / 7);
    const list = weekly.get(week);
    if (list) list.push(e);
    else weekly.set(week, [e]);
  }
  const weeks = [...weekly.keys()]
    .sort((a, b) => a - b)
    .map((w) => summarise(`week:${w}`, `Week ${w + 1} · days ${w * 7 + 1}–${w * 7 + 7}`, "week", weekly.get(w)!, { number: w + 1 }));

  const trend = rows
    .filter((r) => r.kind === "session" && r.worth)
    .map((r) => ({ key: r.key, label: r.number ? `S${r.number}` : r.label, worth: r.worth! }));
  if (!active) trend.push({ key: "now", label: "Now", worth: now });

  return {
    sessions: rows,
    weeks,
    campaign: summarise("campaign", "Campaign so far (loaded)", "session", entries, { worth: now }),
    entries,
    unclassified: entries.filter((e) => e.bucket === "unclassified"),
    notLoaded,
    unreadable,
    trend,
    now,
    wealth: wealthGuide(t, now, options.targetPerLevel),
    day: journal?.finance?.day ?? 0,
  };
}
