# Lootsplit — developer guide

Lootsplit is a tabletop RPG campaign manager: character sheets, shared purses, inventory, shops, trade, properties, ships, encounters, maps and DM-approved downtime finances, played offline (device), turn-based or live in shared rooms, with optional accounts. Live site: https://lootsplit.oliverstorie2017.workers.dev. Android app: Capacitor, package `com.unregisteredmusket.lootsplit`, with two home-screen widgets.

This file is the required reading. Everything under "Read on demand" is consulted only when a task touches that area.

## Architecture

- **Client:** React 19 + TanStack Router/Start, Tailwind. Routes in `src/routes`, UI in `src/components`, game/economy logic in `src/lib/quire` (`commands.ts` is the authoritative shared command engine; `economy.ts` is the offline copy and must stay behaviorally identical).
- **Server:** one Cloudflare Worker (`cloudflare/worker.mjs`) with D1 (`DB`), static assets (`ASSETS`) and a minute cron for owner monitoring. Accounts use Better Auth (`cloudflare/accounts.mjs`). Shared rooms live in `campaign_rooms` rows (`src/lib/quire/cloud.server.ts`, `room-store.server.ts`).
- **Schema:** `cloudflare/migrations/NNNN_*.sql`, additive only (CREATE TABLE/INDEX, ALTER TABLE … ADD COLUMN, INSERT into a table the same file creates). A new migration ships in the PR that needs it; after main verification the release job (`scripts/production-migrations.mjs`) checks the pending SQL is additive, applies it to production D1, reads the ledger back and only then deploys. Never hand-apply migrations; a rejected or failed apply stops the release and the current Worker keeps serving. Never edit or renumber an applied migration. It is the only migration system: the template's `migrations/`, `drizzle/`, `db/` and PGLite/Postgres auth stack were removed (audit B01). Remaining Grok template pieces (`.grok/app-env.json`, `scripts/with-app-env.mjs`, the PWA install middleware) are still read by the build; the Grok extension script stays off (`VITE_GROK_EXTENSIONS=0`) and `scripts/live-release-audit.mjs` fails if it ships.
- **Android:** `android/` (widgets in `android/app/src/main/java/.../lootsplit/`). Signed only by `android-release.yml` with the permanent key; never generate or commit keys.
- **Standby:** `render.yaml` + `standby/`, a locked fallback host; not a second scheduler.

## Commands

- `npm run verify:quick` — unit tests + typecheck + lint. `npm test` runs `scripts/*.test.mjs` and `src/lib/**/*.test.ts` with `node --test`.
- `npm run verify:focus -- SCENARIO` — one browser audit against a disposable dev server (needs Playwright Chromium).
- `npm run dev` (port 8080), `npm run build:cloudflare`, `npm run build:mobile`.
- Without `node_modules` (sandboxes with no npm registry): many tests still run with `node --experimental-strip-types --test FILE` plus a loader that stubs missing packages; TypeScript can be diffed against `main` with any local `tsc`. Say what could not run; CI is then the gate.
- Claude Code project hooks (`.claude/settings.json`) install dependencies at session start, block edits to applied migrations and signing files, block remote D1 writes, manual deploys and pushes to `main`, and report ESLint errors on edited files. Skills `/money-command` and `/ship-pr` and the `privacy-reviewer` subagent support the rules below. See `docs/AGENT-TOOLING.md`.

## How a change ships

1. Branch from `main` (`fix/…`, `feature/…`, `dev/…`). One topic per branch.
2. Reproduce first where practical: a failing unit/API test for logic and permissions, a browser audit for what people click.
3. Open a PR. **The PR description is the checkpoint**: what changed, why, how it was verified, what is left. No separate recovery entry.
4. `verify.yml`: PRs run the build job (unit tests, typecheck, lint, immutable builds) and every development-server audit; documentation-only PRs run the build job only. Main runs every group, including packaged Worker and standby audits, before deploying. The account suite runs as two parallel shards. Do not use CI as the edit loop, and **do not push to a PR while its run is in progress** (it cancels and restarts). A failed step's last output lines are a GitHub annotation on the job; read them via the API before re-running.
5. A transient infrastructure failure (runner/browser install, emulator start) on unchanged code: re-run only the failed jobs. A test failure: diagnose before re-running.
6. Merge when green (owner's standing approval while actively working on Lootsplit, 2026-10-21). Merging deploys: main verify → `website-release.yml` → read-only live audit. Confirm the live identity before calling it released.

## Rules that are not negotiable

- **Preserve features.** Never remove, hide, disable or reduce an existing feature, permission, platform or saved data without the owner's explicit approval. Old saves and backups must stay readable.
- **Money and inventory** change only through authoritative commands with revision checks and idempotent command IDs; nothing is created or charged twice; amounts are whole copper.
- **Privacy:** players never see other players' private data, hidden NPCs or DM-only records; guests' pending actions stay in memory; private PDFs stay on the device.
- **Server-side authorization** for every shared write; client checks are convenience only.
- **Never test destructive actions on real campaigns or production data.** Production D1 is read-only except for reviewed additive migrations, which only the release job applies.
- **History:** never silently truncate campaign history or monitoring history. (The only approved pruning is the monitoring snapshot cache; oversized daily reports summarize long lists explicitly.)
- **Help:** any user-visible change gets a review of `src/lib/help/content.ts` (DM) and `player-content.ts` (players — no DM setup links); record the review in the PR.
- **Credits:** new third-party content goes in `src/lib/website/resources.ts` with source and license.
- **Navigation** uses TanStack `Link`/`AppLink`; internal navigation must not replay the title screen.
- **Android releases:** bump `APP_VERSION` and `versionCode`, add a `src/lib/website/changelog.json` entry and release notes; publish only through the workflow; update `release.json` after the signed APK is verified.

## Monitoring and logs

- Every log designated for Lootsplit is registered in `BUILTIN_LOGS` (`cloudflare/monitor-journal.mjs`) or the owner registry, and appears in the daily report; missing data stays an explicit gap, never zero.
- Development task status is published with `scripts/development-status.mjs` when an owner token is provided in the environment; otherwise say telemetry is unavailable. Never invent heartbeats.
- Performance: ≥15% slowdowns are logged automatically (hourly). Act on the weekly development speed summary's "Needs attention" list (`docs/PERFORMANCE.md`); no per-change reporting.

## Read on demand

| Topic | Read |
| --- | --- |
| Interrupted work, failure emails | `docs/RECOVERY.md` |
| Detailed testing/release procedures | `docs/CODING-MANUAL.md` |
| Account suite scenarios and timeout procedure | `docs/WEBSITE-ACCOUNTS.md` |
| Owner authorizations and product decisions | `AGENTS.project.md` |
| Owner monitoring, widgets, daily reports | `docs/OWNER-MONITORING.md` |
| What features exist (preservation baseline) | `docs/FEATURE-INVENTORY.md`, `docs/REDESIGN.md` |
| Feature specifics and their development rules | `docs/<FEATURE>.md` (ships, trade, properties, encounters, blacksmith, downtime, maps, world features…), `ANDROID.md` |
| Performance log rules | `docs/PERFORMANCE.md` |
| Agent hooks, skills, MCP servers, cloud environment setup | `docs/AGENT-TOOLING.md` || Past audits and evidence | `docs/audit/` (newest: `2026-10-21-code-audit.md`) |
| Historical checkpoints | `docs/archive/recovery-checkpoints-2026-10.md` |
