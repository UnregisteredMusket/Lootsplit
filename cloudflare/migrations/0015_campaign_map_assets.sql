-- Private account-owned media. Room membership is checked on every read.
CREATE TABLE IF NOT EXISTS campaign_map_assets (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  manifest TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0 AND bytes <= 20000000),
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,id)
);
CREATE INDEX IF NOT EXISTS campaign_map_asset_hash ON campaign_map_assets(owner_id,sha256);
CREATE TABLE IF NOT EXISTS campaign_map_asset_parts (
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  part INTEGER NOT NULL CHECK(part >= 0),
  body TEXT NOT NULL CHECK(length(body) <= 262144),
  PRIMARY KEY(owner_id,asset_id,part),
  FOREIGN KEY(owner_id,asset_id) REFERENCES campaign_map_assets(owner_id,id) ON DELETE CASCADE
);
