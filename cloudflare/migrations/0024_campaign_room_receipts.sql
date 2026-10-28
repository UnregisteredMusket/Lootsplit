-- Command and batch receipts for shared rooms (live-campaign load audit F1, 2026-10-28). They make
-- every action idempotent forever, so they are never pruned; moving them out of the room body stops
-- them counting toward the 1.8 MB room budget. Rooms written before this move their body receipts
-- here on their next write, in the same transaction (room-store.server.ts).
CREATE TABLE IF NOT EXISTS campaign_room_receipts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('command', 'batch')),
  key TEXT NOT NULL,
  hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_room_receipts_key ON campaign_room_receipts(code, kind, key);
CREATE INDEX IF NOT EXISTS campaign_room_receipts_recent ON campaign_room_receipts(code, seat_id, kind, seq);
-- A fresh id per room write: statements in the same batch commit only alongside that write.
ALTER TABLE campaign_rooms ADD COLUMN write_id TEXT;
