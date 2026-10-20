# Android Field monitor manual refresh — October 20, 2026

## Failure and acceptance

The owner reproduced Android1.8.0 Refresh remaining at “Refresh queued · waiting for network” until opening My account. The production/account read worked when reconnecting. Source confirms the manual broadcast cleared its snapshot and queued the same ordinary JobScheduler job as the automatic update; an existing pending job was not promoted. The displayed network wording was not evidence of failed connectivity or an invalid analytics token.

Acceptance: press the actual RemoteViews Refresh PendingIntent with no resumed activity, start one bounded read immediately, retain the dated identity/totals during that read, show the fresh result, and do not open/reconnect My account. Repeated taps coalesce. Failed/timed-out requests retain explicitly dated cache and offer retry; owner rejection, sign-out and account switches still clear/reject private data.

## Implementation and preservation

Android1.8.1/code12 uses the existing foreground broadcast plus `goAsync` and a shared eight-second completion deadline. A fixed executor performs the existing bounded, fixed-HTTPS/no-redirect/no-store fetch. The deadline completes all waiting broadcasts and ignores late network results even when a socket ignores interruption. Automatic checks retain their OS-managed JobScheduler cadence and share the same active check. Stopping an automatic job does not cancel a user tap that joined it. No foreground-service permission, notification, alarm, new dependency or account activity is needed.

Last readings remain date-labeled during refresh/error, use amber Refreshing/Last known status, and retain the existing one-hour render limit. Storage remains Keystore AES-GCM under noBackupFilesDir; callbacks retain account-generation isolation. Auth rejection still disconnects. The native account Refresh control now resolves only on completion and reports a bounded error. No endpoint, credential setup, campaign, gameplay, financial, permission or save format changes. Provider data can still be cached server-side for five minutes.

Both DM and player Help reviewed: DM owner guidance describes direct refresh/cache/timeout behavior; player guide retains the owner-only restriction. README, Android instructions, development manual, feature inventory, changelog and candidate release notes updated. The Resources page already credits the Android advanced-widget documentation used here. Phone screenshots remain evidence only and are not shipped.

## Verification

Local Node22.23.3 locked install succeeded. `verify:quick` passes with zero errors (39 existing lint warnings); mobile build and Capacitor sync pass. The actual account component's synthetic-native bridge passes connect/pin/refresh/disconnect/failure and320/390/1280 layout checks;390/1280 captures visually reviewed. Final-source timings and additional refresh-error verification are recorded in the PR checkpoint.

Native compilation is locally blocked: JDK21 and SDK36 are present, but the Gradle wrapper download fails `java.net.SocketException: Network is unreachable`, including with the environment's supported proxy setup. No local emulator/native pass is claimed. The ordinary Playwright browser download is truncated by this environment; a retained launchable Chromium153.0.8010.0 is used for diagnostic controls, while CI retains its locked browser. No release gate is weakened.

Native instrumentation extends existing storage/transport/layout checks with actual widget button taps and no resumed activity, immediate source invocation, repeated-tap coalescing, retained cache, successful new totals, transport failure versus auth denial, and a real eight-second timeout with an ignored-interrupt late response. Exact-head API24/API35 compilation/lint/instrumentation plus all-nine PR/main gates are required before permanent-key signing. Independent signed APK inspection and matching website metadata/download remain required after publication; physical-device installation is not claimed.

## Performance baseline review

Read data branch86ee86a1ee19b9cf9818c7c728207f36bad400aa:1239 observations,17 resolutions; recorder39452382848 succeeds and no newer observed timings change the retained duration references. Cursor13:21:44.964Z and old pending37642398740 are preserved. Prior main39427491199 elapsed826s versus782s (+44s,+5.63%) is below the15% threshold. Its newest logged steps remain lint13→15s (+2s,+15.38%), Worker monitor11→13s (+2s,+18.18%) and Worker blacksmith41→48s (+7s,+17.07%). These are build/audit observations, not phone refresh latency measurements. No comparable before/after device refresh timing exists; the observed defect is deferred scheduling, not a measured network speed regression.

