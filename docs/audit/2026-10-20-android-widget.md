# Android owner Field monitor — October 20, 2026

## Scope and acceptance

The owner explicitly requested implementation of the approved green phone-widget design. Add a native Android home-screen widget; keep the app and website in Lootsplit’s theme and never embed the phone screenshots. Show the real authenticated account beside Owner access, health, activity/app totals, analytics, recent GitHub development/deployment metadata and serving/installed versions. No fabricated CPU/traffic graphs or local coding activity. Cloudflare traffic remains Not connected because the runtime analytics credential is absent.

Baseline main/live7dff574b7bf5b078a9aa1fa1f17a1ce1aba0f66f (PR117, website release39408793196, Worker97393491-784d-4e8d-b417-481129cd19b9) was reconciled before edits. Its completed release is not repeated. Android1.7.0/code10 remains the current public APK until1.8.0/code11 is signed, inspected and published with matching website metadata.

## Implementation and preservation

- Original RemoteViews green grid/scanline layouts resize between compact and full details, with account/open and refresh targets. Android7/API24 remains the minimum; API31+ uses responsive sizes.
- Explicit owner connection reads the existing no-store owner endpoint. Android Keystore AES-GCM encrypts the native session/snapshot in noBackupFilesDir. Fixed canonical HTTPS only, redirects disabled, bounded response/time, generic errors. No token in widget host, PendingIntent, URL, log, backup or public asset.
- Current owner/session authority remains server-enforced before/after provider reads. Sign-out/account changes clear before the network operation; late401 replies only clear their own token. Generation checks reject older refresh/connect results. Failed reads clear displayed totals;401/403 disconnect. Remote revocation is discovered on a server check, not magically while offline.
- OS-managed updates request work every30minutes; JobScheduler waits for network and coalesces pending work. Manual refresh remains. Displayed snapshot/provider times qualify status; over-one-hour cached snapshots are hidden on the next render. The launcher may retain its last render while the OS delays work; dates remain visible.
- My account shows verified name/email, connection status and Connect/Add/Refresh/Disconnect controls. Widget taps use the router and existing draft guard. Launcher placement needs Android confirmation, with Widgets-menu instructions where pinning is unsupported. Removing the last widget disconnects it.
- Existing owner/admin controls, campaign data, auth model, account recovery, every game feature, six main destinations, Android identity and permanent signing certificate remain. No backend schema/data migration, provider-secret creation or production campaign mutation.

## Focused verification and environment

- Native account-transition regression:2tests pass, including clearing before sign-out, malformed late401 response bound to the old token, missing session/non-owner library clearing and owner preservation.
- Mobile account-control browser: actual component with synthetic bridge, connect/pin confirmation/refresh/disconnect/failure and320/390/1280 layouts pass. Screenshots inspected at390 and1280; no overflow or page errors.
- Full local unit run:1055 tests,1051 passes and four existing skips. Types and web/mobile builds pass. Capacitor sync made no unrelated generated changes. A subsequent lint scan found generated Capacitor bundles (already ignored by git) and two unnecessary test-string escapes; excluding only generated assets/Gradle outputs and correcting those quotes yields zero errors/39 existing warnings. Native plugin loading is deferred so website account reads gain no Capacitor startup dependency. Focused account tests still pass. The complete existing monitor browser audit also passes admin/owner permissions, revoked access clearing and desktop/mobile layouts.
- JDK21.0.12.1 and Android36 SDK/build-tools downloads independently matched source sizes and SDK SHA1 checksums. Local Gradle wrapper fails immediately with `java.net.SocketException: Network is unreachable`; proxy and IPv4 diagnostics give the same result. No local native compile or emulator pass is claimed. Native CI is the explicit gate for this environment gap.
- Added API24/API35 instrumentation tests for encryption/no-backup location, sign-out/account-generation races, missing/invalid source values, rejected HTTP statuses/redirects/oversize responses, and actual RemoteViews rendered at250/350/448dp including signed-out/offline/stale states. These must pass and their screenshots must be inspected before release.
- `android-widget.yml` adds native verification without removing the existing nine web preservation groups. Permanent-key signed publication depends on both the full preservation workflow and native checks. Do not claim an APK release from a debug build.

## Help and documentation review

Reviewed both DM and player Help. DM/account instructions explain Android1.8.0 setup, launcher confirmation, size/refresh, identity visibility and disconnect/revocation behavior; player Help retains owner-only restrictions and no DM setup links. Reviewed/updated README, Android release instructions, coding manual, inventory, recovery, versioned changelog and release notes. Android platform documentation is credited in Resources; no example code/art/screenshots copied.

## Release and performance checkpoint

Work is not yet published. Exact evolving local/remote head/tree, native jobs, PR/main checks, signed APK/certificate/checksum and website identity belong in the recovery checkpoint and PR metadata. The website release manifest stays at1.7.0 until the new signed artifact is independently verified.

Latest completed prior audit had1151 recorded slowdown observations and17 historical resolutions. Before full release, sync current performance history and analyze new qualifying>=15% entries, unresolved library/maps/world/standby trends and recorder freshness. Retain all historical evidence; do not reset a trend merely because a new run is faster. Native verification is new measured scope; no previous native-widget baseline or optimization claim exists. Initial refreshed history remains1151 observations/17 resolutions, with the new native/debug runs pending and no new qualifying entries yet. Check recorder freshness again after those runs and the release. Native checkpoint922736e/tree961c76a: verification39412443782 and debug build39412443706. Native-control browser already passes in current Chromium CI; native compilation/instrumentation is still running.

### First native checkpoint diagnosis

Debug APK run39412443706 succeeds, confirming actual native app compilation. Native run39412443782 passes current-Chromium account controls but both API matrix jobs fail before emulation at `:capacitor-cordova-android-plugins:checkDebugAndroidTestDuplicateClasses`. The unqualified Gradle instrumentation task also selected dependency-library test APKs, where generated Cordova tests pull incompatible duplicate Kotlin standard-library classes. Scope the new native verification commands to `:app:`: this still builds all app dependencies and every Lootsplit native/instrumentation source, lint and test, without accidentally running dependency projects’ own test APKs. No duplicate-class suppression, assertion removal or production dependency change. Preserve the failed run and require a fresh native checkpoint pass.

### Emulator checkpoint diagnosis

Second native run39412972974 passes native compile, instrumentation compile, unit tests and Android lint on both matrices. API24 and API35 both pass the widget data validation, private/bounded transport and encrypted storage/stale-generation tests. Two emulator assertions fail: the untouched Capacitor scaffold context test still expects `com.getcapacitor.app`, and the compact250dp view catches real vertical clipping on the footer button (44dp height plus top/bottom margins inside a44dp row). Update the expected identity to the unchanged actual Lootsplit package; replace only the buttons’ vertical margins with horizontal margins, retaining44dp targets. No test or assertion is removed. Capture the native bitmap before assertions so future layout failures retain visual evidence. Diagnostic artifact12260557852 SHA256acb5e27d144ce23bc183224512c34f51488a96d32353b0ec7c3f787b3441a665 contains the exact report. Full/compact visual approval still requires the corrected fresh run.

Freeze the corrected feature branch for complete PR verification together with native checks. Do not repeat the dependency-test failure or accept partial native green status as publication.

The initial launcher size is compact4×4/min300dp, so ordinary phone grids can place the widget; resizing to480dp reveals full details. Full detail rows fit that smaller height with unchanged content, and the initial/preview layout starts compact. This avoids requiring a seven-row launcher grid just to add the widget. Native layout tests use480dp full height and300dp compact height at all three widths.
