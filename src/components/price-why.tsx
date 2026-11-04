import { useId, useState } from "react";
import { cp, viewerBreakdown, type PriceBreakdown } from "@/lib/quire/price-breakdown";
import { formatCopper } from "@/lib/quire/money";
import "./price-why.css";

function signed(copper: number) {
  return `${copper < 0 ? "−" : "+"}${cp(Math.abs(copper))}`;
}
function rate(percent?: number) {
  return percent === undefined ? "" : `${percent >= 0 ? "+" : "−"}${Math.abs(percent)}%`;
}

/**
 * "Why this price?": a button that opens the factors behind one price, in whole copper. The
 * breakdown is the one the command charges (price-breakdown.ts); players see DM-only factors
 * folded into "Other adjustments".
 */
export function PriceWhy({
  breakdown,
  dm,
  label = "Why this price?",
}: {
  breakdown: PriceBreakdown | null | undefined;
  dm: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!breakdown) return null;
  const b = viewerBreakdown(breakdown, dm);
  const coins = formatCopper(b.total);
  return (
    <span className="price-why">
      <button
        type="button"
        className="price-why-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <span id={id} role="region" aria-label="Price breakdown" className="price-why-panel">
          <span className="price-why-row">
            <span>{b.base.label}</span>
            <span>{cp(b.base.copper)}</span>
          </span>
          {b.listDerivation?.length ? (
            <span className="price-why-sub" aria-label="How today's rates set the list price">
              {b.listDerivation.map((f) => (
                <span key={f.key} className="price-why-row">
                  <span>
                    {f.label} {rate(f.percent)}
                  </span>
                  <span>{signed(f.copper)}</span>
                </span>
              ))}
              <span className="price-why-dm">DM only: today's rates reproduce this list price.</span>
            </span>
          ) : null}
          {b.factors.map((f) => (
            <span key={f.key} className="price-why-row">
              <span>
                {f.label}
                {f.percent !== undefined && f.key !== "charisma" && !/%/.test(f.label) ? ` ${rate(f.percent)}` : ""}
              </span>
              <span>{signed(f.copper)}</span>
            </span>
          ))}
          {b.quantity !== 1 && (
            <span className="price-why-row">
              <span>
                {cp(b.unit)} each × {b.quantity}
              </span>
              <span />
            </span>
          )}
          <span className="price-why-row price-why-total">
            <span>Total</span>
            <span>
              {cp(b.total)}
              {coins !== cp(b.total) ? ` · ${coins}` : ""}
            </span>
          </span>
          {b.negotiator && !b.negotiator.party && !b.factors.some((f) => f.key === "charisma") && (
            <span className="price-why-note">
              {b.negotiator.name} negotiates
              {b.negotiator.cha === null ? ": no Charisma on record, so no discount." : `: Charisma ${Math.floor(Number(b.negotiator.cha))}, no discount.`}
            </span>
          )}
          {b.negotiator?.party && <span className="price-why-note">The party fund pays; no one negotiates.</span>}
          {b.note && <span className="price-why-note">{b.note}</span>}
        </span>
      )}
    </span>
  );
}