Unresolved repeated trends include library34→46s (+12s,+35.29%,2 increases), development maps35→169s (+134s,+382.86%,4), standby20→105s (+85s,+425%,5), PR Worker maps17→112s (+95s,+558.82%,4), main Worker maps20→115s (+95s,+475%,3). Prior coverage growth, cold provisioning and runner variation remain relevant; this focused native repair does not establish their causes or resolution. Preserve history and automatic inclusive15% capture, review this release's new observations after completion, and diagnose any failed case/timeline before retry. No trend reset is justified here.

## Native proof and diagnosed release-check failures

PR121 head6401db45fe95f8ab40d544de0ceb732a77a0fe5d passed all nine groups in39454444650 and native matrix39454444495 (eight tests each on API24/API35). Native artifact digests: API24 `09987745a33b4037193a36dfff7300845b3f0a8cc192f28534dfba7117c02bfe`; API35 `1e9aee3f8ab6ee7c1032325bb91e5c6796199eaf9eead425a105be8a8f7729d9`. Loading, dated-cache and fresh snapshots were visually reviewed. Merge5986a8326b73fcb332b93655496c0b7910f68ab1 retains tree15c1bc3daafe4c9c9b51db5fda48f0a3252ebf09.

Main39456470233 and signed39456470380 both exhausted the170s account aggregate, with10/11 completed cases respectively and no individual failed assertion. The identical PR tree completed12 cases in145.961s. Main immutable Worker accounts passed12 in101.844s; standby passed12 in approximately79s. Main/signing native again passed both APIs. Signing remained skipped;1.8.0 is still the published APK. No failed run was blindly retried.

Failure ZIPs were independently hashed: main12281377269 `6e264ba029299e4f423d292ee740901a3e07f42796ac96db50cebb45effa80c9`, signing12279973286 `87b193f9ab5aa887b60dddfe1e1a2d71d00a234b9aed7bc744276ae19bbfc1e3`. Per-case timelines show broadly slower development execution, not one stuck assertion. Ownership rose50.272→59.768s, portrait41.353→47.115s and queue32.660→41.271s; the last two cases had insufficient aggregate time. Installation was outside the measured test interval; root readiness already followed the redirect. No cold client preloading was introduced. The exact host-level reason for runner variation is unproven.

A disposable local Node22/Chromium153 trace diagnostic retained all12 tests and deadlines, enabled trace recording only in its frozen temporary copy, and passed in130.064s (130.871s wrapper). It identified15 repeated optional Help-offer clicks consuming23.321s across cases; cold startup hydration also remained measurable. These are summed case waits, not equivalent wall-clock savings with two workers. The fixture now treats each synthetic account device as having already answered optional Help, consistent with the ownership scenario. The Help audit explicitly verifies the initial offer, real dismissal, saved preference, cold-entry dismissal persistence and later manual Help at desktop/mobile widths. Account test bodies/assertions, startup screens, cold recovery entries, two workers, both deadlines, zero retries, exact-origin native/fallback boundary and no-store account reads are preserved. The origin guard avoids writing storage in about:blank, where access is unavailable.

Main Worker map auditing separately reached a closed menu before Hide interface at map-workspace-browser-check.mjs:97. The routine router return can retain an open menu; the unconditional toggle could close it. The fixture now checks aria-expanded, opens only when closed, and asserts open before the existing Hide/Show assertions. Product behavior is unchanged. Full focused verification and fresh CI are required for these fixture corrections.

### Release-check performance review

History f97fc6b7a32a39621030d88a353b05c7372fb91d has1266 observations/17 resolutions, cursor16:33:03.653Z, retaining pending37642398740. The27 new observations since the prior review are below; setup, execution and job elapsed are separate measurements, not additive. The account aggregate investigation above and map toggle correction address the failing checks. Other increases remain observations (including runner/setup variation and earlier coverage growth), without an invented causal attribution or reference reset.

