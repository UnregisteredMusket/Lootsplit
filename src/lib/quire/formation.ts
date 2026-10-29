import {
  blocked,
  occupiedSquares,
  sceneTokenPoint,
  tokenFootprint,
  type GridGeometry,
  type TokenPlace,
} from "./tabletop-geometry.ts";
import type { SceneWall } from "./tabletop-schema.ts";
import type { MapGrid, MapToken } from "./world-schema.ts";

/** A party formation for Place party (map tokens PR 3, mockup group-placement). */
export type Formation = {
  shape: "cluster" | "line" | "circle";
  /** Empty squares between members. */
  spacing: number;
  rotation: 0 | 90 | 180 | 270;
};
export const DEFAULT_FORMATION: Formation = { shape: "cluster", spacing: 0, rotation: 0 };

/** The members' relative squares before spacing and rotation. */
function pattern(shape: Formation["shape"], n: number): { x: number; y: number }[] {
  if (shape === "line") return Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
  if (shape === "circle") {
    if (n === 1) return [{ x: 0, y: 0 }];
    // Squares on a ring around the anchor, in order around it, without repeats.
    for (let radius = 1; radius <= 20; radius++) {
      const seen = new Set<string>(),
        points: { x: number; y: number }[] = [];
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const p = { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
        if (!seen.has(`${p.x},${p.y}`)) {
          seen.add(`${p.x},${p.y}`);
          points.push(p);
        }
      }
      if (points.length === n) return points;
    }
  }
  const columns = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, i) => ({ x: i % columns, y: Math.floor(i / columns) }));
}
const turn = (p: { x: number; y: number }, rotation: Formation["rotation"]) =>
  rotation === 90 ? { x: -p.y, y: p.x } : rotation === 180 ? { x: -p.x, y: -p.y } : rotation === 270 ? { x: p.y, y: -p.x } : p;

export type FormationMember = Pick<TokenPlace, "sizeClass" | "footprint" | "anchor"> & { id: string };
export type FormationPlan = {
  /** The top-left square of each member (in member order). */
  places: { id: string; column: number; row: number }[];
  /** Members that could not use their formation square and took the nearest free one. */
  displaced: number;
  /** Members with no free square at all (nothing is placed then). */
  unplaced: number;
};

/**
 * Plan a formation around an anchor square: each member takes its formation square (a whole
 * footprint, spaced by `spacing`), or the nearest free square when that one is outside the grid,
 * occupied, or behind a movement-blocking wall from the anchor. Squares in fog are allowed for the
 * DM (the preview marks them). `others` are the tokens staying where they are.
 */
export function planFormation(
  grid: GridGeometry,
  others: readonly TokenPlace[],
  members: readonly FormationMember[],
  anchor: { column: number; row: number },
  formation: Formation,
  walls: readonly SceneWall[] = [],
): FormationPlan {
  const taken = occupiedSquares(others);
  const step = 1 + Math.max(0, formation.spacing);
  const sizes = members.map((m) => Math.max(1, Math.ceil(tokenFootprint(m) - 1e-9)));
  const widest = Math.max(1, ...sizes);
  const raw = pattern(formation.shape, members.length).map((p) => turn(p, formation.rotation));
  const minX = Math.min(...raw.map((p) => p.x)),
    maxX = Math.max(...raw.map((p) => p.x)),
    minY = Math.min(...raw.map((p) => p.y)),
    maxY = Math.max(...raw.map((p) => p.y));
  // The formation's middle lands on the anchor square.
  const ox = anchor.column - Math.round(((maxX - minX) * step * widest) / 2) - minX * step * widest,
    oy = anchor.row - Math.round(((maxY - minY) * step * widest) / 2) - minY * step * widest;
  const centre = sceneTokenPoint(grid, { column: anchor.column, row: anchor.row });
  const fits = (column: number, row: number, n: number) => {
    if (column < 0 || row < 0 || column + n > grid.columns || row + n > grid.rows) return false;
    for (let c = column; c < column + n; c++)
      for (let r = row; r < row + n; r++) if (taken.has(`${c},${r}`)) return false;
    const point = sceneTokenPoint(grid, { column, row, anchor: "corner", footprint: n });
    return !blocked(centre, point, walls, true);
  };
  const places: FormationPlan["places"] = [];
  let displaced = 0,
    unplaced = 0;
  members.forEach((member, i) => {
    const n = sizes[i];
    const want = { column: ox + raw[i].x * step * widest, row: oy + raw[i].y * step * widest };
    let found: { column: number; row: number } | undefined;
    if (fits(want.column, want.row, n)) found = want;
    else
      for (let radius = 1; radius < Math.max(grid.columns, grid.rows) && !found; radius++)
        for (let dy = -radius; dy <= radius && !found; dy++)
          for (let dx = -radius; dx <= radius && !found; dx++)
            if (Math.max(Math.abs(dx), Math.abs(dy)) === radius && fits(want.column + dx, want.row + dy, n))
              found = { column: want.column + dx, row: want.row + dy };
    if (!found) {
      unplaced++;
      return;
    }
    if (found !== want) displaced++;
    for (let c = found.column; c < found.column + n; c++)
      for (let r = found.row; r < found.row + n; r++) taken.add(`${c},${r}`);
    places.push({ id: member.id, ...found });
  });
  return { places, displaced, unplaced };
}

/**
 * The Undo of a Place party / Place / Move (map tokens PR 3; privacy review 2026-10-29): moved
 * tokens go back and new ones are removed, with each token's `before` being the token exactly as
 * it was placed. The server refuses the whole Undo if any of them moved or changed since, so a
 * later move, claim or edit is never overwritten.
 */
export function placeUndo(
  mapId: string,
  grid: MapGrid,
  entries: readonly { tokenId: string; before: MapToken | null; token: MapToken }[],
) {
  return {
    kind: "map-tokens-place" as const,
    mapId,
    grid,
    place: entries.filter((e) => e.before).map((e) => ({ tokenId: e.tokenId, before: e.token, token: e.before! })),
    remove: entries.filter((e) => !e.before).map((e) => ({ mapId, grid, tokenId: e.tokenId, before: e.token })),
  };
}
