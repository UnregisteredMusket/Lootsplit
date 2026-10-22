# Lootsplitter 1.10.0

Android version code **17**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Lootsplit is now Lootsplitter.** The app, the website, the home-screen widgets and Help use the new name. It is the same app with the same data: this update installs over the existing app, and your campaigns, characters, settings, account sign-in and placed widgets carry over unchanged.

## Improved

- Help explains the new name. Backups and campaign copies saved under the old name still import, and the website address is unchanged for now.
- Website pages, browser tab titles, notifications and the installed web app use the Lootsplitter name.

## Fixed

- The installed web app (Add to home screen) is now named Lootsplitter instead of a generic placeholder name.

## Release verification

To be completed by the signed release workflow (API 24/API 35 widget checks, preservation checks and the signed-APK upgrade gate).

---

# Lootsplit 1.9.3

Android version code **16**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Split view on tablets.** On a tablet in landscape (at least 1024 pixels wide), open two screens side by side in one window, for example your character sheet beside the map. Turning the tablet to portrait shows one screen; the second comes back when you turn it again.
- **Barter with NPCs in conversation.** Make an offer to a nearby NPC that allows bartering and get a reply or a counter-offer. A Persuasion roll against a difficulty set by how fair the deal is decides the answer; the DM chooses whether they decide each offer themselves or let the game roll.
- **Companion NPC funds (DM setting).** Party can see companion NPC funds, off by default, lets players whose character is in the party see the coins of visible NPCs travelling with them. Hidden NPCs stay hidden.
- **Set up operations.** DMs can repair an estate property that was bought without its operating record. Nothing is charged and the deed is unchanged.
- **Expandable widget rows (owner Field monitor).** Tap a log row to expand it and read its full title and text, tap again to collapse it, or press OPEN to go to the matching screen in the app. Expanded rows stay open when the widget refreshes.
- **Cloudflare plan usage on the large widget (owner).** Rows for Worker requests, CPU time and database reads and writes: today, the last 7 days and the billing cycle so far, which renews on the 11th of each month (for example “Cycle since Oct 11”). A reading Cloudflare did not return says unavailable, never zero.

## Improved

- When an action fails, the app now tells you and keeps what you entered, instead of looking as if it worked. Retrying never applies the same payment, gift or purchase twice.
- Offline (device) campaigns now buy, sell, give and buy listings exactly like shared rooms.
- Clearer widget status: a problem that has already stopped shows as attention, not failure, and the Multiplayer check is a real test round trip that never appears in your campaigns.
- A healthy widget reading turns amber after 35 minutes instead of 2, matching the background refresh, and widget sync counts only phones seen in the last 7 days.
- Campaigns with long session history keep saving, and restored campaigns keep all their history.
- Shared rooms refresh less when nothing has changed.

## Fixed

- **Privacy:** players no longer receive NPC or exchange treasury balances, and only players whose character is in the party see other party members’ balances.
- The widget stays connected through a temporary storage error on the phone (“Widget storage busy · tap Refresh to retry”) and finishes each refresh within its time limit.
- Android backups no longer carry your account sign-in to a new phone or a reinstall; you sign in again there. Campaigns and settings are still backed up.
- Finance actions in offline campaigns that have a blacksmith no longer fail.
- Buying an imported estate listing keeps its property details, and storage accepts exact fits such as three 0.1 lb items in 0.3 lb.
- Party chat keeps what you type right after opening a room, and sends while your character is still loading.
- Property imports no longer report unchanged data as changed, item weights no longer show long decimals, and rolls made on the device are labeled DEVICE ROLL.

## Release verification

Published October 22, 2026 by `android-release.yml` (run 39768391571) from main `3666624` after full preservation checks, the API 24/API 35 widget and picker checks and the signed-APK upgrade gate passed. The public APK's SHA-256 is `cb93516b3db776f34cace4d3ead2d0029663f6ecd3668babf315859dd882b031` (28,149,033 bytes), matching SHA256SUMS.txt and the GitHub asset digest. Independent inspection of its v2 signing block confirms the permanent certificate (`baca95a8…f730a0`, unchanged from 1.9.2). The first two attempts stopped before signing on CI infrastructure (a slow Playwright browser install that timed out three jobs, then a dev-server connection reset in one account scenario); only failed jobs were re-run and nothing was published from them. Physical-device behavior has not been verified.

---

# Lootsplit 1.9.2

Android version code **15**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Agent activity** preset for the 4×1 companion: the latest GitHub development activity (workflow runs, pull requests, merges and deploys) with ✓ ! ✕ symbols and ages. While a workflow runs and the screen is on it refreshes about every minute without waking the device; otherwise the usual ~30-minute schedule applies. It shows GitHub activity only, not the development chat.
- New coin-and-quill app icon and splash screen, including a monochrome themed-icon layer.

