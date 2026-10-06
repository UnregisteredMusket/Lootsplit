# Integration, consistency and efficiency audit — October 5, 2026

## Scope and starting state

User authorized a comprehensive integration audit and verified improvements with **no UI reformatting**. Baseline main and production: `57903387de3dd600bb30bc68a69f24f164c51081` (PR #45). Baseline verification `37393097454`, production deployment/read-only mobile/desktop audit `37393529289`, and standby publication succeeded. Android 1.4.0/code 6 is already published; this audit does not rebuild or replace that signed APK. Branch: `audit/integration-consistency`.

Read AGENTS.project.md, coding manual, recovery, feature inventory, redesign preservation baseline and performance policy. Ran recovery status and read-only performance sync. This is a source-and-regression audit, not proof of every possible interaction, load level or physical-device condition.

## Integration map

| Systems | Authority and shared logic | Read/write, persistence, synchronization and permissions |
| --- | --- | --- |
| Hosted campaigns, sessions, invitations | `cloud.server.ts`, `cloud.ts`, `room-store.server.ts`; D1 room body/revision | Authenticated DM creation; seat/token and invitation generation checks; command receipts and compare-and-swap commits. Explicit session close archives state and revokes access. Account resume selects a specific membership, never a matching campaign name. |
| Local campaigns and guest views | `db.ts`, `guest-storage.ts`, `campaigns.ts`, `economy.ts` | Owned DM campaigns use separate IndexedDB databases. Guest state uses in-memory IndexedDB and a tab reconnect ticket. Shared local state is a projection/pending preview; the server remains authoritative. |
| Synchronization and turns | `cloud-client.ts`, `cloud-turn.ts`, `commands.ts` | One serialized command chain; receipt IDs survive retries. One bounded polling loop, hidden/offline suppression and failure backoff. Live submits; turn-based drafts intentionally remain pending. Current revision is persisted only after local hydration. |
| Characters, Party, wallets and inventory | `characters/campaign-sheet.mjs`, `economy-context.tsx`, `campaign-characters.mjs` | Campaign character ID equals purse ID; stats exclude a second spendable wallet. Sheet projections overlay canonical coins/holdings. Changed field groups are conflict checked; an HP save does not roll back unrelated purchases. Server field permissions govern structural edits, money and inventory. |
| Standalone account characters | `character-play.mjs`, account sheets and private profiles | Account ownership and explicit assignment. Distinct from a campaign copy. Import/assignment never merges by name or silently transfers wealth. |
| Shops, purchases, sales, transfers and ledger | `economy.ts`, `commands.ts`, `money.ts`, `merchant.ts` | Local transactions or shared authoritative command commits update funds, stock, holdings and ledger together. Integer copper, shared pricing helpers, service rules, ownership and turn checks. Receipt/deduplication history is necessary. |
| Loans, recurring finances, downtime, session summaries | `finance.ts`, `journal.ts`, `commands.ts` | Finance lives in campaign journal; preview is recalculated before explicit approval. Settlement updates balances, debt, elapsed days and receipt together. Internal lender transfers are classified separately from spending. |
| Encounters, combat and rewards | `encounters/model.mjs`, `encounters/local.ts`, `cloudflare/encounters.mjs` | Local drafts use campaign meta; account/hosted drafts use D1. Shared model/generator/table rules. Local award transaction and D1 award batch commit receipt plus campaign assets; stale revisions and repeated transfers are checked. Private account drafts cannot award to a campaign. |
| Dice and roll logs | `characters/model.mjs`, `campaign-roll.mjs`, `character-roll-client.ts`, `cloud.server.ts` | Canonical sheet values, permission-checked manual results, labeled device/server dice and retry receipts. Rolling does not apply HP/effects automatically. |
| Journals, session archives and analytics | `session-records.ts`, `journal.ts`, `analytics.ts`, `game-analytics.mjs` | Archive freezes session records without recursive earlier archives. Server projects DM/player privacy. Analytics merges archived/current ledger by ID, excludes transfers/voids appropriately and excludes Test rooms. Public allowlist exposes spending only; aggregate cache intentionally lasts up to 60 seconds. |
| Chat, notifications and sounds | `chat.ts`, `chat-visibility.ts`, `notify.ts`, `sound.ts` | Party/private visibility is enforced server-side. Notification priming prevents history replay. Sounds are device-local/default-off, gated on outcome, visibility and preference; cached decoding does not change gameplay. |
| Imports, catalog, Open5e and private books | `sheet-file.ts`, `import-fields.mjs`, `pdf.ts`, `ocr.ts`, `open5e.ts` | Reviewed imports normalize supported fields; partial import preserves unspecified fields. Source attribution stays attached. PDF/OCR processing is local; OCR worker loads on demand. Private books are distinct from explicitly shared handouts. |
| Backups and restore | `snapshot`, `restore`, `saves.ts`, account library | Full device backup includes books, metadata and recovery state; shared snapshot excludes private books. Encryption policy and explicit restore/claim remain. Backup versions are recovery copies, not redundant live wallets. |
| Accounts, moderation, bugs and monitoring | `accounts.mjs`, `members.mjs`, `bug-reports.mjs`, `monitoring.mjs` | Server sessions, account restrictions, staff role checks and revision guards. Owner/admin privileges do not imply unrestricted campaign/private-sheet access. Monitoring aggregates without exposing private contents. |
| Web, Android and navigation | shared React client, mobile origin/Capacitor, `AppLink`, `navigation-launch.ts` | Same gameplay rules; native transport/storage adapters remain deliberate. Router navigation preserves document/title state. Android remains separately signed/versioned; web code changes do not upgrade an installed APK. |

## Confirmed findings and changes

### I-01 — High: mixed-state campaign snapshots and backups

`economySnapshot()` read five financial stores first, then opened seven independent metadata reads. `snapshot()` read books/financial rows, then opened eight independent reads for listings, loans, sheets, gifts, sales, chat, handouts and journal. A concurrent atomic write could therefore make exported coins describe the old state while its session record described the new state. Those snapshots also feed shared mutation diffs and backup/restore, so this is an integration boundary, not merely a stale visual readout.

Deterministic fake-indexeddb regression queues a real write directly behind the first read transaction. Both old implementations fail: 100 copper is paired with the newer award event. The fix enqueues related records in the **same readonly transaction**. Both tests now pass. Existing gift/report tests additionally caught an initial adapter mistake in the fix; it was corrected to preserve the stored gifts envelope, and those tests pass unchanged.

### I-02 — Medium: financial views assemble state with separate reads

The economy provider used 12 separate reads, including a later journal read. It now uses a single coherent `economyView()` transaction covering financial rows, catalog, lexicon and needed metadata. The provider keeps campaign/sequence checks against stale refreshes. Shared transaction readers reuse existing normalizers; no save schema or permission changes. View reads deliberately exclude private books, chat and handout contents. Existing UI markup, routes and styles are unchanged.

A third regression verifies the financial projection cannot mix old funds with newer journal events. Sorting/default behavior is preserved.

### I-03 — Medium: encounter listing performs per-campaign database round trips

Listing saved encounters previously executed an initial membership query, two queries per campaign, and the encounter query: **44 queries for 21 memberships**. A join reads current membership plus room state together, then validates matching seat ID/token and DM role. The second query projects encounter names rather than transferring every full encounter body. Result: **2 queries**, independent of membership count (95.45% fewer in the fixture).

Regression failed on the old implementation (44 versus a bound of 2), then passed. It covers valid DM memberships, a revoked token and player-only memberships. All mutation authorization/CAS paths remain unchanged; tokens/room bodies are never added to the response.

### I-04 — Medium: local purchases can apply an obsolete Charisma discount

Local shop and market purchases read Charisma in a separate transaction before debiting funds. A regression queues an approved score change immediately before the purchase write: the old code commits Charisma 20 but charges the price for Charisma 10 (9,000 copper remains rather than 9,100 in the fixture). Both shop and listing tests fail before the fix.

Charisma now comes from the purse and, when necessary, legacy sheet metadata inside the purchase transaction. Existing shared commands already use a single authoritative table. The change removes the extra all-purses read, keeps the party-fund no-discount rule and legacy fallback, and makes price, balance, stock, inventory and ledger agree. Both regressions plus existing purchase/concurrent-final-stock tests pass.

## Deliberate duplication retained

- Server validation plus client feedback; local transactions plus D1 transaction adapters.
- Canonical hosted data, pending turn previews, retry receipts, immutable session reports and encrypted/versioned backups.
- Standalone account profiles, per-campaign characters and explicitly separate campaigns.
- Legacy sheet parsing and import compatibility alongside canonical character stats.
- Shared pure pricing/finance/permissions/models, with platform-specific persistence.
- Identity-read coalescing, analytics cache and decoded audio cache with their current scopes.

No wholesale rewrite, new framework, UI redesign, account merge, schema migration or data deletion. No blanket cache of private writes and no removal of idempotency/security checks.

## Remaining observations and limits

- Character editor has initial and background detail-load effects; further consolidation needs a focused request-order/draft-protection reproduction before editing. No proven user data defect is asserted from seeing two effects.
- Shared-room polling intentionally still returns an authoritative room projection. Delta protocols, indexed ledger storage and analytics materialization would require measured production-scale workloads and compatibility work; this audit does not speculate about their benefit for the current small deployment.
- Old inventory paragraphs describing unavailable OCR or guest DM creation are historical and superseded by later authorized sections. This audit does not revive retired offline player copies.
- No physical Android upgrade/file-picker/force-close verification, production load benchmark, or private real-campaign inspection. Browser suites use disposable accounts/campaigns. Real data is untouched.

## Verification and release tracking

Implementation is committed locally as `efb1909` on `audit/integration-consistency`. No PR, merge or deployment occurred. Automatic approval review rejected the GitHub push because exporting repository contents to the remote required explicit publication permission. The rejection has not been bypassed. Existing production remains the baseline release identified above; full PR/main preservation checks and live immutable-artifact audits remain release gates.

The initial deterministic snapshot tests failed before the fix; all three pass after it. Both pricing races and the encounter query-count regression failed before and pass after. All eight encounter server tests pass, including retry receipts and rollback on failed inventory writes.

### Workflow evidence

| Workflow | Evidence collected in this audit | Limit |
| --- | --- | --- |
| Purchases, stock, funds, inventory, ledger and analytics | Existing atomic/concurrent-last-stock tests, new pricing races, retry/lost-response tests, analytics deduplication tests | Production load and latency not measured |
| Encounter awards | Server suite verifies retry deduplication, invalid recipients, stale room revisions and rollback of receipt acquisition on inventory failure | Browser PDF/OCR import coverage needs current CI Chromium |
| Character changes alongside inventory/currency | Changed-field conflict and unrelated-write preservation tests; Party-sheet and governance browser audits | Does not enumerate every possible concurrent action |
| Downtime and debt | Finance tests plus desktop/mobile preview, approval, settlement, reload, repayment and campaign isolation browser checks | No real campaigns used |
| Session end/reopen and cross-device resume | Eight account browser scenarios and server membership/revocation tests | Full packaged-worker release suite remains pending |
| Import/restore integrity | Partial-field/legacy tests; protected backup export, password rotation and restore; data-integrity browser checks | Physical Android file picker and all document formats not revalidated |
| Notification history and sounds | Priming/change-detection tests; desktop/mobile sound decode, preference persistence and mute checks | Not proof of all device audio engines |
| Internal navigation | Account invitation/resume scenarios; separate navigation audit recorded below | Isolated governance pass does not explain earlier title-screen failures |

Security checks, offline adapters, pending turns, recovery copies and platform boundaries remain intentionally separate. The feature inventory remains `docs/FEATURE-INVENTORY.md`; the system map above is the concise feature-and-integration index.

## Performance evidence

History sync contains 326 observations, zero pending collections and zero stale resolutions. Latest observed recorder run 37395657957 succeeded. Prior documented audio audit contained 304 observations; all 22 later entries are reviewed below. No historical trend is reset. Setup/download/upload entries are infrastructure/second-resolution signals; they are not evidence that gameplay code became slower. Failed help is an audit failure, not a successful runtime measurement. Gameplay/governance/interface execution trends remain open pending comparable diagnosis; checks were not weakened.

| Operation | Previous → observed | Added | Increase | Outcome / evidence |
| --- | ---: | ---: | ---: | --- |
| Development / governance / Run npx playwright install --with-deps chromium | 23s → 30s | +7s | 30.43% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029497710) |
| Development / gameplay / dev-local-encounter | 6s → 7s | +1s | 16.67% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029497830) |
| Development / governance / dev-campaign-governance | 49s → 57s | +8s | 16.33% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029497710) |
| Development / gameplay / dev-library-navigation | 12s → 17s | +5s | 41.67% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029497830) |
| Packaged Worker / interface / worker-help | 11s → 25s | +14s | 127.27% | failure · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029923814) |
| Development / governance | 185s → 213s | +28s | 15.14% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029497710) |
| report | 10s → 12s | +2s | 20% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389424072/job/112030687648) |
| Report workflow failure | 10s → 12s | +2s | 20% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389424072) |
| Packaged Worker / interface / worker-sound | 7s → 9s | +2s | 28.57% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112030816533) |
| Packaged Worker / interface / worker-loot | 5s → 6s | +1s | 20% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112030816533) |
| Packaged Worker / interface | 126s → 160s | +34s | 26.98% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112030816533) |
| Packaged Worker / interface / Run actions/checkout@v4 | 1s → 2s | +1s | 100% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389751532/job/112032198346) |
| Development / gameplay / dev-local-encounter | 6s → 7s | +1s | 16.67% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389751532/job/112031761500) |
| Packaged Worker / interface | 123s → 142s | +19s | 15.45% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389751532/job/112032198346) |
| verify / Run actions/checkout@v4 | 1s → 2s | +1s | 100% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389751532/job/112033097198) |
| Packaged Worker / interface / Run actions/setup-node@v4 | 6s → 8s | +2s | 33.33% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37390831478/job/112035588481) |
| Verify preserved functionality | 266s → 338s | +72s | 27.07% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37390831478) |
| Packaged Worker / interface / Run actions/download-artifact@v4 | 2s → 3s | +1s | 50% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37391401183/job/112037311517) |
| verify / Development / gameplay / Set up job | 1s → 2s | +1s | 100% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37391400899/job/112038371624) |
| verify / Development / gameplay / Run actions/setup-node@v4 | 2s → 4s | +2s | 100% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37391400899/job/112038371624) |
| verify / Development / gameplay | 88s → 115s | +27s | 30.68% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37391400899/job/112038371624) |
| Development / governance / Run actions/upload-artifact@v4 | 2s → 3s | +1s | 50% | success · [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37393097454/job/112042560491) |

