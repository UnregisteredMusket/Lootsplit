/**
 * Journey planner, phase A (docs/MAP-TILES.md "Journey planner"): the "Plan route" map tool.
 * Tap the map to add waypoints that snap to anchored places (and to tile centres on a grid);
 * the leg list shows distance, terrain and days. Ship voyages route on gridded maps and fill the
 * existing voyage form (`mapRoute` plus its typed `column,row` field). Ungridded maps get a
 * one-time scale bar, saved by the DM with the existing `map-save`. Drawing changes nothing in
 * the campaign.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSeat } from "@/lib/quire/seat";
import type { CloudTable } from "@/lib/quire/cloud";
import {
  travelEnvironments,
  wildernessBiomes,
  mapScaleSchema,
  type CampaignMap,
  type MapScale,
} from "@/lib/quire/world-schema";
import {
  formatMiles,
  formatTileList,
  legDayRange,
  legDays,
  legDeciMiles,
  parseTileList,
  routeFrame,
  scaleWidthPercent,
  snapRoutePoint,
  toMiles,
  scaleDistance,
  type RoutePoint,
} from "@/lib/quire/journey";
import { tileAt, tilePoint } from "@/lib/quire/map-tiles";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { readFleet } from "@/lib/quire/ships-schema";
import { readEstate } from "@/lib/quire/estate-schema";
import { canAccessEstate } from "@/lib/quire/estate";
import { setVoyageRouteDraft } from "@/lib/quire/voyage-route-draft";
import { allowContextChange, useDraftGuard } from "@/lib/quire/use-draft-guard";
import { CommandForm } from "./world-tools";
import { Button, Segmented } from "./ui";
import { Route as RouteIcon, Ruler, Ship, Undo2, X } from "lucide-react";

export type Waypoint = RoutePoint & { locationId?: string };
export type LegTerrain = {
  environment: (typeof travelEnvironments)[number];
  biome?: (typeof wildernessBiomes)[number];
};
export type RouteDraft = {
  kind: "party" | "ship";
  points: Waypoint[];
  terrain: LegTerrain[];
};
/** Default pace (normal, 24 mi/day) until the campaign's travel settings say otherwise. */
export const DEFAULT_PACE = 24;
const terrainOptions: { value: string; label: string }[] = [
  ...travelEnvironments
    .filter((e) => e !== "Wilderness")
    .map((e) => ({ value: e, label: e })),
  ...wildernessBiomes.map((b) => ({ value: `Wilderness|${b}`, label: `Wilderness · ${b}` })),
];
const terrainValue = (t: LegTerrain) => (t.biome ? `${t.environment}|${t.biome}` : t.environment);
const terrainOf = (value: string): LegTerrain => {
  const [environment, biome] = value.split("|") as [LegTerrain["environment"], LegTerrain["biome"]];
  return biome ? { environment, biome } : { environment };
};
export const terrainLabel = (t: LegTerrain) =>
  t.biome ? `${t.environment} · ${t.biome}` : t.environment;
const defaultTerrain = (a?: Waypoint, b?: Waypoint): LegTerrain =>
  a?.locationId && b?.locationId ? { environment: "Roads" } : { environment: "Wilderness", biome: "Grassland" };
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

type Screen = (p: RoutePoint) => { x: number; y: number };
type Props = {
  map: CampaignMap;
  table: CloudTable;
  /** Image width ÷ height, so taps snap and scale bars measure in true proportions. */
  aspect: number;
  /** Map point → viewport pixels (relative to the interactive map region). */
  toScreen: Screen;
  /** Client coordinates → map point (clamped). */
  toMap: (clientX: number, clientY: number) => RoutePoint;
  /** Where the party starts (its location's anchor or free position on this map). */
  partyStart?: Waypoint;
  /** Open a ship's existing record (its voyage form) after "Use in voyage request". */
  openShip?: (propertyId: string) => void;
  /** Phase B: actions under a drawn party route (review / save). */
  partyActions?: (draft: RouteDraft, legs: number[]) => ReactNode;
  /** Pace for the leg list (normal preset). */
  milesPerDay?: number;
};

