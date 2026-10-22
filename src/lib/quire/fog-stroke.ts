import type { ScenePoint } from "./tabletop-schema.ts";

/** Brush and polygon points are stored to 4 decimal places (under 1 px on an 8192 px map). */
export const FOG_POINT_PRECISION = 1e4;
/** A saved brush shape holds at most 200 points; longer strokes continue in further shapes. */
export const FOG_SEGMENT_POINTS = 200;
/** One stroke (one undo step) may continue across up to 20 shapes. */
export const FOG_STROKE_SEGMENTS = 20;
export const FOG_STROKE_POINTS = FOG_STROKE_SEGMENTS * (FOG_SEGMENT_POINTS - 1) + 1;

const round = (value: number) =>
  Math.min(1, Math.max(0, Math.round(value * FOG_POINT_PRECISION) / FOG_POINT_PRECISION));
export const roundScenePoint = (p: ScenePoint): ScenePoint => ({ x: round(p.x), y: round(p.y) });

/** Simplification tolerance: a small fraction of the brush radius, at least the rounding step. */
export const strokeTolerance = (radius: number) =>
  Math.min(0.0008, Math.max(0.0001, radius * 0.05));

function distanceToSegment(p: ScenePoint, a: ScenePoint, b: ScenePoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Ramer–Douglas–Peucker (iterative); keeps the first and last point. */
export function simplifyPolyline(points: ScenePoint[], tolerance: number): ScenePoint[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let index = -1,
      farthest = tolerance;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > farthest) {
        farthest = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Rounded, de-duplicated and simplified stroke points. */
export function compactStroke(points: ScenePoint[], radius: number): ScenePoint[] {
  const rounded: ScenePoint[] = [];
  for (const point of points.map(roundScenePoint)) {
    const last = rounded[rounded.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) rounded.push(point);
  }
  return simplifyPolyline(rounded, strokeTolerance(radius));
}

/**
 * Splits a stroke into shapes of at most 200 points. Consecutive segments share their junction
 * point, so round caps and joins cover exactly what one unbroken stroke would.
 */
export function splitStroke(points: ScenePoint[]): ScenePoint[][] {
  if (points.length <= FOG_SEGMENT_POINTS) return [points];
  const segments: ScenePoint[][] = [];
  for (let start = 0; start < points.length - 1; start += FOG_SEGMENT_POINTS - 1)
    segments.push(points.slice(start, start + FOG_SEGMENT_POINTS));
  return segments;
}

export type StrokeDraft = { points: ScenePoint[]; frozen: number };
const settle = (stroke: StrokeDraft, radius: number): StrokeDraft => {
  const points = [
    ...stroke.points.slice(0, stroke.frozen),
    ...compactStroke(stroke.points.slice(stroke.frozen), radius),
  ];
  return { points, frozen: Math.max(0, points.length - 1) };
};

/**
 * Adds a pointer sample to a stroke in progress. The settled prefix (`frozen`) is simplified once
 * and never again, so long strokes stay small without drifting. Returns `full` (and the stroke
 * unchanged) when it has reached its maximum length.
 */
export function extendStroke(
  stroke: StrokeDraft,
  point: ScenePoint,
  radius: number,
): StrokeDraft & { full: boolean } {
  let next: StrokeDraft = { points: [...stroke.points, point], frozen: stroke.frozen };
  if (next.points.length - next.frozen > 400 || next.points.length > FOG_STROKE_POINTS)
    next = settle(next, radius);
  if (next.points.length > FOG_STROKE_POINTS) return { ...stroke, full: true };
  return { ...next, full: false };
}

/** The saved shapes' points for a finished stroke: rounded, simplified and split. */
export const finishStroke = (stroke: StrokeDraft, radius: number) =>
  splitStroke(settle(stroke, radius).points);
