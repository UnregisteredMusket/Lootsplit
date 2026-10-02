ALTER TABLE site_roles RENAME TO site_roles_old;
CREATE TABLE site_roles (user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','admin','moderator')), granted_at INTEGER NOT NULL);
INSERT INTO site_roles SELECT * FROM site_roles_old;
DROP TABLE site_roles_old;
CREATE TABLE member_access (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','banned','revoked')),
 ban_until INTEGER, reason TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
 last_action TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO member_access(user_id) SELECT id FROM user;
CREATE TRIGGER member_access_on_signup AFTER INSERT ON user BEGIN INSERT INTO member_access(user_id) VALUES(new.id); END;
CREATE TABLE member_profiles (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
 introduction TEXT NOT NULL DEFAULT '', portrait TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
 share_contact INTEGER NOT NULL DEFAULT 0, email_opt_in INTEGER NOT NULL DEFAULT 0,
 email_opt_in_at INTEGER, last_online INTEGER, revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE moderation_audit (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
 target_id TEXT REFERENCES user(id) ON DELETE SET NULL, action TEXT NOT NULL,
 reason TEXT NOT NULL, created_at INTEGER NOT NULL, details TEXT NOT NULL DEFAULT ''
);
CREATE INDEX moderation_audit_time ON moderation_audit(created_at);
