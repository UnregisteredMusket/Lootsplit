-- Every room poll and view asks whether the campaign has an active encounter
-- (cloud.server.ts activeEncounter: code + status). Without this index SQLite scanned every
-- encounter on the site each time (live-campaign load audit F5, 2026-10-28).
CREATE INDEX IF NOT EXISTS dm_encounters_code_status ON dm_encounters(code, status);
