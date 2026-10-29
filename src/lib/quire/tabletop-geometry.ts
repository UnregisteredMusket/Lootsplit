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
/** A token's position and, from tabletop protocol 12, its size and anchor (tabletop-schema.ts). */
export type TokenPlace = {
  column: number;
  row: number;
  offsetX?: number;
  offsetY?: number;
  sizeClass?: TokenSizeClass;
  footprint?: number;
  anchor?: "corner";
};
export const TOKEN_SIZE_CLASSES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export type TokenSizeClass = (typeof TOKEN_SIZE_CLASSES)[number];
/** Squares per side for each size (owner, 2026-10-29): Tiny is a quarter square. */
export const SIZE_SQUARES: Record<TokenSizeClass, number> = {
  tiny: 0.25,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};
export const SIZE_NAMES: Record<TokenSizeClass, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  gargantuan: "Gargantuan",
};
/** Squares per side: the DM's custom squares, else the size, else one square (older tokens). */
export function tokenFootprint(token: Pick<TokenPlace, "sizeClass" | "footprint">): number {
  return token.footprint ?? (token.sizeClass ? SIZE_SQUARES[token.sizeClass] : 1);
}
/**
 * Footprint tokens are stored by their top-left square (`anchor: "corner"`); older tokens keep
 * their centre square. One square or less is the same either way.
 */
const cornered = (token: TokenPlace) => token.anchor === "corner" && tokenFootprint(token) >= 1;
/** The token's centre in fractional grid squares. */
export function tokenCentre(token: TokenPlace) {
  const half = cornered(token) ? tokenFootprint(token) / 2 : 0.5;
  return {
    x: token.column + half + (token.offsetX ?? 0),
    y: token.row + half + (token.offsetY ?? 0),
  };
}
export function sceneTokenPoint(grid: GridGeometry, token: TokenPlace) {
  const centre = tokenCentre(token);
  return {
    x: grid.x + (centre.x / grid.columns) * grid.width,
    y: grid.y + (centre.y / grid.rows) * grid.height,
  };
}
/** The fractional grid point under a normalized scene point (outside the grid is allowed). */
export function gridPoint(grid: GridGeometry, point: ScenePoint) {
  return {
    x: ((point.x - grid.x) / grid.width) * grid.columns,
    y: ((point.y - grid.y) / grid.height) * grid.rows,
  };
}
const tidy = (value: number) => Math.round(value * 1e6) / 1e6 || 0;
/** Side length in squares: a quarter-square (Tiny) footprint is half a square on each side. */
export const footprintSide = (n: number) => (n < 1 ? 0.5 : n);
/** The covered rectangle in fractional squares: left, top and the side length. */
export function tokenBox(token: TokenPlace) {
  const n = footprintSide(tokenFootprint(token)),
    centre = tokenCentre(token);
  return { left: tidy(centre.x - n / 2), top: tidy(centre.y - n / 2), size: n };
}
/** Whether the whole footprint lies inside the grid (older tokens: their centre square). */
export function tokenInsideGrid(grid: Pick<GridGeometry, "columns" | "rows">, token: TokenPlace) {
  if (token.column < 0 || token.row < 0) return false;
  if (!cornered(token)) return token.column < grid.columns && token.row < grid.rows;
  const box = tokenBox(token);
  return (
    box.left >= 0 && box.top >= 0 && box.left + box.size <= grid.columns && box.top + box.size <= grid.rows
  );
}
/** Tiny tokens sit in a quarter of their square. */
const QUADRANT = 0.25;
/** Whether a position is snapped for its footprint: whole squares, or a quadrant for Tiny. */
export function tokenSnapped(token: TokenPlace) {
  const x = token.offsetX ?? 0,
    y = token.offsetY ?? 0;
  if (tokenFootprint(token) < 1) return Math.abs(x) === QUADRANT && Math.abs(y) === QUADRANT;
  return x === 0 && y === 0;
}
/**
 * Where a token lands when dragged with grid mode on (owner, 2026-10-29): the square under the
 * pointer receives the square of the footprint that was grabbed, so a Large token held by its
 * lower-right square keeps that relationship. `grab` is the grabbed point measured in squares from
 * the token's top-left corner. Tiny tokens take the quadrant under the pointer. The footprint is
 * kept inside the grid. Undefined when the pointer is outside the grid. The server never moves a
 * token itself: it refuses positions this function could not have produced (`tokenSnapped`).
 */
