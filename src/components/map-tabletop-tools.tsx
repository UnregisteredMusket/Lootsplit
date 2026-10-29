import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ROOM_LIMIT_TEXT } from "@/lib/quire/room-size";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useEconomy } from "@/lib/quire/economy-context";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { readMapTabletop, readTabletopSession, canMoveMapToken, canRequestMove, movementMode, alignUndoMap } from "@/lib/quire/tabletop";
import {
  alignedGrid,
  freeTokenPosition,
  gridPoint,
  nearestSnapped,
  sceneRouteDistance,
  sceneTokenPoint,
  shiftToken,
  snapTokenPosition,
  tokenBox,
  tokenInsideGrid,
  tokenSnapped,
} from "@/lib/quire/tabletop-geometry";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { scaleDistance } from "@/lib/quire/journey";
import { fogStorageBytes, fogDiff } from "@/lib/quire/fog-history";
import { consolidateFog, type FogConsolidation } from "@/lib/quire/fog-consolidate";
import {
  extendStroke,
  finishStroke,
  roundScenePoint,
  type StrokeDraft,
} from "@/lib/quire/fog-stroke";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { allowContextChange, useDraftGuard } from "@/lib/quire/use-draft-guard";
import { openWorkspaceWindow } from "@/lib/quire/workspace-windows";
import type { CampaignMap, MapToken } from "@/lib/quire/world-schema";
import type {
  MapTabletop,
  FogState,
  ScenePoint,
  AreaTemplate,
  SceneCamera,
} from "@/lib/quire/tabletop-schema";
import type { CommandInput } from "@/lib/quire/commands";
import { Button, Fold } from "./ui";
import { CommandButton } from "./world-tools";
import { TemplateShape, TokenInspector, SceneConfiguration } from "./map-tabletop-inspector";
import { AppLink } from "./app-link";
import { GridModeDialog, type GridModeChoice } from "./map-grid-mode";
import { resultToast } from "@/lib/quire/result-toast";
import type { PlayerMovement } from "@/lib/quire/map-movement";
import { DEFAULT_FORMATION, placeUndo, planFormation, type Formation } from "@/lib/quire/formation";
import { manuallyVisible } from "@/lib/quire/tabletop-geometry";

export type MapTool =
  | "select"
  | "pan"
  | "measure"
  | "fog-brush"
  | "fog-rectangle"
  | "fog-polygon"
  | "wall"
  | "light"
  | "template";
type Position = { column: number; row: number; offsetX?: number; offsetY?: number };
type Move = { tokenId: string; before: Position; after: Position };
const position = (token: Position): Position => ({
  column: token.column,
  row: token.row,
  offsetX: token.offsetX,
  offsetY: token.offsetY,
});
/** A group placement in progress: who is placed, and how. */
export type Placing = {
  members: { token: MapToken; before: MapToken | null }[];
  /** "formation": arranged around the pointer; "keep": moved together in their shape. */
  mode: "formation" | "keep";
  formation: Formation;
  label: string;
  /** Save the formation as the party's default when placed. */
  makeDefault?: boolean;
};
/** Snapped Tiny tokens keep their quadrant offsets; other snapped positions drop offsets. */
const quadrant = (place: Position) =>
  Math.abs(place.offsetX ?? 0) === 0.25 && Math.abs(place.offsetY ?? 0) === 0.25
    ? { offsetX: place.offsetX, offsetY: place.offsetY }
    : {};
const toolNames: Record<MapTool, string> = {
  select: "Select / move",
  pan: "Pan",
  measure: "Measure",
  "fog-brush": "Fog brush",
  "fog-rectangle": "Fog rectangle",
  "fog-polygon": "Fog polygon",
  wall: "Wall / door",
  light: "Light",
  template: "Area template",
};

