/**
 * Journey planner entry points and camera framing (docs/MAP-TILES.md "Journey planner"). Pure
 * helpers shared by the map toolbar, the Here sheet and the Downtime screen: where "Plan journey"
 * links to, and how the map camera frames a route beside or above the planner panel. They read
 * only the table the viewer already has (a player's projected table for players).
 */
import type { CampaignMap } from "./world-schema.ts";

type JourneyJournal = {
  market?: { currentLocationId?: string | null } | null;
  world?: {
    maps?: Pick<CampaignMap, "id" | "anchors" | "grid" | "scale">[];
    partyPosition?: { mapId?: string } | null;
  } | null;
} | null;

/**
 * The map a new party journey starts on: the map the party is placed on, otherwise a map that
 * anchors the party's location (one with a grid or scale bar first, since routes need a scale).
 */
export function journeyPlanMapId(journal: JourneyJournal | undefined): string | undefined {
  const maps = journal?.world?.maps ?? [];
  const placed = journal?.world?.partyPosition?.mapId;
  if (placed && maps.some((m) => m.id === placed)) return placed;
  const location = journal?.market?.currentLocationId;
  if (!location) return undefined;
  const anchoring = maps.filter((m) => m.anchors.some((a) => a.locationId === location));
  return (anchoring.find((m) => m.grid || m.scale) ?? anchoring[0])?.id;
}

/** `/maps?map=<party map>&plan=party`: opens the journey planner from the party's position. */
export function journeyPlanHref(journal: JourneyJournal | undefined): string {
  const mapId = journeyPlanMapId(journal);
  return mapId
    ? `/maps?map=${encodeURIComponent(mapId)}&plan=party`
    : "/maps?plan=party";
}

export type Box = { left: number; top: number; right: number; bottom: number };
export type MapView = { x: number; y: number; scale: number };

/**
 * The part of the map region the planner panel leaves free. A bottom sheet (phones) leaves the
 * band above it; a side panel (desktop, landscape phones) leaves the area to its right.
 * `reserve` keeps clear of the map's own floating controls on each edge.
 */
export function freeArea(
  region: { width: number; height: number },
  panel: Box | undefined,
  reserve: Box,
): Box {
  const all = {
    left: reserve.left,
    top: reserve.top,
    right: region.width - reserve.right,
    bottom: region.height - reserve.bottom,
  };
  if (!panel) return all;
  const sheet = panel.right - panel.left > region.width * 0.6;
  return sheet
    ? { ...all, bottom: Math.min(all.bottom, panel.top - 8) }
    : { ...all, left: Math.max(all.left, panel.right + 8) };
}

/**
 * A camera that shows every point inside `area`: unchanged when they already are, otherwise
 * centred on them and zoomed out only as far as needed (never zoomed in; scale stays 0.5–8).
 * `base` is the drawn map size at scale 1; points are normalized (0–1).
 */
export function frameRoute(
  points: readonly { x: number; y: number }[],
  view: MapView,
  base: { w: number; h: number },
  area: Box,
  margin = 28,
): MapView | undefined {
  if (!points.length || area.right - area.left < 40 || area.bottom - area.top < 40) return undefined;
  const screen = (p: { x: number; y: number }, v: MapView) => ({
    x: v.x + p.x * base.w * v.scale,
    y: v.y + p.y * base.h * v.scale,
  });
  const inside = (v: MapView) =>
    points.every((p) => {
      const s = screen(p, v);
      return (
        s.x >= area.left + margin * 0.5 &&
        s.x <= area.right - margin * 0.5 &&
        s.y >= area.top + margin * 0.5 &&
        s.y <= area.bottom - margin * 0.5
      );
    });
  if (inside(view)) return undefined;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const width = Math.max(1, area.right - area.left - margin * 2),
    height = Math.max(1, area.bottom - area.top - margin * 2);
  const fit = Math.min(
    maxX > minX ? width / ((maxX - minX) * base.w) : Infinity,
    maxY > minY ? height / ((maxY - minY) * base.h) : Infinity,
  );
  const scale = Math.min(8, Math.max(0.5, Math.min(view.scale, fit)));
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2;
  return {
    scale,
    x: (area.left + area.right) / 2 - cx * base.w * scale,
    y: (area.top + area.bottom) / 2 - cy * base.h * scale,
  };
}

/** Fractions (0–1) where each leg ends along a route, for progress-bar ticks (last omitted). */
export function legTicks(legs: readonly number[]): number[] {
  const total = legs.reduce((s, l) => s + l, 0);
  if (!total) return [];
  let run = 0;
  return legs.slice(0, -1).map((l) => (run += l) / total);
}
