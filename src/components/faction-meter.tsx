import { tierFor, MAX_RENOWN, MIN_RENOWN, type FactionTier } from "@/lib/quire/factions";
import "./factions.css";

/**
 * A Fallout-karma-style renown meter (factions.ts): the faction's tier bands from −1000 to 1000,
 * the current band highlighted, and a marker at the score. Used for a character's own renown, the
 * party's attitude and the DM's standing rows. Without a score (a small party's attitude, which
 * players see as a tier only) the band alone is highlighted.
 */
export function FactionMeter({
  tiers,
  score,
  tierId,
  label,
  detail,
  testId,
}: {
  tiers: readonly FactionTier[];
  score?: number;
  /** The tier to highlight when there is no score. */
  tierId?: string;
  label: string;
  /** Extra text after the tier, e.g. "12 Favor". */
  detail?: string;
  testId?: string;
}) {
  const span = MAX_RENOWN - MIN_RENOWN;
  const tier = score !== undefined ? tierFor(tiers, score) : (tiers.find((t) => t.id === tierId) ?? tierFor(tiers, 0));
  const at = score === undefined ? undefined : ((score - MIN_RENOWN) / span) * 100;
  const valueText = `${tier.name}${score !== undefined ? `, ${score}` : ""}`;
  return (
    <div className="faction-meter" data-testid={testId} data-tier={tier.id}>
      <div className="faction-meter-head">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          {valueText}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
      <div
        className="faction-meter-bar"
        role="meter"
        aria-label={label}
        aria-valuemin={MIN_RENOWN}
        aria-valuemax={MAX_RENOWN}
        {...(score !== undefined ? { "aria-valuenow": score } : {})}
        aria-valuetext={valueText}
      >
        {tiers.map((t, i) => {
          const end = tiers[i + 1]?.min ?? MAX_RENOWN;
          return (
            <span
              key={t.id}
              className="faction-meter-band"
              data-current={t.id === tier.id ? "true" : undefined}
              style={{ width: `${((end - t.min) / span) * 100}%` }}
              title={t.name}
            />
          );
        })}
        {at !== undefined ? <span className="faction-meter-mark" style={{ left: `${at}%` }} aria-hidden="true" /> : null}
      </div>
      <div className="faction-meter-ends text-faint" aria-hidden="true">
        <span>{tiers[0]?.name}</span>
        <span>{tiers[tiers.length - 1]?.name}</span>
      </div>
    </div>
  );
}
