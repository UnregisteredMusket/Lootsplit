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
import {
  closeCloudTable,
  joinCloudTable,
  manageCloudRoom as manageServer,
  nameCloudRoom as nameServer,
  openCloudTable,
  pollCloudTable as pollServer,
  previewCloudTable,
  pullCloudTable as pullServer,
  readCloudSections,
  setCloudPace as paceServer,
  skipCloudTurn as skipServer,
  submitCloudCommands as submitServer,
} from "./cloud-api.ts";
import { createRoomSync } from "./room-sync.ts";

export { closeCloudTable, joinCloudTable, openCloudTable, previewCloudTable };

const sync = createRoomSync({ readSections: readCloudSections, fullRead: pullServer });
export const { clearViewSectionCache } = sync;
if (typeof window !== "undefined")
  window.addEventListener("lootsplit-account-changed", () => clearViewSectionCache());

export const pullCloudTable = sync.roomRead(pullServer);
export const pollCloudTable = sync.roomRead(pollServer);
export const setCloudPace = sync.roomWrite(paceServer);
export const skipCloudTurn = sync.roomWrite(skipServer);
export const submitCloudCommands = sync.roomWrite(submitServer);
export const nameCloudRoom = sync.roomWrite(nameServer);
export const manageCloudRoom = sync.roomWrite(manageServer);
