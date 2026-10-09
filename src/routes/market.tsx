import { LedgerArt } from "@/components/ledger-art";
import { MarketLocationsPanel, LocationOptions } from "@/components/market-locations";
import { readMarketLocations, shopAvailableHere, locationLabel } from "@/lib/quire/shop-locations";
import { PriceHistory } from "@/components/campaign-journal";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MapPin, Search, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { CATEGORIES } from "@/lib/quire/labels";
import { usePrefs } from "@/lib/quire/prefs";
import { pressureFor } from "@/lib/quire/scale";
import { useSeat } from "@/lib/quire/seat";
import { Shell } from "@/components/shell";
import { PriceHarvest } from "@/components/price-harvest";
import { ShopComposer } from "@/components/shop-composer";
import { MarketBoard } from "@/components/market-board";
import { EmptyState } from "@/components/terminal";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { useDraftGuard } from "@/lib/quire/use-draft-guard";
import { AppLink } from "@/components/app-link";
import { Button, Fold, Modal } from "@/components/ui";
import type { ShopCategory } from "@/lib/quire/types";

export const Route = createFileRoute("/market")({
  validateSearch: (search: Record<string, unknown>) => ({
    book: typeof search.book === "string" ? search.book : "",
  }),
  component: MarketPage,
});

