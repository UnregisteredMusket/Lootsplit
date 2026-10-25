# Lootsplitter Android

The installable app is a packaged copy of the interface. Campaign files, device backups, and local mode stay on the phone. Shared rooms still use the existing Cloudflare Worker at `https://lootsplit.oliverstorie2017.workers.dev`. The APK does not contain the D1 database id, Worker secrets, or server source.

Capacitor does not load that site with `server.url`. `npm run build:mobile` writes a client into `dist/mobile-build`, then copies it to `dist/mobile`. The APK serves those files from `https://localhost`. That mobile build does not replace `dist/server`, which the Cloudflare deploy uses.

After this change is deployed, the Worker accepts server-function calls from `https://localhost`, `http://localhost`, and `capacitor://localhost`. A normal browser visit to the Worker is unchanged. Until that deploy, the website keeps working and the APK cannot join a shared room.

## Test APK

The GitHub Action **Android test APK** builds `app-debug.apk`. Run it manually or push a prepared update to an `android/**` branch after verifying the web release. Version 1.3.2 uses Android version code 5; the previous permanent-key 1.3.0 uses code 3. The APK is signed with the build machine's debug key, not a Play Store release key. A later test APK may not install over an older one if the debug key changed. Export and verify a backup of local campaigns before uninstalling an old test copy; uninstalling removes its local data.

From a phone:

1. Open https://github.com/UnregisteredMusket/Lootsplit/actions/workflows/android-test-apk.yml
2. Run workflow on `main`.
3. When it finishes, download the `lootsplit-test-apk` artifact and install `app-debug.apk`.
4. Allow installation from the browser or Files app if Android asks.

## Release signing

The permanent signing key is already configured. Use the existing GitHub repository secrets for every update: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Do not generate a replacement key, retrieve secret values, or ask the owner to paste passwords. The owner retains the original private backup.

Signing and publication each recheck the current remote main commit. A superseded candidate must finish verification on the corrected main source; never publish an older run merely because its earlier tests passed.

Do not commit `*.jks`, `*.keystore`, or those passwords. The **Android signed release APK** workflow signs using these four repository secrets. It verifies the APK signature and uploads only the APK, never the keystore. Missing secrets stop the build. The decoded keystore is temporary and removed on exit. Debug builds remain separate and are not release updates.

The permanent keystore was generated on 2026-10-01, downloaded by the owner for backup, and configured through the four repository secrets. Its alias is `lootsplit`. The workflow requires certificate SHA-256 `BA:CA:95:A8:80:D1:4D:0D:8C:42:2C:39:7D:EC:D4:C9:BF:0E:7F:71:0A:3F:D6:A5:BE:1E:47:AB:D3:F7:30:A0` and refuses to upload an APK signed by another key. Keep the keystore and passwords backed up securely. Never generate a fresh key automatically during a build.

The first release-signed APK cannot normally replace the old debug-signed installation. Export and verify all local campaigns before a one-time uninstall/reinstall; thereafter retain this signing key and increase versionCode for every distributed update.

## Releases from main (1.3.1 onward)

`main` is the shared web/Android source. Increase `APP_VERSION`, Android `versionName`, and Android `versionCode` together, update `docs/RELEASE-NOTES.md` and add a versioned entry to `src/lib/website/changelog.json`, then merge verified changes. Every Android update requires added features, improvements, and summarized bug fixes on the website; use “None in this release” where applicable and preserve prior entries. The release gate rejects missing or incomplete changelog entries. A version-file or signed-release-workflow change on main starts the signed-release workflow; it can also be run manually on main. If a push leaves `APP_VERSION` unchanged and that version already has a release (for example a workflow-only edit), `check-android-release.mjs --skip-released-unchanged` ends the job successfully without signing or publishing; manual runs and version changes still fail on an existing release. Tests, type checking, both builds, monotonic version checks, and the permanent certificate check must pass. A versioned GitHub Release holds `Lootsplit-VERSION.apk` and `SHA256SUMS.txt`; do not overwrite an existing release. Actions artifacts remain available as secondary downloads.