## Improved

- Field monitor widget redesign: status symbol and one-line reason, four stat tiles (— means unavailable), a task card with its timer, and a log ordered with attention items first.
- 4×1 companion redesign with matching symbols, tinted icon actions and 44dp touch targets.
- Agent activity is the default for new companions; existing companions keep their saved settings and all earlier presets remain.
- The widget face no longer shows your email.

## Fixed

- Removed the companion’s stray “?” status.
- Unavailable GitHub activity states its reason (rate limited, denied, timed out, not connected).

## Release verification

Published October 21, 2026 by `android-release.yml` from main `0932e34` after full preservation checks, the API 24/API 35 widget and picker checks and the signed-APK upgrade gate passed. The public APK's SHA-256 is `3d782a1ac574899347025d925f4f4f6a3b54681a68376b48ab539c989c510ce3`, matching SHA256SUMS.txt. Independent inspection of its v2 signing block confirms the permanent certificate (`baca95a8…f730a0`, unchanged from 1.9.1). Two earlier attempts stopped before signing on an emulator launcher timing issue in the picker audit, which was fixed in #142; nothing was published from them. Physical-device behavior has not been verified.

---

# Lootsplit 1.9.1

Android version code **14**, same package and permanent signing certificate.

## Added

- None in this release.

## Improved

- Add the 4×1 companion with its default Development preset, then choose summaries, actions and theme from Settings.
- Place either widget before connecting owner access; private readings still require authorization.
- Refresh widget list safely reannounces both types and reports Android’s detection state.

## Fixed

- Prevents the companion identity row from shifting outside its bounds on high-density displays.
- Provider-list recovery after APK updates and first launch preserves existing widget IDs, settings and campaign data.
- Release verification now includes both real picker entries, companion binding/configuration, and the actual signed upgrade and Add path without My account.

## Release verification

Published October 21, 2026 after API 24/API 35, complete PR/main preservation checks and the signed-APK upgrade gate passed. The public APK matches the signing artifact and checksum; independent inspection confirms the permanent certificate, package, version 1.9.1/code 14 and both widget providers. See [signed release evidence](audit/android-widget-picker-release-evidence.json). The exact cause on the reported physical launcher has not been confirmed; emulator evidence and the defensive recovery behavior must not be presented as physical-device verification. Install over the existing signed app; do not uninstall or clear saved data. See [picker investigation](audit/2026-10-21-widget-picker.md).

---

# Lootsplit 1.9.0

Android version code **13**. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added

- Private backend monitoring every 30 minutes, independent of phone connectivity, with persistent history, comparisons, recovery evidence and daily reports at 00:10 America/New_York by default.
- A central registry includes existing and future designated logs in daily reporting; missing sources appear as coverage gaps.
- Shared development tasks, persistent elapsed and recorded timing, workflow telemetry, component diagnostics and explained progress warnings.
- A separate customizable 4×1 companion widget with Development, Server Health, Analytics and Quick Actions presets, per-instance summaries/actions and appearance settings.

## Improved

- The main Android widget has a supported scrolling collection with task, diagnostic, log and report links. The matching website and Android account dashboard has bounded scrolling, history search/filters, exports and full daily reports.
- Both widget types use the same encrypted owner authorization and shared dated snapshot, reject older updates and refresh all instances together when data arrives.
- Light/dark/terminal appearance, readable status labels and native elapsed timers accompany the website's reduced-motion-aware warnings and transitions.
- Lootsplit's existing campaign layout, gameplay, accounts, saves, themes and permanent signing identity remain.

## Fixed

- Retains direct home-screen refresh without visiting My account; genuine access denial clears private information and opens a working sign-in route.
- Keeps confirmed component failures visible when their source disconnects, preserves incomplete observations during historical recovery, and carries unresolved incidents into subsequent daily reports.
- Prevents analytics-label clipping in the main widget's fixed header.

## Release verification

Published October 20, 2026 after all nine preservation groups, API24/API35 framework instrumentation, native lint and permanent-key signing passed. The public APK, checksum and extracted signing artifact independently match; v2 signature and the original certificate are verified. See [release evidence](audit/android-monitoring-release-evidence.json). The website manifest follow-up publishes this verified download and corrects GitHub immutable-subject authorization; its deployment status is recorded in the follow-up PR. Android background delivery remains subject to OS and launcher restrictions; backend collection runs independently. Continuous custom widget animation is unsupported, so static status and native timers are intentional. Physical OEM launcher, prolonged Doze, reboot delivery and large-font checks require separate device validation. Raw runtime-log ingestion and end-to-end scheduled multiplayer checks are explicit coverage gaps until connected, never fabricated healthy results. Install over the permanently signed app; do not uninstall it.

