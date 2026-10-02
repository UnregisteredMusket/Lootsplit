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
- Stable server snapshots prevent hydration errors when reopening a restored room.
- DM history offers expandable before/after details; player responses omit those new DM audit details.
- Optional transactionType and structured journal changes preserve old saves. Historic values are not invented.
- New rooms use eight cryptographically generated code characters; existing short codes still work.
- Guest open/lookup/join rate limits use a Cloudflare edge binding, 60 attempts per action/network/minute. Established play does not share this budget. This is an edge-local abuse mitigation, not a global guarantee. Shared networks can reach the guest limit and receive a retry message. No automatic room expiration or data truncation.
- Recovery tests cover lost acknowledgements/idempotency and browser interruption/reload/retry. Native process termination and actual push delivery require real-device evidence.

## Release and rollback
Deploy matching Worker and assets together, retaining D1. Old Android clients remain supported by the additive schemas. Do not downgrade or replace campaign data during rollback. Preserve checkpoint commits and the permanent key. GitHub releases and APK version codes are immutable/increasing; a correction ships as a new version.

## Validation
Local suite: 351 passed, four skipped; typecheck, Cloudflare and mobile builds passed. CI browser and Android compilation results are recorded in the release delivery; do not interpret this sentence as native hardware testing.

## Verified release — 2026-10-02
- Follow-up `549b96fc663f809f3839f83b5bf063e0cb2587ea` was fast-forwarded into main without overwriting intervening work. It adds browser timeouts/progress and the workflow-file release trigger; all assertions remain.
- Cancelled run 36949995137 stalled during browser verification and produced no APK. Its logs do not identify the exact stalled operation. Bounded follow-up run 36950429363 and main verification run 36976200034 passed.
- Signed main release [36976200449](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/36976200449) succeeded: 351 tests passed, zero failed, four legacy Grok-document checks skipped; types, Cloudflare/mobile builds, browser recovery/DM-player checks, Android compilation and signature verification passed.
- [android-v1.3.1](https://github.com/UnregisteredMusket/Lootsplit/releases/tag/android-v1.3.1) targets `549b96f` and contains the APK plus SHA256SUMS.txt. The actual downloaded APK was independently inspected: package `com.unregisteredmusket.lootsplit`, versionName `1.3.1`, versionCode `4`, permanent certificate SHA-256 `baca95a880d14d0d8c422c397decd4c9bf0e7f710a3fd6a5be1e47abd3f730a0`.
- Downloaded APK SHA-256 matches both the checksum file and GitHub asset digest: `afd1cbeb9a377c10e77a839a161c8f670dfe2acecb703c0846003d4a4db6e088` (4,720,324 bytes).
- Cloudflare build `c9c3ee2b-0924-49d4-b7ee-0ef85540e509` succeeded from the same main commit; Worker `5ffae85b-d988-46fd-84bc-4cb1cea1e0c5` serves 100% of traffic. Production Home, Settings (1.3.1), and Multiplayer rendered with the existing local campaign. No application console errors were observed; browser-extension metadata errors were unrelated. CI screenshots for the same source were visually reviewed on desktop and DM/player mobile layouts.
- Rollback branch `checkpoint/pre-audit-1.3.1` remains at `17572499f431084c2b3d692b6ceea8c3bcba43bd`. Prior Worker `9c5cdcb8-97cc-4a33-a3c1-18234a995566` remains a code rollback reference. No campaign or D1 data was reset, and real rooms MC4Q5/ELH6B were not used for tests.
- Remaining physical-device checks: install over permanently signed 1.3.0 without uninstalling; Save file write/cancel and exported-backup import; force-close/reopen recovery; actual supported notification delivery. Native background push remains unimplemented. Automated tests do not certify these hardware behaviors.
