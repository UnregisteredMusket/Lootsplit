-- Community profiles and the Looking for Group directory (owner decisions 2026-10-23).
-- Every field is optional; visibility defaults to 'off', so no existing profile becomes visible.
ALTER TABLE member_profiles ADD COLUMN visibility TEXT NOT NULL DEFAULT 'off' CHECK(visibility IN ('off','members','public'));
ALTER TABLE member_profiles ADD COLUMN handle TEXT;
ALTER TABLE member_profiles ADD COLUMN play_role TEXT NOT NULL DEFAULT '' CHECK(play_role IN ('','dm','player','both'));
ALTER TABLE member_profiles ADD COLUMN games TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN time_zone TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN play_times TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN discord TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN lfg TEXT NOT NULL DEFAULT '' CHECK(lfg IN ('','players','group'));
ALTER TABLE member_profiles ADD COLUMN lfg_note TEXT NOT NULL DEFAULT '';
ALTER TABLE member_profiles ADD COLUMN community_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE member_profiles ADD COLUMN community_changed_at INTEGER;
CREATE UNIQUE INDEX member_profiles_handle ON member_profiles(handle);
CREATE INDEX member_profiles_directory ON member_profiles(visibility, community_hidden, community_changed_at);
CREATE TABLE community_reports (
 id TEXT PRIMARY KEY,
 reporter_id TEXT REFERENCES user(id) ON DELETE SET NULL,
 target_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 reason TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 resolved_at INTEGER,
 resolution TEXT NOT NULL DEFAULT ''
);
CREATE INDEX community_reports_open ON community_reports(resolved_at, created_at);
CREATE INDEX community_reports_reporter ON community_reports(reporter_id, created_at);
