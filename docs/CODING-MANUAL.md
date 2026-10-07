# Lootsplit coding session manual

Read this at the start of every task, including a new chat, recovered workspace, or handoff. The current user's scope and authorization remain authoritative. This manual does not grant new permission to publish, send email, or change infrastructure.

## 1. Recover the actual state before editing

1. Read `AGENTS.project.md`, this manual, and `docs/RECOVERY.md` after any interruption. Consult `docs/FEATURE-INVENTORY.md` for affected behavior.
2. Inspect `git status --short --branch`, the recent log, current remote main and the relevant PR. Preserve uncommitted work. Use an isolated branch/worktree if another task is active; do not overwrite or stop its processes.
3. Check existing verification/deployment runs and the production release identity. A successful merge is not a successful release. An interrupted chat is not proof that a merge or deployment failed.
4. Reuse completed authorized work. Do not automatically rerun tests, deployments, campaign actions or other mutations after an uncertain response. Identify the actual failed stage first.

## 2. Define the smallest useful reproduction

Write down the behavior being changed, the affected data/permissions, and one exact acceptance scenario. For a bug, demonstrate that the scenario fails before changing the implementation where practical. Read existing helpers and tests before creating another implementation.

Prefer a direct unit/API regression for logic and permissions, plus a browser scenario for what a person clicks and sees. Preserve meaningful user flows even when fixtures prepare unrelated prerequisite data. Never replace a user-visible check with a database assertion alone.

Account scenario mapping:

| Scenario    | Required coverage                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout`    | Public/account pages at mobile and desktop widths, real navigation between pages                                                                      |
| `library`   | UI signup and recovery-key display, character profile, backup/restore, second-device sign-in, linking and resuming a shared membership                |
| `dm-resume` | Two devices and two saved rooms; end, reopen as verified DM, resume each from either device, correct room/role, no title replay, mobile/desktop cards |
| `resume-queue` | Account/startup desktop/mobile clicks, unsynced export/retry, stale acknowledged Live queues, changed-seat recovery archive |
| `recovery`  | UI recovery-key password reset and revocation of another signed-in device                                                                             |
| `portrait-resume` | Both portrait upload controls, Party cards and decoded images on two devices, server readout, desktop DM resume/reopen, failed-upload recovery and turn preservation |
| `campaign-choice` | Automatic membership linking, explicit separate-room creation, retry of failed linking without creating another room, duplicate-name warning and deliberate older-room resume |
| `invitations` | Copy the real player invite in a shared room; verify its room and character, existing-session conflict, same-document navigation, explicit switching and confirmed destination |
| `ownership` | Anonymous gate, legacy save claim, guest memory/reconnect, expired links, account-player cross-device resume, and tab closure without ending the session |
| `shared-recovery` | Shared campaign deletion, complete private recovery, fresh DM-only view-only restoration, encounter and character history, retry after interruption |

Portrait sync verification must exercise the real upload → room creation → account save → second-device resume path. Also interrupt an upload: a local preview or a saved membership is not proof the image reached the server. Preserve pending commands and their retry IDs; never repair sync by overwriting the whole room from one device.

Invitation investigations must test the actual copied/shared URL, including the player-specific Copy link control. A legacy `?as=player#t...` link is an offline snapshot, not a shared-room invitation. Never infer or merge a room from a campaign/character name. Offline player sharing is retired by the authorized account-owned model; preserve legacy saves and DM report recovery. Test existing memberships, route/back/forward changes and unavailable invited characters; validate the target before leaving a current room. Use only disposable campaigns.

For cross-device discrepancies, establish both actual room identities and sync states before diagnosing data loss. The same account or campaign name does not prove the same room. Saved memberships select rooms by code; names only help the user choose. Keep real room codes, credentials, screenshots and campaign contents out of public investigation checkpoints. Do not auto-merge same-name rooms or force all signed-in devices into one campaign. Preserve deliberate multi-campaign use.

