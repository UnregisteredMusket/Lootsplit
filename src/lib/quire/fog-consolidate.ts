import type { FogShape, FogState, ScenePoint } from "./tabletop-schema.ts";

/**
 * Consolidate fog: an exact rewrite of a map's fog shapes into fewer shapes.
 *
 * Coverage is never approximated. A point of the map is revealed after consolidation exactly when
 * it was revealed before, by the same rules the server uses (`manuallyVisible`) and by the
 * player-view renderer (non-zero canvas fill). Two steps, each proven safe on its own:
 *
 * 1. **Shapes with no visible effect are removed.** A shape is dropped only when the map area it
 *    covers is proven, cell by cell, to be either painted over by a later shape or already in the
 *    shape's own state (revealed under a reveal, concealed under a conceal). Each proof uses closed
 *    cells and conservative inside/outside tests; a cell that cannot be decided is split, and a
 *    shape whose proof does not finish within its budget is kept.
 * 2. **Rectangles (and rectangular outlines) of the same kind are merged** into one outline per
 *    connected area, using only the coordinates already present, so no new rounding is introduced.
 *    Shapes only move later in the paint order past shapes of the same kind or past opposite shapes
 *    whose bounds they do not touch, so the paint order never changes the result.
 *
 * Brush strokes, ellipses and freehand polygons that still show are kept exactly as they are:
 * turning their curves into polygons would change the covered area. The result is deterministic
 * (same input, same output), so the server recomputes and checks what the DM's device proposed.
 */

type Box = { x0: number; y0: number; x1: number; y1: number };
type Point = ScenePoint;

/** The server's inclusive edge tolerance (`tabletop-geometry.ts`). */
const SLACK = 1e-9;
/** Safety margin added on top of every conservative test. */
const MARGIN = 1e-9;
const MAX_DEPTH = 9;
const MAX_CELLS_PER_SHAPE = 1500;
/** Primitive test budget for one consolidation; deterministic, so client and server agree. */
const WORK_BUDGET = 6_000_000;
/** Largest coordinate grid used to merge rectangles. */
const MAX_MERGE_CELLS = 250_000;

const intersects = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const grow = (b: Box, by: number): Box => ({
  x0: b.x0 - by,
  y0: b.y0 - by,
  x1: b.x1 + by,
  y1: b.y1 + by,
});
const pointsBox = (points: readonly Point[]): Box => {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of points) {
    box.x0 = Math.min(box.x0, p.x);
    box.y0 = Math.min(box.y0, p.y);
    box.x1 = Math.max(box.x1, p.x);
    box.y1 = Math.max(box.y1, p.y);
  }
  return box;
};
const rectBox = (a: Point, b: Point): Box => ({
  x0: Math.min(a.x, b.x),
  y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x),
  y1: Math.max(a.y, b.y),
});

/** Distance from a point to segment ab (a === b allowed). */
function segmentPointDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const pointBoxDistance = (p: Point, c: Box) =>
  Math.hypot(Math.max(c.x0 - p.x, 0, p.x - c.x1), Math.max(c.y0 - p.y, 0, p.y - c.y1));
const inBox = (p: Point, c: Box) => p.x >= c.x0 && p.x <= c.x1 && p.y >= c.y0 && p.y <= c.y1;
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c),
    d2 = o(a, b, d),
    d3 = o(c, d, a),
    d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const corners = (c: Box): Point[] => [
  { x: c.x0, y: c.y0 },
  { x: c.x1, y: c.y0 },
  { x: c.x1, y: c.y1 },
  { x: c.x0, y: c.y1 },
];
/** Distance between segment ab and box c (0 when they touch). Conservative within float error. */
function segmentBoxDistance(a: Point, b: Point, c: Box) {
  if (inBox(a, c) || inBox(b, c)) return 0;
  const box = corners(c);
  for (let i = 0; i < 4; i++) if (segmentsCross(a, b, box[i], box[(i + 1) % 4])) return 0;
  let best = Math.min(pointBoxDistance(a, c), pointBoxDistance(b, c));
  for (const corner of box) best = Math.min(best, segmentPointDistance(corner, a, b));
  return best;
}

