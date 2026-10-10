import type { Commodity, Exchange, TradeEconomy, TradeOffer } from "./trade-economy-schema.ts";
import { readTradeSeasonBaseline } from "./trade-history.ts";

export type RecordedMarketPoint = { epoch: number; askCopper: number; bidCopper: number };
export type CommodityQuoteRow = {
  key: string;
  commodity: Commodity;
  exchange: Exchange;
  offer: TradeOffer;
  points: RecordedMarketPoint[];
  changePercent: number | null;
};
export const commodityQuoteId = (exchangeId: string, commodityId: string) =>
  JSON.stringify([exchangeId, commodityId]);

/** Presentation only: prices come from current offers and approved, readable snapshots.
 * A missing prior season or changed physical unit never becomes an invented comparison.
 * Callers must explicitly opt in to DM history; players keep the existing quote-only view.
 */
export function commodityQuoteRows(
  economy: TradeEconomy,
  exchanges: Exchange[],
  includeHistory = false,
): CommodityQuoteRow[] {
  const commodities = new Map(economy.commodities.map((c) => [c.id, c]));
  const histories = new Map<string, Map<number, RecordedMarketPoint>>();
  const previous = new Map<string, number>();
  const historyKey = (exchangeId: string, commodityId: string, unit: string) =>
    JSON.stringify([exchangeId, commodityId, unit]);
  if (includeHistory) {
    for (const record of economy.history) {
      const before = readTradeSeasonBaseline(record.quote);
      if (!before || record.quote.fromEpoch >= economy.epoch) continue;
      const units = new Map(before.commodities.map((c) => [c.id, c.unit]));
      for (const exchange of before.exchanges) {
        for (const offer of exchange.offers) {
          const unit = units.get(offer.commodityId);
          if (!unit || unit !== commodities.get(offer.commodityId)?.unit) continue;
          const key = historyKey(exchange.id, offer.commodityId, unit);
          const points = histories.get(key) ?? new Map<number, RecordedMarketPoint>();
          // Only seed a missing baseline. Approved results retain their recorded value.
          if (!points.has(before.epoch))
            points.set(before.epoch, {
              epoch: before.epoch,
              askCopper: offer.askCopper,
              bidCopper: offer.bidCopper,
            });
          histories.set(key, points);
          if (before.epoch === economy.epoch - 1) previous.set(key, offer.askCopper);
        }
      }
      for (const exchange of record.appliedExchanges) {
        for (const offer of exchange.offers) {
          const unit = units.get(offer.commodityId);
          if (!unit || unit !== commodities.get(offer.commodityId)?.unit) continue;
          const key = historyKey(exchange.id, offer.commodityId, unit);
          const points = histories.get(key) ?? new Map<number, RecordedMarketPoint>();
          points.set(record.quote.fromEpoch + 1, {
            epoch: record.quote.fromEpoch + 1,
            askCopper: offer.askCopper,
            bidCopper: offer.bidCopper,
          });
          histories.set(key, points);
        }
      }
    }
  }
  return exchanges.flatMap((exchange) =>
    exchange.offers.flatMap((offer) => {
      const commodity = commodities.get(offer.commodityId);
      if (!commodity) return [];
      const key = historyKey(exchange.id, commodity.id, commodity.unit);
      const prior = previous.get(key);
      return [
        {
          key: commodityQuoteId(exchange.id, commodity.id),
          commodity,
          exchange,
          offer,
          points: [...(histories.get(key)?.values() ?? [])].sort((a, b) => a.epoch - b.epoch),
          changePercent: prior === undefined ? null : (offer.askCopper / prior - 1) * 100,
        },
      ];
    }),
  );
}
