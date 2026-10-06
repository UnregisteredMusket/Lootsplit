# Roadmap priorities: implementation and verification

Baseline: released main `e437ab517429ba48ecf76e0b7a7885eefadd886c`. Application implementation: `7efd5947ac4c22ef5a351762d583921814f9219d`, with property-schedule reuse correction `e1310f7e1055a3b3b3165943fc29845a040fdabc`. Work branch: `feature/roadmap-priorities`.

## Scope and status

1. **Implemented:** player account-character submission from Room or the existing character editor, pending DM review, approve/deny, status display, current permission/session/target checks and exactly-once approval receipts.
2. **Prepared:** explicit origin roles, account-host validation, legacy-origin handling, independent host-only logins, shared invitation URLs, configuration preflight and read-only migration guidance. No domain/DNS/TLS/account-infrastructure change. Real two-host/legacy-APK activation rehearsal is still required.
3. **Implemented:** homepage tour with real synthetic-data screenshots, connected-workflow explanations and browser/Android comparison. Existing website theme and application layout retained.
4. **Implemented:** shop opening cycles and restock top-ups on approved in-game downtime; property revenue/upkeep management through existing finance schedules. Existing linked schedules are reused; multiple rules of one type require review instead of silently doubling income. This is periodic property simulation, not construction/tenants/random events or hourly scheduling.
5. **Defined, inactive:** proposed Classic/Casual/Hard/Lootsplitter and local/regional/realm tax rules in `docs/plans/ECONOMY-MODES-AND-TAXES.md`. Owner must approve the proposed numbers/taxable events before activation.

**Publication authorized; release pending.** The user explicitly approved GitHub publication, full checks, additive migration0009 and gated merge/deployment on 2026-10-06 UTC, resolving the earlier automatic approval block. No release has occurred at this checkpoint. Domain activation and APK publication are not included.

## Connected data and safeguards

- `character_imports` stores the submitted review snapshot, source/target revisions, session/seat authorization and decision receipt. This necessary review/audit copy is private to the source user and current campaign DM; tokens are never included in review responses. The canonical campaign purse and holdings remain authoritative for money/items. Source assignment, target update and approval receipt share the existing D1 batch/CAS path.
- Campaign finance remains in the existing journal. Property plans update ordinary income/expense rules, preserving partial periods and arrears. No additional wallet, accounting database, timer or polling service is introduced.
- Shop schedules live with their shop; the existing approved campaign-day clock computes availability/top-ups. The stored downtime quote contains the expected market state and projected changes. A concurrent stock/schedule change makes approval require a fresh quote. Finite surplus and unlimited stock are retained.
- Offline session commands now pass through the existing atomic finance transaction with a complete archival snapshot; active ledger/chat clearing and next-session settlement occur under that lock. Shared commands remain server-authoritative and use existing retry receipts.
- Origins have distinct website/native/legacy roles. Browser credentials remain host-only, native signed-bearer behavior remains, and no cross-origin credential transfer or blanket redirect is added. Existing backups, source migration files, client validation, audit records and retry receipts are retained deliberately.

## Verification

Environment: Node22.23.3/Linux x64/Chromium133 locally; current-browser GitHub CI is still a mandatory release gate.

