import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Link2, X } from "lucide-react";
import type { MapRecord } from "@/lib/quire/map-signals";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { CloudTable } from "@/lib/quire/cloud";
import { useSeat } from "@/lib/quire/seat";
import { locationPath, readMarketLocations } from "@/lib/quire/shop-locations";
import {
  mapServiceAllowed,
  partyAt,
  recordLocationId,
  recordMapHref,
  sameRecord,
} from "@/lib/quire/place-hub";
import { AppLink } from "./app-link";
import { Button } from "./ui";
import { RecordIcon } from "./map-record-icon";

const MapServicePanel = lazy(() =>
  import("./map-service-panel").then((m) => ({ default: m.MapServicePanel })),
);

/**
 * The place card (docs/MAP-TILES.md "Place hub"): a thin header over the existing service panel.
 * One record with a service opens straight into its card; several records at one point list
 * their names, and each row opens that record's card. Nothing is bought, sent or moved here:
 * the panel is the canonical shop, NPC, property, listing, exchange or postal component.
 * Desktop: an overlay on the right of the canvas. 650px and narrower: a bottom sheet.
 */
export function MapPlaceCard({
  records,
  map,
  table,
  service,
  openService,
  expanded,
  setExpanded,
  close,
  selectMap,
  locationMaps,
  focusKey,
  deepLinked,
}: {
  records: MapRecord[];
  map: CampaignMap;
  table: CloudTable;
  service?: MapRecordReference;
  openService: (record: MapRecord) => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  close: () => void;
  selectMap: (id: string, entry?: { x: number; y: number; zoom: number }) => void;
  locationMaps: (id: string) => CampaignMap[];
  /** Changes when the card should take focus (a deep link or a search result). */
  focusKey?: string;
  /** Opened from a `record=` link: offer Back to where the viewer came from. */
  deepLinked?: boolean;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    router = useRouter(),
    canGoBack = useCanGoBack();
  const heading = useRef<HTMLHeadingElement>(null),
    [copied, setCopied] = useState("");
  const card = records.length === 1 && records[0].reference && sameRecord(records[0].reference, service)
    ? records[0]
    : undefined;
  useEffect(() => {
    if (focusKey) heading.current?.focus();
  }, [focusKey]);
  useEffect(() => setCopied(""), [card?.reference?.kind, card?.reference?.id]);
  const market = readMarketLocations(table.journal?.market);
  const reference = card?.reference;
  const locationId = reference ? recordLocationId(table, reference) : undefined;
  const trail = locationPath(market, locationId)
    .map((l) => l.name)
    .join(" › ");
  const allowed = reference ? mapServiceAllowed(table, reference, seat) : false;
  const here = reference && reference.kind !== "location" ? partyAt(table, locationId) : false;
  const pin = reference
    ? map.connected?.placements.find((p) => sameRecord(p.record, reference))
    : undefined;
  const shop = reference?.kind === "shop" ? table.shops.find((s) => s.id === reference.id) : undefined;
  const portrait =
    reference?.kind === "npc"
      ? (table.journal?.world?.npcs.find((n) => n.id === reference.id)?.portrait ??
        table.purses.find((p) => p.id === reference.id)?.portrait)
      : reference?.kind === "character"
        ? table.purses.find((p) => p.id === reference.id)?.portrait
        : undefined;
  async function copyLink() {
    if (!reference) return;
    const link = new URL(recordMapHref(map.id, reference), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(link);
      setCopied("Link copied. It opens only for people who may see this place.");
    } catch {
      setCopied(`Copy this link: ${link}`);
    }
  }
  const title = card
    ? card.label
    : records.length === 1
      ? records[0].label
      : `${records.length} places here`;
  const subtitle = card
    ? [trail, card.kind].filter(Boolean).join(" · ")
    : records.length === 1
      ? records[0].kind
      : `${records[0].kind} · ${records.length} records`;
  return (
    <section
      className={`map-record-details map-place-card ${card ? "map-service-open" : ""} ${card && expanded ? "map-service-expanded" : ""}`}
      aria-label="Map record details"
    >
      <header className="map-place-header">
        <span className="map-place-glyph" aria-hidden="true">
          {portrait ? <img src={portrait} alt="" /> : <RecordIcon kind={card?.kind ?? records[0].kind} />}
        </span>
        <div className="map-place-title">
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {card && (
          <>
            <button
              type="button"
              className="map-icon-button"
              aria-label="Copy link to this place"
              title="Copy link to this place"
              onClick={() => void copyLink()}
            >
              <Link2 size={17} />
            </button>
            <button
              type="button"
              className="map-icon-button map-place-grip"
              aria-label={expanded ? "Collapse service" : "Expand service"}
              title={expanded ? "Collapse service" : "Expand service"}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
            </button>
          </>
        )}
        <button
          type="button"
          className="map-icon-button"
          aria-label="Close details"
          title="Close"
          onClick={close}
        >
          <X size={17} />
        </button>
      </header>
      {copied && (
        <p role="status" className="map-place-copied">
          {copied}
        </p>
      )}
      {card && reference ? (
        <>
          <ul className="map-place-chips" aria-label="Status">
            {shop && <li>{shop.closed ? "Closed" : "Open"}</li>}
            {here && <li className="map-place-chip-here">The party is here</li>}
            {!allowed && <li>Viewing only</li>}
            {dm && pin?.visibility === "dm" && <li>DM only pin</li>}
            {dm && !pin && reference.kind !== "location" && <li>Shown at its location</li>}
          </ul>
          <div className="map-place-links">
            {card.href && (
              <AppLink className="settings-link" href={card.href}>
                Library record →
              </AppLink>
            )}
            {deepLinked && canGoBack && (
              <Button onClick={() => router.history.back()}>Back</Button>
            )}
            {reference.kind === "location" &&
              locationMaps(reference.id)
                .filter((m) => m.id !== map.id)
                .map((m) => (
                  <Button key={m.id} onClick={() => selectMap(m.id)}>
                    Open {m.name}
                  </Button>
                ))}
          </div>
          {card.description && <p>{card.description}</p>}
          {allowed ? (
            <Suspense fallback={<p role="status">Opening service…</p>}>
              <MapServicePanel
                key={`${reference.kind}:${reference.id}`}
                reference={reference}
                table={table}
                close={close}
                titled={false}
              />
            </Suspense>
          ) : (
            <p className="map-place-readonly">
              {reference.kind === "property"
                ? "Private property."
                : "Viewing only. Using this needs the party to be here; the map doesn't grant remote access."}
            </p>
          )}
        </>
      ) : (
        <ul className="map-place-list">
          {records.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <span>
                {r.href ? (
                  <AppLink className="settings-link" href={r.href}>
                    {r.label} →
                  </AppLink>
                ) : (
                  <strong>{r.label}</strong>
                )}
                {records.length > 1 && <small>{r.kind}</small>}
              </span>
              {r.reference && (
                <Button onClick={() => openService(r)}>Open in map</Button>
              )}
              {r.targetMapId && (
                <Button onClick={() => selectMap(r.targetMapId!, r.entry)}>Open map</Button>
              )}
              {r.reference?.kind === "location" &&
                locationMaps(r.reference.id)
                  .filter((m) => m.id !== map.id)
                  .map((m) => (
                    <Button key={m.id} onClick={() => selectMap(m.id)}>
                      Open {m.name}
                    </Button>
                  ))}
              {r.description && <p>{r.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
