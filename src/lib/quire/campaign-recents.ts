/**
 * Recently opened campaigns on this device (design D10 / dm #27): when each campaign was last
 * opened and its current session number, for the title screen's "Continue · <campaign> ·
 * Session N" prompt and the Campaigns dialog's recent list. A per-device convenience in
 * localStorage: every read and write tolerates blocked or cleared storage, and nothing else
 * depends on it. Guest (in-memory) campaigns are never recorded.
 */
export type CampaignRecent = { name: string; openedAt: number; session?: number };
export type CampaignRecents = { last?: string; campaigns: Record<string, CampaignRecent> };

export const RECENTS_ITEM = "lootsplit.campaign-recents.v1";
/** How old a recorded opening may get before the same campaign's opening is written again. */
export const REFRESH_MS = 60 * 60 * 1000;
type Store = Pick<Storage, "getItem" | "setItem">;

function local(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readCampaignRecents(storage: Store | null = local()): CampaignRecents {
  try {
    const raw = JSON.parse(storage?.getItem(RECENTS_ITEM) || "null") as CampaignRecents | null;
    if (!raw || typeof raw !== "object" || typeof raw.campaigns !== "object" || !raw.campaigns)
      return { campaigns: {} };
    const campaigns: Record<string, CampaignRecent> = {};
    for (const [id, entry] of Object.entries(raw.campaigns)) {
      if (!entry || typeof entry.openedAt !== "number" || typeof entry.name !== "string") continue;
      campaigns[id] = {
        name: entry.name,
        openedAt: entry.openedAt,
        ...(Number.isInteger(entry.session) && entry.session! > 0 ? { session: entry.session } : {}),
      };
    }
    return { last: typeof raw.last === "string" ? raw.last : undefined, campaigns };
  } catch {
    return { campaigns: {} };
  }
}

/** Records that `id` is open now (and its session number when known). */
export function noteCampaignOpened(
  id: string,
  entry: { name: string; session?: number },
  now = Date.now(),
  storage: Store | null = local(),
): void {
  const recents = readCampaignRecents(storage);
  const previous = recents.campaigns[id];
  const session = entry.session ?? previous?.session;
  // Moving between screens is not a new opening: rewrite only when something shown changes or
  // the time is over an hour old (labels count days), so browsing leaves storage untouched.
  if (
    previous &&
    recents.last === id &&
    previous.name === entry.name &&
    previous.session === session &&
    now >= previous.openedAt &&
    now - previous.openedAt < REFRESH_MS
  )
    return;
  recents.campaigns[id] = { name: entry.name, openedAt: now, ...(session ? { session } : {}) };
  recents.last = id;
  try {
    storage?.setItem(RECENTS_ITEM, JSON.stringify(recents));
  } catch {
    /* Storage may be blocked or full; the prompt then stays generic. */
  }
}

/** "Continue · The Wayfarers · Session 12" for the last opened campaign, or null. */
export function titlePrompt(recents: CampaignRecents): string | null {
  const recent = recents.last ? recents.campaigns[recents.last] : undefined;
  if (!recent?.name.trim()) return null;
  return ["Continue", recent.name.trim(), recent.session ? `Session ${recent.session}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Campaigns sorted by last opened, newest first; never-opened ones keep their order last. */
export function byRecent<T extends { id: string }>(list: T[], recents: CampaignRecents): T[] {
  const at = (c: T) => recents.campaigns[c.id]?.openedAt ?? -1;
  return list
    .map((c, index) => ({ c, index }))
    .sort((a, b) => at(b.c) - at(a.c) || a.index - b.index)
    .map(({ c }) => c);
}

/** "Opened today", "Opened yesterday", "Opened 3 days ago", or a date; null when unknown. */
export function lastOpenedLabel(at: number | undefined, now = Date.now()): string | null {
  if (at === undefined) return null;
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  };
  const days = Math.round(day(now) - day(at));
  if (days <= 0) return "Opened today";
  if (days === 1) return "Opened yesterday";
  if (days < 14) return `Opened ${days} days ago`;
  return `Opened ${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
