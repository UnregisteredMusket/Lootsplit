CREATE TABLE IF NOT EXISTS dm_encounters (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 code TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dm_encounters_owner ON dm_encounters(user_id,updated_at);
CREATE TABLE IF NOT EXISTS dm_encounter_awards (
 encounter_id TEXT PRIMARY KEY REFERENCES dm_encounters(id) ON DELETE CASCADE,
 receipt_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dm_encounter_rolls (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, encounter_id TEXT NOT NULL REFERENCES dm_encounters(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(encounter_id,request_key)
);
