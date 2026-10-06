# Preservation inventory

No feature below may be removed, disabled, hidden or reduced without explicit user approval. Locations are entry points, not permission grants. Server authorization remains authoritative.

| Capability                                                                                          | Entry point                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Campaign create/rename/switch/export/delete, current/last handling and recovery                     | Campaign controls                  |
| Default Greyhaven party and deliberately blank campaigns                                            | Initialization / campaign controls |
| Separate DM and assigned-player dashboards                                                          | Home                               |
| Player/NPC accounts and multiple party funds                                                        | Party                              |
| Five denominations, conversion, payments, transfers and dollar estimates                            | Party / Settings                   |
| Item/property ownership, quantities, valuation, notes, search and categories                        | Party / inventory                  |
| Portrait upload/reset, item/shop/property imagery and fallbacks                                     | Party / Market                     |
| Supported character-sheet import/edit/review and Charisma                                           | Character sheet                    |
| Handouts and player references                                                                      | Character / Sharing                |
| Shops, keeper/location/category/wealth, open/closed states, filters                                 | Market                             |
| Stock editing/generation, finite/unlimited quantities, restock, custom prices                       | Shop                               |
| Purchases, sales, gifts, property listings and receipts                                             | Market / Party                     |
| Buy/sell rates, discounts, economic modifiers, previews and repricing                               | Market / Settings                  |
| Loans, explicit payment requests and DM review                                                      | Market / review inbox              |
| Ledger, voiding, full/recent activity, price and management history                                 | Activity                           |
| Named sessions and transfer-aware summaries                                                         | Campaign journal                   |
| Starter/custom catalog, services, rarity/categories and generated goods                             | Catalog                            |
| Open5e supported references/imports and attribution                                                 | Catalog                            |
| Offline fantasy names and saved lexicon                                                             | Catalog                            |
| Private PDFs, reader/articles/search/favorites/page references                                      | Books                              |
| PDF text/form extraction, review, prices, conflicts and catalog/shop imports                        | Books / import tools               |
| Local/Turn-based/Live, hosting/joining, character assignment, shared-fund permissions, turns        | Multiplayer                        |
| Room codes, invitations, share and copy fallback                                                    | Multiplayer                        |
| Party/private chat, recipient restrictions, unread and pending/delivery states                      | Multiplayer Chat                   |
| In-app/browser notices and browser background message subscriptions                                 | Notifications                      |
| Persistent connection, pending commands, retries/conflicts and recovery export/import               | Multiplayer                        |
| Manual player links/files, reports and permitted change imports                                     | Manual sharing                     |
| Pre-join copies, named backups, export/import/restore, validation and conditional pre-update backup | Device backups                     |
| Password/protected-save behavior and diagnostics                                                    | Settings                           |
| Light/dark/custom appearance, reading scale, display settings and reduced motion                    | Settings                           |
| Android bundled client, native share/file save, network/back behavior and permanent signing         | Android                            |

Not implemented or promised by this inventory: OCR, Google Drive backup integration, native Android push, online presence, or editors for every kind of image.

## Website and optional account library

- Development/release recovery: bounded per-stage verification, durable GitHub job/artifact checkpoints, an explicit resume prompt/status command, and independent failure reports with optional configured email delivery. See `docs/RECOVERY.md`. No gameplay, saved data, account permissions or platform support is altered.

- Parallel release verification keeps every preservation check in isolated jobs, retains immutable artifacts and a mandatory aggregate gate, and supports diagnosed failed-job reruns. Pull requests avoid duplicate feature-push verification; Android test installer builds use relevant paths. Node 22 development setup and quick local checks are documented in `docs/DEVELOPMENT.md`.

- Optional locked Render standby, verified portable releases, encrypted offsite D1 snapshots, and manual fenced recovery to a new Turso/libSQL database. See `docs/STANDBY.md`; snapshots exclude device-only campaigns/PDFs. Existing primary, Android and offline behavior is preserved.

