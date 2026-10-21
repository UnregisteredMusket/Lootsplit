# Illustrated ledger preservation baseline

Baseline: remote main e6776f55ad557fe5e5fdd6927bdfc8d0df0aa003 (1.2.3). Local checkpoint: checkpoint/pre-redesign-1.2.3. Work branch: feature/illustrated-ledger.

## Four preparations
1. Inventory existing routes, persistence, permissions and deployment (below).
2. Record baseline tests and preserve a recoverable Git checkpoint.
3. Define additive, backward-compatible state and backup round-trip rules.
4. Prepare responsive component/artwork specifications and regression checks before production.

## Feature destinations
| Existing capability | Existing location | Redesign destination |
|---|---|---|
| DM overview, coin/holding totals, recent transactions | Home | Home; full activity and named sessions |
| Assigned character, purse, sheet and handouts | Home sheet | Player Home → Character & inventory |
| Accounts, NPCs, shared funds, denominations, conversion, valuations, quantities, transfers, payments | Party | Party, existing account controls retained |
| Shops, stock, generation, buy/sell rates, wealth, discounts, purchases/sales, receipts | Market / shop | Market / shop; state/filter/restock additions |
| Listings and loan requests/decisions | Market | Market retained; unified review entry on Home |
| Realm modifiers, previews, repricing, default shops | Settings | More → Settings; Market shortcut |
| Catalog, custom items, Open5e with attribution | Catalog | More → Catalog |
| Offline names and lexicon | Catalog | More → Catalog → Names |
| Private PDF library, reader, search, favorites, extraction/review/editable prices/conflicts | Books / Catalog / Market | More → Books / Catalog; existing routes retained |
| Local/turn/live, rooms, invitations, seats, permissions, turns | Multiplayer | Multiplayer → Room |
| Party/private messages, unread and delivery states | Multiplayer | Multiplayer → Chat |
| Notifications, connection recovery, pending changes, manual sharing and reports | Multiplayer | Multiplayer; no fabricated online presence |
| Campaigns, device backups, export/import, passwords, diagnostics, appearance | Home tools / Settings | More → Settings; Home campaign tools retained |

## Compatibility
Existing IndexedDB stores and Cloudflare D1 room serialization remain in place. New fields are optional; missing collections mean no recorded history, missing shop state means open. Existing classifications are retained. New records must be included in snapshots, restore, room reads and optimistic patches. No synthetic historical sessions or prices. Private PDFs remain device-only. Server command checks remain authoritative.

## Baseline results
TypeScript passed. Full npm test: template-script suite 188 passed, 4 failed, 4 skipped; failures all concern missing template .app-env auth defaults (build env resolution, template auth off, wrapped command, symlink command). App suite must be run separately because npm test stops after script failures. No redesign changes existed when these results were recorded.

## Release gate
Old/new save round trips; financial and permission regression tests; session/internal transfer accounting; closed-shop enforcement; review idempotency; disposable campaign deletion; production build; isolated client trade/chat/sync/turn/recovery; mobile and desktop screenshots. Document actual results and limitations rather than claiming unchecked gates.

## Implementation review — web 1.3.0 deployed
- Shared midnight/gold components, optimized illustrative assets (149 KB total), role-specific Home/character views and existing five-destination navigation.
- Room/Chat/Notifications tabs, invitation share/copy fallback and explicit membership wording.
- Optional portraits, imagery and inventory classifications; existing catalog classifications remain usable as filters.
- Closed-shop checks in both local transactions and authoritative server commands. Restock adds to finite quantities without replacing custom entries or touching unlimited stock.
- Session boundaries record ledger IDs so same-millisecond transactions belong to the correct session. Coin transfers are excluded from received/spent; net balance movement is explicitly distinguished from new wealth.
- Explicit payment requests debit once on DM approval. Existing purchases remain immediate. Server projections hide another player's payment requests.
- Journal persists through D1 room JSON, queued commands/patches, IndexedDB and full backups. No database schema migration required.
- Current/last campaign deletion keeps the registry until storage deletion finishes and records a recoverable deletion intent. Fresh campaigns are blank. Backups remain visible to the DM even after their campaign is deleted. Active room connection still blocks deletion.
- An automatic pre-update device copy is made once for unprotected local DM campaigns; password-protected saves retain their restrictions and require the existing password/export flow.