export function snapTokenPosition(
  grid: Pick<GridGeometry, "columns" | "rows" | "x" | "y" | "width" | "height">,
  token: Pick<TokenPlace, "sizeClass" | "footprint" | "anchor">,
  point: ScenePoint,
  grab: { x: number; y: number } = { x: 0.5, y: 0.5 },
): TokenPlace | undefined {
  const g = gridPoint(grid as GridGeometry, point);
  if (g.x < 0 || g.y < 0 || g.x >= grid.columns || g.y >= grid.rows) return;
  const n = tokenFootprint(token);
  if (n < 1) {
    const column = Math.floor(g.x),
      row = Math.floor(g.y);
    return {
      column,
      row,
      offsetX: g.x - column < 0.5 ? -QUADRANT : QUADRANT,
      offsetY: g.y - row < 0.5 ? -QUADRANT : QUADRANT,
    };
  }
  const size = Math.min(n, grid.columns, grid.rows),
    clampTo = (value: number, max: number) => Math.max(0, Math.min(max, value)),
    gx = clampTo(Math.floor(grab.x), size - 1),
    gy = clampTo(Math.floor(grab.y), size - 1);
  return {
    column: clampTo(Math.floor(g.x) - gx, grid.columns - n),
    row: clampTo(Math.floor(g.y) - gy, grid.rows - n),
  };
}
/**
 * Where a token lands with grid mode off: exactly under the pointer (keeping the grabbed point),
 * inside the grid. Positions are a square plus an offset of at most half a square.
 */
