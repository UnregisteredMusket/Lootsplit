/**
 * Session recap (loot plan phase 6): a short "what happened" summary of one named session, worked
 * out on the device from that session's ledger lines and journal events. Nothing here is stored;
 * the only stored recap is the text a DM chooses to share (a party journal entry whose ID is
 * `recapEntryId(session.id)`, posted through the existing `journal-note` command).
 *
 * The recap is built from the records the reader already holds:
 * - the live session: the working set (`useEconomy`), already projected for a player seat;
 * - an archived session: its report snapshot, projected for the seat (`readArchiveResult`),
 *   loaded on request through history on demand.
 *
 * Three audiences:
 * - `dm`: everything in the DM's records.
 * - `party`: the DM's draft for sharing with the players. It names only party funds and visible
 *   player characters, and leaves out DM-only events, NPCs, hidden characters and hidden groups,
 *   and each character's own purchases, finances and activity (private to its player), so a DM
 *   who shares the draft unchanged never reveals what the players could not see.
 * - `player`: the seat's projected records, narrowed again to its own characters and the party
 *   funds (defence in depth: other players' purses never appear even where a projection allows).
 *
 * Old sessions without the newer receipt fields are read by their recorded summaries; a session
 * with nothing to report gives no sections ("Nothing recorded"), never an error.
 */
import type { CloudTable } from "./cloud.ts";
import { characterPosition, characterVisible, inParty } from "./character-position.ts";
import { isNpc, partyFunds } from "./coin-split.ts";
import { readJournal, selectSessionLedgerRows, type Journal } from "./journal.ts";
import { formatCopper } from "./money.ts";
import { splitActivity } from "./split-activity.ts";
import { projectIdentities } from "./item-identity.ts";
import { characterControl, type LedgerLine, type Purse } from "./types.ts";

export type RecapAudience =
  | { kind: "dm" }
  | { kind: "party" }
  | { kind: "player"; purseIds: string[] };
export type RecapSectionKey = "loot" | "claims" | "trade" | "travel" | "downtime";
export type RecapSection = { key: RecapSectionKey; title: string; lines: string[] };
export type SessionRecap = { sessionId: string; name: string; sections: RecapSection[] };
export type RecapSource = Pick<CloudTable, "ledger" | "purses" | "shops" | "holdings"> & {
  journal?: CloudTable["journal"];
};
type Session = Journal["sessions"][number];
type Event = Journal["events"][number];

export const NOTHING_RECORDED = "Nothing recorded";
const TITLES: Record<RecapSectionKey, string> = {
  loot: "Loot and coin awarded",
  claims: "Claims resolved",
  trade: "Purchases and sales",
  travel: "Travel",
  downtime: "Downtime and services",
};
/** Journal entry ID of a session's shared recap (an entry ID is at most 150 characters). */
export const recapEntryId = (sessionId: string) => `recap:${sessionId}`.slice(0, 150);
export const isRecapEntryId = (id: string) => id.startsWith("recap:");
export const recapTitle = (name: string) => `Recap: ${name}`.slice(0, 100);
export const RECAP_UNAVAILABLE = "The recap could not be built.";

/**
 * The live session's records for a recap reader: the DM's own table, or a player's projection
 * (`project`, projectRecord for the seat). If projecting fails the reader gets an error, never
 * the unprojected records.
 */
export function liveRecapSource<T extends RecapSource>(
  live: T,
  dm: boolean,
  project: (table: T) => RecapSource,
): { source: RecapSource } | { error: string } {
  if (dm) return { source: live };
  try {
    return { source: project(live) };
  } catch {
    return { error: RECAP_UNAVAILABLE };
  }
}

const encounterName = (summary: string) =>
  summary
    .replace(/^Encounter loot( share| leftover)?: /, "")
    .replace(/ \([^()]*rule\)$/, "");

