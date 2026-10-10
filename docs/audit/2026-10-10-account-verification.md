# Account verification setup — 2026-10-10 UTC

## Observed release blocker

The import/Save response correction and trusted Retry fixture are merged in main `24d386ded42d38bab983731523489b21aeab75a0`. PR83 verification `38018106897` passed all nine groups, but independent main `38018663650` reached the development account suite's unchanged 170-second aggregate deadline. Ten scenarios passed; invitations and shared recovery were unfinished. There was no individual assertion failure or 60-second case timeout. The other seven substantive groups passed, including both complete import/retry audits and all twelve Worker and standby account scenarios. Website `38019144675` and standby `38019144710` correctly skipped.

The successful PR account result measured 164.817 seconds, only 5.183 seconds below the aggregate limit. Main's invitation and shared-recovery cases started at 148.449 and 150.182 seconds. Several earlier cases took modestly longer, consuming that margin:

| Scenario | Successful PR83 | Failed main |
| --- | ---: | ---: |
| Ownership | 51.138 s | 53.280 s |
| Resume queue | 43.537 s | 45.361 s |
| Portrait resume | 39.487 s | 44.056 s |
| DM resume | 39.348 s | 39.951 s |
| Campaign choice | 23.634 s | 21.140 s |

Failed artifact `11657247276` retains per-case JSON, server output, screenshots and the HTML report. Its SHA-256 is `51fe74bcec2f831b18226eb0c0fe63bd133c461b16cfb1584f070d8066b0e1f0`. No trace ZIP survived the global teardown, so a separate disposable focused trace is used to inspect the redundant work. The original failure remains a failed result, not a partial pass.

The separate pre-change `resume-queue` trace passed on Node22.23.3/Chromium133 in 40.098 case seconds / 42.792 suite seconds. It used clean tree `b9a14fcbdd10b4c76170c33aa869bd6d877b6711`. The preliminary empty Resume and account return occupied 3.112788 seconds and initiated 380 same-device requests, including 331 scripts and one root document navigation. The Resume portion was 1.931611 seconds; returning to the account was 1.181177 seconds. This proves avoidable work. The diagnostic browser's strict fallback routing disables HTTP caching, so these figures do not predict the improvement on CI's current native network restriction. The trace and sanitized timing summary are retained under `test-results/performance-account-baseline/1791601505419-resume-queue/`.

## Scoped correction

Only `scripts/browser/account.spec.mjs` changes its setup flow:

- Resume queue starts with the actual queued action instead of first opening an empty account copy and navigating back. After its real Retry, the fixture rereads the canonical active account key before the two-device stale-queue checks. Source-copy retention, command and batch identities, exported pending work, account/startup entry, changed-seat recovery and older private copies remain covered.
- Invitation setup retains the initial real account creation, cold app document and explicit campaign claim, then clicks the existing router link to the room screen. This removes the second full document that the general gameplay helper introduced on each of three devices. The subsequent cold invitation entry, actual copied link, unavailable-character rejection, same-document history changes, explicit switching and destination checks remain.
- Shared recovery provisions its single participating account device directly. The earlier second signed-in device was never used. The primary cold account load and signed-in assertion, campaign claim, room creation, membership save, deletion, complete private backup, fresh restoration, encounter/roll history, downloads and both layouts remain.

All twelve scenarios keep their order, independent identities and data. No application code, common navigation helper, browser network boundary, account cache policy, screenshot requirement, assertion timeout, 60-second case limit, 170-second suite limit, two-worker setting or zero-retry policy changes. Full current-browser PR/main verification and immutable release/live checks remain required.

## Local verification

Functional checkpoint `787bf95d7c104e6ae1a737f22301b9718df5abb6`, tree `6a6c9b2edc436e2f0db0b80ba337d187691c3230`, contains the verified fixture change. The complete disposable `verify:focus -- accounts` run passed all twelve scenarios on its first attempt: 141.993 suite seconds, including all affected scenarios, with the same 170-second aggregate limit and zero skips/retries. Including snapshot/server setup and cleanup, it ran from `2026-10-10T03:07:15.146Z` to `2026-10-10T03:09:46.494Z`, 151.348 seconds. Corrected queue, invitation and shared-recovery cases measured 35.396, 16.560 and 16.339 seconds respectively. Their original assertions and both network-boundary contexts passed. The mobile invitation and desktop restoration screenshots were inspected.

`verify:quick` passed 835 tests: 831 passes and four existing skips. TypeScript is clean; lint reports zero errors and the same 30 existing warnings. Node22.23.3 and diagnostic Chromium133.0.6943.0 passed `dev:doctor`. This browser exercises the strict older-browser routing fallback; full locked current-browser PR/main and packaged account checks still establish the native boundary path. The application bundle is unchanged, so unrelated local browser/import/build checks are not repeated.

Results and logs are retained at `test-results/focused/1791601635142-accounts/` and `test-results/account-overhead-quick.log`. The exact published source, fresh CI and live release identities belong in the PR and local recovery checkpoint. These local passes do not establish that the release is live.

## Performance review

The latest reviewed persistent history is `4a6fc666e795f067125cc410c0d791273640b115`: 749 observations, 685 references and 15 resolutions. Recorder `38019157915` succeeded at 03:02:56 UTC and processed the failed independent main. Main elapsed 471 seconds after four seconds of initial queue; its critical path was 115 seconds of code/build work, three seconds scheduling, 345 seconds Worker/interface, three seconds scheduling and the five-second final gate. Its failure cannot be treated as a faster successful verification than the previous 472-second successful main.

New qualifying records were main code/build 97→115 seconds (+18.56%) and the second artifact upload 4→5 seconds (+25%). The code/build trend now totals 71→115 seconds, +44 seconds/+61.97%, across three recorded increases. The preceding PR83 review also recorded typecheck 17→20 seconds (+17.65%; original 7→20 across four increases) and immutable package preparation 3→4 seconds (+33.33%; original 2→4 across two increases). These entries remain preserved; job/setup/upload variation alone does not establish an application regression.

Open main references include development accounts 59→158 seconds (+167.80%, four increases), Worker accounts 25→109 (+336%, six), development locations 27→68 (+151.85%, two), Worker locations 23→68 (+195.65%, two, latest failed), and total verification 205→917 (+347.32%, three, latest failed). The current 171-second failed account step is only 8.23% above its retained 158-second reference, so it does not create another >=15% timing entry, but it remains the release blocker addressed here. Successful current Worker accounts (93 seconds) and import checks (58 development/46 Worker) do not automatically lower references.

The local complete-account measurement uses the existing `v3-twelve-scenarios-batch-response-recovery` / `node22.23.3/linux-x64/chromium133/disposable-vite/two-worker-bound` scope. Its 151.348-second full boundary is below the retained 181.814-second failed reference (`local:0ba4e1d5-ab86-4058-b982-49a8820c5054`). The existing recorder is used without renaming the operation or moving its baseline. Current-browser complete verification must confirm the correction before any CI trend resolution; no faster failed main is used to reset history.

The user's publication approval and full task-completion authorization persist. Production campaigns were not used as fixtures.