export function freeTokenPosition(
  grid: Pick<GridGeometry, "columns" | "rows" | "x" | "y" | "width" | "height">,
  token: Pick<TokenPlace, "sizeClass" | "footprint" | "anchor">,
  point: ScenePoint,
  grab: { x: number; y: number } = { x: 0.5, y: 0.5 },
): TokenPlace | undefined {
  const g = gridPoint(grid as GridGeometry, point);
  if (g.x < 0 || g.y < 0 || g.x >= grid.columns || g.y >= grid.rows) return;
  const n = footprintSide(tokenFootprint(token)),
    span = Math.min(n, grid.columns, grid.rows),
    left = Math.max(0, Math.min(grid.columns - span, g.x - grab.x)),
    top = Math.max(0, Math.min(grid.rows - span, g.y - grab.y));
  return placeFromBox({ ...token, column: 0, row: 0 }, left, top);
}
/** The stored position whose covered rectangle starts at (left, top) in fractional squares. */
export function placeFromBox(token: TokenPlace, left: number, top: number): TokenPlace {
  const n = footprintSide(tokenFootprint(token));
  if (cornered(token)) {
    const column = Math.round(left),
      row = Math.round(top);
    return { column, row, offsetX: tidy(left - column), offsetY: tidy(top - row) };
  }
  const cx = left + n / 2,
    cy = top + n / 2,
    column = Math.floor(cx),
    row = Math.floor(cy);
  return { column, row, offsetX: tidy(cx - column - 0.5), offsetY: tidy(cy - row - 0.5) };
}
/** The token moved by (dx, dy) squares, keeping its anchor form. */
export function shiftToken(token: TokenPlace, dx: number, dy: number): TokenPlace {
  const box = tokenBox(token);
  return placeFromBox(token, box.left + dx, box.top + dy);
}
/** A one-based square range for people: "col 19–20, row 9–10" (one square: "col 19, row 9"). */
export function footprintLabel(token: TokenPlace) {
  const box = tokenBox(token),
    n = Math.max(1, Math.round(box.size)),
    c = Math.floor(box.left + 1e-9) + 1,
    r = Math.floor(box.top + 1e-9) + 1,
    range = (a: number) => (n > 1 ? `${a}–${a + n - 1}` : `${a}`);
  return `col ${range(c)}, row ${range(r)}`;
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
/** Whole squares covered by tokens ("column,row"); a Tiny token's square counts as covered. */
export function occupiedSquares(tokens: readonly TokenPlace[]) {
  const taken = new Set<string>();
  for (const token of tokens) {
    const box = tokenBox(token),
      left = Math.floor(box.left + 1e-9),
      top = Math.floor(box.top + 1e-9),
      n = Math.max(1, Math.ceil(box.size - 1e-9));
    for (let c = left; c < left + n; c++) for (let r = top; r < top + n; r++) taken.add(`${c},${r}`);
  }
  return taken;
}
/** The first top-left square (row by row) where an n×n footprint fits on free squares. */
export function firstFreeSquare(
  grid: Pick<GridGeometry, "columns" | "rows">,
  taken: ReadonlySet<string>,
  footprint = 1,
) {
  const n = Math.max(1, Math.ceil(footprint));
  for (let row = 0; row + n <= grid.rows; row++)
    for (let column = 0; column + n <= grid.columns; column++) {
      let free = true;
      for (let c = column; c < column + n && free; c++)
        for (let r = row; r < row + n && free; r++) if (taken.has(`${c},${r}`)) free = false;
      if (free) return { column, row };
    }
}
/** Size fields for a new token of this size: corner-anchored, Tiny in its top-left quadrant. */
export function sizedToken(size: TokenSizeClass | undefined): Partial<TokenPlace> {
  if (!size || size === "medium") return {};
  if (size === "tiny") return { sizeClass: size, offsetX: -0.25, offsetY: -0.25 };
  return { sizeClass: size, anchor: "corner" };
}
/**
 * Turning grid mode on, option (a) (owner, 2026-10-29): the nearest snapped position, which is at
 * most half a square away, with the footprint kept inside the grid. Tiny tokens take the nearest
 * quadrant of the square their centre is in.
 */
export function nearestSnapped(grid: Pick<GridGeometry, "columns" | "rows">, token: TokenPlace): TokenPlace {
  const n = tokenFootprint(token),
    clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  if (n < 1) {
    const centre = tokenCentre(token),
      column = clamp(Math.floor(centre.x), grid.columns - 1),
      row = clamp(Math.floor(centre.y), grid.rows - 1);
    return {
      column,
      row,
      offsetX: centre.x - column < 0.5 ? -QUADRANT : QUADRANT,
      offsetY: centre.y - row < 0.5 ? -QUADRANT : QUADRANT,
    };
  }
  const box = tokenBox(token),
    side = Math.max(1, Math.round(box.size));
  return {
    column: clamp(Math.round(box.left), grid.columns - side),
    row: clamp(Math.round(box.top), grid.rows - side),
  };
}
/**
 * Turning grid mode on, option (b): the grid shifted (by the circular mean of the tokens'
 * sub-square offsets) so most tokens sit inside squares, with every token re-expressed at exactly
 * the same place on the image. A column or row is dropped only when the shifted grid would leave
 * the image. Undefined when no shift keeps every token inside the grid.
 */
export function alignedGrid<G extends GridGeometry, T extends TokenPlace>(
  grid: G,
  tokens: readonly T[],
): { grid: G; tokens: T[] } | undefined {
  const sized = tokens.filter((t) => tokenFootprint(t) >= 1);
  if (!sized.length) return;
  const mean = (values: number[]) => {
    const angle = Math.atan2(
      values.reduce((s, v) => s + Math.sin(2 * Math.PI * v), 0),
      values.reduce((s, v) => s + Math.cos(2 * Math.PI * v), 0),
    );
    const turn = angle / (2 * Math.PI);
    return turn > 0.5 ? turn - 1 : turn <= -0.5 ? turn + 1 : turn;
  };
  const frac = (v: number) => v - Math.floor(v);
  const sx = mean(sized.map((t) => frac(tokenBox(t).left))),
    sy = mean(sized.map((t) => frac(tokenBox(t).top)));
  const cw = grid.width / grid.columns,
    ch = grid.height / grid.rows;
  const fit = (start: number, span: number, count: number, cell: number, shift: number) => {
    for (const s of [shift, shift - 1, shift + 1])
      for (const drop of [0, 1]) {
        const at = start + s * cell,
          length = (count - drop) * cell;
        if (count - drop >= 1 && at >= -1e-9 && at + length <= 1 + 1e-9)
          return { at: Math.max(0, at), length: Math.min(length, 1 - Math.max(0, at)), count: count - drop, s };
      }
  };
  const x = fit(grid.x, grid.width, grid.columns, cw, sx),
    y = fit(grid.y, grid.height, grid.rows, ch, sy);
  if (!x || !y) return;
  const next = { ...grid, x: x.at, width: x.length, columns: x.count, y: y.at, height: y.length, rows: y.count };
  const moved = tokens.map((t) => {
    const box = tokenBox(t),
      exact = (v: number) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);
    const place = placeFromBox(t, exact(box.left - x.s), exact(box.top - y.s));
    const result = { ...t, column: place.column, row: place.row } as T;
    delete result.offsetX;
    delete result.offsetY;
    if (place.offsetX) result.offsetX = place.offsetX;
    if (place.offsetY) result.offsetY = place.offsetY;
    return result;
  });
  if (moved.some((t) => !tokenInsideGrid(next, t))) return;
  return { grid: next, tokens: moved };
}
/**
 * An automatic grid for an ungridded map (owner, 2026-10-29): squares of the scale bar's 5 ft when
 * the map has one, else about 40 image pixels, covering the image. `aspect` is width ÷ height.
 */
export function automaticGrid(
  image: { width: number; height: number },
  scale?: { a: ScenePoint; b: ScenePoint; distance: number; unit: string; aspect: number },
) {
  const aspect = image.width / Math.max(1, image.height);
  let columns = Math.round(image.width / 40);
  if (scale && scale.unit === "ft") {
    const across = Math.hypot((scale.b.x - scale.a.x) * scale.aspect, scale.b.y - scale.a.y) / scale.aspect;
    const feet = scale.distance / Math.max(1e-6, across);
    if (feet / 5 >= 4 && feet / 5 <= 200) columns = Math.round(feet / 5);
  } // A regional scale (miles, km) keeps the pixel-based squares.
  columns = Math.max(4, Math.min(200, columns));
  const rows = Math.max(1, Math.min(200, Math.floor(columns / aspect + 1e-6)));
  return {
    columns,
    rows,
    feetPerTile: 5,
    diagonal: "equal" as const,
    x: 0,
    y: 0,
    width: 1,
    height: Math.min(1, (rows / columns) * aspect),
  };
}
