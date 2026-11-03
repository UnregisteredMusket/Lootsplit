/**
 * Activity shows each coin split as one expandable row: the ledger lines that share a split ID
 * (fund splits and split encounter awards), with the split's journal receipt when the reader
 * may see it. Players get only the lines their projection already contains.
 */
import { formatCopper } from "./money.ts";
import type { Journal } from "./journal.ts";
import type { LedgerLine, Purse } from "./types.ts";

export type SplitActivity = {
  id: string;
  at: number;
  kind: "split";
  /** Fund split or encounter award. */
  source: "fund" | "encounter";
  title: string;
  detail: string;
  /** Total moved, as shown on the row. */
  copper: number;
  lines: LedgerLine[];
  event?: Journal["events"][number];
  summary: string;
};

const ROLE_ORDER = { source: 0, share: 1, remainder: 2 } as const;

/**
 * Sell and split writes plain sale lines `<command id>-sale-<n>` beside its split lines (no new
 * stored field); Activity shows them inside the split's row. Null for any other line.
 */
function saleBelongs(
  line: Pick<LedgerLine, "purseId" | "at">,
  group: { lines: LedgerLine[]; event?: Journal["events"][number] },
): boolean {
  const source = group.lines.find((l) => l.split?.role === "source");
  const fundId = group.event?.split?.sourceId ?? source?.purseId;
  const at = source?.at ?? group.event?.at;
  return line.purseId === fundId && line.at === at;
}

export function saleSplitId(line: Pick<LedgerLine, "id" | "split" | "transactionType">): string | null {
  if (line.split || line.transactionType !== "sale") return null;
  return /^(.+)-sale-\d+$/.exec(line.id)?.[1] ?? null;
}

export function splitActivity(
  ledger: LedgerLine[],
  events: Journal["events"],
  purses: Pick<Purse, "id" | "name">[],
  options: { dm: boolean; ownPurseIds: string[] },
): SplitActivity[] {
  const name = (id: string) => purses.find((p) => p.id === id)?.name ?? "An account";
  const groups = new Map<string, { lines: LedgerLine[]; event?: Journal["events"][number] }>();
  for (const line of ledger) {
    if (!line.split) continue;
    const group = groups.get(line.split.id) ?? { lines: [] };
    group.lines.push(line);
    groups.set(line.split.id, group);
  }
  for (const event of events) {
    if (!event.split) continue;
    const group = groups.get(event.split.id) ?? { lines: [] };
    group.event = event;
    groups.set(event.split.id, group);
  }
  // A sale line joins its split's row only when the split is in this view and the line is the
  // same fund's, written at the same moment (command IDs come from clients).
  for (const line of ledger) {
    const id = saleSplitId(line);
    const group = id ? groups.get(id) : undefined;
    if (group && saleBelongs(line, group)) group.lines.push(line);
  }
  const rows: SplitActivity[] = [];
  for (const [id, { lines, event }] of groups) {
    const order = (l: LedgerLine) => (l.split ? ROLE_ORDER[l.split.role] + 1 : 0);
    lines.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id, "en", { numeric: true }));
    const sales = lines.filter((l) => !l.split);
    const sourceLine = lines.find((l) => l.split?.role === "source");
    const encounter = !sourceLine && !event && lines.some((l) => l.summary.startsWith("Encounter loot"));
    const at = event?.at ?? lines[0]?.at ?? 0;
    const mine = lines.filter((l) => l.split?.role !== "source" && options.ownPurseIds.includes(l.purseId));
    const ownShare = mine.reduce((sum, l) => sum + l.copper, 0) + (sourceLine?.split?.keptShare && options.ownPurseIds.includes(sourceLine.purseId) ? sourceLine.split.keptShare : 0);
    let title: string;
    let copper: number;
    let detail: string;
    if (encounter) {
      const award = lines[0]!.summary.replace(/^Encounter loot (share|leftover): /, "").replace(/ \([^)]*rule\)$/, "");
      const shares = lines.filter((l) => l.split?.role === "share").length;
      title = `Encounter loot: ${award} · coins split${options.dm ? ` ${shares} ways` : ""}`;
      copper = lines.reduce((sum, l) => sum + l.copper, 0);
      detail = `award receipt ${id.slice(0, 8)}`;
    } else {
      const sourceId = event?.split?.sourceId ?? sourceLine?.purseId ?? "";
      const shares = options.dm && event?.split ? ` · ${event.split.n} shares` : "";
      const shop = sales[0]?.summary.match(/^.* to (.+)$/)?.[1];
      title = sales.length
        ? `Sold ${sales.length === 1 ? sales[0]!.summary.replace(/^Sold /, "").replace(/ to (?:(?! to ).)+$/, "") : `${sales.length} items`} to ${shop ?? "a shop"} and split from ${name(sourceId)}${shares}`
        : `Coin split from ${name(sourceId)}${shares}`;
      copper = event?.split?.copper ?? Math.abs(sourceLine?.copper ?? 0) + (sourceLine?.split?.keptShare ?? 0);
      detail = event?.split && options.dm ? `leftover rule: ${event.split.rule.replace("-", " ")}` : "";
    }
    if (!options.dm && ownShare > 0) detail = [detail, `your share +${formatCopper(ownShare)}`].filter(Boolean).join(" · ");
    rows.push({
      id,
      at,
      kind: "split",
      source: encounter ? "encounter" : "fund",
      title,
      detail,
      copper,
      lines,
      ...(event ? { event } : {}),
      summary: [title, ...lines.map((l) => `${name(l.purseId)} ${l.summary}`)].join(" "),
    });
  }
  return rows.sort((a, b) => b.at - a.at);
}