Repeated unresolved examples: development encounters 8→27s (+19s, +237.5%, four increases), standby audit 20→76s (+56s, +280%, three increases), development account audit 57→156s (+99s, +173.68%, four increases). Import/account coverage expanded over this history; cold dependencies and runner variance also occur. These causes must not be conflated with an established app-performance regression. Total main verification did worsen in a logged run: 266→338s (+72s, +27.07%). Latest pre-audit verification completed in approximately 290 seconds from workflow creation to update; that includes overhead and is not a trend reset or directly substituted for the recorder's elapsed metric.

The full preserved history remains on the performance-history branch. Follow comparable PR/main results for remaining trends; review failures and workload differences before resetting a baseline.

### Local snapshot benchmark

Node 22.23.3/Linux x64, warm fake-indexeddb, 20 purses and 1,000 ledger rows, 100 reads after 10 warmups. This measures JavaScript/storage-adapter cost, **not production browser disk latency or end-to-end app speed**. Raw before/after records are in `2026-10-05-integration-measurements.json`; runner is `scripts/integration-benchmark.mjs`.

| Operation | Transactions per read, before → after | Total time for 100 reads, before → after | Time change |
| --- | ---: | ---: | ---: |
| campaign snapshot | 8 → 1 | 271.727ms → 278.561ms | +6.834ms / +2.52% |
| device backup | 9 → 1 | 289.617ms → 302.774ms | +13.156ms / +4.54% |

