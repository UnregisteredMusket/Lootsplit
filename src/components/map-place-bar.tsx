import { useState } from "react";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { mapReferenceName } from "@/lib/quire/connected-maps";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { CloudTable } from "@/lib/quire/cloud";
import { anchorFor } from "@/lib/quire/world";
import { locationLabel, readMarketLocations } from "@/lib/quire/shop-locations";
import { placementSave, portraitKinds, recordLocationId, sameRecord } from "@/lib/quire/place-hub";
import { Button } from "./ui";
import { CommandForm } from "./world-tools";

/**
 * DM "Place on map" (`/maps?map=&place=kind:id`): the record is already chosen; tap the map (or
 * press Enter at the crosshair), choose who can see the pin, and save. One `map-save` writes the
 * pin; the record's own location never changes.
 */
export function MapPlaceBar({
  map,
  table,
  reference,
  point,
  done,
  cancel,
}: {
  map: CampaignMap;
  table: CloudTable;
  reference: MapRecordReference;
  point?: { x: number; y: number };
  done: () => void;
  cancel: () => void;
}) {
  const existing = map.connected?.placements.find((p) => sameRecord(p.record, reference));
  const [visibility, setVisibility] = useState<"party" | "dm">(existing?.visibility ?? "party"),
    [style, setStyle] = useState<"icon" | "portrait">(existing?.style ?? "icon");
  const name = mapReferenceName(table, reference) ?? "This record";
  const location = recordLocationId(table, reference);
  const anchored = !location || reference.kind === "location" || !!anchorFor(map, table, location);
  return (
    <section className="map-place-bar map-glass" aria-label="Place on map">
      <h2>
        {existing ? "Moving" : "Placing"} {name}
      </h2>
      <p role="status">
        {point
          ? `Pin at ${Math.round(point.x * 100)}%, ${Math.round(point.y * 100)}%. Tap again to adjust.`
          : "Tap the map where it should appear, or press Enter to place at the crosshair."}{" "}
        Map: {map.name}
      </p>
      {!anchored && (
        <p className="map-here-note">
          This map has no anchor for {locationLabel(readMarketLocations(table.journal?.market), location)}. The
          pin still saves here.
        </p>
      )}
      <CommandForm
        label="Save pin"
        dirty={!!point}
        submitDisabled={!point}
        submit={() => {
          if (!point) throw Error("Tap the map where the pin goes first.");
          return placementSave(map, reference, { ...point, visibility, style });
        }}
        onDone={done}
      >
        <div className="map-place-bar-options" role="radiogroup" aria-label="Pin visibility">
          <label>
            <input
              type="radio"
              name="place-visibility"
              checked={visibility === "party"}
              onChange={() => setVisibility("party")}
            />{" "}
            Party can see
          </label>
          <label>
            <input
              type="radio"
              name="place-visibility"
              checked={visibility === "dm"}
              onChange={() => setVisibility("dm")}
            />{" "}
            DM only
          </label>
        </div>
        {portraitKinds.has(reference.kind) && (
          <div className="map-place-bar-options" role="radiogroup" aria-label="Pin style">
            <label>
              <input
                type="radio"
                name="place-style"
                checked={style === "icon"}
                onChange={() => setStyle("icon")}
              />{" "}
              Icon pin
            </label>
            <label>
              <input
                type="radio"
                name="place-style"
                checked={style === "portrait"}
                onChange={() => setStyle("portrait")}
              />{" "}
              Portrait pin
            </label>
          </div>
        )}
      </CommandForm>
      <Button onClick={cancel}>Cancel placing</Button>
      <p className="map-here-note">
        A pin changes only where the record is drawn, never where it belongs.
      </p>
    </section>
  );
}
