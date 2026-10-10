import { z } from "zod";
import {
  commoditySchema,
  exchangeSchema,
  tradeSeasonQuoteSchema,
  type TradeSeasonQuote,
} from "./trade-economy-schema.ts";

// Read only the frozen presentation fields. Activity may contain private transaction
// snapshots; it is neither returned to the view nor rewritten by this reader.
const baselineSchema = z.object({
  epoch: tradeSeasonQuoteSchema.shape.fromEpoch,
  commodities: z.array(commoditySchema).max(500),
  exchanges: z.array(exchangeSchema).max(100),
  realm: tradeSeasonQuoteSchema.shape.realm,
});
export type TradeSeasonBaseline = z.infer<typeof baselineSchema>;

/** Older or damaged fingerprints remain readable as proposals, without invented history. */
export function readTradeSeasonBaseline(quote: TradeSeasonQuote): TradeSeasonBaseline | null {
  try {
    const parsed = baselineSchema.safeParse(JSON.parse(quote.before));
    if (!parsed.success || parsed.data.epoch !== quote.fromEpoch) return null;
    const baseline = parsed.data;
    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    if (
      !unique(baseline.commodities.map((c) => c.id)) ||
      !unique(baseline.exchanges.map((e) => e.id)) ||
      baseline.exchanges.some((e) => !unique(e.offers.map((o) => o.commodityId)))
    )
      return null;
    return baseline;
  } catch {
    return null;
  }
}
