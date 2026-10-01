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
