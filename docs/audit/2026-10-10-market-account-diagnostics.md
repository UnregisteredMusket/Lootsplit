# Account diagnostic evidence — October 10, 2026 UTC

This report records parallel diagnostic evidence collected during the campaign market completion. Release source and local diagnostic test source are explicitly distinguished below.

## PR85 account aggregate follow-up

Initial exact-head verification [38022072870](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38022072870), attempt 1 at `31f6f8d7a8cf125175aba85208bcbdbbd8f75586`, failed the development account aggregate. Eleven scenarios passed; `shared-recovery` was unfinished when the existing 170-second suite deadline expired. There was no individual assertion failure or 60-second case timeout. Its start at offset 156.960 seconds left 13.040 seconds, while that case had taken 13.380 seconds in successful main84. The 170.9-second wrapper remains a failed result. All seven other substantive groups passed, including both expanded market audits (63.6 seconds development, 34.6 seconds Worker), both existing location/import audits, and all twelve Worker and standby account scenarios. The final verify gate correctly blocked merging.

The failure artifact `11657973967` (SHA-256 `f0f8b82ee814f9c826793a0e46049f9be01db10a8f1e2931b03632e320b22b2e`) retains results, screenshots and server output. No trace ZIP survived aggregate teardown. Matching completed cases grew 36.03% on one worker and 30.79% on the other versus successful main84; the median case increase was 32.91%. Gaps between cases were negligible. CI installation/setup is outside the suite; Vite readiness changed only 1,925 to 2,117 ms, and the server logs contain no per-request/transform timings.

Read-only cross-runner comparison does not show a uniform new slowdown. PR84 and main84 have identical complete tree `a3f5fa7e740773fef33efe664b8caff546462ab2`, yet their six development governance audits total 274 and 203 seconds; PR85 totals 276 seconds. Unchanged development gameplay audits total 311/368/397 seconds across PR84/main84/PR85, while unchanged Worker interface audits total 246/249/227 seconds and Worker accounts 101/99/97 seconds. These are sequential execution totals inside each named job, excluding setup and the expanded trade workload; parallel jobs are never summed. Standby's whole wrapper is 77/80/97 seconds. This establishes observed variation across runs and environments, not a proven host-level cause.

### Source and fixture diagnostics

Account endpoints, account hydration, fixtures, scenario order, Vite configuration and dependencies are unchanged at the initial failed head. Static local-source traversal finds one new common module, `ledger-reversal.ts` (19,799 raw bytes). The account source closure grows 979,024 to 1,001,970 bytes (+2.34%). This is a source-size measurement, not an execution-time attribution. New receipt/archive/manager work is guarded by trade data or actual trade actions absent from account fixtures; no new general normalization pass was found.

Two controlled source comparisons use immutable `f640e6d` and `31f6f8d` archives, identical installed Node22/Chromium133 dependencies, the unchanged complete layout scenario, a fresh disposable Vite server per source and one full warm-up before each measured invocation. The configuration still allows two workers; one selected scenario uses one active worker and its independent device contexts. Chromium133 exercises the safe routing fallback, so these are diagnostic measurements and do not verify the current browser's native path.

| Source comparison order | Released-source selected suite | Market-source selected suite | Market increase |
| --- | ---: | ---: | ---: |
| Released, then market | 12.062953 s | 14.626696 s | 2.563743 s / 21.2530% |
| Market, then released | 13.419188 s | 14.248345 s | 0.829157 s / 6.1789% |

All four complete cases passed. The first pair's actual case durations were 11.344/13.561 seconds; reverse-order cases were 12.579/13.488 seconds in released/market order. Warm-up selected-suite durations were nearly equal within each pair: 18.978419/18.961650 and 16.859992/16.763562 seconds in released/market order. Every cold public/account visit added exactly one script/source request for the new module. Extra time was spread across cold visits, and some individual current-source visits were faster. The first qualifying increase remains recorded; the smaller reverse comparison neither erases it nor proves a CI host cause. The broad CI growth is not attributed to the new module without request/CPU profiling.

Focused fixture instrumentation confirms redundant work before the primary device is used. The full DM-resume A/B preserves every original assertion: selected-suite duration 32.411958 to 32.098523 seconds (0.313435 seconds / 0.9670% lower), actual case 31.395 to 30.799 seconds (0.596 seconds / 1.8984% lower). It removes one 280-script primary document, but the wall benefit is small because initial device loads overlap. The original library's unused intermediate account navigation takes 1.481 seconds; the startup queue's unused account refresh takes 2.707 seconds while overlapping the required other-device refresh. Those intervals are not added and presented as a predicted CI saving.

### Narrow fixture correction

