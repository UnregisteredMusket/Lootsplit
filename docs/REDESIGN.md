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

## Implementation review — release candidate, not deployed
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

### Remaining release gates
The Cloudflare branch-preview check failed without exposing an error in GitHub's check summary. The Cloudflare dashboard's security verification blocks this browser. The local preview cannot start in this execution environment (network-interface system call is restricted). Therefore live two-browser tests, visual mobile/desktop/light-mode checks, and screenshots have NOT been completed. Main/production has not been changed. Obtain the last error lines of the branch-preview build, fix preview, then verify the UI and shared flows before promoting the release. Android build starts after that web release validation, as requested.

### Deployment and rollback
Checkpoint branch `checkpoint/pre-redesign-1.2.3` points to e6776f55ad557fe5e5fdd6927bdfc8d0df0aa003. Release candidate is on `feature/illustrated-ledger`. Promote only after remaining gates. Deploy server and matching assets together through the existing Cloudflare build; preserve D1. Roll back code through a revert/redeployment without deleting or restoring D1. Keep new client backups; older binaries do not understand the new journal fields.
