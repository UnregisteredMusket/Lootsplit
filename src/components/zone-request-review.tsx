import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { useWorldTable } from "@/lib/quire/use-world-table";
import type { CloudTable } from "@/lib/quire/cloud";
import type { CommandRequest } from "@/lib/quire/commands";
import { voteTally } from "@/lib/quire/zone-commands";
import { zoneName } from "@/lib/quire/zones";
import { ReviewCard, type ReviewDecision, type SavedReasons } from "./review-card";

/**
 * Review Inbox: a party-split request (map tokens PR 7A; mockup zones frame 2, the DM's list).
 * A vote shows its tally and time left with Approve / Reject; a move queued for the session's
 * end shows Apply / Decline. Both close with one `zone-request-resolve`.
 */
export function ZoneRequestReview({
  requestId,
  decided,
  onDecided,
  savedReasons,
}: {
  requestId: string;
  decided?: ReviewDecision;
  onDecided?: (d: ReviewDecision) => void;
  savedReasons?: SavedReasons;
}) {
  const t = useWorldTable() as unknown as CloudTable;
  const { commandOutcome } = useEconomy();
  const r = t.journal?.world?.zoneRequests?.find((x) => x.id === requestId);
  if (!r || (r.status !== "open" && !decided)) return null;
  const who = t.purses.find((p) => p.id === r.purseId)?.name ?? "A player";
  const to = t.journal?.world?.maps.find((m) => m.id === r.toMapId)?.name ?? "another map";
  const vote = r.mode === "vote";
  const tally = voteTally(r);
  const left = r.deadline ? Math.max(0, Math.round((r.deadline - Date.now()) / 60000)) : undefined;
  const decide = async (action: "approve" | "reject" | "decline") => {
    const outcome = await commandOutcome({ id: `${r.id}-${action}`, kind: "zone-request-resolve", requestId: r.id, action } as CommandRequest);
    toast.success(mutationNotice(outcome, action === "approve" ? `${who} split off to ${to}.` : `${who} stays with the party.`));
    return outcome;
  };
  return (
    <ReviewCard
      typeLabel="Party split"
      who={who}
      what={
        <>
          <b>
            {who} → {to}
          </b>{" "}
          <small>
            {vote
              ? `Party vote · ${tally.yes} yes, ${tally.no} no, ${tally.waiting} waiting${left !== undefined ? ` · ${left} min left` : " · until the session ends"}`
              : `Wait until end of session · leaving ${zoneName(t, r.fromZone)}`}
          </small>
        </>
      }
      at={r.createdAt}
      approveLabel={vote ? "Approve" : "Apply"}
      denyLabel={vote ? "Reject" : "Decline"}
      onApprove={() => decide("approve")}
      onDeny={() => decide(vote ? "reject" : "decline")}
      decided={decided}
      onDecided={onDecided}
      savedReasons={savedReasons}
      receiptHref="/party?section=characters"
      receiptLabel="View groups"
    />
  );
}
