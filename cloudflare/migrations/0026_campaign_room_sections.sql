-- Sectioned shared-room storage (owner plan 2026-10-28, step 2b). A room whose stored body would
-- exceed the inline threshold (cloudflare/room-storage.mjs) keeps only its small top-level fields
-- and a manifest in campaign_rooms.body; the large parts of the campaign (table, ledger, messages,
-- archived report references, maps, the test template...) are stored here, content-addressed per
-- room by a SHA-256 hash and split into parts of at most about 1 MB. Rows are immutable: a write
-- inserts only sections whose hash is new, in the same D1 batch as the room write and guarded by
-- its write_id, and deletes the room's rows that its new manifest no longer references. Only the
-- storage module reads or writes this table (scripts/room-storage-guard.test.mjs).
CREATE TABLE IF NOT EXISTS campaign_room_sections (
  code TEXT NOT NULL,
  hash TEXT NOT NULL,
  part INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (code, hash, part)
);
