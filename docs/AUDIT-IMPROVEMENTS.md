# Audit follow-up 1.3.1

## Scope and preservation
Implements necessary/high-value audit findings without optional account registration, Google Drive, OCR, native push, or destructive room cleanup. See FEATURE-INVENTORY.md and AGENTS.project.md. No user campaign or production room is used for testing.

## Changes
- Fund disposable purchase-test fixture explicitly; defaults remain zero.
- Merge Android preparation and web into main with both histories retained.
- Verify tests/types/builds, monotonically increasing Android versions and permanent certificate before publishing versioned APK/checksum releases.
- Explain invitation versus existing room; deliberate switch saves a device backup, rejects pending actions, and confirms host room termination. Protected saves retain existing password flow.
- Android Save file uses ACTION_CREATE_DOCUMENT with no broad storage permission; Share is retained. Cancellation/failure does not report a successful write.
- Clarify local versus external backups and browser-only background notifications.
- Optional transactionType and structured journal changes preserve old saves. Historic values are not invented.
- New rooms use eight cryptographically generated code characters; existing short codes still work.
- Guest open/lookup/join rate limits use a Cloudflare edge binding, 60 attempts per action/network/minute. Established play does not share this budget. This is an edge-local abuse mitigation, not a global guarantee. Shared networks can reach the guest limit and receive a retry message. No automatic room expiration or data truncation.
- Recovery tests cover lost acknowledgements/idempotency and browser interruption/reload/retry. Native process termination and actual push delivery require real-device evidence.

## Release and rollback
Deploy matching Worker and assets together, retaining D1. Old Android clients remain supported by the additive schemas. Do not downgrade or replace campaign data during rollback. Preserve checkpoint commits and the permanent key. GitHub releases and APK version codes are immutable/increasing; a correction ships as a new version.

## Validation
Local suite: 350 passed, four skipped; typecheck, Cloudflare and mobile builds passed. CI browser and Android compilation results are recorded in the release delivery; do not interpret this sentence as native hardware testing.
