import { lazy, Suspense, useState } from "react";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { mapReferenceRecord, mapReferenceName } from "@/lib/quire/connected-maps";
import { npcAvailableHere, shopVisible } from "@/lib/quire/world";
import { useSeat } from "@/lib/quire/seat";
import { canReadCharacter } from "@/lib/quire/character-position";
import { canAccessEstate } from "@/lib/quire/estate";
import { readEstate } from "@/lib/quire/estate-schema";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { propertyAvailableHere } from "@/lib/quire/property";
import { exchangeHere } from "@/lib/quire/trade-economy";
import { facilityAccess } from "@/lib/quire/ships";
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
}: {
  reference: MapRecordReference;
  table: CloudTable;
  close: () => void;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    record = mapReferenceRecord(table, reference),
    estate = readEstate(table.journal?.propertyOperations),
    market = readMarketLocations(table.journal?.market);
  const [training, setTraining] = useState(false);
  let allowed = !!record;
  if (!dm && record)
    switch (reference.kind) {
      case "shop": {
        const s = table.shops.find((s) => s.id === reference.id)!;
        allowed = seat.shopIds.includes(s.id) && shopVisible(s, table);
        break;
      }
      case "npc":
        allowed = npcAvailableHere(
          table.journal!.world!.npcs.find((n) => n.id === reference.id)!,
          table,
        );
        break;
      case "character":
        allowed = canReadCharacter(
          table,
          table.purses.find((p) => p.id === reference.id)!,
          seat,
        );
        break;
      case "property": {
        const h = table.holdings.find((h) => h.id === reference.id)!;
        allowed = seat.purseIds.includes(h.purseId) || canAccessEstate(table, estate, h.id, seat);
        break;
      }
      case "listing": {
        const l = table.listings.find((l) => l.id === reference.id)!;
        allowed =
          propertyAvailableHere(l, market, !!table.journal?.world?.partyPosition) &&
          l.quantity !== 0 &&
          l.status !== "withdrawn";
        break;
      }
      case "exchange": {
        const e = table.journal!.tradeEconomy!.exchanges.find((e) => e.id === reference.id)!;
        allowed = e.visible && exchangeHere(table, e);
        break;
      }
      case "facility":
        allowed = facilityAccess(
          table,
          table.journal!.fleet!.facilities.find((f) => f.id === reference.id)!,
          seat,
        );
        break;
      case "entry": {
        const e = table.journal!.entries!.find((e) => e.id === reference.id)!;
        allowed =
          e.visibility === "party" ||
          (e.visibility === "player" && seat.purseIds.includes(e.purseId));
        break;
      }
    }
  if (!allowed || !record)
    return (
      <section aria-label="Map service">
        <p>This record is no longer available here. Your map view does not grant remote access.</p>
        <Button onClick={close}>Close service</Button>
      </section>
    );
  return (
    <section aria-label="Map service" className="map-service-content">
      <h3>{mapReferenceName(table, reference)}</h3>
      <Suspense fallback={<p role="status">Opening service…</p>}>
        {reference.kind === "shop" && (
          <>
            <Shop shopId={reference.id} onRemoved={close} />
            {estate.postal.offices.some((o) => o.shopId === reference.id) && (
              <Fold title="Post office · letters & manager orders">
                <Postal />
              </Fold>
            )}
          </>
        )}
        {reference.kind === "npc" && (
          <>
            <Npc npcId={reference.id} />
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
