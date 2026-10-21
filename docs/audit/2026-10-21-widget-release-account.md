# Android1.9.1 release account verification

The candidate companion-discovery fix is merged in PR126 at e2fd48bb14efa1e4b7798fe3f186fd1b884eb889. Independent main39543917158 passes all nine groups. Signed workflow39543917155 fails development accounts before signing/publication; both native API24/API35 jobs pass. The last published Android remains1.9.0/code13. This follow-up changes verification only, with no app, schema, native, account-policy or campaign-data changes.

## Diagnosed critical path

The failed account artifact12321450029 is independently SHA256-verified as127681a4c14bdb5e8c705b49b9f981c969eee8149c1f00293c03c188e2900243. Passing main artifact12320991560 is8a99b8dfb1e254a3d101c5db0e24a135cbb5c9bf960c95c9ec213e9de4d382b2. The failed ownership trace reaches its final fresh player reload with all preceding ownership assertions passed. Its first cold application wait takes6.159s; the initial guest entry and the expired-invitation entry each add several seconds after independent DM work has already finished. The passing main ownership case is57.373s; the failed case records62.606s including teardown after the60s limit. This is evidence of insufficient test timing margin, not a demonstrated production authorization failure.

The full passing main account suite is157.708s. The release copy reaches170.001s with nine passes, one ownership timeout and two unfinished cases after restarting the failed worker. These are distinct workflow contexts, not a verified before/after speedup. No trend is resolved from this comparison.

Extract the existing create-room and save-membership portions without changing the default combined helper. Ownership captures the real invitation, then overlaps its anonymous cold entry with the DM’s real Save membership and navigation. Both complete before joining. After reopening is acknowledged, overlap the anonymous expired-link read with the DM’s real startup/fresh-invitation read; prove expiry before guest signup. Preserve every original Save, title, cold-load, network-boundary, memory, revocation, sign-in, account-resume and final DM-tab-close/reconnect assertion. Other eleven scenario bodies are unchanged. Keep two workers, zero retries,60s case and170s suite limits. No browser prewarming, fabricated response, forced click or production change is introduced.

The Android pipeline also explicitly requires successful independent main-push verification for the exact current commit and latest run attempt before signing. Its own full and native checks remain prerequisites. Bounded polling reads metadata only; wrong repository/ref/workflow/commit, failed runs, missing/skipped preservation gates, stale main and timeout all refuse signing. Current-main checks before signing and publication remain.

## Local verification and release requirements

Node22.23.3 and existing locked dependencies are reused. The full focused account run starts its disposable server but cannot launch Chromium because the locked executable is absent. The prior installation was blocked by OS dependency permissions and the direct official download returned Site Unavailable HTML. No local browser pass is claimed, and those failed access paths are not repeated. CI must verify all12 scenarios against development, immutable Worker and standby, including native Chromium network isolation. Four new focused publication-gate tests pass. Complete Node22 quick verification passes with clean type checking and lint0errors/39existing warnings. Exact-head CI outcomes remain required and are recorded in the PR/checkpoint once complete.

Both role Help guides, feature inventory and widget instructions were reviewed; their product behavior remains accurate because this follow-up changes only verification. README now includes the previously omitted resume-partial scenario and correct12-scenario count. The manual and recovery document record the actual ordering and publication gate.

## Performance review

Synchronized history at this review retains1,335 regressions and18 resolutions, with no stale resolution requests. Recorder39543794136 passed; pending main/signed runs and historical37642398740 remain visible in the snapshot. The ten entries since the initial picker baseline are retained below; no reset is requested. Subsequent completed-run observations require follow-up review before final release.

| Operation | Last reference → recorded | Added | Increase | Assessment / next action |
| --- | --- | --- | --- | --- |
| API35 Node setup,39539033689 |6→7s|1s|16.67%|Runner/cache setup; three rises3→7s,+133.33%; retain pending comparable verification. |
| API24 artifact upload,39539033689 |1→2s|1s|100%|Additional picker evidence and one-second metadata resolution; not app execution. |
| API35 mobile controls,39540030574 |2→3s|1s|50%|Changed signed-out placement assertions; retain new coverage and measure complete final gate. |
| Worker monitor,39540030567 |11→13s|2s|18.18%|Successful same-scope observation after prior resolved obsolete assertion; no new cause established. |
| PR typecheck,39541582532 |23→27s|4s|17.39%|Six historical rises7→27s,+285.71%, with larger source/coverage and a failed prior reference; no proven cause or reset. |
| PR code/build job,39541582532 |144→172s|28s|19.44%|Five rises48→172s,+258.33%; coverage/build growth and setup remain mixed. Total workflow effects must use elapsed time, not summed jobs. |
| Worker interface Node setup,39541582532 |7→9s|2s|28.57%|Three rises2→9s,+350%; environment setup, preserve history. |
| Worker interface Chromium install,39541582532 |26→31s|5s|19.23%|Two rises20→31s,+55%; download/setup variation, no product slowdown established. |
| Development downtime,39541582532 |48→57s|9s|18.75%|Successful unchanged scenario; monitor runner/runtime variation, no fix claimed. |
| Worker Help,39542314872 |58→69s|11s|18.97%|Successful expanded widget/Help coverage; keep assertions and investigate if comparable final run remains slow. |

Previously unresolved monitoring/picker trends remain open. The release account failure is addressed by independent-read ordering, with timing improvement unverified until complete comparable CI. Native picker work/profile changes are not equivalent to historical render-only checks. Physical-device discovery, battery/Doze delivery and private production telemetry readback remain separately unverified.

## PR127 verification checkpoint

PR127 merged as43906256b19f64d4634b596cd9f980e7f57c11f0 after exact sourcea003aac50a14c6bf864c594d1024ffec2010125a/tree9e14b388fc3871b8cbe8fb7410663504499dca4d passed all-nine39545769398, native39545769379 (13 cases each API24/API35) and focused references39545769364. Actual picker discovery succeeds. Development accounts12/12 pass in104.555s, ownership36.251s; artifact12321806716 independently matches8ee726f4eb666650b150ad4fd5cdd5e362a7a23d8feb25543beb2171d3f93808. Read-only actual GitHub metadata also verified that the new independent-main gate accepts completed run39543917158. Main and signed final gates remain independently mandatory.

Independent main39546976583 passes all nine groups at4390625. Signed39546976796 passes its full preservation/native gates and the new independent-main guard; the signing/actual-upgrade gate is the remaining publication prerequisite at this checkpoint. Full development-account elapsed times are131.8s/163.7s respectively, with all12 scenarios. The signed run's narrow170s margin remains explicitly documented in the performance review. Website39548100737 and standby39548100751 successfully deploy this source; website download metadata still correctly advertises1.9.0 pending signed-byte verification.

## Signed publication verified — October21,2026

PR127 merged as4390625 after all-nine39545769398, native39545769379 and reference39545769364 passed. Independent main39546976583 and signed39546976796 pass; signing also requires the exact-main guard. The actual permanently signed1.9.0→1.9.1 upgrade, both real picker entries and companion Add/binding pass without opening MainActivity/My account. Upgrade artifact12322793065 was independently downloaded/hash-verified and its picker/placed screenshots inspected. The public APK, checksum and signing artifact match byte-for-byte, and independent apksig/compiled-manifest/resource inspection verifies the permanent certificate, APK-v2 integrity, package1.9.1/code14, both providers, optional configuration and no debug host/permission. See [release evidence](android-widget-picker-release-evidence.json). Website manifest publication follows its own complete gates. The physical phone/OEM report remains unverified; this is emulator proof plus defensive discovery recovery.
