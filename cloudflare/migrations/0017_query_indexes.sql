-- Additive indexes only; no table or data changes (2026-10-21 audit B02/M06).
-- Campaign character lookups by campaign_code (the existing index is partial, so a bound
-- parameter cannot use it).
CREATE INDEX IF NOT EXISTS play_characters_campaign ON play_characters(campaign_code);
-- Moderation and bug-report history read one target's audit trail in order.
CREATE INDEX IF NOT EXISTS moderation_audit_target ON moderation_audit(target_id, created_at);
CREATE INDEX IF NOT EXISTS bug_report_audit_report ON bug_report_audit(report_id, revision);
-- The late-log trigger finds reports whose window ends after an observation. Indexing the
-- window end lets each log insert read only recent reports instead of scanning every report.
CREATE INDEX IF NOT EXISTS owner_monitor_reports_window_end ON owner_monitor_reports(json_extract(body,'$.end'));
