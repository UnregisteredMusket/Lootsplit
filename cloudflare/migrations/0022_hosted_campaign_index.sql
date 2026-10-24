-- Additive index only; no table or data changes (online campaign limit, owner decision 2026-10-24).
-- Counts the live (not closed) shared rooms an account hosts, read from the index alone, so the
-- hosting guard in cloudflare/hosted-campaigns.mjs never scans room bodies. Rooms without an
-- owner (guest-era rooms, monitor probes) are not in the index's useful range.
CREATE INDEX IF NOT EXISTS campaign_rooms_live_owner ON campaign_rooms(json_extract(body,'$.ownerId')) WHERE json_extract(body,'$.closed') IS NOT 1;
