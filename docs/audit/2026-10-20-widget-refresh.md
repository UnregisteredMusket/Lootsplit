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
