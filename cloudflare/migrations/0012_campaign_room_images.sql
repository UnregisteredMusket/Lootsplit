-- Additive, campaign-private deduplicated raster storage. Room CAS + asset inserts share a batch.
CREATE TABLE IF NOT EXISTS campaign_room_images (
  code TEXT NOT NULL,
  reference TEXT NOT NULL,
  image TEXT NOT NULL,
  PRIMARY KEY (code, reference)
);
