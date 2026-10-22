# Website releases on Cloudflare

Optional free standby and encrypted offsite recovery: [docs/STANDBY.md](docs/STANDBY.md).
Never clear the Worker `RECOVERY_FENCE` secret during a standby recovery or deployment.

Production stays at https://lootsplit.oliverstorie2017.workers.dev/ using the existing
Worker `lootsplit`, D1 database `lootsplit` (`0a200e96-ae2e-47b5-9869-c1f4d316148f`),
`DB`, `ASSETS`, `ROOM_ENTRY_LIMIT`, `CF_VERSION_METADATA`, `ACCOUNT_ORIGIN`, and
existing `ACCOUNT_SECRET`. Never recreate the Worker or database to release code.

## Release path

1. Push reviewed changes to `main`. `Verify preserved functionality` runs the full
   existing test, type, lint, mobile, browser, account, permission and built-Worker checks.
2. Vite builds the website once. `release-artifact.mjs prepare` bundles the Worker once
   with Wrangler's dry run and captures the static assets, config and migrations in
   `dist/website-release`. It records SHA-256 hashes of every file and the source commit.
3. Built-Worker audits execute that exact bundle with `--no-bundle`, using disposable
   **local** D1. Desktop/mobile title-screen checks cover parchment, title fade, moving
   carrier/rogue, click/keyboard entry and reduced motion. All prior assertions remain.
4. Only after every check succeeds, CI verifies hashes again and uploads the immutable
   `website-release-<commit>` artifact (30-day retention).
5. `Deploy verified website` accepts only successful **push** verification runs from
   this repository's `main`. PRs, forks and Android workflow calls cannot publish.
   It downloads the artifact from that precise run, validates hashes/commit, applies the
   artifact's pending additive D1 migrations (below), checks current `main`, existing
   production bindings and that the D1 migration ledger exactly matches the artifact, and runs
   `wrangler deploy --no-bundle --keep-vars` against the artifact's config. There is
   no Vite build or Worker bundling in the deploy job; secrets are preserved by Wrangler.
6. Production checks match `/assets/release-identity.json` to the source commit, exercise
   desktop/mobile entry, and run the read-only public website audit. Screenshots,
   previous deployment identity and results are retained as Actions artifacts.

A single `lootsplit-production` concurrency group serializes deployments; active
uploads are never cancelled. Queued older commits fail the current-main check inside
that lock. A new commit arriving during an upload waits, so an older run cannot
publish *after* a newer GitHub release. Do not add a second publisher outside this lock.
A rerun of the same current commit is safe. For expired artifacts, rerun verification
for current main; never rebuild inside the deploy job.

`npm run deploy:cloudflare` now fails closed with migration instructions. This prevents
legacy Cloudflare triggers from publishing new commits before their GitHub checks pass.
The actual trigger is removed only after the first successful GitHub release (below).

## One-time credential setup

In GitHub repository **Settings → Environments → production**, limit deployment branches
 to `main`. Add these **environment secrets** (repository Actions secrets are also
 supported, but environment secrets isolate release credentials more clearly):

| Name | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | The existing Lootsplit Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | A dedicated Cloudflare API token for GitHub website releases |
| `CLOUDFLARE_D1_MIGRATION_TOKEN` | Optional. A separate token with **Account / D1 / Edit** used only by the migration step; without it, that step uses `CLOUDFLARE_API_TOKEN`, which then needs D1 Edit |

Create the token under Cloudflare **My Profile → API Tokens → Create Custom Token**.
Restrict Account Resources to **only the existing Lootsplit account**. Grant only
**Account / Workers Scripts / Edit** and **Account / D1 / Read** (the ledger and preflight
reads). Applying migrations needs **Account / D1 / Edit**: grant it on the separate
`CLOUDFLARE_D1_MIGRATION_TOKEN` (preferred; passed only to the migration step) or on this
token. A release with nothing pending makes no D1 write and needs no Edit permission. No DNS,
zone, account administration, API-token management or build-management permissions are needed. Workers
Scripts permissions are account-scoped, not a promise of per-Worker isolation. Use an
expiration and rotate before it expires. Do not use a Global API Key, an Android key,
or `ACCOUNT_SECRET`. Never paste token values in issues, source, logs or chat.

The workflow has read-only GitHub permissions. Tokens are passed only to the deploy
step through environment variables; install scripts are disabled in that privileged
job. Configure normal `main` review/branch protections without bypassing them.

References: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/),
[D1 query permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).

## Database migrations: additive, applied by the release job

Owner decision 2026-10-21: migrations ship in the PR that needs them and the release job
applies them; nobody hand-applies SQL to production. In `Deploy verified website`, after the
artifact's hashes are verified and before preflight and upload,
`scripts/production-migrations.mjs` (wrapped by `recovery-step.mjs`, so a failure is a job
annotation):

