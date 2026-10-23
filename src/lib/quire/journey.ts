/**
 * Journey planner route maths (docs/MAP-TILES.md "Journey planner"). Pure helpers shared by the
 * route planner, the voyage form, the downtime quote and the authoritative commands, so every
 * path measures a route the same way. Distances are whole tenths of a mile ("deci-miles") and
 * durations whole minutes; nothing here moves money, time or the party.
 */
import { canonicalJson } from "./canonical-json.ts";
import { diagonalTiles } from "./tabletop-geometry.ts";
import { tileAt, tilePoint } from "./map-tiles.ts";
import type { CampaignMap, MapGrid, MapScale } from "./world-schema.ts";

export type RoutePoint = { x: number; y: number };
/** How a map measures distance: its grid when it has one, otherwise its scale bar. */
export type RouteFrame = { kind: "grid"; grid: MapGrid } | { kind: "scale"; scale: MapScale };

const FEET_PER_MILE = 5280;
const KM_PER_MILE = 1.609344;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function routeFrame(map: Pick<CampaignMap, "grid" | "scale">): RouteFrame | undefined {
  if (map.grid) return { kind: "grid", grid: map.grid };
  if (map.scale) return { kind: "scale", scale: map.scale };
  return undefined;
}
/** Canonical identity of a map's measuring frame; a journey freezes it when it is reviewed. */
export function frameFingerprint(frame: RouteFrame) {
  return canonicalJson(frame);
}
export function toMiles(value: number, unit: MapScale["unit"]) {
  return unit === "mi" ? value : unit === "km" ? value / KM_PER_MILE : value / FEET_PER_MILE;
}
/** The scale bar's own length in true-proportion normalized units (image height = 1). */
function scaleSpan(scale: MapScale) {
  return Math.hypot((scale.b.x - scale.a.x) * scale.aspect, scale.b.y - scale.a.y);
}
/** Distance between two normalized points in the scale bar's unit, using the image's proportions. */
export function scaleDistance(scale: MapScale, p: RoutePoint, q: RoutePoint) {
  return (Math.hypot((q.x - p.x) * scale.aspect, q.y - p.y) / scaleSpan(scale)) * scale.distance;
}
/** Percent of the map's width that one unit covers (shown while calibrating). */
export function scaleWidthPercent(scale: MapScale) {
  return (scaleSpan(scale) / scale.aspect / scale.distance) * 100;
}
/** A whole number of deci-miles from miles (half up, never negative). */
export function deciMiles(miles: number) {
  return Math.max(0, Math.round(miles * 10 + 1e-9));
}
/**
 * Each leg's length in deci-miles. On a grid, points are measured tile to tile with the map's
 * diagonal rule (the alternating count carries across waypoints, as `routeLegs` does for voyages);
 * a point outside the grid is refused. On a scale bar, legs are straight lines.
 */
export function legDeciMiles(frame: RouteFrame, points: readonly RoutePoint[]): number[] {
  if (frame.kind === "scale")
    return points
      .slice(1)
      .map((p, i) => deciMiles(toMiles(scaleDistance(frame.scale, points[i], p), frame.scale.unit)));
  const tiles = points.map((p) => {
    const tile = tileAt(frame.grid, p);
    if (!tile) throw Error("Every waypoint must be inside the map's grid.");
    return tile;
  });
  let carry = 0;
  return tiles.slice(1).map((tile, i) => {
    const leg = diagonalTiles(
      tile.column - tiles[i].column,
      tile.row - tiles[i].row,
      frame.grid.diagonal ?? "equal",
      carry,
    );
    carry = leg.carry;
    return deciMiles((leg.tiles * frame.grid.feetPerTile) / FEET_PER_MILE);
  });
}
/** Ordinary travel day length used for forced-march extra hours. */
export const TRAVEL_HOURS_PER_DAY = 8;
/**
 * Whole minutes to travel `totalDeciMiles` at `milesPerDay`, with optional forced-march hours
 * (each extra hour adds an eighth of a day's miles). 61.1 mi at 24 mi/day = 3,666 min.
 */
export function journeyDurationMinutes(
  totalDeciMiles: number,
  milesPerDay: number,
  forcedMarchHours = 0,
) {
  if (!Number.isSafeInteger(totalDeciMiles) || totalDeciMiles < 0)
    throw Error("Route distance is invalid.");
  if (!Number.isInteger(milesPerDay) || milesPerDay < 1 || milesPerDay > 200)
    throw Error("Pace must be 1–200 miles a day.");
  if (!Number.isInteger(forcedMarchHours) || forcedMarchHours < 0 || forcedMarchHours > 8)
    throw Error("Forced march is 0–8 extra hours a day.");
  // minutes = deci / 10 / (mpd × (8 + extra) / 8) × 1440, in integers.
  const numerator = totalDeciMiles * 144 * TRAVEL_HOURS_PER_DAY,
    denominator = milesPerDay * (TRAVEL_HOURS_PER_DAY + forcedMarchHours);
  return Math.ceil(numerator / denominator);
}
/** Whole downtime days needed for a duration in minutes. */
export const downtimeDays = (minutes: number) => Math.max(1, Math.ceil(minutes / 1440));
/**
 * The point at `progress` (0–1) along a route, measured by leg length. Zero-length legs are
 * skipped; progress 1 is the last point.
 */
