/**
 * "Since you were away" on player Home (plan P4, Q21): what changed for this player's characters
 * since they last left Home on this device. Presentation only, computed from the player's own
 * projected table (never more than the seat can already read); the last-visit snapshot is a
 * per-device convenience in browser storage.
 */
type Holding = { id: string; name: string; pool?: unknown };
type Claim = { holdingId: string; purseId: string };
type CoinRequest = { id: string; purseId: string; note: string; status: string };
type Journey = { id: string; requestedBy: string; status: string };
type Quest = { id: string; updatedAt: number; archived?: boolean };
export type AwayTable = {
  holdings: Holding[];
  journal?: {
    requests?: CoinRequest[];
    lootClaims?: { claims?: Claim[] };
    world?: { journeys?: Journey[] };
    quests?: { quests?: Quest[] };
  } | null;
};
export type AwaySnapshot = {
  at: number;
  requests: Record<string, string>;
  journeys: Record<string, string>;
};
export type AwayItem = { id: string; text: string; href: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What this device remembers when the player leaves Home. */
export function awaySnapshot(t: AwayTable, mine: string[], at: number): AwaySnapshot {
  return {
    at,
    requests: Object.fromEntries(
      (t.journal?.requests ?? []).filter((r) => mine.includes(r.purseId)).map((r) => [r.id, r.status]),
    ),
    journeys: Object.fromEntries(
      (t.journal?.world?.journeys ?? [])
        .filter((j) => mine.includes(j.requestedBy))
        .map((j) => [j.id, j.status]),
    ),
  };
}

/**
 * The card's lines. Unread chat and unclaimed pool lots are always current; DM answers and quest
 * updates need an earlier visit to compare with (`previous`), so a first visit shows none of them.
 */
export function sinceAway(
  t: AwayTable,
  mine: string[],
  previous: AwaySnapshot | null,
  unread: number,
): AwayItem[] {
  const items: AwayItem[] = [];
  if (unread > 0)
    items.push({ id: "chat", text: plural(unread, "unread message", "unread messages"), href: "/share?chat=1" });
  const claims = t.journal?.lootClaims?.claims ?? [];
  const waiting = t.holdings.filter(
    (h) => h.pool && !claims.some((c) => c.holdingId === h.id && mine.includes(c.purseId)),
  ).length;
  if (waiting > 0)
    items.push({
      id: "pool",
      text: `${plural(waiting, "item", "items")} waiting for your claim`,
      href: "/party?section=pool",
    });
  if (!previous) return items;
  for (const r of t.journal?.requests ?? []) {
    if (!mine.includes(r.purseId) || previous.requests[r.id] !== "pending" || r.status === "pending") continue;
    items.push({
      id: `request-${r.id}`,
      text: `The DM ${r.status === "approved" ? "approved" : "declined"} your request: ${r.note}`,
      href: "/features/bank",
    });
  }
  for (const j of t.journal?.world?.journeys ?? []) {
    if (!mine.includes(j.requestedBy) || previous.journeys[j.id] !== "proposed" || j.status === "proposed") continue;
    items.push({
      id: `journey-${j.id}`,
      text:
        j.status === "denied"
          ? "The DM declined your journey"
          : j.status === "cancelled"
            ? "Your proposed journey was cancelled"
            : "The DM approved your journey",
      href: "/maps",
    });
  }
  const quests = (t.journal?.quests?.quests ?? []).filter((q) => !q.archived && q.updatedAt > previous.at).length;
  if (quests > 0)
    items.push({
      id: "quests",
      text: `${plural(quests, "quest", "quests")} updated`,
      href: "/features/quests",
    });
  return items;
}

const key = (campaign: string) => `lootsplit.away.v1.${campaign}`;

export function readAwaySnapshot(campaign: string): AwaySnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(campaign)) || "null") as AwaySnapshot | null;
    return value && typeof value.at === "number" && value.requests && value.journeys ? value : null;
  } catch {
    return null;
  }
}

export function writeAwaySnapshot(campaign: string, snapshot: AwaySnapshot) {
  try {
    localStorage.setItem(key(campaign), JSON.stringify(snapshot));
  } catch {
    // Without storage the card shows only current unread chat and pool claims.
  }
}