/** Even-odd parity (the server's rule) and winding number (the canvas renderer's rule). */
function polygonRules(p: Point, points: readonly Point[]) {
  let odd = false,
    winding = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      odd = !odd;
    if (a.y <= p.y) {
      if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) winding++;
    } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) winding--;
  }
  return { odd, winding };
}
/** How far beyond its edge the server's `onSegment` test can still count a point as inside. */
function edgeSlack(a: Point, b: Point) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return (length ? Math.min(SLACK / length, 2 * length + 2 * SLACK) : 0) + 2 * SLACK;
}

class Prepared {
  readonly box: Box;
  readonly segments: { a: Point; b: Point; box: Box }[] = [];
  readonly slack: number;
  readonly shape: FogShape;
  constructor(shape: FogShape) {
    this.shape = shape;
    if (shape.kind === "rectangle" || shape.kind === "ellipse") {
      this.box = rectBox(shape.a, shape.b);
      this.slack = SLACK + MARGIN;
    } else if (shape.kind === "brush") {
      const r = shape.radius;
      shape.points.forEach((a, i) => {
        const b = shape.points[Math.max(0, i - 1)];
        this.segments.push({ a, b, box: grow(pointsBox([a, b]), r) });
      });
      this.box = grow(pointsBox(shape.points), r);
      this.slack = SLACK + MARGIN;
    } else {
      let slack = 0;
      shape.points.forEach((b, i) => {
        const a = shape.points[(i + shape.points.length - 1) % shape.points.length];
        slack = Math.max(slack, edgeSlack(a, b));
        this.segments.push({ a, b, box: pointsBox([a, b]) });
      });
      this.box = pointsBox(shape.points);
      this.slack = slack + MARGIN;
    }
  }
  /** Bounds of every point the server could count as inside, including its edge tolerance. */
  get reach() {
    return grow(this.box, this.slack);
  }
}

type Budget = { left: number };
/** True only when no point of cell c can be inside shape s (by either fill rule). */
function outside(s: Prepared, c: Box, budget: Budget): boolean {
  budget.left--;
  if (!intersects(s.reach, c)) return true;
  const shape = s.shape;
  if (shape.kind === "rectangle") return false;
  if (shape.kind === "ellipse") {
    const rx = (s.box.x1 - s.box.x0) / 2,
      ry = (s.box.y1 - s.box.y0) / 2;
    if (!(rx > 0 && ry > 0)) return true; // A flat ellipse covers nothing for the server or canvas.
    const cx = s.box.x0 + rx,
      cy = s.box.y0 + ry;
    const u = Math.max((c.x0 - cx) / rx, 0, (cx - c.x1) / rx),
      v = Math.max((c.y0 - cy) / ry, 0, (cy - c.y1) / ry);
    return u * u + v * v > 1 + SLACK + 1e-7;
  }
  if (shape.kind === "brush") {
    const limit = shape.radius + SLACK + MARGIN;
    for (const segment of s.segments) {
      budget.left--;
      if (
        intersects(segment.box, grow(c, SLACK + MARGIN)) &&
        segmentBoxDistance(segment.a, segment.b, c) <= limit
      )
        return false;
    }
    return true;
  }
  for (const segment of s.segments) {
    budget.left--;
    if (segmentBoxDistance(segment.a, segment.b, c) <= edgeSlack(segment.a, segment.b) + MARGIN)
      return false;
  }
  // No edge reaches the cell, so every point of it has the centre's parity and winding.
  const rules = polygonRules({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }, shape.points);
  return !rules.odd && rules.winding === 0;
}
/** True only when every point of cell c is inside shape s (by both fill rules). */
function inside(s: Prepared, c: Box, budget: Budget): boolean {
  budget.left--;
  if (c.x0 < s.box.x0 || c.y0 < s.box.y0 || c.x1 > s.box.x1 || c.y1 > s.box.y1) return false;
  const shape = s.shape;
  if (shape.kind === "rectangle") return true;
  if (shape.kind === "ellipse") {
    const rx = (s.box.x1 - s.box.x0) / 2,
      ry = (s.box.y1 - s.box.y0) / 2;
    if (!(rx > 0 && ry > 0)) return false;
    const cx = s.box.x0 + rx,
      cy = s.box.y0 + ry;
    // The ellipse is convex, so its corners decide.
    return corners(c).every((p) => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1 - 1e-9);
  }
  if (shape.kind === "brush") {
    // One capsule (segment + radius) is convex: the cell is inside it when all corners are.
    const limit = shape.radius - MARGIN,
      box = corners(c);
    for (const segment of s.segments) {
      budget.left--;
      if (
        segment.box.x0 <= c.x0 &&
        segment.box.y0 <= c.y0 &&
        segment.box.x1 >= c.x1 &&
        segment.box.y1 >= c.y1 &&
        box.every((p) => segmentPointDistance(p, segment.a, segment.b) <= limit)
      )
        return true;
    }
    return false;
  }
  for (const segment of s.segments) {
    budget.left--;
    if (segmentBoxDistance(segment.a, segment.b, c) <= MARGIN) return false;
  }
  const rules = polygonRules({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 }, shape.points);
  return rules.odd && rules.winding !== 0;
}