- Public welcome, Android download, desktop installation guidance, changelog and help pages alongside the existing app URL.
- App startup has a click/tap/keyboard-to-continue title screen, shown once per app document load. After dismissal, internal navigation and same-document browser back/forward retain entry; refreshing or reopening the app shows the opening again, even in a restored tab. The title fades in once; a 15-second loop shows a 16-bit-style adventurer struggling and dragging a heavy sack, spilling coins from its bottom, with a rogue following to collect them. Reduced-motion preferences show a static title screen. Artwork is bundled locally for web and Android.
- Versioned website changelogs retain previous entries and describe added features, improvements and summarized fixes for every Android update. The signed-release gate requires matching notes before publication.
- Fixed-version Android download endpoint verifies the release checksum; original GitHub and Drive alternatives remain available.
- Optional email/password accounts with server-side sessions, rate limiting, sign-out, and single-use rotating recovery keys. Email delivery is not configured.
- Account-owned campaign memberships, resume with fresh room/seat validation, archive/unarchive and forget. Existing guest room workflows remain available.
- Linked DMs can explicitly reopen their ended shared sessions from My account on any signed-in device. Server-verified DM ownership and a current revision are required; campaign state and authorized reports survive, pending turns are protected, and former player sessions stay disconnected until players rejoin.
- Explicit private cloud backup versions, download, delete and restore into a new local campaign. PDFs/reference content remain device-local; encrypted device backups remain the route for protected saves.
- Reusable character names, portraits and notes; adding a profile to a local DM campaign creates an empty purse and does not transfer wealth or inventory.
- Portrait upload notices distinguish device-only saves, queued turns, confirmed shared saves and failed uploads. Saving a shared membership refreshes the server state and retries pending Live commands using their existing IDs; failed uploads keep their recovery copy and prevent a misleading cross-device success message. Turn-based membership saves remain available and explicitly identify the uncommitted turn; they never submit it automatically.

## Website owner and credits

- Owner-only Test mode controls appear at the bottom of Settings & Management, with character count, starting gold and HP configurable directly in the menu. The separate test campaign, DM reset and analytics exclusion remain available.

- Homepage gold-spent counter uses recorded purchases and outgoing payments in current shared
  campaigns. Reusable campaign/player-wallet analytics preserve existing ledger, inventory,
  finance and backup behavior. Only spending is public; additional aggregate metrics are
  owner-only until explicitly selected for publication. Local-only saves remain local.

- Resources lists Open5e, imported SRD versions and licenses, and bundled font licenses; extend the resource registry for future integrations.
- Donate is public and optional. An owner can set or clear an external HTTPS donation URL; no payment credentials are stored by Lootsplit.
- My account exposes Owner controls only for a server-assigned owner role: aggregate site counts, homepage announcement publish/hide, and donation destination.
- Every privileged request rechecks the role. Updates are audited and revision-checked. Site ownership does not bypass campaign or private library permissions.

## Member accounts and moderation

- Owner-only grants/revocations for admin and moderator roles, protected owner and self accounts, fresh sign-in required for role changes.
- Searchable, paginated staff member directory with effective account status, member-since and approximate last-online dates, profile review and moderation history.
- Warnings, temporary/permanent bans, access revocation/restoration, session revocation, and profile-content moderation. Moderators can warn/clear profiles and suspend ordinary members for up to 30 days; admins manage ordinary members; the owner manages other staff.
- Restrictions terminate account sessions and block associated room-seat credentials. They do not erase local data or remove anonymous guest support.
- Member profiles include display name, raster profile image, introduction, optional messaging email and explicit moderator visibility choice. Email-update preferences default off and record consent; sending is not configured.
- Account page includes existing local campaign controls plus shared-membership rename and linked-DM deletion. Shared deletion checks current revision, refuses pending turns, retains a private snapshot of DM-visible saved data, and cleans up memberships and push subscriptions.

### Administrator server monitoring

- Owner/admin-only, server-authorized live monitoring panel in My account; members/moderators denied.
- Read-only database and website-asset health checks, check timing, running Worker version metadata.
- Aggregate account activity (5 min / 24 hr), stored shared campaigns, memberships, cloud backups,
  character profiles, web push devices, and 24-hour moderation action count without private content.
- Notification readiness distinguishes existing web push from unavailable email/native Android push.
- Optional 30-second visible-page polling, manual refresh, cancellation, partial-failure display,
  stale snapshot labels, no-store responses, and explicit on-demand monitoring limitations.

### Private bug reports

- Signed-in members submit text reports from My account, with optional previewed app/device diagnostics. Help and app navigation link to the form.
- Report history and responses are private to the reporter, owner and administrators; moderators cannot inspect other members' reports.
- Owner/admin inbox supports status filtering, pagination, priorities, reporter-visible responses and audited updates with conflict detection.
- Five reports per account per rolling 24 hours; retry receipts prevent duplicate submissions. No automatic campaign/file capture, uploads or email delivery.
- Existing guest play, account permissions, saved campaigns and Android signing remain unchanged. Existing installed APKs can use the website; native navigation changes ship with a future APK release.

