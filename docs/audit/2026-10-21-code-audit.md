# Lootsplit code audit — October 21, 2026

Baseline: main `9ee94cb` (Android 1.9.1, #128), the final state of the previous development handover. Read-only audit; no code was changed. This consolidates and supersedes `2026-10-21-monitoring-and-security.md` (same finding IDs) and adds production readback, client code, build/CI/Android, and shared-room/economy logic.

Method: source read end to end for each area, with small reproduction scripts against the repo's SQLite D1 stand-in where useful, and read-only SELECT queries against the production D1 database. Limits: the npm registry was unreachable, so only the 362 dependency-free tests ran (all passed; the remaining 101 failed only on missing packages). Typecheck, lint and dependency audit did not run.

## Production readback (2026-10-21, ~06:00 UTC)

- First daily report generated for `America/New_York:2026-10-20`. It reports "13 of 48 scheduled intervals observed … coverage incomplete" because slots before monitoring started are counted (M07).
- That report is **923,580 bytes** for ~11 monitored hours. D1 rejects any row over 2,000,000 bytes. Largest parts: correlations 224 KB, evidence 223 KB (545 items), performance 203 KB, incidents 139 KB. A full day can exceed the limit, which triggers the M02 retry loop.
- GitHub source: `HTTP_403_RATE_LIMITED` in production slots (M03 confirmed).
- Workflow telemetry and performance ingestion are arriving (181 workflow and 253 performance log entries in 24 h).
- 35 snapshots in ~7 h (1.1 MB); 3,089 log rows. Database file grew ~0.4 MB in ~25 minutes of observation.

## Priority 1

| ID | Area | Finding | Fix |
| --- | --- | --- | --- |
| M02 | Monitoring | A daily report that throws is retried every minute (`monitor-journal.mjs:1336-1343`), adds a failure log row each time, and the throw skips the report-refresh queue. **Now urgent:** report bodies are uncapped and the first partial day is already 0.92 MB of D1's 2 MB row limit. | Cap report sections (bounded evidence/correlation lists with counts), store failed reports as failed/partial and back off, run each scheduled phase in its own try/catch. |
| M01 | Monitoring | `owner_monitor_snapshots` and `owner_monitor_logs` are never pruned; only the newest snapshot is read. ~20 MB/day observed. `owner_monitor_intervals`, `owner_monitor_ingest` and `library_limits` also grow without limit. | Keep the last N snapshots in the insert batch; dated retention for logs/intervals; expire rate-limit rows. |
| S01 | Security | Every production page loads `https://grok.com/grok-app-builder/extensions.js` (`scripts/grok-pwa-shared.mjs:210-213, 464`) because `VITE_GROK_EXTENSIONS` defaults to on. It runs with the signed-in owner's session; there is no CSP. | Disable it for the Cloudflare build, add a strict CSP, update the AGENTS.md rule. |
| S02 | Security | Open sign-up and no per-user limit on `/api/account/backup` or `/api/account/character` (`accounts.mjs:485-547`): one account can add ~240 MB/min to the shared database. | Per-user count/byte guard in the INSERT; consider verified or invite-only sign-up. |
| C01 | CI | The Android signing job runs `android-actions/setup-android@v3` and `reactivecircus/android-emulator-runner@v2` (tag-pinned) in the same job that decodes the signing keystore, with `contents: write` and `id-token: write` for every step (`android-release.yml:11-15, 58, 109`). A compromised tag could capture the key. | Pin actions by commit SHA; split signing/publishing into a job with minimal steps; default `contents: read`; drop the npm cache there. |

## Priority 2

| ID | Area | Finding | Fix |
| --- | --- | --- | --- |
| M03 | Monitoring | GitHub source rate-limited (confirmed). Unauthenticated limit is 60/h on shared Cloudflare IPs. | Add the `OWNER_MONITOR_GITHUB_TOKEN` secret; optionally cache across isolates. |
| M04 | Monitoring | A post-commit error marks a committed interval failed (`monitor-journal.mjs:894-920`). | Move the snapshot refresh out of that try. |
| M05 | Monitoring | Failed slots retry every minute without limit (`:792`), each calling GitHub and Cloudflare. | Cap with the existing `attempts` column and back off. |
| M06 | Monitoring | Late-log trigger scans every report via `json_extract` on each log insert (migration 0016). | Indexed integer start/end columns. |
| S03 | Security | Any member can read the whole campaign's roll history (`character-play.mjs:536-548`), including DM hidden-NPC rolls. | Scope non-DM requests to readable, controlled characters. |
| S04 | Security | No `frame-ancestors`, `nosniff` or HSTS headers. | Add in `releaseResponse`. |
| U01 | Client | Encounter reload can overwrite edits typed while a background reload is in flight; the `.then` never checks abort/editing state (`encounters/workspace.tsx:469-492`, also 494-505). | Ignore stale/aborted responses and skip while editing; shared draft hook. |
| U02 | Client | If the boot-time campaign deletion fails, `deleting` stays true and the intent stays stored, so every campaign create/switch/delete throws on every load (`quire/campaigns.ts:150-153, 110`). | Clear state in the catch and offer retry/discard. |
| U03 | Client | Failed online encounter fetch is swallowed (`encounters/workspace.tsx:173`, `player-display-controller.tsx:147`); users see only device encounters with no error. | Show an "online encounters unavailable" notice. |
| B01 | Build | Two unused migration systems from the Grok/Vercel template (`migrations/`, `drizzle/`, `db/`, `scripts/migrate.mjs`, `vercel.json`) beside the real `cloudflare/migrations`. Cannot touch production, but `drizzle-kit` would generate a wrong diff. | Remove them and the `db:migrate` step in `build`. |
| B02 | Database | Likely full scans: `play_characters WHERE campaign_code=?` (only a partial index), `moderation_audit WHERE target_id=?`, `bug_report_audit WHERE report_id=?`. | Add the three indexes. |

## Priority 3

| ID | Area | Finding |
| --- | --- | --- |
| M07 | Monitoring | First/partial days count pre-monitoring slots as missing (confirmed in production). |
| M08 | Monitoring | `dayBounds` accepts impossible dates (`2026-02-31`). |
| M09 | Monitoring | Midnight slot's interval and log land in different days. |
| M10 | Monitoring | Registry has no retire/delete route or entry cap. |
| M11 | Monitoring UI | A form validation error clears the loaded lists until reload. |
| S05 | Security | Sign-in rate limit per IP only; no per-account lockout. |
| S06 | Security | Telemetry endpoint refetches GitHub JWKS for any unknown key ID before signature checks. |
| S07 | Android | WebView account token included in Auto Backup (`allowBackup="true"`, no rules). |
| U04 | Client | Mobile network listener can leak if unsubscribed before the dynamic import resolves (`mobile/online.ts:22-27`). |
| U05 | Client | Number fields snap empty or "-" to 0, so negative values can't be typed (`characters/workspace.tsx:119`, `property-operations.tsx:166`). |
| U06 | Client | A successful save shows an error if the follow-up refetch fails, then the retry conflicts (`characters/workspace.tsx:591-605`, `encounters/workspace.tsx:519-524`). |
| U07 | Client | Player-display encounter detail polls every 2 s while hidden (`player-display-controller.tsx:196-198`). |
| U08 | Client | Map handouts silently empty on a transient error (`campaign-map.tsx:136-138`). |
| U09 | Client | Index keys on removable sheet rows move open/focus state to the wrong row. |
| U10 | Client | One unlabeled checkbox (`price-harvest.tsx:125`). |
| A01 | Android | `WidgetRegistration.refresh` runs on the UI thread at first launch after upgrade (`MainActivity.java:12`); `WidgetInstallReceiver` renders twice. |
| A02 | Android | FileProvider exposes all external storage (`file_paths.xml`); release has `minifyEnabled false`. |
| A03 | Android | Lawnchair (and possibly other third-party launchers) kept a stale widget list and hid the 4×1 companion on the owner's phone after 1.9.1; adding it from My Account worked. Help should say so. |
| C02 | CI | Release notes for 1.9.1 have missing spaces and were committed as already published; a workflow-only edit re-triggers a failing release run; `id-token: write` broader than needed in three workflows. |
| B03 | Repo | Generated data committed (`function-inventory.csv` 1.8 MB, a 308 KB performance JSON) that CI already regenerates. Build/test packages listed in `dependencies`; unused `pg`, `pglite`, `kysely`, `drizzle-orm`. |

## Maintainability

Four files over 2,000 lines carry most change risk: `campaign-map.tsx` (camera hook, record layer, inspector, `MapEditor` file), `characters/workspace.tsx` and `encounters/workspace.tsx` (one component per tab plus a shared `useRevisionedDraft` hook, which also fixes U01 and U06), and `property-operations.tsx` (already 29 components; mechanical split). There are 62 inline copies of error-message extraction; `styles.css` repeats `.barter-*` blocks.

## Shared rooms and economy

Review in progress; this section will be added when it completes.

## Checked and sound

Monitoring: DST/timezone day boundaries, missed-cron catch-up, partial-vs-zero labelling, registry validation. Security: staff/owner checks with fresh-session and revision guards, immediate revocation, CSRF (exact Origin + JSON), bound SQL throughout, campaign membership checks, image type allow-lists with no same-origin user files, recovery-key hashing, OIDC telemetry validation, server-only secrets, request size caps, no open redirects. Client: listeners/timers/object URLs cleaned up, no `innerHTML`/`dangerouslySetInnerHTML`, accessible dialogs. CI: no `pull_request_target` or script injection, deploys only from main with independent verification, signing fails closed with a pinned certificate. Android: exported components protected, immutable PendingIntents, HTTPS-only widget client, widget token in Keystore/no-backup storage. No committed secrets.
