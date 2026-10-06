# Unified DM home — 2026-10-06 UTC

- User requested combining DM control panel and campaign overview to reduce clutter. Branch `fix/unified-dm-home`; baseline clean main/live3c3336c8d5708dd9b1ce907d6f65a5d8c77663af. PR52 was fully verified/deployed (main37429247281, deploy37429724509); its PR body supersedes historical pending notes below. No migration needs repeating.
- DM `/` and legacy `?view=overview` now share Campaign control. One readout/shortcut/feature list; expandable treasury, activity/balances, sessions and campaign tools. Desktop table/complete review queue retained within activity. Session readout opens actual session controls. Player routes, saved data and gameplay rules unchanged.
- Local verification passed:508 tests/four existing skips, clean types, zero lint errors/34 existing warnings, web/mobile builds. Expanded control-panel21.084s, governance62.342s, desktop42.652s and help passed; mobile screenshots inspected. The first test-only document-marker assertion incorrectly spanned an intentional legacy-URL document open; corrected to measure actual session/Bank/return clicks independently. No application navigation defect was found. Full exact-head PR/main verification and deployed audit remain pending. Existing gated publication authorization applies; no new APK, migration or domain work.

# Fixed player feature buttons — 2026-10-06 UTC

- Latest user request removes player shortcut customization and presents all six player services with existing shortcut-button styling. DM customization remains unchanged; existing player preference records are preserved. No migration, gameplay-rule or APK change.
- Reconciled main/live at `474a14c203910ddbda7bdd294b8968d808549293`: PR51/main verification37425891304 and deployment37426315597 completed successfully with live audit. Earlier blocked checkpoints below are historical. Migration0010 already applied once; do not repeat it.
- Branch `fix/player-home-buttons`. Player Home has one fixed grid, existing readouts, no duplicate feature cards. Governance covers signed-in/guest parity, return navigation and real repayment/property permissions; sheet audits click the new button. README/manual/inventory/help updated. Local verification passed:508 tests/four existing skips, clean types, zero lint errors/34 existing warnings; web/mobile builds; governance, character, party-sheet and DM control-panel browser checks. Mobile screenshot inspected: six fixed buttons, no overflow/editor/duplicate cards. Full CI/publication pending; existing gated publication authorization applies.

# Shortcut readiness follow-up — 2026-10-06 UTC

- PR50 passed full PR run37424344225 and merged as0b5a8f4750c7d42ac435ded25f1e2e124e7465d5. Production migration0010 was applied once at06:37:46UTC and verified. Do not apply it again.
- Main run37424826185 failed only dev-control-panel. Its audit reloaded immediately after starting the asynchronous account save and immediately read default buttons during preference loading. All other independent groups passed. Deployment stayed blocked; live remains8614403.
- Follow-up `fix/shortcut-readiness` hides shortcut destinations until account preferences arrive (verified DM offline cache remains), waits for confirmed save before reload, and deliberately holds the GET response to prove default destinations cannot be clicked. Focused control-panel and navigation checks passed; quick508 tests/four skips, clean types, lint0errors/34 existing warnings. Fresh full PR/main gates required for the correction.
- Includes an evidence-backed resolution of PR50's separate party-sheet fixture timeout using successful comparable run37424344225. Historical timing entries remain intact. Existing publication authorization covers this release correction; no new permission required.

# Feature screens — publication authorized, 2026-10-06 UTC

