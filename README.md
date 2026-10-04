# Lootsplit

Lootsplit is a shared party ledger and campaign application for web and Android. Production runs on Cloudflare Workers and D1; GitHub Actions verifies and publishes the exact tested artifact from `main`.

## Start here for every coding session

Read [AGENTS.project.md](AGENTS.project.md), then the [Coding session manual](docs/CODING-MANUAL.md). After a timeout or interruption, also read [Recovery](docs/RECOVERY.md) and reconcile the repository, running jobs and live release before repeating an action.

The manual applies to human developers and future coding assistants. Repository instructions survive replacement of a chat or workspace. Automated commands enforce selected checks; the documents are not a guarantee that every assistant will obey them.

## Development commands

Use Node 22 (`nvm use`, or the included development container).

| Command | Purpose |
| --- | --- |
| `npm run dev:doctor` | Check the Node version, installed Playwright and browser launch without changing files |
| `npm run dev:setup` | Install locked dependencies when changed, install a browser when needed, verify launch |
| `npm run verify:focus -- dm-resume` | Check two-device DM reopening with disposable data |
| `npm run verify:focus -- accounts` | Run every account scenario in a disposable source snapshot |
| `npm run verify:quick` | Unit tests, type checking and lint |
| `npm run verify:timings` | Summarize recorded verification durations |
| `npm run recover:status` | Inspect saved checkpoints and remote release state |

Focused scenario names: `layout`, `library`, `dm-resume`, `recovery`. Focused checks include current uncommitted source edits and exclude local databases, secrets and browser profiles. They do not deploy or replace the running development server.

[Development and CI details](docs/DEVELOPMENT.md) · [Feature preservation inventory](docs/FEATURE-INVENTORY.md) · [Android releases](ANDROID.md)
