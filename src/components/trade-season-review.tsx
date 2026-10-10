import { useMemo } from "react";
import {
  type Exchange,
  type TradeOffer,
  type TradeSeasonQuote,
} from "@/lib/quire/trade-economy-schema";
import { readTradeSeasonBaseline } from "@/lib/quire/trade-history";
import { SEASON_NAMES } from "@/lib/quire/scale";
import { formatCopper } from "@/lib/quire/money";
import { canonicalJson } from "@/lib/quire/canonical-json";

type AppliedSeason = { exchanges: Exchange[]; realm: TradeSeasonQuote["realm"] };

export function TradeSeasonReview({
  quote,
  applied,
}: {
  quote: TradeSeasonQuote;
  applied?: AppliedSeason;
}) {
  const baseline = useMemo(() => readTradeSeasonBaseline(quote), [quote]);
  const overridden =
    applied &&
    (canonicalJson(applied.exchanges) !== canonicalJson(quote.exchanges) ||
      canonicalJson(applied.realm) !== canonicalJson(quote.realm));
  return (
    <section
      className="trade-season-review"
      aria-label={applied ? "Seasonal settlement record" : "Seasonal settlement preview"}
    >
      <h3>
        {applied ? "Recorded settlement" : SEASON_NAMES[quote.season]} · season{" "}
        {quote.fromEpoch + 1}
      </h3>
      <p>
        {quote.mode === "automatic" ? "Automatic Mode" : "Classic Mode"} · Original proposal:{" "}
        {quote.hardship}
      </p>
      {applied && (
        <p>
          Proposed {SEASON_NAMES[quote.realm.season]} · Applied {SEASON_NAMES[applied.realm.season]}{" "}
          · {overridden ? "DM override recorded" : "Proposal approved unchanged"}
        </p>
      )}
      <p className="text-sm text-muted">
        Before shows the market recorded when this preview was prepared. Proposed shows the original
        proposal{applied ? "; Applied shows the approved result" : ""}.
      </p>
      {!baseline && (
        <p className="text-muted">
          Original baseline unavailable for this record. The saved proposal
          {applied ? " and applied result remain" : " remains"} available below.
        </p>
      )}
      <details className="journal-entry">
        <summary>Seasonal conditions · before, proposed{applied ? " and applied" : ""}</summary>
        <div className="trade-comparison-grid">
          <RealmValues label="Before" realm={baseline?.realm} />
          <RealmValues label="Proposed" realm={quote.realm} />
          {applied && <RealmValues label="Applied" realm={applied.realm} />}
        </div>
      </details>
      {quote.exchanges.map((e) => (
        <details key={e.id} className="journal-entry" open>
          <summary>
            {e.name} · {applied ? "recorded seasonal quotes" : "proposed seasonal quotes"}
          </summary>
          <div className="trade-offer-grid">
            {e.offers.map((o) => {
              const c = baseline?.commodities.find((c) => c.id === o.commodityId);
              const old = baseline?.exchanges
                .find((x) => x.id === e.id)
                ?.offers.find((x) => x.commodityId === o.commodityId);
              const result = applied?.exchanges
                .find((x) => x.id === e.id)
                ?.offers.find((x) => x.commodityId === o.commodityId);
              const flow = quote.feedback.find(
                (f) => f.exchangeId === e.id && f.commodityId === o.commodityId,
              );
              return (
                <article
                  key={o.commodityId}
                  className="journal-entry"
                  aria-label={`${c?.name ?? o.commodityId} seasonal quotes`}
                >
                  <h4>{c?.name ?? o.commodityId}</h4>
                  <p>{c ? `Per ${c.unit}` : "Unit not recorded in this historical baseline."}</p>
                  <div className="trade-comparison-grid">
                    <OfferValues label="Before" offer={old} />
                    <OfferValues label="Proposed" offer={o} />
                    {applied && <OfferValues label="Applied" offer={result} />}
                  </div>
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

function OfferValues({ label, offer }: { label: string; offer?: TradeOffer }) {
  return (
    <section aria-label={`${label} offer`} className="trade-comparison-stage">
      <h5>{label}</h5>
      {offer ? (
        <>
          <dl className="trade-comparison-values">
            {[
              ["Ask", formatCopper(offer.askCopper)],
              ["Bid", formatCopper(offer.bidCopper)],
              ["Stock", offer.stock],
              ["Target stock", offer.targetStock],
              ["Capacity", offer.capacity],
              ["Supply", offer.supply],
              ["Demand", offer.demand],
            ].map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted">
            Locks:{" "}
            {[
              offer.lockPrice && "prices",
              offer.lockStock && "stock",
              offer.lockIndices && "indices",
            ]
              .filter(Boolean)
              .join(", ") || "none"}
          </p>
        </>
      ) : (
        <p className="text-muted">Values not recorded.</p>
      )}
    </section>
  );
}

function RealmValues({ label, realm }: { label: string; realm?: TradeSeasonQuote["realm"] }) {
  return (
    <section aria-label={`${label} seasonal conditions`} className="trade-comparison-stage">
      <h4>{label}</h4>
      {realm ? (
        <dl className="trade-comparison-values">
          {[
            ["Season", SEASON_NAMES[realm.season]],
            ["Inflation", realm.inflation],
            ["Scarcity", realm.scarcity],
            ["GP dollar value", realm.gpDollars],
            ["Shortage", realm.shortage],
            ["War", realm.war],
            ["Plague", realm.plague],
            ["Roads", realm.roads],
          ].map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-muted">Values not recorded.</p>
      )}
    </section>
  );
}
