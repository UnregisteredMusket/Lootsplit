-- Archived session snapshots, moved out of campaign_rooms.body so the room row stays bounded.
-- Content-addressed per room (reference = "session-report:" + SHA-256 of the snapshot JSON);
-- rows are immutable and written only in the same atomic batch as the room revision that
-- references them (cloudflare/room-reports.mjs).
CREATE TABLE campaign_room_reports (
  code TEXT NOT NULL REFERENCES campaign_rooms(code) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(code, reference)
);