### Validation recorded
- Original app baseline: 87/87 passed.
- Latest app suite: 98/98 passed, including new old-save, backup round-trip, portrait permissions, closed shop, restock, request authorization/idempotency/privacy, session boundary/internal transfer, and disposable current/last campaign deletion tests.
- Full test command: script suite 192 passed / 4 skipped; app suite and 55 auth/app-data tests passed. The four initial script failures were fixed by restoring the expected explicit auth-off development configuration; production already uses the same auth-off build flag.
- TypeScript passed. Production Cloudflare build passed. Wrangler dry run bundled successfully with DB and ASSETS bindings.
- Existing room tests exercise independent seats, concurrent buying, private chat, turn restrictions, duplicate/retry handling and persisted room reads. These are automated service tests, not a claim of two-browser visual verification.

### Browser validation and release status
Cloudflare connector access resolved the preview blocker: `wrangler preview` needed a separate D1 binding. A dedicated `lootsplit-preview` database now isolates test rooms from production. Branch preview build 55dddf45-b341-456c-af8d-95a676b90f91 succeeded.

Two browser clients on the branch alias and unique deployment origin joined disposable room EDQMY. Verified player-only Home/purse/inventory, a purchase (2 sp debit, stock 6→5, item synchronized to host), party chat/unread state, turn handoff, disabled buying while waiting, a sale during the player's turn, pending-action persistence across reload, successful submission and return to DM turn. Player-to-DM role switching was blocked while joined. Player settings exposed backups/diagnostics without economy controls or private Books. App console inspection showed no app errors (browser extension metadata errors excluded).

Browser review found and fixed a Sell button that was not disabled out of turn; authoritative turn checks remain unchanged. Also corrected the DM review-count card to open the unified inbox. Desktop player screenshot captured. Light-mode review led to contrast-adjusted accent text and primary buttons without changing the saved accent preference; a contrast regression test passes.

Responsive browser checks used a temporary 390×844 iframe fixture (375 CSS pixels of content with desktop scrollbars), not Android device emulation. DM and player Home, multiplayer joining, room controls and five-tab navigation rendered. Fixed the missing Market mobile tab and activity-grid overflow; final measured content width equals scroll width (375px). Named session started with zero totals, synchronized to player; player submitted a 10cp payment request, DM approved, both clients displayed the one-time 1sp debit and correct session net. Leave/release/rejoin worked. Private messages reached the selected DM conversation without appearing in party chat; unread cleared when read. Test fixtures are removed from release output.

Final suite: 192 script tests, 99 app tests and 55 auth/app-data tests passed (346 total, four script tests skipped), TypeScript passed; Cloudflare preview production build passed. PDF parsing, Open5e, names, backup compatibility and campaign deletion are covered by automated regression tests; their complete end-to-end UI flows were not all repeated in this browser pass. Native Android behavior and real offline-network interruption remain unverified here. Production commit d7dd0309751432ce4442541712e26863f54a7c29 deployed successfully in Cloudflare build 69443bae-396c-47d4-8348-e5558d325cff. The live Home page rendered successfully. A final player check confirmed both Buy and Sell disabled while waiting for the DM. Android preparation is isolated on android/update-1.3.0; the first Actions attempt stopped at a removed SDK tools package, corrected by specifying the required platform/build packages.

### Deployment and rollback
Checkpoint branch `checkpoint/pre-redesign-1.2.3` points to e6776f55ad557fe5e5fdd6927bdfc8d0df0aa003. Web release d7dd030 is on `main` and `feature/illustrated-ledger`. Deploy server and matching assets together through the existing Cloudflare build; preserve D1. Roll back code through a revert/redeployment without deleting or restoring D1. Keep new client backups; older binaries do not understand the new journal fields.

## Mobile control panel redesign — October 2, 2026

Preservation baseline: `1af467ad2ab0c5eb0c2e403ea7e38f607ecfb706` on main, with remote checkpoint `checkpoint/pre-mobile-control-panel`. Work branch: `redesign/mobile-control-panel`.

The approved concept uses dark ink, ivory and brass, serif headings, readable sans-serif controls, portraits, compact cards and five role-specific tabs. The DM Desk allocates its upper region to readouts and lower region to six configurable destinations. Settings & Management is a header gear that opens role-specific accordion categories. All legacy financial, sharing, account, backup, PDF and import/export workflows keep their existing routes and permission checks.

