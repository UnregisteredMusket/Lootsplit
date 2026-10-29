/**
 * Size limits of a shared campaign. Plain constants, shared by the Worker (room writes, restores,
 * the size-refusal log) and the browser (Help, warnings).
 *
 * Since history on demand (step 4, 2026-10-29) a campaign has three sizes, measured on its stored
 * form (after map images, resource packs and archived session snapshots move to their own tables):
 *
 * - **Working set** (`ROOM_BODY_LIMIT`): what every room read loads and projects for current
 *   clients: everything except sealed history pages (older ledger and chat lines) and archived
 *   session snapshots. Set by Worker memory: a changed-room read needs about 14 bytes of transient
 *   heap per working-set byte, and several players' reads can share one 128 MB isolate.
 * - **Live campaign** (`ROOM_LIVE_LIMIT`): the working set plus the sealed history pages of the
 *   current ledger and chat. A command that has to look at older lines (voiding one, ending a
 *   session, some idempotency checks) loads this, and so do older apps' complete views, exports
 *   and backups.
 * - **Total** (`ROOM_TOTAL_LIMIT`): the live campaign plus every archived session snapshot. A room
 *   read never loads it, but whole-campaign operations do: Download a copy and other exports,
 *   deletion copies, account records, older apps' complete views, and commands that read archived
 *   sessions (Undo of an archived line, favour, quest reward links). The cap is the largest total
 *   at which each of those still fits comfortably in a 128 MB Worker isolate (two at once fit;
 *   measured with scripts/room-memory-measure.mjs, asserted by scripts/room-memory-cap.test.mjs),
 *   so no campaign can grow to where its own export or Undo fails. Checked when a session is
 *   archived (the only write that adds to the archive). Raising it needs streaming exports and
 *   whole-campaign reads first.
 *
 * `ROOM_ROW_LIMIT` caps every single D1 row a room write stores (D1 rejects rows above 2,000,000
 * bytes): the room row of a sectioned campaign. Section parts, history pages and archived
 * sessions are stored in parts of at most 1 MB.
 */
export const ROOM_BODY_LIMIT = 4_000_000;
export const ROOM_LIVE_LIMIT = 4_000_000;
export const ROOM_TOTAL_LIMIT = 5_000_000;
export const ROOM_ROW_LIMIT = 1_800_000;
const mb = (bytes: number) => `${bytes / 1_000_000} MB`;
/** "4 MB": the working-set cap as the app states it to people. */
export const ROOM_LIMIT_TEXT = mb(ROOM_BODY_LIMIT);
/** The live campaign cap as the app states it. */
export const ROOM_LIVE_LIMIT_TEXT = mb(ROOM_LIVE_LIMIT);
/** The total storage cap as the app states it. */
export const ROOM_TOTAL_LIMIT_TEXT = mb(ROOM_TOTAL_LIMIT);
/**
 * The start of the message a session archive refused by `ROOM_TOTAL_LIMIT` carries, so the
 * browser can offer Download a copy next to it.
 */
export const ROOM_TOTAL_REFUSAL = "This campaign has reached its online storage limit";
