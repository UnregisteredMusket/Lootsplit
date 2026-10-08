import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dices } from "lucide-react";
import { toast } from "sonner";
import { composeShelf, suggestedBuyRate, type RarityFlags } from "@/lib/quire/compose";
import { useEconomy } from "@/lib/quire/economy-context";
import { RARITIES, SHOP_KINDS, WEALTHS } from "@/lib/quire/labels";
import { formatCopper } from "@/lib/quire/money";
import { useDollarText, usePrefs } from "@/lib/quire/prefs";
import {
  nameFromLexicon,
  randomPerson,
  randomPlace,
  randomShopTitle,
  rngFrom,
} from "@/lib/quire/names";
import type { ShopCategory, Wealth } from "@/lib/quire/types";
import { Button, Select, Slider, TextInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import { StockPages } from "./shop-stock-manager";

export function ShopComposer() {
  const navigate = useNavigate();
  const { catalog, lexicon, realm, openShelfOutcome } = useEconomy();
  const { prefs, ready: prefsReady } = usePrefs();
  const dollars = useDollarText();
  const seeded = useRef(false);
  const shelfRef = useRef<HTMLHeadingElement>(null);
  const [shelfSeed, setShelfSeed] = useState(3);
  const [nameSeed, setNameSeed] = useState(11);
  const [category, setCategory] = useState<ShopCategory>("general");
  const [wealth, setWealth] = useState<Wealth>("modest");
  const [flags, setFlags] = useState<RarityFlags>({
    common: true,
    uncommon: true,
    rare: false,
    magic: false,
  });
  const [priceScale, setPriceScale] = useState(1);
  const [depth, setDepth] = useState(1);
  const [selection, setSelection] = useState<"suggested" | "count" | "all">("suggested");
  const [itemCount, setItemCount] = useState(50);
  const [quantityMode, setQuantityMode] = useState<"suggested" | "fixed" | "unlimited">(
    "suggested",
  );
  const [quantity, setQuantity] = useState(10);
  const [previewPage, setPreviewPage] = useState(0);
  const [sellRate, setSellRate] = useState(1);
  const [buyRate, setBuyRate] = useState(suggestedBuyRate("modest"));
  const [buyTouched, setBuyTouched] = useState(false);
  const [name, setName] = useState("Rope & Tallow");
  const [keeper, setKeeper] = useState("");
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = JSON.stringify({
    name,
    keeper,
    place,
    category,
    wealth,
    flags,
    priceScale,
    depth,
    selection,
    itemCount,
    quantityMode,
    quantity,
    sellRate,
    buyRate,
    shelfSeed,
  });
  const baseline = useRef<string | null>(null);
  if (seeded.current && baseline.current === null) baseline.current = draft;
  useDraftGuard(
    !busy && baseline.current !== null && draft !== baseline.current,
    "shop configuration",
  );

  useEffect(() => {
    if (!prefsReady || seeded.current) return;
    seeded.current = true;
    setWealth(prefs.defaultWealth);
    setFlags({
      common: prefs.carryCommon,
      uncommon: prefs.carryUncommon,
      rare: prefs.carryRare,
      magic: prefs.carryMagic,
    });
    setPriceScale(prefs.defaultScale);
    setDepth(prefs.defaultDepth);
    setSellRate(prefs.defaultSell);
    setBuyRate(prefs.defaultBuy);
    setBuyTouched(Math.abs(prefs.defaultBuy - suggestedBuyRate(prefs.defaultWealth)) > 0.02);
  }, [prefs, prefsReady]);

  const lines = useMemo(() => {
    const rng = rngFrom(shelfSeed);
    return composeShelf(
      catalog,
      {
        category,
        wealth,
        flags,
        priceScale,
        depth,
        realm,
        selection,
        itemCount,
        ...(quantityMode === "suggested"
          ? {}
          : { quantity: quantityMode === "unlimited" ? null : quantity }),
      },
      rng,
    );
  }, [
    catalog,
    category,
    wealth,
    flags,
    priceScale,
    depth,
    realm,
    shelfSeed,
    selection,
    itemCount,
    quantityMode,
    quantity,
  ]);
  const available = catalog.filter(
    (item) => flags[item.rarity] && (category === "mixed" || item.category === category),
  ).length;
  const currentPreviewPage = Math.min(previewPage, Math.max(0, Math.ceil(lines.length / 25) - 1));

  const people = lexicon.filter((row) => row.kind === "person");
  const places = lexicon.filter(
    (row) =>
      row.kind === "place" ||
      row.kind === "region" ||
      row.kind === "country" ||
      row.kind === "continent",
  );
  const shopNames = lexicon.filter((row) => row.kind === "shop");

  function roll(kind: "shop" | "person" | "place") {
    const rng = rngFrom(nameSeed);
    if (kind === "shop")
      setName(nameFromLexicon("shop", lexicon, () => randomShopTitle(category, place, rng), rng));
    if (kind === "person") setKeeper(nameFromLexicon("person", lexicon, randomPerson, rng));
    if (kind === "place") setPlace(nameFromLexicon("place", lexicon, randomPlace, rng));
    setNameSeed((current) => current + 1);
  }

  function shuffleShop() {
    const nextSeed = shelfSeed + 1;
    const rng = rngFrom(nextSeed + 97);
    const nextPlace = nameFromLexicon("place", lexicon, randomPlace, rng);
    const nextKeeper = nameFromLexicon("person", lexicon, randomPerson, rng);
    const nextName = nameFromLexicon(
      "shop",
      lexicon,
      () => randomShopTitle(category, nextPlace, rng),
      rng,
    );
    setShelfSeed(nextSeed);
    setPlace(nextPlace);
    setKeeper(nextKeeper);
    setName(nextName);
    shelfRef.current?.scrollIntoView({ block: "nearest" });
  }

  function chooseWealth(next: Wealth) {
    setWealth(next);
    if (!buyTouched) setBuyRate(suggestedBuyRate(next));
  }

  async function open() {
    if (lines.length === 0) {
      toast("Nothing matched. Turn a rarity on, or add items to the catalog.");
      return;
    }
    setBusy(true);
    try {
      const result = await openShelfOutcome({
        name,
        keeper,
        place,
        notes: "",
        sellRate,
        buyRate,
        wealth,
        category,
        priceScale,
        lines,
      });
      toast.success(
        result.status === "pending"
          ? "Shop accepted as pending. Submit your turn or check sync before repeating it."
          : "Shop opened.",
      );
      void navigate({ to: "/shop/$shopId", params: { shopId: result.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The shop could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-border p-4 lg:mt-0">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl tracking-tight">Create a shop</h2>
        <Button variant="secondary" onClick={shuffleShop} aria-label="Shuffle the shop">
          <Dices className="size-4" />
          Shuffle
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Built from the catalog. Shuffle picks a new name, owner, location, and stock.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        <NamedField
          label="Shop"
          value={name}
          onChange={setName}
          onRoll={() => roll("shop")}
          rollLabel="Random shop name"
        />
        {shopNames.length > 0 ? (
          <Select
            aria-label="Saved shop names"
            value=""
            onChange={(event) => event.target.value && setName(event.target.value)}
          >
            <option value="">Saved shop names</option>
            {shopNames.map((row) => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Choice label="Type of shop" value={category} options={SHOP_KINDS} onChange={setCategory} />
        <Choice label="Wealth" value={wealth} options={WEALTHS} onChange={chooseWealth} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What it carries</legend>
          <div className="grid grid-cols-2 gap-2">
            {RARITIES.map((rarity) => (
              <label
                key={rarity.value}
                className="flex min-h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-5 accent-accent"
                  checked={flags[rarity.value]}
                  onChange={() =>
                    setFlags((current) => ({ ...current, [rarity.value]: !current[rarity.value] }))
                  }
                />
                {rarity.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Slider
          label="Base price multiplier"
          min={0.5}
          max={2.5}
          step={0.05}
          value={priceScale}
          onChange={setPriceScale}
          display={`${Math.round(priceScale * 100)}%`}
        />
        <label className="text-sm font-medium">
          Item variety
          <Select
            aria-label="Item variety"
            className="mt-1"
            value={selection}
            onChange={(event) => setSelection(event.target.value as typeof selection)}
          >
            <option value="suggested">Suggested assortment</option>
            <option value="count">Choose number of item types</option>
            <option value="all">Every matching catalog item</option>
          </Select>
        </label>
        {selection === "count" ? (
          <label className="text-sm">
            Number of item types
            <TextInput
              type="number"
              min="1"
              step="1"
              aria-label="Number of item types"
              value={itemCount}
              onChange={(event) =>
                setItemCount(
                  Math.max(1, Math.min(10000, Math.floor(Number(event.target.value) || 1))),
                )
              }
            />
          </label>
        ) : null}
        <p className="text-sm text-muted">
          {lines.length} item types selected from {available} matching catalog items. Choose Mixed
          market to include every shop category.
        </p>
        <label className="text-sm font-medium">
          Stock quantities
          <Select
            aria-label="Stock quantities"
            className="mt-1"
            value={quantityMode}
            onChange={(event) => setQuantityMode(event.target.value as typeof quantityMode)}
          >
            <option value="suggested">Suggested units per item</option>
            <option value="fixed">Set units per item</option>
            <option value="unlimited">Unlimited stock</option>
          </Select>
        </label>
        {quantityMode === "suggested" ? (
          <Slider
            label="Suggested quantity level"
            min={0.4}
            max={1.6}
            step={0.1}
            value={depth}
            onChange={setDepth}
            display={depth < 0.7 ? "Low" : depth > 1.2 ? "High" : "Standard"}
          />
        ) : null}
        {quantityMode === "fixed" ? (
          <label className="text-sm">
            Units per item
            <TextInput
              type="number"
              min="0"
              step="1"
              aria-label="Units per item"
              value={quantity}
              onChange={(event) =>
                setQuantity(
                  Math.max(0, Math.min(100000, Math.floor(Number(event.target.value) || 0))),
                )
              }
            />
            <span className="mt-1 block text-muted">Services remain unlimited.</span>
          </label>
        ) : null}
        <Slider
          label="Sells at"
          min={0.5}
          max={2}
          step={0.05}
          value={sellRate}
          onChange={setSellRate}
          display={`${Math.round(sellRate * 100)}%`}
        />
        <Slider
          label="Buys at"
          min={0.1}
          max={1}
          step={0.05}
          value={buyRate}
          onChange={(value) => {
            setBuyTouched(true);
            setBuyRate(value);
          }}
          display={`${Math.round(buyRate * 100)}%`}
        />
        <NamedField
          label="Shopkeeper"
          value={keeper}
          onChange={setKeeper}
          onRoll={() => roll("person")}
          rollLabel="Random keeper"
          placeholder="NPC"
        />
        {people.length > 0 ? (
          <Select
            aria-label="Saved people"
            value=""
            onChange={(event) => event.target.value && setKeeper(event.target.value)}
          >
            <option value="">Assign a saved person</option>
            {people.map((row) => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </Select>
        ) : null}
        <NamedField
          label="Shop location"
          value={place}
          onChange={setPlace}
          onRoll={() => roll("place")}
          rollLabel="Random place"
          placeholder="Shop location"
        />
        {places.length > 0 ? (
          <Select
            aria-label="Saved places"
            value=""
            onChange={(event) => event.target.value && setPlace(event.target.value)}
          >
            <option value="">Use a saved place</option>
            {places.map((row) => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <h3 ref={shelfRef} className="mt-6 font-display text-xl tracking-tight">
        Stock · {lines.length}
      </h3>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No items match. Check the catalog, or turn a rarity on.
        </p>
      ) : null}
      <ul className="mt-2 divide-y divide-border border-y border-border">
        {lines.slice(currentPreviewPage * 25, (currentPreviewPage + 1) * 25).map((line) => (
          <li
            key={`${line.name}-${line.rarity}`}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate">{line.name}</span>
              <span className="text-sm text-muted">
                {line.rarity}
                {line.quantity === null ? " · always" : ` · ${line.quantity} on hand`}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm tabular-nums">
              {formatCopper(Math.round(line.copper * sellRate))}
              {dollars(Math.round(line.copper * sellRate)) ? (
                <span className="block text-xs text-muted">
                  {dollars(Math.round(line.copper * sellRate))}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <StockPages
        page={currentPreviewPage}
        count={lines.length}
        onChange={setPreviewPage}
        label="Stock preview pages"
      />
      <Button className="mt-4" disabled={busy || lines.length === 0} onClick={() => void open()}>
        Open this shop
      </Button>
    </section>
  );
}

function NamedField({
  label,
  value,
  onChange,
  onRoll,
  rollLabel,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onRoll: () => void;
  rollLabel: string;
  placeholder?: string;
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <TextInput
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          variant="secondary"
          className="shrink-0 px-3"
          aria-label={rollLabel}
          onClick={onRoll}
        >
          <Dices className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-11 rounded-sm border px-2 text-sm motion-colors",
                selected ? "border-fg bg-fg text-bg" : "border-border text-fg",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