Only `scripts/browser/account-fixtures.mjs` and `scripts/browser/account.spec.mjs` change executable verification source:

- `dm-resume` and `portrait-resume` explicitly defer their unused primary account document until after the other device saves its room. Real signup/sign-in, distinct contexts, the secondary cold account and the primary's first actual cold account remain. The explicit primary **Sign out** assertion moves to that first use. Every other helper caller retains its existing default setup.
- The queue startup branch reuses its already signed-in primary account document only to inject the acknowledged queue. It checks the actual route and Sign out, retains `guestAccessAudit`, and still cold-loads `/` to fetch memberships and use the real campaign selector. The account branch retains its actual account refresh.
- The library scenario navigates through the existing real-link helper directly from its restored desk to `/share`, removing an intermediate account page with no independent action. Backup/restore, shared save and other-device freshness/resume assertions remain.

Independent review confirms preservation of required cold documents, account freshness, actual router navigation/no-title checks, both network-isolation modes and deliberate fault routes. All twelve scenarios, their ordering, 60-second case and 170-second aggregate deadlines, two workers, zero retries and full release gates remain. No application or frozen market audit source changes. The diagnosed repeated fixture work is removed; these diagnostics do not establish or resolve every contribution to CI variance. Complete exact-source verification, rather than a local timing improvement alone, determines release readiness.

### Corrected local verification and performance follow-up

The complete local Chromium133 fallback run of the narrow two-file patch failed, with 10 cases passed and two unfinished at the unchanged 170-second aggregate. The selected suite took 170.003025 seconds; the whole focused runner took 179.169 seconds from 04:21:42.565 to 04:24:41.734 UTC. Startup, runner and cleanup outside the selected suite total 9.165975 seconds; that boundary is not a separately measured startup duration. No individual assertion failed. All four changed scenario bodies completed, which is not a full-suite pass.

The earlier successful 03:07 local account checkpoint identifies `24d386ded42d38bab983731523489b21aeab75a0` with `dirty: true`, representing the reviewed release candidate. It is not a clean f640 archive. Comparing that local run with the failed133 run shows the first four completed cases at 87.909 to 91.422 seconds (+4.00%), but the next six at 158.410 to 221.984 seconds (+40.13%). Its full runner was 151.348 seconds and selected suite 141.992659 seconds. Only the separate archived layout comparison above establishes exact immutable f640-versus31f6 source identity.

Raw local Playwright trace/network records survived even though aggregate teardown attached no trace ZIP. Sanitized summaries retain counts and timing only, excluding request bodies, cookies and credentials. On the unchanged secondary queue device, both runs contain six cold navigations, 17 readiness waits, 32 clicks, 60 assertions, 38 evaluations and four screenshots. Summed readiness waits grow 7.452 to 12.103 seconds, clicks 6.480 to 9.779, and assertions 9.407 to 15.026. Median source request duration grows 25.035 to 42.921 milliseconds; the largest single observed call is 3.198 seconds. Campaign-choice also has identical operation counts with slower distributed readiness/request timings. This narrows the observation to broad execution growth rather than one stalled assertion; it does not prove the cause of CI or local variation.

A separately installed official `@sparticuz/chromium@153.0.0` package supplies an executable reporting **153.0.8010.0**, SHA-256 `53a15d6c3a3d27dfb54c4ba60278b1683136f70cf1e67e989da7dfbd3d451ef0`. Its native ordered URLPattern capability and doctor check pass. This diagnostic browser is separate from the locked CI **153.0.8010.12** distribution. No repository dependency, browser lock, network boundary or timeout changes.

The original complete `npm run verify:focus -- accounts` then passes all 12 scenarios with this native-capable browser, including network-boundary, with zero skips, flakes or assertion errors. Selected suite: **132.472311 seconds**. Whole focused runner: **141.119 seconds**, 04:34:17.433 to 04:36:38.552 UTC. Combined startup/runner/cleanup outside the selected suite: 8.646689 seconds. All limits remain 60 seconds/case, 170 seconds/suite, two workers and zero retries. A subsequent full `verify:quick` exits zero: 863 tests, 859 passed/four existing skips, clean types, zero lint errors and 30 existing warnings. That quick command's wall duration was not instrumented; no timing comparison is claimed.

This native diagnostic executed base `31f6f8d7a8cf125175aba85208bcbdbbd8f75586` **with the approved two-file uncommitted patch**, not a clean31f6 checkout. Exact post-run hashes:

| File | SHA-256 |
| --- | --- |
| `scripts/browser/account-fixtures.mjs` | `0b51f500a37598fe6912bddd240c6ff921895b8e43cb07780c4832194584c862` |
| `scripts/browser/account.spec.mjs` | `d3b41cc6a3557144a9cfc1ba7dc26b71b2d37c19c3d63e8a84329fc1da18839a` |