### Account-linked interactive character play

- `/characters` provides full editable account sheets with species, classes/subclasses, background, level, abilities, proficiency/training, HP/temp HP, AC, initiative, speed, death saves, inspiration, attacks/damage, spells/preparation/slots, equipment, currency, resources, features, custom content and source credits.
- Player Home now opens the full sheet workspace. Campaign overview remains available explicitly; legacy imported sheets, portraits, handouts and financial actions remain beneath the account sheet.
- Save/reload uses revisions to prevent overwriting another device. Export preserves a draft. JSON/PDF imports create new characters; existing reusable profiles can create full sheets. PDFs remain local and only explicitly imported extracted fields are uploaded.
- Every campaign character has a full sheet under the same character ID as its wallet and inventory. Party cards and the Desk read that sheet directly; Player Home opens its controlled character. Both normal creation paths create a playable campaign character. Stats and identity travel with campaign backups and sharing, including guest/local mode. Existing explicit account links migrate without matching by name or importing private wealth. Standalone account profiles remain available and can be added to a campaign explicitly.
- Funds & inventory and campaign sheets display and edit the same wallet and item records, including carrying weight/equipped state and stable item IDs. DM adjustments from a sheet create ledger entries. Players cannot mint funds, create or revalue items, or change price-affecting Charisma; purchases, transfers, requests and DM awards retain their existing authorization. Concurrent HP saves do not overwrite wallet changes, and conflicting item/coin edits are rejected. Private profile assignment retains campaign assets; standalone profiles keep their independent private inventory until an explicit DM import. Manual player reports show resulting balances and items for DM approval before import.
- Ability, save, skill, initiative, attack, damage and spell rolls use persisted sheet values and server crypto dice in shared campaigns. Guest local sheets support labeled device dice and retained device roll history. Single d20 rolls support advantage/disadvantage. Custom formulas support NdS +/- modifier. Receipts deduplicate retries after network failures.
- Campaign logs are readable by current members; standalone logs are private. Logs retain old results with pagination. Only the campaign DM can enable physical/manual results, which are visibly labeled and checked at submission time. Site staff role alone grants no campaign-sheet access.
- DMs can inspect assigned character sheets and roll for them, but cannot silently overwrite another member's sheet. Players cannot assign sheets to other players' purses.
- Open5e SRD 2014/2024 spell search imports descriptions and source attribution; custom content and imported legacy text remain editable. Creation/leveling, conditions, spell effects, hit dice and class rules are manually maintained; this release does not add automated leveling or encounter tracking.
- Existing APK users access the new sheet via the website until a signed APK update is distributed. Mobile build compatibility remains tested.

### DM encounter desk

- `/encounters` keeps the same builder/tracker UI with device-local DM encounters (no sign-in required), optional private account drafts (no multiplayer membership required), and verified active DM campaign encounters. Local encounters are isolated by device campaign, included in full device backups, and excluded from player/room snapshots. Existing export/import controls move drafts between website accounts and the app; imported drafts reset receipts, table outcomes and recipient bindings. Multiplayer encounter access and awards still require active DM membership; account drafts cannot award to campaigns. Local loot awards commit inventory, coins and the one-time receipt atomically.
- Encounter draft/active/review/awarded lifecycle; editable names, scene notes, party settings, initiative order, manual tie order, rounds, enemy/ally HP, AC, conditions, custom combatants and source notes. Revision checks protect edits on multiple devices; JSON draft export/import supports deliberate reuse.
- Open5e SRD 5.1 creature index, enemy-name/type and environment filters, and editable generation from same-level party size/level/difficulty or exact per-enemy CR/count. Estimates use explicitly labeled 2014 XP thresholds and group-size multipliers; DM house rules, effects and XP rewards remain manual.
- Existing catalog items copy into guaranteed loot and weighted encounter tables with source notes. Physical table results / DM choices and server-generated weighted draws are supported. Concluding resolves each table once into a private editable award, with no inventory change.
- Review supports quantities, values, notes, five coin denominations and per-item character/party recipients. Explicit transfer updates campaign inventory, ledger, unique award receipt and encounter state in one D1 transaction. Repeated requests return the existing receipt; failed/conflicting writes do not consume the award. Pending campaign turns and non-DM turns block transfer.
- DM manual/physical rolls and crypto app-generated dice retain distinct labels in a paginated private encounter log. Request receipts deduplicate retry after lost responses. Rolls do not automatically change HP or execute game rules.
- Existing local/turn-based/live/manual sharing, player sheets, financial features, saved campaigns and Android signing remain intact. The new profile encounter desk requires an online member account and saved DM campaign membership; existing offline gameplay is unchanged. Existing installed APKs need a future signed client update for the new navigation; mobile web is supported now.

