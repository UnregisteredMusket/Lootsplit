-- Server-produced deletion backups are distinguished from uploaded device copies.
CREATE TABLE campaign_deletion_backups (
 backup_id TEXT PRIMARY KEY REFERENCES library_backups(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 source_code TEXT NOT NULL
);
-- Historical proposals/assignments remain readable without reviving revoked seats.
-- The restore receipt also prevents repeating a committed restore after a lost reply.
CREATE TABLE campaign_recoveries (
 id TEXT PRIMARY KEY,
 backup_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL,
 code TEXT NOT NULL UNIQUE,
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,backup_id,request_key)
);
