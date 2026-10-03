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

- Optional locked Render standby, verified portable releases, encrypted offsite D1 snapshots, and manual fenced recovery to a new Turso/libSQL database. See `docs/STANDBY.md`; snapshots exclude device-only campaigns/PDFs. Existing primary, Android and offline behavior is preserved.

- Public welcome, Android download, desktop installation guidance, changelog and help pages alongside the existing app URL.
- App startup has a click/tap/keyboard-to-continue title screen. The title fades in once; a 15-second loop shows a 16-bit-style adventurer struggling and dragging a heavy sack, spilling coins from its bottom, with a rogue following to collect them. Reduced-motion preferences show a static title screen. Artwork is bundled locally for web and Android.
- Versioned website changelogs retain previous entries and describe added features, improvements and summarized fixes for every Android update. The signed-release gate requires matching notes before publication.
- Fixed-version Android download endpoint verifies the release checksum; original GitHub and Drive alternatives remain available.
- Optional email/password accounts with server-side sessions, rate limiting, sign-out, and single-use rotating recovery keys. Email delivery is not configured.
- Account-owned campaign memberships, resume with fresh room/seat validation, archive/unarchive and forget. Existing guest room workflows remain available.
- Explicit private cloud backup versions, download, delete and restore into a new local campaign. PDFs/reference content remain device-local; encrypted device backups remain the route for protected saves.
- Reusable character names, portraits and notes; adding a profile to a local DM campaign creates an empty purse and does not transfer wealth or inventory.

## Website owner and credits

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

- `/encounters` and DM links in My account / app navigation add private, account-owned encounters tied to a verified active DM campaign membership. Players and site staff without that membership cannot read or mutate encounters.
- Encounter draft/active/review/awarded lifecycle; editable names, scene notes, party settings, initiative order, manual tie order, rounds, enemy/ally HP, AC, conditions, custom combatants and source notes. Revision checks protect edits on multiple devices; JSON draft export/import supports deliberate reuse.
- Open5e SRD 5.1 creature index, enemy-name/type and environment filters, and editable generation from same-level party size/level/difficulty or exact per-enemy CR/count. Estimates use explicitly labeled 2014 XP thresholds and group-size multipliers; DM house rules, effects and XP rewards remain manual.
- Existing catalog items copy into guaranteed loot and weighted encounter tables with source notes. Physical table results / DM choices and server-generated weighted draws are supported. Concluding resolves each table once into a private editable award, with no inventory change.
- Review supports quantities, values, notes, five coin denominations and per-item character/party recipients. Explicit transfer updates campaign inventory, ledger, unique award receipt and encounter state in one D1 transaction. Repeated requests return the existing receipt; failed/conflicting writes do not consume the award. Pending campaign turns and non-DM turns block transfer.
- DM manual/physical rolls and crypto app-generated dice retain distinct labels in a paginated private encounter log. Request receipts deduplicate retry after lost responses. Rolls do not automatically change HP or execute game rules.
- Existing local/turn-based/live/manual sharing, player sheets, financial features, saved campaigns and Android signing remain intact. The new profile encounter desk requires an online member account and saved DM campaign membership; existing offline gameplay is unchanged. Existing installed APKs need a future signed client update for the new navigation; mobile web is supported now.

## Mobile control panel redesign

- DM bottom navigation: Desk, Encounters, Party, Market, Library. Player navigation: Character, Inventory, Campaign, Market, Library. Existing routes remain reachable through these destinations, the full campaign overview and role-specific settings.
- Campaign selector, unread-message action and Settings & Management gear replace the old header menus. Settings uses role-specific accordions; account privileges and server campaign permissions remain authoritative.
- DM Desk reads current local/shared state: session, shared party funds, pending requests/loans, current account encounter, and compact portrait/HP readouts. Unrecorded HP is marked unknown.
- Six per-device, per-campaign shortcuts support destination, label, icon and order customization. They navigate to existing tools and cannot directly award loot or perform financial mutations.
- Party has detailed authorized character cards and a Funds & inventory view. Player Inventory puts searchable item cards first; wallets, transfers and property remain expandable.
- Account character sheets have Play and Edit views. Play exposes vitals, attacks, spells, skills, resources and dice; edits still use the existing explicit save and server validation.
- Battle tracker has condensed combatants with expandable controls and bounded damage/healing adjustments. Existing generation, manual rolls, loot review and exactly-once award enforcement remain intact.
- Library links to catalog, spells, creatures, names, private DM PDFs and shared handouts. Creature references preserve attribution and cannot be imported as shop goods. Shared roll history is available in Campaign → Rolls.
- Settings dialogs restore focus, close with Escape and use scrollable mobile layouts. Android back closes overlays before navigation. Unsaved character/encounter drafts are guarded on navigation and campaign/role changes.

## Desktop workspace adaptation

- At the existing desktop navigation breakpoint (1024 CSS pixels), the app and header use the monitor width. All smaller layouts retain the approved mobile formatting.
- DM Desk adds a clearly bounded recent-transactions table, the complete scrollable pending payment/loan queue, and active-session/economy readouts. Full history and existing review/session tools remain linked. Readouts use the existing authorized economy state and session accounting; they perform no financial writes.
- Character Play places the existing dice tray and roll history beside vitals/actions. Edit retains the complete sheet editor. Saved encounters stay expanded by default in a sticky desktop sidebar; battle controls use the wider available area.
- Party, market, inventory, and reference cards gain responsive columns. Campaign recovery, backups, and manual-sharing tools sit beside the selected room/chat/rolls/alerts panel. Inactive panels remain hidden.
- No account, permission, save format, award, synchronization, theme, shortcut, or mobile navigation behavior is removed or replaced.