export function routePointAt(
  points: readonly RoutePoint[],
  legs: readonly number[],
  progress: number,
): RoutePoint {
  const total = legs.reduce((sum, leg) => sum + leg, 0);
  if (!total) return { ...points.at(-1)! };
  let remaining = total * clamp01(progress);
  for (let i = 0; i < legs.length; i++) {
    const length = legs[i];
    if (remaining <= length && length > 0) {
      const a = points[i],
        b = points[i + 1],
        f = remaining / length;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= length;
  }
  return { ...points.at(-1)! };
}
/** Index of the leg in progress at `progress` (the last leg at 1). */
export function legIndexAt(legs: readonly number[], progress: number) {
  const total = legs.reduce((sum, leg) => sum + leg, 0);
  if (!total || legs.length === 0) return Math.max(0, legs.length - 1);
  let remaining = total * clamp01(progress);
  for (let i = 0; i < legs.length; i++) {
    if (legs[i] > 0 && remaining < legs[i]) return i;
    remaining -= legs[i];
  }
  return legs.length - 1;
}
/** The map's anchored places within this radius (fraction of the image height) snap a tap. */
export const SNAP_RADIUS = 0.035;
/**
 * Snap a tapped point: to the nearest anchored place within `radius` (aspect-aware), otherwise
 * to a tile centre on a gridded map, otherwise unchanged. Returns the place's location ID when
 * it snapped to one. Points are kept inside the image.
 */
export function snapRoutePoint(
  map: Pick<CampaignMap, "grid" | "anchors">,
  point: RoutePoint,
  options: { aspect?: number; radius?: number } = {},
): RoutePoint & { locationId?: string } {
  const aspect = options.aspect ?? 1,
    radius = options.radius ?? SNAP_RADIUS;
  const p = { x: clamp01(point.x), y: clamp01(point.y) };
  let best: { x: number; y: number; locationId: string } | undefined,
    bestDistance = radius;
  for (const anchor of map.anchors) {
    const distance = Math.hypot((anchor.x - p.x) * aspect, anchor.y - p.y);
    if (distance <= bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  if (map.grid) {
    const tile = tileAt(map.grid, best ?? p);
    if (!tile) return p;
    return { ...tilePoint(map.grid, tile), ...(best ? { locationId: best.locationId } : {}) };
  }
  return best ? { x: best.x, y: best.y, locationId: best.locationId } : p;
}
/** Typed tile list "column,row; column,row" (1-based) → zero-based tiles inside the grid. */
export function parseTileList(input: string, grid: Pick<MapGrid, "columns" | "rows">) {
  const text = input.trim();
  if (!text) return [];
  return text.split(";").map((part) => {
    if (!/^\s*\d+\s*,\s*\d+\s*$/.test(part)) throw Error("Enter waypoints as column,row; column,row.");
    const [column, row] = part.split(",").map(Number);
    if (column < 1 || column > grid.columns || row < 1 || row > grid.rows)
      throw Error("A waypoint is outside the grid.");
    return { column: column - 1, row: row - 1 };
  });
}
/** Zero-based tiles → the typed "column,row; column,row" form (1-based). */
export function formatTileList(tiles: readonly { column: number; row: number }[]) {
  return tiles.map((t) => `${t.column + 1},${t.row + 1}`).join("; ");
}
/** Format deci-miles as miles with one decimal ("16.8 mi"). */
export function formatMiles(deci: number) {
  return `${(deci / 10).toFixed(1)} mi`;
}
/** Days at a pace, two decimals ("0.70 d"), for the leg list. */
export function legDays(deci: number, milesPerDay: number) {
  return deci / 10 / milesPerDay;
}
/**
 * Which travel days (1-based, counted from departure) a leg falls on, for the leg list
 * ("Days 1–2 of the journey"). Uses whole-day boundaries of the route's own duration.
 */
export function legDayRange(legs: readonly number[], index: number, milesPerDay: number) {
  const before = legs.slice(0, index).reduce((s, l) => s + l, 0);
  const startDay = Math.floor(before / 10 / milesPerDay) + 1;
  const endDistance = before + legs[index];
  const endDay = Math.max(startDay, Math.ceil(endDistance / 10 / milesPerDay - 1e-9));
  return { startDay, endDay };
}
/**
 * Day-by-day plan of a stretch of a frozen journey (the review's "Day 41 … Day 43" rows): for
 * each downtime day between `fromMinutes` and `toMinutes`, the deci-miles covered, the legs it
 * touches and, on the last day, the arrival minute of the day.
 */
export function journeyDayPlan(
  legs: readonly number[],
  durationMinutes: number,
  fromMinutes: number,
  toMinutes: number,
  firstDay: number,
) {
  const total = legs.reduce((s, l) => s + l, 0);
  const days: { day: number; deci: number; legs: number[]; arrivalMinute?: number }[] = [];
  for (let start = fromMinutes, day = firstDay; start < toMinutes; start += 1440, day++) {
    const end = Math.min(toMinutes, start + 1440);
    const a = start / durationMinutes,
      b = end / durationMinutes;
    const first = legIndexAt(legs, a),
      last = legIndexAt(legs, Math.max(a, b - 1e-9));
    days.push({
      day,
      deci: Math.round(total * (b - a)),
      legs: Array.from({ length: last - first + 1 }, (_, i) => first + i),
      ...(end === durationMinutes ? { arrivalMinute: end - start } : {}),
    });
  }
  return days;
}
/** "about 1 pm" for a minute of the day. */
export function aboutTime(minute: number) {
  const hour = Math.round(minute / 60) % 24;
  return hour === 0 ? "about midnight" : hour === 12 ? "about noon" : `about ${hour % 12} ${hour < 12 ? "am" : "pm"}`;
}
