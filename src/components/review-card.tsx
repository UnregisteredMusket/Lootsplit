import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { Button } from "@/components/ui";
import { formatCopper } from "@/lib/quire/money";
import { reviewAge, type ReviewOutcome } from "@/lib/quire/review-inbox";
import type { EconomyMutationOutcome } from "@/lib/quire/mutation-outcome";
import { cn } from "@/lib/cn";
import "./review-inbox.css";

/**
 * One request waiting for the DM (design D2): who, what, the amount and the balance after, then
 * **Approve** (primary) and **Deny…** (secondary, with an optional reason where the request's
 * command records one). Each button runs the request's existing command; this card only shows it.
 *
 * After a decision the parent keeps the card in place as a one-line stub ("Approved · View
 * receipt") so the queue does not jump. Keyboard, when the card itself has focus: A approves,
 * D opens Deny…, J / K move to the next / previous card.
 */
export type ReviewDecision = {
  outcome: ReviewOutcome;
  /** Accepted but waiting to be sent (turn-based rooms). */
  pending?: boolean;
};

const OUTCOME_TEXT: Record<ReviewOutcome, string> = {
  approved: "Approved",
  denied: "Denied",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn by the player",
  resolved: "Done",
};

type DecideResult = EconomyMutationOutcome | boolean | void;

