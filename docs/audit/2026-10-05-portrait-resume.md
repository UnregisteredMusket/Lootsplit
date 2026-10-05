# Live portrait resume verification — 2026-10-05

Starting main/live release: `b35e096db4b20927a8beaa0ab94c8c36084c9632`. Branch: `fix/live-portrait-resume`. Read the PR's latest checkpoint for release status.

## Diagnosis and scope

The reported sequence is the website on a signed-in phone, a saved Live campaign membership, then DM resume in another browser. A clean upload → create Live room → save membership → desktop resume → end/reopen scenario passed before application changes (16.2 seconds). Therefore the evidence does not support claiming that ordinary account resume strips all portraits, or that the user's particular upload failure has been established.

A controlled failed-upload reproduction found a real gap: `queueCommand` retains optimistic local edits and intentionally handles network failure without rejecting its caller. `PortraitPicker` nevertheless announced “Portrait saved.” `linkCurrentCampaign` saved credentials without settling those pending changes. The same account on another device then correctly read the older server portrait. The new warning assertion failed before the fix.

The correction distinguishes local-only, pending turn, failed shared upload and confirmed shared saves. Account linking refreshes authoritative state and retries pending Live commands once with their existing command/batch IDs; failure preserves the local recovery copy and prevents cross-device success confirmation. Already committed commands are acknowledged before retry, preserving idempotence. Turn-based membership linking remains available without committing/ending a turn. Private PDFs and unrelated local campaigns are never uploaded.

The new `portrait-resume` browser scenario covers visible mobile upload, desktop DM account resume, image bytes and successful decoding, an interrupted replacement upload, server-old/client-new images, blocked account success while the upload still fails, recovery from the original pending command, remote refresh and ended-session reopen. It also checks that linking a pending turn does not commit the portrait. This scenario joins every development, packaged Worker and standby account gate. Existing permissions and revision checks remain authoritative.

The user's private campaign was not modified or inspected. Previously missing portraits are not claimed recovered. If retained as pending changes on the original phone, the corrected Save current membership flow can submit them; a device-only image absent from both the server and pending queue still requires that source device.

## Local checks

Node 22, Linux, compatible Chromium, disposable synthetic accounts and isolated databases. `verify:quick` passed 483 tests with 4 existing skips, clean type checking and 0 lint errors / 35 existing warnings in 25.554 seconds. The local proxy warning required `NODE_NO_WARNINGS=1` for the existing stderr-JSON test only. Full five-scenario account audit passed in 64.028 seconds; this includes new coverage and ran concurrently with code checks, so it is not a comparable speedup/slowdown against an older four-scenario standalone run. The final focused result and complete CI evidence are in the PR checkpoint. Local Wrangler remains unavailable (`uv_interface_addresses`); packaged execution stays required in CI.

## Performance history

Read-only `performance:sync` fetched the persistent history: 129 slowdown observations, 15 repeated open trends, no pending runs, no new observations since the previous release checkpoint. Recorder [37264685667](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37264685667) succeeded. No trend reset is justified by this portrait correction.

Repeated open trends retain these original → latest logged durations (added time / cumulative increase / logged rises):

| Operation | Original → latest | Added | Increase | Rises |
| --- | --- | --- | --- | --- |
| Development desktop / setup-node | 3s → 7s | 4s | 133.33% | 2 |
| Development desktop / npm ci | 11s → 16s | 5s | 45.45% | 2 |
| Development gameplay / server startup | 4s → 8s | 4s | 100% | 2 |
| Development gameplay / encounter audit | 8s → 14s | 6s | 75% | 2 |
| Packaged interface / setup-node | 2s → 6s | 4s | 200% | 3 |
| Packaged accounts / npm ci | 8s → 14s | 6s | 75% | 2 |
| Packaged accounts / Worker startup | 5s → 7s | 2s | 40% | 2 |
| Packaged accounts / monitor audit | 5s → 7s | 2s | 40% | 2 |
| Development governance / npm ci | 7s → 17s | 10s | 142.86% | 2 |
| Development governance / server startup | 4s → 8s | 4s | 100% | 2 |
| Development governance / audit | 18s → 48s | 30s | 166.67% | 2 |
| Standby publishing workflow and job | 10s → 18s each | 8s each | 80% | 2 each |
| Packaged interface / npm ci | 11s → 15s | 4s | 36.36% | 2 |
| Deploy / validate and upload | 9s → 15s | 6s | 66.67% | 2 |

Prior expanded OCR/governance coverage changes the workload; setup/cache and one-second metadata precision can also contribute, but neither establishes a resolved cause. Unchanged-step increases need comparison in the next run, especially dependency setup, startup and upload. The last main verification took 204s versus 217s (13s / 5.99% faster), while deployment took 128s versus 101s (27s / 26.73% slower). The log's deployment reference was 98s, so its recorded increase is 30s / 30.61%. These scopes must not be conflated or parallel job durations added. Keep all observations and inspect CI/live-audit timings after this release; no claim of faster application requests is made.