---

# Lootsplit 1.8.1

Android version code **12**. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added

- None in this release.

## Improved

- The last dated Field monitor reading stays visible while a check runs or temporarily fails.
- Repeated taps share one check; a bounded timeout releases the widget and shows how to retry.

## Fixed

- Home-screen Refresh starts its check directly without opening My account or reconnecting the owner account.
- My account’s Refresh widget waits for a completed check and reports failures accurately.
- Late requests cannot replace another account or undo a sign-out. Rejected owner access still clears private readings.

## Verification

All eight native cases passed on API24/API35, including actual widget-button, timeout and owner-isolation checks; complete PR/main preservation gates passed. Signed workflow 39475576975 published 1.8.1. Independent inspection verifies the permanent certificate, APK-v2 integrity, package/version and matching public/checksum/artifact bytes. The website metadata follow-up retains its complete PR/main and streamed-download gates. Physical-device installation is not claimed. Install over the permanently signed app; do not uninstall it.

---

# Lootsplit 1.8.0

Android version code **11**. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added

- Owner-only Android home-screen Field monitor in the approved green terminal style, with compact/full sizes, real account identity, service checks, app/game totals and recent GitHub development/deployment metadata.
- My account controls to connect, request launcher placement, refresh and disconnect the widget.
- This APK also packages the current Maps workspace, protected media/fog, connected scenes and encounter handoff already verified on the website.

## Improved

- Readings are dated; Android requests periodic checks about every 30 minutes, subject to power/network restrictions. Manual refresh is available. Provider metadata may be five minutes old.
- Encrypted, backup-excluded widget credentials and snapshots; stale response isolation and immediate device sign-out clearing.
- Lootsplit’s existing themes, campaign data, owner/staff controls and all game features remain. Reference screenshots are not bundled.

## Fixed

- Includes the verified narrow-phone/landscape Maps toolbar and camera containment fixes since Android 1.7.0.
- Missing analytics remain unavailable or not connected, never fabricated zeros. Cloudflare traffic requires the separately configured server-only analytics connection.

## Verification

Native API24/API35 compilation/instrumentation, desktop/mobile account controls and complete PR/main preservation passed. Independent inspection verifies the permanent signing certificate, APK v2 integrity, package/version, widget components and published checksum. The website publication gate verifies the matching download bytes. See `docs/audit/android-widget-release-evidence.json` for the signed artifact. Physical-device installation is not claimed here. Install over the permanently signed app; do not uninstall it.

---

# Lootsplit 1.7.0

Android version code 10. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added features

- The Android bundle includes the current website's map grids/routes, property operations, commodity exchanges, bilateral barter, blacksmith commissions and local reference OCR.
- NPC training uses approved hourly downtime budgets, DM review, complete NPC/category totals and manual milestone resets with lifetime history.

## Improvements

- Compact authenticated unchanged reads retain fresh access and encounter policy without repeatedly transferring/hydrating campaign media. Manual refresh and old clients retain complete snapshots.
- Atomic command batches share one working copy while validating every action and retaining exact financial receipts.
- Character away actions support elapsed campaign hours. Calendar days, usable downtime and displayed training days are explicitly distinguished.
- Cloudflare CPU/log settings travel with the verified artifact and are checked after deployment. Full browser audits are redistributed across existing groups without weaker gates or longer deadlines.

## Bug fixes

- Late bookkeeping can use explicit DM confirmation of historical conditions while enforcing current access and original period budgets.
- Subject spacing/case variants group without rewriting original requests; category totals combine teachers while player totals remain scoped to their contributions.
- Documentation now reflects implemented OCR, six navigation tabs and map tiles. Failure email uses the production secret scope and reports configuration honestly.

## Verification

PR #105 all-nine verification 38303829968 and independent main 38305743510 passed. Signed release 38305743849 passed its own all-nine verification and published Android 1.7.0/code10 from main 2b4abca6. The actual APK manifest, permanent certificate and v2 signed-data/content integrity were independently checked; SHA256 matches the published GitHub asset digest. See `docs/audit/report-android-release-evidence.json`. Website download metadata is updated through the separately verified release follow-up. Physical-device installation, file-picker and force-close remain untested. The broader UI redesign follows this functional release.

---

# Lootsplit 1.6.0 candidate

Android version code 9. This candidate retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added features

- End session & keep room online lets players retain their assigned sheets and permitted campaign information between sessions.
- After ending play, the DM can Leave room online and return through My account.

