CREATE TABLE character_imports (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 character_id TEXT NOT NULL,
 code TEXT NOT NULL,
 purse_id TEXT NOT NULL,
 source_revision INTEGER NOT NULL,
 target_revision INTEGER NOT NULL,
 seat_id TEXT NOT NULL,
 seat_token TEXT NOT NULL,
 session_id TEXT NOT NULL,
 body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','denied')),
 created_at INTEGER NOT NULL,
 reviewed_at INTEGER,
 reviewed_by TEXT
);
CREATE INDEX character_imports_campaign ON character_imports(code,status,created_at);
CREATE INDEX character_imports_owner ON character_imports(user_id,created_at);
CREATE UNIQUE INDEX character_imports_pending ON character_imports(user_id,code,purse_id) WHERE status='pending';
