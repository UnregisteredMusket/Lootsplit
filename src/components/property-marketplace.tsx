import { SearchSelect } from "@/components/search-select";
import { useEffect, useState } from "react";
import { Building2, MapPin, ScrollText, Search, Scale, KeyRound } from "lucide-react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import {
  formatCopper,
  parsePrice,
  priceAfterCharisma,
  toCopper,
  charismaOffPercent,
} from "@/lib/quire/money";
import { charismaScore } from "@/lib/quire/sheet";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import {
  PROPERTY_TYPES,
  PROPERTY_CONDITIONS,
  propertyAvailableHere,
  propertyStatus,
  listingSchema,
} from "@/lib/quire/property";
import { readMarketLocations, locationLabel, locationPath } from "@/lib/quire/shop-locations";
import type { Listing } from "@/lib/quire/market";
import type { Purse } from "@/lib/quire/types";
import { PropertyFacts, PropertyProfileFields } from "./property-profile";
import { LocationOptions } from "./market-locations";
import { AppLink } from "./app-link";
import { Button, Field, Select, TextInput, TextArea, Modal } from "./ui";
import { propertyDraft, readPropertyDraft } from "@/lib/quire/property-draft";
import "./property-marketplace.css";

function PropertyImage({
  listing,
  index = 0,
}: {
  listing: Pick<Listing, "name" | "property">;
  index?: number;
}) {
  const source = listing.property?.images?.[index];
  return (
    <div className={`property-image ${source ? "" : "property-image-placeholder"}`}>
      {source ? (
        <img
          src={source}
          alt={`${listing.name} · view ${index + 1}`}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = "/art/property-default.webp";
          }}
        />
      ) : (
        <>
          <Building2 aria-hidden="true" />
          <span>Illustrative property artwork</span>
        </>
      )}
    </div>
  );
}

