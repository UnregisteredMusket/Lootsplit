/**
 * Players' rolls on the DM's screen (owner choice 2026-11-06: the roller, the DM and the TV
 * display see a roll). With 3D dice on, the room poll asks for the latest roll number
 * (`watchRolls`; the server answers DM seats only). When it moves, the new rolls are read (DM
 * seats only, `readRoomRolls`) and the newest is thrown, if it was recorded after this screen
 * started watching the room: opening a campaign never replays old rolls, and a roll made just
 * before the first answer still counts.
 */
import { readRoomRolls } from "../quire/cloud-api.ts";
import { showDice, type DiceRoll } from "./dice-events.ts";

/** How far back a roll may be and still be thrown when a screen starts watching (ms). */
const START_GRACE_MS = 5000;
let room = "";
let since = 0;
let last: number | undefined;
/** When the read in flight started (0 when none). A read that never answers stops blocking after READ_TIMEOUT_MS. */
let readingSince = 0;
const READ_TIMEOUT_MS = 10000;
type RollReader = (args: {
  data: { tabletopProtocol: number; code: string; token: string; after: number };
}) => Promise<{ rolls: { seq: number; roll: DiceRoll & { at: number } }[]; rollSeq: number }>;

/** The device's "Show 3D dice" setting, read without the settings provider (default on). */
export function tableDiceWanted(): boolean {
  try {
    const prefs = JSON.parse(localStorage.getItem("quire.prefs.v1") || "{}");
    return prefs?.diceAnimation !== false;
  } catch {
    return true;
  }
}

export async function noteRollSeq(
  seat: { code: string; token: string },
  seq: number | undefined,
  now = Date.now(),
  read: RollReader = readRoomRolls,
) {
  if (typeof seq !== "number") return;
  if (room !== seat.code) {
    room = seat.code;
    since = now - START_GRACE_MS;
    // Look back over the last few rolls; only those recorded since watching began are thrown.
    last = Math.max(0, seq - 10);
  }
  if (last === undefined || seq <= last) return;
  // One read at a time; a read that hangs (a stalled request) must not stop every later roll.
  if (readingSince && now - readingSince < READ_TIMEOUT_MS) return;
  const started = (readingSince = now);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      read({ data: { tabletopProtocol: 31, code: seat.code, token: seat.token, after: last } }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error("timed out")), READ_TIMEOUT_MS);
      }),
    ]);
    if (room !== seat.code) return;
    last = Math.max(last, result.rollSeq);
    const newest = result.rolls.at(-1)?.roll;
    if (newest && newest.at >= since) showDice(newest as DiceRoll, "table");
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
  since = 0;
  last = undefined;
  readingSince = 0;
}
