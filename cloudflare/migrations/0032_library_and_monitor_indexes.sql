-- Indexes only (audit 2026-11-10 F1, F3, F11). No rows change; monitoring history stays in full.
-- F1: one account's character library (newest first) and the save's per-account limits.
CREATE INDEX IF NOT EXISTS library_characters_owner ON library_characters(user_id,updated_at);
-- F3: the minute cron's interrupted-collection and history-recovery reads see only intervals that
-- are not complete; the queries repeat the predicate so SQLite can use this partial index.
CREATE INDEX IF NOT EXISTS owner_monitor_intervals_open ON owner_monitor_intervals(slot) WHERE outcome<>'complete';
-- F11: the latest daily report per timezone, the last day of site audit events, members online.
CREATE INDEX IF NOT EXISTS owner_monitor_reports_timezone_day ON owner_monitor_reports(timezone,day);
CREATE INDEX IF NOT EXISTS site_audit_created ON site_audit(created_at,id);
CREATE INDEX IF NOT EXISTS member_profiles_last_online ON member_profiles(last_online);