/**
 * Whether removing `list[index]` provably changes no point of the map. `prior` and `later` are the
 * shapes before and after it whose bounds can reach it.
 */
function removable(list: Prepared[], index: number, base: boolean, budget: Budget): boolean {
  const s = list[index],
    reveal = s.shape.reveal,
    reach = s.reach;
  // Closed geometric bounds; the server's 1e-9 edge tolerance applies equally before and after.
  const start: Box = {
    x0: Math.max(0, s.box.x0),
    y0: Math.max(0, s.box.y0),
    x1: Math.min(1, s.box.x1),
    y1: Math.min(1, s.box.y1),
  };
  if (start.x0 > start.x1 || start.y0 > start.y1) return true; // Entirely off the map.
  const prior: Prepared[] = [],
    later: Prepared[] = [];
  for (let i = index - 1; i >= 0; i--) if (intersects(list[i].reach, reach)) prior.push(list[i]);
  for (let i = index + 1; i < list.length; i++)
    if (intersects(list[i].reach, reach)) later.push(list[i]);
  /**
   * Whether every point of c is already in state `reveal` before s. Walking back from the latest
   * earlier shape: a same-state shape settles the points it covers (the rest are checked against
   * older shapes); an opposite-state shape that may touch c fails the proof.
   */
  const alreadyInState = (c: Box) => {
    for (const shape of prior) {
      if (outside(shape, c, budget)) continue;
      if (shape.shape.reveal !== reveal) return false;
      if (inside(shape, c, budget)) return true;
    }
    return base === reveal;
  };
  const stack: [Box, number][] = [[start, 0]];
  let cells = 0;
  while (stack.length) {
    if (budget.left <= 0 || ++cells > MAX_CELLS_PER_SHAPE) return false;
    const [c, depth] = stack.pop()!;
    if (outside(s, c, budget)) continue;
    if (later.some((shape) => inside(shape, c, budget))) continue;
    if (alreadyInState(c)) continue;
    if (depth >= MAX_DEPTH) return false;
    const mx = (c.x0 + c.x1) / 2,
      my = (c.y0 + c.y1) / 2;
    stack.push(
      [{ x0: c.x0, y0: c.y0, x1: mx, y1: my }, depth + 1],
      [{ x0: mx, y0: c.y0, x1: c.x1, y1: my }, depth + 1],
      [{ x0: c.x0, y0: my, x1: mx, y1: c.y1 }, depth + 1],
      [{ x0: mx, y0: my, x1: c.x1, y1: c.y1 }, depth + 1],
    );
  }
  return true;
}

/** Axis-aligned simple outline (a rectangle, or an earlier merged outline). */
function rectilinear(shape: FogShape): Point[] | undefined {
  if (shape.kind === "rectangle") {
    const b = rectBox(shape.a, shape.b);
    if (!(b.x1 > b.x0 && b.y1 > b.y0)) return;
    return corners(b);
  }
  if (shape.kind !== "polygon") return;
  const points = shape.points;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a.x !== b.x && a.y !== b.y) return;
  }
  // Only simple outlines with area merge; anything self-crossing keeps its own fill rule.
  for (let i = 0; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const a = points[i],
        b = points[(i + 1) % points.length],
        c = points[j],
        d = points[(j + 1) % points.length];
      const ab = pointsBox([a, b]),
        cd = pointsBox([c, d]);
      if (intersects(ab, cd)) return;
    }
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area ? points : undefined;
}

