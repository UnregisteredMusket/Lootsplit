/**
 * Activity shows each treasure-pool resolution as one expandable row (its receipt, with a line
 * per item moved) and groups claim changes into one "Claims marked" row between resolutions.
 * Rows are built from the journal events the seat's projection already supplies (projectLoot),
 * so a player sees only party lines, and only their own when away from the party.
 */
import { formatCopper } from "./money.ts";
import { CHOICE_LABEL, METHOD_LABEL } from "./loot-claims.ts";
import type { Journal } from "./journal.ts";
import type { Purse } from "./types.ts";

type Event = Journal["events"][number];
export type LootActivityLine = { id: string; who: string; item: string; detail: string; own: boolean };
export type LootActivity = {
  id: string;
  at: number;
  kind: "treasure pool";
  icon: "resolve" | "claims";
  title: string;
  detail: string;
  total: string;
  lines: LootActivityLine[];
  summary: string;
};

export function lootActivity(
  events: Event[],
  purses: Pick<Purse, "id" | "name">[],
  options: { ownPurseIds: string[] },
): LootActivity[] {
  const name = (id: string) => purses.find((p) => p.id === id)?.name ?? "A character";
  const rows: LootActivity[] = [];
  const sorted = [...events].sort((a, b) => a.at - b.at);
  let claims: Event[] = [];
  const flush = () => {
    if (!claims.length) return;
    const first = claims[0]!,
      last = claims.at(-1)!;
    const lines = claims.map((e) => {
      const c = e.lootClaim!;
      return {
        id: e.id,
        who: name(c.purseId),
        item: c.name,
        detail: `${c.previous ? `${CHOICE_LABEL[c.previous]} → ` : ""}${CHOICE_LABEL[c.choice]}${c.by === "dm" ? " · marked by the DM" : ""} · ${new Date(e.at).toLocaleTimeString()}`,
        own: options.ownPurseIds.includes(c.purseId),
      };
    });
    const title = `Claims marked · ${claims.length} change${claims.length === 1 ? "" : "s"}`;
    rows.push({
      id: `claims-${first.id}`,
      at: last.at,
      kind: "treasure pool",
      icon: "claims",
      title,
      detail: "treasure pool claims · no items moved",
      total: "0 cp",
      lines,
      summary: [title, ...lines.map((l) => `${l.who} ${l.item} ${l.detail}`)].join(" "),
    });
    claims = [];
  };
  for (const e of sorted) {
    if (e.lootClaim) {
      claims.push(e);
      continue;
    }
    const r = e.lootResolution;
    if (!r) continue;
    flush();
    const recipients = new Set(r.lots.flatMap((l) => l.awards.map((a) => a.purseId)));
    const items = r.lots.reduce((s, l) => s + l.awards.reduce((x, a) => x + a.quantity, 0), 0);
    const value = r.lots.reduce((s, l) => s + l.awards.reduce((x, a) => x + a.quantity * l.unitCopper, 0), 0);
    const lines = r.lots.flatMap((lot) =>
      lot.awards.map((a) => {
        const rolled = lot.rolls.length
          ? ` · ${r.rolls === "manual" ? "Pen & Paper" : r.rolls === "local" ? "DM device" : "server"} d100: ${[...lot.rolls]
              .sort((x, y) => (y.d100.at(-1) ?? 0) - (x.d100.at(-1) ?? 0))
              .map((roll) => `${name(roll.purseId).split(" ")[0]} ${roll.d100.join("/")}`)
              .join(", ")}`
          : r.method === "random" && lot.awards.length
            ? " · no roll needed"
            : "";
        return {
          id: `${lot.holdingId}-${a.purseId}`,
          who: `${name(lot.fundId)} → ${name(a.purseId)}`,
          item: `${lot.name} × ${a.quantity}`,
          detail: `${CHOICE_LABEL[a.choice]}${rolled} · value ${formatCopper(lot.unitCopper * a.quantity)}`,
          own: options.ownPurseIds.includes(a.purseId),
        };
      }),
    );
    const title = `Treasure pool resolved · ${r.lots.length} item${r.lots.length === 1 ? "" : "s"} to ${recipients.size} character${recipients.size === 1 ? "" : "s"}`;
    rows.push({
      id: r.id,
      at: e.at,
      kind: "treasure pool",
      icon: "resolve",
      title,
      detail: `treasure pool · by the DM · ${METHOD_LABEL[r.method]}${r.rolls ? ` · ${r.rolls === "manual" ? "Pen & Paper rolls" : r.rolls === "local" ? "DM device rolls" : "server rolls"}` : ""}`,
      total: `${items} item${items === 1 ? "" : "s"} · ${formatCopper(value)}`,
      lines,
      summary: [title, ...lines.map((l) => `${l.who} ${l.item} ${l.detail}`)].join(" "),
    });
  }
  flush();
  // Newest first. Rows are built in event order, so events in the same millisecond keep their
  // real order by breaking ties on that position (newer position first).
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.at - a.row.at || b.index - a.index)
    .map(({ row }) => row);
}