function MarketPage() {
  const { book } = Route.useSearch();
  const navigate = useNavigate();
  const { ready, shops, stock, realm, journal, createShop, updateShop, commandOutcome } =
    useEconomy();
  const market = readMarketLocations(journal.market);
  const [assignedLocation, setAssignedLocation] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const { prefs } = usePrefs();
  const seat = useSeat();
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [restockId, setRestockId] = useState(""),
    [restockQuantity, setRestockQuantity] = useState("5"),
    [restockBusy, setRestockBusy] = useState(false),
    [restockError, setRestockError] = useState(""),
    [restockNotice, setRestockNotice] = useState("");
  useDraftGuard(!!restockId && restockQuantity !== "5", "manual restock");
  const restockShop = shops.find((s) => s.id === restockId),
    addedUnits = Number(restockQuantity);
  const [stocked, setStocked] = useState<"all" | "open" | "empty">("all");
  const shown =
    seat.role === "player"
      ? shops.filter((shop) => seat.shopIds.includes(shop.id) && shopAvailableHere(shop, market))
      : shops;
  const needle = query.trim().toLowerCase();
  const filtered = shown.filter((shop) => {
    if (
      assignedLocation &&
      (assignedLocation === "campaignwide"
        ? !!shop.locationId
        : shop.locationId !== assignedLocation)
    )
      return false;
    if (availableOnly && !shopAvailableHere(shop, market)) return false;
    if (location && shop.place !== location) return false;
    if (category && shop.category !== category) return false;
    if (stocked === "open" && shop.closed) return false;
    if (stocked === "empty" && !shop.closed) return false;
    if (!needle) return true;
    const names = stock
      .filter((line) => line.shopId === shop.id)
      .map((line) => line.name.toLowerCase());
    return [
      shop.name,
      shop.keeper,
      shop.place,
      locationLabel(market, shop.locationId),
      shop.category,
      ...names,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const conditions = useMemo(
    () =>
      CATEGORIES.map((category) => {
        const pressure = pressureFor(category.value, realm);
        const percent = Math.round((pressure - 1) * 100);
        return { label: category.label, percent };
      }).filter((row) => row.percent !== 0),
    [realm],
  );
  const priceLine = Math.round((realm.inflation - 1) * 100);

  return (
    <Shell>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Market</h1>
          {priceLine !== 0 ? (
            <p className="text-sm text-lead">
              Prices {priceLine > 0 ? "+" : ""}
              {priceLine}% from inflation
            </p>
          ) : null}
        </div>
        {seat.role === "dm" ? (
          <Button
            onClick={() => {
              void createShop({
                wealth: prefs.defaultWealth,
                sellRate: prefs.defaultSell,
                buyRate: prefs.defaultBuy,
                priceScale: prefs.defaultScale,
                ...(market.currentLocationId ? { locationId: market.currentLocationId } : {}),
              }).then((id) => navigate({ to: "/shop/$shopId", params: { shopId: id } }));
            }}
          >
            New shop
          </Button>
        ) : null}
      </div>
      {ready ? <MarketLocationsPanel /> : null}
      <AppLink className="settings-link mt-4" href="/features/properties?from=%2Fmarket">Property listings · deeds & dwellings →</AppLink>
      <label className="relative mt-5 block">
        <Search className="absolute left-4 top-3.5 size-5 text-faint" aria-hidden="true" />
        <span className="sr-only">Search the market</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search items or shops"
          className="min-h-11 w-full rounded-xl border border-lead/30 bg-elevated pl-12 pr-3 text-base text-fg outline-none placeholder:text-faint"
        />
      </label>
      {seat.role === "dm" ? (
        <div className="mt-3 flex gap-2 text-sm">
          {(
            [
              ["all", "All"],
              ["open", "Open"],
              ["empty", "Closed"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStocked(value)}
              className={
                value === stocked
                  ? "min-h-11 rounded-full bg-lead px-3 text-bg"
                  : "min-h-11 rounded-full border border-lead/30 px-3"
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <select
          aria-label="Market location"
          className="ledger-search"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">All locations</option>
          {[...new Set(shown.map((x) => x.place).filter(Boolean))].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="Shop category"
          className="ledger-search"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {[...new Set(shown.map((x) => x.category))].map((x) => (
            <option key={x} value={x}>
              {labelKind(x)}
            </option>
          ))}
        </select>
      </div>
      {seat.role === "dm" && market.locations.length ? (
        <div className="mt-3 space-y-2">
          <select
            aria-label="Shop assigned location"
            className="ledger-search w-full"
            value={assignedLocation}
            onChange={(event) => setAssignedLocation(event.target.value)}
          >
            <option value="">All assigned locations</option>
            <option value="campaignwide">Campaignwide shops</option>
            <LocationOptions market={market} />
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(event) => setAvailableOnly(event.target.checked)}
            />
            Available at the party's location
          </label>
        </div>
      ) : null}
      {!ready ? <p className="mt-6 text-muted">Opening the market…</p> : null}
      {ready && filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={shown.length === 0 ? "No shops are open" : "Nothing matches"}
            body={
              shown.length === 0
                ? seat.role === "dm"
                  ? "Create a shop from the button above."
                  : "Wait for the dungeon master to open one."
                : "Try another name."
            }
          />
        </div>
      ) : null}
      <ul className="market-grid mt-5 grid gap-3 md:grid-cols-2">
        {filtered.map((shop) => {
          const lines = stock.filter((line) => line.shopId === shop.id);
          const tier =
            shop.sellRate > 1.15
              ? "High prices"
              : shop.sellRate < 0.9
                ? "Low prices"
                : "Fair prices";
          return (
            <li key={shop.id} className="shop-tile">
              <Link
                to="/shop/$shopId"
                params={{ shopId: shop.id }}
                className="market-shop flex items-center gap-4 rounded-2xl border border-lead/25 bg-elevated p-5"
              >
                <LedgerArt kind="shop" src={shop.image} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-2xl leading-tight">
                    {shop.name}
                  </span>
                  <span className="text-sm text-muted">
                    {shop.closed ? "Closed" : "Open"} · {labelKind(shop.category)} · {lines.length}{" "}
                    stock lines · {tier}
                  </span>
                  {shop.place ? (
                    <span className="mt-2 flex items-center gap-1 text-sm text-faint">
                      <MapPin className="size-3" />
                      {shop.place}
                    </span>
                  ) : null}
                  {shop.locationId ? (
                    <span className="mt-1 block text-sm text-faint">
                      {locationLabel(market, shop.locationId)}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="size-4 shrink-0 text-lead" />
              </Link>
              {seat.role === "dm" ? (
                <div className="shop-actions">
                  <Link className="quick-action" to="/shop/$shopId" params={{ shopId: shop.id }}>
                    Edit
                  </Link>
                  <button
                    className="quick-action"
                    onClick={() => {
                      setRestockId(shop.id);
                      setRestockQuantity("5");
                      setRestockError("");
                      setRestockNotice("");
                    }}
                  >
                    Restock
                  </button>
                  <button
                    className="quick-action"
                    onClick={() => {
                      if (
                        shop.schedule &&
                        !window.confirm(
                          "Manually changing availability disables this shop’s schedule. Continue?",
                        )
                      )
                        return;
                      void updateShop({ ...shop, closed: !shop.closed });
                    }}
                  >
                    {shop.closed ? "Open" : "Close"}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {conditions.length > 0 ? (
        <section className="mt-5">
          <h2 className="text-sm font-medium text-muted">Market conditions</h2>
          <ul className="mt-2">
            {conditions.map((row) => (
              <li
                key={row.label}
                className="flex items-baseline justify-between border-b border-border/70 py-2 text-sm"
              >
                <span>{row.label}</span>
                <span className={row.percent > 0 ? "text-negative" : "text-positive"}>
                  {row.percent > 0 ? "▲" : "▼"} {Math.abs(row.percent)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {seat.role === "dm" ? (
        <Fold title="Create a shop" hint="Type, wealth, and stock.">
          <ShopComposer />
        </Fold>
      ) : null}
      {restockNotice && <p role="status">{restockNotice}</p>}
      <Modal
        open={!!restockId}
        title={`Restock ${restockShop?.name || "shop"}`}
        onOpenChange={(open) => {
          if (!open) {
            if (restockQuantity !== "5" && !window.confirm("Discard unsaved restock amount?"))
              return;
            setRestockId("");
          }
        }}
      >
        <p>
          Manual restock adds units to every finite stock line. Existing prices, custom stock,
          surplus and unlimited stock are preserved. Scheduled restock separately tops up to a
          target.
        </p>
        <label>
          Add units to each finite stock line
          <input
            type="number"
            min="1"
            max="100000"
            step="1"
            required
            value={restockQuantity}
            onChange={(e) => setRestockQuantity(e.target.value)}
          />
        </label>
        <details open>
          <summary>Manual add-units preview</summary>
          {stock
            .filter((s) => s.shopId === restockId)
            .map((s) => (
              <p key={s.id}>
                {s.name}:{" "}
                {s.quantity === null
                  ? "Unlimited; unchanged"
                  : `${s.quantity} → ${s.quantity + (Number.isSafeInteger(addedUnits) && addedUnits >= 1 ? addedUnits : 0)}`}
              </p>
            ))}
        </details>
        {restockError && <p role="alert">{restockError}</p>}
        <Button
          disabled={
            restockBusy || !restockShop || !Number.isSafeInteger(addedUnits) || addedUnits < 1
          }
          onClick={async () => {
            setRestockBusy(true);
            setRestockError("");
            try {
              const result = await commandOutcome({
                kind: "restock",
                shopId: restockId,
                quantity: addedUnits,
              });
              setRestockNotice(mutationNotice(result, "Manual restock recorded."));
              setRestockId("");
            } catch (e) {
              setRestockError(
                e instanceof Error ? e.message : "Restock failed. Your amount is retained.",
              );
            } finally {
              setRestockBusy(false);
            }
          }}
        >
          Add units & restock
        </Button>
        <AppLink href="/features/shops">Review scheduled top-up settings</AppLink>
      </Modal>
      <PriceHistory />
      <MarketBoard />
      {seat.role === "dm" ? <PriceHarvest bookId={book} /> : null}
    </Shell>
  );
}

function labelKind(category: ShopCategory): string {
  return CATEGORIES.find((item) => item.value === category)?.label ?? "Mixed";
}