export function useRoutePlanner({
  map,
  table,
  aspect,
  toScreen,
  toMap,
  partyStart,
  openShip,
  partyActions,
  milesPerDay = DEFAULT_PACE,
}: Props) {
  const seat = useSeat(),
    dm = seat.role === "dm";
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"party" | "ship">("party"),
    [input, setInput] = useState<"tap" | "type">("tap"),
    [points, setPoints] = useState<Waypoint[]>([]),
    [terrain, setTerrain] = useState<LegTerrain[]>([]),
    [shipId, setShipId] = useState(""),
    [destinationId, setDestinationId] = useState(""),
    [typed, setTyped] = useState(""),
    [typedError, setTypedError] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    [calibrating, setCalibrating] = useState<{
      a: RoutePoint;
      b: RoutePoint;
      distance: number;
      unit: MapScale["unit"];
    }>(),
    [dragPreview, setDragPreview] = useState<{ index: number; point: RoutePoint }>();
  const market = readMarketLocations(table.journal?.market);
  const placeName = (id: string) =>
    market.locations.find((l) => l.id === id)?.name ?? "Unknown place";
  const frame = routeFrame(map);
  const label = (p: Waypoint, index: number) =>
    p.locationId
      ? placeName(p.locationId)
      : kind === "ship" && map.grid
        ? (() => {
            const tile = tileAt(map.grid!, p);
            return tile ? `${tile.column + 1},${tile.row + 1}` : `Point ${index + 1}`;
          })()
        : `Point ${pct(p.x)}, ${pct(p.y)}`;
  // Ships the viewer may route: docked at a place anchored on this gridded map.
  const fleet = readFleet(table.journal?.fleet),
    estate = readEstate(table.journal?.propertyOperations);
  const ships = map.grid
    ? fleet.vessels.flatMap((v) => {
        const h = table.holdings.find((h) => h.id === v.propertyId && h.quantity > 0);
        if (!h?.locationId || v.mode !== "docked") return [];
        if (!map.anchors.some((a) => a.locationId === h.locationId)) return [];
        if (!dm && !seat.purseIds.includes(h.purseId) && !canAccessEstate(table, estate, h.id, seat))
          return [];
        if (
          fleet.voyages.some(
            (x) =>
              x.propertyId === h.id &&
              !["arrived", "cancelled", "denied", "dm-overridden"].includes(x.status),
          )
        )
          return [];
        return [{ vessel: v, holding: h }];
      })
    : [];
  const ship = ships.find((s) => s.holding.id === shipId);
  const shipEnds = (() => {
    if (kind !== "ship" || !map.grid || !ship) return undefined;
    const origin = map.anchors.find((a) => a.locationId === ship.holding.locationId),
      destination = map.anchors.find((a) => a.locationId === destinationId);
    const first = origin && tileAt(map.grid, origin),
      last = destination && tileAt(map.grid, destination);
    if (!first || !last) return undefined;
    return {
      first: { ...tilePoint(map.grid, first), locationId: origin!.locationId },
      last: { ...tilePoint(map.grid, last), locationId: destination!.locationId },
    };
  })();
  const route: Waypoint[] =
    kind === "ship" ? (shipEnds ? [shipEnds.first, ...points, shipEnds.last] : []) : points;
  const legs = useMemo(() => {
    if (!frame || route.length < 2) return [];
    try {
      return legDeciMiles(frame, route);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(frame), JSON.stringify(route)]);
  const total = legs.reduce((s, l) => s + l, 0);
  const pace = kind === "ship" ? (ship?.vessel.stats.milesPerDay ?? 0) : milesPerDay;
  useDraftGuard(open && points.length > (kind === "party" && partyStart ? 1 : 0), "Route plan");

  // Keep the typed tile field in sync with the drawing (ship voyages).
  useEffect(() => {
    if (kind === "ship" && map.grid)
      setTyped(
        formatTileList(points.map((p) => tileAt(map.grid!, p)).filter((t) => !!t)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, JSON.stringify(points), map.grid]);
  // A different map starts a fresh plan.
  useEffect(() => {
    setPoints([]);
    setTerrain([]);
    setCalibrating(undefined);
    setShipId("");
    setDestinationId("");
  }, [map.id]);

  const syncTerrain = (next: Waypoint[], previous: LegTerrain[]) =>
    next.slice(1).map((p, i) => previous[i] ?? defaultTerrain(next[i], p));
  const announce = (next: Waypoint[], index: number, verb: string) => {
    const full = kind === "ship" && shipEnds ? [shipEnds.first, ...next, shipEnds.last] : next;
    let legText = "";
    try {
      if (frame && full.length > 1) {
        const l = legDeciMiles(frame, full);
        const leg = kind === "ship" ? index : index - 1;
        if (leg >= 0 && leg < l.length) legText = `, leg ${leg + 1} ${(l[leg] / 10).toFixed(1)} miles`;
      }
    } catch {
      /* A point outside the grid is reported in the panel. */
    }
    setAnnouncement(`Waypoint ${index + 1} ${verb}${legText}`);
  };
  const snap = (p: RoutePoint) => snapRoutePoint(map, p, { aspect });
  function addPoint(p: RoutePoint, at?: number) {
    if (!frame || calibrating) return;
    if (kind === "ship" && !shipEnds) return;
    const snapped = snap(p);
    const index = Math.max(0, Math.min(points.length, at ?? points.length));
    const next = [...points.slice(0, index), snapped, ...points.slice(index)];
    if (next.length + (kind === "ship" ? 2 : 0) > 100) {
      setAnnouncement("A route has at most 100 waypoints.");
      return;
    }
    setPoints(next);
    // Inserting on a leg splits it: both halves keep its terrain. Appending adds a default leg.
    setTerrain((t) => {
      if (index === 0) return [defaultTerrain(snapped, next[1]), ...t];
      if (index - 1 >= t.length) return [...t, defaultTerrain(next[index - 1], snapped)];
      const kept = t[index - 1];
      return [...t.slice(0, index - 1), kept, kept, ...t.slice(index)];
    });
    announce(next, kind === "ship" ? index + 1 : index, "added");
  }
  function removePoint(index: number) {
    const next = points.filter((_, i) => i !== index);
    setPoints(next);
    // Removing a waypoint merges its two legs into the earlier one.
    setTerrain((t) => (index === 0 ? t.slice(1) : t.filter((_, i) => i !== index)));
    setAnnouncement(`Waypoint ${(kind === "ship" ? index + 1 : index) + 1} removed`);
  }
  function movePoint(index: number, p: RoutePoint) {
    const next = points.map((q, i) => (i === index ? snap(p) : q));
    setPoints(next);
    announce(next, kind === "ship" ? index + 1 : index, "moved");
  }
  /** Distance in pixels from a screen point to a leg of the drawn route. */
  const legHit = (screen: { x: number; y: number }) => {
    for (let i = 1; i < route.length; i++) {
      const a = toScreen(route[i - 1]),
        b = toScreen(route[i]);
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      if (!length) continue;
      const t = Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / length));
      if (t > 0.08 && t < 0.92 && Math.hypot(screen.x - a.x - t * dx, screen.y - a.y - t * dy) <= 14)
        return i;
    }
    return 0;
  };
  /** A tap on the map while planning: insert on a leg, otherwise add at the end. */
  function tap(clientX: number, clientY: number, local: { x: number; y: number }) {
    if (calibrating) return;
    const p = toMap(clientX, clientY);
    const leg = legHit(local);
    if (leg) addPoint(p, kind === "ship" ? leg - 1 : leg);
    else addPoint(p);
  }
  function start(next: "party" | "ship" = "party", options: { shipId?: string } = {}) {
    setOpen(true);
    setKind(next);
    setCalibrating(undefined);
    setTypedError("");
    if (next === "party") {
      const first = partyStart ? [snap(partyStart)] : [];
      setPoints(first);
      setTerrain([]);
    } else {
      setPoints([]);
      setTerrain([]);
      if (options.shipId) setShipId(options.shipId);
    }
  }
  /** Close after the drawn route was used (saved or reviewed): nothing is discarded. */
  function finish() {
    setOpen(false);
    setPoints([]);
    setTerrain([]);
    setCalibrating(undefined);
  }
  function close() {
    if (!allowContextChange(close)) return;
    setOpen(false);
    setPoints([]);
    setTerrain([]);
    setCalibrating(undefined);
  }
  function beginCalibration() {
    const existing = map.scale;
    setCalibrating(
      existing
        ? { a: existing.a, b: existing.b, distance: existing.distance, unit: existing.unit }
        : { a: { x: 0.3, y: 0.5 }, b: { x: 0.7, y: 0.5 }, distance: 20, unit: "mi" },
    );
    setAnnouncement("Drag the two blue handles to the ends of a known distance.");
  }

  // ---- Drawing ------------------------------------------------------------------------------
  const svgPoints = (ps: RoutePoint[]) => ps.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ");
  const overlay = open ? (
    <svg
      className="map-route-plan"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {calibrating ? (
        <polyline className="map-route-scale-line" points={svgPoints([calibrating.a, calibrating.b])} />
      ) : (
        route.length > 1 && <polyline points={svgPoints(route)} />
      )}
    </svg>
  ) : null;
  const drag = useRef<{ moved: boolean; pointer: number } | undefined>(undefined),
    dragged = useRef(false);
  const handle = (
    p: RoutePoint,
    key: string,
    content: ReactNode,
    options: {
      label: string;
      className?: string;
      onTap?: () => void;
      onDrag?: (p: RoutePoint) => void;
      onDrop?: (p: RoutePoint) => void;
    },
  ) => {
    const s = toScreen(p);
    return (
      <button
        key={key}
        type="button"
        className={`map-route-handle ${options.className ?? ""}`}
        style={{ left: s.x, top: s.y }}
        aria-label={options.label}
        title={options.label}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (!options.onDrag) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { moved: false, pointer: e.pointerId };
        }}
        onPointerMove={(e) => {
          if (drag.current?.pointer !== e.pointerId || !options.onDrag) return;
          if (!drag.current.moved) {
            // A small wobble while tapping is not a drag.
            const r = e.currentTarget.getBoundingClientRect();
            if (Math.hypot(e.clientX - r.x - r.width / 2, e.clientY - r.y - r.height / 2) < 8)
              return;
          }
          drag.current.moved = true;
          options.onDrag(toMap(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          const moved = !!drag.current?.moved;
          drag.current = undefined;
          dragged.current = moved;
          if (moved) options.onDrop?.(toMap(e.clientX, e.clientY));
        }}
        onPointerCancel={() => {
          drag.current = undefined;
          setDragPreview(undefined);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          options.onTap?.();
        }}
      >
        {content}
      </button>
    );
  };
  const shown = (p: Waypoint, i: number) =>
    dragPreview?.index === i ? { ...p, ...dragPreview.point } : p;
  const handles = !open
    ? null
    : calibrating
      ? (["a", "b"] as const).map((end) =>
          handle(calibrating[end], `scale-${end}`, end === "a" ? "A" : "B", {
            label: `Scale handle ${end === "a" ? "A" : "B"}`,
            className: "map-route-scale-handle",
            onDrag: (p) => setCalibrating((c) => (c ? { ...c, [end]: p } : c)),
            onDrop: (p) => setCalibrating((c) => (c ? { ...c, [end]: p } : c)),
          }),
        )
      : [
          ...(kind === "ship" && shipEnds
            ? [
                handle(shipEnds.first, "first", 1, {
                  label: `Start: ${label(shipEnds.first, 0)}`,
                  className: "map-route-snapped map-route-fixed",
                }),
                handle(shipEnds.last, "last", points.length + 2, {
                  label: `Destination: ${label(shipEnds.last, points.length + 1)}`,
                  className: "map-route-snapped map-route-fixed",
                }),
              ]
            : []),
          ...points.map((p, i) => {
            const number = kind === "ship" ? i + 2 : i + 1;
            const q = shown(p, i);
            return handle(q, `wp-${i}`, number, {
              label: `Waypoint ${number}: ${label(p, number - 1)}. Tap to remove; drag to move.`,
              className: p.locationId ? "map-route-snapped" : "",
              onTap: () => removePoint(i),
              onDrag: (point) => setDragPreview({ index: i, point }),
              onDrop: (point) => {
                setDragPreview(undefined);
                movePoint(i, point);
              },
            });
          }),
          ...legs.map((deci, i) => {
            const a = toScreen(route[i]),
              b = toScreen(route[i + 1]);
            return (
              <span
                key={`leg-${i}`}
                className="map-route-leg-label"
                aria-hidden="true"
                style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
              >
                {kind === "ship" && map.grid
                  ? `${Math.round((deci / 10) / (map.grid.feetPerTile / 5280))} tiles`
                  : formatMiles(deci)}
              </span>
            );
          }),
        ];

  // ---- Panel --------------------------------------------------------------------------------
  const scaleSummary = map.grid
    ? `${map.grid.columns} × ${map.grid.rows} grid · ${
        map.grid.feetPerTile % 5280 === 0
          ? `${map.grid.feetPerTile / 5280} mi`
          : `${map.grid.feetPerTile} ft`
      } tiles`
    : map.scale
      ? `scale bar ${map.scale.distance} ${map.scale.unit}`
      : "no scale yet";
  const calibrationPanel = calibrating && (
    <CalibrationPanel
      map={map}
      aspect={aspect}
      value={calibrating}
      change={(next) => setCalibrating((c) => (c ? { ...c, ...next } : c))}
      done={() => setCalibrating(undefined)}
    />
  );
  const noScale = !frame && (
    <div className="map-route-empty">
      <p>
        <strong>Routes need a scale.</strong>{" "}
        {map.name} has no grid or scale bar yet.
      </p>
      {dm ? (
        <Button onClick={beginCalibration}>Set this map's scale</Button>
      ) : (
        <p>Ask the DM to set this map's scale.</p>
      )}
    </div>
  );
  const legList = (
    <ol className="map-route-legs" aria-label="Legs">
      {legs.map((deci, i) => {
        const days = pace ? legDays(deci, pace) : 0;
        const range = pace ? legDayRange(legs, i, pace) : undefined;
        return (
          <li key={i}>
            <span className="map-route-leg-name">
              {label(route[i], i)} → {label(route[i + 1], i + 1)}
            </span>
            <span className="map-route-leg-numbers">
              {kind === "ship" && map.grid
                ? `${Math.round((deci / 10) / (map.grid.feetPerTile / 5280))} tiles · ${formatMiles(deci)}`
                : `${formatMiles(deci)} · ${days.toFixed(2)} d`}
            </span>
            {kind === "party" ? (
              <label className="map-route-terrain">
                <span className="sr-only">Leg {i + 1} terrain</span>
                <select
                  aria-label={`Leg ${i + 1} terrain`}
                  value={terrainValue(terrain[i] ?? defaultTerrain(route[i], route[i + 1]))}
                  onChange={(e) =>
                    setTerrain((t) => {
                      const next = syncTerrain(route, t);
                      next[i] = terrainOf(e.target.value);
                      return next;
                    })
                  }
                >
                  {terrainOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="map-route-leg-numbers">
                Sea · {pace ? `${days.toFixed(2)} days at ${pace} mi/day` : "ship speed not set"}
              </span>
            )}
            {kind === "party" && range && (
              <small>
                {range.startDay === range.endDay
                  ? `Day ${range.startDay} of the journey`
                  : `Days ${range.startDay}–${range.endDay} of the journey`}
              </small>
            )}
          </li>
        );
      })}
    </ol>
  );
  const typedPanel =
    kind === "ship" && map.grid ? (
      <label className="map-route-typed">
        Intermediate route tiles
        <input
          aria-label="Intermediate route tiles"
          value={typed}
          placeholder="Column,row; column,row (optional)"
          onChange={(e) => {
            setTyped(e.target.value);
            try {
              const tiles = parseTileList(e.target.value, map.grid!);
              if (tiles.length > 98) throw Error("Use up to 98 intermediate waypoints.");
              setTypedError("");
              setPoints(tiles.map((t) => tilePoint(map.grid!, t)));
            } catch (error) {
              setTypedError(error instanceof Error ? error.message : "Invalid route.");
            }
          }}
        />
        <small>
          The existing typed field, kept in sync with the drawing. Columns and rows start at 1.
        </small>
        {typedError && <span role="alert">{typedError}</span>}
      </label>
    ) : (
      <TypedWaypoints
        map={map}
        points={points}
        label={label}
        add={(p) => addPoint(p)}
        remove={removePoint}
      />
    );
  const draft: RouteDraft = { kind, points: route, terrain: syncTerrain(route, terrain) };
  const shipPanel = kind === "ship" && (
    <>
      {!map.grid ? (
        <p>Ship voyages route on gridded maps only. Choose a map with a grid.</p>
      ) : !ships.length ? (
        <p>
          No ship you can command is docked at a place anchored on this map. Docked ships with no
          voyage under way appear here.
        </p>
      ) : (
        <div className="map-route-fields">
          <label>
            Ship
            <select aria-label="Ship" value={shipId} onChange={(e) => {
              setShipId(e.target.value);
              setPoints([]);
            }}>
              <option value="">Choose a ship</option>
              {ships.map((s) => (
                <option key={s.holding.id} value={s.holding.id}>
                  {s.holding.name} · {s.vessel.stats.milesPerDay} mi/day
                </option>
              ))}
            </select>
          </label>
          {ship && (
            <p>From {placeName(ship.holding.locationId!)}</p>
          )}
          <label>
            To
            <select
              aria-label="Voyage destination on this map"
              value={destinationId}
              onChange={(e) => {
                setDestinationId(e.target.value);
                setPoints([]);
              }}
            >
              <option value="">Choose a destination</option>
              {map.anchors
                .filter((a) => a.locationId !== ship?.holding.locationId)
                .map((a) => (
                  <option key={a.locationId} value={a.locationId}>
                    {placeName(a.locationId)}
                  </option>
                ))}
            </select>
          </label>
          {ship && destinationId && !shipEnds && (
            <p role="alert">Both ports must have reviewed anchors inside the grid.</p>
          )}
        </div>
      )}
    </>
  );
  const totals = legs.length > 0 && (
    <p className="map-route-totals" role="status">
      <strong>{formatMiles(total)} total</strong>
      {kind === "ship" && map.grid
        ? ` · ${Math.round(total / 10 / (map.grid.feetPerTile / 5280))} tiles`
        : ""}
      {pace ? ` · ${(total / 10 / pace).toFixed(2)} days travel` : ""} · {legs.length}{" "}
      {legs.length === 1 ? "leg" : "legs"}
      {kind === "party" ? ` · ${pace} mi/day` : ""}
    </p>
  );
  const panel = open ? (
    <aside className="map-route-panel map-glass" aria-label="Plan a route">
      <div className="map-panel-heading">
        <span className="map-journey-glyph" aria-hidden="true">
          {calibrating ? <Ruler size={18} /> : kind === "ship" ? <Ship size={18} /> : <RouteIcon size={18} />}
        </span>
        <strong>{calibrating ? "Set this map's scale" : kind === "ship" ? "Voyage route" : "Plan a journey"}</strong>
        <button className="map-icon-button" aria-label="Close route planner" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <p className="map-route-scale">
        {map.name} · {scaleSummary}
        {dm && !map.grid && frame && !calibrating && (
          <>
            {" "}
            <button type="button" className="map-route-link" onClick={beginCalibration}>
              Change scale
            </button>
          </>
        )}
      </p>
      {calibrating ? (
        calibrationPanel
      ) : (
        <>
          <Segmented
            label="Route kind"
            value={kind}
            onChange={(next) => start(next)}
            options={[
              { value: "party", label: "Party journey" },
              { value: "ship", label: "Ship voyage" },
            ]}
          />
          {shipPanel}
          {!frame ? (
            noScale
          ) : kind === "ship" && (!map.grid || !shipEnds) ? null : (
            <>
              <div className="map-route-input-row">
                <Segmented
                  label="Waypoint input"
                  value={input}
                  onChange={setInput}
                  options={[
                    { value: "tap", label: "Tap to add" },
                    { value: "type", label: "Type instead" },
                  ]}
                />
                <button
                  type="button"
                  className="map-icon-button"
                  aria-label="Undo last waypoint"
                  title="Undo last waypoint (Backspace)"
                  disabled={points.length <= (kind === "party" && partyStart ? 1 : 0)}
                  onClick={() => {
                    const keep = kind === "party" && partyStart ? 1 : 0;
                    if (points.length > keep) removePoint(points.length - 1);
                  }}
                >
                  <Undo2 size={18} />
                </button>
              </div>
              {input === "tap" ? (
                <p className="map-route-help">
                  {kind === "ship"
                    ? "Tap the map to add waypoints; they snap to tile centres using the map's diagonal rule. Tap a waypoint to remove it; drag to move it."
                    : "Tap the map to add waypoints. Points near a place snap to it (dashed ring). Drag a waypoint to move it; tap a leg to insert one; tap a waypoint to remove it."}
                </p>
              ) : (
                typedPanel
              )}
              {input === "tap" && kind === "ship" && typedPanel}
              {totals}
              {legList}
              {kind === "party" && legs.length > 0 && (
                <p className="map-route-help">
                  You choose each leg's terrain; Lootsplitter doesn't read the artwork. Terrain is
                  recorded as the party's travel environment while they're on that leg.
                </p>
              )}
              <div className="map-route-actions">
                {kind === "party" && legs.length > 0 && partyActions?.(draft, legs)}
                {kind === "ship" && ship && shipEnds && legs.length > 0 && map.grid && (
                  <Button
                    onClick={() => {
                      const tiles = route.map((p) => tileAt(map.grid!, p)!);
                      setVoyageRouteDraft({
                        propertyId: ship.holding.id,
                        destinationId,
                        mapRoute: { mapId: map.id, grid: map.grid!, points: tiles },
                        waypoints: formatTileList(tiles.slice(1, -1)),
                      });
                      setOpen(false);
                      setPoints([]);
                      openShip?.(ship.holding.id);
                    }}
                  >
                    Use in voyage request
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={!points.length}
                  onClick={() => {
                    setPoints(kind === "party" && partyStart ? [snap(partyStart)] : []);
                    setTerrain([]);
                    setAnnouncement("Route cleared");
                  }}
                >
                  Clear route
                </Button>
              </div>
              {kind === "ship" && (
                <p className="map-route-help">
                  Returns to the existing voyage form. Payer, budget, crew, cargo and berth checks
                  there are unchanged.
                </p>
              )}
            </>
          )}
        </>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </aside>
  ) : null;
  return {
    active: open,
    calibrating: !!calibrating,
    start,
    close,
    finish,
    tap,
    /** Keyboard: Enter adds a waypoint at the crosshair. */
    addAt: (p: RoutePoint) => addPoint(p),
    /** Keyboard: Backspace removes the last waypoint. */
    removeLast: () => {
      const keep = kind === "party" && partyStart ? 1 : 0;
      if (points.length > keep) removePoint(points.length - 1);
    },
    overlay,
    handles,
    panel,
    draft,
    legs,
    beginCalibration,
    /** What the camera should keep in view beside the panel: the scale handles or the route. */
    focusPoints: !open ? [] : calibrating ? [calibrating.a, calibrating.b] : route,
  };
}

function TypedWaypoints({
  map,
  points,
  label,
  add,
  remove,
}: {
  map: CampaignMap;
  points: Waypoint[];
  label: (p: Waypoint, index: number) => string;
  add: (p: RoutePoint) => void;
  remove: (index: number) => void;
}) {
  const [place, setPlace] = useState(""),
    [free, setFree] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="map-route-typed">
      <strong>Waypoints in order</strong>
      <ol>
        {points.map((p, i) => (
          <li key={i}>
            <span>
              {i === 0 ? "Start" : `${i + 1} ·`} {label(p, i)}
            </span>
            <button type="button" onClick={() => remove(i)} aria-label={`Remove waypoint ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <label>
        Add a place
        <select aria-label="Add an anchored place" value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value="">Choose an anchored place…</option>
          {map.anchors.map((a) => (
            <option key={a.locationId} value={a.locationId}>
              {label({ ...a }, 0)}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={!place}
        onClick={() => {
          const anchor = map.anchors.find((a) => a.locationId === place);
          if (anchor) add(anchor);
          setPlace("");
        }}
      >
        Add place
      </Button>
      <label>
        Or a point (x%, y%)
        <input
          aria-label="Waypoint as x%, y%"
          placeholder="76.3, 54"
          value={free}
          onChange={(e) => setFree(e.target.value)}
        />
      </label>
      <Button
        disabled={!free.trim()}
        onClick={() => {
          const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*,\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(free);
          if (!match || Number(match[1]) > 100 || Number(match[2]) > 100) {
            setError("Enter a point as x%, y% (0–100).");
            return;
          }
          setError("");
          add({ x: Number(match[1]) / 100, y: Number(match[2]) / 100 });
          setFree("");
        }}
      >
        Add point
      </Button>
      {error && <p role="alert">{error}</p>}
      <p className="map-route-help">
        Keyboard: arrow keys pan under the crosshair, Enter adds a waypoint there, Backspace removes
        the last one.
      </p>
    </div>
  );
}

function CalibrationPanel({
  map,
  aspect,
  value,
  change,
  done,
}: {
  map: CampaignMap;
  aspect: number;
  value: { a: RoutePoint; b: RoutePoint; distance: number; unit: MapScale["unit"] };
  change: (next: Partial<{ distance: number; unit: MapScale["unit"] }>) => void;
  done: () => void;
}) {
  const parsed = mapScaleSchema.safeParse({ ...value, aspect });
  const unitName = { mi: "miles", km: "kilometres", ft: "feet" }[value.unit];
  const ends = (() => {
    const near = (p: RoutePoint) =>
      map.anchors.find((a) => Math.hypot((a.x - p.x) * aspect, a.y - p.y) < 0.02)?.locationId;
    return [near(value.a), near(value.b)];
  })();
  return (
    <CommandForm
      label="Save scale"
      dirty
      submitDisabled={!parsed.success}
      submit={() => ({
        kind: "map-save",
        mapId: map.id,
        before: map,
        map: { ...map, scale: mapScaleSchema.parse({ ...value, aspect }) },
      })}
      onDone={done}
    >
      <p>
        Routes need a scale. Drag the two blue handles to the ends of something whose length you
        know: the map's printed scale bar, or two places.
      </p>
      <div className="map-route-fields">
        <label>
          That distance is
          <input
            aria-label="Scale distance"
            type="number"
            min={0.1}
            step="any"
            value={value.distance}
            onChange={(e) => change({ distance: Number(e.target.value) })}
          />
        </label>
        <label>
          Unit
          <select
            aria-label="Scale unit"
            value={value.unit}
            onChange={(e) => change({ unit: e.target.value as MapScale["unit"] })}
          >
            <option value="mi">miles</option>
            <option value="km">kilometres</option>
            <option value="ft">feet</option>
          </select>
        </label>
      </div>
      {parsed.success ? (
        <p role="status">
          {ends[0] && ends[1] ? `${ends.join(" to ")} = ` : ""}
          {value.distance} {value.unit}, so 1 {value.unit === "ft" ? "foot" : unitName.replace(/s$/, "")} is
          about {scaleWidthPercent(parsed.data).toFixed(2)}% of the map's width. Distances use the
          image's real proportions, so tall and wide maps measure the same.
          {value.unit !== "mi" &&
            ` (${toMiles(scaleDistance(parsed.data, value.a, value.b), value.unit).toFixed(1)} mi)`}
        </p>
      ) : (
        <p role="alert">Drag the handles apart and enter a distance above zero.</p>
      )}
      <p className="map-route-help">
        DM only. Saved on the map, so Measure uses it too. Journeys already under way keep the
        scale they were approved with. Gridded maps use their grid instead.
      </p>
      <Button variant="secondary" type="button" onClick={done}>
        Cancel
      </Button>
    </CommandForm>
  );
}
