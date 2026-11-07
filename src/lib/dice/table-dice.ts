/**
 * Players' rolls on the DM's screen (owner choice 2026-11-06: the roller, the DM and the TV
 * display see a roll). With 3D dice on, every room poll asks for the latest roll number
 * (`watchRolls`; the server answers DM seats only, on unchanged and full replies alike). When it
 * moves, the new rolls are read (DM seats only, `readRoomRolls`) and the newest is thrown.
 *
 * Opening a campaign never replays old rolls: the first read after this screen starts watching a
 * room (the baseline) throws only a roll recorded since watching began, with a short grace, and
 * measured on the server's clock (the read reports the server's time), so a device clock that
 * runs fast or slow neither drops new rolls nor replays old ones. Every later read only returns
 * rolls recorded after the baseline, so its newest roll is always new and is thrown.
 */
import { readRoomRolls } from "../quire/cloud-api.ts";
import { showDice, type DiceRoll } from "./dice-events.ts";

/** How far back a roll may be and still be thrown when a screen starts watching (ms). */
const START_GRACE_MS = 5000;
let room = "";
/** When this screen started watching `room` (device clock, ms). */
let watchedAt = 0;
let last: number | undefined;
/** The baseline read (the first after watching began) has not succeeded yet. */
let baseline = true;
/** When the read in flight started (0 when none). A read that never answers stops blocking after READ_TIMEOUT_MS. */
let readingSince = 0;
const READ_TIMEOUT_MS = 10000;
type RollReader = (args: {
  data: { tabletopProtocol: number; code: string; token: string; after: number };
}) => Promise<{
  rolls: { seq: number; roll: DiceRoll & { at: number } }[];
  rollSeq: number;
  /** The server's clock when it read (ms); absent from older servers. */
  now?: number;
}>;

/** The device's "Show 3D dice" setting, read without the settings provider (default on). */
export function tableDiceWanted(): boolean {
  try {
    const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
    return prefs?.diceAnimation !== false;
  } catch {
    return true;
  }
}

/**
 * This screen asks a room for its rolls (called before each poll is sent). The first call for a
 * room marks when watching began, so a roll made before the first answer arrives still counts,
 * however long that answer takes.
 */
export function watchRoomRolls(code: string, now = Date.now()) {
  if (room === code) return;
  room = code;
  watchedAt = now;
  last = undefined;
  baseline = true;
  readingSince = 0;
}

/** The latest roll number a poll reply carries, whichever kind (unchanged or full) it is. */
export function replyRollSeq(reply: unknown): number | undefined {
  const seq = reply && typeof reply === "object" ? (reply as { rollSeq?: unknown }).rollSeq : undefined;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}

export async function noteRollSeq(
  seat: { code: string; token: string },
  seq: number | undefined,
  now = Date.now(),
  read: RollReader = readRoomRolls,
) {
  if (typeof seq !== "number") return;
  watchRoomRolls(seat.code, now);
  // Look back over the last few rolls; only those recorded since watching began are thrown.
  if (last === undefined) last = Math.max(0, seq - 10);
  if (seq <= last) {
    // Nothing to read: every later roll is new to this screen.
    if (baseline && seq === 0) baseline = false;
    return;
  }
  // One read at a time; a read that hangs (a stalled request) must not stop every later roll.
  if (readingSince && now - readingSince < READ_TIMEOUT_MS) return;
  const started = (readingSince = now);
  const watching = watchedAt;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      read({ data: { tabletopProtocol: 31, code: seat.code, token: seat.token, after: last } }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error("timed out")), READ_TIMEOUT_MS);
      }),
    ]);
    if (room !== seat.code || watchedAt !== watching) return;
    last = Math.max(last ?? 0, result.rollSeq);
    const newest = result.rolls.at(-1)?.roll;
    let fresh = !!newest;
    if (newest && baseline) {
      // Watching began `now - watching` ms ago on this device; on the server's clock that is
      // `result.now - (now - watching)`. Older servers send no time: the device clock is used.
      const serverNow = typeof result.now === "number" ? result.now : now;
      fresh = newest.at >= serverNow - (now - watching) - START_GRACE_MS;
    }
    baseline = false;
    if (newest && fresh) showDice(newest as DiceRoll, "table");
  } catch {
    // Dice are a courtesy: a failed read leaves the roll logs as the record.
  } finally {
    clearTimeout(timeout);
    if (readingSince === started) readingSince = 0;
  }
}

/** For tests: forget the room. */
export function resetTableDice() {
  room = "";
  watchedAt = 0;
  last = undefined;
  baseline = true;
  readingSince = 0;
}