Android exports now ask whether to Save file or Share. Save file uses Android's document picker and reports success only after writing/closing the stream. Choose Downloads or another location outside app-private storage. Sharing only hands the file to another application: confirm that application's save/send completed. Cancelling preserves the campaign and named device backup. Neither private device backups nor shared room membership replace an external backup.

The bundled Android client must be updated by installing the newer signed APK. Changes deployed to the website do not rewrite its bundled interface. The backend remains the existing Cloudflare Worker.

## Published update — October 2, 2026

Version **1.3.2**, Android version code **5**, is signed with the permanent certificate and published in GitHub release `android-v1.3.2`. Release workflow 37091668595 passed all verification and signing gates. The owner installed the preceding test candidate successfully. The signed APK checksum is `47c78585b88f11752c803df76dc2b5c8151a1fd1bcd08e47aa0954fccc458d01`.

After each signed release, verify the actual APK certificate, version and checksum, update `src/lib/website/release.json`, and deploy the website. Confirm `/downloads`, `/updates`, and the actual `/download/android` bytes agree before calling publication complete. The changelog and download summary share the versioned data; unreleased entries stay hidden until the download metadata advances. Do not overwrite previous release history.

## Published update — October 5, 2026

Version **1.4.0**, Android version code **6**, is published as `android-v1.4.0` from main `feea2b5047b967e3aeb54314d59acff5593d9881`. Signed workflow `37391400899` passed. Independent inspection of the downloaded APK confirms the permanent signing certificate, unchanged package identity, version/code and all three bundled CC0 sound files. SHA-256: `355baf1eca0c734e705006203eac300d4339558093506ad6f3a97c9477c507e0` (20,807,198 bytes), matching both the checksum file and GitHub asset digest.

This update includes the animated opening, light/dark themes, optional sounds, account-owned campaigns, current character/session/import fixes and the other changes listed in the website changelog. It updates permanently signed installations in place. Physical-device upgrade, file-picker and force-close checks have not been independently repeated here.

The publication follow-up advances release.json only after the APK verification above; its website deployment and actual download bytes must also be checked. See docs/RECOVERY.md for the import-audit timing correction and workflow recovery evidence.

## Published update — October 7, 2026

Version **1.5.0**, Android version code **7**, is published as `android-v1.5.0` from main `120d1a31899e0fee77fcbc4745f459a6dd362330`. PR58 verification `37572857798`, main verification `37573238905`, and signed workflow `37573239210` passed. The downloaded signed artifact independently confirms version/code, package `com.unregisteredmusket.lootsplit`, the permanent certificate, valid APK v2 signature/content digest, and all three bundled sound files. SHA-256: `47d4e9cb9cf95137f0a97438a2c361d5b34257a70c3c4bb8d662ffc4a2aca499` (21,821,334 bytes), matching the published APK asset digest.

This release packages the larger shop assortments/bulk stock controls, unified DM home and current player service screens. Install over the existing permanently signed app rather than uninstalling it. Physical-device installation, file-picker and force-close behavior are not claimed as tested. The separately reported account-resume warning is not claimed fixed by this APK.

The website follow-up advances the download/changelog metadata only after the artifact inspection. Remote website audits now also make one bounded, read-only GET to `/download/android` and verify the returned filename, content type, size, advertised digest and streamed APK SHA-256. They retain `test-results/website/android-download.json`; existing desktop/mobile browser assertions remain intact. Local fixtures keep their existing checks without downloading an external APK. The follow-up must pass complete PR/main/deployment gates before website publication is complete. See `docs/audit/2026-10-07-android-publication.md` and the publication PR for final live evidence.


## Published account-resume patch — October 7, 2026

Android **1.5.1**, version code **8**, is published as android-v1.5.1 from main66cac4da68d244259f01f86f1e213ae18ea56931. Signed workflow37587450064 and independent downloaded-artifact inspection verify the permanent certificate, APK-v2 signature/content digest, package/version/code and retained sounds. APK SHA256: `abe7432bc731ed0d34169bba172ca8c1e88e0cd3a9d4ce50f066f4000175e181` (21,822,674 bytes). This patch includes account-save acknowledgement reconciliation and exportable device recovery copies. Install over the existing signed app. Physical-device installation has not been tested here. Website download publication requires the metadata follow-up's complete PR/main/deployment and streamed-APK-byte checks; see docs/audit/2026-10-07-account-resume-queue.md.