- Branch `feature/feature-screens` based on released main `8614403c64469a93680fe6d0537139614aca96b2`. User approved the feature-screen/Player Home workshop and implementation. See `docs/audit/2026-10-06-feature-screens.md`, README and feature inventory for scope.
- Source includes role-aware full feature screens, player Home, account shortcut API with additive migration0010, player-owned repayment/property-description commands and privacy-limited finance projection. No foreclosure/special acquisition rules, taxes, domain change or signed APK update.
- Implementation checkpoint `735574d212cc2e0b12cf7c8bb8d95455a3bcbdaf`. Final local quick checks508 pass/four skips, types clean, lint0errors/34 existing warnings; web/mobile builds, all8 account scenarios, finance/control/navigation/character/expanded governance (anonymous guests)/help/desktop browser checks passed. See the audit for measured timings. Remaining changes after that application commit are documentation/performance records only.
- User explicitly approved publication, additive account-shortcut migration0010 and full gated release on 2026-10-06. Published PR50: https://github.com/UnregisteredMusket/Lootsplit/pull/50. Published application commit40322cac504f3c6144a546458a15c1fa78dbac30 has the exact verified local tree cc24a3a2afbdb1bef25d2ab14ebddd9e024ea175; Git CLI lacks credentials, authorized GitHub connector used instead. Full exact-head CI is running. Migration0010 remains unapplied. Next: inspect PR/current runs, apply migration once after checks, gated merge/main verification/deployment/live audit. Do not repeat completed PR49 actions.
- PR49 was confirmed merged/released: PR37411859467, main37412269946, website37412626230, standby37412626382, backup37412269948 succeeded. Performance history latest347 observations, pendingempty, recorder37412824045 success. Do not repeat migration0009 or the completed release.
- Local runtime: Node22 under `/tmp/lootsplit-tools/node_modules/node/bin`, Chromium `/tmp/lootsplit-chromium/chromium`. Disposable source `/tmp/lootsplit-roadmap-verify`. Server and browser must run inside one shell invocation (loopback namespaces differ). Direct recovery GitHub HTTP403; read-only connector reconciliation worked. Cloudflare emulator previously blocked by environment `uv_interface_addresses`; do not weaken packaged-Worker CI.

- PR50 initial exact-head run37423624096 passed builds, seven other independent groups including packaged Worker/standby, but dev-party-sheet expected the old directly embedded player sheet. Follow-up clicks the new Home → Open Character Sheet link and preserves the existing interactive-sheet assertions. Migration0010 is still unapplied; no merge/deployment. Focused party-sheet browser validation passed with all original money, inventory, ownership, migration and sheet assertions. Next: fresh exact-head CI.

# Roadmap priorities — publication authorized, 2026-10-06 UTC

- User explicitly approved publication to UnregisteredMusket/Lootsplit, full GitHub checks, additive production migration0009, and gated merge/deployment. The earlier automatic approval block below is historical and resolved by this permission.
- Reconciled remote main and live at `e437ab517429ba48ecf76e0b7a7885eefadd886c`; local verified checkpoint `57d8f957db6b46d745f117a9dd177f95f96c4fa6`. No remote branch, PR, migration or release occurred before this checkpoint.
- Next: publish branch, require complete exact-head PR checks, inspect/apply additive migration0009 once, merge through gates, verify main checks and immutable deployment/live audit. Preserve migration history and existing campaign records. Domain activation, proposed tax values and APK publication remain outside this authorization.

# Roadmap priorities — publication blocked, verified local checkpoint

- Implementation commits: `7efd5947ac4c22ef5a351762d583921814f9219d` and `e1310f7e1055a3b3b3165943fc29845a040fdabc` on `feature/roadmap-priorities`. See `docs/audit/2026-10-06-roadmap-priorities.md` and the updated README/manual.
- **Automatic approval review rejected the GitHub push**: user authorized implementation, but explicit publication permission is required; prior recovery instructions were cited. No branch/PR publication, production D1 migration, merge or deployment occurred. Do not bypass via connector/API or retry until the user approves publication to UnregisteredMusket/Lootsplit. Main/live remains the reconciled baseline below.
- Final local checks:504 passed/four existing skips, clean types, 0 lint errors/34 warnings; web/mobile builds; character, expanded finance, website, encrypted-backup and governance desktop/mobile browser checks passed. All8 development account scenarios passed (83.211s with setup), all8 built standby account scenarios passed (37.5s runner). Immutable artifacts verified. Local Cloudflare emulator could not launch due environment uv_interface_addresses; full packaged-Worker CI is still mandatory.
- Migration0009 was tested only in disposable local databases. Apply it separately to production only after publication permission and ready PR checks; preflight intentionally blocks deployment while it is missing. Preserve migration history, auth data and existing campaigns.
- Tax/economy proposals are inactive pending owner decisions. Domain preparation is not DNS activation; actual two-host browser/old-APK cutover rehearsal remains required. No new APK publication.
- Next after permission: reconcile remote main/PR/live again, publish this branch, run full exact-head CI, review/apply additive migration, gated merge/main/deploy/live verification. Do not repeat completed Android1.4.0 publication or treat these local artifacts as a released update.

# Roadmap priorities checkpoint — 2026-10-06 UTC

