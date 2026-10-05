# Resume Lootsplit after an interruption

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