export function PropertyMarketplace() {
  const { listings, journal, purses, sheets, ready } = useEconomy(),
    seat = useSeat();
  const market = readMarketLocations(journal.market),
    dm = seat.role === "dm";
  const mine = purses.filter((purse) => dm || seat.purseIds.includes(purse.id));
  const [query, setQuery] = useState(""),
    [location, setLocation] = useState(""),
    [type, setType] = useState(""),
    [condition, setCondition] = useState(""),
    [price, setPrice] = useState(""),
    [status, setStatus] = useState("available"),
    [here, setHere] = useState(!dm),
    [sort, setSort] = useState("name"),
    [affordable, setAffordable] = useState(false),
    [buyer, setBuyer] = useState(mine[0]?.id ?? ""),
    [detailId, setDetailId] = useState<string | null>(null),
    [viewedListing, setViewedListing] = useState<Listing | null>(null),
    [editing, setEditing] = useState<Listing | "new" | null>(null),
    [notice, setNotice] = useState(""),
    [editorState, setEditorState] = useState({ dirty: false, busy: false }),
    [compareIds, setCompareIds] = useState<string[]>([]);
  useEffect(() => {
    if (!mine.some((purse) => purse.id === buyer)) setBuyer(mine[0]?.id ?? "");
  }, [mine, buyer]);
  const properties = listings.filter(
    (listing) =>
      listing.kind === "property" &&
      (dm ||
        (propertyAvailableHere(listing, market) &&
          listing.quantity !== 0 &&
          listing.status !== "withdrawn")),
  );
  const buyerPurse = mine.find((purse) => purse.id === buyer),
    budget = buyerPurse ? toCopper(buyerPurse.coins) : 0;
  const score =
    buyerPurse?.kind === "party"
      ? null
      : (buyerPurse?.sheet?.scores.cha ??
        charismaScore(sheets.find((sheet) => sheet.purseId === buyer)));
  const maximum = price.trim() ? parsePrice(price) : null;
  const filtered = properties
    .filter((listing) => {
      if (type && (listing.property?.type ?? "other") !== type) return false;
      if (condition && listing.property?.condition !== condition) return false;
      if (
        status === "available" &&
        (listing.quantity === 0 || (listing.status && listing.status !== "available"))
      )
        return false;
      if (status === "reserved" && (listing.status !== "reserved" || listing.quantity === 0))
        return false;
      if (status === "sold" && listing.quantity !== 0) return false;
      if (status === "withdrawn" && listing.status !== "withdrawn") return false;
      if (here && !propertyAvailableHere(listing, market)) return false;
      if (
        location === "campaignwide"
          ? !!listing.locationId
          : location &&
            !locationPath(market, listing.locationId).some((place) => place.id === location)
      )
        return false;
      if (price.trim() && (maximum === null || listing.copper > maximum)) return false;
      if (affordable && (!buyerPurse || priceAfterCharisma(listing.copper, score) > budget))
        return false;
      return [
        listing.name,
        listing.notes,
        locationLabel(market, listing.locationId),
        listing.property?.address,
        listing.property?.seller,
        ...(listing.property?.features ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase());
    })
    .sort((a, b) =>
      sort === "low"
        ? a.copper - b.copper || a.name.localeCompare(b.name)
        : sort === "high"
          ? b.copper - a.copper || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name),
    );
  const compared = properties.filter((listing) => compareIds.includes(listing.id));
  const currentListing = properties.find((listing) => listing.id === detailId);
  const selected = currentListing || viewedListing;
  function clearFilters() {
    setQuery("");
    setLocation("");
    setType("");
    setCondition("");
    setPrice("");
    setStatus("available");
    setHere(!dm);
    setAffordable(false);
    setSort("name");
  }
  return (
    <section className="property-marketplace" id="property-listings" aria-label="Property listings">
      <header className="property-register">
        <div className="property-register-seal">
          <ScrollText aria-hidden="true" />
        </div>
        <div>
          <p className="property-eyebrow">The adventurer's property register</p>
          <h2>Deeds & dwellings</h2>
          <p>A hearth to return to. A stronghold to call your own.</p>
          <p className="property-location">
            <MapPin aria-hidden="true" />
            {market.currentLocationId
              ? locationLabel(market, market.currentLocationId)
              : "Across the campaign"}
          </p>
        </div>
        <div className="property-actions">
          {dm && (
            <Button disabled={!ready} onClick={() => setEditing("new")}>
              New property listing
            </Button>
          )}
          <AppLink href="/features/properties#owned-properties">Owned properties ↓</AppLink>
          {dm && <AppLink href="/market">Manage shared locations →</AppLink>}
        </div>
      </header>
      <div className="property-search-panel">
        <label className="property-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search properties</span>
          <TextInput
            placeholder="Search a keep, town or feature…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="property-filter-grid">
          <Field label="Listing location">
            <SearchSelect
              aria-label="Listing location"
              value={location}
              onValueChange={(selectedValue) => setLocation(selectedValue)}
            >
              <option value="">All locations</option>
              <option value="campaignwide">Campaignwide</option>
              {LocationOptions({ market: market })}
            </SearchSelect>
          </Field>
          <Field label="Listing property type">
            <Select
              aria-label="Listing property type"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="">All property types</option>
              {Object.entries(PROPERTY_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Asking price up to">
            <TextInput
              placeholder="1000 gp"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </Field>
          <Field label="Sort properties">
            <Select
              aria-label="Sort properties"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="name">Name · A–Z</option>
              <option value="low">Asking price · low to high</option>
              <option value="high">Asking price · high to low</option>
            </Select>
          </Field>
        </div>
        <details>
          <summary>More filters</summary>
          <div className="property-filter-grid mt-3">
            <Field label="Listing condition">
              <Select
                aria-label="Listing condition"
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
              >
                <option value="">Any condition</option>
                {Object.entries(PROPERTY_CONDITIONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Listing availability">
              <Select
                aria-label="Listing availability"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="available">For sale</option>
                <option value="reserved">Reserved</option>
                <option value="all">All listings</option>
                {dm && (
                  <>
                    <option value="sold">Sold out</option>
                    <option value="withdrawn">Withdrawn</option>
                  </>
                )}
              </Select>
            </Field>
            <Field label="Property buyer">
              <SearchSelect
                aria-label="Property buyer"
                value={buyer}
                onValueChange={(selectedValue) => setBuyer(selectedValue)}
                disabled={!mine.length}
              >
                <option value="" disabled>
                  Choose an account
                </option>
                {mine.map((purse) => (
                  <option key={purse.id} value={purse.id}>
                    {purse.name}
                  </option>
                ))}
              </SearchSelect>
            </Field>
          </div>
          <div className="property-filter-checks">
            {dm && (
              <label>
                <input
                  type="checkbox"
                  checked={here}
                  onChange={(event) => setHere(event.target.checked)}
                />{" "}
                Available at the party's location
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={affordable}
                onChange={(event) => setAffordable(event.target.checked)}
              />{" "}
              Within buyer's funds
            </label>
            {buyerPurse && (
              <span>
                {buyerPurse.name}: {formatCopper(budget)}
              </span>
            )}
          </div>
        </details>
        {price.trim() && maximum === null && (
          <p role="alert">Enter a coin amount, such as 1000 gp.</p>
        )}
      </div>
      <div className="property-results">
        <p role="status">
          {filtered.length} {filtered.length === 1 ? "property" : "properties"} found
        </p>
        <Button variant="ghost" onClick={clearFilters}>
          Clear property filters
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!!compared.length && (
        <section className="property-comparison" aria-label="Compare properties">
          <h3>
            <Scale aria-hidden="true" /> Compare deeds · {compared.length} / 3
          </h3>
          <div className="property-comparison-scroll">
            <table>
              <caption className="sr-only">Selected property particulars</caption>
              <thead>
                <tr>
                  <th scope="col">Particulars</th>
                  {compared.map((listing) => (
                    <th scope="col" key={listing.id}>
                      {listing.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Asking price", (l: Listing) => formatCopper(l.copper)],
                  ["Location", (l: Listing) => locationLabel(market, l.locationId)],
                  ["Type", (l: Listing) => PROPERTY_TYPES[l.property?.type ?? "other"]],
                  ["Rooms", (l: Listing) => l.property?.rooms ?? "Not specified"],
                  ["Grounds", (l: Listing) => l.property?.size || "Not specified"],
                  [
                    "Condition",
                    (l: Listing) =>
                      l.property?.condition
                        ? PROPERTY_CONDITIONS[l.property.condition]
                        : "Not specified",
                  ],
                  ["Features", (l: Listing) => l.property?.features?.join(", ") || "Not specified"],
                ].map(([label, get]) => (
                  <tr key={String(label)}>
                    <th scope="row">{String(label)}</th>
                    {compared.map((listing) => (
                      <td key={listing.id}>{(get as (l: Listing) => string | number)(listing)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="ghost" onClick={() => setCompareIds([])}>
            Clear comparison
          </Button>
        </section>
      )}
      <div className="property-grid">
        {filtered.map((listing) => (
          <article className="property-card" key={listing.id}>
            <div className="property-card-art">
              <PropertyImage listing={listing} />
              <span className="property-status">{propertyStatus(listing)}</span>
            </div>
            <div className="property-card-copy">
              <p className="property-eyebrow">
                {PROPERTY_TYPES[listing.property?.type ?? "other"]}
              </p>
              <h3>{listing.name}</h3>
              <p className="property-location">
                <MapPin aria-hidden="true" />
                {locationLabel(market, listing.locationId)}
              </p>
              <p className="property-asking">
                {formatCopper(listing.copper)}
                <small>Asking price · each</small>
              </p>
              <PropertyFacts profile={listing.property} />
              {listing.notes && <p className="property-excerpt">{listing.notes}</p>}
              <div className="property-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setViewedListing(listing);
                    setDetailId(listing.id);
                  }}
                >
                  View {listing.name}
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Compare ${listing.name}`}
                  aria-pressed={compared.some((l) => l.id === listing.id)}
                  disabled={!compared.some((l) => l.id === listing.id) && compared.length >= 3}
                  onClick={() =>
                    setCompareIds((ids) =>
                      ids.includes(listing.id)
                        ? ids.filter((id) => id !== listing.id)
                        : [...compared.map((l) => l.id), listing.id],
                    )
                  }
                >
                  Compare
                </Button>
                {dm && (
                  <Button
                    variant="ghost"
                    aria-label={`Edit ${listing.name} listing`}
                    onClick={() => setEditing(listing)}
                  >
                    Edit listing
                  </Button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <div className="property-empty">
          <Building2 aria-hidden="true" />
          <h3>{properties.length ? "No deeds match your search" : "No properties listed yet"}</h3>
          <p>
            {dm
              ? "Post a property with its asking price, images and place in the campaign."
              : "The DM can list properties in this area. Check again as the party travels."}
          </p>
          {properties.length ? (
            <Button variant="secondary" onClick={clearFilters}>
              Show all property matches
            </Button>
          ) : null}
        </div>
      )}
      <Modal
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailId(null);
            setViewedListing(null);
          }
        }}
        title={selected?.name || "Property unavailable"}
      >
        {selected ? (
          <PropertyViewing
            key={selected.id}
            listing={selected}
            initialBuyer={buyer}
            purses={mine}
            available={!!currentListing}
          />
        ) : (
          <p>
            This listing is no longer available in this view. Return to the property register for
            current listings.
          </p>
        )}
      </Modal>
      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (open || editorState.busy) return;
          if (editorState.dirty && !window.confirm("Discard your unsaved property listing draft?"))
            return;
          setEditing(null);
        }}
        title={editing === "new" ? "Post a property deed" : "Edit property listing"}
      >
        {editing && (
          <PropertyListingEditor
            key={editing === "new" ? "new" : editing.id}
            listing={editing === "new" ? undefined : editing}
            onState={setEditorState}
            onSaved={(message) => {
              setNotice(message);
              setEditing(null);
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function PropertyViewing({
  listing,
  initialBuyer,
  purses,
  available,
}: {
  listing: Listing;
  initialBuyer: string;
  purses: Purse[];
  available: boolean;
}) {
  const { journal, sheets, commandOutcome } = useEconomy(),
    market = readMarketLocations(journal.market);
  const [image, setImage] = useState(0),
    [buyer, setBuyer] = useState(initialBuyer || purses[0]?.id || ""),
    [quantity, setQuantity] = useState("1"),
    [review, setReview] = useState<Listing | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const { locked, reason } = useFinanceReadiness();
  useEffect(() => {
    if (!purses.some((purse) => purse.id === buyer)) setBuyer(purses[0]?.id ?? "");
  }, [purses, buyer]);
  const purse = purses.find((p) => p.id === buyer),
    units = Number(quantity),
    balance = purse ? toCopper(purse.coins) : 0;
  const score =
    purse?.kind === "party"
      ? null
      : (purse?.sheet?.scores.cha ??
        charismaScore(sheets.find((sheet) => sheet.purseId === buyer)));
  const unit = priceAfterCharisma(listing.copper, score),
    cost = unit * units;
  const valid =
    available &&
    !!purse &&
    Number.isSafeInteger(units) &&
    units > 0 &&
    units <= 100000 &&
    Number.isSafeInteger(cost) &&
    cost <= balance &&
    (listing.quantity === null || units <= listing.quantity) &&
    (!listing.status || listing.status === "available");
  const changed = !!review && JSON.stringify(review) !== JSON.stringify(listing);
  return (
    <div className="property-viewing">
      <PropertyImage
        listing={listing}
        index={Math.min(image, Math.max(0, (listing.property?.images?.length ?? 1) - 1))}
      />
      {(listing.property?.images?.length ?? 0) > 1 && (
        <div className="property-actions">
          {listing.property!.images!.map((_, index) => (
            <Button
              key={index}
              variant="secondary"
              aria-pressed={image === index}
              onClick={() => setImage(index)}
            >
              View {index + 1}
            </Button>
          ))}
        </div>
      )}
      <p className="property-location">
        <MapPin aria-hidden="true" />
        {locationLabel(market, listing.locationId)}
      </p>
      {listing.property?.address && <p>{listing.property.address}</p>}
      <PropertyFacts profile={listing.property} />
      <p className="whitespace-pre-wrap">
        {listing.notes || "No further description is recorded."}
      </p>
      {listing.property?.seller && <p>Seller / steward: {listing.property.seller}</p>}
      <p>
        {propertyStatus(listing)} ·{" "}
        {listing.quantity === null ? "Unlimited quantity" : `${listing.quantity} available`}
      </p>
      {locationPath(market, listing.locationId).some((place) => place.description) && (
        <details>
          <summary>About this location</summary>
          {locationPath(market, listing.locationId)
            .filter((place) => place.description)
            .map((place) => (
              <div key={place.id}>
                <h3>{place.name}</h3>
                <p className="whitespace-pre-wrap">{place.description}</p>
              </div>
            ))}
        </details>
      )}
      <form
        className="property-purchase"
        aria-label="Property purchase"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || locked || busy || changed) return;
          if (!review) {
            setReview(structuredClone(listing));
            setError("");
            return;
          }
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const result = await commandOutcome({
              kind: "listing",
              listingId: listing.id,
              purseId: buyer,
              quantity: units,
              before: review,
            });
            setNotice(
              mutationNotice(result, "Property purchased. Your deed and receipt are recorded."),
            );
            setReview(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Purchase could not be recorded.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>
          <KeyRound aria-hidden="true" />
          {review ? "Review your purchase" : "Acquire this property"}
        </h3>
        <Field label="Pay for property from">
          <SearchSelect
            aria-label="Pay for property from"
            disabled={busy || locked}
            value={buyer}
            onValueChange={(selectedValue) => {
              setBuyer(selectedValue);
              setReview(null);
            }}
          >
            {!purses.length && <option value="">No assigned account</option>}
            {purses.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SearchSelect>
        </Field>
        {listing.quantity !== 1 && (
          <Field label="Property purchase quantity">
            <TextInput
              type="number"
              min="1"
              max={listing.quantity ?? 100000}
              step="1"
              disabled={busy || locked}
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setReview(null);
              }}
            />
          </Field>
        )}
        <dl className="property-price-summary">
          <div>
            <dt>Asking price · each</dt>
            <dd>{formatCopper(listing.copper)}</dd>
          </div>
          <div>
            <dt>Purchase price · each</dt>
            <dd>{formatCopper(unit)}</dd>
          </div>
          <div>
            <dt>Purchase total</dt>
            <dd>
              {Number.isSafeInteger(cost) && units > 0
                ? formatCopper(cost)
                : "Choose a whole quantity"}
            </dd>
          </div>
          <div>
            <dt>Available funds</dt>
            <dd>{formatCopper(balance)}</dd>
          </div>
          <div>
            <dt>After purchase</dt>
            <dd>
              {Number.isSafeInteger(cost) && units > 0 && balance >= cost
                ? formatCopper(balance - cost)
                : "Insufficient funds"}
            </dd>
          </div>
        </dl>
        {score !== null && charismaOffPercent(score) > 0 && (
          <p>
            Charisma {score} takes {charismaOffPercent(score)}% off under this campaign's existing
            pricing.
          </p>
        )}
        {reason && <p role="status">{reason}</p>}
        {!available && <p role="status">This listing is no longer available for a new purchase.</p>}
        {changed && (
          <p role="alert">
            This listing changed. Review the current details again before confirming.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && (
          <p role="status">
            {notice}{" "}
            <AppLink href="/features/properties#owned-properties">View owned properties</AppLink> ·{" "}
            <AppLink href="/party?section=funds">Open inventory & ledger</AppLink>
          </p>
        )}
        <div className="property-actions">
          <Button type="submit" disabled={!valid || busy || locked || changed}>
            {busy
              ? "Recording purchase…"
              : review
                ? `Confirm purchase · ${formatCopper(cost)}`
                : "Review property purchase"}
          </Button>
          {review && (
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => {
                setReview(null);
                setError("");
              }}
            >
              Review current details
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function PropertyListingEditor({
  listing,
  onSaved,
  onState,
}: {
  listing?: Listing;
  onSaved: (message: string) => void;
  onState: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const { journal, commandOutcome, listings } = useEconomy(),
    market = readMarketLocations(journal.market);
  const [id] = useState(() => listing?.id || crypto.randomUUID()),
    [before, setBefore] = useState(listing ?? null),
    [name, setName] = useState(listing?.name ?? ""),
    [notes, setNotes] = useState(listing?.notes ?? ""),
    [price, setPrice] = useState(listing ? `${listing.copper} cp` : ""),
    [quantity, setQuantity] = useState(
      listing?.quantity === null ? "" : String(listing?.quantity ?? 1),
    ),
    [status, setStatus] = useState<Listing["status"]>(listing?.status ?? "available"),
    [locationId, setLocationId] = useState(listing?.locationId ?? market.currentLocationId ?? ""),
    [estateTemplateKey, setEstateTemplateKey] = useState(listing?.estateTemplateKey ?? ""),
    [draft, setDraft] = useState(propertyDraft(listing?.property)),
    [busy, setBusy] = useState(false),
    [imageBusy, setImageBusy] = useState(false),
    [error, setError] = useState("");
  const { locked, reason } = useFinanceReadiness();
  const [initial, setInitial] = useState(
    JSON.stringify({ name, notes, price, quantity, status, locationId, estateTemplateKey, draft }),
  );
  const dirty =
    initial !== JSON.stringify({ name, notes, price, quantity, status, locationId, estateTemplateKey, draft });
  useDraftGuard(dirty, "property listing");
  useEffect(() => {
    onState({ dirty, busy: busy || imageBusy });
  }, [dirty, busy, imageBusy, onState]);
  const current = listings.find((l) => l.id === id) ?? null,
    stale = JSON.stringify(current) !== JSON.stringify(before);
  async function save(remove = false) {
    if (busy || imageBusy || locked) return;
    setBusy(true);
    setError("");
    try {
      const copper = parsePrice(price),
        units = quantity.trim() === "" ? null : Number(quantity);
      if (
        !remove &&
        (!name.trim() ||
          copper === null ||
          (units !== null && (!Number.isSafeInteger(units) || units < 0)))
      )
        throw Error(
          "Enter a name, a valid coin price and a whole quantity, or leave quantity blank for unlimited.",
        );
      const after = remove
        ? null
        : listingSchema.parse({
            id,
            kind: "property",
            name: name.trim(),
            notes: notes.trim(),
            copper,
            quantity: units,
            status,
            ...(locationId ? { locationId } : {}),
            property: readPropertyDraft(draft),
            ...(estateTemplateKey ? { estateTemplateKey } : {}),
            ...(before?.estateAttachments ? { estateAttachments: before.estateAttachments } : {}),
          });
      const result = await commandOutcome({ kind: "listing-edit", listingId: id, before, after });
      onSaved(
        mutationNotice(
          result,
          remove
            ? "Property listing removed. Owned deeds and receipts are retained."
            : "Property listing saved.",
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save listing. Your draft is retained.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="Property listing editor"
      className="property-listing-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field label="Listing name">
        <TextInput
          required
          maxLength={160}
          value={name}
          disabled={busy || locked}
          placeholder="The Lantern & Oak Inn"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="property-form-grid">
        <Field label="Listing asking price">
          <TextInput
            required
            value={price}
            disabled={busy || locked}
            placeholder="750 gp"
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
        <Field label="Listing quantity" hint="Leave blank for unlimited.">
          <TextInput
            type="number"
            min="0"
            step="1"
            value={quantity}
            disabled={busy || locked}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Listing status">
        <Select
          aria-label="Listing status"
          value={status}
          disabled={busy || locked}
          onChange={(event) => setStatus(event.target.value as Listing["status"])}
        >
          <option value="available">For sale</option>
          <option value="reserved">Reserved</option>
          <option value="withdrawn">Withdrawn</option>
        </Select>
      </Field>
      <Field label="Listing description">
        <TextArea
          maxLength={4000}
          value={notes}
          disabled={busy || locked}
          placeholder="Describe the rooms, grounds and any quirks an adventurer should know."
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      <Field label="Property operations template"><SearchSelect value={estateTemplateKey} onValueChange={(selectedValue) => setEstateTemplateKey(selectedValue)}><option value="">No operations template</option>{journal.propertyOperations?.templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}</SearchSelect></Field>
      <PropertyProfileFields
        draft={draft}
        onChange={setDraft}
        locationId={locationId}
        onLocationChange={setLocationId}
        market={market}
        disabled={busy || imageBusy || locked}
        onImageBusy={setImageBusy}
      />
      {reason && <p role="status">{reason}</p>}
      {stale && (
        <p role="status">
          This listing changed elsewhere. Your draft is retained; reload current details before
          saving.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="property-actions">
        <Button
          type="submit"
          disabled={busy || imageBusy || locked || stale || (!!before && !dirty)}
        >
          Save property listing
        </Button>
        {before && (
          <>
            <Button
              variant="secondary"
              disabled={busy || imageBusy}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm("Discard your unsaved listing draft and reload current details?")
                )
                  return;
                if (!current) {
                  setError("This listing was removed elsewhere. Your draft is retained.");
                  return;
                }
                const next = {
                  name: current.name,
                  notes: current.notes,
                  price: `${current.copper} cp`,
                  quantity: current.quantity === null ? "" : String(current.quantity),
                  status: current.status ?? "available",
                  locationId: current.locationId ?? "",
                  estateTemplateKey: current.estateTemplateKey ?? "",
                  draft: propertyDraft(current.property),
                };
                setBefore(current);
                setName(next.name);
                setNotes(next.notes);
                setPrice(next.price);
                setQuantity(next.quantity);
                setStatus(next.status);
                setLocationId(next.locationId);
                setEstateTemplateKey(next.estateTemplateKey);
                setDraft(next.draft);
                setInitial(JSON.stringify(next));
                setError("");
              }}
            >
              Reload listing
            </Button>
            <Button
              variant="danger"
              disabled={busy || imageBusy || locked || stale}
              onClick={() => {
                if (
                  window.confirm(
                    `Remove ${before.name} from the property register? Owned deeds and receipts will be retained.`,
                  )
                )
                  void save(true);
              }}
            >
              Remove property listing
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
