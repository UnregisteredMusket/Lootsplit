-- Chunked campaign backups (sectioned storage step 3, 2026-10-28). A library backup row is capped
-- by D1's 2 MB row limit, so a shared campaign larger than that could not be deleted with its
-- recovery copy. A large backup keeps a small marker (part count, byte length, SHA-256) and its
-- recovery records in library_backups.body, and the campaign itself here, split into parts of at
-- most 1 MB. Parts are written in the same D1 batch as their backup row (only if it was written),
-- read back and verified byte for byte (cloudflare/backup-parts.mjs), and removed with their
-- backup row (ON DELETE CASCADE, also when the account is deleted).
CREATE TABLE IF NOT EXISTS library_backup_parts (
  backup_id TEXT NOT NULL REFERENCES library_backups(id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (backup_id, part)
);