| Run | Operation | Previous → current seconds | Increase | Outcome |
| --- | --- | --- | --- | --- |
| 39454345394 | step: native-widget (24) / Run android-actions/setup-android@v3 | 15 → 18 | +3s, +20% | success |
| 39454345394 | step: native-widget (35) / Run npm run build:mobile && npx cap sync android | 7 → 9 | +2s, +28.57% | success |
| 39454444452 | queue: Focused player references / initial queue | 124 → 199 | +75s, +60.48% | success |
| 39454444495 | step: native-widget (35) / Compile native app, instrumentation and lint | 137 → 173 | +36s, +26.28% | success |
| 39454444495 | step: native-widget (35) / Verify owner isolation, refresh transport and actual RemoteViews layouts | 148 → 184 | +36s, +24.32% | success |
| 39454444495 | workflow: Android native widget verification | 354 → 431 | +77s, +21.75% | success |
| 39454444495 | job: native-widget (35) | 350 → 430 | +80s, +22.86% | success |
| 39456470380 | step: native / native-widget (35) / Set up job | 2 → 3 | +1s, +50% | success |
| 39456470380 | step: native / native-widget (24) / Set up job | 2 → 3 | +1s, +50% | success |
| 39456470380 | step: native / native-widget (35) / Run actions/checkout@v4 | 1 → 2 | +1s, +100% | success |
| 39456470380 | step: native / native-widget (24) / Run actions/setup-node@v4 | 5 → 7 | +2s, +40% | success |
| 39456470380 | step: verify / Development / gameplay (balanced v2) / Run actions/setup-node@v4 | 5 → 8 | +3s, +60% | success |
| 39456470380 | step: native / native-widget (35) / Run android-actions/setup-android@v3 | 13 → 15 | +2s, +15.38% | success |
| 39456470380 | step: verify / Development / gameplay (balanced v2) / Run npm ci | 16 → 19 | +3s, +18.75% | success |
| 39456470233 | step: Development / accounts / Run npm ci | 19 → 23 | +4s, +21.05% | success |
| 39456470380 | step: verify / Development / desktop (balanced v2) / dev-ships | 62 → 73 | +11s, +17.74% | success |
| 39456470380 | step: verify / Packaged Worker / accounts (balanced v2) / Set up job | 1 → 2 | +1s, +100% | success |
| 39456470380 | step: verify / Packaged Worker / interface (balanced v2) / Run actions/setup-node@v4 | 4 → 5 | +1s, +25% | success |
| 39456470233 | step: Packaged Worker / interface (balanced v2) / Run actions/download-artifact@v4 | 4 → 5 | +1s, +25% | success |
| 39456470380 | step: verify / Packaged Worker / interface (balanced v2) / worker-initiative | 4 → 6 | +2s, +50% | success |
| 39456470233 | step: Development / gameplay (balanced v2) / dev-finance | 58 → 67 | +9s, +15.52% | success |
| 39456470380 | step: native / native-widget (24) / Compile native app, instrumentation and lint | 146 → 171 | +25s, +17.12% | success |
| 39456470380 | step: verify / Packaged Worker / interface (balanced v2) / worker-shop-stock | 11 → 15 | +4s, +36.36% | success |
| 39456470380 | step: verify / Development / gameplay (balanced v2) / dev-property-operations | 30 → 35 | +5s, +16.67% | success |
| 39456470380 | step: verify / Development / desktop (balanced v2) / dev-map-tiles | 141 → 166 | +25s, +17.73% | success |
| 39456470380 | step: verify / Development / desktop (balanced v2) / dev-world-features | 116 → 134 | +18s, +15.52% | success |
| 39456470380 | job: verify / Development / desktop (balanced v2) | 566 → 748 | +182s, +32.16% | success |

Corrected local trace diagnostic:12/12 pass in116.035s versus130.064s, saving14.029s (10.79%) under the same fresh-copy/cache, Node/browser, two-worker and trace-on setup. The intermediate unguarded init script exposed about:blank storage denial; origin-scoping corrected it, and the full network-boundary/error assertions pass. This is local diagnostic evidence, not a substitute for CI or a performance-reference reset. Recorder39458415961 succeeded.

The full Help/player-reference audit passes at1280/390 in72.336s. The complete map audit passes both widths in160.403s (159.863s inner flow), including the corrected menu, connected services/encounter return, player permissions, overlays, display, reload, guest-memory and pixel-fog scenarios. These ran sequentially after the account diagnostic on the same frozen disposable server; they are not comparable to isolated/cold CI stages. Syntax and whitespace checks pass.

