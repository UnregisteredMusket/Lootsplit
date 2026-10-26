# DM encounters

Open **My account → DM encounters**, or **More → DM encounters** in the app. Host a campaign and save its DM membership to your account first. Encounter data is private to the creating DM account, and current DM membership is rechecked on every read/write.

1. Create an encounter. Add custom enemies/allies or search the Open5e creature index. Generate adds enemies to the existing roster; it never replaces it.
2. Set party size and common level. Choose a 2014 difficulty target or a specific CR per enemy. The estimate is advisory; custom action economies and environmental advantages are not modeled.
3. Attach loot, catalog items and optional weighted tables. Resolve each table with a physical result/DM choice or a server draw. Save changes.
4. Start the encounter. Enter initiative, HP, AC, conditions and rounds manually; Next turn cycles the sorted initiative roster, including defeated combatants until the DM removes/skips them. Equal initiatives use roster order.
5. Record physical results or use app-generated dice in Roll history. Apply results to gameplay yourself.
6. Conclude to create the private loot review. Edit amounts and recipients, save, then explicitly transfer. The campaign must be on the DM's turn in turn-based mode and must have no pending submitted turn drafts.
   Coins go to **One purse** (every coin, original coin types, `coinPurseId`) or **Split evenly among** ticked party characters (`coinSplit`; `coinPurseId` is then empty so an older client cannot send everything to one purse). Split shares use gold, silver and copper; the leftover follows the party-fund, chosen-recipient or rotate rule shared with fund splits (see FEATURE-INVENTORY "Even coin split").
7. The awarded encounter is read-only with a receipt. A retry, double-click or lost response cannot award it again. Export/import intentionally creates a separate new encounter, not a retry of an old award.

## Persistence and compatibility

Migration `0008_encounters.sql` adds account-owned encounter, roll and award tables. Existing campaign room JSON and legacy saves remain unchanged until a reviewed award adds ordinary holdings/ledger entries. The account encounter records are separate from existing campaign backup exports; export the encounter JSON to keep a portable copy. Server receipts remain authoritative for awards and rolls. Do not delete receipt tables during rollback.

The generator retrieves the SRD 5.1 creature index through Open5e, retaining source attribution. Each creature's environment tags drive filters; no matching data produces a visible message. An external-source outage does not prevent custom encounter editing or access to saved encounters. No copyrighted non-SRD monsters are bundled.

### Coin split awards (2026-10-23)

- **Shape.** The draft may carry optional `coinSplit: { purseIds (1–20), remainderRule: "party-fund" | "recipient" | "rotate", remainderPurseId? }`. At transfer time both paths call the one planner `applyEncounterSplit` (`src/lib/quire/coin-split.ts`), which credits each share and any moved leftover with `creditCoins` and writes ledger lines `${receiptId}-share-${i}` / `${receiptId}-remainder` (`transactionType: "adjustment"`, `split.id = receiptId`). A rotation advances `journal.coinSplit.rotation`.
- **Receipt.** The award body adds `coinShares: [{ purseId, copper }]`, optional `coinRemainder: { purseId, copper, rule }` and `coinSplitId`; `recipients` lists every share holder. Copper converts to coins with `fromCopper`.
- **Exactly once.** Unchanged: `dm_encounter_awards`, the room-body comparison and the D1 batch (shared), and the single IndexedDB transaction with the `status === "review"` check (device). A refused split (for example a party fund ticked as a recipient, or too few coins) changes nothing.
- **Old awards.** Awards with `coinPurseId` and no `coinShares` keep the original branch of `recipientAwardPreview`, byte for byte; tests prove it.
- **Detail.** Shared detail responses add `splitTable` (purse kinds, NPC flags, party positions and split settings only) so the DM's preview plans exactly what the Worker will.

### Treasure pool awards (2026-10-23)

- **Shape.** A loot item may carry optional `pool: true` with an empty `purseId` (an older client that drops the flag asks for a recipient instead of sending the item elsewhere); the draft may carry optional `poolFundId`. Pooled items go to `poolFundId` when it is still a party fund, else the designated party fund (`journal.coinSplit.partyFundId`, else the first). With no party fund the award is refused and readiness says "Add a party fund before sending items to the treasure pool."
- **Rows.** Both paths call `encounterPoolRows` (`src/lib/quire/loot-claims.ts`): holdings `${receiptId}-pool-${i}` in the fund with `pool: { source: "encounter", encounterId, receiptId }`, 0 cp ledger lines with `loot.role: "added"`, one `lootPool` journal event per item and one party chat note. Other items move exactly as before.
- **Receipt.** The award body adds `poolFundId`; `recipients` includes the fund. The read-only receipt lists each item with "→ Treasure pool" or its character, and links to the pool.
- **Exactly once and rollback.** Unchanged: `dm_encounter_awards`, the room-body comparison and the D1 batch (shared); one IndexedDB transaction with the `status === "review"` check (device). Tests cover a lost-response retry, an injected write failure and the no-fund refusal on both paths.
- **Old awards.** Awards without pool fields keep exactly their previous preview shape and receipt.

### Award tag on ledger lines (2026-10-24)