- Final quick checks: **504 passed, 4 existing skips**, TypeScript clean, ESLint 0 errors / 34 warnings.
- Web and mobile builds passed on the final application source. Mobile build is compatibility verification, not a signed APK release or physical-device test.
- Character API regressions: pending submission leaves campaign unchanged; unauthorized review rejected; denial; changed target/session rejected; concurrent money retained; repeated approval no-op; existing ownership/manual-roll/assignment behavior retained.
- Character desktop/mobile browser audit passed with actual player submit → DM approve → player reload/play, plus inventory, lost-response roll deduplication, manual policy and readonly DM roster.
- Finance regressions passed, including shared permission enforcement, compound/simple debt preservation, property reuse, stale market preview rejection, finite/unlimited stock handling, closed-shop purchase rejection, atomic local approval, complete session archives and backup round-trip.
- Expanded finance desktop/mobile browser audit passed with real property/schedule forms, approval and reload, loan/repayment and campaign separation. Reviewed the actual rendered screenshots; no horizontal overflow.
- Website desktop/mobile audit passed; seven public/account pages, navigation, download link and theme checks. Product images were visually inspected and use disposable synthetic data. External template script requests failed separately in this environment; application runtime checks passed.
- All eight isolated account scenarios passed in **83.211s including setup**, from checkpoint `7efd594`; subsequent application correction only changes property rule reuse. Cross-device campaigns, portraits, invitations, ownership/revocation, recovery and backup library covered.
- Encrypted backup browser audit passed: create, export, password change/re-encryption and restore confirmation. Campaign governance desktop/mobile audit passed: permissions, gameplay edits, archive reports, leave, owner Test configuration/reset and isolation.
- Built immutable website and portable standby artifacts verified. All eight account scenarios also passed against the built standby artifact (**37.5s runner report**), including SSR and desktop/mobile flows. Do not compare that runner-only duration to the development setup-inclusive duration.
- Local D1 migrations 0001–0009 applied successfully to a disposable database. Local Cloudflare emulator launch failed on environment `uv_interface_addresses`; no application bypass was added. Full packaged-Worker CI remains required. The supported standby harness successfully exercised the built artifact but does not replace Cloudflare CI or live audits.
- Domain API tests passed with two explicit synthetic HTTPS origins, independent sign-ins/secure host-only cookies, attacker/suffix/insecure origins, unapproved request host, untrusted callback and legacy native access. `migration:check` passed.

## Performance history review

Synced history: 333 recorded observations, no pending collections/stale resolutions. Last confirmed recorder for the baseline release succeeded (37405446688). No history is deleted or reset. Since the integration report's 326 observations, these seven entries require retention:

| Operation | Before → logged after | Added | Increase | Assessment / next action |
| --- | --- | --- | --- | --- |
| PR unit tests | 11 → 13s | 2s | 18.18% | Expanded tests and runner conditions; compare next equivalent CI group |
| PR packaged analytics | 4 → 6s | 2s | 50% | Short-step timing/runner signal; no proven analytics regression |
| Main bug audit | 4 → 5s | 1s | 25% | One-second granularity; keep observation and compare next run |
| Main final verify job | 6 → 40s | 34s | 566.67% | Gate-job overhead/scheduling needs CI metadata diagnosis; not evidence of slower gameplay |
| Main loot audit | 7 → 9s | 2s | 28.57% | Needs equivalent CI comparison; local expanded checks are not a substitute |
| Main gameplay group | 145 → 171s | 26s | 17.93% | User-visible verification-group delay; inspect job steps/queue on next complete CI |
| Main member audit | 6 → 7s | 1s | 16.67% | Short-step signal; no source diagnosis established |

Evidence: runs37402023907,37402387007,37405125361; original URLs and durations remain in `performance-history/regressions.jsonl`. Earlier unresolved encounter/standby/setup trends remain open; this feature change does not establish their cause or resolution. No runtime/development speed improvement is claimed. New approval/property coverage changes test workload, so comparing its duration with older narrower suites would be misleading. Screenshot assets are lazy-loaded; no heavy runtime dependency or background schedule polling was added.

## Remaining gates and decisions

- Explicit publication permission for `UnregisteredMusket/Lootsplit`, then exact-head full PR checks, reviewed additive migration0009, merge, full main checks, automatic verified-artifact deployment and read-only live identity/asset/desktop/mobile audits.
- Domain selection/cost/security settings/DNS/TLS and real cutover/rollback/old-APK rehearsal remain owner/activation tasks in the domain plan. Production data was never used destructively.
- Approve/revise the documented tax/preset numbers before implementation. No taxes or new difficulty presets are active.
- Android retains its existing permanent signing identity and published APK; a separate authorized signed release is needed to distribute these new web features to installed APKs.
