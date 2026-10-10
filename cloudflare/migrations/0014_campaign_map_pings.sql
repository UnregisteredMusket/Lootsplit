-- Transient map signals are separate from campaigns, financial history and backups.
CREATE TABLE IF NOT EXISTS campaign_map_pings (
  code TEXT NOT NULL REFERENCES campaign_rooms(code) ON DELETE CASCADE,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (code, id)
);
CREATE INDEX IF NOT EXISTS campaign_map_pings_expiry ON campaign_map_pings(expires_at);
