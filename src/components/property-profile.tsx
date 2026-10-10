import { SearchSelect } from "@/components/search-select";
import { useState } from "react";
import { propertyDraft, readPropertyDraft, type PropertyDraft } from "@/lib/quire/property-draft";
import { useEconomy } from "@/lib/quire/economy-context";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useFinanceReadiness } from "@/lib/quire/use-finance-readiness";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { PROPERTY_TYPES, PROPERTY_CONDITIONS, type PropertyProfile } from "@/lib/quire/property";
import {
  readMarketLocations,
  locationLabel,
  type MarketLocations,
} from "@/lib/quire/shop-locations";
import type { Holding } from "@/lib/quire/types";
import { LocationOptions } from "./market-locations";
import { MarketImageUpload } from "./market-image-upload";
import { Button, Field, TextInput } from "./ui";

export function PropertyProfileFields({
  draft,
  onChange,
  locationId,
  onLocationChange,
  market,
  disabled,
  onImageBusy,
}: {
  draft: PropertyDraft;
  onChange: (draft: PropertyDraft) => void;
  locationId: string;
  onLocationChange: (id: string) => void;
  market: MarketLocations;
  disabled: boolean;
  onImageBusy: (busy: boolean) => void;
}) {
  return (
    <fieldset disabled={disabled} className="property-profile-fields">
      <legend className="font-display text-2xl">The particulars</legend>
      <Field
        label="Property location"
        hint="Uses the same regions, settlements and areas as shops."
      >
        <SearchSelect
          aria-label="Property location"
          value={locationId}
          onValueChange={(selectedValue) => onLocationChange(selectedValue)}
        >
          <option value="">Campaignwide</option>
          {LocationOptions({ market: market })}
        </SearchSelect>
      </Field>
      <div className="property-form-grid">
        <Field label="Property type">
          <SearchSelect
            aria-label="Property type"
            value={draft.type}
            onValueChange={(selectedValue) =>
              onChange({ ...draft, type: selectedValue as PropertyDraft["type"] })
            }
          >
            {Object.entries(PROPERTY_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <Field label="Property condition">
          <SearchSelect
            aria-label="Property condition"
            value={draft.condition}
            onValueChange={(selectedValue) =>
              onChange({ ...draft, condition: selectedValue as PropertyDraft["condition"] })
            }
          >
            <option value="">Not specified</option>
            {Object.entries(PROPERTY_CONDITIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <Field label="Rooms">
          <TextInput
            type="number"
            min="0"
            max="10000"
            step="1"
            value={draft.rooms}
            onChange={(event) => onChange({ ...draft, rooms: event.target.value })}
          />
        </Field>
        <Field label="Size or grounds">
          <TextInput
            maxLength={100}
            placeholder="Three floors · 2 acres"
            value={draft.size}
            onChange={(event) => onChange({ ...draft, size: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Street or landmark">
        <TextInput
          maxLength={160}
          placeholder="Beside the western gate"
          value={draft.address}
          onChange={(event) => onChange({ ...draft, address: event.target.value })}
        />
      </Field>
      <Field label="Seller or steward">
        <TextInput
          maxLength={160}
          value={draft.seller}
          onChange={(event) => onChange({ ...draft, seller: event.target.value })}
        />
      </Field>
      <Field label="Property features" hint="Up to 12 features, separated by commas.">
        <TextInput
          aria-label="Property features"
          maxLength={972}
          placeholder="Stable, Cellar, Walled garden"
          value={draft.features}
          onChange={(event) => onChange({ ...draft, features: event.target.value })}
        />
      </Field>
      <details className="property-image-editor">
        <summary>Property images · {draft.images.filter(Boolean).length} / 3</summary>
        {[0, 1, 2].map((index) => (
          <MarketImageUpload
            key={index}
            label={`Property image ${index + 1}`}
            value={draft.images[index] || undefined}
            disabled={disabled}
            onBusyChange={onImageBusy}
            onChange={(image) => {
              const images = [...draft.images];
              images[index] = image || "";
              onChange({ ...draft, images });
            }}
          />
        ))}
      </details>
    </fieldset>
  );
}

export function PropertyFacts({ profile }: { profile?: PropertyProfile }) {
  return (
    <>
      <div className="property-facts">
        <span>{PROPERTY_TYPES[profile?.type ?? "other"]}</span>
        {profile?.rooms !== undefined && (
          <span>
            {profile.rooms} {profile.rooms === 1 ? "room" : "rooms"}
          </span>
        )}
        {profile?.size && <span>{profile.size}</span>}
        {profile?.condition && <span>{PROPERTY_CONDITIONS[profile.condition]}</span>}
      </div>
      {!!profile?.features?.length && (
        <ul className="property-tags" aria-label="Property features">
          {profile.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function OwnedPropertyProfile({ holding }: { holding: Holding }) {
  const { journal, commandOutcome } = useEconomy(),
    market = readMarketLocations(journal.market);
  const initial = { locationId: holding.locationId ?? null, property: holding.property ?? null };
  const [before, setBefore] = useState(initial),
    [draft, setDraft] = useState(propertyDraft(holding.property)),
    [locationId, setLocationId] = useState(holding.locationId ?? ""),
    [busy, setBusy] = useState(false),
    [imageBusy, setImageBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const { locked, reason } = useFinanceReadiness();
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(propertyDraft(before.property ?? undefined)) ||
    locationId !== (before.locationId ?? "");
  useDraftGuard(dirty, "property particulars");
  return (
    <details className="property-profile-editor">
      <summary>Edit location, images & features</summary>
      <form
        aria-label={`Property particulars for ${holding.name}`}
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || imageBusy || locked) return;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const property = readPropertyDraft(draft);
            const result = await commandOutcome({
              kind: "property-profile",
              holdingId: holding.id,
              before,
              locationId: locationId || null,
              property,
            });
            setBefore({ locationId: locationId || null, property });
            setDraft(propertyDraft(property));
            setNotice(mutationNotice(result, "Property particulars saved."));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save property particulars.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <PropertyProfileFields
          draft={draft}
          onChange={setDraft}
          locationId={locationId}
          onLocationChange={setLocationId}
          market={market}
          disabled={busy || locked || imageBusy}
          onImageBusy={setImageBusy}
        />
        {reason && <p role="status">{reason}</p>}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <div className="property-actions">
          <Button type="submit" disabled={!dirty || busy || imageBusy || locked}>
            Save property particulars
          </Button>
          <Button
            variant="secondary"
            disabled={busy || imageBusy}
            onClick={() => {
              if (
                dirty &&
                !window.confirm("Discard unsaved property particulars and reload current details?")
              )
                return;
              setBefore(initial);
              setDraft(propertyDraft(holding.property));
              setLocationId(holding.locationId ?? "");
              setError("");
              setNotice("");
            }}
          >
            Reload particulars
          </Button>
        </div>
        <p className="text-sm text-muted">
          Current location: {locationLabel(market, holding.locationId)}
        </p>
      </form>
    </details>
  );
}
