/**
 * History on demand (sectioned storage step 4, owner decision 2026-10-28/29: "I don't want to keep
 * fighting storage issues"). Shared by the Worker and the browser.
 *
 * A shared room's long, append-only history is not loaded or projected on every read:
 * - the live ledger and the chat are stored in immutable pages of `ROOM_HISTORY_PAGE_ITEMS` items
 *   (cloudflare/room-storage.mjs); a read for a current client loads only the newest one to two
 *   pages of each (the working window);
 * - archived session snapshots are not read at all: the report keeps its id, name, time and seats.
 *
 * Clients from `HISTORY_PROTOCOL` on receive that working view and fetch earlier pages and archived
 * sessions when someone opens them (`readCloudHistory`), projected for their seat by the same rules
 * as the room view. Older clients receive the complete view, as before.
 */

/** Tabletop protocol of clients that load history on demand. */
export const HISTORY_PROTOCOL = 12;

/** The paged lists, by the name the history endpoint uses. */
export const HISTORY_LISTS = ["ledger", "notes"] as const;
export type HistoryList = (typeof HISTORY_LISTS)[number];

/**
 * A room read that skips archived sessions gives each report this marker instead of its snapshot
 * JSON (room-reports.mjs). It is not JSON, so it can never be read as a campaign; the write path
 * turns it back into the stored reference. Never sent to a client.
 */
export const DEFERRED_REPORT_PREFIX = "\u0000lootsplit-deferred-report:";
export function isDeferredSnapshot(snapshot: unknown): boolean {
  return typeof snapshot === "string" && snapshot.startsWith(DEFERRED_REPORT_PREFIX);
}

/**
 * Where a view's paged lists continue (`RoomView.history`): an opaque cursor per list, salted for
 * the seat, naming the newest page the client does not hold; absent when it holds the whole list.
 * A cursor says nothing about how many lines exist or whose they are.
 */
export type HistoryCursors = Partial<Record<HistoryList, string>>;
