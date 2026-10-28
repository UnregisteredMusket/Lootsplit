/**
 * Quest log presentation (docs/QUESTS.md): lists, tabs, labels, "here" and the per-device Follow
 * and Updated state. Pure helpers over the table this seat already has (a player's table is the
 * projection, so nothing here can reveal more than the server sent).
 */
import type { CloudTable } from "./cloud.ts";
import { questsOf } from "./quests.ts";
import type { Quest, QuestDraft } from "./quests-schema.ts";
import type { CampaignMap } from "./world-schema.ts";
import { anchorFor } from "./world.ts";
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
/**
 * "Show on map": the map's Quests panel on this quest when it has a pin or area on a map this
 * seat has; otherwise the first open objective's place, the quest's place or its giver.
 */
export function questMapHref(t: Table, q: Quest, viewer: Viewer): string | undefined {
  const maps = t.journal?.world?.maps ?? [];
  if (maps.some((m) => questsOnMap(t, m, viewer).some((i) => i.quest.id === q.id)))
    return `/maps?quest=${encodeURIComponent(q.id)}`;
  const record = questMapRecord(t, q);
  return record ? `/maps?record=${encodeURIComponent(record)}` : undefined;
}
/** The record "Show on map" falls back to: an open objective's place, the quest's place, or its giver. */
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

/** The editable body of a stored quest (what `quest-save` takes back). */
export function questDraft(q: Quest): QuestDraft {
  return {
    title: q.title,
    ...(q.main ? { main: true } : {}),
    summary: q.summary,
    ...(q.giverNpcId ? { giverNpcId: q.giverNpcId } : {}),
    locationIds: q.locationIds,
    markers: q.markers.map((m) => ({ mapId: m.mapId, markerId: m.markerId })),
    areas: q.areas.map((a) => ({ id: a.id, mapId: a.mapId, x: a.x, y: a.y, r: a.r, ...(a.label ? { label: a.label } : {}), ...(a.objectiveId ? { objectiveId: a.objectiveId } : {}) })),
    objectives: q.objectives.map((o) => ({
      id: o.id,
      text: o.text,
      ...(o.hidden ? { hidden: true } : {}),
      ...(o.optional ? { optional: true } : {}),
      ...(o.locationId ? { locationId: o.locationId } : {}),
      ...(o.marker ? { marker: { mapId: o.marker.mapId, markerId: o.marker.markerId } } : {}),
    })),
    ...(q.rewardText ? { rewardText: q.rewardText } : {}),
    ...(q.dmNotes ? { dmNotes: q.dmNotes } : {}),
  };
}


// --- On the map (docs/QUESTS.md "Map") ---

export type QuestMapPin = { key: string; questId: string; x: number; y: number; label: string };
export type QuestMapArea = { key: string; questId: string; areaId: string; x: number; y: number; r: number; label?: string };
export type QuestOnMap = { quest: Quest; pins: QuestMapPin[]; areas: QuestMapArea[]; openObjectives: Quest["objectives"] };

/** Where a map pin sits on this map: a marker, a record placement, or nothing. */
export function mapPinPoint(map: CampaignMap, markerId: string) {
  const marker = map.markers.find((m) => m.id === markerId);
  if (marker) return { x: marker.x, y: marker.y, label: marker.label };
  const placement = map.connected?.placements.find((p) => p.id === markerId);
  return placement ? { x: placement.x, y: placement.y, label: placement.label ?? "" } : undefined;
}
/** Every existing pin on a map the DM can link a quest or objective to. */
export function linkableMapPins(t: Table, map: CampaignMap) {
  const market = readMarketLocations(t.journal?.market);
  const recordName = (kind: string, id: string) =>
    kind === "location"
      ? market.locations.find((l) => l.id === id)?.name
      : kind === "npc"
        ? t.journal?.world?.npcs.find((n) => n.id === id)?.name
        : t.purses.find((p) => p.id === id)?.name;
  return [
    ...map.markers.map((m) => ({ mapId: map.id, markerId: m.id, label: m.label || "Marker" })),
    ...(map.connected?.placements ?? []).map((p) => ({
      mapId: map.id,
      markerId: p.id,
      label: p.label ?? recordName(p.record.kind, p.record.id) ?? `${p.record.kind[0]!.toUpperCase()}${p.record.kind.slice(1)}`,
    })),
  ];
}
/**
 * What each quest shows on this map, from the table this seat already has (for players, the
 * projection: hidden objectives, their pins and areas never arrive). Pins: linked map pins, and
 * linked places drawn where the map places that location (its pin or anchor). Areas: radius markers.
 * Only active, unarchived quests (and drafts for the DM).
 */