No timing speedup is claimed. Neither observed increase reaches 15%; the important verified gains are snapshot consistency and 87.5%/88.9% fewer transactions. Initial local benchmark references are recorded without resetting unrelated history.

### Local verification checkpoint

Node 22.23.3 and locked project dependencies. Standard browser download returned invalid ZIP data; the available scratch Chromium 133 passed dev:doctor and was used for focused browser work. Its older PDF engine is not presented as full current-browser validation; CI retains the normal browser.

- All eight account scenarios passed: layout, library/backup, two-device DM resume, recovery, portrait resume, campaign choice, invitations, and account-owned session/guest behavior (approximately 2 minutes).
- Protected backup export/password rotation/restore passed.
- Finance desktop/mobile creation, preview, consent, settlement, reload, repayment and campaign isolation passed.
- Party-sheet creation, HP readouts, two-way funds/inventory, backup identity, legacy migration, shared permissions and guest dice passed.
- Existing data-integrity browser assertions passed (legacy advanced-field preservation and HP saves with long inventory names).
- First governance run passed loot/portrait sync, locked gameplay, change reports, individual grants and leave/report preservation, then timed out at the owner Test reset button; screenshot showed a title screen after navigation. This failed run is retained, not counted as a pass. Focused diagnosis/rerun and full CI are required.

