import { lazy, Suspense, useState } from "react";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { mapReferenceRecord, mapReferenceName } from "@/lib/quire/connected-maps";
import { useSeat } from "@/lib/quire/seat";
import { canAccessEstate } from "@/lib/quire/estate";
import { readEstate } from "@/lib/quire/estate-schema";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { mapServiceAllowed } from "@/lib/quire/place-hub";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { journalEntryHref } from "@/lib/quire/journal-navigation";
import type { CloudTable } from "@/lib/quire/cloud";
import { AppLink } from "./app-link";
import { Button, Fold } from "./ui";
import { CommandButton } from "./world-tools";
const Shop = lazy(() => import("./shop-content").then((m) => ({ default: m.ShopContent })));
const Npc = lazy(() => import("./location-npcs").then((m) => ({ default: m.NpcMapService })));
const Property = lazy(() =>
  import("./property-details").then((m) => ({ default: m.PropertyDetails })),
);
const Listing = lazy(() =>
  import("./property-marketplace").then((m) => ({ default: m.MapListingService })),
);
const Exchange = lazy(() =>
  import("./trade-economy").then((m) => ({ default: m.MapExchangeService })),
);
const Ship = lazy(() => import("./ship-management").then((m) => ({ default: m.ShipManagement })));
const Postal = lazy(() =>
  import("./property-operations").then((m) => ({ default: m.MapPostalService })),
);
const Training = lazy(() =>
  import("./downtime-activities").then((m) => ({ default: m.DowntimeActivities })),
);

/** All actions use the same components/commands as their original destinations.
 * This boundary rechecks current canonical permission on every render. */
export function MapServicePanel({
  reference,
  table,
  close,
  titled = true,
}: {
  reference: MapRecordReference;
  table: CloudTable;
  close: () => void;
  /** False inside the place card, whose header already names the record. */
  titled?: boolean;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    record = mapReferenceRecord(table, reference),
    estate = readEstate(table.journal?.propertyOperations),
    market = readMarketLocations(table.journal?.market);
  const [training, setTraining] = useState(false);
  const allowed = mapServiceAllowed(table, reference, seat);
  if (!allowed || !record)
    return (
      <section aria-label="Map service">
        <p>This record is no longer available here. Your map view does not grant remote access.</p>
        <Button onClick={close}>Close service</Button>
      </section>
    );
  return (
    <section aria-label="Map service" className="map-service-content">
      {titled && <h3>{mapReferenceName(table, reference)}</h3>}
      <Suspense fallback={<p role="status">Opening service…</p>}>
        {reference.kind === "shop" && (
          <>
            <Shop shopId={reference.id} onRemoved={close} mapStrip={false} />
            {estate.postal.offices.some((o) => o.shopId === reference.id) && (
              <Fold title="Post office · letters & manager orders">
                <Postal />
              </Fold>
            )}
          </>
        )}
        {reference.kind === "npc" && (
          <>
            <Npc npcId={reference.id} onFarewell={close} />
            <Button onClick={() => setTraining((v) => !v)}>
              {training ? "Close training" : "Train this NPC"}
            </Button>
            {training && <Training initialNpcId={reference.id} />}
          </>
        )}
        {reference.kind === "property" && <Property propertyId={reference.id} plans />}
        {reference.kind === "listing" && <Listing listingId={reference.id} />}
        {reference.kind === "exchange" && <Exchange exchangeId={reference.id} />}
        {reference.kind === "facility" && (
          <>
            <p>{"name" in record ? record.name : ""} · dock / shipyard</p>
            {table.holdings
              .filter(
                (h) =>
                  h.kind === "property" &&
                  table.journal?.fleet?.vessels.some((v) => v.propertyId === h.id) &&
                  (dm ||
                    seat.purseIds.includes(h.purseId) ||
                    canAccessEstate(table, estate, h.id, seat)),
              )
              .map((h) => (
                <Fold key={h.id} title={h.name}>
                  <Ship holding={h} />
                </Fold>
              ))}
            <AppLink href="/features/ships">Open Ships & voyages →</AppLink>
          </>
        )}
        {reference.kind === "character" && (
          <AppLink href={`/characters?id=${encodeURIComponent(`party:${reference.id}`)}`}>
            Open character sheet →
          </AppLink>
        )}
        {reference.kind === "location" && (
          <>
            <p>{"description" in record ? record.description : ""}</p>
            <p>Browsing leaves party location and campaign time unchanged.</p>
            {dm && (
              <CommandButton
                input={{
                  kind: "party-location",
                  locationId: reference.id,
                  before: market.currentLocationId,
                  beforePosition: table.journal?.world?.partyPosition
                    ? canonicalJson(table.journal.world.partyPosition)
                    : undefined,
                }}
              >
                Move party here
              </CommandButton>
            )}
          </>
        )}
        {reference.kind === "entry" && (
          <>
            <p className="whitespace-pre-wrap">{"text" in record ? record.text : ""}</p>
            <AppLink href={journalEntryHref(reference.id)}>Open journal entry →</AppLink>
          </>
        )}
        {reference.kind === "handout" && (
          <p className="whitespace-pre-wrap">{"text" in record ? record.text : ""}</p>
        )}
      </Suspense>
    </section>
  );
}
