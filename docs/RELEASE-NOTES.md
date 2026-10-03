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
