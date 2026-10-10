CREATE TABLE campaign_resource_documents (
  code TEXT NOT NULL REFERENCES campaign_rooms(code) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(code, reference)
);
