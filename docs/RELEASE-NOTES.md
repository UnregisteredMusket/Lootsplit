# Lootsplit 1.4.0 — release candidate

Android version code 6. This candidate retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates of permanently signed installations.

## Added features

- Animated opening scene with a loot-hauling adventurer, coin-collecting rogue, and reduced-motion support.
- Adventurer’s Ledger light theme and Ironbound Dragon dark theme, plus Pen & Paper and Virtual roll modes.
- Optional CC0 coin, loot and page-turn sound effects, with device volume and preview controls; automatic sounds default off.
- Account-owned DM campaigns with explicit End session, expiring invitations and guest play without persistent campaign storage.
- Party Add loot supports Open5e search and custom items; scanned character/statblock imports offer local OCR and review.

## Improvements

- Brings the bundled Android interface up to date with the verified website, retaining existing campaigns, exports and permanent signing identity.
- DMs can resume saved campaigns across devices, reopen ended sessions, and control character editing and granular player permissions.
- Clearer room selection, automatic membership linking and pending-upload feedback help prevent duplicate rooms and unsaved portraits.
- Includes updated journal, encounter, loot, notification and owner testing controls.

## Bug fixes

- Internal navigation no longer restarts the title screen when opening account, journal or ledger pages.
- Shared player invitations point to the intended room and character and ask before switching an existing session.
- Imported characters remain selected when older list requests finish, and filled PDF fields preserve supported values for review.
- Character assignment, Live updates and inventory awards retain authorization and duplicate-award protections.

## Candidate verification

Complete PR/main preservation checks and the signed Android workflow are required before publication. The workflow verifies version ordering and the permanent certificate and publishes a checksum. Afterward the website download metadata must be updated and its deployed APK bytes verified. Real-device upgrade, file-picker and force-close checks are not represented as automated verification.

The public download remains 1.3.2 until the new signed APK and checksum exist.

---

# Lootsplit 1.3.2

Android version code 5. This release retains the existing package identity and permanent signing certificate and updates permanently signed 1.3.x installations in place.

- Brings the current DM/Player interface, responsive desktop layout, settings panels, encounters, manual gameplay and loot review into the bundled Android client.
- Connects party readouts and character sheets to one character state; wallet and inventory updates retain permission and duplicate-award checks.
- Fixes older sheet edits discarding advanced character data or bypassing DM read-only protection.
- Retains imported levels and skill/save/initiative bonuses; local rolls use the displayed character values.
- Fixes stale characters and permission errors when switching local campaigns.
- Allows HP saves with existing long inventory names, notes and IDs without changing those items.
- Preserves item metadata and every queued offline transfer; report replay cannot award the same transfer again.
- Keeps current mobile formatting and desktop space usage unchanged.

## Verification

See `docs/audit/2026-10-02-bug-fixes.md` for sequential before/after evidence and release gates. Real-device upgrade, file-picker and force-close checks remain separate from automated verification.

## Published — October 2, 2026

[Download Android 1.3.2](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.2/Lootsplit-1.3.2.apk) · [Checksums](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.2/SHA256SUMS.txt) · [Website changelog](https://lootsplit.oliverstorie2017.workers.dev/updates)

Signed release run 37091668595 passed from main commit `1f0da5a`: 396 passing tests, four existing skips, typecheck, lint, web/mobile builds, browser recovery and responsive checks, built Worker checks, Android compilation and permanent-certificate verification. The downloaded APK independently confirms version 1.3.2, code 5, the existing package identity and permanent certificate. SHA-256: `47c78585b88f11752c803df76dc2b5c8151a1fd1bcd08e47aa0954fccc458d01`, matching the published checksum and GitHub asset digest. The owner successfully installed the test candidate. Device file-picker and force-close behavior have not been independently retested here.

Every future Android release must include a website changelog with added features, improvements and summarized fixes. Earlier release entries remain available.

---

# Lootsplit 1.3.1

- Retains all campaign, finance, PDF, reference, multiplayer and appearance features.
- Adds an explicit invitation choice when already connected, with a backup before switching rooms.
- Android exports offer Save file (a persistent location chosen by you) alongside Share.
- Clarifies device-backup recovery and browser-only background push.
- Records explicit transaction types and structured price history for new events, retaining older saves.
- Includes the Greyhaven default party on first initialization; existing campaigns are unchanged.
- Adds release test gates, permanent-certificate verification and APK checksums.

## Install
Download Lootsplit-1.3.1.apk. It updates the permanently signed 1.3.0 app in place. Export a backup before updating. Old debug-signed copies require a one-time backup, uninstall, reinstall and restore; never uninstall before verifying the exported backup.

## Preservation and verification
Local device copies are not external backups. Use Save file and keep the file outside app storage. Importing a backup into the backup list lets you check it without replacing your campaign. Real-device file-picker, force-close recovery and background-delivery behavior still require device validation; automated tests do not substitute for that.

## Published and verified — 2026-10-02
[Download Android 1.3.1](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.1/Lootsplit-1.3.1.apk) · [Checksums](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.1/SHA256SUMS.txt) · [Live web app](https://lootsplit.oliverstorie2017.workers.dev)

Signed release run 36976200449 passed all gates from main commit `549b96f`: 351 passing tests, four legacy-document skips, typecheck, both builds, browser recovery/responsive checks, Android compilation and permanent-certificate verification. The downloaded APK independently confirms version 1.3.1, code 4 and the permanent certificate. Its SHA-256 is `afd1cbeb9a377c10e77a839a161c8f670dfe2acecb703c0846003d4a4db6e088`, matching the published checksum and GitHub asset digest. Cloudflare successfully deployed the same source; the live UI displays 1.3.1. See AUDIT-IMPROVEMENTS.md for release evidence, rollback references and the outstanding device checks.