export function ReviewCard({
  typeLabel,
  who,
  what,
  copper,
  direction,
  balanceAfter,
  at,
  approveLabel = "Approve",
  denyLabel = "Deny",
  onApprove,
  onDeny,
  denyReason = "none",
  denyReasonLabel = "Reason (optional)",
  denyExtra,
  approveBlocked,
  extraActions,
  decided,
  onDecided,
  receiptHref,
  receiptLabel = "View receipt",
  keepBody = false,
  children,
  className,
  id,
  savedReasons,
}: {
  typeLabel: string;
  who: string;
  what: ReactNode;
  copper?: number;
  direction?: "out" | "in";
  balanceAfter?: number;
  at?: number;
  approveLabel?: string;
  denyLabel?: string;
  /** Runs the existing approve command. Resolve `false` (or throw) when it was not recorded. */
  onApprove?: () => Promise<DecideResult>;
  onDeny?: (reason: string) => Promise<DecideResult>;
  /** Whether the deny command records a reason. "none" asks for no text. */
  denyReason?: "none" | "optional" | "required";
  denyReasonLabel?: string;
  /** More deny options (e.g. "Show the reason to the player"). */
  denyExtra?: ReactNode;
  /** Why Approve is unavailable right now; shown beside the disabled button. */
  approveBlocked?: string;
  extraActions?: ReactNode;
  decided?: ReviewDecision;
  onDecided?: (decision: ReviewDecision) => void;
  receiptHref?: string;
  receiptLabel?: string;
  /** Keep the details mounted under the stub (the treasure pool shows its own receipt there). */
  keepBody?: boolean;
  /** Details: notes, checks, or the request's own full review where it needs more than two buttons. */
  children?: ReactNode;
  className?: string;
  id?: string;
  savedReasons?: SavedReasons;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [denying, setDenying] = useState(false),
    [reason, setReason] = useState("");
  const ref = useRef<HTMLElement>(null);
  const reasonId = useId();
  const ownReasons = useSavedReasons();
  const reasons = savedReasons ?? ownReasons;
  const native = !!(onApprove || onDeny);
  async function run(kind: "approved" | "denied", work: () => Promise<DecideResult>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const next = nextCard(ref.current, 1);
    try {
      const result = await work();
      if (result === false) {
        setError("Not recorded. Nothing changed; check the message and try again.");
        return;
      }
      if (kind === "denied" && reason.trim()) reasons.remember(reason.trim());
      setDenying(false);
      onDecided?.({
        outcome: kind,
        pending: typeof result === "object" && result?.status === "pending",
      });
      // Approve and next: keep the DM's place in the queue.
      if (next) requestAnimationFrame(() => next.isConnected && next.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not recorded. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }
  const approve = () => onApprove && !approveBlocked && void run("approved", onApprove);
  const confirmDeny = () =>
    onDeny &&
    !(denyReason === "required" && !reason.trim()) &&
    void run("denied", () => onDeny(reason.trim()));
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === "j" || key === "k") {
      e.preventDefault();
      nextCard(ref.current, key === "j" ? 1 : -1)?.focus();
      return;
    }
    if (decided) return;
    if (key === "a") {
      e.preventDefault();
      if (native) approve();
      else ref.current?.querySelector<HTMLButtonElement>("[data-review-approve]:not(:disabled)")?.click();
    } else if (key === "d") {
      e.preventDefault();
      if (native && onDeny) {
        if (denyReason === "none") confirmDeny();
        else setDenying(true);
      } else ref.current?.querySelector<HTMLButtonElement>("[data-review-deny]:not(:disabled)")?.click();
    }
  }
  useEffect(() => {
    if (denying && denyReason !== "none")
      ref.current?.querySelector<HTMLTextAreaElement>("textarea[data-review-reason]")?.focus();
  }, [denying, denyReason]);
  const age = reviewAge(at);
  const label = `${typeLabel}: ${who}, ${typeof what === "string" ? what : ""}`.replace(/, $/, "");
  return (
    <article
      ref={ref}
      id={id}
      tabIndex={0}
      aria-label={decided ? `${OUTCOME_TEXT[decided.outcome]}: ${label}` : label}
      data-review-card=""
      data-decided={decided ? decided.outcome : undefined}
      className={cn("review-card", decided && "is-decided", className)}
      onKeyDown={onKeyDown}
    >
      {decided ? (
        <p className="review-stub" role="status">
          {decided.outcome === "denied" || decided.outcome === "cancelled" ? (
            <X size={16} aria-hidden="true" />
          ) : (
            <Check size={16} aria-hidden="true" />
          )}
          <strong>
            {OUTCOME_TEXT[decided.outcome]}
            {decided.pending ? " · waiting to send" : ""}
          </strong>
          <span className="review-stub-what">
            {typeLabel} · {who} · {what}
            {copper ? ` · ${formatCopper(copper)}` : ""}
          </span>
          {receiptHref && (
            <AppLink className="review-receipt" href={receiptHref}>
              {receiptLabel}
            </AppLink>
          )}
        </p>
      ) : (
        <header className="review-card-head">
          <span className="review-chip">{typeLabel}</span>
          {age && <small className="review-age">{age}</small>}
          <h3 className="review-who">{who}</h3>
          <p className="review-what">{what}</p>
          {(copper !== undefined || balanceAfter !== undefined) && (
            <p className="review-money">
              {copper !== undefined && (
                <span className={cn("tabular-nums", direction === "in" ? "is-in" : direction === "out" ? "is-out" : "")}>
                  {direction === "in" ? "+" : direction === "out" ? "−" : ""}
                  {formatCopper(copper)}
                </span>
              )}
              {balanceAfter !== undefined && (
                <small className={cn("tabular-nums", balanceAfter < 0 && "is-short")}>
                  Balance after {formatCopper(balanceAfter)}
                  {balanceAfter < 0 ? " · short" : ""}
                </small>
              )}
            </p>
          )}
        </header>
      )}
      {(!decided || keepBody) && children ? <div className="review-card-body">{children}</div> : null}
      {!decided && native && (
        <>
          {denying && denyReason !== "none" && (
            <div className="review-deny" role="group" aria-label={`Deny ${who}`}>
              <label htmlFor={reasonId}>{denyReasonLabel}</label>
              <textarea
                id={reasonId}
                data-review-reason=""
                value={reason}
                maxLength={500}
                rows={2}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setDenying(false);
                    ref.current?.focus();
                  }
                }}
              />
              {reasons.list.length > 0 && (
                <div className="review-saved-reasons" aria-label="Saved reasons">
                  {reasons.list.map((text) => (
                    <span key={text} className="review-saved-reason">
                      <button type="button" onClick={() => setReason(text)}>
                        {text}
                      </button>
                      <button
                        type="button"
                        aria-label={`Forget saved reason: ${text}`}
                        onClick={() => reasons.forget(text)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {denyExtra}
            </div>
          )}
          <div className="review-actions">
            {onApprove && (
              <Button
                disabled={busy || !!approveBlocked}
                onClick={approve}
                data-review-approve=""
              >
                {busy ? "Saving…" : approveLabel}
              </Button>
            )}
            {onDeny &&
              (denying || denyReason === "none" ? (
                <Button
                  variant="secondary"
                  className="review-deny-button"
                  disabled={busy || (denyReason === "required" && !reason.trim())}
                  onClick={confirmDeny}
                  data-review-deny=""
                >
                  {denyLabel}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="review-deny-button"
                  disabled={busy}
                  onClick={() => setDenying(true)}
                  data-review-deny=""
                >
                  {denyLabel}…
                </Button>
              ))}
            {denying && (
              <Button variant="ghost" disabled={busy} onClick={() => setDenying(false)}>
                Cancel
              </Button>
            )}
            {extraActions}
          </div>
          {approveBlocked && <p className="review-blocked">{approveBlocked}</p>}
        </>
      )}
      {error && !decided && (
        <p role="alert" className="review-error">
          {error}
        </p>
      )}
    </article>
  );
}

/** The next (or previous) card in the same list, for J / K and approve-and-next. */
function nextCard(from: HTMLElement | null, step: 1 | -1): HTMLElement | null {
  if (!from) return null;
  const scope = from.closest("[data-review-queue]") ?? document;
  const cards = [...scope.querySelectorAll<HTMLElement>("[data-review-card]")].filter(
    (c) => c.offsetParent !== null || c === from,
  );
  const i = cards.indexOf(from);
  if (i < 0) return null;
  for (let j = i + step; j >= 0 && j < cards.length; j += step)
    if (!cards[j].dataset.decided) return cards[j];
  return null;
}

/* ------------------------------------------------------------------ Saved deny reasons */

const REASONS_KEY = "lootsplit.review.deny-reasons.v1";
const MAX_REASONS = 6;

export type SavedReasons = {
  list: string[];
  remember: (text: string) => void;
  forget: (text: string) => void;
};

function readReasons(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(REASONS_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, MAX_REASONS)
      : [];
  } catch {
    return [];
  }
}
function writeReasons(list: string[]) {
  try {
    localStorage.setItem(REASONS_KEY, JSON.stringify(list));
  } catch {
    // Private windows and blocked storage: reasons simply aren't remembered.
  }
}

/** Deny reasons the DM used before, on this device only (localStorage, newest first). */
export function useSavedReasons(): SavedReasons {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => setList(readReasons()), []);
  return {
    list,
    remember: (text) =>
      setList((current) => {
        const next = [text, ...current.filter((x) => x !== text)].slice(0, MAX_REASONS);
        writeReasons(next);
        return next;
      }),
    forget: (text) =>
      setList((current) => {
        const next = current.filter((x) => x !== text);
        writeReasons(next);
        return next;
      }),
  };
}

/* ------------------------------------------------------------------ Stubs that stay in place */

/**
 * Rows for a list of review cards that keeps decided entries in place as stubs. An entry that
 * leaves `items` (decided here, on another device, or withdrawn) stays as a stub until the screen
 * closes, with the outcome this screen recorded or `vanished(item)` read back from the campaign.
 */
export function useReviewStubs<T>(
  items: T[],
  keyOf: (item: T) => string,
  vanished: (item: T) => ReviewDecision = () => ({ outcome: "resolved" }),
) {
  const [seen, setSeen] = useState<Array<[string, T]>>([]);
  const [marked, setMarked] = useState<Record<string, ReviewDecision>>({});
  const live = new Map(items.map((item) => [keyOf(item), item] as const));
  const known = new Set(seen.map(([k]) => k));
  const fresh = [...live.keys()].filter((k) => !known.has(k));
  let order = seen;
  if (fresh.length) {
    // Derived state: remember new entries during this render, in arrival order.
    order = [...seen, ...fresh.map((k) => [k, live.get(k)!] as [string, T])];
    setSeen(order);
  }
  const rows = order.map(([key, last]) => {
    const item = live.get(key) ?? last;
    const decided = marked[key] ?? (live.has(key) ? undefined : vanished(last));
    return { key, item, decided };
  });
  return {
    rows,
    mark: (key: string, decision: ReviewDecision) => setMarked((m) => ({ ...m, [key]: decision })),
  };
}
