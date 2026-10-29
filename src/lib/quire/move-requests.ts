/**
 * "Ask the DM" movement (map tokens PR 8; plan section 1.1): on a map whose player movement is
 * `approval`, a player's move becomes a request the DM approves or denies (like a group move
 * request). The same rules as Automatic apply when it is asked (own, unlocked token, a visible
 * snapped square inside the grid, the combat turn); approving checks the token hasn't moved since.
 */
import { canonicalJson } from "./canonical-json.ts";
import type { CloudSeat, CloudTable } from "./cloud.ts";
import { legacyDiagonals } from "./tabletop-protocol.ts";
import { scenePointVisible, sceneTokenPoint, tokenInsideGrid, tokenSnapped } from "./tabletop-geometry.ts";
import { assertCombatTurn, canRequestMove, mapAccessible, readMapTabletop, sceneViewers, type TabletopExecution } from "./tabletop.ts";
import type { MapToken, MoveRequest } from "./world-schema.ts";

type Tile = { column: number; row: number; offsetX?: number; offsetY?: number };
export type MoveRequestCommand =
  | { id: string; kind: "map-move-request"; requestId: string; mapId: string; grid: string; tokenId: string; before: Tile; after: Tile }
  | { id: string; kind: "map-move-request-review"; requestId: string; approve: boolean; reason?: string }
  | { id: string; kind: "map-move-request-withdraw"; requestId: string };
export const MOVE_REQUEST_KINDS = new Set(["map-move-request", "map-move-request-review", "map-move-request-withdraw"]);

const position = (t: Tile): Tile => ({
  column: t.column,
  row: t.row,
  ...(t.offsetX !== undefined ? { offsetX: t.offsetX } : {}),
  ...(t.offsetY !== undefined ? { offsetY: t.offsetY } : {}),
});
const same = (a: Tile, b: Tile) => canonicalJson(position(a)) === canonicalJson(position(b));
const placed = (token: MapToken, at: Tile): MapToken => {
  const next = { ...token, column: at.column, row: at.row };
  delete next.offsetX;
  delete next.offsetY;
  if (at.offsetX !== undefined) next.offsetX = at.offsetX;
  if (at.offsetY !== undefined) next.offsetY = at.offsetY;
  return next;
};
/** The character a token moves for (its own, or the controller the seat holds). */
function owner(token: MapToken, seat: Pick<CloudSeat, "purseIds">) {
  if (token.kind === "character" && token.entityId && seat.purseIds.includes(token.entityId)) return token.entityId;
  return token.controllerPurseIds?.find((id) => seat.purseIds.includes(id)) ?? token.entityId ?? seat.purseIds[0];
}

export function applyMoveRequestCommand(
  t: CloudTable,
  seat: Pick<CloudSeat, "role" | "purseIds">,
  cmd: MoveRequestCommand,
  at: number,
  execution: TabletopExecution = {},
) {
  const w = t.journal!.world!;
  const event = (summary: string, purseId?: string) =>
    t.journal!.events.push({ id: `${cmd.id}-event`, at, kind: "management", summary: summary.slice(0, 500), ...(purseId ? { purseId } : {}) });
  if (cmd.kind === "map-move-request") {
    const map = w.maps.find((m) => m.id === cmd.mapId);
    if (!map || !mapAccessible(t, map, seat)) throw Error("This map is unavailable.");
    if (!map.grid) throw Error("Configure a combat grid before moving tokens.");
    if (canonicalJson(map.grid) !== cmd.grid && canonicalJson(legacyDiagonals(map.grid)) !== cmd.grid)
      throw Error("The combat grid changed. Refresh before moving tokens.");
    if (seat.role === "dm") throw Error("The DM moves tokens directly.");
    const token = (map.tokens ?? []).find((x) => x.id === cmd.tokenId);
    if (!token || !same(token, cmd.before)) throw Error("This token moved or changed. Refresh before asking.");
    if (!canRequestMove(t, map, token, seat)) throw Error("You can't move this token on this map.");
    const next = placed(token, cmd.after);
    if (!tokenInsideGrid(map.grid, next)) throw Error("Keep tokens inside the combat grid.");
    const settings = readMapTabletop(map);
    if (settings.snap && !tokenSnapped(next)) throw Error("This map requires movement snapped to the grid.");
    if (!scenePointVisible(sceneTokenPoint(map.grid, next), settings, map.grid, sceneViewers(t, map, seat)))
      throw Error("Choose a visible square.");
    assertCombatTurn(t, map, [token], seat, execution);
    const requests = (w.moveRequests ??= []);
    if (requests.some((r) => r.id === cmd.requestId)) throw Error("This request was already sent.");
    // One waiting move per token: a new one replaces it.
    for (const r of requests)
      if (r.tokenId === token.id && r.mapId === map.id && r.status === "pending") {
        r.status = "withdrawn";
        r.decidedAt = at;
        r.reason = "Replaced by a newer move.";
      }
    const purseId = owner(token, seat);
    requests.push({ id: cmd.requestId, mapId: map.id, purseId, tokenId: token.id, before: position(token), after: position(cmd.after), status: "pending", createdAt: at });
    event(`${token.label}: move waiting for the DM`, purseId);
    return;
  }
  const r = (w.moveRequests ?? []).find((x) => x.id === cmd.requestId);
  if (!r) throw Error("This request no longer exists.");
  if (r.status !== "pending") throw Error("This request is already decided.");
  if (cmd.kind === "map-move-request-withdraw") {
    if (seat.role !== "dm" && !seat.purseIds.includes(r.purseId)) throw Error("Only the player who asked (or the DM) can withdraw this move.");
    r.status = "withdrawn";
    r.decidedAt = at;
    return;
  }
  if (seat.role !== "dm") throw Error("Only the DM can approve or deny moves.");
  r.decidedAt = at;
  const map = w.maps.find((m) => m.id === r.mapId);
  const token = map?.tokens?.find((x) => x.id === r.tokenId);
  const close = (status: MoveRequest["status"], reason: string) => {
    r.status = status;
    r.reason = reason;
    event(reason, r.purseId);
  };
  if (!cmd.approve) return close("denied", cmd.reason?.trim() || `${token?.label ?? "The token"} stays where it is.`);
  if (!map?.grid || !token) return close("cancelled", "The token is no longer on this map.");
  if (!same(token, r.before)) return close("cancelled", `${token.label} moved since; the request was cancelled.`);
  const next = placed(token, r.after);
  if (!tokenInsideGrid(map.grid, next)) return close("cancelled", "The grid changed; the request was cancelled.");
  map.tokens = (map.tokens ?? []).map((x) => (x.id === token.id ? next : x));
  const settings = readMapTabletop(map);
  if (map.tabletop && settings.vision !== "off") map.tabletop = { ...settings, revision: settings.revision + 1 };
  r.status = "approved";
  event(`${token.label} moved (approved by the DM)`, r.purseId);
}
