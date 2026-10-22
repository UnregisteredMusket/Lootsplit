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

Completed by the October 22, 2026 review of `main` at `5d77d25` (items P1–P4 of its fix brief). All four were reproduced with a failing test before the fix.

| Item | Severity | Finding | Status |
| --- | --- | --- | --- |
| P1 | High | The non-DM branch of `view()` (`cloud.server.ts`) rebuilt the ledger from `room.table.ledger` and re-spread raw purses over `projectRecord`'s projection. Every player response (`roomState`, `pollRoom`, `submitCommands`, `choosePace`, `passTurn`, `manageRoom`) therefore carried NPC, hidden-NPC and exchange-treasury coins and ledger lines, plus other purses' permissions and editing flags. | Fixed in #166 (`playerTable()`). Other party players' balances and ledger lines stay visible by owner decision (2026-10-22). |
| P2 | High | Room rows approached or passed D1's 2 MB row limit: the largest production `campaign_rooms.body` was 2.36 MB, 1.8 MB of it archived session snapshots (~256 KB per session end). Receipts grew ~444 bytes per submit, and message-only batches had no rate limit (5.2 MB in 45 local requests). | Fixed in #177: snapshots moved to `campaign_room_reports` (0019), 1.8 MB size guard with a `room-storage` monitor log, per-seat submit limit. Receipts (A09) remain; see follow-ups. |
| P3a | High | `normalizeListing` dropped `estateTemplateKey`/`estateAttachments`: shared-room purchases of imported estate listings were refused as "This listing changed…", and offline purchases charged without creating the operating record. | Fixed in #165; owner-approved repair for earlier offline purchases in #171. |
| P3b | High | Offline finance commands loaded empty shops/stock, so `validateBlacksmith` threw in every campaign with a smith (`finance-rule`, `finance-loan`, `finance-terms`, `finance-repay`, `bank-repay`, `property-plan`, `property-details`). | Fixed in #162 with a differential test per kind. |
| P3c | Medium | Offline buy, sell, give and listing purchases skipped the shared quantity cap and ship check, wrote different records and got a fresh command ID per call. | Fixed in #178: device campaigns run the shared engine; player links share its schema and checks; device receipts make retries idempotent. |
| P4 | Low-medium | `/api/account/link` wrote the room body without bumping `revision`, so a stale `updateRoom` could erase `seat.userId`/`ownerId`. | Fixed in #161; every other raw `UPDATE campaign_rooms` already bumped the revision. |

