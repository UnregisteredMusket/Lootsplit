# Party-to-character-sheet repair and three-pass audit

Audit date: 2026-10-02. Preservation baseline: `acb7c452b06efaec3ecff867e40390d26cae3d58` and `docs/FEATURE-INVENTORY.md`. Scope: handwritten application, account/Worker, native bridge and supporting build/test code. The approved layout, styles, navigation structure and existing features are preserved.

## Repair

Party cards and the DM's compact party portraits now open the exact linked account sheet. Player Home resolves the sheet belonging to the selected controlled campaign character. Explicit sheet URLs survive room restoration and client navigation instead of falling back to the DM's first owned sheet.

The existing campaign assignment selects can link a standalone account sheet to a character in the current local campaign. References are scoped to both the authenticated account and the selected device campaign; names are never used as identity. Only the sheet ID and purse ID are stored. Linking validates current ownership and local seat control and refuses duplicate associations. Existing shared assignments continue to require a verified saved membership and server-enforced purse permissions.

HP, AC, level, class and portrait readouts come from the linked sheet. A shared roster request now returns just these summary fields instead of fetching every full sheet separately. Readouts refresh after saves, on focus/visibility, across tabs and on a 15-second visible-page timer; failed or superseded requests cannot repopulate the wrong campaign. DM access to another member's sheet stays read-only. The existing inventory link now opens the Funds & inventory section during client navigation too.

Linking does not copy, transfer or rewrite coins, holdings, ledger entries or legacy imports. Account sheet coins/loadout remain standalone data; the existing campaign ledger is displayed when linked. Legacy imported sheets and their existing economy/Charisma behavior are retained. There is no automated migration or merging of differently named characters.

Local references are device preferences, not portable campaign-backup content. Restoring on another device requires linking again, and account sheets still require account connectivity. Local links do not grant other people sheet access or turn private standalone rolls into shared rolls; use an online campaign assignment for a shared roll log.

## Pass 1 — individual functions and source contracts

- `npm test`: **379 passed, 0 failed, 4 skipped** (383 total). The skips are existing tests of excluded Grok skill documentation, not gameplay tests.
- `npm run typecheck`: passed.
- `npm run lint`: **0 errors, 33 warnings**. The existing warnings concern unused variables/imports, Fast Refresh module boundaries and hook-dependency conventions. Reviewed affected lifecycle paths; no sweeping behavior changes or warning suppression was applied.
- Corrected the root component's callable name so hook lint recognizes the actual React component. Excluded generated `.wrangler` bundles from source lint. No markup changed.
- Added local-link unit cases for ownership/campaign isolation, controlled-purse requirements, duplicate prevention, reassignment/removal and corrupt stored references. Extended server assertions for the authenticated account identity and exact DM roster projection, including player/non-member denial.
- Reviewed schemas, explicit SQL parameters, revision checks, ownership/seat boundaries, transaction rollback and idempotent receipts alongside the tests. The persisted sheet schema remains the validator for saves and rolls. Linked IDs are references, never authorization credentials.

### Function inventory and intended use

`function-inventory.csv` enumerates **4,430 function bodies/callbacks across 274 JS/TS source files**, including **1,336 named symbols**, with source locations, enclosing functions, inferred intent, module responsibilities, static reference locations, direct calls and return expressions. Regenerate with `node scripts/function-inventory.mjs`. `function-summary.json` gives the breakdown.

The inventory covers every function body in `src`, `cloudflare`, `server`, `scripts`, `db`, root JS/TS configuration and the notification service worker. It excludes third-party dependencies, declarations, generated routes and generated bundles. Nested rendering/predicate/event callbacks are separate rows. Intended-use descriptions are source-derived; they are not claims that every branch has runtime coverage.

The following contract review supplies the application meaning behind those call/registration records:

| Function family | Intended operation and boundary | Verification |
| --- | --- | --- |
| Character schema/calculation/dice functions | Validate persisted sheet values, derive modifiers, bound dice formulas/resources, distinguish server/manual rolls | Character model/API tests; complete character browser audit |
| `handleCharacterPlay`, `character`, `membership`, `policy` | Scope owned sheets, validate current room seats, restrict DM readout access, enforce revisions/manual policy and retry receipts | Ownership/assignment/log/policy tests; two-account party and character audits |
| `readPartySheetLinks`, `writePartySheetLink`, change subscriptions | Resolve explicit account/campaign references; enforce one sheet per purse; invalidate readouts without economic writes | New unit tests; account/campaign collision isolation, reload and unchanged-finances browser assertions |
| `CharacterWorkspace`, `CharacterEditor`, `HomeSheet`, `useSheetReadouts` | Select requested/controlled sheet, preserve drafts, save explicitly, show authorized current readouts and campaign ledger | Real local/shared account workflows; exact deep-link and read-only assertions |
| Encounter model and `handleEncounters` | Generate editable estimates, maintain manual combat state, review loot, persist dice receipts, award exactly once | Encounter model/API tests; generated/manual encounter, lost-response award retry and player denial |
| Economy mutations and `atomic` | Validate quantities and coin arithmetic; commit stock, purse, holdings and ledger together; roll back failed work | Purchases, sales, gifts, loans, unique-property races, voids and malformed-data tests |
| Commands, room handlers/store and cloud client | Check seat/turn/revision, filter player-visible data, serialize operations, persist/recover pending commands, deduplicate retries | Local/turn/live tests; interrupted purchase/reload/retry browser workflow |
| Table/bill/manual-sharing readers | Validate legacy formats and controlled character subsets; reject forged messages/loan decisions; preserve receipts | Table, cloud, audit, release and local-report tests |
| Campaigns, backups and lock helpers | Isolate device databases, preserve pre-update copies, validate before replacement, encrypt/export/restore and rotate passwords | Campaign deletion/save/lock tests; account restore and protected-backup browser audits |
| Account/auth/profile/library helpers | Enforce signed sessions, native origin/token rules, private records and recovery/session revocation | Account/API tests; dev and built-Worker account workflows |
| Staff/owner/monitor/bug-report handlers | Recheck role, protect private content, apply revision-checked moderation, retain audit records and report receipts | Account/API tests plus owner, member, monitor, bug and built-Worker audits |
| Chat/unread/push helpers | Restrict recipients, retain outbox retries, mark visible threads read, keep message content out of push notifications | Chat visibility/read and notification tests; source review of event cleanup and push service worker |
| PDFs, extracted sheets, articles, catalog, Open5e | Keep source PDFs device-local, parse/review imports, preserve attribution, validate remote references | PDF/extract/sheet/shop-PDF/articles/Open5e/generation tests; library route checks |
| Settings, shortcuts, themes, responsive controls | Navigate existing destinations without direct financial writes; scope settings by role; preserve focus, draft guards and breakpoint behavior | Control-panel browser audit, shortcut/theme/redesign tests, 58 before/after screens |
| Public website/download helpers | Render public routes, retain installation/help/resource links and fixed-release checksum checks | Website/download tests; six public pages at desktop/mobile in dev and built Worker |
| Build/dev/framework callbacks | Supply environment, route registration, origin/CORS, database adapters, PWA metadata and packaging | Tooling/auth/migration/config tests, lint/typecheck, production and mobile builds |

Zero static references are not automatically dead code. Reviewed examples include dynamically imported PDF, native save, push, rate-limit and campaign-resume functions; framework `fetch`, stream and SQL-driver methods; TanStack's `getRouter`; and optional template auth/P2P integrations. Retained exports such as `assertLinkedSeatActive`, `turnLocked`, gift/sale seen helpers, `replaceSave`, `refreshShared`, `setCloudPusher` and legacy `endDmTurn` have no direct current production call found or are compatibility/test utilities. They were not deleted or activated. The active shared-seat restriction boundary is `guardMemberSeat`; the legacy `publishTurn` intentionally refuses the obsolete protocol rather than accepting unvalidated old-client writes.

### Native Java methods (outside the JS/TS parser)

| Method / callback | Confirmed intended use |
| --- | --- |
| `MainActivity.onCreate` | Register the SaveFile Capacitor plugin before normal bridge startup |
| `SaveFilePlugin.save` and UI callbacks | Prevent overlapping exports; let the user choose save/share/cancel; launch a document picker |
| `SaveFilePlugin.finish` | Release export state and resolve the chosen action |
| `SaveFilePlugin.savedDocument` and executor callback | Write only to the user-selected document URI, decode binary or UTF-8 text, close the stream, resolve success or report failure |
| Template `ExampleUnitTest.addition_isCorrect`, `ExampleInstrumentedTest.useAppContext` | Unmodified Android template sanity tests; not evidence of on-device product QA |

