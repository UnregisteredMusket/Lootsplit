# Development and verification

Start with [the coding session manual](CODING-MANUAL.md). Run `npm run dev:doctor` to inspect the environment. `npm run verify:focus -- dm-resume` (or `layout`, `library`, `recovery`, `accounts`) runs current source with a disposable server/database without altering an existing development session. Each run writes `test-results/focused/TIMESTAMP-SCENARIO/` with its checkpoint, server log, Playwright JSON report and failure traces/screenshots. The account audit's default command still runs every scenario on development, packaged Worker and standby. Scenario filters are forbidden in CI.

The focused launcher uses a separate Vite cache as well as a separate database, so shared installed packages do not disturb another running development server. Known late-discovered router dependencies are prebundled up front to avoid the first-load reload observed during local verification.

The account browser checks use Playwright Test from the already installed `playwright` package. There is no new service subscription. Reusable fixtures live in `scripts/browser/account-fixtures.mjs`; scenarios in `scripts/browser/account.spec.mjs`; the coverage manifest in `scripts/account-scenarios.mjs`. UI signup/linking/restore remain explicitly covered; only unrelated scenario prerequisites use the real local account API.

Use Node 22 (`nvm use`; version declared in `.nvmrc`). The optional repository dev container uses the same Node major, installs the locked npm dependencies and Chromium, and checks that the browser launches. Its setup command is also available as `npm run dev:setup` on a disposable Linux development checkout. Setup has bounded install timeouts and never adds production credentials.

`npm run verify:quick` runs unit tests, type checking and lint before submitting a change. It does not replace the full release gate. Start the shared client with `npm run dev`, as required by the environment wrapper. Browser scripts create disposable accounts and campaigns: run them only against a separate development checkout/database, never a personal development database or production. CI supplies a fresh checkout and database per job.

## Parallel release verification

Pull requests run the complete `Verify preserved functionality` workflow. Feature-branch pushes do not run a duplicate copy; use **Run workflow** when verification is needed before opening a PR. Every push to main verifies the actual merged commit independently. Reusable verification for signed Android releases remains available.

| Job | Coverage |
| --- | --- |
| Code checks and immutable builds | Unit tests, types, lint, web and mobile builds, one website artifact and its portable standby |
| Development / governance | Campaign permissions, owner Test mode, themes, help, multiplayer recovery and backups |
| Development / accounts | Accounts, roles, moderation, monitoring, bug reports and character/party sheets |
| Development / gameplay | Data integrity, transfers, encounters, finance, controls, navigation and loot |
| Development / desktop | Desktop/mobile layout, public analytics and website |
| Packaged Worker / accounts | Existing Worker account, monitoring and finance checks |
| Packaged Worker / interface | Existing Worker theme, help, analytics, website, navigation, loot and title checks |
| Packaged standby | Locked transport and disposable account/library browser verification |
| verify | Fails unless every required job succeeded; skipped/missing/cancelled is a failure |

The four development groups start alongside the build. Each has its own runner, local SQLite data, browser profiles and server. Packaged checks download the build job's exact artifact IDs and verify every file hash before and after their audits. They never rebuild application code. Website/standby publishers still require the entire main-push workflow to succeed; candidate artifact existence alone never authorizes publication. Main-only publishing, stale-commit rejection, serialized deployment, migration checks, signing and production read-only audits are retained.

Every original bounded check is listed in `scripts/verification-baseline.json`; the regression test rejects omissions and duplicate commands. Extend coverage when adding a feature. Do not remove entries to accommodate a failed audit.

Both packaged Worker groups use separate runners/databases and the same verified artifact ID. Matrix failure aggregation remains required by `verify`. `npm run verify:timings` reads existing step checkpoints and writes sorted JSON/Markdown stage timings. CI includes this report in every job's summary and diagnostic artifact, including failed jobs. Compare elapsed pipeline time separately from summed runner time.

## Failed groups and recovery

Matrix `fail-fast` is disabled, allowing unaffected groups to finish. Logs retain individual audit step names. Diagnostic artifacts are named `browser-audit-GROUP-ATTEMPT` and include stage checkpoints, screenshots and disposable server logs.

After diagnosing a transient failure, use GitHub's **Re-run failed jobs** on that same commit/run. Successful jobs and immutable build artifacts can be reused within that run. Rerunning the build intentionally replaces its candidate artifacts and must rerun all dependent packaged checks and the aggregate gate. If a candidate expired or is unavailable, rerun the build and its dependants. Never treat missing artifacts or cached local results as a pass. Any source change starts fresh full verification.

`npm run recover:status` and `docs/RECOVERY.md` remain the interruption entry points. GitHub jobs continue if the chat disconnects or the user's computer turns off. This does not guarantee an interrupted coding session resumes itself.

Android test installers retain manual dispatch and relevant branch pushes, filtered to application, native, dependency and packaging changes. Superseded test-installer runs are cancelled. Web/mobile compatibility builds always remain in verification; signed release controls are unchanged.

## Timing baseline

Before parallelization, successful verification runs 37219404249 and 37223208369 took 509 and 659 seconds. Browser audits consumed 439 and 555 seconds (about 84–86%); web/mobile builds took 6 and 13 seconds combined. Compare new workflow wall time from first job start to aggregate-gate completion, excluding unrelated deployment time. Concurrency can use more runner-minutes despite lower elapsed time; queue availability affects actual results.

First full parallel PR run: [37226001213](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37226001213), 296 seconds (4m 56s), including job handoffs. All groups passed. This is 42–55% less elapsed time than the two sequential baselines; future duration depends on added coverage and available runners.

References: [GitHub job matrices](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations), [partial reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), [Node dev container](https://github.com/devcontainers/images/tree/main/src/javascript-node).
