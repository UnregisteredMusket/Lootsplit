import { useWorldTable } from "@/lib/quire/use-world-table";
import { readTradeEconomy, type TradeSeasonQuote } from "@/lib/quire/trade-economy-schema";
import { SEASON_NAMES } from "@/lib/quire/scale";
import { formatCopper } from "@/lib/quire/money";

export function TradeSeasonReview({ quote }: { quote: TradeSeasonQuote }) {
  const economy = readTradeEconomy(useWorldTable().journal.tradeEconomy);
  return (
    <section className="trade-season-review" aria-label="Seasonal settlement preview">
      <h3>
        {SEASON_NAMES[quote.season]} · season {quote.fromEpoch + 1}
      </h3>
      <p>
        {quote.mode === "automatic" ? "Automatic Mode" : "Classic Mode"} · {quote.hardship}
      </p>
      {quote.exchanges.map((e) => (
        <details key={e.id} className="journal-entry" open>
          <summary>{e.name} · proposed seasonal quotes</summary>
          <div className="trade-offer-grid">
            {e.offers.map((o) => {
              const c = economy.commodities.find((c) => c.id === o.commodityId);
              const old = economy.exchanges
                .find((x) => x.id === e.id)
                ?.offers.find((x) => x.commodityId === o.commodityId);
              const flow = quote.feedback.find(
                (f) => f.exchangeId === e.id && f.commodityId === o.commodityId,
              );
              return (
                <article key={o.commodityId} className="journal-entry">
                  <strong>{c?.name ?? o.commodityId}</strong>
                  <p>
                    Ask {formatCopper(old?.askCopper ?? o.askCopper)} → {formatCopper(o.askCopper)}{" "}
                    · Bid {formatCopper(old?.bidCopper ?? o.bidCopper)} →{" "}
                    {formatCopper(o.bidCopper)}
                  </p>
                  <p>
                    Stock {old?.stock ?? 0} → {o.stock} {c?.unit} · Supply {o.supply} · Demand{" "}
                    {o.demand}
                  </p>
                  <p>
                    Season activity: {flow?.bought ?? 0} bought · {flow?.sold ?? 0} sold
                  </p>
                </article>
              );
            })}
          </div>
        </details>
      ))}
      {!!quote.draws.length && (
        <details>
          <summary>Recorded seasonal d100 rolls</summary>
          {quote.draws.map((d) => (
            <p key={d.key}>
              {d.key}: {d.roll} · {d.source === "server" ? "room server" : "local DM"}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