## Mobile control panel redesign

- DM bottom navigation: Desk, Encounters, Party, Market, Library. Player navigation: Character, Inventory, Campaign, Market, Library. Existing routes remain reachable through these destinations, the unified DM Campaign control screen and role-specific settings. Legacy DM overview URLs resolve to that same screen; the player overview remains available.
- Campaign selector, unread-message action and Settings & Management gear replace the old header menus. Settings uses role-specific accordions; account privileges and server campaign permissions remain authoritative.
- DM Desk and campaign overview share one Campaign control screen. Treasury, activity/balances, sessions and campaign tools expand in place; one feature-card list and one shortcut grid remain. Backups, dollar display, campaigns, session archive controls and transaction/review details are retained.
- DM Desk reads current local/shared state: session, shared party funds, pending requests/loans, current account encounter, and compact portrait/HP readouts. Unrecorded HP is marked unknown.
- Six account-saved DM shortcuts support destination, label, icon and order customization across devices. Existing DM device shortcuts seed the first explicit account save; verified DM owners retain read-only cached destinations offline. All players, including guests, have the same six fixed shortcut-style buttons (Character Sheet, Bank, My Finances, Properties, Journal, Party chat), without customization or duplicate feature cards. Existing player preference records remain preserved. They navigate to existing tools and cannot directly award loot or perform financial mutations.
- Party has detailed authorized character cards and a Funds & inventory view. Player Inventory puts searchable item cards first; wallets, transfers and property remain expandable.
- Account character sheets have Play and Edit views. Play exposes vitals, attacks, spells, skills, resources and dice; edits still use the existing explicit save and server validation.
- Battle tracker has condensed combatants with expandable controls and bounded damage/healing adjustments. Existing generation, manual rolls, loot review and exactly-once award enforcement remain intact.
- Library links to catalog, spells, creatures, names, private DM PDFs and shared handouts. Creature references preserve attribution and cannot be imported as shop goods. Shared roll history is available in Campaign → Rolls.
- Settings dialogs restore focus, close with Escape and use scrollable mobile layouts. Android back closes overlays before navigation. Unsaved character/encounter drafts are guarded on navigation and campaign/role changes.

## Desktop workspace adaptation

- At the existing desktop navigation breakpoint (1024 CSS pixels), the app and header use the monitor width. All smaller layouts retain the approved mobile formatting.
- DM Desk’s expandable Activity & balances section adds a clearly bounded recent-transactions table, the complete scrollable pending payment/loan queue, and active-session/economy readouts. Full history and existing review/session tools remain linked. Readouts use the existing authorized economy state and session accounting; they perform no financial writes.
- Character Play places the existing dice tray and roll history beside vitals/actions. Edit retains the complete sheet editor. Saved encounters stay expanded by default in a sticky desktop sidebar; battle controls use the wider available area.
- Party, market, inventory, and reference cards gain responsive columns. Campaign recovery, backups, and manual-sharing tools sit beside the selected room/chat/rolls/alerts panel. Inactive panels remain hidden.
- No account, permission, save format, award, synchronization, theme, shortcut, or mobile navigation behavior is removed or replaced.

### Fantasy icon system

- Locally bundled Game-icons artwork across role-specific navigation, dashboard shortcuts,
  library destinations, Open5e records, catalog/shop listings, holdings, character spells and
  equipment, encounter creatures and loot. Custom item images and portraits are preserved.
- 3,013 SRD 2014/2024 record mappings, specific/family artwork and generic fallbacks, with
  colored spell-school, creature-type, item-category, damage-type and condition symbols.
- Artwork matching does not modify identities, prices, stats, permissions or saved campaigns.
  Existing IDs and source URLs resolve directly; older/custom entries use visual name/category
  matching. No schema migration or external artwork network dependency. Artist credits and
  license links are on Resources. The published Android APK remains a separate release.

## Campaign finances and downtime

