-- Game statistics as running totals (footprint rules, owner decision 2026-11-01). Site game
-- statistics (cloudflare/game-analytics.mjs) used to reread every shared campaign's ledger, funds,
-- holdings and journal, including archived sessions, on every collection; on a cold Worker that took
-- seconds (a 9.4 s owner widget refresh on 2026-10-30). Each campaign's own figures are cached here
-- with the campaign revision they were counted at: a collection compares stored revisions and
-- recounts only campaigns that changed. Rows are derived and disposable: rows of campaigns that no
-- longer count (deleted, test mode, probes) are removed by the next collection, and a row with an
-- older analytics version or unreadable figures is simply recounted.
CREATE TABLE IF NOT EXISTS game_analytics_cache (
  code TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  analytics_version INTEGER NOT NULL,
  metrics TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
