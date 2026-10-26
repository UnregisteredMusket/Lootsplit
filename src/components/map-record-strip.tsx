import { MapPin } from "lucide-react";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import {
  browsableMaps,
  placementMap,
  recordMapHref,
  recordMapSpots,
  recordMapStatus,
} from "@/lib/quire/place-hub";
import { AppLink } from "./app-link";

/**
 * "Show on map" at the foot of a Shop, NPC, Property, Listing, Exchange or Post card
 * (docs/MAP-TILES.md "Place hub"). It reads only the table this viewer already has, so a DM-only
 * or hidden pin reads exactly like "No map location" to players.
 */
export function MapRecordStrip({
  reference,
  hideUnplacedForPlayers = false,
}: {
  reference: MapRecordReference;
  /** A shop page hides the strip from players when there is no map location to open. */
  hideUnplacedForPlayers?: boolean;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    table = useWorldTable();
  const status = recordMapStatus(recordMapSpots(table, reference, seat));
  const first = status.spots[0];
  // DM: Place on map / Place exactly / Move pin open the map in placement mode (`place=`).
  const exactSpot = status.spots.find((s) => s.exact);
  const placeTarget = dm
    ? exactSpot?.map ?? first?.map ?? placementMap(table, reference, browsableMaps(table, seat))
    : undefined;
  const placeLabel = exactSpot ? "Move pin" : first ? "Place exactly" : "Place on map";
  const state =
    status.kind === "none"
      ? dm
        ? ["Not placed", "Not on any map yet."]
        : ["No map location", ""]
      : status.kind === "several"
        ? [
            `On ${status.spots.length} maps`,
            status.spots
              .map((s) => `${s.map.name} (${s.exact ? "exact" : "approximate"}${s.dmOnly ? ", DM only" : ""})`)
              .join(" · "),
          ]
        : status.kind === "dm-only"
          ? ["Placed · DM only", `${first.map.name} · players can't see this pin`]
          : status.kind === "approximate"
            ? [dm ? "Approximate" : "On the map", `${first.map.name} · shown at its location`]
            : [dm ? "Placed" : "On the map", first.map.name];
  if (!dm && status.kind === "none" && hideUnplacedForPlayers) return null;
  return (
    <div className="map-record-strip" role="group" aria-label="Map">
      <MapPin size={16} aria-hidden="true" />
      <p>
        <strong>{state[0]}</strong> {state[1] ? <span>{state[1]}</span> : null}
      </p>
      {first && (
        <AppLink className="map-record-strip-action" href={recordMapHref(first.map.id, reference)}>
          Show on map
        </AppLink>
      )}
      {placeTarget && (
        <AppLink
          className="map-record-strip-action"
          href={recordMapHref(placeTarget.id, reference, "place")}
        >
          {placeLabel}
        </AppLink>
      )}
      {status.kind === "several" && (
        <details className="map-record-strip-choices">
          <summary>Choose a map</summary>
          <ul>
            {status.spots.map((s) => (
              <li key={s.map.id}>
                <AppLink href={recordMapHref(s.map.id, reference)}>
                  {s.map.name} · {s.exact ? "exact pin" : "approximate"}
                </AppLink>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
