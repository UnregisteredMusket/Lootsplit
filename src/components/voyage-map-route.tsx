import { useState } from "react";
import { SearchSelect } from "./search-select";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { ShipVoyage } from "@/lib/quire/ships-schema";
import { routeDistance, tileAt } from "@/lib/quire/map-tiles";
import { parseTileList } from "@/lib/quire/journey";
import { AppLink } from "./app-link";
export function VoyageMapRoute({
  maps,
  originId,
  destinationId,
  route,
  set,
  propertyId,
  initialWaypoints = "",
}: {
  maps: CampaignMap[];
  originId?: string;
  destinationId: string;
  route?: ShipVoyage["mapRoute"];
  set: (route: ShipVoyage["mapRoute"]) => void;
  /** The ship, for "Draw this route on the map" (journey planner). */
  propertyId?: string;
  /** Intermediate tiles drawn on the map ("column,row; …"), kept in the typed field. */
  initialWaypoints?: string;
}) {
  const [waypoints, setWaypoints] = useState(initialWaypoints),
    [error, setError] = useState("");
  const available = maps.filter(
    (m) =>
      m.grid &&
      m.anchors.some((a) => a.locationId === originId) &&
      m.anchors.some((a) => a.locationId === destinationId),
  );
  function choose(mapId: string, input: string) {
    setError("");
    if (!mapId) {
      set(undefined);
      return;
    }
    const map = available.find((m) => m.id === mapId);
    try {
      if (!map?.grid) throw Error("Choose a map with reviewed origin and destination anchors.");
      const first = tileAt(
          map.grid,
          map.anchors.find((a) => a.locationId === originId)!,
        ),
        last = tileAt(
          map.grid,
          map.anchors.find((a) => a.locationId === destinationId)!,
        );
      if (!first || !last) throw Error("Both port anchors must be inside the grid.");
      const points = parseTileList(input, map.grid);
      if (points.length > 98) throw Error("Use up to 98 intermediate waypoints.");
      set({ mapId, grid: map.grid, points: [first, ...points, last] });
    } catch (e) {
      set(undefined);
      setError(e instanceof Error ? e.message : "Invalid route.");
    }
  }
  return (
    <div className="voyage-map-route">
      <label>
        Voyage route map
        <SearchSelect
          aria-label="Voyage route map"
          value={route?.mapId ?? ""}
          onValueChange={(id) => choose(id, waypoints)}
        >
          <option value="">Manual duration / no mapped route</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.grid!.feetPerTile} ft tiles
            </option>
          ))}
        </SearchSelect>
      </label>
      {(route || error) && (
        <label>
          Intermediate route tiles
          <input
            aria-label="Intermediate route tiles"
            value={waypoints}
            placeholder="Column,row; column,row (optional)"
            onChange={(e) => {
              setWaypoints(e.target.value);
              choose(route?.mapId ?? available[0]?.id ?? "", e.target.value);
            }}
          />
        </label>
      )}
      {route && (
        <p>
          Route distance: {Math.round(routeDistance(route.grid, route.points) * 100) / 100} ft.
          Duration uses the ship's reviewed miles per day. Route position follows approved downtime;
          blocked voyages stop on the map.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        Optional: choose a gridded map with anchors for both ports. Enter intermediate tiles to
        follow a river, coastline or sea route. Columns and rows start at 1.
      </p>
      {propertyId && available.length > 0 && (
        <AppLink
          className="settings-link"
          href={`/maps?map=${encodeURIComponent(route?.mapId ?? available[0].id)}&plan=${encodeURIComponent(`ship:${propertyId}`)}`}
        >
          Draw this route on the map →
        </AppLink>
      )}
    </div>
  );
}