function hash(text: string) {
  let a = 0x811c9dc5,
    b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

/**
 * The union of same-kind axis-aligned outlines, as the fewest shapes this exact method finds:
 * one outline for each connected area without holes, rectangles otherwise.
 */
function mergeOutlines(outlines: Point[][]): Point[][] | undefined {
  const xs = [...new Set(outlines.flatMap((o) => o.map((p) => p.x)))].sort((a, b) => a - b),
    ys = [...new Set(outlines.flatMap((o) => o.map((p) => p.y)))].sort((a, b) => a - b);
  const nx = xs.length - 1,
    ny = ys.length - 1;
  if (nx < 1 || ny < 1 || nx * ny > MAX_MERGE_CELLS) return;
  const filled = new Uint8Array(nx * ny);
  for (const outline of outlines) {
    // Scanline parity per row centre; cell centres never lie on an edge.
    for (let j = 0; j < ny; j++) {
      const y = (ys[j] + ys[j + 1]) / 2,
        crossings: number[] = [];
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i],
          b = outline[(i + 1) % outline.length];
        if (a.x === b.x && a.y > y !== b.y > y) crossings.push(a.x);
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        let i = lowerBound(xs, crossings[k]);
        const end = lowerBound(xs, crossings[k + 1]);
        for (; i < end; i++) filled[j * nx + i] = 1;
      }
    }
  }
  const cell = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < ny && filled[j * nx + i] === 1;
  const label = new Int32Array(nx * ny).fill(-1),
    components: number[][] = [];
  for (let start = 0; start < nx * ny; start++) {
    if (!filled[start] || label[start] >= 0) continue;
    const cells: number[] = [],
      queue = [start];
    label[start] = components.length;
    while (queue.length) {
      const index = queue.pop()!,
        i = index % nx,
        j = (index - i) / nx;
      cells.push(index);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di,
          nj = j + dj,
          n = nj * nx + ni;
        if (cell(ni, nj) && label[n] < 0) {
          label[n] = components.length;
          queue.push(n);
        }
      }
    }
    components.push(cells);
  }
  const result: Point[][] = [];
  for (const [id, cells] of components.entries()) {
    const mine = (i: number, j: number) => cell(i, j) && label[j * nx + i] === id;
    // Boundary edges with the filled side on the left, keyed by their start vertex.
    const edges = new Map<number, number[]>();
    const key = (i: number, j: number) => j * (nx + 1) + i;
    let count = 0;
    const add = (from: number, to: number) => {
      count++;
      const list = edges.get(from);
      if (list) list.push(to);
      else edges.set(from, [to]);
    };
    for (const index of cells) {
      const i = index % nx,
        j = (index - i) / nx;
      if (!mine(i, j - 1)) add(key(i + 1, j), key(i, j));
      if (!mine(i - 1, j)) add(key(i, j), key(i, j + 1));
      if (!mine(i, j + 1)) add(key(i, j + 1), key(i + 1, j + 1));
      if (!mine(i + 1, j)) add(key(i + 1, j + 1), key(i + 1, j));
    }
    const first = edges.keys().next().value!;
    const loop: number[] = [first];
    let at = first,
      used = 0;
    for (;;) {
      const next = edges.get(at)?.shift();
      if (next === undefined) break;
      used++;
      if (next === first) break;
      loop.push(next);
      at = next;
    }
    const vertex = (k: number) => ({ x: xs[k % (nx + 1)], y: ys[Math.floor(k / (nx + 1))] });
    const outline = loop.map(vertex).filter((p, i, all) => {
      const a = all[(i + all.length - 1) % all.length],
        b = all[(i + 1) % all.length];
      return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
    });
    if (used === count && outline.length >= 4 && outline.length <= 200) {
      result.push(outline);
      continue;
    }
    // Holes, pinches or a long outline: exact rectangles (row runs merged downwards).
    const runs = new Map<string, Box>();
    for (let j = 0; j < ny; j++) {
      let i = 0;
      while (i < nx) {
        if (!mine(i, j)) {
          i++;
          continue;
        }
        const from = i;
        while (i < nx && mine(i, j)) i++;
        const span = `${from}:${i}`,
          open = runs.get(span);
        if (open && open.y1 === j) open.y1 = j + 1;
        else {
          if (open)
            result.push(
              corners({ x0: xs[open.x0], y0: ys[open.y0], x1: xs[open.x1], y1: ys[open.y1] }),
            );
          runs.set(span, { x0: from, x1: i, y0: j, y1: j + 1 });
        }
      }
    }
    for (const open of runs.values())
      result.push(corners({ x0: xs[open.x0], y0: ys[open.y0], x1: xs[open.x1], y1: ys[open.y1] }));
  }
  return result;
}
function lowerBound(values: number[], value: number) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