- The existing campaign session area includes a collapsible DM finance section; navigation and existing inventory, trading, loan requests, and session controls remain available.
- Loans track remaining principal, interest, period length, simple/compound interest, scheduled installments, overdue payments and cumulative repayments. Approved requests create zero-interest, manual-repayment debts; earlier approved loans can be adopted without crediting funds again. New loans can use an external lender or transfer an existing campaign purse's funds.
- Recurring revenue and expenses use in-game periods, carry incomplete days, retain unpaid expenses, and can be paused or edited. Revenue may reference an existing owned inventory holding without consuming, transferring, or selling it.
- DM sets 1–3650 downtime days and reviews a stored preview. Explicit approval while starting a session applies coins, debt changes, ledger entries, in-game time and a receipt together. A changed preview is rejected; repeat approvals cannot settle twice. Cancelling changes no balances or elapsed days.
- Settlement order: all revenue, loans in creation order, then expenses. Interest is calculated per full period on remaining principal (plus unpaid interest when compounding), before its scheduled installment; sub-copper interest carries forward. Repayments cover interest first, never exceed debt, and never overdraw purses. Arrears remain visible; pausing stops accrual and settlement attempts without forgiving them.
- Financial state is stored in the campaign journal, included in device backups and shared-room persistence, with player projections limited to their assigned characters’ loans and recurring rules; private downtime quotes and other characters’ agreements stay excluded. Account-owned character profiles are never modified. Old saves remain readable. Finance ledger entries cannot be independently voided, preventing disagreement with the debt record.
- Local approvals run under one IndexedDB write transaction; shared actions retain authoritative role, turn, revision, and retry checks. Session summaries include the approved downtime and exclude internal lender transfers from received/spent totals.

Validation for this change: 427 automated tests passed (four existing skips), TypeScript passed, lint passed with existing warnings, Cloudflare and mobile builds passed. Desktop (1440px) and mobile (390px) browser audits passed on development and built production output, including campaign isolation, reload persistence, loan funding/repayment, inventory-linked revenue, recurring expenses, preview and explicit next-session approval. Screenshots inspected; no horizontal overflow or uncaught page errors. The user authorized GitHub publication and website deployment on October 3, 2026. No Android APK has been released for this change.

## Unified help and navigation

- Website Help and the in-app Help dialog share a searchable, grouped field guide covering role-specific menus, rules, finance/downtime, encounters, accounts, privacy, recovery and installation.
- Topic links retain query/hash destinations, open addressed settings/session/recovery disclosures and native finance/review panels, and preserve role checks. Existing Android, desktop and backup help anchors remain available.
- Updated app metadata and descriptions reflect the current web feature set; website and APK release schedules remain distinct. Theme exploration is separate and does not alter the live layout, icons or theme.

## Fantasy appearance modes

- Gear menu (both roles) and Settings → Colors switch between Light · Adventurer’s Ledger and Dark · Ironbound Dragon. Selection persists in the existing device preferences. New installations default to Ironbound Dragon; existing saved/custom palettes remain readable and unchanged until selected.
- Parchment grain, metal/leather finishes, engraved borders and brass framing change appearance only; all layouts, routes, icons, permissions and saved campaigns remain intact. Light surfaces use dark ink and readable secondary/action colors. Legacy looks, custom colors, reading size and reduced motion remain available.

- Device Roll mode is available in the settings menu for both roles and in Settings. Pen & Paper mode records physical final totals across character quick actions/custom dice and encounter/weighted loot-table rolls; Virtual Mode generates dice. Selection persists per device and respects shared-campaign manual-roll permission. Manual weighted totals are range-checked, labeled and deduplicated in encounter history; switching modes never rewrites pending roll receipts.

## Internal navigation preservation

- Session journal, desktop ledger/review/payment links, Settings & Management, campaign controls, account return links, party sheets and chat use the shared router navigation without restarting the title screen. Query strings, hashes, and browser back/forward remain supported.
- An AST regression check rejects raw app-route anchors; desktop/mobile browser checks exercise the actual session/account links, preserve document identity, and verify the title stays dismissed. The same browser audit runs against development and built Worker output. Fresh document starts still display the opening animation.

- Party Add loot offers custom items/property and SRD 2014/2024 Open5e equipment/magic items. Search selection fills a review draft; confirmation saves recipient, quantity, value, category and source/attribution notes through existing DM inventory permissions. Search failure supports cached results and custom entry; failed saves retain the draft.
- Slow route transitions show only the Lootsplit logo. Required account campaign restore/resume reloads use a short-lived, single-use startup handoff so they do not replay the title. Fresh launches and explicit refreshes still show the title.

