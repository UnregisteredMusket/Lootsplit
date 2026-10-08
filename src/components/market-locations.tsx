import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import {
  locationLabel,
  locationPath,
  readMarketLocations,
  type MarketLocation,
  type MarketLocations,
} from "@/lib/quire/shop-locations";
import type { Shop } from "@/lib/quire/types";
import { Button, Fold, Select, TextInput } from "./ui";
import { MarketImageUpload } from "./market-image-upload";
import { MarketNameImport } from "./market-name-import";

export function LocationOptions({ market }: { market: MarketLocations }) {
  return [...market.locations]
    .sort((a, b) => locationLabel(market, a.id).localeCompare(locationLabel(market, b.id)))
    .map((location) => (
      <option key={location.id} value={location.id}>
        {locationLabel(market, location.id)} · {location.kind}
      </option>
    ));
}

export function MarketLocationsPanel() {
  const { journal, commandOutcome, shops } = useEconomy(),
    seat = useSeat();
  const market = readMarketLocations(journal.market);
  const path = locationPath(market, market.currentLocationId);
  const [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = market.locations.find((location) => location.id === editing);
  return (
    <section aria-label="Market locations" className="mt-5 space-y-3">
      <div className="rounded-lg border border-border bg-subtle p-4">
        {seat.role === "dm" ? (
          <label className="block text-sm font-medium">
            Party location
            <Select
              className="mt-1"
              aria-label="Party location"
              value={market.currentLocationId ?? ""}
              disabled={busy}
              onChange={async (event) => {
                const locationId = event.target.value || null;
                setBusy(true);
                setError("");
                try {
                  const result = await commandOutcome({
                    kind: "party-location",
                    before: market.currentLocationId,
                    locationId,
                  });
                  toast.success(mutationNotice(result, "Party location saved."));
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "The party could not move.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value="">All campaign shops · no location set</option>
              <LocationOptions market={market} />
            </Select>
          </label>
        ) : (
          <p className="font-medium">
            Party location:{" "}
            {market.currentLocationId
              ? locationLabel(market, market.currentLocationId)
              : "All campaign shops"}
          </p>
        )}
        <p className="mt-2 text-sm text-muted">
          {market.currentLocationId
            ? "Shops in this location and its parent locations are available, along with campaignwide shops."
            : "All shops are available until the Dungeon Master sets a location."}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {path.length ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {path.map((location) => (
            <article
              key={location.id}
              className="overflow-hidden rounded-lg border border-border bg-subtle"
            >
              {location.image ? (
                <img
                  src={location.image}
                  alt={location.name}
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : null}
              <div className="p-3">
                <p className="text-sm capitalize text-muted">{location.kind}</p>
                <h2 className="font-display text-xl">{location.name}</h2>
                {location.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{location.description}</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {seat.role === "dm" ? (
        <Fold
          title="Manage regions, cities, towns and areas"
          hint={`${market.locations.length} locations · images and descriptions are player facing`}
        >
          <div className="space-y-3">
            <label className="block text-sm">
              Edit location
              <Select
                aria-label="Edit location"
                value={editing ?? ""}
                disabled={!!editing}
                onChange={(event) => setEditing(event.target.value || null)}
              >
                <option value="">Choose a location</option>
                <LocationOptions market={market} />
              </Select>
            </label>
            <Button variant="secondary" disabled={!!editing} onClick={() => setEditing("new")}>
              Create location
            </Button>
            <MarketNameImport market={market} shops={shops} disabled={!!editing} />
            {editing ? (
              <LocationEditor
                key={editing}
                location={selected}
                market={market}
                shops={shops}
                onClose={() => setEditing(null)}
              />
            ) : null}
          </div>
        </Fold>
      ) : null}
    </section>
  );
}

function LocationEditor({
  location,
  market,
  shops,
  onClose,
}: {
  location?: MarketLocation;
  market: MarketLocations;
  shops: Shop[];
  onClose: () => void;
}) {
  const { commandOutcome } = useEconomy();
  const [original] = useState(location ?? null);
  const [kind, setKind] = useState<MarketLocation["kind"]>(location?.kind ?? "region");
  const [parentId, setParentId] = useState(location?.parentId ?? ""),
    [name, setName] = useState(location?.name ?? "");
  const [description, setDescription] = useState(location?.description ?? ""),
    [image, setImage] = useState(location?.image);
  const [busy, setBusy] = useState(false),
    [imageBusy, setImageBusy] = useState(false),
    [error, setError] = useState("");
  const draft = {
    id: location?.id ?? "new",
    kind,
    parentId: kind === "region" ? null : parentId || null,
    name,
    description,
    ...(image ? { image } : {}),
  };
  useDraftGuard(
    !busy &&
      (imageBusy ||
        JSON.stringify(draft) !==
          JSON.stringify(
            original ?? { id: "new", kind: "region", parentId: null, name: "", description: "" },
          )),
    "location configuration",
  );
  const parents = market.locations.filter((candidate) =>
    kind === "area"
      ? candidate.kind === "city" || candidate.kind === "town"
      : candidate.kind === "region",
  );
  const used =
    !!location &&
    (market.currentLocationId === location.id ||
      market.locations.some((child) => child.parentId === location.id) ||
      shops.some((shop) => shop.locationId === location.id));
  async function save(remove = false) {
    setBusy(true);
    setError("");
    try {
      const locationId = location?.id ?? crypto.randomUUID();
      const result = await commandOutcome({
        kind: "market-location",
        locationId,
        before: original,
        after: remove ? null : { ...draft, id: locationId },
      });
      toast.success(mutationNotice(result, remove ? "Location removed." : "Location saved."));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The location could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="Location configuration"
      className="space-y-3 rounded-sm border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="block text-sm">
        Location type
        <Select
          aria-label="Location type"
          value={kind}
          disabled={busy}
          onChange={(event) => {
            setKind(event.target.value as typeof kind);
            setParentId("");
          }}
        >
          <option value="region">Region</option>
          <option value="city">City</option>
          <option value="town">Town</option>
          <option value="area">Area</option>
        </Select>
      </label>
      {kind !== "region" ? (
        <label className="block text-sm">
          {kind === "area" ? "City or town" : "Region"}
          <Select
            aria-label="Parent location"
            value={parentId}
            disabled={busy}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">Choose a {kind === "area" ? "city or town" : "region"}</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {locationLabel(market, parent.id)}
              </option>
            ))}
          </Select>
          {!parents.length ? (
            <span className="mt-1 block text-muted">Create the parent location first.</span>
          ) : null}
        </label>
      ) : null}
      <label className="block text-sm">
        Location name
        <TextInput
          aria-label="Location name"
          value={name}
          maxLength={160}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Player description
        <textarea
          aria-label="Location description"
          className="ledger-search mt-1 min-h-24 w-full"
          value={description}
          maxLength={4000}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <MarketImageUpload
        label="Location image"
        disabled={busy}
        value={image}
        onChange={setImage}
        onBusyChange={setImageBusy}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={busy || imageBusy || !name.trim() || (kind !== "region" && !parentId)}
        >
          Save location
        </Button>
        <Button variant="secondary" disabled={busy || imageBusy} onClick={onClose}>
          Cancel
        </Button>
        {location ? (
          <Button
            variant="danger"
            disabled={busy || imageBusy || used}
            onClick={() => {
              if (window.confirm(`Remove ${location.name}?`)) void save(true);
            }}
          >
            Remove location
          </Button>
        ) : null}
      </div>
      {used ? (
        <p className="text-sm text-muted">
          Move assigned shops, child locations and the party before removing this location.
        </p>
      ) : null}
    </form>
  );
}

export function ShopLocationEditor({ shop }: { shop: Shop }) {
  const { journal, commandOutcome } = useEconomy(),
    market = readMarketLocations(journal.market);
  const [baseline, setBaseline] = useState({
    locationId: shop.locationId ?? null,
    image: shop.image ?? null,
  });
  const [locationId, setLocationId] = useState(shop.locationId ?? ""),
    [image, setImage] = useState(shop.image);
  const [busy, setBusy] = useState(false),
    [imageBusy, setImageBusy] = useState(false),
    [error, setError] = useState("");
  const dirty = locationId !== (baseline.locationId ?? "") || (image ?? null) !== baseline.image;
  useEffect(() => {
    if (dirty || busy || imageBusy) return;
    setLocationId(shop.locationId ?? "");
    setImage(shop.image);
    setBaseline({ locationId: shop.locationId ?? null, image: shop.image ?? null });
  }, [shop.locationId, shop.image, dirty, busy, imageBusy]);
  useDraftGuard(!busy && (dirty || imageBusy), "shop location and image");
  return (
    <form
      aria-label="Shop location and image"
      className="space-y-3 rounded-sm border border-border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await commandOutcome({
            kind: "shop-location",
            shopId: shop.id,
            before: baseline,
            locationId: locationId || null,
            image: image ?? null,
          });
          toast.success(mutationNotice(result, "Shop location and image saved."));
          setBaseline({ locationId: locationId || null, image: image ?? null });
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "The shop could not be saved.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm">
        Shop availability
        <Select
          aria-label="Shop availability"
          value={locationId}
          disabled={busy}
          onChange={(event) => setLocationId(event.target.value)}
        >
          <option value="">Campaignwide · available everywhere</option>
          <LocationOptions market={market} />
        </Select>
      </label>
      <p className="text-sm text-muted">
        A shop assigned to a region, city or town is also available in its areas. Its address, stock
        and trading rules stay configured below.
      </p>
      <MarketImageUpload
        label="Shop image"
        disabled={busy}
        value={image}
        onChange={setImage}
        onBusyChange={setImageBusy}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || imageBusy || !dirty}>
        Save shop location and image
      </Button>
    </form>
  );
}