The complete native result is a changed diagnostic environment. It does not replace or resolve the failed133 reference, the source-layout qualifier, or exact locked-browser CI gates.

### Recorded observations

Fresh history `3fd382a5f29e81f72211c9d6dd3265e923b9dce9` contains 753 observations, 686 references and 17 resolved records, with capture cursor 04:37:54.848 UTC. The two previously prepared market manual entries and both main84 resolution requests are now imported. Development accounts reset explicitly to the verified129-second main84 result and Worker locations to46 seconds after the recorded Retry-fixture fix. These accepted resolutions preserve the earlier trends and do not assert that every subsequent run is healthy.

New observations since the earlier751-observation snapshot are the imported local expanded market audit (61.293 to73.262 seconds, +19.53%) and PR38024228460 Worker-interface artifact upload (3 to4 seconds, +33.33%). That one-second artifact-upload difference is outside application audit execution. Current independent main was still in progress at capture. Old pending run37642398740 remains; no old evidence is deleted.

The isolated warmed source-layout scope had no comparable prior reference. CLI recording therefore appends initial `local:42be5fc4-5345-410d-a647-88999db43fa0` (12.062953 seconds), followed by qualifying `local:6c45278c-7c59-4874-9e4f-c02984a00924` (14.626696 seconds, +2.563743 seconds / +21.2530%). Both reverse-order inputs are below the retained reference and append nothing. The next threshold is16.8207004 seconds. Timestamps use raw Playwright start/duration with the finish explicitly derived; case timings and warm-ups remain separate above.

Initial `local:a0ebd569-ff53-4b0e-b9de-a74830966c85` records the141.119-second complete native153 focused wrapper in its distinct environment scope. This is an initial reference, not a speedup or a resolution of the older133 environment. Its source URL identifies the base; the exact dirty patch is qualified and hashed above. No additional resolution request is created.

### Concurrent publication reconciliation

While these local diagnostics ran, another continuation published PR85 head `f0e675928836e5fc8787c11e3a3fcf11fe4d54cd`, tree `e91d90ce476391c65baf297d9c866930c9da4974`. All nine groups passed in exact-head first-attempt PR run [38024228460](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38024228460), including all12 development (123.9 seconds), Worker (96.4 seconds) and standby account cases on locked153.0.8010.12. PR85 merged at04:37:46 UTC as `2b9c2ca78a4fa6b0a86d23a16eeae86bb6b08e2c`, with the identical tree.

That merged test source includes the narrow patch above plus an opt-in real **Open app** transition during signed-in account fixture claims. Independent semantic review confirms default cold paths, every direct cold/reload call, original scenarios/assertions, actual auth/claim, account freshness, network isolation and bounds remain. The added path checks same-document identity and no startup replay. Application source, dependencies, workflows and the frozen market audit are byte-identical to31f6. The narrower local native pass is therefore **not** claimed as exact merged-test coverage; the fresh locked-browser PR supplies that coverage.

Independent main run [38024734214](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38024734214) then failed the development account job with a read-only fixture `GET /api/account/library` socket hang-up in `createAndSaveRoom`, before the DM-resume HTML-failure injection. The other11 cases completed and the143.4-second wrapper did not exhaust the aggregate. This is a different observed failure from the earlier170-second timeout. The failed read ends after5.293ms with no HTTP response, about86ms after a successful browser library response. The API context's previous successful request ended6.003s earlier and advertised a5-second keep-alive timeout. This is consistent with an idle connection close/reuse race, but exact TCP reuse is inference because no socket ID was captured. The server records one untimestamped aborted/ECONNRESET event, with no exit/restart, and the remaining cases succeed. That server event cannot be uniquely assigned to the failed read. Artifact11660027906 has SHA-256 `940e313ed66fddd0d07aa0448e627927b9abfc3590cf17edd733a9720370c554`; the trace remains retained. [Independent review](https://github.com/UnregisteredMusket/Lootsplit/pull/85#issuecomment-6093893501) supports a targeted failed-job-only retry after fresh attempt reconciliation, preserving successful groups and the original artifact. Publication remains gated on successful independent main and original immutable website/standby/live verification. Evolving release outcomes belong in PR85 and the recovery checkpoint.

This evidence-only checkpoint preserves the additional diagnostic records without overwriting the concurrently merged fixture changes or changing the current release candidate. It adds no product or test-source changes. The three new manual entries await normal reviewed-main recorder import; publication of this checkpoint alone is not claimed as import completion.


