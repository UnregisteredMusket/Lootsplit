import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { lootReviewHref } from "@/lib/encounters/loot-review";
import "./desk-loot-review.css";

/**
 * Desk: "Ready for loot review · <encounter>" for each concluded encounter waiting for its award.
 * Nothing renders when none wait; the Review Inbox readout counts the same rows.
 */
export function DeskLootReviews({ rows }: { rows: { id: string; name: string }[] | null }) {
  if (!rows?.length) return null;
  const shown = rows.slice(0, 3);
  return (
    <section className="desk-loot-reviews" aria-label="Loot reviews">
      {shown.map((row) => (
        <AppLink key={row.id} href={lootReviewHref(row.id)} className="readout desk-loot-review">
          <FantasyIcon ui="gift" size={30} />
          <span>
            <small>Ready for loot review</small>
            <strong>{row.name}</strong>
            <small className="readout-action">Review and transfer loot →</small>
          </span>
        </AppLink>
      ))}
      {rows.length > shown.length && (
        <AppLink href="/encounters?review=1" className="desk-loot-review-more">
          {rows.length - shown.length} more loot{" "}
          {rows.length - shown.length === 1 ? "review" : "reviews"} in Encounters →
        </AppLink>
      )}
    </section>
  );
}