/** Build the recap of `session` from `source` for `audience`. Never throws on old or partial data. */
export function buildSessionRecap(
  source: RecapSource,
  session: Session,
  audience: RecapAudience,
): SessionRecap {
  const recap: SessionRecap = { sessionId: session.id, name: session.name, sections: [] };
  // Item identification: the party draft is what players will read, so unidentified items are
  // named and valued as presented (a player's own source is already projected).
  if (audience.kind !== "dm" && source.holdings) source = projectIdentities({ holdings: source.holdings, journal: source.journal }, source);
  let journal: Journal;
  try {
    journal = readJournal(source.journal);
  } catch {
    journal = readJournal({});
  }
  const table = { purses: source.purses ?? [], journal } as Pick<CloudTable, "purses" | "journal">;
  const funds = new Set(partyFunds(table).map((p) => p.id));
  const purse = (id: string) => table.purses.find((p) => p.id === id);
  // Who this audience may hear about.
  const shown = (purseId: string): boolean => {
    if (audience.kind === "dm") return true;
    if (audience.kind === "player") return audience.purseIds.includes(purseId) || funds.has(purseId);
    const p = purse(purseId);
    if (!p) return false;
    if (funds.has(p.id)) return true;
    // The characters whose lines party players read (cloud.server.ts playerLedgerLine): visible
    // player characters travelling with the party, not away or on downtime.
    return (
      p.kind === "character" &&
      characterControl(p) === "player" &&
      !p.nonParty &&
      !isNpc(table, p) &&
      characterVisible(table, p) &&
      inParty(table, p) &&
      !characterPosition(table, p).downtime
    );
  };
  const name = (id: string) => {
    const p = purse(id);
    if (!p || (audience.kind === "player" && !audience.purseIds.includes(id) && !funds.has(id)))
      return "a character";
    return p.name;
  };
  const ledger = selectSessionLedgerRows(source.ledger ?? [], session).filter((l) => shown(l.purseId));
  const events = (journal.events ?? []).filter(
    (e) =>
      e.at >= session.startedAt &&
      (!session.endedAt || e.at <= session.endedAt) &&
      (audience.kind === "dm" ||
        (!e.dmOnly &&
          // A character's own activity is its player's (projectRecord); the party draft keeps
          // party-wide events, the funds' and treasure-pool receipts (named per award below).
          (!e.purseId ||
            (audience.kind === "party" ? funds.has(e.purseId) || !!e.lootResolution : shown(e.purseId))))),
  );
  const add = (key: RecapSectionKey, lines: string[]) => {
    const kept = lines.filter(Boolean);
    if (kept.length) recap.sections.push({ key, title: TITLES[key], lines: kept });
  };
  const safe = (work: () => void) => {
    try {
      work();
    } catch {
      // One unreadable record leaves its section out; the rest of the recap still shows.
    }
  };
  const own = audience.kind === "player" ? audience.purseIds : [];
  const used = new Set<string>();
  safe(() => add("loot", lootLines(ledger, events, table.purses, audience, own, name, used)));
  safe(() => add("claims", claimLines(events, shown, name)));
  // A character's own purchases and finances are private to its player (projectRecord): the
  // party draft counts only the party funds' lines for these.
  const personal = audience.kind === "party" ? ledger.filter((l) => funds.has(l.purseId)) : ledger;
  safe(() => add("trade", tradeLines(personal, source.shops ?? [], used)));
  safe(() => add("travel", travelLines(events, source, journal)));
  safe(() => add("downtime", downtimeLines(personal, events, audience)));
  return recap;
}

