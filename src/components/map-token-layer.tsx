import type { CSSProperties, MouseEvent } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import type { CampaignMap, MapToken } from "@/lib/quire/world-schema";
import { discToken, tokenSizeText } from "@/lib/quire/token-display";
import {
  footprintLabel,
  sceneDistance,
  sceneTokenPoint,
  tokenBox,
  tokenFootprint,
} from "@/lib/quire/tabletop-geometry";

type Position = { column: number; row: number; offsetX?: number; offsetY?: number };
export type TokenMove = { tokenId: string; before: Position; after: Position };
type View = { x: number; y: number; scale: number };

/** The minimum drawn disc and the minimum touch target, in screen pixels (docs/MAP-TILES.md). */
const MIN_DISC = 28,
  MIN_TINY = 16,
  MIN_TARGET = 44;

/** Lower-case initials for Small and Tiny creatures, as in the approved mockups. */
function initial(token: MapToken) {
  const letter = token.label.trim().slice(0, 1) || "?";
  return token.sizeClass === "small" || token.sizeClass === "tiny"
    ? letter.toLowerCase()
    : letter.toUpperCase();
}
const sized = (token: MapToken) =>
  token.sizeClass !== undefined || token.footprint !== undefined || token.anchor !== undefined;

/**
 * Map tokens drawn at their footprint (map tokens PR 1, owner 2026-10-29): a round disc with the
 * portrait or initial filling the footprint, at least 28 px with a 44 px target, the name below,
 * a footprint square for sized or selected tokens, and while dragging a ghost at the start, the
 * target footprint and its squares and distance.
 */
export function MapTokenLayer({
  map,
  tokens,
  view,
  width,
  height,
  selected,
  moves,
  highlighted,
  onActivate,
}: {
  map: CampaignMap;
  tokens: MapToken[];
  view: View;
  width: number;
  height: number;
  selected: readonly string[];
  moves: readonly TokenMove[];
  highlighted?: string;
  onActivate: (token: MapToken, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const table = useWorldTable(),
    seat = useSeat(),
    dm = seat.role === "dm";
  /** Tokens the seat plays (drawn with the accent ring). */
  const mine = (token: MapToken) =>
    !dm &&
    ((token.kind === "character" && !!token.entityId && seat.purseIds.includes(token.entityId)) ||
      !!token.controllerPurseIds?.some((id) => seat.purseIds.includes(id)));
  const portraits = (token: MapToken) =>
    token.kind === "character"
      ? table.purses.find((p) => p.id === token.entityId)?.portrait
      : undefined;
  const grid = map.grid;
  if (!grid) return null;
  const square = {
    w: ((grid.width * width) / grid.columns) * view.scale,
    h: ((grid.height * height) / grid.rows) * view.scale,
  };
  const rect = (token: Position & Partial<MapToken>) => {
    const box = tokenBox(token);
    return {
      left: view.x + grid.x * width * view.scale + box.left * square.w,
      top: view.y + grid.y * height * view.scale + box.top * square.h,
      width: box.size * square.w,
      height: box.size * square.h,
    };
  };
  const units = map.tabletop?.unitLabel ?? "ft",
    perFoot = map.tabletop?.unitsPerFoot ?? 1;
  const moving = new Map(moves.map((move) => [move.tokenId, move]));
  const disc = (token: MapToken, place: Position) => {
    const r = rect({ ...token, ...place }),
      n = tokenFootprint(token),
      side = Math.min(r.width, r.height),
      pad = side * (n < 1 ? 0.05 : 0.09),
      d = Math.max(n < 1 ? MIN_TINY : MIN_DISC, side - pad * 2);
    return { r, d, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };
  const label = (token: MapToken, isSelected: boolean) =>
    token.style?.labels === "never" || (token.style?.labels === "selected" && !isSelected)
      ? undefined
      : token.label;
  return (
    <>
      {tokens.map((token) => {
        const move = moving.get(token.id),
          isSelected = selected.includes(token.id),
          { r, d, cx, cy } = disc(token, token),
          portrait = portraits(token),
          text = label(token, isSelected);
        const showFoot = !move && (sized(token) || isSelected);
        return (
          <div key={token.id} className="map-token-slot">
            {showFoot && (
              <span
                className="map-token-foot"
                aria-hidden="true"
                style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
              />
            )}
            <button
              type="button"
              data-map-token={token.id}
              className={[
                "map-token",
                `map-token-${token.kind}`,
                mine(token) ? "mine" : "",
                token.visibility === "dm" && dm ? "dm-only" : "",
                token.style?.color ? "tinted" : "",
                move ? "ghost" : "",
                highlighted === token.id ? "map-record-highlight" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                {
                  left: cx,
                  top: cy,
                  width: d,
                  height: d,
                  fontSize: Math.max(10, Math.round(d * 0.36)),
                  "--token-ring": token.style?.color,
                  "--token-target": `${Math.max(d, MIN_TARGET)}px`,
                } as CSSProperties
              }
              title={`Combatant: ${token.label}`}
              aria-label={`${token.label}${token.visibility === "dm" && dm ? " (DM only)" : ""}`}
              aria-pressed={isSelected}
              onClick={(event) => onActivate(token, event)}
            >
              {portrait ? (
                <img src={portrait} alt="" draggable={false} />
              ) : (
                <span aria-hidden="true">{initial(token)}</span>
              )}
              {text && (
                <span className="map-token-label" aria-hidden="true">
                  {move ? `${text} · ${tokenSizeText(token)} (moving)` : text}
                </span>
              )}
            </button>
          </div>
        );
      })}
      {moves.map((move) => {
        const token = map.tokens?.find((t) => t.id === move.tokenId);
        if (!token || !discToken(token)) return null;
        const from = disc(token, token),
          to = disc(token, move.after),
          feet =
            sceneDistance(
              grid,
              sceneTokenPoint(grid, token),
              sceneTokenPoint(grid, { ...token, ...move.after }),
            ) * perFoot,
          where = footprintLabel({ ...token, ...move.after });
        return (
          <div key={`move-${move.tokenId}`} className="map-token-drag" aria-hidden="true">
            <svg className="map-token-path">
              <line x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} />
            </svg>
            <span
              className="map-token-foot target"
              style={{ left: to.r.left, top: to.r.top, width: to.r.width, height: to.r.height }}
            />
            <span
              className={`map-token map-token-${token.kind} preview`}
              style={{
                left: to.cx,
                top: to.cy,
                width: to.d,
                height: to.d,
                fontSize: Math.max(10, Math.round(to.d * 0.36)),
              }}
            >
              <span>{initial(token)}</span>
            </span>
            <span
              className="map-token-drop"
              style={{ left: to.r.left, top: to.r.top + to.r.height + 6 }}
            >
              Drop: {where} · {Math.round(feet * 10) / 10} {units}
            </span>
          </div>
        );
      })}
    </>
  );
}