- **Shape.** The one-purse coin line and each item sent straight to a purse carry an optional `award: { receiptId, role: "coins" | "item", quantity?, unitCopper? }` (owner approval 2026-10-24): the award receipt and the value the DM reviewed. Metadata on lines both paths already wrote, never a balance; no table or migration.
- **One helper.** Both paths call `encounterCoinLine` / `encounterItemLine` (`src/lib/quire/award-tag.ts`) inside the existing exactly-once award. Line IDs are now `${receiptId}-coins` and `${receiptId}-item-${i}` (were random); summaries are unchanged. A differential test (`src/lib/encounters/local-award-tag.test.ts`) checks the shared and device paths write the same tagged lines, once.
- **Fairness.** The Fairness ledger counts tagged items at their recorded value. Older lines without the tag still read: coins by their summary, items as 0 cp flagged "value not recorded" (see FEATURE-INVENTORY "Fairness ledger").

### Loot review workflow (design plan D1, Q2, Q3, 2026-10-25)

- **Finding it.** The Desk shows a "Ready for loot review · <encounter>" card for each encounter in `review` in the current campaign (up to three, then a link to Encounters) and adds them to the Pending reviews count; the card opens `/encounters?encounter=<id>&review=1` (Loot & rewards). Encounters opens the only active or reviewable encounter directly (a review on Loot & rewards); with none or several it keeps the list, loot reviews first with a "Loot review" badge (`src/lib/encounters/loot-review.ts`).
- **Rows.** Each item is one compact row: select · name · quantity · value each in gold (`250`, `2.5`, `2 gp 5 sp`; at most two decimals so it is whole copper, up to the schema's 1,000,000 cp, with a live "= 250 gp" echo) · recipient. Details keeps the exact "Value each (cp)" field, notes and Remove item. `unitCopper` is still the stored unit.
- **Bulk (Q2).** "Assign selected to…" and "Send selected to treasure pool" apply exactly the per-row semantics (a recipient clears `pool`; the pool sets `pool: true` and clears `purseId`) to the draft only. Nothing moves until the DM saves and transfers.
- **Footer.** A bar fixed above the phone navigation (sticky on desktop and in the map panel) shows the total (coins plus item values), the recipient summary, the first readiness reason, Save review when there are unsaved changes, and the one **Transfer loot once** button: the same confirmation and the same `encounters/award` request, so the receipt still makes it exactly once.
- **Remembered recipient (Q3).** The last One purse coin recipient is kept per campaign (room code, or `device:<campaign id>`) in `localStorage` under `lootsplit.award.coinRecipient.*`, read and written in try/catch. It is only offered ("Coins to <name>, as last time") when the award has coins and no recipient, and only if that purse still exists; it never decides anything by itself.
- **No new data.** No new command, field, migration or projection; awards and old saves read exactly as before.

## Verification

Service tests cover ownership/DM permissions, revoked memberships, revision conflicts, manual/automatic rolls, weighted results, review before transfer, recipient validation, pending turns, turn ownership, repeated transfers, concurrent room changes, and transactional rollback after an injected inventory-write failure.

The browser audit uses disposable local DM/player accounts and campaign data, exercises actual account APIs, saves and reloads, generates Open5e enemies, checks phone/desktop layout, records a physical result, resolves a table, reviews loot and simulates a lost transfer response before retrying. It must never target a real user's campaign. `scripts/loot-review-browser-audit.mjs` (CI `dev-loot-review`, `npm run verify:focus -- loot-review`) covers the Desk card and count (zero, one, two), Desk card → Transfer → confirm in three taps with the button in view at 390 × 844, 320 × 700 and 1280 × 900, compact rows and gold values, bulk assign and pool, the remembered coin recipient, Encounters opening its only review, and exactly-once transfer on a device campaign.

## Validation for this implementation

- Full regression suite: 375 passed, 4 existing skips (215 script tests, 105 app tests, 55 auth/app-data tests).
- TypeScript, Cloudflare production build and mobile web bundle passed.
- Six encounter service tests passed, including write rollback and concurrent-room protection.
- Desktop and 390-pixel mobile browser flow passed with real local account APIs and live Open5e data. Verified manual roll labeling, saved combat, generation, loot-table resolution, per-recipient review, reload persistence, player denial, and response-loss retry with exactly one inventory/coin transfer.
- The same full browser flow also passed against the production-built interface, using a test-only local proxy to the real account handler and disposable SQLite data. Production Worker deployment itself remains unperformed.
- The generic anonymous-page smoke script rendered both sizes without overflow or page exceptions, but flags the expected unauthenticated 401 and this environment's blocked external template-branding certificate. The authenticated encounter audit reported no uncaught page errors.
- Publication is pending explicit user permission after automatic approval review rejected the GitHub push access check. No production data, deployment or real user campaigns were changed.

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Encounter initiative ordering

The combatant array is the persisted display/turn order for device, account and shared campaign encounters. Initiative entry, draft saves, start and reload never sort it implicitly. Only the DM's **Sort initiative** action calls `sortInitiative`; it keeps the active ID and round, retains tied roster order and puts blanks last. `nextTurn` follows the stored array. Preserve schema/version, IDs, revision checks, read-only/role locks and map roster references. Run encounter model/permission tests and the existing device/account browser audits, including stable multi-digit focus, desktop/mobile explicit sorting, clearing scores, turn traversal and reopened order, plus full release gates.
