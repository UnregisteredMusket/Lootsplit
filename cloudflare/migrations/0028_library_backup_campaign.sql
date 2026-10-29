-- Online backups per campaign (owner decision 2026-10-28). Each account keeps at most
-- CAMPAIGN_BACKUP_LIMIT (src/lib/account/campaign-backups.ts) backups per campaign; a new one
-- replaces that campaign's oldest in the same D1 batch, only after it is fully stored
-- (cloudflare/backup-rotation.mjs). campaign_key names the campaign: 'room:<CODE>' or
-- 'device:<id>'. Older rows keep NULL: a deletion copy is still identified by
-- campaign_deletion_backups.source_code, and an older uploaded backup has no campaign and never
-- rotates. Nothing existing is changed or removed.
ALTER TABLE library_backups ADD COLUMN campaign_key TEXT;
CREATE INDEX IF NOT EXISTS library_backups_campaign ON library_backups(user_id,campaign_key,created_at);
