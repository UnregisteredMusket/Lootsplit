-- Owner grants are provisioned through the trusted deployment/database operator only.
-- No signup field or public API can grant this role.
CREATE TABLE site_roles (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role = 'owner'),
  granted_at INTEGER NOT NULL
);
CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  update_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO site_settings (id) VALUES (1);
CREATE TABLE site_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL
);
ALTER TABLE site_settings ADD COLUMN donation_url TEXT NOT NULL DEFAULT '';
ALTER TABLE site_settings ADD COLUMN donation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_settings ADD COLUMN donation_update_id TEXT NOT NULL DEFAULT '';
