CREATE TABLE bug_reports (
 id TEXT PRIMARY KEY, user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
 request_key TEXT NOT NULL, title TEXT NOT NULL, area TEXT NOT NULL,
 description TEXT NOT NULL, steps TEXT NOT NULL, expected TEXT NOT NULL,
 diagnostics TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','planned','fixed','closed')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 response TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
 last_action TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(user_id, request_key)
);
CREATE INDEX bug_reports_owner_time ON bug_reports(user_id,created_at);
CREATE INDEX bug_reports_status_time ON bug_reports(status,created_at);
CREATE TABLE bug_report_audit (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
 status TEXT NOT NULL, priority TEXT NOT NULL, response TEXT NOT NULL,
 created_at INTEGER NOT NULL, revision INTEGER NOT NULL
);
