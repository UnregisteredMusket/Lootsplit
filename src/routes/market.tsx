import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Store, MapPin, Search, ChevronRight } from "lucide-react";
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
import { Button, Fold } from "@/components/ui";
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
  const { ready, shops, stock, realm, createShop } = useEconomy();
  const { prefs } = usePrefs();
  const seat = useSeat();
  const [query, setQuery] = useState("");
  const [stocked, setStocked] = useState<"all" | "open" | "empty">("all");
  const shown = seat.role === "player" ? shops.filter((shop) => seat.shopIds.includes(shop.id)) : shops;
  const needle = query.trim().toLowerCase();
  const filtered = shown.filter((shop) => {
    const count = stock.filter((line) => line.shopId === shop.id).length;
    if (seat.role === "dm" && stocked === "open" && count === 0) return false;
    if (seat.role === "dm" && stocked === "empty" && count > 0) return false;
    if (!needle) return true;
    const names = stock.filter((line) => line.shopId === shop.id).map((line) => line.name.toLowerCase());
    return [shop.name, shop.keeper, shop.place, shop.category, ...names].join(" ").toLowerCase().includes(needle);
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
          {priceLine !== 0 ? <p className="text-sm text-lead">Prices {priceLine > 0 ? "+" : ""}{priceLine}% from inflation</p> : null}
        </div>
        {seat.role === "dm" ? (
          <Button
            onClick={() => {
              void createShop({
                wealth: prefs.defaultWealth,
                sellRate: prefs.defaultSell,
                buyRate: prefs.defaultBuy,
                priceScale: prefs.defaultScale,
              }).then((id) => navigate({ to: "/shop/$shopId", params: { shopId: id } }));
            }}
          >
            New shop
          </Button>
        ) : null}
      </div>
      <label className="relative mt-5 block"><Search className="absolute left-4 top-3.5 size-5 text-faint" aria-hidden="true" />
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
              ["open", "Stocked"],
              ["empty", "Empty"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStocked(value)}
              className={value === stocked ? "min-h-11 rounded-full bg-lead px-3 text-bg" : "min-h-11 rounded-full border border-lead/30 px-3"}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {!ready ? <p className="mt-6 text-muted">Opening the market…</p> : null}
      {ready && filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={shown.length === 0 ? "No shops are open" : "Nothing matches"}
            body={shown.length === 0 ? (seat.role === "dm" ? "Create a shop from the button above." : "Wait for the dungeon master to open one.") : "Try another name."}
          />
        </div>
      ) : null}
      <ul className="market-grid mt-5 grid gap-3 md:grid-cols-2">
        {filtered.map((shop) => {
          const lines = stock.filter((line) => line.shopId === shop.id);
          const tier = shop.sellRate > 1.15 ? "High prices" : shop.sellRate < 0.9 ? "Low prices" : "Fair prices";
          return (
            <li key={shop.id}>
              <Link to="/shop/$shopId" params={{ shopId: shop.id }} className="market-shop flex h-full items-center gap-4 rounded-2xl border border-lead/25 bg-elevated p-5"><span className="icon-tile"><Store className="size-6" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-2xl leading-tight">{shop.name}</span>
                  <span className="text-sm text-muted">
                    {labelKind(shop.category)} · {lines.length} items · {tier}
                  </span>{shop.place ? <span className="mt-2 flex items-center gap-1 text-sm text-faint"><MapPin className="size-3" />{shop.place}</span> : null}
                </span>
                <ChevronRight className="size-4 shrink-0 text-lead" />
              </Link>
            </li>
          );
        })}
      </ul>
      {conditions.length > 0 ? (
        <section className="mt-5">
          <h2 className="text-sm font-medium text-muted">Market conditions</h2>
          <ul className="mt-2">
            {conditions.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between border-b border-border/70 py-2 text-sm">
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
      <MarketBoard />
      {seat.role === "dm" ? <PriceHarvest bookId={book} /> : null}
    </Shell>
  );
}

function labelKind(category: ShopCategory): string {
  return CATEGORIES.find((item) => item.value === category)?.label ?? "Mixed";
}