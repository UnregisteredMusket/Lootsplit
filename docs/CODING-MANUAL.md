# Lootsplit coding session manual

Read this at the start of every task, including a new chat, recovered workspace, or handoff. The current user's scope and authorization remain authoritative. This manual does not grant new permission to publish, send email, or change infrastructure.

## 1. Recover the actual state before editing

1. `CLAUDE.md` is the required reading. Use this manual for testing and release detail, `AGENTS.project.md` for owner decisions, `docs/RECOVERY.md` after an interruption, and `docs/FEATURE-INVENTORY.md` for the behavior a change affects.
2. Inspect `git status --short --branch`, the recent log, current remote main and the relevant PR. Preserve uncommitted work. Use an isolated branch/worktree if another task is active; do not overwrite or stop its processes.
3. Check existing verification/deployment runs and the production release identity. A successful merge is not a successful release. An interrupted chat is not proof that a merge or deployment failed.
4. Reuse completed authorized work. Do not automatically rerun tests, deployments, campaign actions or other mutations after an uncertain response. Identify the actual failed stage first.
5. Keep the active task moving through verification and authorized publication; use bounded polling that yields control. Before any handoff, persist the exact branch/head/tree, PR/run IDs, last successful stage, remaining blocker and next action. A user saying "continue" resumes that checkpoint; it does not authorize restarting completed work or treating an active external job as failed.

## 2. Define the smallest useful reproduction

Write down the behavior being changed, the affected data/permissions, and one exact acceptance scenario. For a bug, demonstrate that the scenario fails before changing the implementation where practical. Read existing helpers and tests before creating another implementation.

Prefer a direct unit/API regression for logic and permissions, plus a browser scenario for what a person clicks and sees. Preserve meaningful user flows even when fixtures prepare unrelated prerequisite data. Never replace a user-visible check with a database assertion alone.

## 3. Use the focused local loop before full CI

1. Run `npm run dev:doctor`. If setup is missing, select the Node version in `.nvmrc`, then run `npm run dev:setup`. Setup reuses a matching dependency fingerprint and an already launchable browser. The development container is optional; no production credentials are needed. It already supplies Node22 and the locked setup; reuse it where supported. `dev:doctor` reports the actual browser version/path. Custom executable launch success alone is not full PDF/import compatibility.
2. Run `npm run verify:focus -- SCENARIO`. The command copies current tracked/unignored source into a temporary workspace, uses an empty database and new browser contexts, starts `npm run dev` on its own strict loopback port, records diagnostics, and removes only that temporary workspace on completion.
3. Read a failure's report/trace immediately. Open `npm run verify:report -- RESULTS_DIRECTORY/html` or `npm run verify:trace -- PATH/TO/trace.zip`; focused runs print their results directory and CI retains `test-results/account/html`. Make a targeted correction and rerun that scenario. Use a small repeat only to investigate an observed intermittent failure, not as a default ritual.
4. Once the focused behavior passes, run the related backend/permission tests and `npm run verify:quick`. When changing account-test setup, run `npm run verify:focus -- accounts` to check all scenarios together before submitting CI.
5. After dependency changes, validate a clean `npm ci` with the Node/npm versions used by CI in a disposable directory. Reusing installed modules can conceal an incomplete lockfile; do not regenerate it with a different npm major version.
6. Submit the complete release suite once the local scenario and related checks are stable. If local verification is genuinely blocked, record the exact environment/access blocker and what was verified; do not claim a pass or weaken the release gate. Use CI to resolve that documented gap, not as the ordinary editing loop.

**Sandboxes without `node_modules`.** When the npm registry is unreachable, tests can run with `node --experimental-strip-types --test` plus a loader that stubs missing packages, and TypeScript can be diffed against `main` with any local `tsc`. Treat a clean local `tsc` diff as weak evidence only:

- Without the real package types (React, zod, sonner, `@types/node`…), imported values, component props and callback parameters become `any`. Real assignability errors then disappear, for example a callback typed `() => Promise<void>` that now receives `() => Promise<boolean>` (#180), or a test fixture cast against zod-inferred command types (#162). Both passed a stub-typed `tsc` and were caught by CI's first typecheck.
- Stubbed or older packages also change runtime behaviour (the sandbox zod 3.25 `zod/v4` shim does not clone `.default([])` values the way zod 4.4 does), so a local failure that also fails on `main` is environmental.
- Say in the PR exactly what ran and what could not. CI's typecheck, lint and tests are the gate; don't merge on the local diff alone.

There is no requirement to rerun unrelated local browser suites after each keystroke. Pull requests run the build job (unit tests, typecheck, lint, immutable builds) and every development-server audit; documentation-only PRs run the build job only. Main runs every group, including the packaged Worker and standby audits, before any deployment (owner decision 2026-10-21).

**Do not push to a PR while its verification is running.** A new push cancels the run in progress and starts over; batch documentation and follow-up commits. When a CI step fails, its last output lines appear as a GitHub annotation on the job (readable through the API even where log and artifact downloads are blocked); read it before re-running anything.

## 4. Write tests that diagnose failures

- Use visible roles, labels and scoped locators. Read the actual UI before choosing selectors (for example, an end-session confirmation is an `alertdialog`).
- Wait for the required state or completed operation. Do not add fixed sleeps to hide missing readiness checks. Keep waits that intentionally verify time-dependent animation or recovery behavior, with an explanatory comment.
- A state already true before submission is not an acknowledgement. For partial blacksmith work, `active` remains unchanged while downtime approval is pending. Wait for the session form to clear and the exact downtime record to become `applied` before leaving the page, then retain the original progress/status assertions. A cold navigation can otherwise abort the still-pending command.
- Give scenarios independent accounts, cookies, storage and campaign data. Match rate-limit identity to the tested transport: the loopback standby audit emulates its trusted proxy hop, while production continues to reject caller-supplied CF identity headers. Never fix an audit quota collision by weakening production limits, inserting arbitrary delays or retrying until a minute boundary passes. Shared setup belongs in fixtures, not a preceding test. Use real local API endpoints for unrelated setup and real UI actions for the behavior under test.
- The account suite runs as two Playwright shards (`ACCOUNT_SHARD=1/2`, `2/2`) in parallel CI jobs; locally, `npm run verify:focus -- accounts` still runs every scenario. Scenario coverage and the timeout procedure are in `docs/WEBSITE-ACCOUNTS.md`.
- Run the independent ownership and partial-queue scenarios early so a long new regression cannot be left until the aggregate deadline. Keep the manifest and declaration order aligned; preserve every original scenario and network boundary. Balance independent scenarios using retained per-case timelines from both cold CI and local runs; keep ownership/partial recovery early and await all independent device cleanup before completing each fixture. The account suite uses Playwright Test with `forbidOnly: true`, two workers, independent parallel scenarios, no retries, failure screenshots and traces. Preserve unique scenario accounts, rooms, browser storage and synthetic client identities; never parallelize ordered actions within a scenario. Additional browser contexts are recorded by the runner too. Never turn retries into a way to make a flaky release look green.
- Focused selection rejects unknown scenarios and is refused in CI. The unchanged account audit entry point runs every required scenario by default. Add new scenarios to the manifest and preservation mapping.
- Traces may contain disposable passwords, keys and cookies. Use them only with synthetic local data; never post their contents to a public PR or email. Existing artifact access controls apply. Failure emails remain sanitized summaries.

## 5. Inspect performance before optimizing

The performance log keeps every inclusive ≥15% comparable slowdown automatically (collected hourly). Owner decision 2026-10-21: instead of a per-change reporting duty, the **weekly development speed summary** (`performance-summary.yml`, Mondays) reports verification time, job and step medians, failures and steps that slowed by 15% or more week over week; act on its "Needs attention" list. Use `performance:resolve` only after a diagnosed fix is confirmed by a successful comparable run; never reset a trend because one run was faster. History is never deleted. Details: `docs/PERFORMANCE.md`.

Every bounded verification step already saves start, finish, outcome, commit, run and attempt. `npm run verify:timings` produces a sorted report; CI attaches it to each job summary and diagnostic artifact. Account reports also contain per-scenario durations.

Optimize the slowest required job, because parallel jobs overlap. Do not add their durations together and call that user waiting time. Packaged account/finance checks and interface/title checks run on separate disposable runners against the same immutable build artifact. More concurrency may consume more runner-minutes; measure elapsed time and queueing before adding more jobs.

Report implementation/debugging time, PR verification, main verification and deployment separately when explaining total task duration. Label estimates. Do not describe a four-minute check as a four-minute completed update.

The user requests speed improvements as **before → after, absolute time saved, and percentage reduction**. Calculate `(oldSeconds - newSeconds) / oldSeconds × 100`. Compare the same scope/environment, identify the run or measurement, and say when a comparable baseline is unavailable. Report total task time separately from test execution time; overlapping jobs cannot be added to derive wall time.

## 6. Publish and recover safely

- Follow the user's existing authorization. Preserve all release gates, main-only publishing, stale-commit rejection, serialized deployment and immutable artifact hashes.
- After a code change, fresh complete verification is required. After a diagnosed transient CI failure on unchanged code, retain successful independent groups and rerun only the necessary failed jobs. Rebuilding requires rechecking dependent packages.
- Android signing also requires `android-main-verification.mjs` to read the successful independent `verify.yml` main-push run for the exact commit and its latest-attempt preservation gate. Missing/failed/skipped/stale evidence blocks publication; the release’s own full and native gates remain required.
- Schema changes ship as a new additive `cloudflare/migrations/NNNN_*.sql` in the PR that needs them. The release job checks, applies and reads them back before deploying (CLOUDFLARE.md); never hand-apply, edit or renumber an applied migration. `scripts/production-migrations.test.mjs` shows what the additive check accepts.
- Check exact PR head and successful checks before merge; reconcile remote main again if it has moved. Never claim deployment merely because a PR merged.
- Confirm the deployment job, expected live commit, and read-only production desktop/mobile audit before saying it is live. Never run destructive browser fixtures against production.
- The live audit first checks the expected identity, every packaged JavaScript/CSS file's content type and SHA-256, and HTML bundle references. Only those read-only readiness probes may repeat within a bounded deadline; browser assertions still run once. Inspect `live-release/readiness.json` for asset URLs, HTTP status, edge ray and Worker version before diagnosing a rollout failure. A matching identity alone is insufficient.
- If upload succeeded but its live check failed, use **Verify existing live website (read only)** with the deployed SHA and its successful main verification run ID. It downloads the original artifact and performs no deploy, rebuild, database write or campaign action. Do not rerun the deployment job merely to repeat its audit.
- Before a handoff/interruption, record branch/PR, latest commit, tests and their environment, run links, remaining failure and next action in the PR description (the PR is the checkpoint; do not add dated entries to `docs/RECOVERY.md`). Push useful completed checkpoints so temporary workspace loss does not erase them.

## Help, reference lookups and tooling

Preserve the existing credential-free public `searchOpen5e` GET function for bundled Android clients. Current in-campaign searches use the separate scoped POST function; room credentials must never be put into a reference URL. Unseated local DM searches retain the public lookup protocol. Website role-guide/control updates become bundled APK features only with a separately verified signed Android release.

For focused player-reference feedback, `.github/workflows/player-reference-audit.yml` exercises the complete desktop/mobile player-reference audit in development and a disposable immutable Worker, followed by all 12 account scenarios with the existing deadlines, workers and zero retries. It runs for affected PR paths, without production secrets or writes. Use its retained failures to reproduce fixture issues when local sockets/browser launch are blocked. This supplemental feedback never replaces the PR/main preservation gates or read-only live verification.

Before freezing a feature checkpoint, review the DM guide (`src/lib/help/content.ts`) and the player guide (`src/lib/help/player-content.ts`) against the final implemented behavior. Both public Help and the in-app Help dialog automatically select the current role. Update affected steps, labels, entry links, prerequisites, DM permissions, player restrictions, import/recovery instructions and website-versus-APK availability in that same change. Search the guide for stale claims; never imply automatic game rules or unsupported offline/approval behavior. Verify player Help remains reachable from Home and Settings & Management, with no DM setup links or descriptions.

Record the reviewed topics and unchanged relevant topics in the PR description, update `docs/FEATURE-INVENTORY.md`, and review README, this manual and the affected feature documentation. Update development instructions whenever implementation, commands, authorization, testing, release or recovery procedures change. This review is part of every added feature, not a later documentation task. Preserve the complete Help/navigation audits in development and the immutable Worker.

Player reference lookup policy is optional campaign journal metadata controlled by the DM-only, stale-checked `reference-policy` command. Legacy journal replacements must retain the authoritative policy. Default lookup permits read-only item/spell/creature indices outside encounters and blocks it during any active campaign encounter. `RoomView.encounterActive` is a boolean derived from the private encounter store and updates on normal polling even if room revision is unchanged; no enemy data or encounter identity is projected. Device encounters use their existing canonical local records. Direct reference routes, cached results and sheet spell searches follow the same policy. Shared searches use POST/no-store and recheck the verified seat/policy before and after source retrieval. Preserve saved sheet reading, private source packs, DM lookup and all character ownership rules. Run the reference-access, encounter, character-play, Library privacy tests and the complete Help/player-reference browser audit in both environments. No migration is needed.

Playwright (including its test runner), TypeScript, ESLint and GitHub Actions are already installed. Reuse them before adding another service or paid dependency. Keep application refactors limited to the behavior being changed; shared test fixtures do not justify an unrelated rewrite of gameplay or account permissions.

Sources: [Playwright assertions](https://playwright.dev/docs/test-assertions), [test isolation and debugging](https://playwright.dev/docs/best-practices), [traces](https://playwright.dev/docs/trace-viewer).

Feature-specific development rules (accounts, monitoring, maps, ships, trade, properties, downtime, blacksmith, encounters, windows, Android widgets) live in each feature's own document under "Development and verification rules".