- User authorized work on five priorities: character-import approval, security/domain preparation, homepage/platform explanation, property/shop scheduling, and defining taxes/economy presets. No UI redesign, domain purchase/DNS cutover or APK publication.
- Baseline main/live `e437ab517429ba48ecf76e0b7a7885eefadd886c`; verification37405125361 and deployment37405446606 succeeded. Work branch `feature/roadmap-priorities`.
- Implemented pending DM imports (migration0009), shared finance property/shop plans, secure explicit origin preparation/readiness guide, homepage synthetic screenshots/platform comparison. Tax/preset numbers are proposals in docs/plans, not activated.
- Local Node22.23.3/Chromium133 character audit passed including approval; expanded desktop/mobile finance and website audits passed. Initial quick suite passed500 tests/four existing skips with no type/lint errors; later additions require final fresh verification. External template script fetch failures are separately recorded, not app runtime errors.
- Source-isolated browser work is in `/tmp/lootsplit-roadmap-verify`; runtime must bind loopback in this environment and launch server/browser children within one shell invocation. Production and real campaigns were not used for fixtures.
- Next: final quick/build/account/preservation checks; inspect PR/main before publication; separately apply the reviewed additive D1 migration only when required release checks are ready. No migration, PR, merge or deployment has occurred at this checkpoint. Preserve permanent APK signing identity and all gates.

# Development workflow improvement — 2026-10-06 UTC

- User authorized development/test improvements with no application behavior/setup changes and requested current README/manual. Branch `chore/development-workflow`, based on released main `9a67fd6f3530942f6449eb72a0638563f3ecd2df` (PR46, verification37402387007, deployed/live-audited37402773863). Prior integration release is complete; older blocked/publication checkpoints below are historical.
- Account tests use two independent workers; all eight scenarios, assertions, timeouts, zero retries and full PR/main gates retained. Added HTML report and report/trace commands, browser version/path diagnostics. Reused existing Node22 development container; no new dependency or service. README, coding manual and development guide updated, including all eight focused scenario names.
- Local comparison:115.095→77.797s for suite (32.4% saved);120.610→82.591s including setup (31.5% saved). Both8/8 passed, Node22.23.3/Chromium133, disposable databases. `verify:quick` passed497 tests,4 skipped; clean types, zero lint errors/35 existing warnings. Full CI with current browser remains required before release.
- Next: publish PR, verify every group, compare CI account and total elapsed time; keep only reliable measured improvement. Do not repeat completed baseline or change application code to accommodate tests. Record final PR/main/deploy evidence in the PR before handoff.

# Integration audit publication authorized — 2026-10-06 UTC

- User explicitly approved pushing the audited changes to `UnregisteredMusket/Lootsplit`, full release checks, and gated merge/deployment. The earlier approval block below is historical and is resolved by this permission.
- Remote main reconciled at `57903387de3dd600bb30bc68a69f24f164c51081`; audit branch not yet present remotely. Local implementation `efb1909`, verification/report checkpoint `a4e92f2`. Next: publish branch, open PR, observe complete exact-head verification, merge, observe main verification/deploy and verify live artifacts. Do not repeat completed local work or Android publication.

# Integration audit local verification and publication block — 2026-10-06

- Application implementation commit: `efb1909`, branch `audit/integration-consistency`. Four confirmed fixes and measured transaction/query reductions are documented in `docs/audit/2026-10-05-integration.md`. No UI formatting or signing changes.
- Final `verify:quick`: 497 passed, 4 skipped; clean TypeScript; zero lint errors/35 existing warnings. Web and mobile builds passed. Final 13 focused regressions passed.
- Account (8 scenarios), protected backup, finance, Party-sheet and data-integrity browsers passed. Governance failed twice in the working checkout, then passed unchanged in isolated `/tmp/lootsplit-integration-verify` at `efb1909`; earlier failures remain documented. Isolated sound, interrupted-purchase recovery, Library navigation and public/private analytics browser checks also passed. Local Chromium133 does not replace mandatory full current-browser CI; physical Android validation is not claimed.
- **Publication blocked:** automatic approval review rejected `git push -u origin audit/integration-consistency`, citing potentially sensitive export to an unverified GitHub destination and requiring explicit publication permission. Do not bypass by another push method/API. No PR, merge or deploy occurred. Ask permission to push to `UnregisteredMusket/Lootsplit`, run complete checks and proceed with gated merge/deploy. Reconcile remote state before any later write; production remains the previously verified baseline below.
- Keep local implementation and this report; do not repeat Android1.4.0 publication. After permission, complete exact-head PR/main checks, performance-history review and immutable live verification before calling these changes released.

