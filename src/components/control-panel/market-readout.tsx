import { useMemo } from "react";
import { AppLink } from "@/components/app-link";
import { useEconomy } from "@/lib/quire/economy-context";
import { commodityQuoteRows } from "@/lib/quire/commodity-board";
import { readTradeEconomy } from "@/lib/quire/trade-economy-schema";
import { globalMarketCity, locationLabel, readMarketLocations } from "@/lib/quire/shop-locations";
import { SEASON_NAMES } from "@/lib/quire/scale";
import { formatCopper } from "@/lib/quire/money";

/** DM overview only. The canonical market still enforces location and trading rules. */
export function MarketReadout() {
  const { ready, journal, realm } = useEconomy();
  const economy = useMemo(() => readTradeEconomy(journal.tradeEconomy), [journal.tradeEconomy]);
  const rows = useMemo(
    () =>
      commodityQuoteRows(economy, economy.exchanges, true)
        .filter((row) => row.commodity.active)
        .sort(
          (a, b) =>
            Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0) ||
            a.commodity.name.localeCompare(b.commodity.name) ||
            a.exchange.name.localeCompare(b.exchange.name),
        ),
    [economy],
  );
  const market = readMarketLocations(journal.market);
  const city = globalMarketCity(market);
  const inflation = Math.round((realm.inflation - 1) * 100);
  return (
    <>
      <h2>Global market</h2>
      {!ready ? (
        <p role="status">Loading campaign market…</p>
      ) : (
        <>
          <p>
            {SEASON_NAMES[realm.season]} · Season {economy.epoch} ·{" "}
            {economy.settings.enabled
              ? economy.settings.mode === "automatic"
                ? "Automatic economy"
                : "Classic economy"
              : "Trade economy disabled"}
          </p>
          <dl className="information-totals">
            <div>
              <dt>Inflation price change</dt>
              <dd>
                {inflation > 0 ? "+" : ""}
                {inflation}%
              </dd>
            </div>
            <div>
              <dt>Exchanges / active quotes</dt>
              <dd>
                {economy.exchanges.length} / {rows.length}
              </dd>
            </div>
          </dl>
          <p>
            Party access:{" "}
            {city
              ? `City · ${locationLabel(market, market.currentLocationId)}`
              : "Closed here · visit a city"}
            .
          </p>
          <small>
            Campaign-wide DM data. Trading still requires the appropriate location and an open
            exchange.
          </small>
          <ul className="information-market-quotes" aria-label="Current commodity quotes">
            {rows.slice(0, 3).map((row) => (
              <li key={row.key}>
                <AppLink
                  href={`/features/economy?exchange=${encodeURIComponent(row.exchange.id)}&commodity=${encodeURIComponent(row.commodity.id)}`}
                >
                  <strong>{row.commodity.name}</strong>
                  <small>
                    {row.exchange.name}
                    {!row.exchange.open ? " · Closed" : ""}
                    {!row.exchange.visible ? " · DM only" : ""} · per {row.commodity.unit}
                  </small>
                </AppLink>
                <span>
                  Ask {formatCopper(row.offer.askCopper)} · Bid {formatCopper(row.offer.bidCopper)}
                </span>
                <small>
                  Stock {row.offer.stock.toLocaleString()} · Wanted{" "}
                  {(row.offer.capacity - row.offer.stock).toLocaleString()} ·{" "}
                  {row.changePercent === null
                    ? "No prior-season comparison"
                    : `${row.changePercent > 0 ? "+" : ""}${row.changePercent.toFixed(2)}% ask vs prior season`}
                </small>
              </li>
            ))}
          </ul>
          {rows.length ? (
            <small>
              Showing {Math.min(3, rows.length)} of {rows.length} active quotes, largest recorded
              changes first.
            </small>
          ) : (
            <p>No active commodity quotes configured.</p>
          )}
        </>
      )}
      <AppLink href="/market#global-market" className="information-action">
        Open global market →
      </AppLink>
      <AppLink href="/features/economy" className="information-action">
        Configure commodities & exchanges →
      </AppLink>
    </>
  );
}