function lootLines(
  ledger: LedgerLine[],
  events: Event[],
  purses: Purse[],
  audience: RecapAudience,
  own: string[],
  name: (id: string) => string,
  used: Set<string>,
): string[] {
  const lines: string[] = [];
  const dm = audience.kind === "dm";
  // Even coin splits, split encounter awards and sell-and-split, one line each.
  const splits = splitActivity(ledger, events, purses, { dm, ownPurseIds: own });
  for (const row of [...splits].reverse()) {
    for (const l of row.lines) used.add(l.id);
    const shares = row.lines.filter((l) => l.split && l.split.role !== "source");
    const sourceId = row.event?.split?.sourceId ?? row.lines.find((l) => l.split?.role === "source")?.purseId;
    // A share line names its source fund ("Split share from …"), which its reader may see.
    const from = sourceId
      ? name(sourceId)
      : (/^Split share from (.+)$/.exec(shares[0]?.summary ?? "")?.[1] ?? "");
    const label =
      row.source === "encounter"
        ? `Encounter loot: ${encounterName(row.lines[0]?.summary ?? "")}, coins split`
        : row.lines.some((l) => !l.split)
          ? row.title.replace(/ · \d+ shares$/, "")
          : `Coin split${from ? ` from ${from}` : ""}`;
    if (dm) {
      const n = row.event?.split?.n ?? shares.length;
      lines.push(`${label}: ${formatCopper(row.copper)}${n ? ` among ${n}` : ""}.`);
    } else if (audience.kind === "player") {
      const mine = shares.filter((l) => own.includes(l.purseId)).reduce((s, l) => s + l.copper, 0);
      const source = row.lines.find((l) => l.split?.role === "source");
      const kept = source && own.includes(source.purseId) ? (source.split?.keptShare ?? 0) : 0;
      if (mine + kept > 0) lines.push(`${label}: your share ${formatCopper(mine + kept)}.`);
      else if (shares.length) lines.push(`${label}.`);
    } else {
      const each = new Map<string, number>();
      for (const l of shares) each.set(l.purseId, (each.get(l.purseId) ?? 0) + l.copper);
      if (each.size)
        lines.push(
          `${label}: ${[...each].map(([id, copper]) => `${formatCopper(copper)} to ${name(id)}`).join(", ")}.`,
        );
    }
  }
  // Encounter awards to one purse (coins and items), grouped by award receipt.
  const awards = new Map<string, { title: string; parts: string[] }>();
  for (const l of ledger) {
    if (used.has(l.id) || l.split) continue;
    const legacy = !l.award && /^Encounter loot: /.test(l.summary);
    if (!l.award && !legacy) continue;
    used.add(l.id);
    const item = l.award?.role === "item" || (legacy && l.copper === 0);
    const title = item
      ? (/ \(([^()]*)\)$/.exec(l.summary)?.[1] ?? encounterName(l.summary))
      : encounterName(l.summary);
    // Older lines carry no receipt: one encounter's lines in a session share its name.
    const key = l.award?.receiptId ?? `legacy:${title}`;
    const group = awards.get(key) ?? { title, parts: [] };
    if (!item) group.title = title;
    group.parts.push(
      item
        ? `${l.summary.replace(/^Encounter loot: /, "").replace(/ \([^()]*\)$/, "")} to ${name(l.purseId)}`
        : `${formatCopper(l.copper)} to ${name(l.purseId)}`,
    );
    awards.set(key, group);
  }
  for (const { title, parts } of awards.values())
    lines.push(`Encounter loot: ${title || "an encounter"}: ${parts.join(", ")}.`);
  return lines;
}

function claimLines(
  events: Event[],
  shown: (purseId: string) => boolean,
  name: (id: string) => string,
): string[] {
  const lines: string[] = [];
  for (const e of events) {
    const r = e.lootResolution;
    if (!r) continue;
    const parts = r.lots.flatMap((lot) =>
      lot.awards
        .filter((a) => shown(a.purseId))
        .map((a) => `${lot.name} × ${a.quantity} to ${name(a.purseId)}`),
    );
    if (parts.length) lines.push(`Treasure pool: ${parts.join(", ")}.`);
  }
  return lines;
}

