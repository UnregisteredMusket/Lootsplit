-- Additive only (Field monitor widget redesign, owner-approved 2026-10-25). "Live rooms" are shared
-- rooms whose stored revision changed in the last 5 minutes. The minute monitor cron records each
-- room's revision here by row id; no room code or body is copied and the room tables and their
-- write path are unchanged. Row 0 is the tracker's own run record (first and latest run).
CREATE TABLE owner_monitor_room_activity (room INTEGER PRIMARY KEY, revision INTEGER NOT NULL, changed_at INTEGER, first_seen_at INTEGER NOT NULL);
CREATE INDEX owner_monitor_room_activity_changed ON owner_monitor_room_activity(changed_at);