# Integration audit checkpoint — 2026-10-05

- User requested full system integration/efficiency audit and fixes, with no UI reformatting. Baseline main/live `57903387de3dd600bb30bc68a69f24f164c51081` is already released; verification `37393097454`, deployment `37393529289`, Android 1.4.0/code 6 complete. Do not repeat the Android release.
- Branch `audit/integration-consistency`: mixed-state shared/backup snapshots reproduced and corrected with coherent readonly transactions; financial views share the transaction reader; encounter listing query count 44→2 for 21 memberships; concurrent-local-Charisma pricing regression corrected for shops and listings. No schema/layout changes.
- Deterministic regressions failed before fixes and pass afterward. Account suite (8 scenarios), protected backup, finance, party-sheet and data-integrity browser checks passed. Initial governance run timed out at Test mode after navigation; diagnostic screenshots retained. Inspect final focused rerun/CI before claiming release.
- Local runtime Node22.23.3. Standard browser download invalid ZIP; available `/tmp/lootsplit-chromium/chromium` launches and is Chromium133. Run local server with `--host 127.0.0.1` in same shell as browser (network-interface enumeration is restricted). Full CI with its standard browser remains mandatory.
- Report and source map: docs/audit/2026-10-05-integration.md. Performance snapshot:326 observations, zero pending/stale resolutions; 22 entries since prior304 reviewed. No historical reset or time-speedup claimed; snapshot transactions reduced8/9→1. Inspect PR/head/runs and live identity before resuming any publication.

# Android 1.4.0 publication follow-up — 2026-10-05

- Release preparation PR #44 merged to main `feea2b5047b967e3aeb54314d59acff5593d9881`. PR verification `37390831478`, main verification `37391401183` and website deployment/live audits `37391781088` passed.
- Android workflow `37391400899` first attempt stopped at `dev-encounter`: its unrestricted name-heading assertion could match the import review's h3, so the test reloaded before the asynchronous save completed. Every other independent group passed; only gameplay job `112037078470` was rerun. The unchanged-code rerun passed and release-apk started. No check was removed or narrowed.
- The follow-up test now waits for the import dialog to close and checks the saved editor h2 before reload, covering both scanned and filled PDFs. Local syntax checking passed; the full focused encounter run was blocked earlier by Chromium 133 lacking Uint8Array.toHex in PDF.js. Full CI with its current Chromium must verify the correction. Do not treat this local limitation as a passed import audit or a proven device failure.
- Local release preparation: 491 tests passed, four skips, clean typecheck, zero lint errors / 35 existing warnings, successful web/mobile builds and Capacitor sync. Bundled Android assets rendered at 390/1280 widths without page errors. Physical-device install/file-picker/force-close checks are not claimed.
- Android 1.4.0/code 6 is published. The downloaded 20,807,198-byte APK independently confirms package `com.unregisteredmusket.lootsplit`, permanent certificate `baca95a880d14d0d8c422c397decd4c9bf0e7f710a3fd6a5be1e47abd3f730a0` and SHA-256 `355baf1eca0c734e705006203eac300d4339558093506ad6f3a97c9477c507e0` matching SHA256SUMS.txt and GitHub digest. Three bundled WAV files are present.
- Follow-up advances website download metadata and records release evidence. Next: complete its PR/main checks and website deployment, verify /downloads, /updates, and the actual /download/android bytes. Preserve prior release assets.

# Android 1.4.0 release checkpoint — 2026-10-05

- User explicitly requested publication. Branch `release/android-1.4.0` starts from verified main/live `cbed0613755e98548ebeba30c4fe1c592ef7d239`.
- Version 1.4.0, code 6, uses the existing permanent signing secrets and package identity. No key rotation, campaign migration or APK overwrite is authorized.
- Version/changelog/release-note preparation only; website download remains 1.3.2 until the actual signed APK passes certificate/version/checksum verification.
- Next: verify and merge this release PR; observe main verification and automatic signed-release workflow; inspect/download the resulting APK; update release.json and verify website deployment, downloads, updates and download bytes. Do not restart an active workflow after a timeout.

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

