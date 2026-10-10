import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Search, SlidersHorizontal } from "lucide-react";
import {
  readTradeEconomy,
  type Exchange,
  type TradeEconomy,
} from "@/lib/quire/trade-economy-schema";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useSeat } from "@/lib/quire/seat";
import { exchangeHere } from "@/lib/quire/trade-economy";
import {
  commodityQuoteRows,
  type CommodityQuoteRow,
  type RecordedMarketPoint,
} from "@/lib/quire/commodity-board";
import { CATEGORIES, labelOf } from "@/lib/quire/labels";
import { formatCopper } from "@/lib/quire/money";
import {
  readMarketLocations,
  globalMarketCity,
  locationLabel,
  type MarketLocations,
} from "@/lib/quire/shop-locations";
import { FantasyIcon } from "./fantasy-icon";
import { SearchSelect } from "./search-select";
import { AppLink } from "./app-link";

function Change({ value }: { value: number | null }) {
  const trend = value === null || Math.abs(value) < 0.005 ? "flat" : value > 0 ? "up" : "down";
  const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  return (
    <span className={`commodity-change commodity-${trend}`}>
      <Icon size={15} aria-hidden="true" />
      {value === null ? "No comparison" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
    </span>
  );
}

function chartGeometry(points: RecordedMarketPoint[], width: number, height: number, padding = 4) {
  const prices = points.length ? points.flatMap((p) => [p.askCopper, p.bidCopper]) : [0, 1];
  const min = Math.min(...prices),
    max = Math.max(...prices);
  const span = Math.max(max - min, max * 0.1, 1),
    lower = Math.max(0, min - span * 0.15);
  const upper = max + span * 0.15;
  const first = points[0]?.epoch ?? 0,
    last = points.at(-1)?.epoch ?? first;
  return {
    x: (epoch: number) =>
      padding + ((epoch - first) / Math.max(last - first, 1)) * (width - padding * 2),
    y: (value: number) =>
      height - padding - ((value - lower) / (upper - lower)) * (height - padding * 2),
    lower,
    upper,
  };
}

export function GlobalCommodityMarket() {
  const table = useWorldTable(),
    dm = useSeat().role === "dm";
  const economy = useMemo(
    () => readTradeEconomy(table.journal.tradeEconomy),
    [table.journal.tradeEconomy],
  );
  const exchanges = economy.exchanges.filter((e) => dm || (e.visible && exchangeHere(table, e)));
  const market = readMarketLocations(table.journal.market);
  if (!globalMarketCity(market))
    return (
      <section className="commodity-dashboard commodity-overview" aria-label="Global market access">
        <div className="commodity-board-top">
          <h2>Global market</h2>
          <span className="commodity-board-status">Closed here</span>
        </div>
        <p role="status">
          Visit a city to access the global market. City areas, such as docks and market districts,
          also have access.
        </p>
        <p className="commodity-caption">
          Party location:{" "}
          {market.currentLocationId ? locationLabel(market, market.currentLocationId) : "Not set"}.
        </p>
        {dm && (
          <AppLink href="/features/economy?from=%2Fmarket">
            Configure commodities & exchanges →
          </AppLink>
        )}
      </section>
    );
  return (
    <CommodityBoard economy={economy} exchanges={exchanges} market={market} dm={dm} overview />
  );
}

function PriceLines({
  points,
  width,
  height,
  padding = 4,
  dots = false,
}: {
  points: RecordedMarketPoint[];
  width: number;
  height: number;
  padding?: number;
  dots?: boolean;
}) {
  const { x, y } = chartGeometry(points, width, height, padding);
  const segments: RecordedMarketPoint[][] = [];
  for (const point of points) {
    const segment = segments.at(-1);
    // Never join across an unreadable or unrecorded season.
    if (!segment || point.epoch !== segment.at(-1)!.epoch + 1) segments.push([point]);
    else segment.push(point);
  }
  return (
    <>
      {(["askCopper", "bidCopper"] as const).map((price) => (
        <g key={price} className={`commodity-line-${price}`}>
          {segments.map((segment) => (
            <polyline
              key={segment[0].epoch}
              fill="none"
              stroke="currentColor"
              strokeWidth={price === "askCopper" ? 2.5 : 1.5}
              strokeDasharray={price === "bidCopper" ? "4 3" : undefined}
              points={segment.map((p) => `${x(p.epoch)},${y(p[price])}`).join(" ")}
            />
          ))}
          {dots &&
            points.map((p) => (
              <circle key={p.epoch} cx={x(p.epoch)} cy={y(p[price])} r={3} fill="currentColor" />
            ))}
        </g>
      ))}
    </>
  );
}

function StockBars({ offer }: Pick<CommodityQuoteRow, "offer">) {
  return (
    <div className="commodity-stock-bars">
      <div>
        <span>Stock</span>
        <div className="commodity-bar" aria-hidden="true">
          <i style={{ width: `${offer.capacity ? (offer.stock / offer.capacity) * 100 : 0}%` }} />
        </div>
        <b>{offer.stock.toLocaleString()}</b>
      </div>
      <div>
        <span>Wanted</span>
        <div className="commodity-bar commodity-wanted" aria-hidden="true">
          <i
            style={{
              width: `${offer.capacity ? ((offer.capacity - offer.stock) / offer.capacity) * 100 : 0}%`,
            }}
          />
        </div>
        <b>{(offer.capacity - offer.stock).toLocaleString()}</b>
      </div>
    </div>
  );
}

function RecordedChart({ row, dm }: { row: CommodityQuoteRow; dm: boolean }) {
  const [range, setRange] = useState<"recent" | "all">("recent");
  const points = range === "recent" ? row.points.slice(-12) : row.points;
  const { lower, upper } = chartGeometry(points, 520, 200, 18);
  return (
    <section className="commodity-chart" aria-label="Recorded commodity prices">
      <div className="commodity-chart-heading">
        <h4>Seasonal price history</h4>
        {row.points.length > 12 && (
          <div className="commodity-range" aria-label="Chart range">
            <button
              type="button"
              aria-pressed={range === "recent"}
              onClick={() => setRange("recent")}
            >
              Recent 12
            </button>
            <button type="button" aria-pressed={range === "all"} onClick={() => setRange("all")}>
              All recorded
            </button>
          </div>
        )}
      </div>
      {points.length ? (
        <>
          <div className="commodity-chart-legend">
            <span>━ Ask</span>
            <span>┄ Bid</span>
            <span>Per {row.commodity.unit} · approved quotes</span>
          </div>
          <div className="commodity-chart-scale">
            <span>{formatCopper(Math.round(upper))}</span>
            <span>{formatCopper(Math.round(lower))}</span>
          </div>
          <svg
            viewBox="0 0 520 200"
            role="img"
            aria-label={`Approved ask and bid prices for ${row.commodity.name}, seasons ${points[0].epoch} to ${points.at(-1)!.epoch}`}
          >
            {[30, 80, 130, 180].map((y) => (
              <line key={y} x1="18" x2="502" y1={y} y2={y} className="commodity-grid-line" />
            ))}
            <PriceLines points={points} width={520} height={200} padding={18} dots />
          </svg>
          <div className="commodity-chart-epochs">
            <span>Season {points[0].epoch}</span>
            <span>Season {points.at(-1)!.epoch}</span>
          </div>
          <p className="commodity-caption">
            Recorded baselines and approved settlements. Gaps stay empty; later DM edits appear in
            the current quote above.
          </p>
          <details>
            <summary>Recorded quote data · {points.length}</summary>
            <div className="commodity-data">
              <table>
                <caption>Prices per {row.commodity.unit}</caption>
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Ask</th>
                    <th>Bid</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.epoch}>
                      <th>{p.epoch}</th>
                      <td>{formatCopper(p.askCopper)}</td>
                      <td>{formatCopper(p.bidCopper)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="commodity-chart-empty">
          {dm
            ? "No readable seasonal price history for this good and unit. Approve a market season to begin recording."
            : "Seasonal history is private. Current exchange quotes, stock and indices are shown above."}
        </p>
      )}
    </section>
  );
}

export function CommodityBoard({
  economy,
  exchanges,
  market,
  dm,
  overview = false,
  initialExchange = "",
  initialCommodity = "",
  renderTrade,
}: {
  economy: TradeEconomy;
  exchanges: Exchange[];
  market: MarketLocations;
  dm: boolean;
  overview?: boolean;
  initialExchange?: string;
  initialCommodity?: string;
  renderTrade?: (row: CommodityQuoteRow) => ReactNode;
}) {
  const rows = useMemo(() => commodityQuoteRows(economy, exchanges, dm), [economy, exchanges, dm]);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [exchangeId, setExchangeId] = useState(initialExchange),
    [openOnly, setOpenOnly] = useState(false),
    [sort, setSort] = useState("name"),
    [selectedKey, setSelectedKey] = useState(""),
    [visited, setVisited] = useState<string[]>([]),
    [expanded, setExpanded] = useState(false);
  const needle = query.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
  const shown = rows
    .filter(
      (r) =>
        (!category || r.commodity.category === category) &&
        (!exchangeId || r.exchange.id === exchangeId) &&
        (!openOnly || (r.exchange.open && r.commodity.active)) &&
        `${r.commodity.name} ${r.commodity.description} ${r.commodity.unit} ${r.exchange.name} ${locationLabel(market, r.exchange.locationId ?? undefined)}`
          .normalize("NFKD")
          .replace(/\p{M}/gu, "")
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort((a, b) =>
      sort === "ask"
        ? a.offer.askCopper - b.offer.askCopper
        : sort === "stock"
          ? b.offer.stock - a.offer.stock
          : sort === "change"
            ? (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity)
            : a.commodity.name.localeCompare(b.commodity.name) ||
              a.exchange.name.localeCompare(b.exchange.name),
    );
  const selected =
    rows.find((r) => r.key === selectedKey) ??
    rows.find((r) => r.exchange.id === initialExchange && r.commodity.id === initialCommodity) ??
    rows.find((r) => r.exchange.id === initialExchange) ??
    rows[0];
  function select(row: CommodityQuoteRow) {
    setVisited((keys) => [...new Set([...keys, ...(selected ? [selected.key] : []), row.key])]);
    setSelectedKey(row.key);
  }
  function quote(row: CommodityQuoteRow) {
    const content = (
      <>
        <div className="commodity-good">
          <FantasyIcon
            entry={{
              name: row.commodity.name,
              category: row.commodity.category,
              kind: "shop",
            }}
            size={36}
          />
          <div>
            <strong>{row.commodity.name}</strong>
            <small>
              {row.exchange.name} · {row.commodity.unit}
            </small>
            {(!row.exchange.open || !row.commodity.active) && (
              <small>{!row.exchange.open ? "Exchange closed" : "Inactive good"}</small>
            )}
          </div>
        </div>
        <div className="commodity-price">
          <strong>
            <span>Ask </span>
            {formatCopper(row.offer.askCopper)}
          </strong>
          <small>Bid {formatCopper(row.offer.bidCopper)}</small>
        </div>
        <StockBars offer={row.offer} />
        <div className="commodity-trend">
          <Change value={row.changePercent} />
          {row.points.length > 1 && (
            <svg viewBox="0 0 100 30" aria-hidden="true">
              <PriceLines points={row.points.slice(-12)} width={100} height={30} />
            </svg>
          )}
        </div>
      </>
    );
    return overview ? (
      <AppLink
        key={row.key}
        className="commodity-row"
        href={`/features/economy?from=%2Fmarket&exchange=${encodeURIComponent(row.exchange.id)}&commodity=${encodeURIComponent(row.commodity.id)}`}
        aria-label={`View ${row.commodity.name} at ${row.exchange.name}`}
      >
        {content}
      </AppLink>
    ) : (
      <button
        type="button"
        key={row.key}
        className="commodity-row"
        aria-pressed={selected?.key === row.key}
        aria-label={`View ${row.commodity.name} at ${row.exchange.name}`}
        onClick={() => select(row)}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={`commodity-dashboard${overview ? " commodity-overview" : ""}`}>
      <div className="commodity-board-top">
        <div>
          <p className="commodity-eyebrow">Campaign commodity exchange</p>
          <h2>{overview ? "Global market" : "Market board"}</h2>
        </div>
        <span className="commodity-board-status">
          {exchanges.filter((e) => e.open).length} / {exchanges.length} exchanges open
        </span>
      </div>
      <div className="commodity-filters">
        <label className="commodity-search">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search commodities</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search goods, exchanges or locations"
          />
        </label>
        <SearchSelect aria-label="Exchange filter" value={exchangeId} onValueChange={setExchangeId}>
          <option value="">All exchanges</option>
          {exchanges.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {locationLabel(market, e.locationId ?? undefined)}
            </option>
          ))}
        </SearchSelect>
        {!overview && (
          <label className="commodity-sort">
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span className="sr-only">Sort commodities</span>
            <select
              aria-label="Sort commodities"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name">Name</option>
              <option value="ask">Lowest ask</option>
              <option value="stock">Most stock</option>
              {dm && <option value="change">Price change</option>}
            </select>
          </label>
        )}
      </div>
      <div className="commodity-categories" aria-label="Commodity categories">
        <button type="button" aria-pressed={!category} onClick={() => setCategory("")}>
          All goods
        </button>
        {CATEGORIES.filter((c) => rows.some((r) => r.commodity.category === c.value)).map((c) => (
          <button
            type="button"
            key={c.value}
            aria-pressed={category === c.value}
            onClick={() => setCategory(category === c.value ? "" : c.value)}
          >
            <FantasyIcon entry={{ kind: "shop", category: c.value }} categoryOnly size={22} />
            {c.label}
          </button>
        ))}
      </div>
      <div className="commodity-board-meta">
        <span role="status">
          {shown.length} of {rows.length} quotes · prices per listed unit
        </span>
        <label>
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Open & active only
        </label>
      </div>
      <div className="commodity-board-layout">
        <section
          className="commodity-quote-board"
          aria-label={overview ? "Global commodity quotes" : "Commodity quotes"}
        >
          <div className="commodity-columns" aria-hidden="true">
            <span>Commodity / exchange</span>
            <span>Ask / bid</span>
            <span>Stock / wanted</span>
            <span>Season change</span>
          </div>
          <div className="commodity-rows">
            {overview ? (
              <div className="commodity-sectors">
                {[...new Set(shown.map((r) => r.commodity.category))]
                  .sort(
                    (a, b) =>
                      CATEGORIES.findIndex((c) => c.value === a) -
                      CATEGORIES.findIndex((c) => c.value === b),
                  )
                  .map((sector) => (
                    <section
                      className="commodity-sector"
                      key={sector}
                      aria-label={`${labelOf(CATEGORIES, sector)} quotes`}
                    >
                      <h3>
                        <FantasyIcon
                          entry={{ kind: "shop", category: sector }}
                          categoryOnly
                          size={22}
                        />
                        {labelOf(CATEGORIES, sector)}
                      </h3>
                      {shown.filter((row) => row.commodity.category === sector).map(quote)}
                    </section>
                  ))}
              </div>
            ) : (
              (expanded || needle || category || exchangeId || openOnly
                ? shown
                : shown.slice(0, 8)
              ).map(quote)
            )}
            {!shown.length && (
              <p className="commodity-no-results">
                {rows.length
                  ? "No matching quotes. Try another search or filter."
                  : dm
                    ? overview
                      ? "Add commodities and exchanges in Trade Exchanges to populate this board."
                      : "Create a commodity and an exchange in the DM controls below to begin."
                    : "No exchanges are available at the current party location."}
              </p>
            )}
          </div>
          {!overview && !needle && !category && !exchangeId && !openOnly && shown.length > 8 && (
            <div className="commodity-more-quotes">
              <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show fewer quotes" : `Show all ${shown.length} quotes`}
              </button>
            </div>
          )}
          <p className="commodity-caption">
            {dm
              ? `Ask changes compare the current quote with its recorded baseline before season ${economy.epoch}.`
              : "Quotes are limited to exchanges available at the party’s location."}{" "}
            Supply and demand are indices; 100 is neutral.
          </p>
        </section>
        {!overview && selected && (
          <aside className="commodity-detail-stack" aria-label="Selected commodity">
            {rows
              .filter((r) => r.key === selected.key || visited.includes(r.key))
              .map((row) => (
                <section
                  key={row.key}
                  hidden={row.key !== selected.key}
                  className="commodity-detail"
                  aria-label={row.exchange.name}
                >
                  <div className="commodity-detail-title">
                    <FantasyIcon
                      entry={{
                        name: row.commodity.name,
                        category: row.commodity.category,
                        kind: "shop",
                      }}
                      size={44}
                    />
                    <div>
                      <p className="commodity-eyebrow">
                        {labelOf(CATEGORIES, row.commodity.category)} · per {row.commodity.unit}
                      </p>
                      <h3>{row.exchange.name}</h3>
                      <h4>{row.commodity.name}</h4>
                    </div>
                  </div>
                  <p className="commodity-caption">
                    {locationLabel(market, row.exchange.locationId ?? undefined)} ·{" "}
                    {row.exchange.open ? "Open" : "Closed"}
                  </p>
                  <div className="commodity-detail-prices">
                    <div>
                      <span>Buy / ask</span>
                      <strong>{formatCopper(row.offer.askCopper)}</strong>
                    </div>
                    <div>
                      <span>Sell / bid</span>
                      <strong>{formatCopper(row.offer.bidCopper)}</strong>
                    </div>
                    <Change value={row.changePercent} />
                  </div>
                  <RecordedChart row={row} dm={dm} />
                  <div className="commodity-indices">
                    <div>
                      <span>Supply</span>
                      <b>{row.offer.supply}</b>
                      <meter
                        min="1"
                        max="1000"
                        value={row.offer.supply}
                        aria-label="Supply index"
                      />
                    </div>
                    <div>
                      <span>Demand</span>
                      <b>{row.offer.demand}</b>
                      <meter
                        min="1"
                        max="1000"
                        value={row.offer.demand}
                        aria-label="Demand index"
                      />
                    </div>
                    <div>
                      <span>Stock / capacity</span>
                      <b>
                        {row.offer.stock.toLocaleString()} / {row.offer.capacity.toLocaleString()}
                      </b>
                    </div>
                  </div>
                  <StockBars offer={row.offer} />
                  {row.commodity.description && <p>{row.commodity.description}</p>}
                  {row.exchange.notes && <p>{row.exchange.notes}</p>}
                  {renderTrade?.(row)}
                </section>
              ))}
          </aside>
        )}
      </div>
      {overview && (
        <AppLink className="commodity-open-exchanges" href="/features/economy?from=%2Fmarket">
          Open Trade Exchanges →
        </AppLink>
      )}
    </div>
  );
}