1. Refuses to run outside `UnregisteredMusket/Lootsplit` `refs/heads/main`, re-checks that the
   release commit is still current main, and confirms the artifact config targets the
   production database and the artifact's own `migrations/` directory.
2. Reads the ledger (`SELECT name FROM d1_migrations`, D1 Read). Ledger entries missing from
   the artifact, malformed or duplicate numbers, or a pending migration numbered below the
   newest applied one stop the release. With nothing pending it writes nothing.
3. Statically checks every pending file. Each statement must be `CREATE TABLE`,
   `CREATE [UNIQUE] INDEX`, `ALTER TABLE … ADD [COLUMN]`, or `INSERT [OR IGNORE] … VALUES`
   into a table created (without `IF NOT EXISTS`) earlier in that file. DROP, DELETE, UPDATE,
   RENAME, REPLACE, SELECT/AS/WITH, triggers, views, virtual/temp tables, PRAGMA, ATTACH,
   VACUUM, REINDEX and transaction statements are rejected (comments, string literals and
   quoted identifiers are masked first). Migrations 0005 (rename/drop) and 0016 (trigger)
   would have been stopped; such a change needs an owner-approved, separately reviewed
   procedure, never a bypass of this check.
4. Records the D1 Time Travel bookmark, runs
   `wrangler d1 migrations apply lootsplit --remote --config dist/website-release/wrangler.toml`,
   reads the ledger back (also after a failure, so a partial apply is visible) and requires it
   to equal the artifact's migrations. `test-results/production-migrations.json` (Actions
   artifact) keeps before/pending/applied/after and the bookmark; it holds no data rows.

Preflight then repeats the exact-equality check. Any failure stops the job before
`wrangler deploy`: the running Worker keeps serving, and because applied SQL is additive it
stays compatible with that Worker. Fix forward with a new migration; rerun the release only
after reading the annotation and `production-migrations.json`. The `lootsplit-production`
concurrency group (shared with the standby backup) serializes this with every other
production writer; PR and verification runs only ever use local D1.

Keep applied migration files immutable: a filename ledger cannot detect someone modifying
already-applied SQL. Test all migrations on local D1 with the complete release suite (CI does).

This release-process migration adds no SQL. The eight migrations through
`0008_encounters.sql` were confirmed applied on 2026-10-03.

## Recovery

**Application rollback is not a database restore.** Prefer reverting the offending
application commit on `main`; the same full gates produce and deploy a verified revert.
Do not rerun an old SHA: the stale-release guard deliberately rejects it.

For an urgent rollback, first stop queued website jobs and pause new releases. Use
Cloudflare's existing Worker version rollback to the previous version recorded in
`production-preflight.json` (or the deployment history). Confirm that version is
compatible with the current database. Restore matching Worker and assets together;
preserve bindings and secrets. Verify live entry, accounts and read-only health.
Reconcile `main` with a revert before re-enabling releases. Rollback does **not** undo
D1 migrations, account writes or campaign changes.

**Database recovery is a separate incident action.** Prefer a reviewed forward fix.
A D1 Time Travel restore reverts database contents and can discard valid writes since
the bookmark. Confirm the available retention window, coordinate a maintenance window,
prevent concurrent writes, preserve the current database, and obtain explicit approval
for the chosen recovery point and data-loss scope. Restore only the existing production
database, then verify schema, permissions and campaign/account integrity before writes
resume. Never automatically restore D1 because a website smoke check failed.

## Cutover checklist

- Confirm the first GitHub deployment and live identity, title screen and public-page
  audits succeeded. Record commit, Actions run and Cloudflare version.
- Only then remove/disable the legacy Worker **Builds** trigger (do not delete the
  Worker or repository). Inspect *all pages* of build history and cancel every queued,
  initializing or running legacy build. Confirm each is stopped before closing cutover.
  Historical successful/stopped entries can remain; they are not pending deployments.
- Recheck the production version and live identity after cancellation. A build already
  executing an old deploy command during cutover must be stopped and the verified
  release re-established if needed. Do not assume a cancel request completed.

## Android and preservation

Android signed/test workflows, permanent signing certificate, version code and APK
publication triggers are unchanged. The reusable verifier still builds/checks the
mobile client. This infrastructure migration does not publish an APK. Every future
Android release still requires its versioned `src/lib/website/changelog.json` entry
(added features, improvements and summarized bug fixes), signed APK validation and
matching `src/lib/website/release.json` download metadata before the website release.

The parchment styling in commit `32dd9f0` changes only the initial title screen. The
one-time fade, shared 15-second adventurer/rogue loop and click-to-continue code remain
unchanged. At migration start, production was on the preceding `56f6bec` animation
release; both parchment build attempts had stopped without deploying.
