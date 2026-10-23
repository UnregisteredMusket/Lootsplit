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
  const rows: SplitActivity[] = [];
  for (const [id, { lines, event }] of groups) {
    lines.sort(
      (a, b) =>
        ROLE_ORDER[a.split!.role] - ROLE_ORDER[b.split!.role] || a.id.localeCompare(b.id, "en", { numeric: true }),
    );
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
      title = `Coin split from ${name(sourceId)}${shares}`;
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
