import { useMemo } from "react";
import { useEconomy } from "./economy-context";
import { reviewItems, reviewTotal } from "./review-inbox";

/**
 * Requests waiting in the DM's Review Inbox, from the campaign on this screen (design Q13).
 * Account character imports are counted by the inbox itself; they live outside the campaign.
 */
export function useReviewCount(enabled = true): number {
  const { purses, holdings, journal, loans } = useEconomy();
  return useMemo(
    () => (enabled ? reviewTotal(reviewItems({ purses, holdings, journal, loans })) : 0),
    [enabled, purses, holdings, journal, loans],
  );
}