### Data and compatibility
No database migration or economic behavior change. Shortcut preferences use a versioned, sanitized, campaign-specific localStorage key; they are described as device settings and are not part of campaign backups. Readouts use authorized account endpoints or existing imported sheets; missing health data is not fabricated. Custom colors/light mode remain respected. Private PDF books retain DM-only access; shared handouts are separately visible to players. Library creature/spell tiles open the corresponding public SRD reference section with attribution.

### Verification
The new control-panel browser audit covers role tabs, six-button mobile fit, customization/reordering/reload persistence, settings categories, keyboard focus return, light/dark appearance and 320/390/768/1440 layouts. Existing character and multiplayer recovery audits now use the updated navigation. Encounter browser checks use a deterministic creature index by default; set `ENCOUNTER_LIVE_INDEX=1` to also exercise external Open5e availability. All award/retry/permission checks still reach the real local server. The production encounter server is unchanged.

A fresh Android package is a separate signed release; this change updates the shared web/mobile source and verifies the mobile bundle without changing the published APK metadata.

Final local release checks: 377 tests passed and four existing template tests skipped; TypeScript, Cloudflare build and mobile bundle passed. Character play/edit/reload, account backup/recovery, multiplayer queue recovery, encounter review/award retry and the control-panel browser audits passed. Dark/light and mobile/desktop screenshots were inspected; light theme switching adjusts the page color for readable contrast.

### Desktop workspace follow-up
The desktop app uses the full content width beside the existing navigation rail. Layout overrides start at 1024 CSS pixels; mobile rules are unchanged. DM readouts/shortcuts share the top row and activity, review queue, and session/economy panels use the space below. Character Play has a companion column for dice/history, encounters keep their saved list visible by default, and card grids add columns as space permits. Campaign support tools occupy a separate desktop column without changing selected-tab behavior.

Validation uses `scripts/desktop-browser-audit.mjs`: save mobile baselines with `--baseline` on the previous release, then run `--compare` against the same disposable persistent profile. It checks all five destinations and settings for both roles at 390px, plus DM Desk/Player sheet at 320/768/1023px. Desktop checks cover both roles and all five destinations at 1024/1440/1920/2560px, full-width content, side-by-side player tools, overflow and runtime errors. Account-linked sheet/encounter fixtures are explicitly layout-only; separate real-server audits retain authorization and write coverage. CI runs the desktop checks on every pull request.

The mobile comparison requires equal image dimensions and identical pixels, allowing only up to 16 pixels with a single color-value difference to account for Chromium rounded-edge rasterization. Larger differences fail.

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Feature-screen maintenance

Feature navigation is presentation over the existing economy/session services. Keep the five existing mobile primary tabs and add the user-authorized sixth Maps tab; expose feature entry cards and a Return-to-origin footer. Use router links and verify no title-screen replay. Player Home must retain full-sheet access through six fixed shortcut-style feature buttons for signed-in players and guests. Do not add player shortcut customization or a duplicate feature-card list; DM saved shortcut customization remains available through Dashboard → Saved shortcut settings; the main DM Desk uses six swipeable information panels and grouped tools, as authorized on October 6. Keep the Multiplayer settings button visible beside connection status; the DM overview has no duplicate room/chat/status or Campaign tools multiplayer entry. Desktop may expose direct feature links. DM home and legacy overview URLs must render the same Campaign control screen, with only one shortcut/feature list. Preserve expandable treasury/activity, session controls, campaign tools and backups. The current-session readout opens #sessions; Pending reviews opens Review Inbox with payment/loan decisions and character-import reviews; Review Inbox presents approval decisions without a DM submission form; Bank retains the player spending form and clearly named DM manual payment queue.

Account shortcut API/storage requires additive migration0010. Preserve user/role isolation, revision conflicts and readonly DM offline fallback; never store guest campaign data in preference caches. Repayment and property-description commands require server ownership checks, and property edits must preserve financial fields under concurrent changes. Finance projections expose only assigned loans/rules, never another character’s debt or downtime quotes.

Related checks: accounts/finance/room-store regressions; finance, control-panel, library-navigation, character and campaign-governance browser audits. Governance exercises real player repayment/property edits and fixed player buttons; control-panel coverage retains DM account shortcut persistence. Preserve complete release gates, migration review and separate Android signing/publication requirements. Foreclosure or special acquisition rules require a separate gameplay decision.