## Improvements

- Player gameplay, chat, campaign-sheet changes, imports and rolls pause until the DM resumes play.
- Resume play or starting a named session restores play. The existing End session still closes access completely.
- Preserves current account-resume recovery, saves, privacy, guest memory-only storage and the permanent Android package/signing identity.

## Bug fixes

- None in this release.

## Candidate verification

Full PR/main preservation checks and the signed Android workflow must pass. Verify the published APK certificate, version/code and checksum before updating the website download metadata. The public download remains 1.5.1 until the new signed APK and checksum exist. Physical-device installation, file-picker and force-close behavior require separate validation.

---

# Lootsplit 1.5.1 candidate

Android version code 8. This candidate retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates. The public download remains 1.5.0 until the new signed APK and checksum exist.

## Added features

- Account-scoped device recovery copies can be exported when older queued changes belong to another seat or conflict with the saved campaign.

## Improvements

- Sync recovery distinguishes unsynced Live changes from unfinished turn actions.
- The startup campaign selector shows campaign IDs so separate saves with the same name can be identified.
- Pending device work remains exportable from account/startup screens even before a campaign opens successfully.

## Bug fixes

- Account campaign resume reconciles server acknowledgements before classifying device queues, removing the false unfinished-turn blocker for already accepted Live actions.
- Genuine unsynced actions and server-saved turn drafts remain accessible in Multiplayer recovery, with command and retry IDs preserved.
- Changed-seat device actions are kept separately and are never automatically replayed with another seat's permissions.

## Candidate verification

The unchanged complete preservation suite validates unit tests, type checking, lint, shared web/mobile builds, development desktop/mobile flows, packaged Worker and standby behavior. Signed publication requires the permanent certificate check. Website live commit/asset audits and the verified APK/checksum download follow publication; a merge alone does not prove release success. Production campaigns are never used as destructive fixtures.

---

# Lootsplit 1.5.0 candidate

Android version code 7. This candidate retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates of permanently signed installations.

## Added features

- DMs can create suggested, chosen-count or all-matching shop assortments, including mixed markets, with independently selected stock quantities.
- Existing shops support bulk catalog selection, fixed or unlimited quantities, stock summaries, search, filters and paginated shelves.
- Player Home provides six fixed service buttons for Character Sheet, Bank, My Finances, Properties, Journal and Party chat.
- Includes DM-reviewed character imports, campaign-day shop schedules and restocking, and property income and upkeep plans.

## Improvements

- DM Desk and campaign overview share one Campaign control screen with five swipeable information panels, grouped tools and visible Multiplayer settings.
- Dedicated Bank, finance, property, downtime and report screens separate player services from DM approvals and administration.
- Bulk additions preserve existing custom prices and stock; pagination preserves complete saved inventories and PDF exports.
- Brings the bundled Android client up to date with the verified website while retaining the package, permanent certificate, existing saves and supported play modes.

## Bug fixes

- Removes small automatic assortment limits that excluded eligible catalog items from shops.
- Saved DM shortcut destinations wait for account preferences instead of exposing incorrect defaults while loading.
- The DM Review Inbox no longer includes a misplaced payment-request composer, and duplicate multiplayer entries are removed from the DM overview.

## Candidate verification

Full exact-head PR/main preservation checks and the signed Android workflow must pass before publication. Verify the APK version, package, permanent certificate and checksum, then advance the website download metadata and verify its deployed download and changelog. The public download remains 1.4.0 until the new signed APK and checksum exist. Real-device upgrade, file-picker and force-close checks remain separate from automated verification.

No new gameplay rules, offline pass-phone implementation, database migration, domain activation or signing-key change is included. Previously released APKs and changelog entries remain available.

---

# Lootsplit 1.4.0

Android version code 6. This release retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates of permanently signed installations.

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

## Verification

PR #44 and main preservation checks passed. Signed Android workflow 37391400899 passed after a targeted rerun of the import-audit timing race documented in docs/RECOVERY.md. The downloaded APK independently confirms version 1.4.0, code 6, package com.unregisteredmusket.lootsplit and the existing permanent certificate. SHA-256: `355baf1eca0c734e705006203eac300d4339558093506ad6f3a97c9477c507e0`, matching SHA256SUMS.txt and the GitHub asset digest. Real-device upgrade, file-picker and force-close checks are not represented as automated verification.

Published October 5, 2026 (America/New_York). [Download Android 1.4.0](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.4.0/Lootsplit-1.4.0.apk) · [Checksums](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.4.0/SHA256SUMS.txt). Website download metadata is advanced by the publication follow-up; verify its live deployment before treating website publication as complete.

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
