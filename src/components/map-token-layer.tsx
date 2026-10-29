import type { CSSProperties, MouseEvent } from "react";
import { Lock } from "lucide-react";
import type { PlayerMovement } from "@/lib/quire/map-movement";
import { actorName } from "@/lib/quire/map-movement";
import { NotYourTurnCard } from "./map-player-movement";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import type { CampaignMap, MapToken } from "@/lib/quire/world-schema";
import { discToken, tokenSizeText } from "@/lib/quire/token-display";
import {
  diagonalTiles,
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
  movement,
  notTurn,
  speedFeet,
  ghosts = [],
  box,
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
  /** A player's movement (map tokens PR 2); undefined for the DM. */
  movement?: PlayerMovement;
  /** The player's own token whose press was refused because it isn't their turn. */
  notTurn?: string;
  /** The player's speed from their sheet: the reach guide on their turn. */
  speedFeet?: number;
  /** Group placement ghosts (map tokens PR 3), snapped square by square. */
  ghosts?: { token: MapToken; fogged: boolean; pending?: boolean }[];
  /** The Shift+drag selection box, in scene coordinates. */
  box?: { a: { x: number; y: number }; b: { x: number; y: number } };
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
      : mine(token) && token.kind === "character" && seat.purseIds.includes(token.entityId ?? "")
        ? movement?.combat
          ? "You"
          : `${token.label} (you)`
        : token.label;
  const waiting = !!movement?.combat && !movement.myTurn;
  // The reach guide on the player's turn: squares within their speed (a guide; the DM rules).
  const acting = movement?.combat && movement.myTurn ? tokens.find((t) => t.id === movement.acting?.tokenId) : undefined;
  const reach: { c: number; r: number }[] = [];
  if (acting && speedFeet && !moves.length) {
    const box = tokenBox(acting),
      n = Math.max(1, Math.round(box.size)),
      steps = Math.floor(speedFeet / grid.feetPerTile + 1e-9);
    const c0 = Math.round(box.left),
      r0 = Math.round(box.top);
    for (let c = Math.max(0, c0 - steps); c <= Math.min(grid.columns - n, c0 + steps); c++)
      for (let r = Math.max(0, r0 - steps); r <= Math.min(grid.rows - n, r0 + steps); r++)
        if (diagonalTiles(c - c0, r - r0, grid.diagonal ?? "equal").tiles * grid.feetPerTile <= speedFeet + 1e-9)
          reach.push({ c, r });
  }
  return (
    <>
      {reach.length > 0 && (
        <svg className="map-token-reach" aria-hidden="true">
          {reach.map(({ c, r }) => {
            const left = view.x + grid.x * width * view.scale + c * square.w,
              top = view.y + grid.y * height * view.scale + r * square.h;
            return <rect key={`${c},${r}`} x={left} y={top} width={square.w} height={square.h} />;
          })}
        </svg>
      )}
      {tokens.map((token) => {
        const move = moving.get(token.id),
          isSelected = selected.includes(token.id),
          { r, d, cx, cy } = disc(token, token),
          portrait = portraits(token),
          text = label(token, isSelected);
        const showFoot = !move && (sized(token) || isSelected);
        // A token directly below would cover the name: put it above instead (as in the mockups).
        const box = tokenBox(token),
          below = tokens.some((other) => {
            if (other === token) return false;
            const o = tokenBox(other);
            return (
              Math.abs(o.top - (box.top + box.size)) < 0.01 &&
              o.left < box.left + box.size - 0.01 &&
              o.left + o.size > box.left + 0.01
            );
          });
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
                <span className={`map-token-label${below ? " top" : ""}`} aria-hidden="true">
                  {move ? (dm ? `${text} · ${tokenSizeText(token)} (moving)` : text) : text}
                </span>
              )}
              {waiting && mine(token) && (
                <span className="map-token-lock" aria-hidden="true">
                  <Lock size={11} />
                </span>
              )}
            </button>
            {notTurn === token.id && waiting && (
              <NotYourTurnCard
                left={r.left + r.width / 2 - 40}
                top={r.top + r.height + 18}
                acting={
                  movement.acting
                    ? actorName(movement.acting.label, map.tokens?.find((t) => t.id === movement.acting!.tokenId))
                    : "another combatant"
                }
                name={token.label}
              />
            )}
          </div>
        );
      })}
      {ghosts.map(({ token, fogged, pending }) => {
        const { r, d, cx, cy } = disc(token, token);
        return (
          <div
            key={`ghost-${token.id}${pending ? "-pending" : ""}`}
            className={`map-token-drag${pending ? " pending" : ""}`}
            aria-hidden={pending ? undefined : "true"}
            role={pending ? "img" : undefined}
            aria-label={pending ? `${token.label}: move waiting for the DM` : undefined}
          >
            <span
              className={`map-token-foot target${fogged ? " fogged" : ""}`}
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
            <span
              className={`map-token map-token-${token.kind} ghost preview`}
              style={{ left: cx, top: cy, width: d, height: d, fontSize: Math.max(10, Math.round(d * 0.36)) }}
            >
              <span>{initial(token)}</span>
              {pending && <span className="map-token-label top">Waiting for the DM</span>}
            </span>
          </div>
        );
      })}
      {box && (
        <span
          className="map-select-box"
          aria-hidden="true"
          style={{
            left: view.x + Math.min(box.a.x, box.b.x) * width * view.scale,
            top: view.y + Math.min(box.a.y, box.b.y) * height * view.scale,
            width: Math.abs(box.a.x - box.b.x) * width * view.scale,
            height: Math.abs(box.a.y - box.b.y) * height * view.scale,
          }}
        />
      )}
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
          <div key={`move-${move.tokenId}`} className={`map-token-drag${dm ? "" : " player"}`} aria-hidden="true">
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
            {dm ? (
              <span
                className="map-token-drop"
                style={{ left: to.r.left, top: to.r.top + to.r.height + 6 }}
              >
                Drop: {where} · {Math.round(feet * 10) / 10} {units}
              </span>
            ) : (
              <span
                className="map-token-drop-card map-glass"
                style={{ left: to.r.left + to.r.width + 10, top: to.r.top - 4 }}
              >
                <b>
                  {Math.round(feet * 10) / 10} {units} · {where}
                </b>
                <small>Release to move</small>
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

