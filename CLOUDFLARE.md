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
   It downloads the artifact from that precise run, validates hashes/commit, checks
   current `main`, existing production bindings and the D1 migration ledger, and runs
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

Create the token under Cloudflare **My Profile → API Tokens → Create Custom Token**.
Restrict Account Resources to **only the existing Lootsplit account**. Grant only
**Account / Workers Scripts / Edit** and **Account / D1 / Read**. The latter permits
reading the migration ledger, not schema changes. No DNS, zone, account administration,
API-token management, D1 write or build-management permissions are needed. Workers
Scripts permissions are account-scoped, not a promise of per-Worker isolation. Use an
expiration and rotate before it expires. Do not use a Global API Key, an Android key,
or `ACCOUNT_SECRET`. Never paste token values in issues, source, logs or chat.

The workflow has read-only GitHub permissions. Tokens are passed only to the deploy
step through environment variables; install scripts are disabled in that privileged
job. Configure normal `main` review/branch protections without bypassing them.

References: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/),
[D1 query permissions](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).

## Database migrations: explicit, separate and reviewed

Website CI **does not apply remote SQL**. Its token needs only D1 Read. Pending,
missing or extra migration-ledger entries stop deployment. Keep applied migration
files immutable. A database change requires its own reviewed migration and recovery
plan; a filename ledger alone cannot detect someone modifying already-applied SQL.

Before a future schema release:

1. Review SQL and compatibility with the currently running and rollback versions.
   Prefer additive expand/contract migrations; defer destructive steps to a separate
   maintenance change. Test all migrations on local D1 with the complete release suite.
2. Capture the current D1 Time Travel bookmark and timestamp, and export a database
   backup to secure owner-controlled storage. Treat exports as private account/campaign
   data: **never** upload them as public repository or Actions artifacts.
3. With a separate, short-lived account-scoped **D1 Edit** operator credential,
   list pending migrations using `npx wrangler d1 migrations list DB --remote`.
   Review the exact list; apply only the approved changes with
   `npx wrangler d1 migrations apply DB --remote`. Run from the reviewed commit and
   root config. Record applied names, hashes, bookmark and results privately.
4. Recheck the ledger and application compatibility. Rerun the current-main verification
   job to initiate the website release. Revoke the temporary migration credential.

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