- PR #41 first full run `37292539956` passed builds, development/packaged accounts and packaged standby, but failed help's anonymous-to-DM destination and the navigation-heavy desktop/control-panel audits. No merge or deployment occurred. Follow-up fixtures authenticate before protected help destinations, click visible router links across layouts, preserve explicit reload assertions, and accept already-owned campaign setup on persistent profiles. Production rate limits remain unchanged. Account reassignment after DM release and a real legacy IndexedDB-save migration are covered.
- After workspace maintenance removed the checkout, source was restored from PR head `2c59b8bce4fcf45026c767649ad1464c59b28ab3` and the saved follow-up changes reconstructed. Prior logs confirm eight scenarios passed; repeat verification on the reconstructed source is running. Inspect latest PR head and runs before release; do not infer success from the old checkpoint.

- Second PR run `37299751759` confirmed desktop/control-panel/help development corrections, then exposed later fixtures: IPv6 addresses varied only host bits, but Better Auth correctly normalizes to /64, sharing signup limits. Synthetic addresses now vary the /64 prefix; production auth is unchanged. Public website entry now asserts the requested sign-in gate and no campaign database. Recheck theme→help→release and public website together before new full CI.

- Packaged portrait trace exposed an actual hydration race: saved credentials rendered mode controls before the server mode/invitation arrived, so an early Turn-based click could do nothing and an early copied invite could omit its generation. Session-changing and invite controls now wait for the first authoritative sync. The existing portrait/turn-preservation audit verifies the mode after reload; do not weaken this check.

- Complete PR verification `37300924028` is successful on `dd472ef0f27ee5aac8d3c858c4a667a3d3b4518d`. Six diagnosed performance-failure trends have evidence-backed resolution records; older history remains intact. Final follow-up contains those records, consistent account-required UI wording, and a locally passing desktop destination-readiness fix. Verify its exact new head before merge; main/deployment/live gates remain required. No production release yet.

- Final-head run `37301858919` exposed a real initialization race in dev-release: sample shop IDs could be inserted after restoring the authoritative room, causing a retried player purchase to reference nonexistent server stock. Two deterministic hydration regressions failed before the correction and passed after it. Guest memory now seeds no sample economy, initialization checks/writes share a transaction, and cloud restoration marks the economy initialized in its data transaction. Owned campaigns retain exactly the saved inventory; DM sample initialization remains for new local campaigns. The release fixture waits for connected state before choosing its item. Full local account/quick/recovery verification is in progress; inspect latest head before releasing.


## Post-merge import selection correction — 2026-10-05

PR #41 merged as `1ec7436a7117e402b276f85653cce80527b251c3`, but main verification `37303426479` failed dev-encounter and deployment remained blocked. Filled-PDF extraction was correct; after creating Widget hero, an older character-list response could restore Scan Hero instead. Branch `fix/import-selection-order` aborts the older request before choosing a newly saved character and makes queued selection updaters honor that abort. Preserve the real import/reload assertions. Inspect the follow-up PR and exact current runs before merge; production is still the prior release until main/deploy/live gates pass.

## CC0 sound effects — 2026-10-05

Branch feature/cc0-audio starts from verified live/main de59ff205d91b46567e7444a5533196bd8fb8be8. User selected CC0. Three optional rubberduck effects (coins, loot, pages), default-off device settings, volume/previews and Resources credits are implemented. Local quick checks:491 pass/four skips, clean types, existing lint warnings only. Local browser uses scratch Chromium133 after standard download returned invalid ZIP. See docs/audit/2026-10-05-cc0-audio.md. Inspect current PR/exact head, full verification, main and live gates before claiming release; do not repeat a completed deploy. No APK is being published.

- Local implementation commit da269ff9558452da740f5ec65dc1a6a21889b4c8: sound desktop/mobile audit passed, 491 tests passed/four skips, clean types, no lint errors (35 existing warnings), web and mobile builds passed. GitHub push was rejected by automatic approval review: integration authorization was not accepted as authorization for external publication of this update. Do not retry or use another publishing route until user approval is given. No PR/full CI/main/deployment or live success is claimed. Work is retained in /workspace/scratch/635455f43583/lootsplit-audio. User-facing audio samples are public/audio/cc0/{coins,loot,page}.wav.