The same review also fixed client failure reporting (P5, #180), room polling cost (P6, #173), fractional weight capacity (P7, #160) and Android widget/backup reliability (P8, #172).

## Checked and sound

Monitoring: DST/timezone day boundaries, missed-cron catch-up, partial-vs-zero labelling, registry validation. Security: staff/owner checks with fresh-session and revision guards, immediate revocation, CSRF (exact Origin + JSON), bound SQL throughout, campaign membership checks, image type allow-lists with no same-origin user files, recovery-key hashing, OIDC telemetry validation, server-only secrets, request size caps, no open redirects. Client: listeners/timers/object URLs cleaned up, no `innerHTML`/`dangerouslySetInnerHTML`, accessible dialogs. CI: no `pull_request_target` or script injection, deploys only from main with independent verification, signing fails closed with a pinned certificate. Android: exported components protected, immutable PendingIntents, HTTPS-only widget client, widget token in Keystore/no-backup storage. No committed secrets.

## Status updates

- **2026-10-21 — B01 and B03 (branch `chore/template-cleanup`).** B01: removed `migrations/`, `drizzle/`, `db/`, `drizzle.config.ts`, `vercel.json`, `scripts/migrate.mjs`, `scripts/migration-plan.mjs`, the `db:migrate` build step, and the unreachable template auth/database stack (`src/lib/db.ts`, `src/lib/env.server.ts`, `src/lib/auth/*` except the root `provider.tsx`, `src/lib/app-data/*` except `types.ts`, `scripts/sign-out-plan.mjs`, their tests and the dev-only `/auth/popup` and PGLite Vite plugins). Two room tests now load `cloudflare/migrations/0001_campaign_rooms.sql` instead of the identical drizzle table. B03: removed the generated `docs/audit/function-inventory.csv` (CI regenerates it as a verification artifact) and ignored local regeneration; kept `2026-10-11-navigation-performance.json` (a point-in-time performance-history snapshot linked from its audit, not regenerated) and `src/routeTree.gen.ts` (CI typechecks before generating it). Dropped `pg`, `@types/pg`, `@electric-sql/pglite`, `kysely`, `drizzle-orm`, `drizzle-kit` from the declared dependencies (they stay in the lockfile only as optional peers of `better-auth`/`db0`; `kysely` is a direct `better-auth` dependency) and moved build-only tooling to `devDependencies`. A Grok extension script check now runs in the live release audit.
- **2026-10-22 — verified fixed on `5d77d25` (October 22 review).** M02, M04, M05, M07–M11 (#129, #152); S01, S02, S03, S06 (#130); U01–U08, U10 (#132); A01 (partial: `MainActivity` only), A03 (#133); B01–B03 (#150, #154). Also addressed before `5d77d25` but not in the review's verified list: U09 (#132), A02 (#133), M06 (#154 index), S04 headers without a script policy (#130), C01/C02 SHA pins and a skip for workflow-only release pushes (#133).
- **2026-10-22 — fixed after `5d77d25`.** M01 remainder: `library_limits` and Better Auth `rateLimit` rows expire hourly (#170); the snapshot cache was already bounded by #129. S04 remainder: `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; script-src-attr 'none'; worker-src 'self' blob:` (#174). S05: per-email sign-in slowdown without lockout (owner decision "slow down, don't lock", #169, migration 0018). S07 and the A01 remainder: Auto Backup rules, install-bound account token, receiver off the main thread (#172, ships with the next signed Android release). C01/C02 remainder: OIDC and release-write permissions per job; Android signing split from the emulator gate and publishing with a hash pin (#175). Shared rooms and economy: see the section above.
- **Still open from this audit.** M03 (the GitHub token secret is an owner action; not re-verified here). Maintainability items are unchanged.

## Open follow-ups (2026-10-22)

Known open items after the October 22 review fixes (#160–#180). Each has a short design note; none is scheduled.

1. **Room receipts still grow in the row (A09).** `room.commands`, `commandHashes`, `batches` and `batchHashes` back idempotency, so #177 did not prune them. Measured share today: at most 4.7 KB across the largest rooms, but about 444 bytes per live submit without bound, so the 1.8 MB guard will eventually refuse very long-lived rooms. *Design (proposed in #177):* an additive `campaign_room_receipts(code, seat_id, kind, id, hash, created_at)` table keyed by room and seat, written in the same CAS batch as the room, read by primary key on submit, with inline receipts migrated lazily on the next write as reports are. `acknowledged` in the view would read only the seat's recent receipts. Receipts are never deleted; only their location changes. Follow `/money-command`: retries must stay exactly-once across the move.
2. **Account backup restore keeps inline snapshots.** `campaign-recovery.mjs` inserts the restored body directly, so a restored room carries inline snapshots until its next write, and a backup whose snapshots exceed 2 MB would still hit D1's limit. *Design:* route restore through `encodeRoomImages` + `roomImageStatements` so report rows are inserted in the same batch as the room. In progress in #184.
3. **Shared `post` and `setPurseCoins` are table patches.** In a shared room, DM coin postings, Party payments and direct coin edits go through the reviewed table patch, not `commands.ts`, so their command ID only guards device retries (#178, #180). A lost response followed by a second press can apply twice. DM Help tells the DM to check the ledger first. *Design:* add DM-only `post` and `set-coins` command kinds to `commands.ts` (revision-checked, whole copper, idempotent ID in `room.commands`), route both actions through `shared()` when joined, and keep `economy.ts` behaviourally identical with a differential test.
4. **No browser audit forces client failures (#180).** The P5 behaviour (keep input, settle only on success, retry once) has unit coverage only. *Candidates:* (a) a turn-based room where player B presses Give on player A's turn: expect the error toast, retained fields and a disabled-then-enabled button, then on B's turn one press applies one ledger line; (b) offline DM imports a player activity file with a loan request, the borrower's account is deleted, Approve shows "This account no longer exists.", the receipt keeps both buttons and shows no "Approved.". Add them to the existing property or finance audit as new scenarios rather than new suites.
5. **Party NPC companions show private coins to non-controllers.** Since #166, an NPC moved into the party is still an NPC, so players who don't control it see its funds as private, while party players' funds stay visible. This follows `DOWNTIME-ACTIVITIES.md` ("Private NPC balances must never be projected") but differs from how party players appear. **Resolved (2026-10-22, owner decision "Make it toggle-able by the DM"; `feature/companion-funds-toggle`):** campaign-level DM setting **Party can see companion NPC funds** (People & NPCs → Party companion funds), default off. When on, party players read visible companions' coins and ledger lines read-only; hidden NPCs, treasuries and non-party players are unaffected. Covered by `player-view-privacy.test.ts` and `companion-funds.test.ts`; DM and player Help updated.
6. **Guest-chat member-send flake still recurs after #164.** The intermittent `dev-guest-chat` member send in `Development / governance` was narrowed by #151 and #164 but still appears occasionally. *Next step:* keep the trace of the next failure and compare the member's send with the room session confirmation; fix the readiness wait or the race it shows. Don't add retries or sleeps (CODING-MANUAL §4).
7. **Smaller leftovers recorded in the merged PRs.**
   - `expireRateLimits` does not yet expire `signin_throttle` rows (#170 asked whichever of #169/#170 merged second to add `DELETE FROM signin_throttle WHERE last_attempt_at < now - 24h AND blocked_until < now`). The table holds rate-limit state only.
   - `fail()` in `cloud-client.ts` still publishes with `dataChanged=true` on transport errors, so a failed poll reloads the economy (backed off; #173).
   - CSP still allows `'unsafe-inline'` scripts for TanStack Start's hydration; a nonce needs SSR support wired through the Worker (#174).
   - `performance-log.yml` grants `contents: write` at workflow level; `player-reference-audit.yml` runs `recovery-step.mjs` without `id-token` (#175).
   - The Android fixes in #172 wait for the next signed release (version bump, changelog, release notes, verified `release.json`); no physical-device Auto Backup restore has been tried, and a backup taken before that release can still restore its token once.
   - Other `run()`-based economy actions (shop, holding and catalog edits) still only toast on failure; their forms don't clear input (#180).
   - U06: `sheets/save` returns no revision, so a second sheet save before a successful refresh can still conflict (#132).
