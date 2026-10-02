CREATE TABLE play_characters (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 body TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
 campaign_code TEXT NOT NULL DEFAULT '',purse_id TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL
);
CREATE INDEX play_characters_owner ON play_characters(user_id,updated_at);
CREATE UNIQUE INDEX play_character_assignment ON play_characters(campaign_code,purse_id) WHERE campaign_code<>'';
CREATE TABLE play_policies (code TEXT PRIMARY KEY,manual_allowed INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
CREATE TABLE play_rolls (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
 character_id TEXT NOT NULL,code TEXT NOT NULL DEFAULT '',request_key TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(user_id,request_key)
);
CREATE INDEX play_rolls_campaign ON play_rolls(code,seq);
CREATE INDEX play_rolls_character ON play_rolls(character_id,seq);
