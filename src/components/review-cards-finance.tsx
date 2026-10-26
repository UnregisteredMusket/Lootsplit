import { useEconomy } from "@/lib/quire/economy-context";
import { newCommandId } from "@/lib/quire/command-id";
import { toCopper } from "@/lib/quire/money";
import type { LoanAsk } from "@/lib/quire/market";
import { ReviewCard, type ReviewDecision, type SavedReasons } from "./review-card";

type PaymentRequest = { id: string; purseId: string; copper: number; note: string; at: number; status: string };
type CardState = { decided?: ReviewDecision; onDecided?: (d: ReviewDecision) => void; savedReasons?: SavedReasons };

// One command ID per payment decision for this page load: a retry (the card again, or Approve all
// after a partial failure) reuses it, so the room and the device apply it once. After a reload the
// request's own status check refuses a second approval ("already decided").
const paymentIds = new Map<string, string>();
export function paymentDecisionId(requestId: string, status: "approved" | "denied") {
  const key = `${requestId}|${status}`;
  let id = paymentIds.get(key);
  if (!id) paymentIds.set(key, (id = newCommandId()));
  return id;
}

/** Review Inbox and Bank: a payment request. Approve and Deny run `payment-decision`, unchanged. */
export function PaymentReviewCard({ request: r, decided, onDecided, savedReasons }: CardState & { request: PaymentRequest }) {
  const { purses, commandOutcome } = useEconomy();
  const purse = purses.find((p) => p.id === r.purseId);
  const decide = (status: "approved" | "denied") =>
    commandOutcome({ id: paymentDecisionId(r.id, status), kind: "payment-decision", requestId: r.id, status });
  return (
    <ReviewCard
      typeLabel="Payment"
      who={purse?.name ?? "A character"}
      what={r.note}
      copper={r.copper}
      direction="out"
      balanceAfter={purse ? toCopper(purse.coins) - r.copper : undefined}
      at={r.at}
      approveLabel="Approve payment"
      denyLabel="Decline"
      onApprove={() => decide("approved")}
      onDeny={() => decide("denied")}
      decided={decided}
      onDecided={onDecided}
      savedReasons={savedReasons}
      receiptHref="/features/reports"
      receiptLabel="View receipt"
    />
  );
}

/** Review Inbox and Bank: a loan application. Approve and Deny run the loan decision, unchanged. */
export function LoanReviewCard({ loan: l, decided, onDecided, savedReasons }: CardState & { loan: LoanAsk }) {
  const { purses, decideLoan } = useEconomy();
  const purse = purses.find((p) => p.id === l.purseId);
  return (
    <ReviewCard
      typeLabel="Loan"
      who={purse?.name ?? l.purseName}
      what={l.note}
      copper={l.copper}
      direction="in"
      balanceAfter={purse ? toCopper(purse.coins) + l.copper : undefined}
      at={l.at}
      approveLabel="Approve loan"
      denyLabel="Decline"
      onApprove={() => decideLoan(l.id, "approved")}
      onDeny={() => decideLoan(l.id, "denied")}
      decided={decided}
      onDecided={onDecided}
      savedReasons={savedReasons}
      receiptHref="/features/bank"
      receiptLabel="View loan record"
    />
  );
}