### Final local checkpoint — October 6, 2026

- `npm run verify:quick` on committed application code passed: **497 tests passed, 4 skipped**, clean TypeScript, zero lint errors and 35 existing warnings. `NODE_NO_WARNINGS=1` suppressed the injected runtime proxy warning that otherwise contaminates an existing stderr-JSON test; application assertions were unchanged.
- Cloudflare web and mobile asset builds succeeded. No Android package/signing operation was performed.
- Final focused regression run passed all 13 snapshot, pricing and encounter tests.
- A second governance attempt failed at the settings trigger after the player left; its server log included a styles HMR update while a build ran in the same checkout. This is an observed confounder, not a proven root cause.
- Governance then passed unchanged at `efb1909` in a detached checkout with no concurrent source edits/builds: desktop/mobile edit toggle, reports, locked construction, HP/equip/consume, archive preservation, leave, owner Test/reset and campaign isolation. No production code or test assertion was changed to obtain this pass. Both earlier failures remain part of the record.
- The same isolated checkout passed sound settings (real WAV decoding, desktop/mobile, persistence, mute), release recovery (conflicting invitations, interrupted guest purchase kept in memory, retry and responsive routes), Library navigation (query/hash destinations, desktop/mobile, no document reload or repeated opening), and public game analytics (public response, private denial, responsive display and failure state).
- Full current-browser PR/main and immutable packaged-worker checks are **not complete**. Publication remains blocked by automatic approval review pending explicit user permission; local checks do not authorize skipping release gates.

### Resume without repeating external actions

The attempted `git push -u origin audit/integration-consistency` was rejected by automatic approval review: pushing to an unverified remote may export sensitive repository contents, and the implementation request was not accepted as explicit authorization for that destination. Do not retry via another tool or API. Ask the user to authorize publication to `UnregisteredMusket/Lootsplit`; after permission, reconcile remote main/branch/runs, push, open the PR and execute required full checks. Merge/deploy only within confirmed authorization and existing release gates, then verify the exact deployed artifact. No new APK or signing-key change is part of this checkpoint.

### Publication authorization update — October 6, 2026 UTC

The user explicitly approved publication to `UnregisteredMusket/Lootsplit`, full release checks, and gated merge/deployment. The earlier automatic approval rejection is historical, resolved by this permission. Local verification remains as recorded; remote release results must be observed before claiming deployment.
