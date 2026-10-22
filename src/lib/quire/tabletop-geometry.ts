import type {
  FogShape,
  FogState,
  MapTabletop,
  ScenePoint,
  SceneWall,
  AreaTemplate,
} from "./tabletop-schema.ts";

const epsilon = 1e-9;
const cross = (a: ScenePoint, b: ScenePoint, c: ScenePoint) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onSegment(p: ScenePoint, a: ScenePoint, b: ScenePoint) {
  return (
    Math.abs(cross(a, b, p)) <= epsilon &&
    p.x >= Math.min(a.x, b.x) - epsilon &&
    p.x <= Math.max(a.x, b.x) + epsilon &&
    p.y >= Math.min(a.y, b.y) - epsilon &&
    p.y <= Math.max(a.y, b.y) + epsilon
  );
}
export function inPolygon(p: ScenePoint, points: readonly ScenePoint[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    if (onSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
function segmentDistance(p: ScenePoint, a: ScenePoint, b: ScenePoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function inFogShape(p: ScenePoint, shape: FogShape) {
  if (shape.kind === "polygon") return inPolygon(p, shape.points);
  if (shape.kind === "brush")
    return shape.points.some(
      (a, i) => segmentDistance(p, a, shape.points[Math.max(0, i - 1)]) <= shape.radius + epsilon,
    );
  const left = Math.min(shape.a.x, shape.b.x),
    right = Math.max(shape.a.x, shape.b.x),
    top = Math.min(shape.a.y, shape.b.y),
    bottom = Math.max(shape.a.y, shape.b.y);
  if (shape.kind === "rectangle")
    return (
      p.x >= left - epsilon &&
      p.x <= right + epsilon &&
      p.y >= top - epsilon &&
      p.y <= bottom + epsilon
    );
  const rx = (right - left) / 2,
    ry = (bottom - top) / 2;
  return (
    rx > 0 && ry > 0 && ((p.x - left - rx) / rx) ** 2 + ((p.y - top - ry) / ry) ** 2 <= 1 + epsilon
  );
}
export function manuallyVisible(p: ScenePoint, fog: FogState) {
  if (!fog.enabled) return true;
  let visible = fog.base === "revealed";
  for (const shape of fog.shapes) if (inFogShape(p, shape)) visible = shape.reveal;
  return visible;
}
export function crosses(a: ScenePoint, b: ScenePoint, c: ScenePoint, d: ScenePoint) {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
      ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}
export function blocked(
  a: ScenePoint,
  b: ScenePoint,
  walls: readonly SceneWall[],
  movement = false,
) {
  return walls.some(
    (w) => !w.open && (movement ? w.blocksMovement : w.blocksSight) && crosses(a, b, w.a, w.b),
  );
}
export type GridGeometry = {
  columns: number;
  rows: number;
  feetPerTile: number;
  x: number;
  y: number;
  width: number;
  height: number;
  diagonal?: "equal" | "euclidean" | "orthogonal" | "alternating";
};
/** Distances below this are float noise when counting whole diagonal steps. */
const STEP_EPSILON = 1e-9;
/**
 * Grid distance in tiles for a leg of dx by dy tiles. `alternating` (5/10/5) counts every second
 * diagonal step as two tiles; `carry` is the number of diagonal steps already taken on this route
 * so the alternation continues across waypoints. Returns the leg length and the new carry.
 */
export function diagonalTiles(
  dx: number,
  dy: number,
  diagonal: NonNullable<GridGeometry["diagonal"]>,
  carry = 0,
) {
  const x = Math.abs(dx),
    y = Math.abs(dy);
  if (diagonal === "equal") return { tiles: Math.max(x, y), carry };
  if (diagonal === "orthogonal") return { tiles: x + y, carry };
  if (diagonal === "euclidean") return { tiles: Math.hypot(x, y), carry };
  const diagonals = Math.min(x, y),
    whole = (n: number) => Math.floor(n + STEP_EPSILON),
    extra = whole((carry + diagonals) / 2) - whole(carry / 2);
  return { tiles: Math.max(x, y) + extra, carry: carry + diagonals };
}
export function sceneDistance(
  grid: GridGeometry,
  a: ScenePoint,
  b: ScenePoint,
  diagonal = grid.diagonal ?? "euclidean",
) {
  return sceneRouteDistance(grid, [a, b], diagonal);
}
/** Total distance along waypoints; the alternating rule carries its count across waypoints. */
export function sceneRouteDistance(
  grid: GridGeometry,
  points: readonly ScenePoint[],
  diagonal = grid.diagonal ?? "euclidean",
) {
  let carry = 0,
    total = 0;
  for (let i = 1; i < points.length; i++) {
    const leg = diagonalTiles(
      ((points[i].x - points[i - 1].x) * grid.columns) / grid.width,
      ((points[i].y - points[i - 1].y) * grid.rows) / grid.height,
      diagonal,
      carry,
    );
    carry = leg.carry;
    total += leg.tiles;
  }
  return grid.feetPerTile * total;
}
export function sceneTokenPoint(
  grid: GridGeometry,
  token: { column: number; row: number; offsetX?: number; offsetY?: number },
) {
  return {
    x: grid.x + ((token.column + 0.5 + (token.offsetX ?? 0)) / grid.columns) * grid.width,
    y: grid.y + ((token.row + 0.5 + (token.offsetY ?? 0)) / grid.rows) * grid.height,
  };
}
export type VisionSource = { point: ScenePoint; rangeFeet: number; darkvisionFeet: number };
export function scenePointVisible(
  p: ScenePoint,
  settings: MapTabletop,
  grid: GridGeometry | undefined,
  viewers: readonly VisionSource[],
) {
  if (!manuallyVisible(p, settings.fog)) return false;
  if (settings.vision === "off") return true;
  if (!grid) return false;
  return viewers.some((v) => {
    const distance = sceneDistance(grid, v.point, p, "euclidean");
    if (distance > Math.max(v.rangeFeet, v.darkvisionFeet) || blocked(v.point, p, settings.walls))
      return false;
    if (distance <= v.darkvisionFeet) return true;
    return (
      distance <= v.rangeFeet &&
      (settings.ambientLight ||
        settings.lights.some(
          (l) =>
            l.visible &&
            sceneDistance(grid, l.at, p, "euclidean") <= l.radiusFeet &&
            !blocked(l.at, p, settings.walls),
        ))
    );
  });
}
/** Template geometry uses logical grid distances; no damage, targeting or game rules are applied. */
export function inAreaTemplate(p: ScenePoint, template: AreaTemplate, grid: GridGeometry) {
  const dx = (((p.x - template.origin.x) * grid.columns) / grid.width) * grid.feetPerTile;
  const dy = (((p.y - template.origin.y) * grid.rows) / grid.height) * grid.feetPerTile;
  const theta = (template.direction * Math.PI) / 180,
    x = dx * Math.cos(theta) + dy * Math.sin(theta),
    y = -dx * Math.sin(theta) + dy * Math.cos(theta);
  if (template.kind === "circle") return Math.hypot(dx, dy) <= template.distanceFeet + epsilon;
  if (template.kind === "cone")
    return (
      Math.hypot(dx, dy) <= template.distanceFeet + epsilon &&
      Math.abs((Math.atan2(y, x) * 180) / Math.PI) <= template.angle / 2 + epsilon
    );
  if (template.kind === "rectangle")
    return (
      Math.abs(x) <= template.distanceFeet / 2 + epsilon &&
      Math.abs(y) <= template.widthFeet / 2 + epsilon
    );
  return (
    x >= -epsilon &&
    x <= template.distanceFeet + epsilon &&
    Math.abs(y) <= template.widthFeet / 2 + epsilon
  );
}
