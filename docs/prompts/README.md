# Prompts for future development

Ready-to-use prompts for future Lootsplit development sessions. Copy a prompt (GitHub shows a copy button on each block) and paste it into a new Claude session as the task. Each prompt is self-contained: it tells the agent to read `CLAUDE.md` first, follow every non-negotiable rule there, work one topic per branch, and stop for the owner's decisions.

Findings and line numbers age as `main` moves. Every prompt tells the agent to re-check each item against current code before changing it. When a prompt's work is done, update its status here rather than deleting it, so the record stays.

| # | Prompt | Source | Status (updated 2026-10-23) |
| --- | --- | --- | --- |
| 1 | [Fix the bugs from the October 22 review](#1-fix-the-bugs-from-the-october-22-review) | Read-only code review of `main` at `5d77d25`, re-checked at `b325758` | Done: P1–P10 merged in #160–#185 (2026-10-22), including the estate repair #171 and P10 follow-ups #185 |
| 2 | [Make Lootsplit split loot, then expand the item and session tools](#2-make-lootsplit-split-loot-then-expand-the-item-and-session-tools) | Feature analysis of the same review | In progress: Phase 1 even coin split (#230) and Phase 2 treasure pool and claims (#238) merged and live 2026-10-23. Phases 3–6 not started (Phase 3 fairness ledger is next). Related, outside this prompt: map Place hub (#228, #232), journey planner (#235, #243), services wave 1 (#247, #249–#251) |
| 3 | [Implement the website design review](#3-implement-the-website-design-review) | Website design review, 2026-10-23 (Lighthouse, NN/g, Google Search Central, five comparable TTRPG sites) | In progress: W1–W8 merged (#219, #220, #222, #223, #225); W9 demo waits on the owner's decision |

Prompt 1 is complete, and prompt 2 is under way. It's kept below as the record of what was asked; line numbers in it refer to `5d77d25`.

## 1. Fix the bugs from the October 22 review

````markdown
# Fix the bugs from the October 22, 2026 Lootsplit review

Repo: github.com/UnregisteredMusket/Lootsplit (attach with push access and clone it).
Live site: https://lootsplit.oliverstorie2017.workers.dev

A read-only review of `main` at `5d77d25` found the bugs below. Your job is to fix them. On `b325758`, P1, P2 and the Give and Payment forms in P5 were confirmed still present. Line numbers in `cloud.server.ts` have since shifted by about +17 and are updated below; other files were not re-checked.

## Before you start

1. **Read the guides.** Read `CLAUDE.md` first; it is the developer guide, and every non-negotiable rule in it applies. Then read `docs/audit/2026-10-21-code-audit.md`, and `docs/TRADE-ECONOMY.md` and `docs/DOWNTIME-ACTIVITIES.md` for the privacy rules that apply to P1.
2. **Re-check against current `main`.** Line numbers are approximate, and `main` may have moved. If a finding no longer reproduces, say so in the PR and skip it.
3. **Reproduce before fixing.** Write a failing unit or API test first (the repo has a SQLite D1 stand-in in `scripts/account-dev-db.mjs`). Each finding below includes the repro to encode as that test. Commit the test with the fix.
4. **One topic per branch.** Use the branch names given. Each PR description is the checkpoint, so record:
   - what changed and why;
   - how it was verified;
   - your help review (`src/lib/help/content.ts` and `player-content.ts`) for any user-visible change;
   - what is left.
5. **Ship as CLAUDE.md says.** Don't push to a PR while its CI run is in progress.
6. **Hard limits:**
   - Never test against real campaigns or production data. Production D1 is read-only.
   - Migrations must be additive only. Never edit or renumber an applied one.
   - Never truncate campaign or monitoring history.
   - Old saves, backups and existing rooms must stay readable.
7. **Stop and ask the owner instead of deciding** on any item marked **OWNER DECISION**. Also stop and ask before any change that would remove, hide or reduce a feature.
8. **If `npm ci` can't reach the registry,** say exactly what could not run. CI is then the gate.

Work in this order. P1 is a live privacy leak.

---

## P1: Player room view leaks private balances and ledger lines

**Branch:** `fix/player-view-privacy`. **Severity:** high.

**Where:** the non-DM branch of `view()` in `src/lib/quire/cloud.server.ts` (~565-596). `projectRecord` (`session-records.ts` ~285, 366-382) correctly:
- reduces other accounts to `{id, name, coins: 0}`;
- filters the ledger to the seat's own purses.

`view()` then overrides both:
- `ledger:` is rebuilt from `room.table.ledger`, filtered only by `characterVisible`. That includes NPCs at other locations, exchange treasuries, and ledger lines for NPCs that aren't even listed.
- `purses:` re-spreads the raw purse (`publicPurse`) for every projected purse. That restores real `coins`, plus `permissions`, `editingAllowed`, `sheetReadOnlyForDm` and `portrait`.

The responses of `roomState`, `pollRoom`, `submitCommands`, `choosePace`, `passTurn` and `manageRoom` all use `view()`.

**Repro (test):**
1. Set up a room with DM and player A.
2. The DM creates:
   - a visible NPC at a different location with 7,777 gp, then adjusts its funds with `npc-funds`;
   - an NPC at the party's location with 1,234 gp;
   - a funded city exchange treasury.
3. Player B records a purchase.
4. Player A calls `roomState`.

**Today:** A receives the treasury's and the NPC's real coins, the far NPC's "DM adjusted NPC funds" ledger line, and B's purchase line.

**Expected:** no coins and no ledger lines for any NPC or treasury, and nothing at all about NPCs not shown to A. This is required by:
- `DOWNTIME-ACTIVITIES.md:59`: "Private NPC balances must never be projected";
- `TRADE-ECONOMY.md:19,25`;
- the UI text "Exchange balance is private".

**Fix direction:**
- Build the player ledger from `record.ledger`.
- For any purse the seat doesn't control, keep the projected `coins` and drop `permissions` and `editingAllowed`.
- Keep giving the seat its own purses in full.
- Add tests for NPCs (here, elsewhere, hidden), treasuries and a guest seat.

**OWNER DECISION, ask before changing:** other *party players'* balances and ledgers are currently visible to every player. `DOWNTIME-ACTIVITIES.md:67` says "Preserve existing visible shared balance/ledger readouts", which suggests this is intended. It conflicts with "players never see other players' private data". Leave party-player visibility exactly as it is unless the owner says otherwise, and state in the PR which way you left it.

---

## P2: Room rows grow past D1's 2 MB row limit

**Branch:** `fix/room-row-growth`. **Severity:** high. This is a design change, so plan before coding.

**Production evidence (read-only SELECT, 2026-10-21):**
- The largest `campaign_rooms.body` is 2,366,572 bytes and the next is 1,851,891 bytes. D1's documented row limit is 2,000,000 bytes.
- In the largest row, `table.journal.reports` is 1.8 MB: 7 archived session snapshots of about 256 KB each, created in `session-records.ts` ~426-457.

**Causes:**
- Every session end adds a full table snapshot to the room row.
- `room.commands`, `commandHashes`, `batches` and `batchHashes` are appended on every batch and never pruned (`cloud.server.ts` ~692-758), about 444 bytes per live submit.
- Message-only batches skip the turn check (~692), and there's no per-seat rate limit (`limitRoomEntry` only covers open, lookup and join). One player out of turn can inflate the row. A local test reached 5.2 MB with 45 requests of 100 × 500-character messages.

**Fix direction:**
1. **Move archived session reports out of the room row** into a new table, with an additive migration that ships in this PR. Keep a small reference in `journal.reports`, and read full snapshots on demand.
   - Rooms that still carry inline `snapshot` strings must keep working. Migrate them lazily on the next write, never by a destructive bulk rewrite.
   - Per-seat projection of reports (`session-records.ts` ~51-61) must still apply.
   - Nothing may be truncated.
2. **Add a per-seat rate limit on room submits,** messages included.
3. **Add an explicit size guard before `updateRoom` writes.** If the body would exceed a safe threshold (e.g. 1.8 MB), fail with a clear error and log it to monitoring (registered in `BUILTIN_LOGS`), instead of hitting an opaque D1 error.
4. **Command and batch receipts (old audit A09):** do not prune them in this PR; they back idempotency. Measure their share of row size, and propose a bounded design in the PR "what is left" section (e.g. move receipts to their own table keyed by room and seat).

**Tests:**
- Sessions archived after this change don't grow the room row.
- An old room with inline snapshots still loads, projects and archives.
- The rate limit rejects a flood.
- The size guard fires.

---

## P3: Offline and shared engines diverge (`economy.ts` vs `commands.ts`)

Rule: `commands.ts` is authoritative, and `economy.ts` (with its routing in `economy-context.tsx`) must behave identically. For each fix, add a differential test that runs the same input through both paths and asserts the same outcome.

### P3a: Estate-template listing fields are dropped

**Branch:** `fix/estate-listing-fields`. **Severity:** high.

`normalizeListing` (`src/lib/quire/market.ts` ~124-137) rebuilds listings from a fixed field list. It drops `estateTemplateKey` and `estateAttachments`, which `listingSchema` allows (`property.ts` ~45-52). Every client and offline read goes through it, including:
- `readCloudTable` (`cloud.ts` ~109);
- `readCampaignMetadata`;
- `buyListing` (`economy.ts` ~1533);
- `applyTable` (~2056);
- restore.

**Consequences:**
- **Shared rooms:** the marketplace sends the stripped client copy as `before` (`property-marketplace.tsx` ~618-631). The server comparison (`commands.ts` ~884) then rejects every purchase of a listing created by `estate-import.ts` (~235) with "This listing changed…".
- **Offline:** the check `listings.some(l => l.estateTemplateKey)` (`economy-context.tsx` ~783, `economy.ts` ~1528) is never true, so purchases take `buyListing`. That never calls `initializeEstatePurchase` (`commands.ts` ~930). The property is charged, but no operating record (staff, production, storage) is created.

**Fix:**
- Preserve both fields in `normalizeListing`.
- Add a round-trip test, plus a shared-room and offline purchase test of an imported estate listing.
- Check whether properties already bought offline lack their operating record. If so, describe a safe, non-destructive repair in the PR (e.g. offer initialization on next open). Don't auto-modify saved data without the owner's approval.

### P3b: Offline finance commands fail in campaigns with a blacksmith

**Branch:** `fix/offline-finance-shops`. **Severity:** high.

`executeFinanceCommand` (`economy.ts` ~2650-2674) loads `shops: []` and `stock: []` for every command except `shop-schedule`, `downtime-*` and `session`. `applyOwnedCommand` then runs `validateBlacksmith` (`commands.ts` ~1170), which requires each smith's shop to exist (`blacksmith-validation.ts` ~27-31).

**Repro:** offline, use the existing `smithFixture`. `finance-rule` and `finance-loan` throw "A smith profile requires an existing located shop and NPC." The same commands succeed in a shared room. Also affected:
- `finance-terms`
- `finance-repay`
- `bank-repay`
- `property-plan`
- `property-details`

**Fix:** always load the shops and stock stores in `executeFinanceCommand`, or otherwise give validators the real tables. Add a differential test covering each affected kind.

### P3c: Offline buy, sell, give and listing purchases skip shared checks

**Branch:** `fix/offline-command-parity`. **Severity:** medium.

**Missing checks offline:**
- `buyFromShop` (`economy.ts` ~1150) and `buyListing` (~1524) only check for a positive safe integer. The shared schema caps quantity at 100,000 (`commands.ts` ~59). Offline, a buy of 200,000 succeeds.
- There's no offline equivalent of `assertShipTradingHere` (`commands.ts` ~339-342) in `buyFromShop`, `sellToShop` or `buyListing`.

**Records differ:**
- Offline `giveToPlayer` writes different ledger and history entries (random IDs, a different summary, no transfer note) from the shared `give` (`commands.ts` ~998-1007).
- Market-receipt conditions differ (`commands.ts` ~878 vs `economy.ts` ~1219).

**Command IDs:** offline money actions get a fresh `crypto.randomUUID()` per call:
- `executeLocalCommand` and `executeFinanceCommand` (~2604, 2686);
- `logLine` (~1109), used by `buyFromShop`, `sellToShop`, `giveToPlayer`, `buyListing`, `postCopper` and `setCoins`.

A repeated submit is therefore a second charge, which falls short of the "idempotent command IDs" rule.

**Fix direction:**
- Route offline buy, sell, give and listing purchases through `executeLocalCommand` with the shared command shapes, so both modes run `commands.ts`. If that's too large for one PR, at minimum apply `commandSchema` and the ship check.
- Have the UI create one command ID per user action and reuse it on retry. Offline execution should dedupe on it, following the pattern `askLoan` already uses (~1666).
- Old saves must still load. Ledger and history entries already written stay as they are.

---

## P4: `/api/account/link` writes the room without bumping its revision

**Branch:** `fix/account-link-revision`. **Severity:** low-medium.

`cloudflare/accounts.mjs` ~455-458 runs `UPDATE campaign_rooms SET body=? WHERE code=? AND body=?` and leaves `revision` unchanged.

**Effect:** a concurrent `updateRoom` that read the room before the link still matches its revision-only CAS (`room-store.server.ts` ~175). It then overwrites the body, erasing `seat.userId` and, for the DM seat, `room.ownerId`. Pollers using `knownRevision` never see the link.

**Repro test:** load the room, run the link, then commit the stale `updateRoom`. `seat.userId` ends up undefined.

**Fix:** bump the revision in the same conditional UPDATE, as `campaign-characters.mjs` ~36 and `character-play.mjs` ~244/457 already do. Check every other raw `UPDATE campaign_rooms` for the same pattern.

---

## P5: Client failures shown as success, or hidden

**Branch:** `fix/client-error-feedback`. **Severity:** medium-high for users.

`decideLoan`, `give`, `post` and similar context actions catch their errors (toast) and resolve, via `run()`/`shared()` in `economy-context.tsx` ~410-478. Callers can't tell success from failure. Make these actions report the outcome (e.g. resolve to a boolean or result, or rethrow after the toast) and update the callers.

- **Loan receipt reports success on failure.** `bill-receipt.tsx` ~59 and ~67 run `decideLoan(...).then(() => setSettled(...))`. The receipt shows "Approved."/"Denied." even when the decision failed, with no retry.
  - Repro offline as DM: import a player activity file with a loan request, then make `decideLoan` throw (e.g. "This account no longer exists.", `economy.ts` ~1717).
  - Fix: only settle on success, and add a pending/disabled state. Do the same for `market-board.tsx` ~427-428, using `campaign-journal.tsx` ~640-650 as the model.
- **Sheet import fails silently.** `character-sheet.tsx` ~70 calls `void importSheet(...)`, and `importSheet` (`economy-context.tsx` ~808-817) has no try/catch.
  - Errors from `readCharacterSheet` (`sheet-file.ts` ~16-27) and `ownPurse` reach only the crash reporter.
  - Fix: show an error toast.
- **Give and Payment forms lose input.** `party.tsx` ~887-898 (Give) and ~989-994 (Payment) clear their fields before the action finishes, so a failure loses the input ("not your turn", "insufficient funds").
  - Fix: clear only on success, and add a busy/disabled state like Buy and Sell in `shop-content.tsx`.
  - Keep one command ID per action across retries (see P3c).
- **Unhandled rejections** in these spots:
  - `catalog.tsx` ~139 (`addGoods`);
  - `book.$bookId.tsx` ~113 (`remove` then navigate);
  - `party.tsx` ~851 (`loadRoster`). On an IndexedDB failure this shows "No other players are on this link"; show an error instead.

**Help review required.**

---

## P6: Room polling cost on phones

**Branch:** `fix/room-poll-cost`. **Severity:** medium.

- **Preview conflicts loop without backoff.** When the preview of local pending actions fails (`cloud-client.ts` ~428-449), `accept()` resets `s.revision` and calls `fail()` without rethrowing. As a result:
  - `acceptedPoll` stays undefined, so every 2 s poll is a full `pullCloudTable`;
  - `pollFailures` resets, so there's no backoff;
  - `publish(..., dataChanged=true)` triggers a full economy `reload()` (`economy-context.tsx` ~332-337) every time.

  Repro: queue a pending sell offline in turn-based mode, have the DM sell that holding, then reconnect.

  Fix: surface the conflict once, back off, and don't reload when nothing changed.
- **Unchanged polls re-render everything.** `publish()` (~272-294) builds a new view every poll (`lastSync: Date.now()`, ~565-573), so all ~58 `getCloudTable` subscribers re-render every 2 s. Keep the snapshot identity stable when nothing changed.
- **The snapshot getter is expensive.** `getCloudTable()`, the `useSyncExternalStore` getSnapshot, runs on every call:
  - `revokedRecoverySummaries()` and `legacyRecoveryCount()` (`revoked-recovery.ts` ~21-35, 66-95, 174-182), which iterate localStorage and `JSON.parse` matching values;
  - `JSON.stringify` comparisons (~301-305).

  Cache these and invalidate them on storage change.
- **Verify:** add a test or measurement showing an unchanged poll doesn't notify subscribers. No per-change performance report is needed (see `docs/PERFORMANCE.md`).

---

## P7: Weight capacity rejects exact fits

**Branch:** `fix/weight-capacity-rounding`. **Severity:** low.

`capacity` (`estate.ts` ~99) and `trade-buy` (`trade-economy.ts` ~480) compare `used + weight * count` against the limit without rounding the incoming amount. Example: weight 0.1 × 3 into a capacity of 0.3 computes to 0.30000000000000004 and is rejected.

**Fix:** round consistently with the existing `used` rounding (~90), or compare in integer units, in both engines. Add a test.

---

## P8: Android widget and backup reliability

**Branch:** `fix/android-widget-reliability`. This needs an Android release; follow CLAUDE.md's Android release rules:
- bump `APP_VERSION` and `versionCode`;
- add a `changelog.json` entry and release notes;
- publish only through `android-release.yml`;
- update `release.json` only after the signed APK is verified.

Fixes:
- **Receiver on the main thread.** `WidgetInstallReceiver.java` ~9 runs `WidgetRegistration.refresh(…, true)` and `renderAll` on the broadcast main thread. Use `goAsync()` with a background executor, as `MainActivity` now does.
- **Timeouts and thread pool.** `WidgetRefresh.java` ~85-96 has an 8 s task deadline, but `WidgetClient.fetch` allows a 10 s connect, 12 s read and 20 s overall deadline, on a fixed `NETWORK` pool of 2 threads. Hung fetches block later refreshes.
  - Align the timeouts so the HTTP limits are shorter than the task deadline.
  - Avoid stacking refreshes, e.g. coalesce taps while one is in flight.
- **Sign-out on any read error.** `WidgetStore.java` ~58-62 deletes the encrypted token on any read exception. Only clear it on confirmed corruption; on transient Keystore or IO errors, retry or show an error state.
- **Old audit S07: Auto Backup.** `AndroidManifest.xml` ~5 has `allowBackup="true"` and there are no rules. Add `dataExtractionRules` and `fullBackupContent` that exclude the WebView account token and session storage.
  - Don't disable backup of game saves without the owner's approval, because that reduces a feature.

---

## P9: Security and CI items still open from the October 21 audit

One branch each.

- **`fix/signin-account-lockout` (S05, M):** add a per-account failed-sign-in limit alongside the per-IP limit (`accounts.mjs` ~92, 155-164). Don't create an account-enumeration signal.
- **`fix/script-csp` (S04 remainder, M):** add a `script-src` CSP in `cloudflare/release-assets.mjs` (~36-40) after auditing inline scripts. The Grok extension script must stay off.
- **`fix/library-limits-expiry` (M01 remainder, S):** expire stale `library_limits` rows (`accounts.mjs` ~159). This is rate-limit state, not history.
- **`ci/narrow-permissions` (C01/C02 remainder, S-M):**
  - Move `id-token: write` from workflow level to only the jobs that use it in `website-release.yml`, `standby-release.yml` and `verify-live.yml`.
  - In `android-release.yml`, split signing and publishing into a job without the emulator and setup-android steps (~53-154).
  - The comment at ~57-58 says the current layout is deliberate. If that reason still holds, document it in the PR and stop.

---

## P10: Documentation corrections

**Branch:** `docs/review-followups`. Documentation only.

- **Update `docs/audit/2026-10-21-code-audit.md` "Status updates"** with what is now fixed. Verified fixed on `5d77d25`:
  - M02, M04, M05, M07–M11;
  - S01, S02, S03, S06;
  - U01–U08, U10;
  - A01 (partial), A03;
  - B01–B03.

  Write its missing "Shared rooms and economy" section from P1–P4 of this prompt.
- **Fix missing-space typos:**
  - `src/lib/help/content.ts` ~400: "Android1.9.0", "separate4×1", "Android1.9.1";
  - `docs/OWNER-MONITORING.md` ~70, 94;
  - `docs/FEATURE-INVENTORY.md` ~406.
- **`docs/audit/2026-10-20-connected-maps.md:3`** still says "not released"; the inventory lists it as shipped.
- **Export wording.** Help says the full dashboard exports history. The UI only has "Export loaded entries" (`monitor-journal.tsx` ~417-435), and the server text says "Export all pages" (`monitor-journal.mjs` ~1948). Make the wording match what the button does.
- **Missing help coverage:** add DM help for `/favorites` and for the Financial Settings, Shop Management, Review Reports and Session Time screens (`feature-navigation.ts` ~1-16). Add player help only where players can reach a screen.
- **Guard the player-help rule:** add a test that every link in `player-content.ts` targets a player route or a `dm:false` screen.

---

## Out of scope: ask the owner, don't do

- **Deleting dead code:**
  - `src/lib/multiplayer/`;
  - `web-history.tsx`, `LoanQueue`, unused exports;
  - Grok-template scripts and their 4 skipped tests.
- **`setCloudPusher` (`cloud-turn.ts` ~24):** it is never called, so `pushCloudChange()` is a no-op. Investigate and report whether chat relies on polling. Don't remove it.
- **New features:** economy modes and taxes, offline pass-phone mode, additional downtime activities, two-way HP sync, foreclosures.
- **Stale branches:** deleting the 173 stale branches. Keep `performance-history`, which is live data.

When you finish, reply with:
- one line per branch: its PR link, status, and anything left;
- anything you skipped because it no longer reproduced or needs an owner decision.
````

## 2. Make Lootsplit split loot, then expand the item and session tools

````markdown
# Make Lootsplit split loot, then expand the item and session tools

Repo: github.com/UnregisteredMusket/Lootsplit (attach with push access and clone it).
Live site: https://lootsplit.oliverstorie2017.workers.dev

Loot tracking is Lootsplit's key feature, and the website promises "Split the loot", but the app has no way to split anything. An encounter award sends all of its coins to one chosen purse:
- shared: `cloudflare/encounters.mjs`, `coinPurseId`, around lines 347-401;
- device: `src/lib/encounters/local.ts`;
- UI: `src/components/encounters/workspace.tsx`.

Nothing on Party divides a fund among characters either. Build that first, then the item and session tools below. Each phase is its own branch and PR.

## Before you start

1. **Read the guides.** Read `CLAUDE.md` first; every non-negotiable rule in it applies. Then read:
   - `docs/FEATURE-INVENTORY.md`, the baseline you must preserve;
   - `docs/TRADE-ECONOMY.md` and `docs/DOWNTIME-ACTIVITIES.md`, for privacy;
   - `docs/ENCOUNTERS.md`;
   - this file's bug-fix prompt (`docs/prompts/README.md`, prompt 1).
2. **Check prerequisites.** If prompt 1's P1 (player-view privacy leak) and P2 (room row growth) are not merged yet, do them first or stop and ask. New loot data must not land in an already oversized room row or a leaky projection.
3. **Show a mockup before building any new screen or major control.** Get the owner's approval first; the owner prefers to approve designs before they are built. Small additions to existing forms can go straight to the PR with screenshots.
4. **Apply these rules to every phase:**
   - **Money and items** change only through authoritative commands, with revision checks and idempotent command IDs. Nothing is created or charged twice, and amounts are whole copper.
   - **Both engines:** add every new money or item command to `src/lib/quire/commands.ts` (shared) and `src/lib/quire/economy.ts` (offline) with identical behavior. Prove it with a differential test that runs the same input through both paths. Prefer routing offline through `executeLocalCommand` so there is one engine.
   - **Server-side authorization** for every shared write. Reuse the existing permission rules (DM, purse control, shared-fund permissions) rather than inventing new ones.
   - **Privacy:** add every new field to the player projection (`projectRecord` in `session-records.ts` and `view()` in `cloud.server.ts`), with a test that a player cannot see DM-only or other players' private data.
   - **Old data stays readable:** make new fields optional. Old saves, backups, rooms and encounter awards (with a single `coinPurseId`) must still load and display unchanged.
   - **Schema:** use additive migrations only, shipped in the PR that needs them.
   - **History is never truncated.** New features write receipts, ledger lines and journal links like existing ones.
   - **Help:** update `src/lib/help/content.ts` (DM) and `player-content.ts` (players, no DM setup links). Add a `docs/FEATURE-INVENTORY.md` entry. Record both in the PR.
5. **Ship per CLAUDE.md.** Use one topic per branch, and write the PR description as the checkpoint (what changed, why, how verified, what is left). Don't push while a CI run is in progress.
6. **Stop and ask the owner** at every point marked **OWNER DECISION**.

---

## Phase 1: Even coin split

**Branch:** `feature/coin-split`.

### Part A: split a fund

Add a new command, for example `coin-split`, that divides an amount from one purse among chosen recipients.

**Inputs:**
- source purse;
- amount in copper, defaulting to the whole balance;
- recipient purse IDs;
- remainder rule;
- command ID.

**Who may run it:** whoever may already `give` from the source purse. That is the DM, or a player with control or shared-fund permission. Recipients must be party characters visible to the actor. Exclude NPCs unless the DM is acting.

**Math:**
- Compute in copper: `share = floor(amount / n)`, `remainder = amount - share × n`.
- Never create or lose copper. The shares plus the remainder must always equal the amount.

**Remainder rule:** stays in the source (default), goes to a chosen recipient, or rotates.
- Rotation keeps a per-campaign "next in line" pointer in campaign data, as an optional field.
- **OWNER DECISION:** which rule is the default for new campaigns.

**Denominations:** debit the source using the existing exact-change logic (`spendCoins`). Credit each recipient using one consistent breakdown (largest denominations first), shown in the preview.
- **OWNER DECISION:** offer "keep original coin types" as an option, or not.

**Atomicity and records:**
- It is one atomic command: all shares or nothing.
- Write one receipt plus a ledger line per recipient, linked to a single split ID, so Activity and the journal show it as one event.

**UI:**
- Add a "Split" action on Party fund rows.
- Show a preview of each share, the remainder and where it goes.
- Require confirmation.
- Keep the button busy until the command resolves, and don't clear the form on failure.

### Part B: split encounter coins

- **Award shape:** allow the award to split its coins as well as send them to one purse. Add optional `coinShares: [{ purseId, copper }]`, or a split mode resolved into shares at review time.
- **Exactly-once:** keep the award exactly-once guarantee (`dm_encounter_awards`, receipt IDs).
- **Old awards** with `coinPurseId` must read and display exactly as before.
- **Both paths:** implement on the shared path (`cloudflare/encounters.mjs`) and the device path (`src/lib/encounters/local.ts`) with the same results. Test both.
- **Award review:** show "Split evenly among: [party checkboxes]" with the same preview and remainder rule as Part A.

### Tests

- Shares sum to the amount for awkward inputs: 1 cp among 3; 1,000,003 cp among 7; a source short on small coins.
- Replaying the same command ID does nothing the second time, both shared and offline.
- Permission denials: a player splitting a fund they don't control, or a guest.
- Differential parity: shared vs offline.
- Old award readback.
- Player projection shows each player only what they could already see.

### Afterwards

Make sure the public site's feature copy (`src/components/website/`) describes splitting accurately. Don't redesign the site in this PR.

---

## Phase 2: Party treasure pool and item claims

**Branch:** `feature/loot-claims`.

**Treasure pool:**
- Add an unassigned party treasure pool. Encounter awards, and the DM's "Add loot", can send items there instead of to a character.
- **OWNER DECISION:** whether the pool is a special purse kind or the existing party fund. Prefer reusing the party fund's holdings if that keeps every existing view working.

**Claims:**
- Players mark pool items Need, Greed or Pass.
- A claim is a proposal only. Nothing moves until the DM resolves it, through the existing Review Inbox.
- The DM can resolve one item at a time, or use an assist: random among Need, then Greed (server-generated or Pen & Paper rolls, matching the existing roll modes), or round-robin.
- **Records:** resolution moves items atomically with a receipt. Claims and resolutions are kept as history.

**Privacy:** players see party-pool items and their own claims. Whether players see each other's claims is an **OWNER DECISION**; default to showing claim choices to the party, not hiding them.

**Tests:**
- A claim never moves inventory.
- Resolution is exactly-once.
- Offline/shared parity.
- Projection.

---

## Phase 3: Fairness ledger

**Branch:** `feature/loot-fairness`.

Add a read-only view of how much loot value each party character has received:
- per session and campaign-to-date;
- coins, plus items at their recorded value at award or claim time.

**Data:** derive it from existing receipts and ledger lines; store no new money state. Exclude NPCs and non-party purses.

**Placement:** show it beside splits and claims. Optionally weight the Phase 2 assist toward whoever is behind.

**OWNER DECISION:** whether players see the whole party's totals or only their own. Follow the same rule chosen for balance visibility in prompt 1's P1 decision.

---

## Phase 4: Bulk sell-and-split and make-change

**Branch:** `feature/sell-and-split`.

**Sell and split:**
- Select pool or fund items, sell them at an eligible open shop (existing sell rules and rates), and split the proceeds with Phase 1's rule.
- Do it in one reviewed, atomic action, or as two linked commands with a clear partial-failure state. Never sell without splitting silently.

**Make change:** convert coins between denominations inside one purse with no value change, through a command so it is logged.

---

## Phase 5: Attunement, identification, charges

**Branch:** one per item: `feature/attunement`, `feature/item-identification`, `feature/item-charges`.

- **Attunement:**
  - Add an optional `requiresAttunement` field on items; Open5e imports already produce the text in `open5e.ts`, around line 159.
  - Track per-character attuned items with the 3-item limit (DM can override).
  - Changing attunement is a character change, not a money change.
- **Identification:**
  - Items can be awarded unidentified. Players see a generic name and description; the DM sees the true item.
  - The true details must never reach player projections, exports or the TV/player display until the DM reveals them.
  - Revealing is logged.
- **Charges and consumables:**
  - Add optional charges or uses on a holding, with a "Use" action that decrements through a command and "Recharge" for the DM.
  - Using the last use of a consumable removes or zeroes it per item setting, with a receipt.

---

## Phase 6: XP, session recap, exports

**Branch:** one per item: `feature/xp-milestones`, `feature/session-recap`, `feature/ledger-export`.

- **XP and milestones:**
  - The DM awards XP or milestones per character or split evenly, optionally from an encounter award.
  - Show a level-up prompt at thresholds. Don't auto-edit the sheet without confirmation.
  - Imported sheets already carry an XP field (`sheet.ts`).
- **Session recap:**
  - Generate a "what happened" summary for a named session from its receipts: loot awarded and split, purchases, travel, downtime.
  - Show it in the campaign journal; the DM can edit it before sharing.
  - It is derived and read-only. Players get their projected version.
- **Ledger CSV export:**
  - Export Activity and ledger history as CSV (DM: everything; player: their projected history).
  - Export from the full stored history, not just loaded pages.

---

## Not in this prompt (each needs its own plan and owner approval)

- Quests and objectives, factions and reputation, personal encumbrance.
- Native Android notifications, online presence, push instead of polling.
- Pass-the-phone mode (`docs/plans/offline-pass-phone.md`).
- Configurable currencies for other game systems.
- Economy modes and taxes (`docs/plans/ECONOMY-MODES-AND-TAXES.md`).
- Foreclosures; two-way HP sync between map tokens and sheets.

When you finish, reply with:
- one line per branch: its PR link, status, and what is left;
- the owner decisions you are waiting on.
````

## 3. Implement the website design review

````markdown
# Implement the October 23, 2026 Lootsplitter website design review

Repo: github.com/UnregisteredMusket/Lootsplit (attach with push access and clone it).
Live site: https://lootsplitter.com (the old address, https://lootsplit.oliverstorie2017.workers.dev, stays as a legacy host).
Review document: https://claude.ai/artifact/ANbhivr37akQv6eXebQqbq (the owner's copy; everything you need from it is below).

A review of the seven public website pages (/welcome, /features, /downloads, /updates, /help, /resources, /donate) found that the site is well built but undersells itself. It scored accessibility 96–100 and SEO 100 in Lighthouse. Its gaps:
- it never says it is free;
- pictures still show the old name "Lootsplit";
- there is no privacy policy;
- every page has the same description;
- phones wait 4–5 s for the first screen.

Your job is to implement the improvements below. They cover the public website only; the app behind "Open the app" is out of scope.

## Before you start

1. **Read the guides.** Read `CLAUDE.md` first; every non-negotiable rule applies. Then read:
   - `docs/plans/MONETIZATION-AND-MARKETING.md` (free, donations only; Ko-fi is live);
   - `docs/audit/2026-10-22-domain-migration-audit.md` (sections 7 and 9).
2. **Re-check every finding against current `main`.** Files and numbers below were true on 2026-10-23. If something is already fixed, say so in the PR and skip it.
3. **Know what is already merged:**
   - robots.txt and sitemap.xml (#213);
   - canonical and og:url tags from `deploymentOrigins.website` (#202);
   - the lootsplitter.com cutover (#214);
   - the first-visit redirect of `/` to `/welcome` (#215, if merged).

   Don't redo them.
4. **One topic per branch.** Use the branch names given. Each PR description is the checkpoint, so record:
   - what changed and why;
   - before and after evidence: screenshots at 1366×900 and 390×844, and Lighthouse scores where relevant;
   - the help review (`src/lib/help/content.ts` and `player-content.ts`);
   - what is left.
5. **Verify like a user.** Run the existing browser audits that cover the website (`scripts/website-browser-audit.mjs`, `scripts/live-release-audit.mjs` against a local built Worker, `scripts/a11y-browser-audit.mjs`). Extend them for new behaviour. Don't push to a PR while its CI run is in progress.
6. **Hard limits:**
   - Preserve every feature and link.
   - Never invent testimonials, reviews, ratings or user counts.
   - Never add third-party scripts, trackers or ads. The CSP in `cloudflare/release-assets.mjs` stays as it is unless the owner approves a change.
   - Credit any new third-party asset in `src/lib/website/resources.ts`.
7. **Stop and ask the owner** on every item marked **OWNER DECISION**.

Work in this order.

---

## W1: Say it is free (`feature/website-free-claim`, size S)

The word "free" appears nowhere on /welcome. World Anvil ("Start Creating! It's Free"), Kanka ("Start for free") and LegendKeeper ("Try for free") all lead with it, and Lootsplitter has no paid tier at all.

- **Where:** the hero in `src/components/website/site.tsx` (`WelcomePage`).
- **Change:** under the two hero buttons, replace "Browser & Android · Guest access · Local and shared campaigns" with a line that leads with **Free**. For example: "Free · No ads · Browser & Android · Guest access". **OWNER DECISION:** the exact wording. Offer two or three options.
- Also mention "free" once on /downloads and /features.
- **Check:** `scripts/website-browser-audit.mjs` asserts the free line on /welcome at all four widths.

## W2: Replace pictures that show the old name (`fix/website-rename-images`, size S–M)

- **The share image** `public/og.jpg` (1200×630) reads "Lootsplit · Campaign ledger". It appears in every Discord, Reddit and Google preview. Make a new 1200×630 image reading "Lootsplitter", with the tagline "The party ledger" and "Free". Keep it under about 150 KiB. It may reuse the existing art, but no new third-party art without a credit. **OWNER DECISION:** approve the image before merge.
- **The product screenshots** in `public/product/*.webp` and the hero screenshot show "Lootsplit" in the app sidebar. Re-capture them with `scripts/capture-product-screenshots.mjs`, against a disposable local server with synthetic data only. Keep every alt text accurate.
- **Check:** `scripts/brand-check.mjs` (and its test) catches the old name in website images or text where it can. Extend it if it doesn't cover `og.jpg` and the product images.

## W3: Titles, descriptions and share tags per page (`feature/website-page-metadata`, size S)

**Now:** every public page has the same 230-character meta description (`APP_DESCRIPTION` in `src/lib/help/content.ts`, set in `src/routes/__root.tsx`). og:title is "Lootsplitter" on every page, and the home page's `<title>` is just "Lootsplitter".

**Change:**
- give each public route its own `title`, `description`, `og:title` and `og:description` through its `head()`;
- keep descriptions under about 155 characters;
- set the home title to "Lootsplitter — free D&D loot splitter and campaign ledger" (**OWNER DECISION:** wording);
- lead other titles with the page subject, for example "Features for DMs and players · Lootsplitter".

The app routes keep the generic title.

**Add** WebSite and Organization JSON-LD on /welcome only: name, url `https://lootsplitter.com`, logo, `sameAs` the GitHub repository. Do **not** add SoftwareApplication markup. Google requires a rating or review for it, and Lootsplitter has none to show.

**Check:** extend `scripts/grok-pwa-plugin.test.mjs` or a new unit test so that every public page has a unique title and description and the home page has valid JSON-LD.

## W4: Privacy policy and terms (`feature/website-privacy`, size S–M)

`/privacy` and `/terms` return 404, and the footer links to neither. The site creates accounts with email addresses and stores campaigns on Cloudflare D1.

**Add** a public `/privacy` page with the same layout as `/donate`, and link it from the footer of every public page and from My account. Add it to `PUBLIC_PAGES` in `src/lib/deployment/public-urls.mjs` so it gets a canonical tag and a sitemap entry. Add its path to the public-path lists (`__root.tsx`, `scripts/title-screen-navigation.mjs`).

**Write it from the code, not from memory:**
- what is collected: account email and name, campaigns and rooms in D1, device-only data;
- where it lives: Cloudflare;
- how long it is kept;
- how to delete an account;
- that there are no ads or trackers;
- the contact: support@lootsplitter.com.

**OWNER DECISION:** approve the text. Terms are optional; ask the owner.

## W5: Rework the live coin counter (`fix/website-treasury-counter`, size S)

/welcome shows "The treasury: 5.58 gp spent across shared campaigns" (`src/components/website/gold-counter.tsx`). While the site is new, this reads as near-zero use.

**OWNER DECISION:** hide it until the total passes a threshold, or replace it with a capability statement (for example, "Five coin types, every split recorded"). Don't remove the counter's data or endpoint; only its presentation changes.

## W6: Faster first screen on phones (`perf/website-mobile-lcp`, size M)

Lighthouse 12 mobile, 2026-10-23:

| Page | Performance | LCP |
| --- | --- | --- |
| /welcome | 75 | 5.0 s |
| /features | 77 | 4.1 s |
| /downloads | 78 | 4.1 s |
| /help | 70 | 4.0 s |

The target is LCP ≤ 2.5 s (web.dev "good").

- **Hero image:** on /welcome the LCP element is the hero background `public/art/landscape.webp`, drawn 412×972 on a phone. Preload it, add a phone-sized variant (`srcset`/`sizes`) and give it `fetchpriority="high"`.
- **Server response:** it is about 780 ms. Investigate edge caching of the public pages' HTML, for example a Cache API wrapper in the Worker for GET public pages without cookies. Keep correct release identity, CSP and the no-store rules in `releaseResponse`. **OWNER DECISION** if caching changes how fast a release becomes visible.
- **Unused code:** public pages load about 169 KiB of unused app JavaScript and one render-blocking stylesheet. Reduce it where TanStack Start allows, with a route-level split. Measure before and after.
- **Check:** record Lighthouse before and after in the PR, mobile and desktop, for the four pages. The performance log rules in `docs/PERFORMANCE.md` apply.

## W7: Accessibility and layout fixes (`fix/website-a11y-polish`, size S)

- **Links distinguished by colour alone** on /welcome and /help (Lighthouse `link-in-text-block`, WCAG 2.2 SC 1.4.1, Level A). Underline links in running text, or give them ≥ 3:1 contrast against body text.
- **/help layout shift:** CLS is 0.22–0.25, because the footer jumps as help content loads. Reserve the content's height or render it on the server. The target is CLS ≤ 0.1.
- **Check:** extend `scripts/a11y-browser-audit.mjs`.

## W8: Downloads, Donate and navigation clarity (`feature/website-clarity`, size S)

- **/downloads:**
  - Fold "Release details and verification" and "About this app & releases" under one "Technical details" disclosure, closed by default. Keep every value and link; the audits read them, so update them.
  - Rephrase "A native Windows or macOS installer is not available yet" as "Works in any modern browser — nothing to install."
  - Add a short "Why isn't this on Google Play?" note beside the APK. (It is sideloaded; the checksum and permanent signing key make it safe to update.)
- **/donate:** say what donations pay for. Hosting is about $70 a year (Workers Paid plus the domain). **OWNER DECISION:** wording.
- **Header:** consider moving "Changelog" and "Resources" to the footer, leaving Features, Downloads, Help, Donate, My account and Open the app. **OWNER DECISION.**
- **Footer:** add a labelled "Home" link.

## W9: A short demo (`feature/website-demo`, size M–L, OWNER DECISION before starting)

Foundry and Kanka offer a web demo or a 45-second video. Propose one of these to the owner:
- a 30-second silent video or animated capture of a loot split (self-hosted under `public/`, no third-party player, so the CSP stays unchanged);
- a read-only sample campaign ("The Wayfarers" fixture) that opens without signing in.

Build only the approved option.

## Owner tasks (not code; list them in your first PR)

- **Google Search Console:** verify lootsplitter.com as a Domain property (DNS TXT record through Cloudflare) and submit `https://lootsplitter.com/sitemap.xml`.
- **Launch posts:** follow the marketing plan's posts (r/rpg, AlternativeTo, itch.io) after W1–W3 ship, so shared links show the new name and image.
- **Testimonials:** collect real testimonials, with permission, before adding any social proof.

## Out of scope

- The app's own screens.
- Paid tiers, ads or analytics scripts.
- Google Play publishing, which needs its own plan and owner approval.
- Changing the Android widget's website link (P2-1 in the domain audit), which ships with the next APK.
````
