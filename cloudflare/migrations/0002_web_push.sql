CREATE TABLE IF NOT EXISTS push_config (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT NOT NULL,
  room_code TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  last_sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (endpoint, room_code, seat_id),
  FOREIGN KEY (room_code) REFERENCES campaign_rooms(code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS push_room ON push_subscriptions(room_code);
