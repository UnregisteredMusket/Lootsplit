/**
 * The room server functions as the shared-room client uses them (cloud-client.ts), with
 * section-aware sync (tabletop protocol 11, view-sections.ts) applied in one place:
 *
 * - Every room request from a protocol 11 caller carries the section hashes this tab holds for
 *   that seat (`viewSections`).
 * - A sectioned response is assembled before the caller sees it: texts come from the response,
 *   from this tab's cache, or are fetched with `readCloudSections` in batches (progress in
 *   room-loading.ts). Callers always receive a complete room view, exactly as with protocol 10,
 *   so revision handling, conflicts and offline queueing are unchanged.
 * - If the room moved on while sections were fetched, the room is read again (at most three
 *   times), then once as a protocol 10 client, which receives the full view.
 *
 * The cache holds section texts by hash for one seat (room code + seat token), in memory only: it
 * is replaced when the tab uses another seat or campaign, emptied on account changes, and pruned
 * to the sections of the latest view, so it never holds more than one view's sections.
 */
import { noteRollSeq, replyRollSeq, tableDiceWanted, watchRoomRolls } from "../dice/table-dice.ts";
import {
  closeCloudTable as closeServer,
  joinCloudTable as joinServer,
  manageCloudRoom as manageServer,
  nameCloudRoom as nameServer,
  openCloudTable as openServer,
  pollCloudTable as pollServer,
  previewCloudTable,
  pullCloudTable as pullServer,
  readCloudHistory,
  readCloudSections,
  setCloudPace as paceServer,
  skipCloudTurn as skipServer,
  submitCloudCommands as submitServer,
} from "./cloud-api.ts";
import { createRoomSync } from "./room-sync.ts";
import { assertNotPreviewing } from "./player-preview.ts";

export { previewCloudTable, readCloudHistory };

/**
 * The DM's read-only "Preview as player" (player-preview.ts): every room write is refused before
 * any request is sent, whichever screen asks.
 */
function refusedInPreview<A extends unknown[], R>(write: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => {
    try {
      assertNotPreviewing();
    } catch (error) {
      return Promise.reject(error);
    }
    return write(...args);
  };
}
export const closeCloudTable = refusedInPreview(closeServer);
export const joinCloudTable = refusedInPreview(joinServer);
export const openCloudTable = refusedInPreview(openServer);

const sync = createRoomSync({ readSections: readCloudSections, fullRead: pullServer });
export const { clearViewSectionCache } = sync;
if (typeof window !== "undefined")
  window.addEventListener("lootsplit-account-changed", () => clearViewSectionCache());

export const pullCloudTable = sync.roomRead(pullServer);
const pollRoomServer = sync.roomRead(pollServer);
/**
 * The conditional room poll. With 3D dice on, it also asks for the room's latest roll number
 * (the server answers DM seats only, on unchanged and full replies alike) and passes it to
 * table-dice.ts, which throws players' rolls on the DM's screen as they arrive (owner choice
 * 2026-11-06). Every reply is checked: a room that keeps changing (other seats' actions, the DM's
 * own writes) answers in full, and those replies must not hide a roll.
 */
export const pollCloudTable: typeof pollRoomServer = async (args) => {
  const watch = tableDiceWanted();
  if (watch) watchRoomRolls(args.data.code);
  const result = await pollRoomServer(watch ? { ...args, data: { ...args.data, watchRolls: true } } : args);
  if (watch) void noteRollSeq(args.data, replyRollSeq(result));
  return result;
};
export const setCloudPace = refusedInPreview(sync.roomWrite(paceServer));
export const skipCloudTurn = refusedInPreview(sync.roomWrite(skipServer));
export const submitCloudCommands = refusedInPreview(sync.roomWrite(submitServer));
export const nameCloudRoom = refusedInPreview(sync.roomWrite(nameServer));
export const manageCloudRoom = refusedInPreview(sync.roomWrite(manageServer));
