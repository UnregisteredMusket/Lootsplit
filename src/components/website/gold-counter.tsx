import { useEffect, useState } from "react";
import { accountRequest } from "@/lib/account/client";
import {
  formatGoldCopper,
  parsePublicSpendingSnapshot,
  type PublicSpendingSnapshot,
} from "@/lib/website/public-spending";
import "./release-presentation.css";

/** The home page shows the treasury total only once it is impressive (owner decision 2026-10-23):
 * 10,000 gp, in copper. Below it, while loading and on failure the entry is left out; the endpoint
 * and the counting are unchanged. */
export const TREASURY_PUBLIC_MIN_COPPER = 1_000_000;

/** Home page ledger entry "The treasury", shown only at or above `minimumCopper`. */
export function TreasuryEntry({
  minimumCopper = TREASURY_PUBLIC_MIN_COPPER,
}: {
  minimumCopper?: number;
}) {
  const [snapshot, setSnapshot] = useState<PublicSpendingSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    accountRequest<unknown>("site-analytics")
      .then((value) => {
        if (alive) setSnapshot(parsePublicSpendingSnapshot(value));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!snapshot || snapshot.spentCopper < minimumCopper) return null;
  return (
    <div className="ls-ledger-entry">
      <p className="ls-sc ls-entry-no">The treasury</p>
      <GoldSpentCounter initial={snapshot} />
    </div>
  );
}

/** Ledger entry No. 1: the public aggregate spending total and how it is counted. */
export function GoldSpentCounter({
  initial = null,
}: { initial?: PublicSpendingSnapshot | null } = {}) {
  const [snapshot, setSnapshot] = useState<PublicSpendingSnapshot | null>(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    accountRequest<unknown>("site-analytics")
      .then((value) => {
        const next = parsePublicSpendingSnapshot(value);
        if (alive) setSnapshot(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [initial]);
  return (
    <div className="ls-spending-total">
      <div role="status">
        {snapshot === null ? (
          <span className="ls-spending-pending">
            {failed ? "Gold spent · temporarily unavailable" : "Gold spent · loading…"}
          </span>
        ) : (
          <>
            <span className="ls-ledger-figure">{formatGoldCopper(snapshot.spentCopper)} gp</span>{" "}
            <span className="ls-ledger-note">spent</span>
          </>
        )}
      </div>
      <p className="ls-ledger-note">Across shared campaigns</p>
      <details>
        <summary>About this total</summary>
        <p>
          Recorded purchases and outgoing payments across current shared campaigns. Transfers,
          adjustments, sales, loan funding and validly voided entries are excluded.
        </p>
        <p>
          Local-only saves, private cloud backups, unsubmitted actions and owner Test campaigns are
          excluded. This total can decrease after a valid reversal or campaign deletion.
        </p>
        <p>Snapshots are cached for up to a minute; this page reads one snapshot when opened.</p>
        <p>
          {snapshot?.scope === "current-shared-campaigns"
            ? "Returned scope: current shared campaigns."
            : "Returned scope information is unavailable."}
          {snapshot?.asOf ? (
            <>
              {" "}
              As of{" "}
              <time dateTime={new Date(snapshot.asOf).toISOString()}>
                {new Date(snapshot.asOf).toLocaleString()}
              </time>
              .
            </>
          ) : (
            " Snapshot time is unavailable."
          )}
        </p>
      </details>
    </div>
  );
}
