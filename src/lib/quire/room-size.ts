/**
 * Size limits of a shared campaign (sectioned storage step 3, 2026-10-28). Plain constants, shared
 * by the Worker (room writes, restores, the size-refusal log) and the browser (Help, warnings).
 *
 * `ROOM_BODY_LIMIT` caps the assembled stored campaign (after map images, resource packs and
 * archived session snapshots move to their own tables). Sectioned storage (room-storage.mjs) and
 * section-aware sync (view-sections.ts) let it exceed one D1 row; the Worker still reads and
 * projects the whole campaign for each changed room read, so the cap is set by Worker memory:
 * measured (PR "step 3C"), a full read, projection and split of a campaign needs about 14 bytes of
 * transient heap per stored byte, and three concurrent reads of a 4.3 MB campaign fit a 128 MB
 * isolate while three of a 5.1 MB one do not. 4 MB keeps headroom for concurrent players.
 *
 * `ROOM_ROW_LIMIT` caps every single row a room write stores (D1 rejects rows above 2,000,000
 * bytes): one archived session snapshot, and the room row of a sectioned campaign.
 */
export const ROOM_BODY_LIMIT = 4_000_000;
export const ROOM_ROW_LIMIT = 1_800_000;
/** "4 MB": the cap as the app states it to people. */
export const ROOM_LIMIT_TEXT = `${ROOM_BODY_LIMIT / 1_000_000} MB`;
