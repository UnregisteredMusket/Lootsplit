# Resume Lootsplit after an interruption

## Invitation routing checkpoint — 2026-10-05

- Prior PR #39 is fully released: main/live `2fa630f431d0e63df2c6f3ed83ecc8b3c40b1132`, main verification `37280755805`, deployment and production audits `37281139424`. Do not repeat that release.
- New branch `fix/invitation-room-routing`: a disposable browser regression reproduced the player-specific Copy link control producing an offline `?as=player#t...` snapshot during Live play. This does not join the host room. The user's exact sent URL was not supplied, so it is a confirmed application defect, not proof of which control they used.
- PR #40 first run `37284669067` caught an unrelated encounter-audit readiness race: the Save in select exists before its asynchronously loaded personal option, so an immediate value assertion read an empty string. The fixture now waits for the required personal value with Playwright's bounded assertion; permissions and production encounter code are unchanged. Verify the focused local encounter audit and subsequent exact-head full run before merging.
- Shared player links now name the current room and character. Deliberate offline snapshots/files remain available with a warning. Conflicting existing sessions require an explicit choice; invitation query changes and back/forward navigation are observed, the Room panel takes priority, unavailable targets are checked before leaving, and consumed invitation parameters are cleared. An unavailable invited character never silently picks another character.
- New `invitations` scenario exercises real share/copy controls, deliberate offline links, two distinct hosted rooms, existing player membership, unavailable-character protection, same-document/back/forward navigation and final connected room. Focused regression passed; check the PR for full local/CI/main/deployment results. Never claim release from this branch alone.
- Preserve guest, account, live, turn-based and manual workflows; no real campaigns are mutated and no existing links are guessed into another room. Older offline links need a new invitation from the DM. Native code compatibility is checked, but a website release is not a new Android APK.

## Confirmed portrait recovery and prevention — 2026-10-05

- The user confirmed the desktop portraits appeared after resuming the phone's actual room. This resolves the observed image discrepancy by room selection; it was not evidence of lost image bytes. The original two rooms and all user data remain intact.
- Continuing branch `fix/portrait-display-sync` adds safeguards: auto-save new signed-in room membership; failed-link retry without another room creation; explicit separate-room choice when saved rooms exist or the account check fails; clearer current-room/duplicate-name labels; fresh account metadata and confirmation before opening an older same-name entry. Guest play and deliberate multiple rooms remain available. No rooms are merged by name or automatically switched across devices.
- New `campaign-choice` browser regression failed before implementation because a newly created room was absent from the account library. It now passes automatic linking, duplicate prevention, failed-link retry, cancellation and deliberate older-room resume. All six local account scenarios and `verify:quick` passed (486 tests, four existing skips; clean types, zero lint errors/35 existing warnings).
- Full PR/main verification, deployment and live assets/desktop/mobile audit remain required before this prevention update is called live. Check the branch PR and current runs. The user's recovered portraits do not prove a new deployment.
- PR #39 first run `37279628295` passed every group except governance's `dev-release`: restored pending-purchase refresh timed out after transport interception was removed. Server diagnostics showed no runtime error; the exact unchanged audit subsequently passed locally with request diagnostics enabled. The test now restores the simulated connection through a flag while retaining its active handler, avoiding handler removal during polling; CI retains pending-request/lock diagnostics if the timeout recurs. This narrows a timing-sensitive fixture transition, not a proven production sync failure or a confirmed performance fix. Fresh full verification is required for the updated test.

## Portraits still differ across devices — 2026-10-05 follow-up