## Campaign governance and session records

- DM character-edit windows beside party names, with complete before/after reports. Locked players retain health, rolls, resources, equipment and consumption; structural edits and funds/items remain server-authorized.
- Authoritative leave/dismiss/kick/ban controls revoke seats. Kicks require fresh invitations; bans block campaign/report access. Closed rooms retain authorized archives while denying character selection and edits.
- Session reports archive financial activity, character changes and authorized messages before active logs clear; DM reports indicate player-private messages without exposing contents. Account reports survive departure according to permissions.
- DM-private, party-shared and private-player journal entries can attach prior session reports.
- Merchant sale categories have DM-configurable exceptions. Service purchases are recorded and cannot be resold.
- Owner-only isolated Test mode has a settings configurator, header indicator and red DM-home reset; Test rooms are excluded from gameplay analytics.

## Session feedback improvements

- One persistent notification host with explicit close controls; completed notices clear on internal navigation without replaying the title screen.
- Account-campaign, current-party and standalone account sheet views refresh across devices without overwriting dirty drafts. Canonical inventory is ordered by stable IDs before financial conflict checks. Portrait commands update both canonical portrait fields and revision.
- Players & permissions exposes each restricted character field independently, including separate inventory/currency grants. Overrides win over the general editing window. Player grants apply on save with server validation, ownership checks and financial ledger records; ordinary gameplay remains available. No grant allows editing another player's character.
- Visible new-character and current-character import controls accept supported JSON, PDF and images. Partial imports preserve unspecified/restricted existing fields. Explicit attacks, equipment, spell levels and resource counts populate playable tabs, with original prose retained. Existing funds and inventory are not duplicated by legacy reimports.
- Pinned local Tesseract.js OCR supports scanned pages and statblock pictures; recognition assets load only when needed. All PDF pages are considered. Image imports require source review; numeric validation rejects unreadable required creature fields. OCR confidence is not a correctness guarantee.
- Downtime is offered when starting a session. An explicit zero-day choice persists per campaign and disables subsequent reminders; campaign finance controls can re-enable it. Positive downtime still uses the existing preview and explicit approval before any money/time changes.
- Session notes appear as a book with contents, dated reading/writing pages and mobile layout. Existing party collaboration, DM-private/player-private visibility and session report attachments remain intact.

## Filled character PDF fidelity

- Character import reads both indexed form fields and filled page widgets without an AcroForm index. Empty printed headings, page boundaries and copyright footers do not become inventory or identity values. Scanned/image, labeled-text and JSON imports remain supported and reviewed.
- Known numbered feature/action and equipment fields preserve their content and quantities. Fixed-damage attacks and simple damage dice retain damage-type prose in notes and expose a valid playable formula. Fixed values do not generate random dice or allow advantage/disadvantage. Partial existing-sheet imports retain unspecified values and never silently remove existing campaign items.

## Cross-device campaign selection

- Creating a shared room while signed in saves its membership to My account automatically. A failed account link reports partial success and retries the existing room's membership; it never creates a replacement room.
- Player-specific Copy link in shared play targets the active room and requested character. Explicit offline snapshot links/files remain available with a warning. Invitations react to route changes, prioritize the Room panel, require a choice when another room is connected, validate the destination before leaving, and clear invitation parameters after a successful join or dismissal. An unavailable invited character never silently selects someone else.
- Room creation offers saved-campaign resume first. Existing saved rooms, or an unavailable account lookup, require an explicit separate-room choice before creating another copy. Guest, local, live and turn-based play remain available.
- My campaigns identifies the room open on this device and includes the time of the last account open/save. Duplicate names are labelled as separate rooms; opening an older same-name entry checks fresh account metadata and asks for confirmation. Names never establish ownership or merge campaign data. Explicit selection still permits different campaigns on different devices.

## Authorized account-owned campaign model (2026-10-05)

DMs sign in and own their hosted campaigns. Open sessions survive closed tabs; explicit End session preserves the server campaign and revokes players. Reopening rotates invitations. Signed-in players get account memberships automatically. Guests keep campaign contents only in document memory, with a session-scoped reconnect credential; a new session requires joining/assignment again. DM offline play remains available for owned device copies, with explicit legacy-save claiming and existing backups preserved. Offline player copies are intentionally retired; legacy DM report imports remain for recovery. Multiple campaigns remain independent.