### Searchable record selectors and Library links

Use `SearchSelect` for dropdowns containing imported/campaign data, retaining original values and command handlers via `onValueChange`. Children must be option elements, arrays, fragments or optgroups; call the pure `LocationOptions({ market })` helper when building its location choices. Keep disabled options, native form validity, touch/keyboard selection and access-filtered choices. Plain settings enums may retain native Select. Browser audits use `chooseOption` to exercise the actual search menu and await hydrated choices; selected values are exposed on the trigger as `data-value`. Preserve all original assertions and bounds. Popovers are modal while open, belong to their containing dialog, and cap their height to the visual viewport; keep list-local keyboard scrolling and focus restoration. The property audit dispatches real CDP touch events inside a modal and checks that the parent/page remain stationary, plus short-viewport search. Headless viewport emulation does not establish physical Android keyboard coverage.

The listing editor can open the existing TemplateWorkshop in a sibling view within the same dialog. Preserve its listing draft, explicit discard guard, busy lock, and accepted-pending versus committed feedback. Create from preset values use a UI-only colon prefix; never store them as estateTemplateKey. Save the actual schema-validated template via the existing estate-template command before selecting its key. Saving it does not publish or buy a listing.

Library entries index canonical permission-projected records; never introduce an unsynchronized copy or expose DM-only source packs/catalogs to players. Use `libraryRecordHref` identities (including source pack/revision), AppLink and validated router search. NPC interaction and saved-map links must select their record. Run Library identity/privacy tests plus the relevant resource/world/market/property/encounter audits and complete release gates.

### Application control audits and DM market readout

Run `node scripts/control-inventory.mjs` for a complete JSX declaration inventory (including conditional/generated links, buttons and forms) and the internal-navigation/feature-navigation tests for route and return validation. `scripts/navigation-browser-audit.mjs` clicks actual DM/player primary, grouped-feature and management links at desktop/mobile widths, asserts addressed panes/records and absence of title replay, and checks canonical market quotes/city versus wilderness access. Run it with Node22 `--experimental-strip-types` against disposable development and immutable Worker servers; both are required gates. Existing financial, account, ownership, private Library, map, encounter, ship, mode, website and staff audits exercise mutations and data-dependent controls. Do not claim every possible data/permission permutation from one inventory or click pass.

AppLink resolves hash-only URLs against the current route and supplies a missing feature `from` from the actual current screen. Explicit origins remain intact; safeReturn permits known app pages, removes recursive origins and rejects external/API/download/unknown targets. Deep-link identity assertions retain path/hash/record checks alongside origin parameters. The DM’s sixth information panel reuses canonical trade offers and approved history, labels missing comparisons, and distinguishes global read-only DM data from party trading access. No wallet, refresh scheduler or trading override is added. Preserve role projections, city ancestry rules, account permissions, legacy URLs, saves and every prior release gate.

Feature footer AppLinks must set `returnLink`: returning to another feature must not add a new forward-navigation origin back to the feature being left. Keep the nested forward/return unit regression and governance Property → My Finances → Home browser checks. Native reference selectors are asserted by their accessible combobox role and exact value.

### Report foundation and upcoming UI redesign

See `docs/plans/REPORT-FOLLOWUP.md` and `docs/audit/2026-10-12-report-followup.md`. Conditional polling is allowed only after a complete snapshot commits in the running document. Authenticate each read, query fresh encounter-active policy, and never acknowledge or replace pending work from an unchanged envelope. Manual refresh and legacy clients use full reads. Command batches own one working clone but retain every command validation, exact receipt deduplication and atomic CAS. Privacy-safe sampled/slow-read timings contain operation/phase/duration/outcome only.

CPU/log policy is part of the immutable website artifact and checked after upload; preserve query redaction and recovery fencing. Failure-email readiness checks reveal only missing setting names and never claim delivery. Optional R2, Durable Objects, Queues or replicas are not activated by this work. Keep all nine release jobs and account deadlines unchanged; complete audits may move between groups. Generate current source inventory into verification artifacts, treating the old checked-in CSV as a historical snapshot. The UI redesign follows verified functionality and must preserve the complete feature/permission tree.
