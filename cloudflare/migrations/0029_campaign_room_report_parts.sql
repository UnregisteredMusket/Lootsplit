-- Archived sessions in parts (history on demand, step 4, 2026-10-29). An archived session snapshot
-- (campaign_room_reports, 0019) is one D1 row, capped at 2 MB, so a session whose live ledger and
-- chat had grown past that could not be ended. A larger snapshot keeps a small marker in its
-- campaign_room_reports row ({"$reportParts":{parts,bytes,reference}}) and its JSON here, in parts
-- of at most 1 MB split on character boundaries. Parts are written in the same D1 batch as the room
-- revision that references the report (only if it committed), joined and checked against the
-- report's SHA-256 reference when read (cloudflare/room-reports.mjs), immutable, and removed with
-- their report row (ON DELETE CASCADE, which follows the room's deletion).
CREATE TABLE IF NOT EXISTS campaign_room_report_parts (
  code TEXT NOT NULL,
  reference TEXT NOT NULL,
  part INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (code, reference, part),
  FOREIGN KEY (code, reference) REFERENCES campaign_room_reports(code, reference) ON DELETE CASCADE
);
-- The IDs of the ledger lines in a room's sealed history pages (step 4), so a command run on the
-- newest lines can confirm that the lines it adds have IDs no older line has, without loading the
-- history. Written in the same batch as the page (only if that room write committed), removed
-- with the page (the room write's cleanup) or with the room.
CREATE TABLE IF NOT EXISTS campaign_room_history_ids (
  code TEXT NOT NULL REFERENCES campaign_rooms(code) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (code, hash, id)
);
CREATE INDEX IF NOT EXISTS campaign_room_history_ids_by_id ON campaign_room_history_ids (code, id);
