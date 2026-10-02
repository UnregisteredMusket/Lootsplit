# Preservation inventory

No feature below may be removed, disabled, hidden or reduced without explicit user approval. Locations are entry points, not permission grants. Server authorization remains authoritative.

| Capability | Entry point |
|---|---|
| Campaign create/rename/switch/export/delete, current/last handling and recovery | Campaign controls |
| Default Greyhaven party and deliberately blank campaigns | Initialization / campaign controls |
| Separate DM and assigned-player dashboards | Home |
| Player/NPC accounts and multiple party funds | Party |
| Five denominations, conversion, payments, transfers and dollar estimates | Party / Settings |
| Item/property ownership, quantities, valuation, notes, search and categories | Party / inventory |
| Portrait upload/reset, item/shop/property imagery and fallbacks | Party / Market |
| Supported character-sheet import/edit/review and Charisma | Character sheet |
| Handouts and player references | Character / Sharing |
| Shops, keeper/location/category/wealth, open/closed states, filters | Market |
| Stock editing/generation, finite/unlimited quantities, restock, custom prices | Shop |
| Purchases, sales, gifts, property listings and receipts | Market / Party |
| Buy/sell rates, discounts, economic modifiers, previews and repricing | Market / Settings |
| Loans, explicit payment requests and DM review | Market / review inbox |
| Ledger, voiding, full/recent activity, price and management history | Activity |
| Named sessions and transfer-aware summaries | Campaign journal |
| Starter/custom catalog, services, rarity/categories and generated goods | Catalog |
| Open5e supported references/imports and attribution | Catalog |
| Offline fantasy names and saved lexicon | Catalog |
| Private PDFs, reader/articles/search/favorites/page references | Books |
| PDF text/form extraction, review, prices, conflicts and catalog/shop imports | Books / import tools |
| Local/Turn-based/Live, hosting/joining, character assignment, shared-fund permissions, turns | Multiplayer |
| Room codes, invitations, share and copy fallback | Multiplayer |
| Party/private chat, recipient restrictions, unread and pending/delivery states | Multiplayer Chat |
| In-app/browser notices and browser background message subscriptions | Notifications |
| Persistent connection, pending commands, retries/conflicts and recovery export/import | Multiplayer |
| Manual player links/files, reports and permitted change imports | Manual sharing |
| Pre-join copies, named backups, export/import/restore, validation and conditional pre-update backup | Device backups |
| Password/protected-save behavior and diagnostics | Settings |
| Light/dark/custom appearance, reading scale, display settings and reduced motion | Settings |
| Android bundled client, native share/file save, network/back behavior and permanent signing | Android |

Not implemented or promised by this inventory: OCR, Google Drive backup integration, native Android push, online presence, or editors for every kind of image.

## Website and optional account library
- Public welcome, Android download, desktop installation guidance, changelog and help pages alongside the existing app URL.
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
