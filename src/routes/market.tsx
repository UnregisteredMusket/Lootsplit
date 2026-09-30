import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEconomy } from "@/lib/quire/economy-context";
import { usePrefs } from "@/lib/quire/prefs";
import { useSeat } from "@/lib/quire/seat";
import { Shell } from "@/components/shell";
import { PriceHarvest } from "@/components/price-harvest";
import { ShopComposer } from "@/components/shop-composer";
import { Button } from "@/components/ui";

export const Route = createFileRoute("/market")({
  validateSearch: (search: Record<string, unknown>) => ({
    book: typeof search.book === "string" ? search.book : "",
  }),
  component: MarketPage,
});

function MarketPage() {
  const { book } = Route.useSearch();
  const navigate = useNavigate();
  const { ready, shops, stock, createShop } = useEconomy();
  const { prefs } = usePrefs();
  const seat = useSeat();
  const shown = seat.role === "player" ? shops.filter((shop) => seat.shopIds.includes(shop.id)) : shops;

  return (
    <Shell>
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-4xl tracking-tight">Market</h1>
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
      {!ready ? <p className="mt-6 text-muted">Opening the market…</p> : null}
      <div className="mt-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
        <div>
          {ready && shown.length === 0 ? <p className="text-muted">No shops yet.</p> : null}
          <ul className="divide-y divide-border border-y border-border">
            {shown.map((shop) => {
              const count = stock.filter((line) => line.shopId === shop.id).length;
              return (
                <li key={shop.id}>
                  <Link to="/shop/$shopId" params={{ shopId: shop.id }} className="block py-3">
                    <span className="block font-display text-xl">{shop.name}</span>
                    <span className="text-sm text-muted">
                      {[shop.keeper, shop.place].filter(Boolean).join(" · ") || "No owner yet"} · {count} items · sells at{" "}
                      {Math.round(shop.sellRate * 100)}%
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        {seat.role === "dm" ? <ShopComposer /> : null}
      </div>
      {seat.role === "dm" ? <PriceHarvest bookId={book} /> : null}
    </Shell>
  );
}
