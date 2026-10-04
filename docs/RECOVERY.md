# Resume Lootsplit after an interruption

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
