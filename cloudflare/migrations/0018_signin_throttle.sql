-- Per-account sign-in throttling (2026-10-21 audit S05; owner decision 2026-10-22: slow down,
-- don't lock). One row per normalized email address that recently had a failed sign-in,
-- keyed by its SHA-256 so the table holds no addresses. Rows exist for any email that was
-- tried, registered or not, so they reveal nothing about which accounts exist. This is
-- rate-limit state, not history: a successful sign-in deletes the row and stale rows expire.
CREATE TABLE IF NOT EXISTS signin_throttle (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_throttle_last_attempt ON signin_throttle(last_attempt_at);