function tradeLines(ledger: LedgerLine[], shops: CloudTable["shops"], used: Set<string>): string[] {
  const byShop = new Map<string, { bought: number; sold: number; buys: number; sales: number }>();
  for (const l of ledger) {
    if (used.has(l.id) || l.split || l.award || l.loot) continue;
    if (l.reversalOf || l.transactionType === "void") continue;
    const kind =
      l.transactionType === "purchase" || l.purchase || l.listingPurchase
        ? "buy"
        : l.transactionType === "sale"
          ? "sale"
          : !l.transactionType && l.shopId
            ? l.copper < 0
              ? "buy"
              : "sale"
            : null;
    if (!kind) continue;
    const shop =
      shops.find((s) => s.id === l.shopId)?.name ??
      (l.listingPurchase || /from the market$/.test(l.summary)
        ? "the property market"
        : (/ (?:from|to) (.+)$/.exec(l.summary)?.[1] ?? "a shop"));
    const row = byShop.get(shop) ?? { bought: 0, sold: 0, buys: 0, sales: 0 };
    if (kind === "buy") {
      row.bought += Math.abs(l.copper);
      row.buys += 1;
    } else {
      row.sold += Math.abs(l.copper);
      row.sales += 1;
    }
    byShop.set(shop, row);
  }
  return [...byShop].map(([shop, r]) =>
    [
      `${shop}:`,
      [
        r.buys ? `bought ${r.buys} time${r.buys === 1 ? "" : "s"} for ${formatCopper(r.bought)}` : "",
        r.sales ? `sold ${r.sales} time${r.sales === 1 ? "" : "s"} for ${formatCopper(r.sold)}` : "",
      ]
        .filter(Boolean)
        .join("; ") + ".",
    ].join(" "),
  );
}

function travelLines(events: Event[], source: RecapSource, journal: Journal): string[] {
  const place = (id: string) =>
    journal.market?.locations?.find((l) => l.id === id)?.name ?? "its destination";
  const ship = (id?: string) =>
    (id && source.holdings?.find((h) => h.id === id)?.name) || "A ship";
  const lines: string[] = [];
  for (const e of events) {
    const s = e.summary;
    let m: RegExpExecArray | null;
    if ((m = /^(.+: )?Departed: (.+?) · \d+% of the route/.exec(s)))
      lines.push(`${m[1] ?? ""}Set out: ${m[2]}.`);
    else if ((m = /^(.+: )?Travelled: (.+?) · \d+% of the route · arrived/.exec(s)))
      lines.push(`${m[1] ?? ""}Arrived: ${m[2]}.`);
    else if ((m = /^Party location: (.+) \(journey arrived\)$/.exec(s)))
      lines.push(`The party moved in at ${m[1]}.`);
    else if (/^Voyage (approved|active)/.test(s)) lines.push(`${ship(e.propertyId)} set sail.`);
    else if ((m = /^(.+) arrived at (\S+); aboard characters and cargo retained\.$/.exec(s)))
      lines.push(`${m[1]} arrived at ${place(m[2]!)}.`);
  }
  return lines;
}

function downtimeLines(ledger: LedgerLine[], events: Event[], audience: RecapAudience): string[] {
  const lines: string[] = [];
  if (events.some((e) => /^Applied approved downtime/.test(e.summary)))
    lines.push("Downtime approved and applied.");
  let services = 0;
  for (const e of events) {
    const m = /^(Lesson approved|Service request approved|Service order collected): (.+)$/.exec(e.summary);
    if (!m) continue;
    // The party draft counts services; their text can name NPCs a player has not met.
    if (audience.kind === "party") services += 1;
    else lines.push(`${m[1]}: ${m[2]!.replace(/\.$/, "")}.`);
  }
  if (services)
    lines.push(`${services} service${services === 1 ? "" : "s"} approved or collected.`);
  const finance = ledger.filter((l) => l.summary.startsWith("Finance: ") && l.transactionType !== "transfer");
  const paid = finance.reduce((s, l) => s + Math.max(0, -l.copper), 0);
  const earned = finance.reduce((s, l) => s + Math.max(0, l.copper), 0);
  if (paid || earned)
    lines.push(
      `Downtime finances: ${[earned ? `received ${formatCopper(earned)}` : "", paid ? `paid ${formatCopper(paid)}` : ""]
        .filter(Boolean)
        .join(", ")}.`,
    );
  return lines;
}

/** The recap as plain text: the DM's editable draft and the copy a player can read. */
export function recapText(recap: SessionRecap): string {
  if (!recap.sections.length) return `${recap.name}\n\n${NOTHING_RECORDED}.`;
  return [
    recap.name,
    ...recap.sections.map((s) => [`${s.title}`, ...s.lines.map((l) => `- ${l}`)].join("\n")),
  ]
    .join("\n\n")
    .slice(0, 12000);
}
