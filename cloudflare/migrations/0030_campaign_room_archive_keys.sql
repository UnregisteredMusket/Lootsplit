-- Lookup keys of archived sessions (storage follow-up, part 3, 2026-10-29). A command that reads
-- archived sessions (Undo of an archived ledger line, linking a quest reward to an archived
-- receipt) used to load every archived session of the campaign. Each archived session's snapshot
-- (campaign_room_reports, 0019) is indexed here by the keys those commands look up: its ledger line
-- IDs ("id:"), the lines they reverse ("rev:"), whether any line summary names a void ("void"),
-- trade and award receipt IDs ("trade:", "award:") and treasure-pool resolutions ("loot:"), plus
-- "*" once a snapshot is completely indexed. The server then loads only the sessions that can
-- matter (cloudflare/archive-keys.mjs); a session without "*" (archived before this table, or
-- unreadable) makes it load every session, as before. Keys are derived from immutable snapshots:
-- written in the same D1 batch as the report (only if that room write committed) or, for older
-- reports, after a command has read them; removed only with the room (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS campaign_room_archive_keys (
  code TEXT NOT NULL REFERENCES campaign_rooms(code) ON DELETE CASCADE,
  key TEXT NOT NULL,
  reference TEXT NOT NULL,
  PRIMARY KEY (code, key, reference)
);