## 3. Use the focused local loop before full CI

1. Run `npm run dev:doctor`. If setup is missing, select the Node version in `.nvmrc`, then run `npm run dev:setup`. Setup reuses a matching dependency fingerprint and an already launchable browser. The development container is optional; no production credentials are needed. It already supplies Node22 and the locked setup; reuse it where supported. `dev:doctor` reports the actual browser version/path. Custom executable launch success alone is not full PDF/import compatibility.
2. Run `npm run verify:focus -- SCENARIO`. The command copies current tracked/unignored source into a temporary workspace, uses an empty database and new browser contexts, starts `npm run dev` on its own strict loopback port, records diagnostics, and removes only that temporary workspace on completion.
3. Read a failure's report/trace immediately. Open `npm run verify:report -- RESULTS_DIRECTORY/html` or `npm run verify:trace -- PATH/TO/trace.zip`; focused runs print their results directory and CI retains `test-results/account/html`. Make a targeted correction and rerun that scenario. Use a small repeat only to investigate an observed intermittent failure, not as a default ritual.
4. Once the focused behavior passes, run the related backend/permission tests and `npm run verify:quick`. When changing account-test setup, run `npm run verify:focus -- accounts` to check all scenarios together before submitting CI.
5. After dependency changes, validate a clean `npm ci` with the Node/npm versions used by CI in a disposable directory. Reusing installed modules can conceal an incomplete lockfile; do not regenerate it with a different npm major version.
6. Submit the complete release suite once the local scenario and related checks are stable. If local verification is genuinely blocked, record the exact environment/access blocker and what was verified; do not claim a pass or weaken the release gate. Use CI to resolve that documented gap, not as the ordinary editing loop.

There is no requirement to rerun unrelated local browser suites after each keystroke. All existing full PR/main preservation gates remain required. A checkpoint push is allowed before checks finish; do not portray it as a verified release.

## 4. Write tests that diagnose failures

- Use visible roles, labels and scoped locators. Read the actual UI before choosing selectors (for example, an end-session confirmation is an `alertdialog`).
- Wait for the required state or completed operation. Do not add fixed sleeps to hide missing readiness checks. Keep waits that intentionally verify time-dependent animation or recovery behavior, with an explanatory comment.
- Give scenarios independent accounts, cookies, storage and campaign data. Match rate-limit identity to the tested transport: the loopback standby audit emulates its trusted proxy hop, while production continues to reject caller-supplied CF identity headers. Never fix an audit quota collision by weakening production limits, inserting arbitrary delays or retrying until a minute boundary passes. Shared setup belongs in fixtures, not a preceding test. Use real local API endpoints for unrelated setup and real UI actions for the behavior under test.
- The account suite uses Playwright Test with `forbidOnly: true`, two workers, independent parallel scenarios, no retries, failure screenshots and traces. Preserve unique scenario accounts, rooms, browser storage and synthetic client identities; never parallelize ordered actions within a scenario. Additional browser contexts are recorded by the runner too. Never turn retries into a way to make a flaky release look green.
- Focused selection rejects unknown scenarios and is refused in CI. The unchanged account audit entry point runs every required scenario by default. Add new scenarios to the manifest and preservation mapping.
- Traces may contain disposable passwords, keys and cookies. Use them only with synthetic local data; never post their contents to a public PR or email. Existing artifact access controls apply. Failure emails remain sanitized summaries.

## 5. Inspect performance before optimizing

The user requires measured slowdowns of **15% or above**, including exactly 15%, against the last logged comparable duration to be recorded on GitHub. Faster and sub-15% runs do not get log entries or change that reference. Read `docs/PERFORMANCE.md`. CI workflows/jobs/steps are collected automatically; record measured local tests, functions, deployments, actions and audits with `npm run performance:record -- measurement.json` and commit the resulting entry. Every full audit must fetch and analyze the persistent regression log, check recorder freshness, and document new/unresolved findings with baseline/current duration, added time, percentage increase, evidence and follow-up. An unavailable log is an audit gap. Repeated rises in the logged threshold are a performance trend requiring investigation. Report the original reference → latest logged duration, cumulative added time and percentage increase, number of increases, affected operations, and whether total workflow time also worsened. Preserve every qualifying entry so an increasing threshold cannot hide the accumulated slowdown.

