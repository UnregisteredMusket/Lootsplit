import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useEconomy } from "@/lib/quire/economy-context";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { readMapTabletop, readTabletopSession, canMoveMapToken } from "@/lib/quire/tabletop";
import { sceneDistance, sceneTokenPoint } from "@/lib/quire/tabletop-geometry";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { allowContextChange, useDraftGuard } from "@/lib/quire/use-draft-guard";
import { openWorkspaceWindow } from "@/lib/quire/workspace-windows";
import type { CampaignMap, MapToken } from "@/lib/quire/world-schema";
import type {
  MapTabletop,
  ScenePoint,
  AreaTemplate,
  SceneCamera,
} from "@/lib/quire/tabletop-schema";
import type { CommandInput } from "@/lib/quire/commands";
import { Button, Fold } from "./ui";
import { CommandButton } from "./world-tools";
import { TemplateShape, TokenInspector, SceneConfiguration } from "./map-tabletop-inspector";
import { AppLink } from "./app-link";

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
    [showPreview, setShowPreview] = useState(false);
  const gesture = useRef<
      | { point: ScenePoint; token?: MapToken; ids?: string[]; grid?: string; moved: boolean }
      | undefined
    >(undefined),
    movePreview = useRef<Move[]>([]),
    keyboardAnchor = useRef<ScenePoint | undefined>(undefined);
  const disabled = busy || cloud.viewOnly || (cloud.joined && !cloud.mine);
  const selectedTokens = (map.tokens ?? []).filter((token) => selected.includes(token.id));
  const cancel = () => {
    gesture.current = undefined;
    movePreview.current = [];
    keyboardAnchor.current = undefined;
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
    }
    // The parent also services the preserved exact-position forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken]);
  useEffect(() => {
    cancel();
    setSelected([]);
    setInspector(false);
    setShowPreview(false);
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
  function gridPosition(point: ScenePoint): Position | undefined {
    if (!map.grid) return;
    const x = ((point.x - map.grid.x) / map.grid.width) * map.grid.columns,
      y = ((point.y - map.grid.y) / map.grid.height) * map.grid.rows;
    if (x < 0 || y < 0 || x >= map.grid.columns || y >= map.grid.rows) return;
    const column = Math.floor(x),
      row = Math.floor(y);
    return {
      column,
      row,
      ...(settings.snap ? {} : { offsetX: x - column - 0.5, offsetY: y - row - 0.5 }),
    };
  }
  function pointerDown(point: ScenePoint, tokenId?: string, additive = false) {
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
      gesture.current = {
        point,
        token: !disabled && canMoveMapToken(table, map, token, seat) ? token : undefined,
        ids,
        grid: canonicalJson(map.grid),
        moved: false,
      };
      return true;
    }
    if (tool === "pan" || tool === "select") return false;
    gesture.current = { point, moved: false };
    if (["fog-brush", "fog-rectangle", "wall"].includes(tool)) setPoints([point]);
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
    if (current.token && map.grid) {
      const destination = gridPosition(point);
      if (!destination) {
        movePreview.current = [];
        setMoves([]);
        return true;
      }
      const dx =
          destination.column +
          (destination.offsetX ?? 0) -
          current.token.column -
          (current.token.offsetX ?? 0),
        dy =
          destination.row +
          (destination.offsetY ?? 0) -
          current.token.row -
          (current.token.offsetY ?? 0);
      const preview = (map.tokens ?? [])
        .filter((token) => current.ids?.includes(token.id))
        .map((token) => {
          const x = token.column + 0.5 + (token.offsetX ?? 0) + dx,
            y = token.row + 0.5 + (token.offsetY ?? 0) + dy,
            column = Math.floor(x),
            row = Math.floor(y);
          return {
            tokenId: token.id,
            before: position(token),
            after: {
              column,
              row,
              ...(settings.snap ? {} : { offsetX: x - column - 0.5, offsetY: y - row - 0.5 }),
            },
          };
        });
      movePreview.current = preview;
      setMoves(preview);
    } else if (tool === "fog-brush")
      setPoints((values) => (values.length < 200 ? [...values, point] : values));
    else if (tool === "fog-rectangle" || tool === "wall") setPoints([current.point, point]);
    return true;
  }
  function saveMoves(next: Move[], grid = canonicalJson(map.grid)) {
    if (!next.length || !map.grid) return;
    if (
      next.some(
        (move) =>
          move.after.column < 0 ||
          move.after.row < 0 ||
          move.after.column >= map.grid!.columns ||
          move.after.row >= map.grid!.rows,
      )
    ) {
      setError("Keep every selected token inside the grid.");
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
    const common = { id: crypto.randomUUID(), reveal };
    const shape =
      tool === "fog-brush"
        ? { ...common, kind: "brush" as const, points: values, radius }
        : tool === "fog-polygon"
          ? { ...common, kind: "polygon" as const, points: values }
          : { ...common, kind: "rectangle" as const, a: values[0], b: values[values.length - 1] };
    void act(
      { kind: "map-fog", mapId: map.id, before: settings.fog, action: "shape", shape },
      () => {
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
    if (current.ids?.length && !current.moved) setInspector(true);
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
    if (event.key === "Escape") {
      cancel();
      return false;
    }
    if (event.target !== event.currentTarget) return false;
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
    measured = map.grid
      ? measurePoints.reduce(
          (sum, point, i) => sum + (i ? sceneDistance(map.grid!, measurePoints[i - 1], point) : 0),
          0,
        ) * settings.unitsPerFoot
      : 0;
  const contextControls = (
    <div className="map-context-fields">
      {" "}
      {tool === "measure" && (
        <div className="tabletop-tool-row">
          <output aria-label="Measured distance">
            {measured.toFixed(1)} {settings.unitLabel}
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
          {!map.grid && <span>Configure a grid scale to measure.</span>}
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
  const configurationControls = (
    <>
      {dm && <SceneConfiguration map={map} />}
      {dm && (
        <Fold title="Exploration & lighting">
          {" "}
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
          <Button aria-pressed={showPreview} onClick={() => setShowPreview(!showPreview)}>
            Player-view preview
          </Button>
        </Fold>
      )}
    </>
  );
  const activateTool = (next: MapTool) => {
    if (!allowContextChange()) return false;
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
          <Fold title={`Walls & doors (${settings.walls.length})`}>
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
          </Fold>
          <Fold title={`Lights (${settings.lights.length})`}>
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
          </Fold>
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
          ?.filter((token) => token.style)
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
        selectedTokens.map((token) => {
          const p = sceneTokenPoint(map.grid!, token);
          return (
            <ellipse
              key={token.id}
              className="tabletop-selection"
              cx={p.x * 1000}
              cy={p.y * 1000}
              rx={((500 * map.grid!.width) / map.grid!.columns) * (token.style?.size ?? 1)}
              ry={((500 * map.grid!.height) / map.grid!.rows) * (token.style?.size ?? 1)}
            />
          );
        })}
      {map.grid &&
        moves.map((move) => {
          const a = sceneTokenPoint(map.grid!, move.before),
            b = sceneTokenPoint(map.grid!, move.after);
          return (
            <g key={move.tokenId}>
              <line
                className="tabletop-measure"
                x1={a.x * 1000}
                y1={a.y * 1000}
                x2={b.x * 1000}
                y2={b.y * 1000}
              />
              <circle className="tabletop-ghost" cx={b.x * 1000} cy={b.y * 1000} r="12" />
              <text x={b.x * 1000 + 15} y={b.y * 1000}>
                {(sceneDistance(map.grid!, a, b) * settings.unitsPerFoot).toFixed(1)}{" "}
                {settings.unitLabel}
              </text>
            </g>
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
    playerTemplates: dm || settings.playerTemplates,
    undoFog: () => act({ kind: "map-fog", mapId: map.id, before: settings.fog, action: "undo" }),
    redoFog: () => act({ kind: "map-fog", mapId: map.id, before: settings.fog, action: "redo" }),
    canUndoFog: dm && !disabled && !!settings.fogUndo.length,
    canRedoFog: dm && !disabled && !!settings.fogRedo.length,
    openInspector: () => setInspector(true),
    feedback,
    toolLabel: toolNames[tool],
    measurement: tool === "measure" ? `${measured.toFixed(1)} ${settings.unitLabel}` : "",
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
    showPreview,
    session,
    busy: disabled,
  };
}