- Base/main/live at investigation: `612ee4612e9b699d746e708acd4094c4ff80d38b` (PR #38). Production release identity reports main verification run `37270098428`. PR #37's pending-upload safeguard is already deployed; do not present it as another new fix.
- User confirms the missing desktop portraits remain visible in the phone website's Party cards. This establishes an available phone display, not server persistence. No private campaign data or user screenshots are committed here.
- Branch `fix/portrait-display-sync` adds coverage of Party cards and the full character-sheet portrait upload/Save character path to `portrait-resume`. Both device cards, decoded images, and the account server readout agree in a fresh synthetic campaign. Existing blocked-upload retry, account linking, reopen and turn-preservation checks also pass. **No application code was changed; the user's remaining mismatch is not reproduced or resolved.**
- Focused check passed on Node 22.23.3/Linux x64/Chromium with disposable local database: scenario 30.149 seconds, runner 30.797 seconds, including setup 36.331 seconds (`2026-10-05T07:19:32.267Z`–`07:20:08.598Z`). Coverage is broader than the prior portrait scenario, so these timings do not establish a comparable slowdown or speedup. No performance trend is reset.
- Follow-up screenshots establish **different room codes** on phone and desktop. Both show Live, host role and “Connected · All changes saved”; the desktop has two participants and the phone one. Actual codes and screenshots are intentionally omitted from this public checkpoint. The observed devices are synchronizing separate shared rooms. This identifies the room mismatch; it does not establish how the second room was created or prove recovery of the user's portraits.
- Next action: on the phone save the current membership under My account, then on desktop refresh My account and Resume the card matching the phone's room code. This preserves DM access; direct player joining is not the recovery path. Existing UI displays the code on each saved campaign card and checks pending changes before switching. Confirm the matching code and actual Party portraits afterward. Preserve both rooms and phone browser storage; do not merge/overwrite rooms or delete a campaign. If portraits still differ after matching rooms, compare authorized local/server data before changing application code.
- This is an investigation checkpoint, not a release. No application fix or redeployment is justified by the room mismatch alone. The expanded focused test's success does not verify the user's actual recovery. If a remaining application defect is established, reproduce it and complete fresh full verification before deployment.

## Live portrait resume checkpoint — 2026-10-05

- Starting main/live `b35e096db4b20927a8beaa0ab94c8c36084c9632` (PR #36 deployment 37263801298 passed). Branch `fix/live-portrait-resume` investigates the user's mobile website → saved Live membership → desktop DM resume report.
- Normal resume/reopen preserved portraits in the clean reproduction. A failed upload falsely announced success because the optimistic command queue retained it locally; account membership linking did not check pending Live changes. The fix reports pending saves honestly and settles Live commands before linking, preserving retry IDs and local recovery data. It does not auto-commit turn-based edits.
- `portrait-resume` joins all account release gates. Full local account coverage and `verify:quick` passed; see `docs/audit/2026-10-05-portrait-resume.md` and the latest PR for final focused, CI and deployment results. Do not infer the user's original image was recovered, or claim live success from this checkpoint.

## Missing-assets checkpoint — 2026-10-05

- Starting main `325c0be2ca23578ac578b6114d51558654596c8e` (PR #34). Main verification [37235752710](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37235752710) passed. [Deployment 37235992107](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37235992107) uploaded Worker version `9f4f1bd8-8514-4753-addc-5e463ad1adfd` but failed its browser audit immediately afterwards.
- The saved audit reports four 404s for new JavaScript/CSS bundles despite a matching live release identity. The exact deployed artifact contains all four, its Nitro manifest lists them, and upload logs confirm they uploaded successfully. Later delivery succeeded without another deploy. This establishes a transient delivery/readiness failure; the saved evidence cannot establish which edge/Worker version answered those original 404s.
- Branch `fix/missing-release-assets`: route build assets directly through ASSETS after the recovery fence; prevent caching of failed assets and stale HTML; attach Worker version diagnostics; verify all packaged JS/CSS bytes and current document references before the unchanged browser gates. Regression tests cover matching identity with missing assets, wrong bytes/types, stale document references, bounded failure and successful readiness after a transient 404.
- The new **Verify existing live website (read only)** workflow can repeat production verification using an existing deployed SHA and main verification artifact run ID without re-uploading. Missing/expired artifacts remain a verification blocker. Consult the branch PR for latest CI/release results; this checkpoint is not a live-success claim.

Future coding sessions: also read `docs/CODING-MANUAL.md` for focused verification, first-failure diagnostics, and release procedures.

Chat disconnects do not stop GitHub Actions. Do not restart a release just because a chat timed out. These safeguards cannot prevent ChatGPT or the user's network from disconnecting.

## Recovery prompt

> Resume Lootsplit from its saved repository state. Read AGENTS.project.md and docs/RECOVERY.md. Check the working tree and remote main, current workflow attempts, saved failure reports and the live release identity before doing anything that writes. Reuse completed work and the exact verified artifact. Do not duplicate a deployment, merge, message, payment, campaign action or database operation after an uncertain response. If a job is running, inspect it rather than restarting it. If a check failed, identify and fix that stage without removing preservation gates. Checkpoint and push completed work in small commits. Keep the user informed. Confirm live behavior before claiming release success; clearly distinguish generated reports, mail-provider acceptance and confirmed delivery.

This prompt is committed and referenced by the project instructions, so it survives replacement of the chat workspace. It is not a claim that ChatGPT's personal memory was modified.

## First actions

1. Inspect `git status --short --branch` and `git log -5`. Preserve uncommitted work. Fetch remote refs with a bounded command; do not reset the checkout.
2. Run `npm run recover:status` for local checkpoint records, current main, recent GitHub runs and the public live identity. Every network read has a deadline and at most three attempts. When CLI networking is unavailable, use the GitHub connector for the same read-only checks.
3. Read failed job steps and the `browser-audit-GROUP-ATTEMPT` artifact (older runs use `browser-audit-ATTEMPT`). Each verification stage writes `test-results/recovery/STEP.json` before it runs, updates a heartbeat every 20 seconds, and records success, failure, timeout or interruption atomically. A stale `running` record means an unknown outcome, never success. Compare commit, run ID and attempt. Local records are diagnostic and never bypass release checks or allow reuse of missing artifacts.
4. Wait for an active run. For a failed current commit, investigate the exact stage; rerun only failed verification jobs when a transient cause is established. Independent successful groups can be retained by GitHub within the same unchanged run. Tests and mutations are never automatically retried. A build rerun must rerun its dependent packaged checks; missing/expired artifacts require rebuilding and verification. Run all required gates after a source fix. See `docs/DEVELOPMENT.md` for the parallel groups and artifact names.
5. Before replaying an uncertain merge/deploy, reread GitHub main, deployment job and `https://lootsplit.oliverstorie2017.workers.dev/assets/release-identity.json`. A website is released only after the expected commit passes the read-only production audits. Keep the main-only, serialized publisher and immutable artifact checks intact. Do not reset D1, rotate signing keys or activate standby during chat recovery.
6. Commit and push a checkpoint after each useful verified change. Record the commit, run links, results and the next action here or in the PR; temporary files alone are not durable.

`node scripts/recovery-step.mjs STEP SECONDS COMMAND [ARG...]` can wrap local checks too. It does not execute through a shell. It terminates the full child process group at the deadline, saves the outcome and returns a failing exit code. It does not detach an entire task to promise work after a chat ends. The independent GitHub workflows do continue without the chat.

## Independent failure reports

`Report workflow failure` listens for failed, cancelled, timed-out, stale or action-required verification, deployment, Android, standby and backup workflows. It runs separately even if the original runner has been killed. It reads job/step metadata and live identity, saves JSON/text reports for 90 days, and adds a run summary. It never downloads or executes code/artifacts from a failed PR and never includes raw logs, credentials, account records or campaign contents in email. A runner start failure may have no failed step; the report states this explicitly. Expected superseded-run cancellations are still labelled accurately.

Email requires these **repository Actions secrets**:

- `FAILURE_REPORT_EMAIL`: the owner's explicitly confirmed recipient address.
- `FAILURE_REPORT_FROM`: a sender accepted by the configured Resend account, with its domain verified when required.
- `RESEND_API_KEY`: a send-only key scoped to the sending domain where supported.

Do not infer the recipient from git author metadata. Missing settings produce a visible `not_configured` report, not a claim of delivery. Network failures, HTTP 408/429 and selected 5xx responses receive at most three attempts; 4xx authorization failures stop immediately. Email retries use the same run/attempt idempotency key (Resend retains keys for 24 hours). A later manual rerun outside that window may send another report. Provider acceptance is recorded; inbox delivery is not asserted. A mail failure does not discard the saved report. Never put secrets in source or chat.

Reports cover GitHub workflows, not ChatGPT platform failures or arbitrary runtime outages. If the separate reporter itself fails, inspect its GitHub failure notification or the independent ChatGPT failure watch. Complete loss of GitHub service cannot generate a GitHub report until service resumes.

## Recovery checkpoint — 2026-10-04

- Campaign governance release: `643275db7acdfe674962bd15ec4db4a97f3c46bc`.
- Full verification succeeded: https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37219404249
- Production deployment and read-only desktop/mobile live audits succeeded: https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37219950346
- The user confirmed the failure-email recipient in the recovery conversation. Keep that address in private configuration, not this public repository. Provider configuration remains unconfirmed; do not state that email is active until configuration and a delivery test are verified.

References: [GitHub workflow-run behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Workflow-speed task checkpoint — 2026-10-04

- Authorized scope: parallelize independent verification, eliminate duplicate branch/PR runs and unrelated Android test builds, preserve targeted failed-job reruns, and provide a ready development setup. The user authorized implementation and will be away from the computer.
- Starting production/main commit: `c0ba1b98ce691eff88117b2ea6abb34644f11815`; owner Test mode menu update is already live.
- Work branch: `improvement/workflow-speed`. Inspect its latest PR and current Actions results before continuing. Merge only after all changed-workflow checks pass; then observe main verification and the automatic publisher. Do not duplicate a running merge or release.
- Release safeguards and every existing audit remain required. Production data and Android signing configuration are outside this change.

## DM account-resume checkpoint — 2026-10-04

- Workflow-speed PR #31 is merged at `a60a2525678d55de178b718aece323337c20deeb`. PR verification run 37226001213 completed in 296 seconds including job handoffs; main verification 37226495127 and deployment 37226757969 succeeded. Live identity was confirmed.
- Next authorized fix: DMs saving campaigns on separate devices cannot resume ended shared sessions. The existing library discarded the DM role for closed rooms, and resume returned the player-only invitation error. A failing regression reproduced this using two signed-in sessions and two saved campaigns.
- Work branch: `fix/dm-account-resume`. Add an explicit, revision-checked Reopen as DM action using the account's existing seat/token on the server. Preserve all campaign content, pending actions and player restrictions. Existing ended player sessions must not regain access automatically.
- Cross-device browser coverage is added to the existing account audit, so development, packaged Worker and standby paths all exercise the fix. Check the branch PR and full main/deployment results before claiming completion; do not rerun active jobs.

## Development feedback checkpoint — 2026-10-04

- Starting main: `9819c1662e3bdf8d864ce4c2360b53e6c57a1ba6`; DM-resume PR #32 is complete. Main verification 37228977373 and production deployment/read-only audits 37229289860 passed.
- Authorized scope: improve focused verification, reliable browser readiness, automatic traces, reusable fixtures, ready development tooling, timing visibility and durable instructions for future sessions.
- Branch: `improvement/development-feedback`. Inspect its PR/latest run before continuing. Focused local checks precede full CI; all preservation gates and production data protections remain required. No gameplay feature or application permission changes are intended.

- Local validation: isolated DM-resume scenario passed (22.5s); complete four-scenario account suite passed (42.7s). Failure screenshots/traces were generated and inspected during local diagnosis. Unit tests (460 passed across the updated suite, 4 existing skips), type checking, lint (existing warnings only), and web build passed. Node 22 and a compatible local Chromium were used; a local injected proxy warning required suppressing Node warnings for the legacy stderr-JSON unit test only. CI uses its standard environment. Check the PR for subsequent packaged and release results.

## Session feedback checkpoint — 2026-10-05

- Starting main `313c9ae1ad69a80fd24096d9460b00063e562825`; work branch `fix/session-feedback`.
- Authorized scope: notification lifecycle; Live DM loot/player inventory; independently granted character permissions with immediate saves; character import discovery/full-tab population; on-device image/scanned PDF OCR and statblock review; first-session downtime choice; book-style collaborative journal; cross-device portraits.
- Confirmed: account campaign IDs missed Live sheet refresh; canonical inventory needed stable ID ordering across server/IndexedDB after loot awards; route-scoped notification hosts replayed active history; legacy import flattened line breaks and left playable arrays as notes. The supplied character screenshots show app output, not the original failing PDFs; exact original-PDF fidelity remains unverified until those source files are available.
- Tesseract.js 7 is pinned and lazily loaded; its worker/WASM/English model are copied from pinned npm packages by predev/prebuild scripts. No private original is sent to an OCR service. Review is required before a character/statblock import is applied. User Goblin image locally produced correct AC 15, HP 7, initiative +2, CR 1/4, XP 50, with 92% recognition confidence in 1949ms; this is a new operation without a comparable speed baseline.
- Durable checkpoint: `930dbd87c92a536ae67a0ea685dcb5c02c58cf0a` on `fix/session-feedback`. Final local acceptance checks passed: expanded governance (Live loot, same-account second browser portrait, immediate independent grant, downtime 0, mobile journal) and encounter audit (statblock UI and scanned character PDF). `verify:quick`: 483 passed, 4 existing skips, clean typecheck, lint 0 errors/35 existing warnings. Full PR/main verification and deployment are still required. See `docs/audit/2026-10-05-session-feedback.md` for preservation and performance findings. Do not call this released from a branch or merge.
- Environment: each shell tool call has its own loopback namespace. Start the disposable Vite server and browser child in the same invocation. Node 22 and a compatible Chromium are available; do not retry inaccessible loopback ports in separate invocations. Old `.grok/skills/design-ui` referenced by the template is absent; current project preservation/manual and existing design tokens govern this update.

- PR #36: https://github.com/UnregisteredMusket/Lootsplit/pull/36. First CI run 37263019567 failed only at `npm ci`: local npm 11 had omitted Nitro’s optional `lru-cache@11.5.3` peer from the lock. Regenerated with CI’s npm 10.9.9 in a disposable directory; no existing dependency versions changed. Check the next commit/run before continuing.

## Character PDF import checkpoint — 2026-10-05

- Portrait PR #37 is fully released at `c662deb270c61206d293cf9ab379781fcb414a29`: main verification 37267485071 and deployment/read-only production audits 37267750797 succeeded; live identity matched. Do not repeat that release.
- Next authorized work: `fix/character-pdf-fields`. A supplied filled PDF retains page widgets but lacks the AcroForm index; the importer skipped values and turned static labels into character fields and inventory. Page-widget fallback, section boundaries, export aliases/columns and fixed-damage import are corrected.
- Local source-PDF browser assertions, expanded encounter import UI/persistence audit and `verify:quick` passed (486 tests, 4 existing skips, clean types, 0 lint errors). Private inputs are not in GitHub. See `docs/audit/2026-10-05-character-pdf.md` for evidence, preservation and performance analysis.
- Inspect the branch PR and exact current runs before proceeding. Full PR/main verification, automatic deployment and production asset/desktop/mobile audits are still required at this checkpoint. Do not claim live success from this branch or its merge.

- Import PR #38 run 37269258333 diagnosed an existing standby fixture issue: all synthetic devices shared localhost's sign-up quota, causing HTTP 429 in portrait-resume. Every other group passed. The test-only proxy emulation now preserves independent fixture identities; production rate limiting is unchanged. The downloaded/hash-verified same standby artifact passed all five local account scenarios (38.184s complete audit), and full local quick checks passed again. Inspect the latest PR head/run; do not rerun the known defective fixture or merge from the earlier results.

## Account-owned campaign model — 2026-10-05 work in progress

- User explicitly authorized replacing guest DM hosting and offline player copies with account-owned campaigns, expiring session invitations, guest in-memory play/reconnect, explicit End session, and account campaign selection. Preserve existing saves; never test on real campaigns.
- Starting main/live: `416fe5127c63348ed2f0f593f1d93187480faa50`. Branch: `feature/account-owned-campaigns`.
- Server creation now saves account membership atomically; reopening rotates the invitation generation. Signed-in player seats are linked automatically. New guest campaign storage uses an in-memory IndexedDB implementation; sessionStorage retains only reconnect credentials.
- First isolated `ownership` browser scenario passed (19.7s runner): account gate, authenticated DM claim/hosting, guest join/refresh with no persistent IndexedDB, session closure, revoked reconnect ticket, old invitation rejected after reopen. Account backend tests passed (13). These are development results, not a released change.
- Remaining: complete migration/startup/permission review, adapt existing fixture setup to authenticated DMs and deliberately retired offline player behavior, pass all local account/preservation tests, full PR/main CI, deployment and read-only live verification. A first full account run exposed a fixture restore-before-claim failure and unnecessary DB closing on auth refresh; corrections are in progress. Inspect current logs/PR before repeating runs.
- Do not merge or deploy this checkpoint. No performance trend has been reset. Existing history reference: `c966335d5ce54d9bcad407a68dac3f6702ae57ec` on `performance-history`.

- Follow-up local validation: the eight-scenario suite passed after fixture/auth-read corrections; expanded ownership coverage also passed with actual signed-in player cross-device resume and DM-tab closure. Quick checks passed (487 tests, four existing skips, clean types, zero lint errors/35 existing warnings). Governance, protected backups, party sheets, finance, encounters, interrupted player retries, and control-panel desktop/mobile checks passed. Final full-source rerun and PR/main packaged gates remain required. See docs/audit/2026-10-05-account-ownership.md.

- Final local source `3db9feb2e731def6e337eacd635e305ab18f964f`: eight account scenarios passed in 128.193s; quick checks and both web/mobile builds passed. All listed focused gameplay/preservation audits passed. New local baselines are recorded under the explicitly changed account-owned eight-scenario scope. Next: full PR verification, exact-head merge only after success, main verification, automatic publisher, and immutable-artifact live checks.
