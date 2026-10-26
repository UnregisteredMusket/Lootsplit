import { useEffect, useState, type ReactNode } from "react";
import { SearchSelect } from "@/components/search-select";
import { LocationOptions } from "@/components/market-locations";
import { MarketImageUpload } from "@/components/market-image-upload";
import { useEconomy } from "@/lib/quire/economy-context";
import { useShowDollars } from "@/lib/quire/prefs";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { readMarketLocations } from "@/lib/quire/shop-locations";
import { SHOP_KINDS, WEALTHS } from "@/lib/quire/labels";
import { realmNote, scarcityNote } from "@/lib/quire/scale";
import type { Shop, Wealth } from "@/lib/quire/types";
import { Button, Field, Fold, Slider, TextInput } from "@/components/ui";

type PartResult = { part: string; ok: boolean; message: string };

/**
 * The shop's Edit tab (design plan D6): visible labels, and one sticky Save bar for every
 * drafted part. Each part still saves through its own existing command (shop details through
 * `updateShop`, location and image through `shop-location`, black-market rules through
 * `shop-black-market`), so the bar runs them in sequence and reports each part's result; a part
 * that fails keeps its draft. Shelf tuning (type, wealth, sliders) applies immediately, as before.
 */
export function ShopEditor({
  shop,
  onDirtyChange,
}: {
  shop: Shop;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { updateShop, commandOutcome, journal } = useEconomy();
  const market = readMarketLocations(journal.market);

  const details = { name: shop.name, keeper: shop.keeper, place: shop.place };
  const [detailsBase, setDetailsBase] = useState(details);
  const [name, setName] = useState(shop.name),
    [keeper, setKeeper] = useState(shop.keeper),
    [place, setPlace] = useState(shop.place);
  const detailsDirty =
    name.trim() !== detailsBase.name || keeper.trim() !== detailsBase.keeper || place.trim() !== detailsBase.place;

  const [locationBase, setLocationBase] = useState({
    locationId: shop.locationId ?? null,
    image: shop.image ?? null,
  });
  const [locationId, setLocationId] = useState(shop.locationId ?? ""),
    [image, setImage] = useState(shop.image),
    [imageBusy, setImageBusy] = useState(false);
  const locationDirty =
    locationId !== (locationBase.locationId ?? "") || (image ?? null) !== locationBase.image;

  const blackBase = { hidden: shop.blackMarket ?? false, premium: shop.blackMarketPremium ?? 1.5 };
  const [hidden, setHidden] = useState(blackBase.hidden),
    [premium, setPremium] = useState(String(blackBase.premium));
  const blackDirty = hidden !== blackBase.hidden || premium !== String(blackBase.premium);

  const [busy, setBusy] = useState(false),
    [results, setResults] = useState<PartResult[]>([]),
    [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = detailsDirty || locationDirty || blackDirty;
  useDraftGuard(!busy && (dirty || imageBusy), "shop edits");
  useEffect(() => onDirtyChange?.(dirty || imageBusy), [dirty, imageBusy, onDirtyChange]);

  // Follow changes made elsewhere while a part has no unsaved draft.
  useEffect(() => {
    if (detailsDirty || busy) return;
    setName(shop.name);
    setKeeper(shop.keeper);
    setPlace(shop.place);
    setDetailsBase({ name: shop.name, keeper: shop.keeper, place: shop.place });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.name, shop.keeper, shop.place]);
  useEffect(() => {
    if (locationDirty || busy || imageBusy) return;
    setLocationId(shop.locationId ?? "");
    setImage(shop.image);
    setLocationBase({ locationId: shop.locationId ?? null, image: shop.image ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.locationId, shop.image]);
  useEffect(() => {
    if (blackDirty || busy) return;
    setHidden(shop.blackMarket ?? false);
    setPremium(String(shop.blackMarketPremium ?? 1.5));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.blackMarket, shop.blackMarketPremium]);

  const pending = [
    detailsDirty && "Shop details",
    locationDirty && "Location and image",
    blackDirty && "Black-market rules",
  ].filter((part): part is string => !!part);

  async function saveAll() {
    if (busy || !dirty || imageBusy) return;
    setBusy(true);
    setResults([]);
    setErrors({});
    const done: PartResult[] = [];
    const failed: Record<string, string> = {};
    if (detailsDirty) {
      const next = { name: name.trim() || shop.name, keeper: keeper.trim(), place: place.trim() };
      try {
        await updateShop({ ...shop, ...next });
        setName(next.name);
        setKeeper(next.keeper);
        setPlace(next.place);
        setDetailsBase(next);
        done.push({ part: "Shop details", ok: true, message: "Saved." });
      } catch (failure) {
        failed.details = failure instanceof Error ? failure.message : "Shop details could not be saved.";
        done.push({ part: "Shop details", ok: false, message: failed.details });
      }
    }
    if (locationDirty) {
      try {
        const result = await commandOutcome({
          kind: "shop-location",
          shopId: shop.id,
          before: locationBase,
          locationId: locationId || null,
          image: image ?? null,
        });
        setLocationBase({ locationId: locationId || null, image: image ?? null });
        done.push({ part: "Location and image", ok: true, message: mutationNotice(result, "Saved.") });
      } catch (failure) {
        failed.location = failure instanceof Error ? failure.message : "The shop could not be saved.";
        done.push({ part: "Location and image", ok: false, message: failed.location });
      }
    }
    if (blackDirty) {
      try {
        const result = await commandOutcome({
          kind: "shop-black-market",
          shopId: shop.id,
          before: blackBase,
          hidden,
          premium: Number(premium),
        });
        done.push({ part: "Black-market rules", ok: true, message: mutationNotice(result, "Saved.") });
      } catch (failure) {
        failed.black = failure instanceof Error ? failure.message : "The rules could not be saved.";
        done.push({ part: "Black-market rules", ok: false, message: failed.black });
      }
    }
    setErrors(failed);
    setResults(done);
    setBusy(false);
  }

  return (
    <div className="shop-editor mt-4 flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3" disabled={busy}>
        <legend className="sr-only">Shop details</legend>
        <Field label="Shop name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} className="font-display text-2xl" />
        </Field>
        <Field label="Shopkeeper">
          <TextInput value={keeper} onChange={(event) => setKeeper(event.target.value)} />
        </Field>
        <Field label="Shop location">
          <TextInput value={place} onChange={(event) => setPlace(event.target.value)} />
        </Field>
        <PartError message={errors.details} />
      </fieldset>
      <ShelfTuning shop={shop} />
      <div
        role="group"
        aria-label="Shop location and image"
        className="space-y-3 rounded-sm border border-border p-3"
      >
        <Field
          label="Shop availability"
          hint="A shop assigned to a region, city or town is also available in its areas. Its address, stock and trading rules stay configured here."
        >
          <SearchSelect
            aria-label="Shop availability"
            value={locationId}
            disabled={busy}
            onValueChange={(selectedValue) => setLocationId(selectedValue)}
          >
            <option value="">Campaignwide · available everywhere</option>
            {LocationOptions({ market })}
          </SearchSelect>
        </Field>
        <MarketImageUpload
          label="Shop image"
          disabled={busy}
          value={image}
          onChange={setImage}
          onBusyChange={setImageBusy}
        />
        <PartError message={errors.location} />
      </div>
      <Fold title="Black-market vendor rules">
        <fieldset className="world-form" disabled={busy}>
          <label>
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            Normally hidden black-market vendor
          </label>
          <label>
            Price premium multiplier
            <input
              type="number"
              min={1.01}
              max={100}
              step={0.01}
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
            />
          </label>
          <p>
            The multiplier applies to the existing shop asking price before the usual Charisma
            adjustment. The DM's live toggle controls visibility; closed vendors and location rules
            still apply.
          </p>
          <PartError message={errors.black} />
        </fieldset>
      </Fold>
      <div className="shop-savebar" role="group" aria-label="Save shop changes">
        <p className="shop-savebar-state">
          {busy
            ? "Saving…"
            : imageBusy
              ? "Preparing the image…"
              : pending.length
                ? `Unsaved: ${pending.join(", ")}`
                : "All changes saved"}
        </p>
        <Button type="button" onClick={() => void saveAll()} disabled={busy || imageBusy || !dirty}>
          Save changes
        </Button>
        {results.length > 0 && (
          <ul className="shop-savebar-results" role="status">
            {results.map((result) => (
              <li key={result.part} className={result.ok ? "text-positive" : "text-negative"}>
                {result.part}: {result.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PartError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null;
}

function ShelfTuning({ shop }: { shop: Shop }) {
  const { applyShop, updateShop, realm } = useEconomy();
  const showDollars = useShowDollars();
  const [scale, setScale] = useState(shop.priceScale);
  const [sell, setSell] = useState(shop.sellRate);
  const [buy, setBuy] = useState(shop.buyRate);

  useEffect(() => {
    setScale(shop.priceScale);
    setSell(shop.sellRate);
    setBuy(shop.buyRate);
  }, [shop.id, shop.priceScale, shop.sellRate, shop.buyRate]);

  return (
    <section className="flex flex-col gap-3" aria-label="Prices and trade">
      <p className="text-sm text-muted">These settings apply as soon as you change them.</p>
      <Field label="Type of shop">
        <SearchSelect
          aria-label="Type of shop"
          value={shop.category}
          onValueChange={(selectedValue) =>
            void updateShop({ ...shop, category: selectedValue as Shop["category"] })
          }
        >
          {SHOP_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SearchSelect>
      </Field>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="size-5"
          checked={shop.acceptAnyCategory === true}
          onChange={(e) => void updateShop({ ...shop, acceptAnyCategory: e.target.checked })}
        />
        DM exception: buy all item categories
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Additional categories this merchant buys</legend>
        {SHOP_KINDS.filter((o) => o.value !== "mixed").map((o) => (
          <label key={o.value} className="mr-3 inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={(shop.acceptedCategories || [shop.category]).includes(o.value)}
              onChange={(e) => {
                const categories = new Set(shop.acceptedCategories || [shop.category]);
                if (e.target.checked) categories.add(o.value);
                else categories.delete(o.value);
                void updateShop({ ...shop, acceptedCategories: [...categories] });
              }}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <WealthGroup>
        {WEALTHS.map((option) => (
          <Button
            key={option.value}
            variant={shop.wealth === option.value ? "primary" : "secondary"}
            aria-pressed={shop.wealth === option.value}
            onClick={() =>
              void applyShop({
                ...shop,
                wealth: option.value as Wealth,
                priceScale: scale,
                sellRate: sell,
                buyRate: buy,
              })
            }
          >
            {option.label}
          </Button>
        ))}
      </WealthGroup>
      <Slider
        label="Base price multiplier"
        min={0.5}
        max={2.5}
        step={0.05}
        value={scale}
        onChange={setScale}
        onCommit={(value) =>
          void applyShop({ ...shop, priceScale: value, sellRate: sell, buyRate: buy })
        }
        display={`${Math.round(scale * 100)}%`}
      />
      <Slider
        label="Sells at"
        min={0.5}
        max={2}
        step={0.05}
        value={sell}
        onChange={setSell}
        onCommit={(value) => void updateShop({ ...shop, sellRate: value })}
        display={`${Math.round(sell * 100)}%`}
      />
      <Slider
        label="Buys at"
        min={0.1}
        max={1}
        step={0.05}
        value={buy}
        onChange={setBuy}
        onCommit={(value) => void updateShop({ ...shop, buyRate: value })}
        display={`${Math.round(buy * 100)}%`}
      />
      <p className="text-sm text-muted">
        {realmNote(realm, { dollars: showDollars })} {scarcityNote(realm.scarcity)} Updating
        prices uses the modifiers above. Dollars are a comparison for one gold piece, not a second
        price.
      </p>
    </section>
  );
}

function WealthGroup({ children }: { children: ReactNode }) {
  return (
    <div role="group" aria-labelledby="shop-wealth-label">
      <p id="shop-wealth-label" className="mb-1 text-sm font-medium">
        Shop wealth
      </p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}
