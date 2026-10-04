# Lootsplit

Lootsplit is a shared party ledger and campaign application for web and Android. Production runs on Cloudflare Workers and D1; GitHub Actions verifies and publishes the exact tested artifact from `main`.

## Start here for every coding session

Read [AGENTS.project.md](AGENTS.project.md), then the [Coding session manual](docs/CODING-MANUAL.md). After a timeout or interruption, also read [Recovery](docs/RECOVERY.md) and reconcile the repository, running jobs and live release before repeating an action.

The manual applies to human developers and future coding assistants. Repository instructions survive replacement of a chat or workspace. Automated commands enforce selected checks; the documents are not a guarantee that every assistant will obey them.

## Performance regression log — required during every full audit

Record any measured test, function, deployment, action or audit that takes **15% or above longer than the last logged comparable duration**, including exactly 15%. Faster runs and increases below 15% are not logged and do not change the reference. CI timings are checked automatically in this repository's persistent [performance regression log](https://github.com/UnregisteredMusket/Lootsplit/blob/performance-history/PERFORMANCE-REGRESSIONS.md). Local measurements must be recorded and committed using the [performance history procedure](docs/PERFORMANCE.md).

**Every full audit must fetch and analyze this log**, review new and unresolved slowdowns, check comparison validity and recorder freshness, and report before/after duration, added time, percentage increase, evidence, cause and follow-up action. Repeated rises in the logged threshold are a performance trend requiring investigation. Report the original reference → latest logged duration, cumulative added time and percentage increase, number of increases, affected operations, and whether total workflow time also worsened. Preserve every qualifying entry so an increasing threshold cannot hide the accumulated slowdown. Preserve the history for future analysis; do not treat an unavailable or stale log as a pass.

After an issue is confirmed resolved by a successful comparable verification, close its trend and reset the reference to the verified post-fix duration. Preserve the old log and link the fix/verification evidence. A faster run alone must never reset a trend; use the [verified resolution procedure](docs/PERFORMANCE.md#resolve-a-confirmed-issue-and-reset-the-trend).

## Development commands

Use Node 22 (`nvm use`, or the included development container).

| Command                                          | Purpose                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `npm run dev:doctor`                             | Check the Node version, installed Playwright and browser launch without changing files |
| `npm run dev:setup`                              | Install locked dependencies when changed, install a browser when needed, verify launch |
| `npm run verify:focus -- dm-resume`              | Check two-device DM reopening with disposable data                                     |
| `npm run verify:focus -- accounts`               | Run every account scenario in a disposable source snapshot                             |
| `npm run verify:quick`                           | Unit tests, type checking and lint                                                     |
| `npm run verify:timings`                         | Summarize recorded verification durations                                              |
| `npm run performance:sync`                       | Read GitHub timing history and collect a local snapshot without publishing             |
| `npm run performance:record -- measurement.json` | Record a measured local operation for inclusion in the task's GitHub commit            |
| `npm run performance:resolve -- resolution.json` | Record a verified resolution and reset request while preserving the previous trend     |
| `npm run recover:status`                         | Inspect saved checkpoints and remote release state                                     |

Focused scenario names: `layout`, `library`, `dm-resume`, `recovery`. Focused checks include current uncommitted source edits and exclude local databases, secrets and browser profiles. They do not deploy or replace the running development server.

[Development and CI details](docs/DEVELOPMENT.md) · [Feature preservation inventory](docs/FEATURE-INVENTORY.md) · [Android releases](ANDROID.md)