## Optional CC0 sound effects

- Device-local, default-off sound preference, volume and three previews in DM/player Settings and the management panel. No campaign audio preference is synchronized.
- Coins accompany successful local financial actions and confirmed shared trades; pending or failed actions do not announce success. Encounter loot awards and journal/page navigation have distinct cues.
- No startup/history playback, background-tab playback or remote audio dependency; missing/blocked playback cannot block gameplay. Sources and CC0 credits ship with three small WAV files.

## Integration consistency audit (2026-10-05)

- Campaign snapshots, full device backups and financial readouts read related balances, items and metadata in one readonly transaction. Existing schemas, private books, recovery metadata, sorting and permissions remain intact.
- Local shop/market purchases calculate Charisma pricing inside the transaction that updates funds, stock, inventory and ledger; legacy sheets and party funds retain their existing behavior.
- Account encounter listing uses a bounded membership/room join plus one projected encounter query, retaining current DM seat/token checks and unchanged mutation authorization. No UI reformatting or Android signing change.

## Roadmap priorities — implementation branch, October 6, 2026

- Signed-in player character imports are queued for DM review. Player Room UI exposes saved-sheet/assigned-character selection and request status; character editor assignment uses the same server workflow. Approve/deny is DM-only, session/seat/source/target changes are checked, and campaign currency/inventory remain authoritative. Approval receipts prevent duplicate application. Existing assigned profiles remain usable.
- DM property management configures revenue/upkeep together as existing campaign recurring finance rules. No separate property wallet, scheduler or balance. Partial periods/arrears persist and source ownership is checked. This is periodic revenue/upkeep simulation, not tenants, construction, random events or a real-world clock.
- DM shop calendars repeat over 1–30 in-game days with optional finite-stock top-up intervals. All changes settle with approved downtime; previews reject stale market changes. Manual availability overrides disable the schedule. No hourly calendar or background polling.
- Offline session transitions now use the same atomic transaction as downtime and preserve complete archived session records, including private chat and inventory, before clearing active logs.
- Homepage screenshot tour and browser/Android comparison retain the website theme and application layout. Screenshots contain synthetic characters and default shop data, with local reproducible capture tooling.
- Shared public origin roles, exact account-host validation, approved legacy host support, shared invitation URLs, migration configuration checks and read-only device-readiness guidance prepare a future domain. DNS/TLS activation and a real two-host/physical-APK rehearsal are still pending.
- Local/region/realm tax and four economy preset definitions are documented proposals only; current gameplay rules and saved campaigns are unchanged by those proposals.

Release status must be taken from the latest recovery checkpoint/PR, not this implementation inventory.

## Feature screens and player Home (2026-10-06, release pending)

- Full screens for Bank, My Finances, Downtime, Financial Settings, Property Management, Review Reports, Review Inbox, Journal and Shop Management. Existing theme/components remain; mobile has five main tabs and desktop exposes additional direct destinations.
- Compact summary/open controls replace the former embedded finance, operations and journal sections. Each feature has a Return-to-origin footer; router navigation preserves the running document. Legacy journal/finance/operations/economy links redirect to their new destinations.
- Player Home replaces the mobile Character tab and retains one-tap access to the complete sheet, owned-character readouts, campaign/messages and feature controls. Account shortcut records are user-and-role scoped and revision checked; no guest preferences are stored.
- Bank uses existing requests/debt/ledger records. New player repayment commands verify borrower ownership, available funds, outstanding amount and absence of pending downtime. Existing command receipts protect retried shared actions; turn-based changes still require turn submission.
- Property description commands verify ownership and compare previous name/notes before changing only those fields. Ownership, price, quantity and recurring economics remain protected. Journal/property/request drafts use the existing navigation guard.
- Review Reports uses shared session-summary calculations and archived records. Owner/site analytics remain in the owner account area. Downtime remains separate from Bank. New foreclosures and special property acquisition workflows are deferred.
- Additive migration0010 stores only account shortcut preferences. Existing saves, exports, backups, play modes, Android signing and campaign/account separation remain unchanged.

- DM Pending reviews opens Review Inbox, which exposes the current campaign’s existing payment/loan decisions alongside character-import reviews. Explicit reviews of another saved room do not show the active campaign’s financial queue. Bank retains its financial controls.