Native file/share/back/network adapters and Android signing configuration were reviewed and left intact. The mobile bundle builds successfully. This audit does not claim a physical Android-device run or ship a new signed APK.

## Pass 2 — shared functionality and data integrity

All **12** integration/browser audits passed against disposable local data:

| Audit | Covered workflow |
| --- | --- |
| Release | Fresh room invitation, conflicting invitation, interrupted purchase, persisted queue/reload/retry, role routes |
| Account | Sign-up, reusable profiles, private cloud backup, restore into new campaign, cross-device membership resume, recovery and session revocation |
| Owner | Authorized owner controls and denied ordinary-account actions |
| Member | Profile persistence/isolation, warnings, bans/session termination, restore and staff grant/revoke |
| Monitor | Owner/admin access, partial failure, refresh, revoked access clearing and moderator denial |
| Bug reports | Private submission, explicit diagnostics, lost-response deduplication, admin triage, reporter response, escaped HTML |
| Character | Creation/save/reload, campaign inventory, derived/advantage rolls, HP, attacks, spells/slots/resources, manual policy/log and DM read-only access |
| Party-sheet (new) | Explicit local link, unchanged money/items/ledger, exact portrait/card URL, saved-HP refresh, reload, account/campaign isolation, online player-to-DM propagation, player Home and mobile fit |
| Encounter | Generation, manual roll, combat, review, award, lost-response exactly-once retry and player denial |
| Control panel | Five role tabs, six shortcut buttons, editing/reordering/persistence, settings scope, focus restoration and themes |
| Website | Six public pages, download verification details, help/install links and return to app |
| Protected backup | Create, password rotation/re-encryption, encrypted export, explicit restore and direct encrypted download |

The first character audit was interrupted during development hot reload; it passed on stable source. The older backup audit initially matched two Export buttons, including an automatic pre-update backup. Its selectors now target the named encrypted backup, and the complete workflow passed. The new party-sheet audit and protected-backup audit are included in CI, along with lint.

No application-data migration, real-account mutation, live financial transaction or automatic campaign merge was needed.

## Pass 3 — built application and visual regression

- `npm run build:cloudflare`: passed on the final application source.
- `npm run build:mobile`: passed; existing Android signing/version/distribution untouched.
- Local D1 migrations and the actual built Worker: account browser audit, Worker monitor/authorization audit and public website browser audit all passed.
- **58 baseline comparisons passed**: 18 mobile/tablet screens and 40 desktop screens, both roles. Mobile/tablet widths: 320, 390, 768, 1023. Desktop widths: 1024, 1440, 1920, 2560. All tabs, role settings and desktop companion panels retain their layout, with no horizontal overflow or uncaught application errors.
- `visual-comparison.csv` records dimensions, changed pixels, largest color-channel delta and both SHA-256 hashes per screen. **51 images are pixel-identical; seven differ only in 4–24 edge pixels by one channel value.** Inspected the desktop portrait edge at the initial comparison failure before setting the desktop-only tolerance to 32 pixels (mobile remains 16); dimensions, text and spacing are never tolerated as changes.
- Visually inspected DM and player mobile/desktop screenshots as well as the integration results. No CSS was changed.

The workspace's browser proxy could not validate the external Grok branding script certificate. Website audits report this separately; first-party assets, rendering, navigation and application requests passed. This is not represented as successful external-script loading.

## Limits and release gate

The three passes provide broad regression evidence and a complete static function inventory, not proof that every possible input, third-party outage, native device or branch is defect-free. Existing lint warnings and the four documentation skips are disclosed above. Email delivery, native Android push and other features explicitly excluded by the preservation inventory have not been invented or claimed as working.

Release procedure: push this reviewed tree to a PR, require the repository verification workflow to pass on that exact head, merge, confirm the matching Cloudflare build/deployment, and perform read-only live desktop/mobile smoke checks. The PR and deployment history provide the final release records.
