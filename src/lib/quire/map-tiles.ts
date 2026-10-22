import type { CampaignMap, MapGrid, PartyMapPosition } from "./world-schema.ts";
import type { CloudTable } from "./cloud.ts";
import { readMarketLocations } from "./shop-locations.ts";
import { diagonalTiles } from "./tabletop-geometry.ts";

export function mapType(map: CampaignMap, table: Pick<CloudTable, "journal">) {
  if (map.type) return map.type;
  const place = readMarketLocations(table.journal?.market).locations.find(
    (p) => p.id === map.locationId,
  );
  return place && ["city", "town"].includes(place.kind) ? "city" : "regional";
}
export function partyEnvironment(position?: PartyMapPosition) {
  return position
    ? [position.environment, position.biome, position.description].filter(Boolean).join(" · ")
    : "";
}
export function tileAt(grid: MapGrid, point: { x: number; y: number }) {
  const x = (point.x - grid.x) / grid.width,
    y = (point.y - grid.y) / grid.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return {
    column: Math.min(grid.columns - 1, Math.floor(x * grid.columns)),
    row: Math.min(grid.rows - 1, Math.floor(y * grid.rows)),
  };
}
export function tilePoint(grid: MapGrid, tile: { column: number; row: number }) {
  return {
    x: grid.x + ((tile.column + 0.5) * grid.width) / grid.columns,
    y: grid.y + ((tile.row + 0.5) * grid.height) / grid.rows,
  };
}
export function tileDistance(
  grid: MapGrid,
  a: { column: number; row: number },
  b: { column: number; row: number },
) {
  return (
    grid.feetPerTile *
    diagonalTiles(a.column - b.column, a.row - b.row, grid.diagonal ?? "equal").tiles
  );
}
/** Leg lengths along a route; the alternating diagonal count carries across waypoints. */
export function routeLegs(grid: MapGrid, points: { column: number; row: number }[]) {
  let carry = 0;
  return points.slice(1).map((p, i) => {
    const leg = diagonalTiles(
      p.column - points[i].column,
      p.row - points[i].row,
      grid.diagonal ?? "equal",
      carry,
    );
    carry = leg.carry;
    return grid.feetPerTile * leg.tiles;
  });
}
export function routeDistance(grid: MapGrid, points: { column: number; row: number }[]) {
  return routeLegs(grid, points).reduce((sum, leg) => sum + leg, 0);
}
/** Uses the existing voyage clock; it never advances time, spending or physical locations. */
export function routePosition(
  route: { grid: MapGrid; points: { column: number; row: number }[] },
  progress: number,
) {
  const legs = routeLegs(route.grid, route.points),
    total = legs.reduce((sum, leg) => sum + leg, 0);
  let remaining = total * Math.max(0, Math.min(1, progress));
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i],
      length = legs[i - 1];
    if (remaining <= length && length > 0) {
      const start = tilePoint(route.grid, a),
        end = tilePoint(route.grid, b),
        f = remaining / length;
      return { x: start.x + (end.x - start.x) * f, y: start.y + (end.y - start.y) * f };
    }
    remaining -= length;
  }
  return tilePoint(route.grid, route.points.at(-1)!);
}