## Owner home-screen Field monitor — 1.8.0

Sign in as the site owner, open My account → Home-screen Field monitor and Connect owner account. Add to home screen requests Android’s confirmation; it does not place the widget automatically. Alternatively long-press your home screen, choose Widgets → Lootsplit Field monitor, and drag it into place. Resize vertically for compact or full details. The actual account name/email appears beside Owner access. The home widget uses the approved green terminal style; the app retains its current theme.

From Android1.8.1, tap Refresh for a direct read without opening My account. The last dated reading remains visible during a check or temporary failure; a failed/timed-out check offers retry, and readings older than one hour are hidden on the next render. Reconnecting is only for restoring owner access. Android requests periodic checks about every30minutes, subject to network/power restrictions; provider metadata may be five minutes old. Read timestamps before interpreting health or deployment status. No local/Codex development activity is inferred from GitHub. Optional Cloudflare traffic stays explicitly disconnected until configured on the server.

Disconnect, sign-out and account switching clear the widget on this device. Access revoked remotely clears on its next server check; an offline widget cannot learn about revocation immediately. Removing the last widget disconnects it. Widget credentials/readings are encrypted with Android Keystore and excluded from Android backup. Campaign saves are unchanged.

Widget storage errors (from the 1.9.3 source): only a confirmed unreadable file (bad GCM tag, invalid length, unparsable contents, permanently invalidated key) clears the widget connection. A transient Keystore or file error keeps it; the widget shows "Widget storage busy · tap Refresh to retry" and background checks retry with backoff. Sign-out still removes a credential it cannot compare. HTTP limits (3 s connect, 4 s read, 7 s total enforced by a disconnect watchdog; 3 s read and 6 s total before the next APK after 1.12.0) end inside the 8 s refresh deadline, and only one fetch per account runs at a time: a tap after a timed-out fetch waits for that fetch's result instead of queueing another. The upgrade receiver does its registration and render work off the main thread with `goAsync()`. From the next APK after 1.12.0, a Connect owner account whose first reading times out or fails in transport keeps the new connection (shows “Could not refresh · tap Refresh to retry” and schedules the background check); only an authorization rejection (401/403) or a changed account clears it. Earlier versions cleared the connection, so a slow first reading meant connecting again.

Auto Backup (audit S07): `allowBackup` stays on so campaign saves, device backups and settings keep backing up. `res/xml/backup_rules.xml` (Android 11 and earlier) and `res/xml/data_extraction_rules.xml` (Android 12+, cloud backup and device transfer) exclude WebView session storage and cookies. The account token lives in WebView localStorage beside the campaign registry, so it cannot be excluded on its own; instead `src/lib/mobile/token-binding.ts` binds it to the installation id kept in no-backup storage (`OwnerWidget.installId`). A token restored onto another install or a reinstall is dropped before any request and the person signs in again. Data saved before this check existed carries no marker and is adopted, so upgrading never signs anyone out; a backup taken before the upgrade can still restore its token once.

`android-widget.yml` verifies API24/API35 native compilation, storage, request isolation, bounded transport and real RemoteViews at250/350/448dp widths, including empty/error states. API35 also checks actual account-control clicks and320/390/1280 layouts. These tests and the complete preservation workflow passed before permanent-key signing.

Version **1.8.0**, Android version code **11**, is published as `android-v1.8.0` from main `eff5978f518bb9404cb8966a59278459d22d7b3c`. Signed workflow39421997999 attempt2 retains all successful independent/native jobs and passes the diagnosed account-timing retry. Independent inspection confirms package identity, permanent certificate, valid APK v2 signature/content integrity, native widget resources and all three CC0 sounds. The public asset and checksum match SHA256 `b0bc1b07c65f074318cbb12de6c69a8de13a2d2a19ac56fc79c42013e4556a36` (28,009,920bytes). Install over the existing signed app; do not uninstall it. Physical-device installation is not claimed. Website metadata publication retains the full PR/main/live gates and streamed-download check; see the [release evidence](docs/audit/android-widget-release-evidence.json) and [audit](docs/audit/2026-10-20-android-widget.md).


## Field monitor redesign (next release after 1.12.0)

