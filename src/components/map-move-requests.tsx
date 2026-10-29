import { useState } from "react";
import { Hourglass } from "lucide-react";
import { toast } from "sonner";
import { useEconomy } from "@/lib/quire/economy-context";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { useWorldTable } from "@/lib/quire/use-world-table";
import type { CloudTable } from "@/lib/quire/cloud";
import type { CommandRequest } from "@/lib/quire/commands";
import type { CampaignMap, MoveRequest } from "@/lib/quire/world-schema";
import { ReviewCard, type ReviewDecision, type SavedReasons } from "./review-card";

/**
 * "Ask the DM" movement for players (map tokens PR 8): the mode chip and the moves waiting for
 * the DM on this map, each with Withdraw.
 */
export function MoveRequestChips({ map, requests }: { map: CampaignMap; requests: MoveRequest[] }) {
  const { commandOutcome } = useEconomy();
  const [busy, setBusy] = useState(false);
  const waiting = requests.filter((r) => r.status === "pending" && r.mapId === map.id);
  return (
    <div className="map-move-chips" role="group" aria-label="Your movement">
      <span className="map-move-chip lead">
        <Hourglass size={15} aria-hidden="true" /> Ask the DM: your moves wait for approval
      </span>
      {waiting.map((r) => (
        <span className="map-move-chip" key={r.id}>
          {map.tokens?.find((t) => t.id === r.tokenId)?.label ?? "Token"}: waiting for the DM ·{" "}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await commandOutcome({ kind: "map-move-request-withdraw", requestId: r.id });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "The move could not be withdrawn.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Withdraw
          </button>
        </span>
      ))}
    </div>
  );
}

/** Review Inbox: a player's "Ask the DM" token move. */
export function MoveRequestReview({
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
  const r = t.journal?.world?.moveRequests?.find((x) => x.id === requestId);
  if (!r || (r.status !== "pending" && !decided)) return null;
  const map = t.journal?.world?.maps.find((m) => m.id === r.mapId);
  const token = map?.tokens?.find((x) => x.id === r.tokenId);
  const who = t.purses.find((p) => p.id === r.purseId)?.name ?? "A player";
  const decide = async (approve: boolean, reason = "") => {
    const outcome = await commandOutcome({ id: `${r.id}-review`, kind: "map-move-request-review", requestId: r.id, approve, ...(reason.trim() ? { reason: reason.trim() } : {}) } as CommandRequest);
    toast.success(mutationNotice(outcome, approve ? `${token?.label ?? "The token"} moved.` : "Move denied."));
    return outcome;
  };
  return (
    <ReviewCard
      typeLabel="Token move"
      who={who}
      what={
        <>
          Move <b>{token?.label ?? "a token"}</b> on {map?.name ?? "a map"} to column {r.after.column + 1}, row {r.after.row + 1}
        </>
      }
      at={r.createdAt}
      approveLabel="Approve move"
      denyLabel="Deny"
      denyReason="optional"
      onApprove={() => decide(true)}
      onDeny={(reason) => decide(false, reason)}
      decided={decided}
      onDecided={onDecided}
      savedReasons={savedReasons}
      receiptHref={map ? `/maps?map=${encodeURIComponent(map.id)}` : "/maps"}
      receiptLabel="Open the map"
    />
  );
}
