# DM encounters

Open **My account → DM encounters**, or **More → DM encounters** in the app. Host a campaign and save its DM membership to your account first. Encounter data is private to the creating DM account, and current DM membership is rechecked on every read/write.

1. Create an encounter. Add custom enemies/allies or search the Open5e creature index. Generate adds enemies to the existing roster; it never replaces it.
2. Set party size and common level. Choose a 2014 difficulty target or a specific CR per enemy. The estimate is advisory; custom action economies and environmental advantages are not modeled.
3. Attach loot, catalog items and optional weighted tables. Resolve each table with a physical result/DM choice or a server draw. Save changes.
4. Start the encounter. Enter initiative, HP, AC, conditions and rounds manually; Next turn cycles the sorted initiative roster, including defeated combatants until the DM removes/skips them. Equal initiatives use roster order.
5. Record physical results or use app-generated dice in Roll history. Apply results to gameplay yourself.
6. Conclude to create the private loot review. Edit amounts and recipients, save, then explicitly transfer. The campaign must be on the DM's turn in turn-based mode and must have no pending submitted turn drafts.
7. The awarded encounter is read-only with a receipt. A retry, double-click or lost response cannot award it again. Export/import intentionally creates a separate new encounter, not a retry of an old award.

## Persistence and compatibility

Migration `0008_encounters.sql` adds account-owned encounter, roll and award tables. Existing campaign room JSON and legacy saves remain unchanged until a reviewed award adds ordinary holdings/ledger entries. The account encounter records are separate from existing campaign backup exports; export the encounter JSON to keep a portable copy. Server receipts remain authoritative for awards and rolls. Do not delete receipt tables during rollback.

The generator retrieves the SRD 5.1 creature index through Open5e, retaining source attribution. Each creature's environment tags drive filters; no matching data produces a visible message. An external-source outage does not prevent custom encounter editing or access to saved encounters. No copyrighted non-SRD monsters are bundled.

## Verification

Service tests cover ownership/DM permissions, revoked memberships, revision conflicts, manual/automatic rolls, weighted results, review before transfer, recipient validation, pending turns, turn ownership, repeated transfers, concurrent room changes, and transactional rollback after an injected inventory-write failure.

The browser audit uses disposable local DM/player accounts and campaign data, exercises actual account APIs, saves and reloads, generates Open5e enemies, checks phone/desktop layout, records a physical result, resolves a table, reviews loot and simulates a lost transfer response before retrying. It must never target a real user's campaign.

## Validation for this implementation

- Full regression suite: 375 passed, 4 existing skips (215 script tests, 105 app tests, 55 auth/app-data tests).
- TypeScript, Cloudflare production build and mobile web bundle passed.
- Six encounter service tests passed, including write rollback and concurrent-room protection.
- Desktop and 390-pixel mobile browser flow passed with real local account APIs and live Open5e data. Verified manual roll labeling, saved combat, generation, loot-table resolution, per-recipient review, reload persistence, player denial, and response-loss retry with exactly one inventory/coin transfer.
- The same full browser flow also passed against the production-built interface, using a test-only local proxy to the real account handler and disposable SQLite data. Production Worker deployment itself remains unperformed.
- The generic anonymous-page smoke script rendered both sizes without overflow or page exceptions, but flags the expected unauthenticated 401 and this environment's blocked external template-branding certificate. The authenticated encounter audit reported no uncaught page errors.
- Publication is pending explicit user permission after automatic approval review rejected the GitHub push access check. No production data, deployment or real user campaigns were changed.