export function questsOnMap(t: Table, map: CampaignMap, viewer: Viewer): QuestOnMap[] {
  const placeOf = (locationId: string) => {
    const placed = map.connected?.placements.find((p) => p.record.kind === "location" && p.record.id === locationId);
    if (placed) return { x: placed.x, y: placed.y };
    return anchorFor(map, t, locationId);
  };
  return questsOf(t)
    .filter((q) => q.status === "active" && !q.archived && (viewer.role === "dm" || revealed(q)))
    .sort(questOrder)
    .flatMap((quest) => {
      const pins: QuestMapPin[] = [];
      const seen = new Set<string>();
      const add = (key: string, point: { x: number; y: number } | undefined, label: string) => {
        if (!point) return;
        const at = `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
        if (seen.has(at)) return;
        seen.add(at);
        pins.push({ key: `${quest.id}:${key}`, questId: quest.id, x: point.x, y: point.y, label });
      };
      for (const m of quest.markers) if (m.mapId === map.id) add(`m:${m.markerId}`, mapPinPoint(map, m.markerId), quest.title);
      for (const o of quest.objectives) {
        if (o.state !== "open" || o.hidden) continue;
        if (o.marker?.mapId === map.id) add(`om:${o.id}`, mapPinPoint(map, o.marker.markerId), o.text);
        if (o.locationId) add(`ol:${o.id}`, placeOf(o.locationId), o.text);
      }
      for (const id of quest.locationIds) add(`l:${id}`, placeOf(id), quest.title);
      const areas = quest.areas
        .filter((a) => a.mapId === map.id)
        .filter((a) => {
          const o = a.objectiveId ? quest.objectives.find((x) => x.id === a.objectiveId) : undefined;
          return !a.objectiveId || (!!o && o.state === "open" && (viewer.role === "dm" || !o.hidden));
        })
        .map((a) => ({ key: `${quest.id}:a:${a.id}`, questId: quest.id, areaId: a.id, x: a.x, y: a.y, r: a.r, ...(a.label ? { label: a.label } : {}) }));
      if (!pins.length && !areas.length) return [];
      return [{ quest, pins, areas, openObjectives: quest.objectives.filter((o) => o.state === "open" && (viewer.role === "dm" || !o.hidden)) }];
    });
}

/**
 * A radius in the map's own distance units: a grid wins (feet per tile), then a scale bar.
 * `r` is a fraction of the image width. Undefined when the map has neither.
 */
export function areaRadiusUnits(map: Pick<CampaignMap, "grid" | "scale">, r: number): { value: number; unit: string } | undefined {
  if (map.grid) return { value: (r * map.grid.feetPerTile * map.grid.columns) / map.grid.width, unit: "ft" };
  if (map.scale) {
    const s = map.scale;
    const length = Math.hypot((s.b.x - s.a.x) * s.aspect, s.b.y - s.a.y);
    if (length > 0) return { value: (r * s.aspect * s.distance) / length, unit: s.unit };
  }
  return undefined;
}
/** The inverse of `areaRadiusUnits`: a radius typed in map units back to a fraction of the width. */
export function areaRadiusFromUnits(map: Pick<CampaignMap, "grid" | "scale">, value: number): number | undefined {
  const one = areaRadiusUnits(map, 1);
  if (!one || !(one.value > 0) || !(value > 0)) return undefined;
  return Math.min(2, value / one.value);
}
