# Account campaign reopening and recovery

Sign in to the same Lootsplit account on another device, then choose the campaign in the startup chooser or My account → My campaigns. Resume loads the server-saved campaign; Reopen as DM starts a fresh session for an ended campaign. Existing player invitations remain revoked after reopening. Names do not identify a shared room; different room codes remain separate campaigns.

## Unsynced device work

Already-accepted command IDs are reconciled against the verified server seat, so stale Live actions do not block account reopening. Genuine unsynced Live changes and turn drafts remain pending. Reopening does not submit them or end a turn. Open Multiplayer → Connection & recovery to Retry, Export pending actions, or explicitly discard after reviewing them. A conflicting preview shows the server state and keeps its pending actions and error rather than leaving an empty or outdated device view.

When a device queue differs from the server draft, or belongs to an earlier seat, Lootsplit preserves a separate device-only action recovery record before replacing its connection. Find Unsynced action recovery in that account campaign card or Multiplayer → Connection & recovery. Download recovery actions exports the original command IDs, batch identity, seat, revision and reason, without credentials. Review before importing. A different-seat or different-role copy cannot be replayed with new permissions; the DM can review and manually enter still-needed changes. These records are not full campaign backups and are not automatically uploaded, deleted, merged, or replayed.

Storage/quota errors stop the operation without deleting the original pending queue. Unrelated current campaign actions must be resolved before switching. Do not clear browser/app storage or uninstall as a workaround.

## Account saves versus local copies

Shared campaigns are stored on the server and linked to the account. Reopening an existing account campaign does not require uploading a duplicate. Signing in or saving a membership does not upload a local-only campaign. My account → Cloud backups → Save current campaign uploads an explicit private snapshot; restoring creates a separate device campaign. PDFs and extracted reference content stay device-local, and protected campaigns retain their encrypted-backup requirements.

## Preservation and verification supplement

This extends the account-resume, persistent pending-command recovery and Android capabilities in FEATURE-INVENTORY.md; no existing entry point, gameplay rule, ownership requirement or release gate is retired. Account/seat/token/code checks, active and target cache locks, append-only recovery writes, receipt reconciliation and zero-revision hydration must remain covered. Never change retry IDs for genuinely unacknowledged batches or automatically submit a saved turn.

Focused commands: `npm run verify:focus -- resume-recovery` and `npm run verify:focus -- resume-conflicts`. The existing eight scenarios plus these two run by default in every complete account audit, including development, packaged Worker and standby. Playwright keeps two independent workers, zero retries, and unchanged timeout limits. `node --experimental-strip-types --test scripts/account-resume-client.test.mjs` executes the real client with isolated dependencies; it is not a substitute for full browser and backend checks.

Android 1.5.1/code8 is the client patch candidate. Publication is complete only after the signed artifact is verified, release.json advances to its actual checksum, and the deployed website download/changelog agree. Older APKs retain their bundled older client until updated in place. Check the release PR for final evidence; this guide alone is not a release-status assertion.
