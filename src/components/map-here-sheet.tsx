import { useState } from "react";
import { MapPin, X } from "lucide-react";
import type { HereRow, HereSheet } from "@/lib/quire/place-hub";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { Button } from "./ui";

const groups = [
  ["shops", "Shops & trade"],
  ["people", "People"],
  ["services", "Services & property"],
] as const;

/**
 * The "Here" sheet (docs/MAP-TILES.md "Place hub"): everything this viewer may use at the party's
 * location, built by `hereSheet` from the table the viewer already has. Each row opens the same
 * place card as its pin; the pin button shows it on the map. Browsing a map of somewhere else is
 * read only: names and kinds of shared pins, every action "Visit to …".
 */
export function MapHereSheet({
  sheet,
  dm,
  close,
  open,
  locate,
  canLocate,
  backToParty,
  showParty,
}: {
  sheet: HereSheet;
  dm: boolean;
  close: () => void;
  open: (row: { reference: MapRecordReference; label: string; kind: string }) => void;
  locate: (reference: MapRecordReference) => void;
  canLocate: (reference: MapRecordReference) => boolean;
  backToParty?: () => void;
  showParty?: () => void;
}) {
  const [filter, setFilter] = useState<"all" | HereRow["group"]>("all");
  const header = (title: string, subtitle: string) => (
    <header className="map-place-header">
      <span className="map-place-glyph" aria-hidden="true">
        <MapPin size={18} />
      </span>
      <div className="map-place-title">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <button
        type="button"
        className="map-icon-button"
        aria-label="Close Here"
        title="Close"
        onClick={close}
      >
        <X size={17} />
      </button>
    </header>
  );
  const pin = (reference: MapRecordReference, label: string) =>
    canLocate(reference) ? (
      <button
        type="button"
        className="map-icon-button"
        aria-label={`Show ${label} on the map`}
        title="Show on the map"
        onClick={() => locate(reference)}
      >
        <MapPin size={16} />
      </button>
    ) : null;
  let body;
  if (sheet.mode === "road")
    body = (
      <>
        {header("Here", "On the road")}
        <div className="map-here-empty">
          <h3>Nothing to use on the road</h3>
          <p>
            The party is travelling{sheet.environment ? ` (${sheet.environment})` : ""}. Shops,
            people and services come back when the DM moves the party to a place.
          </p>
          {showParty && <Button onClick={showParty}>Show the party</Button>}
        </div>
      </>
    );
  else if (sheet.mode === "nowhere")
    body = (
      <>
        {header("Here", "No party location")}
        <div className="map-here-empty">
          <h3>Nothing to use here yet</h3>
          <p>
            {dm
              ? "Set the party's location (Move party here) to list what can be used there."
              : "The DM hasn't set where the party is."}
          </p>
        </div>
      </>
    );
  else if (sheet.mode === "away")
    body = (
      <>
        {header(sheet.placeName, "Viewing another place")}
        <p className="map-here-note">
          Viewing only. The party is {sheet.partyPlace === "on the road" ? "on the road" : `in ${sheet.partyPlace}`}
          , not {sheet.placeName}. Shopping, talking and sending need the party to be there.
        </p>
        <h3 className="map-here-group">Marked at {sheet.placeName}</h3>
        {sheet.rows.length ? (
          <ul className="map-here-rows">
            {sheet.rows.map((row) => (
              <li key={`${row.reference.kind}:${row.reference.id}`}>
                <span>
                  <strong>{row.label}</strong>
                  <small>
                    {row.kind}
                    {row.dmOnly ? " · DM only" : ""}
                  </small>
                </span>
                {pin(row.reference, row.label)}
                <Button disabled>{row.action}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No shared places are marked on this map.</p>
        )}
        <p className="map-here-note">
          Only names and kinds of shared map pins. No stock, prices, hours or people's details are
          shown for places the party isn't at.
        </p>
        {backToParty && <Button onClick={backToParty}>Back to where the party is</Button>}
      </>
    );
  else {
    const count = (g: HereRow["group"]) => sheet.rows.filter((r) => r.group === g).length;
    const shown = sheet.rows.filter((r) => filter === "all" || r.group === filter);
    body = (
      <>
        {header("Here", "Everything you can use at the party's location")}
        <p className="map-here-note">Party is in {sheet.locationName}</p>
        {sheet.rows.length ? (
          <>
            <div className="map-here-filters" role="group" aria-label="Filter places">
              {(
                [
                  ["all", "All", sheet.rows.length],
                  ["shops", "Shops", count("shops")],
                  ["people", "People", count("people")],
                  ["services", "Services", count("services")],
                ] as const
              ).map(([value, label, n]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label} <span>{n}</span>
                </button>
              ))}
            </div>
            {groups.map(([group, title]) => {
              const rows = shown.filter((r) => r.group === group);
              if (!rows.length) return null;
              return (
                <section key={group} aria-label={title}>
                  <h3 className="map-here-group">{title}</h3>
                  <ul className="map-here-rows">
                    {rows.map((row) => (
                      <li key={row.key ?? `${row.reference.kind}:${row.reference.id}`}>
                        <span>
                          <strong>{row.label}</strong>
                          <small>
                            {row.detail}
                            {row.dmOnly ? " · DM only" : ""}
                          </small>
                        </span>
                        {pin(row.reference, row.label)}
                        <Button aria-label={`${row.action}: ${row.label}`} disabled={!!row.disabled} onClick={() => open(row)}>
                          {row.action}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <p className="map-here-note">
              {dm
                ? "Players see only what they can use here; rows marked DM only are hidden from them."
                : "Only what you can use here is listed. Hidden people, DM-only pins and other players' property are never sent to your device."}
            </p>
          </>
        ) : (
          <div className="map-here-empty">
            <h3>Nothing to use here yet</h3>
            <p>
              {sheet.locationName} has no shops, people or services you can use. The DM may add
              some later.
            </p>
          </div>
        )}
      </>
    );
  }
  return (
    <section className="map-record-details map-service-open map-here-sheet" aria-label="Here">
      {body}
    </section>
  );
}
