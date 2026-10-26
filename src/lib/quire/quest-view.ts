/**
 * Quest log presentation (docs/QUESTS.md): lists, tabs, labels, "here" and the per-device Follow
 * and Updated state. Pure helpers over the table this seat already has (a player's table is the
 * projection, so nothing here can reveal more than the server sent).
 */
import type { CloudTable } from "./cloud.ts";
import { questsOf } from "./quests.ts";
import type { Quest } from "./quests-schema.ts";
import { locationLabel, locationPath, readMarketLocations } from "./shop-locations.ts";
import { groupPlace, MAIN_GROUP, seatGroups } from "./party-groups.ts";
import { activeCampaignId } from "./campaign-context.ts";

type Table = Pick<CloudTable, "purses" | "journal">;
type Viewer = { role: "dm" | "player"; purseIds: string[] };

export type QuestTab = "play" | "drafts" | "done" | "failed" | "archived";
export const revealed = (q: Pick<Quest, "audience">) => q.audience.kind !== "none";

/** Main first, then the most recently changed. */
export function questOrder(a: Quest, b: Quest) {
  return Number(!!b.main) - Number(!!a.main) || Math.max(b.updatedAt, b.editedAt ?? 0) - Math.max(a.updatedAt, a.editedAt ?? 0) || a.title.localeCompare(b.title);
}
export function questTab(q: Quest): QuestTab {
  if (q.archived) return "archived";
  if (q.status === "completed") return "done";
  if (q.status === "failed") return "failed";
  return revealed(q) ? "play" : "drafts";
}
export function questsByTab(t: Table) {
  const tabs: Record<QuestTab, Quest[]> = { play: [], drafts: [], done: [], failed: [], archived: [] };
  for (const q of questsOf(t)) tabs[questTab(q)].push(q);
  for (const list of Object.values(tabs)) list.sort(questOrder);
  return tabs;
}
/** The objective a list row shows: the first open one players can see. */
export function nextObjective(q: Quest) {
  return q.objectives.find((o) => o.state === "open" && !o.hidden);
}
export function objectiveProgress(q: Quest) {
  const counted = q.objectives.filter((o) => !o.hidden && !o.optional);
  return { done: counted.filter((o) => o.state === "done").length, total: counted.length };
}
const nameOf = (t: Table, id: string) => t.purses.find((p) => p.id === id)?.name ?? "A character";
/** "Party", "Bram, Rowan", "Only you know this" or "You, Rowan". */
export function audienceLabel(t: Table, q: Quest, viewer: Viewer) {
  if (q.audience.kind === "none") return "Draft · only you";
  if (q.audience.kind === "party") return "Party";
  const ids = q.audience.purseIds;
  if (viewer.role === "dm") return ids.map((id) => nameOf(t, id)).join(", ");
  const others = ids.filter((id) => !viewer.purseIds.includes(id));
  return others.length ? `You, ${others.map((id) => nameOf(t, id)).join(", ")}` : "Only you know this";
}
export function placeName(t: Table, id: string | undefined) {
  if (!id) return "";
  const market = readMarketLocations(t.journal?.market);
  const path = locationPath(market, id);
  return path.length ? path.slice(-2).reverse().map((l) => l.name).join(", ") : locationLabel(market, id);
}
/** "Session 12 · day 42" for a chronicle line or objective change. */
export function stampLabel(t: Table, entry: { sessionId?: string; day?: number; at?: number }) {
  const session = t.journal?.sessions?.find((s) => s.id === entry.sessionId);
  const parts = [session?.name, entry.day !== undefined ? `day ${entry.day}` : undefined].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return entry.at ? new Date(entry.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
}
export function giverName(t: Table, q: Quest) {
  return q.giverNpcId ? t.journal?.world?.npcs.find((n) => n.id === q.giverNpcId)?.name : undefined;
}

/**
 * Quests "here": an open, visible objective's place, the quest's own place, or its giver's place is
 * on the path of the viewer's group place (owner-approved design 2.8).
 */
export function questsHere(t: Table, viewer: Viewer, group?: string): Quest[] {
  const ref = group ?? seatGroups(t, viewer)[0] ?? MAIN_GROUP;
  const here = groupPlace(t, ref).locationId;
  if (!here) return [];
  const market = readMarketLocations(t.journal?.market);
  const path = new Set(locationPath(market, here).map((l) => l.id));
  const within = (id?: string | null) => !!id && (path.has(id) || locationPath(market, id).some((l) => l.id === here));
  return questsOf(t)
    .filter((q) => q.status === "active" && !q.archived && (viewer.role === "dm" || revealed(q)))
    .filter((q) => {
      if (q.objectives.some((o) => o.state === "open" && !o.hidden && within(o.locationId))) return true;
      if (q.locationIds.some((id) => within(id))) return true;
      const giver = t.journal?.world?.npcs.find((n) => n.id === q.giverNpcId);
      return !!giver && within(giver.locationId);
    })
    .sort(questOrder);
}
export function npcQuests(t: Table, npcId: string, viewer: Viewer): Quest[] {
  return questsOf(t)
    .filter((q) => q.giverNpcId === npcId && !q.archived && (viewer.role === "dm" || revealed(q)))
    .sort(questOrder);
}
/** "Show on map": the first open objective's place, the quest's place, or its giver. */
export function questMapRecord(t: Table, q: Quest): string | undefined {
  const objective = q.objectives.find((o) => o.state === "open" && !o.hidden && o.locationId);
  if (objective?.locationId) return `location:${objective.locationId}`;
  if (q.locationIds[0]) return `location:${q.locationIds[0]}`;
  if (q.giverNpcId && t.journal?.world?.npcs.some((n) => n.id === q.giverNpcId)) return `npc:${q.giverNpcId}`;
  return undefined;
}

// --- Follow and Updated: per device, per campaign and seat (owner decision D4) ---

type DeviceState = { follow?: string; seen: Record<string, number> };
const memory = new Map<string, DeviceState>();
export function questStateKey(viewer: Viewer, campaign = activeCampaignId()) {
  return `quire.quests.v1.${campaign}.${viewer.role}.${[...viewer.purseIds].sort().join(",")}`;
}
export function readQuestState(key: string): DeviceState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DeviceState>;
      const state: DeviceState = {
        ...(typeof parsed.follow === "string" ? { follow: parsed.follow } : {}),
        seen:
          parsed.seen && typeof parsed.seen === "object"
            ? Object.fromEntries(Object.entries(parsed.seen).filter(([, v]) => typeof v === "number"))
            : {},
      };
      memory.set(key, state);
      return state;
    }
  } catch {
    // Storage may be blocked (private window); the in-memory copy still works this visit.
  }
  return memory.get(key) ?? { seen: {} };
}
export function writeQuestState(key: string, state: DeviceState) {
  memory.set(key, state);
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Kept in memory for this visit.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("quire-quest-state"));
}
/** True when players can see a change this device has not opened yet. */
export function questUpdated(state: DeviceState, q: Quest) {
  const seen = state.seen[q.id];
  return seen === undefined ? true : q.updatedAt > seen;
}
/** What changed most recently, for the "Quest updated" toast. */
export function latestChange(q: Quest) {
  const line = [...q.log].reverse().find((l) => l.shared);
  return line?.text ?? "New quest";
}