Every bounded verification step already saves start, finish, outcome, commit, run and attempt. `npm run verify:timings` produces a sorted report; CI attaches it to each job summary and diagnostic artifact. Account reports also contain per-scenario durations.

After fixing and confirming a slowdown with a successful comparable verification, use `npm run performance:resolve -- resolution.json` and commit the resolution record. Close the old trend, retain its evidence, and start the next trend from the verified post-fix duration. A faster run by itself does not authorize resetting the reference. Follow `docs/PERFORMANCE.md` for matching scopes and rejecting stale reset requests.

Optimize the slowest required job, because parallel jobs overlap. Do not add their durations together and call that user waiting time. Packaged account/finance checks and interface/title checks run on separate disposable runners against the same immutable build artifact. More concurrency may consume more runner-minutes; measure elapsed time and queueing before adding more jobs.

Report implementation/debugging time, PR verification, main verification and deployment separately when explaining total task duration. Label estimates. Do not describe a four-minute check as a four-minute completed update.

The user requests speed improvements as **before → after, absolute time saved, and percentage reduction**. Calculate `(oldSeconds - newSeconds) / oldSeconds × 100`. Compare the same scope/environment, identify the run or measurement, and say when a comparable baseline is unavailable. Report total task time separately from test execution time; overlapping jobs cannot be added to derive wall time.

## 6. Publish and recover safely

- Follow the user's existing authorization. Preserve all release gates, main-only publishing, stale-commit rejection, serialized deployment and immutable artifact hashes.
- After a code change, fresh complete verification is required. After a diagnosed transient CI failure on unchanged code, retain successful independent groups and rerun only the necessary failed jobs. Rebuilding requires rechecking dependent packages.
- Check exact PR head and successful checks before merge; reconcile remote main again if it has moved. Never claim deployment merely because a PR merged.
- Confirm the deployment job, expected live commit, and read-only production desktop/mobile audit before saying it is live. Never run destructive browser fixtures against production.
- The live audit first checks the expected identity, every packaged JavaScript/CSS file's content type and SHA-256, and HTML bundle references. Only those read-only readiness probes may repeat within a bounded deadline; browser assertions still run once. Inspect `live-release/readiness.json` for asset URLs, HTTP status, edge ray and Worker version before diagnosing a rollout failure. A matching identity alone is insufficient.
- If upload succeeded but its live check failed, use **Verify existing live website (read only)** with the deployed SHA and its successful main verification run ID. It downloads the original artifact and performs no deploy, rebuild, database write or campaign action. Do not rerun the deployment job merely to repeat its audit.
- Before a handoff/interruption, record branch/PR, latest commit, tests and their environment, run links, remaining failure and next action in the PR or `docs/RECOVERY.md`. Push useful completed checkpoints so temporary workspace loss does not erase them.

## Tooling and scope

Playwright (including its test runner), TypeScript, ESLint and GitHub Actions are already installed. Reuse them before adding another service or paid dependency. Keep application refactors limited to the behavior being changed; shared test fixtures do not justify an unrelated rewrite of gameplay or account permissions.