type Group = { reveal: boolean; members: number[]; box: Box; points: Point[][]; open: boolean };

export type FogConsolidation = {
  fog: FogState;
  before: number;
  after: number;
  removed: number;
  merged: number;
};

/** The consolidated fog for `fog`; `after === before` when nothing can be safely reduced. */
export function consolidateFog(fog: FogState): FogConsolidation {
  const budget: Budget = { left: WORK_BUDGET };
  let list = fog.shapes.map((shape) => new Prepared(shape));
  let base = fog.base === "revealed";
  // 1. Remove shapes with no visible effect, earliest first.
  let removed = 0;
  for (let index = 0; index < list.length; ) {
    if (budget.left > 0 && removable(list, index, base, budget)) {
      list = [...list.slice(0, index), ...list.slice(index + 1)];
      removed++;
    } else index++;
  }
  // A leading shape that covers the whole map becomes the base state.
  const whole: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  if (list.length && inside(list[0], whole, budget)) {
    base = list[0].shape.reveal;
    list = list.slice(1);
    removed++;
  }
  // 2. Merge same-kind axis-aligned outlines that can move together in the paint order.
  const groups: Group[] = [],
    open = new Map<boolean, Group>();
  list.forEach((s, index) => {
    const reveal = s.shape.reveal,
      other = open.get(!reveal);
    if (other && intersects(other.box, s.reach)) {
      other.open = false;
      open.delete(!reveal);
    }
    const outline = rectilinear(s.shape);
    if (!outline) return;
    let group = open.get(reveal);
    if (!group) {
      group = { reveal, members: [], box: { ...s.reach }, points: [], open: true };
      groups.push(group);
      open.set(reveal, group);
    }
    group.members.push(index);
    group.points.push(outline);
    group.box = {
      x0: Math.min(group.box.x0, s.reach.x0),
      y0: Math.min(group.box.y0, s.reach.y0),
      x1: Math.max(group.box.x1, s.reach.x1),
      y1: Math.max(group.box.y1, s.reach.y1),
    };
  });
  const replace = new Map<number, FogShape[]>(),
    drop = new Set<number>();
  let merged = 0;
  const ids = new Set(list.map((s) => s.shape.id));
  for (const group of groups) {
    if (group.members.length < 2) continue;
    const outlines = mergeOutlines(group.points);
    if (!outlines || outlines.length >= group.members.length) continue;
    const seed = hash(group.members.map((i) => list[i].shape.id).join("|"));
    const shapes = outlines.map((points, n): FogShape => {
      let id = `fog-merged-${seed}-${n}`;
      for (let k = 1; ids.has(id); k++) id = `fog-merged-${seed}-${n}-${k}`;
      ids.add(id);
      const b = pointsBox(points);
      return points.length === 4
        ? {
            id,
            kind: "rectangle",
            reveal: group.reveal,
            a: { x: b.x0, y: b.y0 },
            b: { x: b.x1, y: b.y1 },
          }
        : { id, kind: "polygon", reveal: group.reveal, points };
    });
    for (const member of group.members) drop.add(member);
    replace.set(group.members[group.members.length - 1], shapes);
    merged += group.members.length - shapes.length;
  }
  const shapes = list.flatMap(
    (s, index) => replace.get(index) ?? (drop.has(index) ? [] : [s.shape]),
  );
  const result: FogState = {
    enabled: fog.enabled,
    base: base ? "revealed" : "concealed",
    shapes: structuredClone(shapes),
  };
  return {
    fog: result,
    before: fog.shapes.length,
    after: shapes.length,
    removed,
    merged,
  };
}