/** The seat's character a private quest note is written as: one in the quest's audience. */
export function noteOwner(q: Pick<Quest, "audience">, purseIds: string[], purses: { id: string; kind: string }[]) {
  const mine = purseIds.filter((id) => purses.some((p) => p.id === id && p.kind === "character"));
  if (q.audience.kind === "characters") {
    const listed = q.audience.purseIds;
    return mine.find((id) => listed.includes(id));
  }
  return mine[0];
}

/**
 * "Quest updated" toasts: which quests changed since the last table this seat saw. The first table
 * only primes (no toast on opening the app); a quest that becomes visible later is new and toasts
 * once, as does a newer player-visible change. Archived quests never toast.
 */
export function questChanges(previous: ReadonlyMap<string, number> | null, quests: Quest[]) {
  const next = new Map(quests.map((q) => [q.id, q.updatedAt]));
  if (!previous) return { next, changed: [] as { quest: Quest; isNew: boolean }[] };
  const changed = quests.flatMap((quest) => {
    const before = previous.get(quest.id);
    if (quest.archived || (before !== undefined && quest.updatedAt <= before)) return [];
    return [{ quest, isNew: before === undefined }];
  });
  // Keep quests that left this view (hidden again) so a later re-reveal counts as news only if newer.
  for (const [id, at] of previous) if (!next.has(id)) next.set(id, at);
  return { next, changed };
}
