/**
 * Per-seat budget for room submits (committed and staged batches, messages included). Two token
 * buckets live in the room row (`CloudRoom.submitAllowance`), so the limit is exact under the
 * room's revision check and costs no extra storage call. A refused submit writes nothing.
 *
 * Retries of an already committed batch are answered before this check and never count.
 * Only message text a batch adds for the first time counts against `messageChars`: staged
 * messages are counted once, when staged, not again on every re-stage or on commit.
 *
 * Capacities are sized so legitimate play is never refused: a burst of 120 batches (one per
 * action, well above what a person clicks or CI audits submit) and one full batch of 100
 * maximum-length (500-character) messages always fit. The buckets refill continuously: 30 batches
 * and 3,000 message characters a minute per seat, well above sustained play and typing.
 */
export const ROOM_SUBMIT_LIMITS = {
  batches: { capacity: 120, perSecond: 0.5 },
  messageChars: { capacity: 60_000, perSecond: 50 },
};
export type SubmitAllowance = { batches: number; chars: number; at: number };
type Limits = typeof ROOM_SUBMIT_LIMITS;

/** Returns the seat's remaining allowance after this submit, or null when it must be refused. */
export function takeSubmitAllowance(
  previous: SubmitAllowance | undefined,
  now: number,
  messageChars: number,
  limits: Limits = ROOM_SUBMIT_LIMITS,
): SubmitAllowance | null {
  const elapsed = previous ? Math.max(0, now - previous.at) / 1000 : Infinity;
  const fill = (stored: number | undefined, bucket: { capacity: number; perSecond: number }) =>
    Math.min(
      bucket.capacity,
      (Number.isFinite(stored) ? (stored as number) : bucket.capacity) +
        (Number.isFinite(elapsed) ? elapsed * bucket.perSecond : bucket.capacity),
    );
  const batches = fill(previous?.batches, limits.batches);
  const chars = fill(previous?.chars, limits.messageChars);
  if (batches < 1 || chars < messageChars) return null;
  return { batches: batches - 1, chars: chars - messageChars, at: now };
}

export const SUBMIT_LIMIT_MESSAGE =
  "You are sending changes too quickly. Wait a minute and try again; your pending actions are preserved.";