The owner-approved redesign (2026-10-25) ships in the next APK together with the connect fix (#265): severity chips (✕ CRIT, ! WARN, i INFO) with ACTIVE, start time and duration; Recently resolved (24 h, start → end); At a glance tiles with bitmap charts (`WidgetCharts`, RGB_565 at ≤2×), `ProgressBar` plan-usage gauges with a pace line, CI pips and players with live rooms; tap-to-expand items and tiles with a 24h/7d toggle (no fetch); a 4×2 size (the provider's `minResizeHeight` is now 110 dp); and the optional **Status + charts** 4×1 preset (Agent activity stays the default). Both themes are supported. Older servers degrade to explicit "needs a server update" notes; older apps ignore the new server fields. Details: `docs/OWNER-MONITORING.md` → "Field monitor redesign". `OwnerWidgetTest` covers the severity mapping, the resolved list, expansion persistence and the range toggle without a fetch, chart bitmaps (size, determinism, byte budget, baseline and pace pixels), the fully expanded parcel size, the 4×2 breakpoints and the 4×1 preset.

## Published widget refresh patch — October 20, 2026

Version **1.8.1**, Android version code **12**, is published as `android-v1.8.1` from main `75270080608878abd594ea2c8198b3990fdb58b0`. Signed workflow39475576975 attempt2 retains all successful verification/API35 jobs and passes a single targeted retry after an API24 emulator installation failure before any tests. Both native targets pass all eight cases.

Independent inspection of the public APK and signing artifact verifies the permanent certificate, APK-v2 integrity, package/version/code, widget provider and resource table, direct-refresh implementation, absence of the obsolete queued message/test credentials, and all three bundled sounds. The checksum matches `5a700656ad11aa03a556bf9a392ee0687a3395273887a1b9700e34e01773d755` (28,012,900bytes). Install over the existing signed app; do not uninstall or reconnect solely to refresh. Physical-device installation is not claimed. The website download/changelog update must pass its own full PR/main and live streamed-byte checks. See [release evidence](docs/audit/android-widget-refresh-release-evidence.json) and [refresh audit](docs/audit/2026-10-20-widget-refresh.md).

## Version1.9.0: synchronized owner monitoring

The bundled My account dashboard now shares owner monitoring history, reports, task timing, diagnostics and settings with the website. The main Field monitor retains direct bounded Refresh and adds native collection scrolling, persistent elapsed timers and appearance options. The independent4×1 companion offers per-instance Agent activity (default for new companions)/Development/Server Health/Analytics/Quick Actions presets, two ordered summaries, two actions and terminal/light/dark/system appearance. Add/configure from My account or your launcher. Backend collection does not depend on Android scheduling.

RemoteViews use static status symbols and supported updates, plus native Chronometer; no second-by-second network polling or portable continuous custom flashing is claimed. API24–30 use RemoteViewsService collections; API31+ use RemoteCollectionItems. Background JobScheduler work persists across reboot but Doze/OEM restrictions can delay delivery. Readings remain dated and account revocation clears on the next connected check. See [operations](docs/OWNER-MONITORING.md) and [verification/release status](docs/audit/2026-10-20-monitoring.md). Physical-device/OEM, large-font and prolonged Doze testing remains distinct from emulator evidence.

Version1.9.0/code13 was published with the existing permanent signing key. Its artifact/checksum inspection is recorded in [release evidence](docs/audit/android-monitoring-release-evidence.json).

## Published companion discovery recovery — 1.9.1

Version1.9.1/code14 preserves the package, permanent certificate and all local data. Install over the existing signed app. Both providers are reannounced after package replacement and once on app launch. Do not uninstall or clear launcher/app storage to refresh the list. Long-press home, open Widgets → Lootsplit, then add Lootsplit 4×1 companion. It starts with the existing Development preset; Settings changes each instance independently. Placing either widget does not require a connected owner session, but private readings still do. My account includes Add 4×1 companion and Refresh widget list, which reports actual framework discovery without claiming the launcher refreshed immediately.

The native gate now uses a Pixel6 profile for its API24/API35 launchers, requires both picker entries, adds the companion through the API35 picker, and separately binds/configures it through a real AppWidgetHost while signed out. Synthetic stale-provider metadata is debug-only. The signed release gate upgrades the previous public, checksum-verified APK to the new signed candidate without opening My account and adds the companion from Widgets before publishing. Evidence and limitations are in [the investigation](docs/audit/2026-10-21-widget-picker.md). Version1.9.1/code14 is published from main43906256b19f64d4634b596cd9f980e7f57c11f0 after signed workflow39546976796 passed. Its actual signed1.9.0→1.9.1 upgrade and companion placement passed on the API35 Pixel6 emulator. The public APK matches the signing artifact and SHA256 `dd9a0d04bfacee4e67645a3ff1e0ca1aeeb538d08e6837e4754353fdc324c79c` (28,040,276bytes), with the permanent certificate and valid APK-v2 integrity. See [release evidence](docs/audit/android-widget-picker-release-evidence.json). Physical-device/OEM verification remains separate. Website publication is completed through its own full PR/main/deployment and streamed-byte gates.

## Rename to Lootsplitter — 1.10.0

Version 1.10.0/code 17 changes only the user-visible name: `app_name`, `title_activity_main`, `capacitor.config.ts` `appName`, both widget labels (Lootsplitter Field monitor, Lootsplitter 4×1 companion) and the widget settings activity label. The package/appId `com.unregisteredmusket.lootsplit`, Java package and class names, the permanent signing key, storage keys, `X-Lootsplit-*` request headers and the native API origin are unchanged, so the update installs over 1.9.3 and keeps local data, sign-in and placed widgets. The GitHub release asset keeps the `Lootsplit-VERSION.apk` filename that the website download proxy and checks rely on; the release title uses the new name.

## Kobold app icon — 1.11.0

Version 1.11.0/code 18 replaces the coin-and-quill mark with the owner's kobold brand set (`docs/brand/`, owner go-ahead 2026-10-23). The adaptive icon foreground and monochrome layer are density PNGs (`drawable-*dpi/ic_launcher_foreground.png`, `ic_launcher_monochrome.png`) with the artwork inside the 66 dp safe zone; the background colour is navy `#0C1424`, which also colours the Android 12+ system splash. Legacy `mipmap-*/ic_launcher(_round).png` and the pre-12 `splash.png` images use the same mark. The in-app title animation, widgets (which carry no logo), package and signing key are unchanged. Regenerate from the masters in `docs/brand/` rather than editing the PNGs.

## Journeys, services and community profiles — 1.12.0

Version 1.12.0/code 19 bundles the web source merged since the 1.11.0 build commit `ca6fbb3`: party journeys (#243), NPC services with temples, workshops and inns (#247, #249–#251), the My account Community profile card (#240; the Find a group directory stays a website page) and the treasure pool activity-order fix (#246). The Turnstile human check (#241, #248) does not apply to the app, whose native origins are exempt. Package, signing key, widgets and icon are unchanged.

## Tablets in landscape: split view

The app shows the same split view as the website when the WebView is at least 1024 CSS pixels wide (most 10–11" tablets in landscape). Rotating to portrait or a narrower window shows only the left screen; the right one returns when the tablet is turned back (the activity already handles orientation/size changes without restarting). The feature ships in the bundled web build, so it reaches installed apps with Android 1.9.3. See `docs/SPLIT-VIEW.md`.

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Android widget discovery and installation

Do not equate a compiled receiver or direct RemoteViews screenshot with an installable widget. Verify both providers in Android’s real launcher picker on a normal supported phone grid, then add the companion. Keep the real AppWidgetHost configuration/result and independent-instance regression. The signed-release gate upgrades the prior verified public APK in place and checks discovery/addition without visiting My account. Preserve the permanent signer and existing gates. A tiny generic emulator may filter large widgets by grid size; record its dimensions instead of misdiagnosing absent manifest entries.

Provider metadata refresh uses the supported Android API after an upgrade/first launch and an explicit account-screen recovery action. Never disable/re-enable a provider, clear launcher/app data, or reinstall as a registration repair: those approaches can delete placed widgets or user data. Adding a widget may precede owner authorization; reading private data may not. Diagnose device/launcher-specific failures honestly; successful emulator placement is not proof of physical OEM behavior. See the October21 picker audit.