## Resumed release verification and performance review

Main75270080608878abd594ea2c8198b3990fdb58b0 passed all nine groups in39462543939. Immutable website39465165804 and standby39465165939 succeeded; readback matched the serving commit. Signed1.8.1 workflow39475576975 was dispatched on that current main. Evolving publication state stays in PR122 and the download follow-up PR; do not repeat dispatch.

History9ec815bb5caead86c0b6fa962117fa65ee06e64f contains1275 observations and17 resolutions, cursor17:22:31.249Z. Recorder39469134815 succeeded; only historical pending37642398740 remains. All nine new qualifying observations since1266 are retained below. No reference reset or history deletion.

| Operation (main39462543939) | Previous → current | Added | Increase |
| --- | --- | --- | --- |
| [Code checks and immutable builds / Run npm ci](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 19s → 22s | +3s | 15.79% |
| [Code checks and immutable builds / unit-tests](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 38s → 54s | +16s | 42.11% |
| [Code checks and immutable builds / typecheck](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 27s → 38s | +11s | 40.74% |
| [Code checks and immutable builds / lint](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 15s → 20s | +5s | 33.33% |
| [Code checks and immutable builds / Generate current source function inventory](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 23s → 28s | +5s | 21.74% |
| [Code checks and immutable builds / web-build](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 9s → 12s | +3s | 33.33% |
| [Code checks and immutable builds / mobile-build](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 7s → 9s | +2s | 28.57% |
| [Code checks and immutable builds](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939/job/118765449249) | 140s → 293s | +153s | 109.29% |
| [Verify preserved functionality](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/39462543939) | 917s → 1108s | +191s | 20.83% |

All nine entries have successful current outcomes. The workflow reference917s was a failed historical run, so its20.83% increase is preserved as the recorder comparison, not a successful-run speed claim. Against previous successful main39427491199 at826s, final main1108s is282s slower (+34.14%). Code/build completion took293s; all three dependent packaged runners started275s later, then the longest packaged job took529s. This observed scheduling gap explains275s of elapsed waiting; its infrastructure cause is not proven. The individual unit/type/lint/build increases remain visible and are not explained away by that gap.

Unresolved main trends include unit-tests11→54s (+43s,+390.91%,7 logged increases), typecheck12→38s (+26s,+216.67%,5), lint7→20s (+13s,+185.71%,5), code/build job71→293s (+222s,+312.68%,5), and full verification205→1108s (+903s,+440.49%,4). These spans include earlier coverage growth and variable runners; this metadata release changes no application code or workload. Preserve the account Help-wait diagnosis above and follow repeated same-workload stage increases with profiling. No trend is established as resolved by one faster run.

Documentation review: both DM and player Help remain accurate for direct1.8.1 refresh, dated cache, retry and owner-only access; no instructions or permissions change in the download follow-up. README and the feature inventory now acknowledge the native widget already shipped in1.8.0. The coding manual and Android signing/publication procedure remain accurate.

### Signing-run emulator installation failure

Signed run39475576975 attempt1 API35 passes all eight native cases (11.695s) plus mobile account controls. Its hash-verified artifact12288578489 has ZIP SHA2563caf0164bfbd735bf146e91aae93c61fe77e38d7efacd5563ff90b4296b1ee5d; refreshing, updated totals and cached-error captures were visually reviewed.

API24 job118810534367 compiled/linted successfully but ran zero tests: the emulator console failed to start and Ddmlib could not install-write the debug APK. It provides no widget assertion result. Failed artifact12289926407 is retained and independently SHA256-verified as14d84a44ba7cea392266a86a5831c445bd279542883ab94181964238f99f67b4. This is a device/install-stage failure; no APK incompatibility code or application assertion failure is reported. The same native source passed API24 in PR121 and the earlier signing run. A single targeted fresh-runner retry is appropriate after remaining independent jobs finish; preserve all passed groups and every original deadline/test. Repeated installation failure requires further diagnosis, not a retry loop.

The signing attempt's complete preservation workflow passed all nine groups. API24 alone was retried as job118817769990 in attempt2, retaining API35 and all successful verification. Local follow-up quick checks pass in54.467s:1051 tests passed/four existing skips, types clean, lint0errors/39 existing warnings. No application code changed; the final download manifest receives focused checksum/header/changelog tests after independent APK inspection. This fresh locked-install isolated measurement is retained as an initial local reference; the earlier four-concurrent-check and warm913-test histories remain separate, without a speedup claim or reset.

The single fresh-runner API24 retry passed all eight native cases in9.144s, confirming the pre-test install failure did not recur. Artifact12290296409 independently matches ZIP SHA2567fe1ba85f267ff4bc6dde10f453531b3a07aa2177d386f6b2460bc50f2aab198. Signing job118821230939 then started under the original full/native gates. No emulator requirement, test, application code or timeout was changed.

## Signed APK and download follow-up

Signed run39475576975 attempt2 succeeded and published release418754556/asset660193877 at18:57:02UTC. Independent public-download inspection and signing-artifact12289854015 comparison verify28,012,900bytes and SHA2565a700656ad11aa03a556bf9a392ee0687a3395273887a1b9700e34e01773d755. Artifact ZIP SHA2569a5b35f54ef451c5379ccdf22a26f9248bea80ee7d986072fa1b4059100906e5 matches its declared digest. The separate public checksum file agrees.

Apksigner verifies the permanent certificate and v2 content integrity; aapt verifies package/version/code and registered widget provider. The initial diagnostic assumed original resource ZIP paths; the release optimizer shortens them. Resource-table inspection resolves layout/owner_widget→res/b8.xml and xml/owner_widget_info→res/iJ.xml and confirms both packaged files and manifest registration. DEX inspection retains WidgetRefresh/WidgetStore/provider/plugin/SaveFilePlugin, rejects the obsolete queued message and synthetic test credentials, and retains all three CC0 sounds. This corrects the diagnostic assumption, not the release APK. Physical-device installation is not claimed.

The follow-up changes release.json only after this inspection, retains earlier release history, and removes stale design-only wording from README/inventory. Complete PR/main, immutable website/standby, exact live identity/assets, desktop/mobile and streamed1.8.1 APK checks remain required before declaring the website update complete.

### Download follow-up: partial-queue fixture race

PR123 first head397b9e7abb48d52bb8459f76a3e706ffcd5da0ac failed standby job118825836850 in run39479706328:11 account cases passed; resume-partial failed its15s Retry locator, not the aggregate deadline. Retained artifact12290593099 independently matches SHA25623d9c1aa57431e3412f8ccb6dc3888f71020555845cf24c589960df2fce21b4b. Trace times show the desktop submitting the remaining command at14128ms and the phone receiving its acknowledgement through normal polling at14185ms. The phone initially attempted a click behind fixed navigation; before Playwright's next scroll attempt, successful reconciliation removed Retry. Both final screenshots correctly say Saved to room. This is a fixture-ordering race, not lost pending work or an Android refresh failure.

The case now centers the real Retry controls above phone tabs and holds only the two matching command submissions until both actual clicks occur. It then forwards unchanged requests to the real server and retains every existing queue, new-receipt, saved-state and screenshot assertion. Polling, permissions, cold entries, no-store, native/fallback network isolation,12 scenarios,60/170s bounds,two workers and zero retries remain. The temporary route is removed after its submission forwards; an initial local diagnostic exposed early-unroute handling, corrected before submission. No forced click, mocked success, product layout or application behavior changes. Both role Help guides and the feature inventory were reviewed with no changed user capability; the coding manual now documents the transport barrier. Focused resume-partial passes in19.0s. Full local account and fresh exact-head PR/main/immutable/live outcomes are tracked in PR123.

Full local accounts pass12/12 in108.413s with the same60/170s deadlines,two workers and zero retries. This is a fresh disposable copy/cache on Node22.23.3/diagnostic Chromium153 with retain-on-failure tracing; the earlier130.064s reference used trace-on in a different workspace, so it is not a comparable speed claim. A new local environment reference is recorded without resetting any prior trend. The final handler is scoped to the exact disposable origin so it cannot override the external-network boundary; the final exact-origin focused follow-up passes in18.8s.
