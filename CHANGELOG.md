# Lootsplit changelog

## Cloudflare Workers deployment

- Added `cloudflare/worker.mjs`, Wrangler config, and a D1 migration for `campaign_rooms`.
- Shared rooms on Cloudflare use the `DB` binding and the existing revision check. A Worker without that binding does not write room data to local files or memory.
- Device backups are unchanged. `npm run dev` still uses the local file store when D1 is absent.
- `database_id` is left unset on purpose. See CLOUDFLARE.md.

## 1.1.1 — October 1, 2026

- Replaced the Google Drive section with one Device backups section, reusing existing named snapshots and file import/export. Removed the obsolete app-specific Drive upload endpoints and helpers.
- Added Download backup for a current campaign file, with the same password protection and a named browser copy.
- Shared backups refresh first and reject unresolved personal drafts; pending-action recovery remains separate. Load is disabled while connected so a device restore cannot overwrite a shared room. Player backups contain only their accessible data.
- Exposed device backups in player navigation without exposing DM settings; full campaign restoration remains a DM action in Local Mode.
- Routed the Home download through the same shared-state checks. Updated help and separated local diagnostic reports from backups.
- Corrected encrypted backup password migration so restoring a migrated backup retains the new campaign password. Existing files already downloaded are unchanged.
- Reviewed online enhancement options without implementing external integrations. See ONLINE_OPTIONS.md.


### 1.1.1 validation

64 app tests passed (the two retired Drive-helper tests were removed with that integration). TypeScript and production build passed. Browser checks verified encrypted download and restore after password change, pending-turn backup rejection, settled Turn-based player export, Live DM export, local persistence, and mobile/desktop navigation.


## 1.1.0 — October 1, 2026

### Shared gameplay

- Replaced client-submitted campaign snapshots with server-validated operations for purchases, sales, transfers, listings, loans, messages, and character edits.
- Added revision-safe writes, duplicate-command protection, and atomic turn submissions. The server checks prices, stock, funds, ownership, and turn permissions.
- Preserve turn drafts across reloads and restore staged server drafts. Replay queued actions over new shared state instead of silently losing edits.
- Added sync status, errors, retry, pending-action export/import, discard confirmation, and disconnect recovery.
- Keep chat usable outside the financial turn without ending a turn or clearing its draft.
- Block mode changes, skipping, and room closure when server-known drafts need attention.
- Added DM controls for party-fund access, releasing a character, and choosing the current participant.
- Allow joining an existing room from the initial DM screen. Restrict role switches, campaign replacement, and incompatible player-file workflows while connected.
- Preserve unrelated concurrent DM edits with record-level conflict checking.

### Local gameplay and backups

- Added baseline checking to player activity reports so conflicting balances, inventory, or stock reject the entire import.
- Apply accepted activity reports in one IndexedDB transaction and make repeated imports idempotent.
- Preserve report baselines and pending transfer/sale records in backups; copying a report no longer erases its evidence.
- Require confirmation before restoring a saved backup and enforce password checks on protected export/restore paths.
- Use PBKDF2-SHA-256 with 210,000 iterations for newly protected passwords/backups and AES-GCM for encrypted files. Retain legacy decryption support.
- Re-encrypt stored backups on password change with rollback on ordinary failure. Refresh the selected backup before export/load so stale UI state cannot select its old ciphertext.
- Allow a separate backup-file password when importing/restoring a file protected with a different password.

### Interface and instructions

- Clarified how Local, Turn-based, and Live modes actually exchange data and when a player must submit or request a fresh copy.
- Added mode-appropriate controls, pending counts, permission messaging, and safer confirmation wording.
- Corrected awkward or inaccurate labels, including an accidental inventory label corruption.
- Replaced unsupported Google Drive controls with an honest availability message and working diagnostic-report download.
- Remove query strings and URL fragments from diagnostic page locations.

### Verification

- Added 19 app regression tests, bringing the app suite to 66 passing tests.
- Complete automated suite: 312 passed, zero failed, four tooling-documentation skips.
- Production build and TypeScript passed; lint has zero errors and nine Fast Refresh warnings.
- Dependency audit: zero known vulnerabilities reported.
- Browser checks cover local persistence, all main routes at mobile/desktop sizes, staged-turn reload and submission, live purchase synchronization, chat, closed-room recovery, and encrypted backup password change/export/restore.

See AUDIT.md for prioritized remaining limitations, configuration needs, and verification gaps.