Sources: [Playwright assertions](https://playwright.dev/docs/test-assertions), [test isolation and debugging](https://playwright.dev/docs/best-practices), [traces](https://playwright.dev/docs/trace-viewer).

## Account-owned campaign acceptance

The `ownership` scenario must cover anonymous entry restrictions, explicit legacy DM-save claim, authenticated room creation, guest join and reload without persistent campaign storage, End session revocation, and expired links after reopen. Account DM resume must retain all campaign data across devices. Never close a hosted session from tab unload or sign-out. Verify authenticated player membership resume with the current invitation; do not restore access from an ended session's token. New player data belongs in memory; pending guest actions must not be written to localStorage or IndexedDB. Existing device saves require explicit migration/claim and must never be silently deleted. Use real account endpoints for synthetic DM test fixtures, never a production auth bypass.

## Roadmap feature maintenance

Character imports require migration `0009_character_imports.sql`. Test approval authorization, pending submission without campaign changes, denial, stale source/target/session, financial preservation and repeated/lost responses. Run `scripts/character-play.test.mjs` and the character browser audit; do not bypass approval in fixtures.

Shop calendars and property plans use the existing command/finance engine. Exercise desktop/mobile finance audits and `finance.test.ts`, including atomic local session archives, shared command permissions, stale previews, stock top-up and backup preservation. Market time is campaign days; no wall-clock polling or new scheduler. Keep the generic recurring rule editor available.

Shop assortment and quantity are separate controls. Preserve suggested/count/all-match generation, catalog/source metadata, duplicate-safe atomic catalog additions, existing custom prices and finite/unlimited stock. Inventory/preview/catalog pagination must never truncate stored stock or full PDF exports. Related checks: `generate.test.ts`, `shop-stock.test.ts` and the desktop/mobile `scripts/shop-stock-browser-audit.mjs`, required in both development and packaged Worker verification. Keep existing player trading and DM/server authorization checks.

For address changes run `npm run migration:check` and `scripts/domain-readiness.test.mjs`, then the complete preservation suite. Read `docs/plans/DOMAIN-READINESS.md`. An API-only two-origin test does not replace the real two-host browser/legacy-APK cutover rehearsal. Never change DNS or retire old endpoints from a preparation-only task. Economy/tax presets in `docs/plans/ECONOMY-MODES-AND-TAXES.md` require owner decisions before activation.

Product screenshots are real UI captures from disposable local data (`scripts/capture-product-screenshots.mjs`), not screenshots of real user campaigns. Inspect images before placing them in `public/product/`; do not include account credentials or private campaign records. Keep them lazy-loaded and identify synthetic data in captions.

## Feature-screen maintenance

Feature navigation is presentation over the existing economy/session services. Keep mobile primary tabs at five; expose feature entry cards and a Return-to-origin footer. Use router links and verify no title-screen replay. Player Home must retain full-sheet access through six fixed shortcut-style feature buttons for signed-in players and guests. Do not add player shortcut customization or a duplicate feature-card list; DM saved shortcut customization remains available through Dashboard → Saved shortcut settings; the main DM Desk uses five swipeable information panels and grouped tools, as authorized on October 6. Keep the Multiplayer settings button visible beside connection status; the DM overview has no duplicate room/chat/status or Campaign tools multiplayer entry. Desktop may expose direct feature links. DM home and legacy overview URLs must render the same Campaign control screen, with only one shortcut/feature list. Preserve expandable treasury/activity, session controls, campaign tools and backups. The current-session readout opens #sessions; Pending reviews opens Review Inbox with payment/loan decisions and character-import reviews; Review Inbox presents approval decisions without a DM submission form; Bank retains the player spending form and clearly named DM manual payment queue.

Account shortcut API/storage requires additive migration0010. Preserve user/role isolation, revision conflicts and readonly DM offline fallback; never store guest campaign data in preference caches. Repayment and property-description commands require server ownership checks, and property edits must preserve financial fields under concurrent changes. Finance projections expose only assigned loans/rules, never another character’s debt or downtime quotes.

Related checks: accounts/finance/room-store regressions; finance, control-panel, library-navigation, character and campaign-governance browser audits. Governance exercises real player repayment/property edits and fixed player buttons; control-panel coverage retains DM account shortcut persistence. Preserve complete release gates, migration review and separate Android signing/publication requirements. Foreclosure or special acquisition rules require a separate gameplay decision.
