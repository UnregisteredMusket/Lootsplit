---
description: Checklist for adding or changing anything that moves money, items or inventory in Lootsplit (a command kind, an encounter award, a split, a purchase, a transfer, a receipt). Use before writing code that touches commands.ts, economy.ts, economy-context.tsx, encounters awards or ledger/receipt data.
---

# Changing money or inventory in Lootsplit

Lootsplit has two engines that must behave identically:
- `src/lib/quire/commands.ts`: the authoritative shared engine;
- `src/lib/quire/economy.ts`: the offline copy, routed from `economy-context.tsx`.

The October 22 review found three bugs where they drifted apart. Work through every item below. Any item you skip goes in the PR description with the reason.

## Design

1. **Shared command first.** Express the change as a shared command shape in `commands.ts` (zod schema with whole-copper, non-negative, bounded amounts and quantity ≤ 100,000). Then make offline run that same command through `executeLocalCommand`; don't hand-write a second implementation in `economy.ts`.
2. **Whole copper only.**
   - Compute in copper.
   - Divisions use `floor` plus an explicit remainder that goes somewhere visible. Totals out must equal totals in.
   - Never `toFixed`, never floats in storage.
   - Pay out with the existing exact-change helpers (`spendCoins`, `money.ts`).
3. **Idempotent IDs.**
   - The UI creates one command ID per user action and reuses it on every retry.
   - Shared: receipts in `room.commands` and `commandHashes` dedupe it.
   - Offline: dedupe on the same ID inside the IndexedDB transaction (see `askLoan`).
4. **Revisions.** Shared writes go through `updateRoom`'s revision CAS. Any raw `UPDATE campaign_rooms` must bump `revision` in the same statement.
5. **Authorization on the server.** Reuse `dm()` and `own()`, purse control and shared-fund permissions. Client checks are convenience only.
6. **Atomic.** All parts of one action succeed or none do; a batch validates all-or-nothing. Never leave a half-applied split, sale or award.
7. **History.**
   - Write ledger lines and receipts keyed by the command ID, so Activity and the journal show one event.
   - Never truncate or rewrite history.
8. **Old data stays readable.** New fields are optional. Old saves, backups, rooms and awards must load and display unchanged.

## Privacy

- **Player projection:** add every new field to the player projection, which is `projectRecord` in `session-records.ts` *and* the non-DM branch of `view()` in `cloud.server.ts`. `view()` has overridden the projection before (review P1).
- **What players never see:**
  - NPC and exchange-treasury balances;
  - ledger lines for purses they can't read;
  - hidden NPCs;
  - DM-only item truths;
  - other players' private data.
- **Other projections:** check exports, the TV/player display and widgets too.

## Tests (write them before the fix)

- **Differential:** run the same input through the shared path and the offline path, and assert the same balances, holdings, ledger lines and error text.
- **Copper conservation:** awkward inputs (1 cp among 3; large amounts; sources short on small coins). If fast-check is installed, add a property test as well.
- **Replay:** submitting the same command ID twice changes nothing the second time, both shared and offline.
- **Permissions:** a player or guest without control is refused on the server.
- **Projection:** a player's `roomState` doesn't contain the new private data.
- **Old data:** an old save or award without the new fields still loads.

## Before the PR

- Review the help text in `src/lib/help/content.ts` (DM) and `player-content.ts` (players, no DM setup links).
- Add a `docs/FEATURE-INVENTORY.md` entry for user-visible changes.
- Follow `/ship-pr`.
