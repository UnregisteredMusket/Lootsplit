# Game analytics v1

The welcome page displays total gold spent across **currently stored shared campaigns**.
It is not a count of real money, website visitors, or all offline installations.
The original website strip is reused; app navigation and financial UI are unchanged.

## Accounting contract

- Source: accepted `campaign_rooms.table` records, including their existing ledger history.
  Pending commands, private account backups, reusable character profiles and local-only saves
  are not uploaded or counted. A copied campaign hosted in a separate room is a separate game.
- Spending = purchase debits + outgoing payment debits. Approved external loan repayments
  and downtime expenses are payments. Internal transfers/loans between campaign wallets,
  loan proceeds, balance adjustments and revenue are excluded. Sales are reported separately,
  not subtracted from spending.
- Valid matching voids remove the original transaction from the statistics. IDs deduplicate
  rows within a campaign, not across distinct games. Reloads and retries cannot increment totals.
- Legacy purchase/sale/payment/transfer summaries emitted by Lootsplit are recognized.
  Unknown untyped entries are counted as unclassified rather than guessed to be spending.
- Money remains integer copper (100 cp = 1 gp). Unsafe numeric totals fail instead of rounding.
- Totals follow the current saved ledger: voids, imports, restores and room deletion can reduce
  them. They are not a permanently increasing lifetime telemetry counter. Cached server snapshots
  can be up to one minute old; the page fetches on mount. A failed fetch displays unavailable,
  never a fabricated zero. A long scan is an observational rollup, not an atomic cross-room snapshot.

## Reusable package

`src/lib/quire/analytics.ts` exports `campaignAnalytics(table, purseIds?)`, `emptyMetrics`,
`addMetrics`, `publicGameMetrics`, `GameMetrics` and `ANALYTICS_VERSION`.
It is pure, read-only, and usable by web, Android and offline code. Pass already-authorized
campaign data. Optional wallet IDs scope money, inventory and debt to those campaign players;
session and downtime totals remain game-level context. There is no account-profile linkage.

Metrics include purchase/payment spending and counts, sales proceeds/counts, loan proceeds,
transaction and unclassified counts, player/NPC characters and party funds, inventory quantity
and value, current debt, sessions/completed sessions, and approved downtime days. Character
counts represent campaign characters, not distinct human users; inventory includes properties.
No metric claims to track unrecorded combat, attendance, or play time.

## Endpoints and future publication

- `GET /api/account/site-analytics`: public version, timestamp, scope and **only** `spentCopper`.
- `GET /api/account/owner/analytics`: authenticated, active site owner only; aggregate metrics
  and shared campaign count. No raw ledger, campaign identifiers, names, chats or tokens returned.
- `publicGameMetrics` is the explicit publication allowlist. Adding an internal metric never
  publishes it. Future approved public widgets should extend this function deliberately.

The server reads in bounded pages and caches per database/isolate for one minute. It introduces
no new financial writes, database migrations, analytics collection service or backup fields.
For significantly larger room populations, replace the read-time rollup with transactionally
maintained aggregates while keeping the same API and accounting tests.

## Verification

Unit and SQLite-backed tests cover exact money, deduplication, voids, internal transfers,
legacy entries, player scope, overflow, pagination, owner authorization and the public allowlist.
The browser audit covers responsive rendering, the real public endpoint, denied private access,
and unavailable-state behavior; it does not alter real campaigns.