export function useMapTabletopTools(
  map: CampaignMap,
  selectedToken: string,
  selectToken?: (id: string) => void,
  /** A player's movement on this map (map tokens PR 2); undefined for the DM. */
  movement?: PlayerMovement,
) {
  const table = useWorldTable(),
    seat = useSeat(),
    { commandOutcome } = useEconomy(),
    dm = seat.role === "dm",
    settings = readMapTabletop(map),
    session = readTabletopSession(table),
    cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [tool, setTool] = useState<MapTool>("select"),
    [selected, setSelected] = useState<string[]>([]),
    [points, setPoints] = useState<ScenePoint[]>([]),
    [cursor, setCursor] = useState<ScenePoint>(),
    [moves, setMoves] = useState<Move[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [inspector, setInspector] = useState(false),
    [reveal, setReveal] = useState(true),
    [radius, setRadius] = useState(0.03),
    [wallKind, setWallKind] = useState<"wall" | "door" | "window" | "secret-door">("wall"),
    [blockMovement, setBlockMovement] = useState(false),
    [distance, setDistance] = useState(20),
    [templateKind, setTemplateKind] = useState<AreaTemplate["kind"]>("circle"),
    [width, setWidth] = useState(5),
    [direction, setDirection] = useState(0),
    [angle, setAngle] = useState(90),
    [lightColor, setLightColor] = useState("#ffcf80"),
    [lightRadius, setLightRadius] = useState(30),
    [ignoreWalls, setIgnoreWalls] = useState(false),
    [showPreview, setShowPreview] = useState(false),
    [consolidation, setConsolidation] = useState<
      (FogConsolidation & { from: FogState; bytes: number }) | null
    >(null);
  const gesture = useRef<
      | {
          point: ScenePoint;
          token?: MapToken;
          ids?: string[];
          grid?: string;
          moved: boolean;
          /** Where the token was grabbed, in squares from its footprint's top-left corner. */
          grab?: { x: number; y: number };
          /** Placing the player's own token (map-token-claim). */
          claim?: string;
          /** Drawing a selection box (Shift+drag). */
          box?: boolean;
        }
      | undefined
    >(undefined),
    movePreview = useRef<Move[]>([]),
    stroke = useRef<StrokeDraft>({ points: [], frozen: 0 }),
    keyboardAnchor = useRef<ScenePoint | undefined>(undefined);
  // Group placement (map tokens PR 3): Place party / Place / Move with ghosts that follow the
  // pointer square by square, Shift+drag box selection, and the phones' Select mode.
  const [placing, setPlacing] = useState<Placing | null>(null),
    [placeAnchor, setPlaceAnchor] = useState<{ column: number; row: number }>(),
    [box, setBox] = useState<{ a: ScenePoint; b: ScenePoint }>(),
    [selectMode, setSelectMode] = useState(false);
  const placingNow = placing;
  // Player movement (map tokens PR 2): placing your own token, and "Not your turn" on a press.
  const [claiming, setClaiming] = useState(""),
    [notTurn, setNotTurn] = useState(""),
    notTurnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [gridDialog, setGridDialog] = useState<GridModeChoice | null>(null),
    [gridError, setGridError] = useState(""),
    latest = useRef(map);
  latest.current = map;
  const disabled = busy || cloud.viewOnly || (cloud.joined && !cloud.mine);
  const selectedTokens = (map.tokens ?? []).filter((token) => selected.includes(token.id));
  const cancel = () => {
    gesture.current = undefined;
    movePreview.current = [];
    keyboardAnchor.current = undefined;
    stroke.current = { points: [], frozen: 0 };
    setMoves([]);
    setPoints([]);
    setCursor(undefined);
    setTool("select");
  };
  useDraftGuard((points.length > 0 && tool !== "measure") || moves.length > 0, "Map tool draft");
  useEffect(() => {
    if (selectedToken && !selected.includes(selectedToken)) {
      setSelected([selectedToken]);
      // Exact-position forms in Settings select without opening another panel.
    } else if (!selectedToken && selected.length) setSelected([]);
    // The parent also services the preserved exact-position forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken]);
  useEffect(() => {
    cancel();
    setSelected([]);
    setInspector(false);
    setShowPreview(false);
    setConsolidation(null);
    setError("");
    setNotice("");
    // Map changes are guarded by the existing router draft blocker.
  }, [map.id]);
  async function act(input: CommandInput, done?: () => void) {
    if (disabled) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await commandOutcome(input);
      setNotice(mutationNotice(result, "Map updated."));
      done?.();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The map action was rejected. Your draft is retained.",
      );
    } finally {
      setBusy(false);
    }
  }
  const configure = (next: MapTabletop, done?: () => void) =>
    act(
      { kind: "map-tabletop", mapId: map.id, before: map.tabletop ?? null, settings: next },
      done,
    );
  function choose(id: string, additive = false) {
    const next = additive
      ? selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id]
      : [id];
    setSelected(next);
    selectToken?.(next.includes(id) ? id : (next[0] ?? ""));
    setInspector(true);
  }
  /** The square under a point (grid placements and ghosts). */
  const squareAt = (point: ScenePoint) => (map.grid ? snapTokenPosition(map.grid, {}, point) : undefined);
  function hover(point: ScenePoint) {
    if (!placing) return false;
    const at = squareAt(point);
    if (at && (at.column !== placeAnchor?.column || at.row !== placeAnchor?.row))
      setPlaceAnchor({ column: at.column, row: at.row });
    return true;
  }
  function pointerDown(point: ScenePoint, tokenId?: string, additive = false) {
    if (placing) {
      hover(point);
      gesture.current = { point, moved: false };
      return true;
    }
    // Shift+drag on the empty map draws a selection box; a plain drag still pans.
    if (!tokenId && dm && additive && (tool === "select" || tool === "pan") && map.grid) {
      gesture.current = { point, moved: false, box: true };
      setBox({ a: point, b: point });
      return true;
    }
    // Phones' Select mode: a tap toggles a token in the selection.
    if (tokenId && selectMode) additive = true;
    // Inspection and temporary measurement remain available between sessions.
    if (tokenId && tool === "select") {
      const token = map.tokens?.find((token) => token.id === tokenId);
      if (!token) return false;
      const ids = additive
        ? [...new Set([...selected, tokenId])]
        : selected.includes(tokenId)
          ? selected
          : [tokenId];
      setSelected(ids);
      selectToken?.(tokenId);
      const box = tokenBox(token),
        at = map.grid ? gridPoint(map.grid, point) : { x: box.left + 0.5, y: box.top + 0.5 };
      // During combat a player moves only the token whose turn it is (the server checks too).
      // "Ask the DM" maps (PR 8): the drag becomes a request the DM approves.
      const allowed =
        !disabled &&
        (canMoveMapToken(table, map, token, seat) || canRequestMove(table, map, token, seat)) &&
        (!movement?.combat || movement.acting?.tokenId === token.id);
      if (!allowed && movement?.combat && canMoveMapToken(table, map, token, seat)) {
        setNotTurn(token.id);
        clearTimeout(notTurnTimer.current);
        notTurnTimer.current = setTimeout(() => setNotTurn(""), 4000);
      }
      gesture.current = {
        point,
        token: allowed ? token : undefined,
        ids,
        grid: canonicalJson(map.grid),
        moved: false,
        grab: { x: at.x - box.left, y: at.y - box.top },
      };
      return true;
    }
    if (claiming && (tool === "pan" || tool === "select")) {
      gesture.current = { point, moved: false, claim: claiming };
      return true;
    }
    if (tool === "pan" || tool === "select") return false;
    gesture.current = { point, moved: false };
    if (["fog-brush", "fog-rectangle", "wall"].includes(tool)) setPoints([point]);
    if (tool === "fog-brush") stroke.current = { points: [point], frozen: 0 };
    return true;
  }
  function pointerMove(point: ScenePoint) {
    if (tool === "measure" || tool === "fog-polygon") setCursor(point);
    const current = gesture.current;
    if (!current) return false;
    if (Math.hypot(point.x - current.point.x, point.y - current.point.y) < 0.004 && !current.moved)
      return true;
    current.moved = true;
    setCursor(point);
    if (placing) return hover(point);
    if (current.box) {
      setBox({ a: current.point, b: point });
      return true;
    }
    if (current.token && map.grid) {
      // Footprints (owner, 2026-10-29): with grid mode on the square under the grabbed point
      // wins; with it off the token follows the pointer exactly. The server checks the same rule.
      const destination = (settings.snap ? snapTokenPosition : freeTokenPosition)(
        map.grid,
        current.token,
        point,
        current.grab,
      );
      if (!destination) {
        movePreview.current = [];
        setMoves([]);
        return true;
      }
      const from = tokenBox(current.token),
        to = tokenBox({ ...current.token, ...destination }),
        dx = to.left - from.left,
        dy = to.top - from.top;
      const preview = (map.tokens ?? [])
        .filter((token) => current.ids?.includes(token.id))
        .map((token) => {
          let after: Position =
            token.id === current.token!.id ? destination : shiftToken(token, dx, dy);
          if (settings.snap && !tokenSnapped({ ...token, ...after }))
            after =
              snapTokenPosition(
                map.grid!,
                token,
                sceneTokenPoint(map.grid!, { ...token, ...after }),
              ) ?? after;
          return {
            tokenId: token.id,
            before: position(token),
            after: settings.snap
              ? { column: after.column, row: after.row, ...quadrant(after) }
              : after,
          };
        });
      movePreview.current = preview;
      setMoves(preview);
    } else if (tool === "fog-brush") {
      // Long strokes are simplified as they grow and saved as continued shapes, not cut off.
      const next = extendStroke(stroke.current, point, radius);
      if (next.full)
        setNotice(
          "This brush stroke is at its maximum length. Release to save it, then keep painting.",
        );
      else {
        stroke.current = { points: next.points, frozen: next.frozen };
        setPoints(next.points);
      }
    } else if (tool === "fog-rectangle" || tool === "wall") setPoints([current.point, point]);
    return true;
  }
  const othersOf = (current: Placing) =>
    (map.tokens ?? []).filter((t) => !current.members.some((m) => m.token.id === t.id));
  function planAt(anchor: { column: number; row: number } | undefined, placing = placingNow) {
    if (!placing || !anchor || !map.grid) return undefined;
    if (placing.mode === "keep") {
      // Move together: the group keeps its shape, led by its first token.
      const lead = tokenBox(placing.members[0].token);
      return {
        places: placing.members.map((m) => {
          const b = tokenBox(m.token);
          return {
            id: m.token.id,
            column: anchor.column + Math.round(b.left - lead.left),
            row: anchor.row + Math.round(b.top - lead.top),
          };
        }),
        displaced: 0,
        unplaced: 0,
      };
    }
    return planFormation(
      map.grid,
      othersOf(placing),
      placing.members.map((m) => ({ ...m.token, id: m.token.id })),
      anchor,
      placing.formation,
      settings.walls,
    );
  }
  /** The ghost tokens of a placement plan (fogged squares are marked for the DM). */
  function ghostsOf(current: ReturnType<typeof planAt>, placing = placingNow) {
    if (!current || !placing) return [];
    return current.places.flatMap((p) => {
      const member = placing.members.find((m) => m.token.id === p.id);
      if (!member) return [];
      const token = { ...member.token, column: p.column, row: p.row };
      delete token.offsetX;
      delete token.offsetY;
      const fogged = !manuallyVisible(sceneTokenPoint(map.grid!, token), settings.fog);
      return [{ token, fogged }];
    });
  }
  const plan = planAt(placeAnchor),
    ghosts = ghostsOf(plan);
  function rotatePlacing() {
    setPlacing((current) =>
      current
        ? {
            ...current,
            formation: { ...current.formation, rotation: (((current.formation.rotation + 90) % 360) as Formation["rotation"]) },
          }
        : current,
    );
  }
  function placingSpacing(delta: number) {
    setPlacing((current) =>
      current
        ? { ...current, formation: { ...current.formation, spacing: Math.max(0, Math.min(4, current.formation.spacing + delta)) } }
        : current,
    );
  }
  function commitPlacing(anchor?: { column: number; row: number }, current = placingNow) {
    if (!current || !map.grid || !anchor) return;
    setPlaceAnchor(anchor);
    const planned = planAt(anchor, current),
      ready = ghostsOf(planned, current);
    if (!ready.length || planned?.unplaced) {
      setError("There is no room here for every token. Choose another spot.");
      return;
    }
    if (current.mode === "keep") {
      saveMoves(
        ready.map((g) => {
          const before = current.members.find((m) => m.token.id === g.token.id)!.token;
          return {
            tokenId: g.token.id,
            before: position(before),
            after: { column: g.token.column, row: g.token.row },
          };
        }),
      );
      setPlacing(null);
      return;
    }
    const entries = ready.map((g) => {
      const member = current.members.find((m) => m.token.id === g.token.id)!;
      return { tokenId: g.token.id, before: member.before, token: g.token };
    });
    void act(
      { kind: "map-tokens-place", mapId: map.id, grid: map.grid, place: entries },
      () => {
        setPlacing(null);
        if (current.makeDefault)
          void act({
            kind: "tabletop-session",
            before: table.journal.world?.tabletop ?? null,
            session: { ...session, partyFormation: current.formation },
          });
        resultToast(`Placed ${entries.length} on ${map.name}`, {
          // The inverse: moved tokens go back, new ones are removed, only while every token is
          // still exactly as placed (`before` is the placed token, checked by the server).
          undo: () =>
            void act(placeUndo(map.id, map.grid!, entries)),
        });
      },
    );
  }
  /** The map menu's "Place party here" / "Place selected here": one placement at a point. */
  function placeAt(next: Omit<Placing, "formation"> & { formation?: Formation }, point: ScenePoint) {
    setError("");
    commitPlacing(squareAt(point), {
      ...next,
      formation: next.formation ?? session.partyFormation ?? DEFAULT_FORMATION,
    });
  }
  /** Place party, Place (the selection in a formation) or Move (the selection, same shape). */
  function startPlacing(next: Omit<Placing, "formation"> & { formation?: Formation }) {
    setError("");
    setInspector(false);
    setPlaceAnchor(undefined);
    setPlacing({ ...next, formation: next.formation ?? session.partyFormation ?? DEFAULT_FORMATION });
  }
  /** Place the player's own character token on the square under the point (map-token-claim). */
  function claimAt(purseId: string, point: ScenePoint) {
    if (!map.grid) return;
    const at = (settings.snap ? snapTokenPosition : freeTokenPosition)(map.grid, {}, point);
    if (!at) {
      setError("Choose a square inside the grid.");
      return;
    }
    void act(
      {
        kind: "map-token-claim",
        mapId: map.id,
        grid: canonicalJson(map.grid),
        purseId,
        tokenId: crypto.randomUUID(),
        at: { column: at.column, row: at.row, ...quadrant(at), ...(settings.snap ? {} : { offsetX: at.offsetX, offsetY: at.offsetY }) },
      },
      () => {
        setClaiming("");
        resultToast("Your token is on the map");
      },
    );
  }
  function saveMoves(next: Move[], grid = canonicalJson(map.grid)) {
    if (!next.length || !map.grid) return;
    if (
      next.some((move) => {
        const token = map.tokens?.find((t) => t.id === move.tokenId);
        return !tokenInsideGrid(map.grid!, { ...token, ...move.after });
      })
    ) {
      setError("Keep every selected token inside the grid.");
      return;
    }
    if (!dm && movementMode(map) === "approval") {
      // Each move waits for the DM; the token stays where it is until approved.
      movePreview.current = [];
      setMoves([]);
      for (const move of next)
        void act(
          { kind: "map-move-request", requestId: crypto.randomUUID(), mapId: map.id, grid, tokenId: move.tokenId, before: move.before, after: move.after },
          () => resultToast("Move sent to the DM"),
        );
      return;
    }
    movePreview.current = next;
    setMoves(next);
    void act(
      { kind: "map-token-move", mapId: map.id, grid, moves: next, ignoreWalls: dm && ignoreWalls },
      () => {
        movePreview.current = [];
        setMoves([]);
      },
    );
  }
  function applyShape(values = points) {
    const common = () => ({ id: crypto.randomUUID(), reveal });
    const [shape, ...continued] =
      tool === "fog-brush"
        ? finishStroke(
            stroke.current.points.length ? stroke.current : { points: values, frozen: 0 },
            radius,
          ).map((segment) => ({ ...common(), kind: "brush" as const, points: segment, radius }))
        : tool === "fog-polygon"
          ? [{ ...common(), kind: "polygon" as const, points: values.map(roundScenePoint) }]
          : [
              {
                ...common(),
                kind: "rectangle" as const,
                a: roundScenePoint(values[0]),
                b: roundScenePoint(values[values.length - 1]),
              },
            ];
    if (settings.fog.shapes.length + 1 + continued.length > 500) {
      setError(
        `This map already has ${settings.fog.shapes.length} of 500 fog shapes${continued.length ? ` and this stroke needs ${continued.length + 1}` : ""}. This stroke was not saved and your fog is unchanged. Consolidate fog in Exploration & lighting may free shapes; Reveal all or Conceal all starts a fresh fog layer.`,
      );
      return;
    }
    void act(
      {
        kind: "map-fog",
        mapId: map.id,
        before: settings.fog,
        action: "shape",
        shape,
        ...(continued.length ? { continued } : {}),
      },
      () => {
        stroke.current = { points: [], frozen: 0 };
        setPoints([]);
        setCursor(undefined);
      },
    );
  }
  function pointerUp(point: ScenePoint) {
    const current = gesture.current;
    gesture.current = undefined;
    if (!current) return false;
    // A tap inspects; dragging keeps the map unobstructed until the move ends.
    if (placing) {
      hover(point);
      commitPlacing(squareAt(point));
      return true;
    }
    if (current.box) {
      const left = Math.min(current.point.x, point.x),
        right = Math.max(current.point.x, point.x),
        top = Math.min(current.point.y, point.y),
        bottom = Math.max(current.point.y, point.y);
      const inside = (map.tokens ?? [])
        .filter((t) => {
          const p = sceneTokenPoint(map.grid!, t);
          return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
        })
        .map((t) => t.id);
      setBox(undefined);
      const next = [...new Set([...selected, ...inside])];
      setSelected(next);
      selectToken?.(next[0] ?? "");
      return true;
    }
    if (current.ids?.length && !current.moved && !selectMode) setInspector(true);
    if (current.claim) {
      if (!current.moved) claimAt(current.claim, point);
      return true;
    }
    if (current.token) {
      if (current.moved && movePreview.current.length) saveMoves(movePreview.current, current.grid);
      return true;
    }
    if (tool === "measure" || tool === "fog-polygon") {
      setPoints((values) => (values.length < 200 ? [...values, point] : values));
      return true;
    }
    if (tool === "fog-brush") applyShape(points.length ? points : [point]);
    else if (tool === "fog-rectangle") applyShape([current.point, point]);
    else if (tool === "wall") {
      const a = current.point,
        b = point;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 0.001)
        void configure(
          {
            ...settings,
            walls: [
              ...settings.walls,
              {
                id: crypto.randomUUID(),
                a,
                b,
                kind: wallKind,
                open: false,
                blocksSight: wallKind !== "window",
                blocksMovement: blockMovement,
              },
            ],
          },
          () => setPoints([]),
        );
    } else if (tool === "light")
      void configure({
        ...settings,
        lights: [
          ...settings.lights,
          {
            id: crypto.randomUUID(),
            at: point,
            radiusFeet: lightRadius / settings.unitsPerFoot,
            color: lightColor,
            visible: true,
          },
        ],
      });
    else if (tool === "template") {
      const template: AreaTemplate = {
        id: crypto.randomUUID(),
        label: "",
        kind: templateKind,
        origin: point,
        distanceFeet: distance / settings.unitsPerFoot,
        widthFeet: width / settings.unitsPerFoot,
        direction,
        angle,
        visibility: "party",
        controllerPurseId: dm ? undefined : seat.purseIds[0],
      };
      void act({
        kind: "map-template",
        mapId: map.id,
        templateId: template.id,
        before: null,
        template,
      });
    }
    return true;
  }
  function keyboard(event: KeyboardEvent, center?: ScenePoint) {
    if (placing) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPlacing(null);
        return true;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        rotatePlacing();
        return true;
      }
      if (event.key === "Enter" && center) {
        event.preventDefault();
        commitPlacing(squareAt(center));
        return true;
      }
    }
    if (dm && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && event.target === event.currentTarget) {
      event.preventDefault();
      const all = (map.tokens ?? []).map((t) => t.id);
      setSelected(all);
      selectToken?.(all[0] ?? "");
      return true;
    }
    if (event.key === "Escape") {
      setClaiming("");
      setSelectMode(false);
      cancel();
      return false;
    }
    if (event.target !== event.currentTarget) return false;
    // "Place my token": Enter places it at the keyboard crosshair.
    if (event.key === "Enter" && claiming && center) {
      event.preventDefault();
      claimAt(claiming, center);
      return true;
    }
    if (tool === "select" && selected.length && !event.altKey && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0,
        dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      saveMoves(
        selectedTokens.map((token) => ({
          tokenId: token.id,
          before: position(token),
          after: { ...position(token), column: token.column + dx, row: token.row + dy },
        })),
      );
      return true;
    }
    if (event.key === "Enter" && event.ctrlKey && tool === "fog-polygon" && points.length >= 3) {
      event.preventDefault();
      applyShape();
      return true;
    }
    if (event.key === "Enter" && center && tool !== "select" && tool !== "pan") {
      event.preventDefault();
      if (["fog-rectangle", "wall"].includes(tool) && !keyboardAnchor.current) {
        keyboardAnchor.current = center;
        setPoints([center]);
        return true;
      }
      gesture.current = { point: keyboardAnchor.current ?? center, moved: true };
      keyboardAnchor.current = undefined;
      pointerUp(center);
      return true;
    }
    return false;
  }
  const measurePoints = [...points, ...(tool === "measure" && cursor ? [cursor] : [])],
    // A grid always wins; an ungridded map measures with its scale bar (journey planner).
    measured = map.grid
      ? sceneRouteDistance(map.grid, measurePoints) * settings.unitsPerFoot
      : map.scale
        ? measurePoints
            .slice(1)
            .reduce((sum, p, i) => sum + scaleDistance(map.scale!, measurePoints[i], p), 0)
        : 0,
    measureUnit = map.grid ? settings.unitLabel : (map.scale?.unit ?? settings.unitLabel);
  const contextControls = (
    <div className="map-context-fields">
      {" "}
      {tool === "measure" && (
        <div className="tabletop-tool-row">
          <output aria-label="Measured distance">
            {measured.toFixed(1)} {measureUnit}
          </output>
          <Button
            onClick={() => {
              setPoints([]);
              setCursor(undefined);
            }}
          >
            Clear measurement
          </Button>
          <Button
            disabled={!points.length}
            onClick={() => setPoints((values) => values.slice(0, -1))}
          >
            Undo waypoint
          </Button>
          {!map.grid && !map.scale && (
            <span>Configure a grid or set the map's scale bar to measure.</span>
          )}
        </div>
      )}
      {tool === "template" && (
        <div className="tabletop-tool-settings">
          <label>
            Shape
            <select
              value={templateKind}
              onChange={(event) => setTemplateKind(event.target.value as AreaTemplate["kind"])}
            >
              <option value="circle">Circle</option>
              <option value="cone">Cone</option>
              <option value="ray">Line</option>
              <option value="rectangle">Rectangle</option>
            </select>
          </label>
          <label>
            Distance ({settings.unitLabel})
            <input
              type="number"
              min="0.1"
              step="any"
              value={distance}
              onChange={(event) => setDistance(Number(event.target.value))}
            />
          </label>
          <label>
            Width ({settings.unitLabel})
            <input
              type="number"
              min="0.1"
              step="any"
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
          </label>
          <label>
            Direction °
            <input
              type="number"
              min="0"
              max="360"
              value={direction}
              onChange={(event) => setDirection(Number(event.target.value))}
            />
          </label>
          {templateKind === "cone" && (
            <label>
              Cone angle °
              <input
                type="number"
                min="1"
                max="360"
                value={angle}
                onChange={(event) => setAngle(Number(event.target.value))}
              />
            </label>
          )}
          <span>Tap an origin to save a visible area. No damage or rules are applied.</span>
        </div>
      )}
      {dm && (
        <>
          {" "}
          {tool.startsWith("fog-") && (
            <div className="tabletop-tool-settings">
              <label>
                Operation
                <select
                  value={reveal ? "reveal" : "conceal"}
                  onChange={(event) => setReveal(event.target.value === "reveal")}
                >
                  <option value="reveal">Reveal</option>
                  <option value="conceal">Conceal</option>
                </select>
              </label>
              {tool === "fog-brush" && (
                <label>
                  Brush size
                  <input
                    type="range"
                    min="0.005"
                    max="0.2"
                    step="0.005"
                    value={radius}
                    onChange={(event) => setRadius(Number(event.target.value))}
                  />
                </label>
              )}
              {tool === "fog-polygon" && (
                <Button disabled={points.length < 3 || disabled} onClick={() => applyShape()}>
                  Apply polygon ({points.length} points)
                </Button>
              )}
            </div>
          )}
          {tool === "wall" && (
            <div className="tabletop-tool-settings">
              <label>
                Segment
                <select
                  value={wallKind}
                  onChange={(event) => setWallKind(event.target.value as typeof wallKind)}
                >
                  <option value="wall">Wall</option>
                  <option value="door">Door</option>
                  <option value="window">Window</option>
                  <option value="secret-door">Secret door</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={blockMovement}
                  onChange={(event) => setBlockMovement(event.target.checked)}
                />
                Also block token movement
              </label>
              <span>Drag a segment. Doors are controlled in the inspector.</span>
            </div>
          )}
          {tool === "light" && (
            <div className="tabletop-tool-settings">
              <label>
                Light radius ({settings.unitLabel})
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={lightRadius}
                  onChange={(event) => setLightRadius(Number(event.target.value))}
                />
              </label>
              <label>
                Light color
                <input
                  type="color"
                  value={lightColor}
                  onChange={(event) => setLightColor(event.target.value)}
                />
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
  const shapeCount = (n: number) => `${n} ${n === 1 ? "shape" : "shapes"}`;
  // A proposal is shown only while the fog it was computed from is still current.
  const consolidationProposal =
    consolidation && canonicalJson(consolidation.from) === canonicalJson(settings.fog)
      ? consolidation
      : null;
  const fogBytes = dm ? fogStorageBytes(settings) : 0,
    fogLarge = fogBytes >= 400_000 || settings.fog.shapes.length >= 450;
  /** Fog actions and storage: Settings › Exploration & lighting and each fog tool's panel. */
  const fogActions = dm && (
    <>
          <div className="tabletop-tool-row">
            {(
              [
                "undo",
                "redo",
                "reveal-all",
                "conceal-all",
                settings.fog.enabled ? "disable" : "enable",
              ] as const
            ).map((action) => (
              <Button
                key={action}
                variant="secondary"
                disabled={
                  disabled ||
                  (action === "undo" && !settings.fogUndo.length) ||
                  (action === "redo" && !settings.fogRedo.length)
                }
                onClick={() =>
                  void act({ kind: "map-fog", mapId: map.id, before: settings.fog, action })
                }
              >
                {
                  {
                    undo: "Undo fog",
                    redo: "Redo fog",
                    "reveal-all": "Reveal all",
                    "conceal-all": "Conceal all",
                    enable: "Enable manual fog",
                    disable: "Disable manual fog",
                  }[action]
                }
              </Button>
            ))}
          </div>
          <p role={fogLarge ? "alert" : "status"} data-fog-storage={fogBytes}>
            Fog storage: {settings.fog.shapes.length} of 500 shapes ·{" "}
            {Math.max(1, Math.round(fogBytes / 1000))} KB including undo history
            {fogLarge &&
              `. This map's fog is getting large; a shared campaign stops saving above ${ROOM_LIMIT_TEXT} in total. Consolidate fog, or prefer rectangles, polygons or a larger brush for big areas.`}
          </p>
          {consolidationProposal ? (
            <div
              className="fog-consolidate-confirm"
              role="group"
              aria-labelledby="fog-consolidate-title"
            >
              <p id="fog-consolidate-title">
                <strong>
                  Consolidate fog: {shapeCount(consolidationProposal.before)} →{" "}
                  {shapeCount(consolidationProposal.after)}
                </strong>
              </p>
              <p>
                {consolidationProposal.removed} with no visible effect removed
                {consolidationProposal.merged
                  ? `, ${consolidationProposal.merged} fewer after merging rectangles`
                  : ""}
            . What players see stays exactly the same. Brush strokes, ellipses and freehand polygons
            that still show are kept as they are. Afterwards fog storage is about{" "}
            {Math.max(1, Math.round(consolidationProposal.bytes / 1000))} KB including undo history.
              </p>
              <p>
            One Undo fog restores the separate shapes. Earlier undo steps stay unchanged (as with
            any fog change, the oldest is dropped once 20 are saved), and Redo fog is cleared.
              </p>
              <div className="tabletop-tool-row">
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void act(
                      {
                        kind: "map-fog",
                        mapId: map.id,
                        before: consolidationProposal.from,
                        action: "consolidate",
                        result: consolidationProposal.fog,
                      },
                      () => setConsolidation(null),
                    )
                  }
                >
                  Consolidate to {shapeCount(consolidationProposal.after)}
                </Button>
                <Button variant="secondary" onClick={() => setConsolidation(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              disabled={disabled || !settings.fog.shapes.length}
              onClick={() => {
                setError("");
                const proposal = consolidateFog(settings.fog);
                if (canonicalJson(proposal.fog) === canonicalJson(settings.fog)) {
                  setConsolidation(null);
                  setNotice(
                    `Fog is already consolidated: none of its ${settings.fog.shapes.length} shapes can be merged or removed without changing what players see.`,
                  );
                  return;
                }
                setNotice("");
                setConsolidation({
                  ...proposal,
                  from: structuredClone(settings.fog),
                  bytes: fogStorageBytes({
                    fog: proposal.fog,
                    fogUndo: [...settings.fogUndo.slice(-19), fogDiff(proposal.fog, settings.fog)],
                    fogRedo: [],
                  }),
                });
              }}
            >
              Consolidate fog…
            </Button>
          )}
          <Button aria-pressed={showPreview} onClick={() => setShowPreview(!showPreview)}>
            Player-view preview
          </Button>
    </>
  );
  const sceneControls = dm && <SceneConfiguration map={map} />;
  const explorationControls = dm && <Fold title="Exploration & lighting">{fogActions}</Fold>;
  const configurationControls = (
    <>
      {sceneControls}
      {explorationControls}
    </>
  );
  const activateTool = (next: MapTool): boolean => {
    // After "Discard changes" the same tool is chosen again (its result is no longer awaited).
    if (!allowContextChange(() => void activateTool(next))) return false;
    if (["fog-brush", "fog-rectangle", "fog-polygon", "wall", "light"].includes(next) && !dm)
      return false;
    if (next === "template" && !dm && !settings.playerTemplates) return false;
    cancel();
    setTool(next);
    return true;
  };
  const feedback = (
    <>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {cloud.joined && (
        <p
          className="tabletop-connection"
          data-idle={
            cloud.status !== "attention" &&
            cloud.status !== "saving" &&
            !cloud.pending &&
            cloud.mine
          }
          role="status"
        >
          {cloud.status === "attention"
            ? `Reconnect required · ${cloud.error}`
            : cloud.status === "saving"
              ? "Sending map changes…"
              : cloud.pending
                ? `${cloud.pending} action(s) pending`
                : "Shared campaign connected"}
          {!cloud.mine && ` · Waiting for ${cloud.who}`}
        </p>
      )}
    </>
  );
  /** The walls and lights lists: the inspector and the Walls & doors / Lights panels. */
  const wallsList = dm && (
    <>
            {settings.walls.map((wall) => (
              <div className="world-row" key={wall.id}>
                <span>
                  {wall.kind} · {wall.open ? "open" : "closed"}
                </span>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void configure({
                      ...settings,
                      walls: settings.walls.map((value) =>
                        value.id === wall.id ? { ...value, open: !value.open } : value,
                      ),
                    })
                  }
                >
                  {wall.open ? "Close" : "Open"}
                </Button>
                <Button
                  disabled={disabled}
                  variant="ghost"
                  onClick={() =>
                    void configure({
                      ...settings,
                      walls: settings.walls.filter((value) => value.id !== wall.id),
                    })
                  }
                >
                  Remove segment
                </Button>
              </div>
            ))}
    </>
  );
  const lightsList = dm && (
    <>
            {settings.lights.map((light) => (
              <div className="world-row" key={light.id}>
                <span>
                  {(light.radiusFeet * settings.unitsPerFoot).toFixed(1)} {settings.unitLabel}
                </span>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void configure({
                      ...settings,
                      lights: settings.lights.map((value) =>
                        value.id === light.id ? { ...value, visible: !value.visible } : value,
                      ),
                    })
                  }
                >
                  {light.visible ? "Extinguish" : "Light"}
                </Button>
                <Button
                  disabled={disabled}
                  variant="ghost"
                  onClick={() =>
                    void configure({
                      ...settings,
                      lights: settings.lights.filter((value) => value.id !== light.id),
                    })
                  }
                >
                  Remove light
                </Button>
              </div>
            ))}
    </>
  );
  // Grid mode (map tokens 1b, owner 2026-10-29): the shared snap setting. Turning it off never
  // moves a token; turning it on offers to snap the tokens between squares (one undoable command)
  // or to align the grid under them.
  const unsnapped = (map.tokens ?? []).filter((token) => !tokenSnapped(token));
  function setGridMode(on: boolean) {
    if (!dm || !map.grid || disabled) return;
    setGridError("");
    if (!on || !unsnapped.length) {
      void configure({ ...settings, snap: on }, () =>
        resultToast(on ? "Grid mode on" : "Grid mode off · tokens stay where they are"),
      );
      return;
    }
    setGridDialog("snap");
  }
  function snapAll() {
    if (!map.grid) return;
    const moves = unsnapped.map((token) => ({
      tokenId: token.id,
      before: position(token),
      after: nearestSnapped(map.grid!, token),
    }));
    const grid = canonicalJson(map.grid);
    void act(
      { kind: "map-grid-snap", mapId: map.id, grid, before: map.tabletop ?? null, snap: true, moves },
      () => {
        setGridDialog(null);
        resultToast(`Grid mode on · ${moves.length} ${moves.length === 1 ? "token" : "tokens"} snapped`, {
          // The inverse command, checked against the map as it is when Undo is chosen.
          undo: () =>
            void act({
              kind: "map-grid-snap",
              mapId: map.id,
              grid,
              before: latest.current.tabletop ?? null,
              snap: false,
              moves: moves.map((move) => ({
                tokenId: move.tokenId,
                before: move.after,
                after: move.before,
              })),
            }),
        });
      },
    );
  }
  function alignGrid() {
    if (!map.grid) return;
    const aligned = alignedGrid(map.grid, map.tokens ?? []);
    if (!aligned) {
      setGridError(
        "The grid can't shift under these tokens without leaving the map art. Snap the tokens instead.",
      );
      return;
    }
    const previous = map;
    const next = { ...map, grid: aligned.grid, tokens: aligned.tokens, tabletop: { ...settings, snap: true } };
    void act({ kind: "map-save", mapId: map.id, before: map, map: next }, () => {
      setGridDialog(null);
      resultToast("Grid mode on · grid aligned under the tokens", {
        // Only while nothing changed since the align; the save is checked against `current`.
        undo: () => {
          const current = latest.current;
          const restored = alignUndoMap(current, next, previous);
          if (!restored) {
            setError("The map changed since; undo not available.");
            return;
          }
          void act({ kind: "map-save", mapId: map.id, before: current, map: restored });
        },
      });
    });
  }
  const gridModeDialog = gridDialog && (
    <GridModeDialog
      count={unsnapped.length}
      choice={gridDialog}
      setChoice={setGridDialog}
      busy={disabled}
      error={gridError || error}
      onConfirm={() => (gridDialog === "snap" ? snapAll() : alignGrid())}
      onJustTurnOn={() =>
        void configure({ ...settings, snap: true }, () => {
          setGridDialog(null);
          resultToast("Grid mode on · tokens left as they are");
        })
      }
      onCancel={() => {
        setGridDialog(null);
        setGridError("");
      }}
    />
  );
  const gridModeSelect = dm && map.grid && (
    <label className="tabletop-grid-mode">
      Grid mode
      <select
        aria-label="Grid mode"
        value={settings.snap ? "on" : "off"}
        disabled={disabled}
        onChange={(event) => setGridMode(event.target.value === "on")}
      >
        <option value="on">On · snap to squares</option>
        <option value="off">Off · move freely</option>
      </select>
    </label>
  );
  const panel = inspector && (
    <aside className="tabletop-inspector" aria-label="Map inspector">
      <div className="world-row">
        <strong>Map inspector</strong>
        <Button
          variant="ghost"
          onClick={() => {
            setInspector(false);
            setSelected([]);
            selectToken?.("");
          }}
        >
          Close inspector
        </Button>
      </div>
      {selectedTokens.length ? (
        <>
          <p>
            {selectedTokens.length} selected ·{" "}
            {selectedTokens.map((token) => token.label).join(", ")}
          </p>
          {dm && map.grid && (
            // Group commands (map tokens PR 3): back to the map with taps adding tokens.
            <Button
              variant="secondary"
              onClick={() => {
                setInspector(false);
                setSelectMode(true);
              }}
            >
              Select more tokens
            </Button>
          )}
          <div className="tabletop-token-list">
            {(map.tokens ?? []).map((token) => (
              <label key={token.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(token.id)}
                  onChange={() => choose(token.id, true)}
                />
                {token.label}
                {token.locked ? " · locked" : ""}
              </label>
            ))}
          </div>
          <Button disabled={!moves.length || disabled} onClick={() => saveMoves(moves)}>
            Retry / confirm previewed move
          </Button>
          {dm && (
            <label>
              <input
                type="checkbox"
                checked={ignoreWalls}
                onChange={(event) => setIgnoreWalls(event.target.checked)}
              />
              DM override configured movement barriers
            </label>
          )}
          {selectedTokens.length === 1 && (
            <TokenInspector
              gridMode={gridModeSelect}
              key={selectedTokens[0].id}
              map={map}
              token={selectedTokens[0]}
              canMove={canMoveMapToken(table, map, selectedTokens[0], seat)}
              move={(move) => saveMoves([move])}
            />
          )}
        </>
      ) : (
        <p>Select a token or record to inspect it. Map settings remain available below.</p>
      )}
      {dm && (
        <>
          <SceneConfiguration map={map} />
          <Fold title={`Walls & doors (${settings.walls.length})`}>{wallsList}</Fold>
          <Fold title={`Lights (${settings.lights.length})`}>{lightsList}</Fold>
        </>
      )}
      <Fold title={`Persistent areas (${settings.templates.length})`}>
        {settings.templates.map((template) => (
          <div className="world-row" key={template.id}>
            <span>
              {template.label || template.kind} ·{" "}
              {(template.distanceFeet * settings.unitsPerFoot).toFixed(1)} {settings.unitLabel}
            </span>
            {(dm ||
              (template.controllerPurseId &&
                seat.purseIds.includes(template.controllerPurseId))) && (
              <CommandButton
                input={{
                  kind: "map-template",
                  mapId: map.id,
                  templateId: template.id,
                  before: template,
                  template: null,
                }}
              >
                Remove area
              </CommandButton>
            )}
          </div>
        ))}
      </Fold>
      {dm && (
        <AppLink href="/encounters" className="settings-link">
          Open encounters →
        </AppLink>
      )}
      {dm && import.meta.env.VITE_MOBILE !== "true" && (
        <Button
          onClick={() => {
            try {
              openWorkspaceWindow("/encounters", "window");
            } catch (error) {
              setError(error instanceof Error ? error.message : "Window unavailable.");
            }
          }}
        >
          Open encounter window
        </Button>
      )}
      <p className="text-sm text-muted">
        Token moves and tools never grant loot, move wealth, change boarding or advance campaign
        time.
      </p>
    </aside>
  );
  const overlay = (
    <svg
      className="tabletop-overlay"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {map.grid &&
        map.tokens
          // The legacy visual scale; footprint tokens draw their footprint (map-token-layer.tsx).
          ?.filter(
            (token) =>
              token.style && !token.sizeClass && token.footprint === undefined && !token.anchor,
          )
          .map((token) => {
            const p = sceneTokenPoint(map.grid!, token);
            return (
              <ellipse
                key={`footprint-${token.id}`}
                fill={`${token.style!.color ?? "#d8b76d"}30`}
                stroke={token.style!.color ?? "#d8b76d"}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                cx={p.x * 1000}
                cy={p.y * 1000}
                rx={((500 * map.grid!.width) / map.grid!.columns) * token.style!.size}
                ry={((500 * map.grid!.height) / map.grid!.rows) * token.style!.size}
              />
            );
          })}
      {dm &&
        settings.walls.map((wall) => (
          <line
            key={wall.id}
            x1={wall.a.x * 1000}
            y1={wall.a.y * 1000}
            x2={wall.b.x * 1000}
            y2={wall.b.y * 1000}
            className={`tabletop-wall ${wall.open ? "open" : ""} ${wall.kind}`}
          />
        ))}
      {map.grid &&
        settings.templates.map((template) => (
          <TemplateShape key={template.id} map={map} template={template} />
        ))}
      {map.grid &&
        selectedTokens
          // A token being dragged is drawn as a ghost with its target (map-token-layer.tsx).
          .filter((token) => !moves.some((move) => move.tokenId === token.id))
          .map((token) => {
            const p = sceneTokenPoint(map.grid!, token),
              scale =
                token.anchor || token.sizeClass || token.footprint
                  ? tokenBox(token).size
                  : (token.style?.size ?? 1);
          return (
            <ellipse
              key={token.id}
              className="tabletop-selection"
              cx={p.x * 1000}
              cy={p.y * 1000}
                rx={((500 * map.grid!.width) / map.grid!.columns) * scale}
                ry={((500 * map.grid!.height) / map.grid!.rows) * scale}
              />
          );
        })}
      {tool === "measure" && (
        <polyline
          className="tabletop-measure"
          points={measurePoints.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")}
        />
      )}
      {points.length > 0 && tool === "fog-rectangle" && (
        <rect
          className="tabletop-draft"
          x={Math.min(points[0].x, points.at(-1)!.x) * 1000}
          y={Math.min(points[0].y, points.at(-1)!.y) * 1000}
          width={Math.abs(points[0].x - points.at(-1)!.x) * 1000}
          height={Math.abs(points[0].y - points.at(-1)!.y) * 1000}
        />
      )}
      {points.length > 0 && ["fog-brush", "fog-polygon", "wall"].includes(tool) && (
        <polyline
          className="tabletop-draft"
          style={tool === "fog-brush" ? { strokeWidth: radius * 2000 } : undefined}
          points={[...points, ...(tool === "fog-polygon" && cursor ? [cursor] : [])]
            .map((point) => `${point.x * 1000},${point.y * 1000}`)
            .join(" ")}
        />
      )}
    </svg>
  );
  const shareCamera = (view: SceneCamera) =>
    act({
      kind: "tabletop-session",
      before: table.journal.world?.tabletop ?? null,
      session: { ...session, camera: { mapId: map.id, view, nonce: crypto.randomUUID() } },
    });
  const saveInitialView = (view: SceneCamera) => configure({ ...settings, initialView: view });
  return {
    tool,
    activateTool,
    contextControls,
    configurationControls,
    sceneControls,
    explorationControls,
    fogActions,
    wallsList,
    lightsList,
    playerTemplates: dm || settings.playerTemplates,
    undoFog: () => act({ kind: "map-fog", mapId: map.id, before: settings.fog, action: "undo" }),
    redoFog: () => act({ kind: "map-fog", mapId: map.id, before: settings.fog, action: "redo" }),
    canUndoFog: dm && !disabled && !!settings.fogUndo.length,
    canRedoFog: dm && !disabled && !!settings.fogRedo.length,
    openInspector: () => setInspector(true),
    feedback,
    toolLabel: toolNames[tool],
    measurement: tool === "measure" ? `${measured.toFixed(1)} ${measureUnit}` : "",
    inspecting: inspector,
    hideInspector: () => setInspector(false),
    panel,
    overlay,
    pointerDown,
    pointerMove,
    pointerUp,
    keyboard,
    choose,
    cancel,
    shareCamera,
    saveInitialView,
    selected,
    /** The map menu (map tokens PR 4): actions at a chosen point. */
    menu: {
      /** Measure from here: the ruler starts at the point (after Measure is chosen). */
      measureFrom: (point: ScenePoint) => {
        setPoints([point]);
        setCursor(point);
      },
      /** Reveal around here: one brush circle with the current brush radius (Fog brush). */
      revealAround: (point: ScenePoint) => {
        if (!dm) return;
        if (settings.fog.shapes.length + 1 > 500) {
          setError(`This map already has ${settings.fog.shapes.length} of 500 fog shapes. Consolidate fog in Exploration & lighting first.`);
          return;
        }
        void act({
          kind: "map-fog",
          mapId: map.id,
          before: settings.fog,
          action: "shape",
          shape: { id: crypto.randomUUID(), reveal: true, kind: "brush", points: [roundScenePoint(point)], radius },
        });
      },
      /** Add light here: a light with the Lights tool's current radius and colour. */
      addLightAt: (point: ScenePoint) => {
        if (!dm) return;
        void configure({
          ...settings,
          lights: [
            ...settings.lights,
            { id: crypto.randomUUID(), at: roundScenePoint(point), radiusFeet: lightRadius / settings.unitsPerFoot, color: lightColor, visible: true },
          ],
        });
      },
      /** Select exactly these tokens (right-click on a token that is not in the selection). */
      selectOnly: (ids: string[]) => {
        setSelected(ids);
        selectToken?.(ids[0] ?? "");
      },
      placeAt,
      /** Place my token here (players): the same map-token-claim as "Place my token". */
      claimAt,
    },
    /** The move being previewed (dragging, or kept after a refused save). */
    moves,
    gridMode: { on: settings.snap, set: setGridMode, dialog: gridModeDialog, select: gridModeSelect },
    /** Player movement: arm "Place my token", and the token whose press was refused this turn. */
    claim: { purseId: claiming, start: setClaiming, cancel: () => setClaiming("") },
    notTurn,
    /** Group placement and selection (map tokens PR 3). */
    group: {
      placing,
      setPlacing,
      startPlacing,
      plan,
      ghosts,
      anchor: placeAnchor,
      rotate: rotatePlacing,
      spacing: placingSpacing,
      hover,
      box,
      selectMode,
      setSelectMode,
      selectedTokens,
      clear: () => {
        setSelected([]);
        selectToken?.("");
        setSelectMode(false);
      },
      act,
    },
    showPreview,
    session,
    busy: disabled,
  };
}
