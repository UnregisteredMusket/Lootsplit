# Recovery verification notice — 2026-10-08

The user reported that the desk still requested ownership verification after clicking Verify in My account. Work starts from confirmed main/live `a6f8041536c6425e66dab48117506c0143e695ea`, the completed PR68 release. Branch: `fix/recovery-verification-notice`.

## Diagnosis and behavior

Successful legacy verification was kept only in module memory, so a reload returned the unchanged original to the unverified count. An unmatched check had no result presentation, leaving the same instruction visible after a successful account-library request.

Verification now stores an additive, token-free, account-owned recovery projection with its original source key. It retains the original legacy bytes. Reloading the verified account restores the exportable copy and excludes only a matching original from the unverified count. Changed or unreadable originals remain preserved and unverified. Explicit discard removes only the selected verified copy and its matching original; it cannot erase a replacement record.

My account reports verified and unmatched counts, checking progress, request failures and unavailable durable storage. An unmatched check changes the desk instruction to a review link with a clear ownership result. The feedback is scoped to the verified account and current source-key set; it grants no access. Only exact saved DM membership codes authorize work. Another account or a player membership cannot expose it. No command is replayed, room is changed, credential is exported or unmatched copy is discarded.

## Local evidence

Node22.23.3, Chromium133.0.6943.0, disposable development accounts and campaigns. The five targeted regressions failed before the fix and passed after it: reload persistence, account isolation and token-free export, unmatched/unreadable preservation, precise discard, changed-original preservation and storage-full recovery.

Complete quick verification passed717 tests/four existing skips, clean types and lint0errors/30 existing warnings. The real resume-queue browser scenario passed32.3s (38.057s including isolated startup) at11:11:44–11:12:22UTC. It clicks Verify, reports one authorized and one unmatched original, reloads, downloads the verified action, checks exact original bytes, and follows the real desk link without a document reload or opening animation. Phone and desktop screenshots were inspected. The subsequent complete account suite also asserts that verification/export/navigation never submit the synthetic legacy action. All original account assertions and60s/scenario,170s/suite,two-worker,zero-retry bounds remain.

The locked Chromium153 download failed with invalid/non-ZIP0MiB responses through all installer attempts. A separately installed Chromium133 executable provides local diagnostics; mandatory current-browser CI remains the release gate. The initially discovered shared `/tmp/chromium` was truncated and was left untouched. Dependencies are unchanged.

All ten account scenarios passed115.629s browser/121.491s including isolated startup at11:12:41–11:14:42UTC, with no skips, failures or retries. Against the retained130.216s browser reference this saves14.586s/11.2%; no qualifying slowdown or reference reset. Exact PR/main source and publication evidence will be recorded in the PR. No production account or campaign was used for verification. This repair requires no migration or signed Android release.

## Performance reconciliation

Read-only sync retained603 observations,12 resolution records,0 stale requests and one old pending failure-report run37642398740. Latest release main306s versus previous294s adds12s/4.08%; no total-workflow qualifier. Its four new short-step qualifications were retained: setup8→11s (+3s/37.5%), owner audit5→6s (+1s/20%), backup13→18s (+5s/38.46%), Worker finance19→24s (+5s/26.32%). No deployment qualification was found.

Open cumulative trends remain: main account59→158s across four increases (+99s/167.8%); PR account57→156s across four (+99s/173.68%); backup6→18s across three (+12s/200%); Worker finance11→24s across four (+13s/118.18%). Expanded audit coverage and runner/setup variance remain material; this narrow recovery repair does not establish a runtime fix for those trends. The complete local account reference is130.216s with the same Node/browser/isolation/two-worker scope; compare the final measured run inclusively at15%, preserving any qualifying observation. No reference reset is authorized by a faster run alone.
