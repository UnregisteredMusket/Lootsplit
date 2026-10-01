CREATE TABLE IF NOT EXISTS campaign_rooms (
  code text PRIMARY KEY NOT NULL,
  revision integer NOT NULL,
  body text NOT NULL
);
