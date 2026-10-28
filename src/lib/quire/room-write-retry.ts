/**
 * Bounded, jittered retries for shared-room writes (live-campaign load audit F2 and F11, 2026-10-28).
 *
 * A room write is a read, a change and a revision-guarded `updateRoom`. When two people act at the
 * same moment, one guard fails with "The table changed". Each attempt here re-runs the whole write
 * on a fresh read, so the caller's permission and validation checks are evaluated again on the room
 * as it is now. Only that revision conflict is retried; every other error is thrown at once.
 *
 * Immediate retries collided again under load (six simultaneous actions failed one in four runs), so
 * attempts are spread by a random, growing pause.
 */

/** Attempts per write, the first included. */
export const ROOM_WRITE_ATTEMPTS = 5;

/** The message `updateRoom` throws when another write changed the room first. */
export function isRoomConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("table changed");
}

/**
 * Milliseconds to wait after failed attempt `attempt` (0-based): 20 to 150 ms after the first
 * conflict, with a ceiling that grows by 130 ms per further conflict (at most 540 ms).
 */
export function roomWriteDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = 130 * (Math.min(Math.max(attempt, 0), ROOM_WRITE_ATTEMPTS - 2) + 1);
  return Math.round(20 + random() * ceiling);
}

type Pause = (attempt: number) => Promise<void>;
const sleep: Pause = (attempt) =>
  new Promise((resolve) => setTimeout(resolve, roomWriteDelay(attempt)));
let pause: Pause = sleep;

/** Tests only: replace the pause between attempts (pass nothing to restore the default). */
export function setRoomWritePause(next?: Pause) {
  pause = next ?? sleep;
}

/**
 * Runs `write` until it succeeds, throws anything other than a revision conflict, or has failed
 * `ROOM_WRITE_ATTEMPTS` times (the last conflict is then thrown). `write` must read the room itself.
 */
export async function retryRoomWrite<T>(write: (attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write(attempt);
    } catch (error) {
      if (attempt >= ROOM_WRITE_ATTEMPTS - 1 || !isRoomConflict(error)) throw error;
    }
    await pause(attempt);
  }
}
