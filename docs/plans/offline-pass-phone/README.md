# Offline pass-phone turns — implementation task list

**Status: PARKED — awaiting later express authorization.** Created October 6, 2026.
**Implementation authorization: NOT GRANTED.** All tasks below are future work.

This README records the requested feature; it does not start implementation. The owner requested that it remain dormant and have no effect on ongoing development.

## Start condition and isolation

- Begin only after a **later message from the owner expressly authorizes implementing offline pass-phone turns**. For example: “Start implementing the offline pass-phone feature described in the parked README.” This quoted example is an instruction template, not authorization.
- “Continue Lootsplit,” unrelated fixes, UI cleanup, routine releases, approval of another feature, elapsed time, and this documentation request do **not** satisfy that condition.
- Keep this plan on `docs/parked-offline-pass-phone`. Do not merge the parked branch, open an implementation PR, dispatch workflows, create an automation, or change application code, dependencies, migrations, tests, release metadata, or build configuration merely because the plan exists.
- The hold applies **only to this feature**. Continue unrelated development under the normal project instructions; no backlog dependency or release blocker is introduced.
- After authorization, start from the then-current `main` on a fresh implementation branch. Copy/reconcile this checklist rather than merging the old parked branch wholesale.
- Record the later authorizing message, its date, and its scope in the table below before checking task 0. Follow that scope for publication, database changes and Android releases; the present request authorizes documentation only.

| Authorization record | Value |
| --- | --- |
| State | PARKED |
| Later owner message/link | Not supplied |
| Authorization date | Not supplied |
| Implementation scope | Not authorized |
| Website / migration / APK publication scope | Not authorized |
| Starting main commit | To be reconciled after authorization |

## Intended result

A DM with an owned, locally saved campaign can choose **Pass phone**, disconnect the Internet, and hand the same device to each player in turn. Players use existing permitted character, inventory and economy screens. Actions save to the DM’s single campaign database. A private handoff screen separates turns; returning to DM tools requires the campaign password.

Keep the current visual theme, five mobile navigation tabs, swipeable informational readouts and **one Multiplayer settings button at the top of the DM Desk**. Use readable summaries, turn/order indicators, save status and activity logs. Do not add another Room/chat/connection shortcut to the Desk.

The feature includes reliable browser offline launch, separately from the already bundled Android interface. It is not restricted to Android. Actual browser/device support must be tested before claiming it works.

## Baseline to recheck before implementation

The design was recorded against main `8a7b5e379077a1690fedee0ae5816a5bd16ed397`; that commit is historical context, not a future merge base.

| Current capability | Limitation to address or preserve |
| --- | --- |
| Owned DM device campaign | Local storage can work after owner verification; fresh offline startup needs a defined owner unlock path |
| Online Turn-based and Live | Server-authorized rooms and handoffs need connectivity; retain both modes |
| Android interface | Capacitor bundles assets; a future APK must contain the new turn engine |
| Website offline reload/launch | Notification worker has no app-shell cache or fetch handler |
| Guest campaign | Memory only; no persistent offline player campaign |
| Linked account character | Some detail/revision lookups still require the account service |
| Reconnect/cloud resume | Explicit user action; never silently merge independent local/server copies |

Read the [original design](../offline-pass-phone.md) alongside this checklist. Recheck each baseline claim against current code before choosing an implementation.

## Source map

Paths are starting points, not promises that their APIs will remain unchanged.

| Area | Files to inspect |
| --- | --- |
| Ownership and device persistence | `src/components/account/campaign-gate.tsx`, `src/lib/quire/db.ts`, `src/lib/quire/guest-storage.ts` |
| Seats and campaign password | `src/lib/quire/table.ts`, `src/lib/quire/seat.tsx`, `src/lib/quire/lock.ts`, `src/components/seat-switch.tsx` |
| Online mode/session lifecycle | `src/components/cloud-table.tsx`, `src/lib/quire/cloud-client.ts`, `src/routes/share.tsx` |
| Local actions and finance | `src/lib/quire/economy-context.tsx`, `src/lib/quire/economy.ts`, `src/lib/quire/commands.ts`, `src/lib/quire/finance.ts` |
| Character sheets and rolls | `src/lib/characters/campaign-client.ts`, `src/lib/quire/character-roll-client.ts` |
| Navigation and readouts | `src/components/shell.tsx`, `src/components/control-panel/desk.tsx` |
| Offline shell and notifications | `public/notify-sw.js`, `src/components/push-notices.tsx`, `src/lib/quire/notify.ts`, `src/routes/__root.tsx`, `vite.config.ts`, `scripts/release-artifact.mjs` |
| Android packaging | `capacitor.config.ts`, `vite.mobile.config.ts`, [Android release instructions](../../../ANDROID.md) |
| Preservation and verification | [Coding manual](../../CODING-MANUAL.md), [feature inventory](../../FEATURE-INVENTORY.md), [development guide](../../DEVELOPMENT.md), `.github/workflows/verify.yml` |

## Ordered execution checklist

Complete tasks in order after task 0. Mark a task complete only when its required behavior is verified; attach commit/test evidence in the execution log. If interrupted, retain completed evidence and resume from the first unfinished task.

### 0. Obtain the later authorization — required before any feature work

- [ ] Receive the owner’s later express instruction naming offline pass-phone implementation and fill in the authorization record. Until then, leave the remaining checklist untouched.

### 1. Recover current state and establish an isolated implementation

- [ ] Read [AGENTS.project.md](../../../AGENTS.project.md), [the coding manual](../../CODING-MANUAL.md) and [recovery notes](../../RECOVERY.md). Reconcile current main, open work, active workflows and live release; do not repeat completed deployments or migrations.
- [ ] Create a fresh feature branch from current main. Inventory owned/guest storage, role checks, all economy writes, linked sheets, backups and worker registrations. Record any differences from this source map.
- [ ] Define the scope and acceptance matrix below before coding. Preserve all existing features and use disposable accounts/campaigns for testing.

### 2. Add a durable local turn model

- [ ] Define a versioned, per-campaign state: enabled mode, character order, round, active character, handoff/active/DM phase and an operation revision. Store it in the owned DM database; extend compatible backup/restore validation where necessary.
- [ ] Specify transitions: DM setup → handoff → Start my turn → active turn → End turn → next handoff. Define round wrap, skipped/deleted characters, reorder, pause, finish, campaign switch and empty roster behavior.
- [ ] Make state transitions atomic and reject stale or duplicate operations. Resolve multiple-tab writers so two tabs cannot spend coins or advance the same turn twice. A failed write must retain the current turn and show recovery guidance.
- [ ] Keep online rooms separate. Inspect `chooseTableMode("local")`: it currently closes a hosted session through the server. Never call it as an implicit offline conversion. Resolve an active room explicitly while online, or block starting local turns until its ownership/session state is safely resolved.

### 3. Enforce ownership, role limits and private handoff

- [ ] Require an owned local DM campaign and an existing/set campaign password before enabling Pass phone. Design and verify cold-start offline owner unlock using established ownership and password protections; never substitute anonymous DM access or a fake account.
- [ ] Keep the same persistent owner database while projecting only the active character’s permitted player seat. Do not create a persistent guest copy, activate guest-memory storage, or grant DM authority through the player UI.
- [ ] Render a neutral handoff screen showing only the next character and Start my turn. Clear the previous player’s dialogs, drafts and private details; guard routes, back/forward navigation, deep links and every mutation, not only visible buttons.
- [ ] Require the password for DM return, approvals, skip/reorder and ending local turns. After reload/force-close, restore the saved handoff/turn without briefly rendering DM controls or private data. Revalidate account/ownership safely on reconnect.

### 4. Reuse gameplay actions with atomic local writes

- [ ] Audit purchases, coin/item gifts, party funds, sheet edits, rolls and payment/loan requests. Use existing prices, stock, permissions, DM rules and ledger semantics; enforce the active seat and operation revision in the local action layer.
- [ ] Correct the local pass-phone transfer path explicitly: the legacy player `giveToPlayer` route can record a deferred gift/report instead of crediting the recipient purse. In this mode, debit and credit the same database atomically and append the existing ledger entries once. Preserve legacy recovery/import compatibility.
- [ ] Review snapshot/apply paths in `economy-context.tsx` for stale-write races. Ensure inventory, balances, stock, finance requests and turn state remain consistent after failed writes, rapid taps or simultaneous tabs.
- [ ] Keep financial submission and review roles clear. Players request approval to spend their character/allowed party coins; the DM reviews in the inbox. Approval debits once, and does not create a shop purchase or invoice to a player. Preserve the DM’s explicit Bank queue tools.
- [ ] Remove hidden network dependencies from local campaign sheets/rolls where needed. Use campaign-local canonical data for linked characters offline; show unavailable account/library services clearly and never overwrite the remote profile silently.

### 5. Integrate settings, readouts and turn controls

- [ ] Offer Local DM, Pass phone, Online turns and Live from the single existing Multiplayer settings entry. Explain which modes need connectivity without duplicating the Desk shortcut.
- [ ] Build DM setup for character order, allowed shops and shared-fund access using existing permissions. Provide clear Start/Pause/Resume/Finish behavior and password-protected review/skip controls.
- [ ] On every player gameplay screen show active character, round, save state and End turn. Use compact visual order/progress readouts and recent-action summaries; retain the existing horizontal information panels and theme.
- [ ] End turn must wait for committed writes and require an explicit choice for unsaved drafts. Failed save/cancel must not advance the turn. Verify touch targets, keyboard controls, focus restoration, screen-reader labels, contrast and reduced motion.

### 6. Make browser offline launch reliable

- [ ] Design one coordinated worker strategy with existing push/notification registration. Preserve notification clicks and chat routing; avoid competing root-scope workers. Keep Android’s bundled interface working independently.
- [ ] Generate a versioned core asset manifest from the actual verified build, including required lazy route chunks, styles, fonts, icons and local roll assets. Provide a public offline shell without account-specific server HTML; exclude API responses, credentials, campaigns, private PDFs and other private data from response caches.
- [ ] Cache only the intended public GET resources and implement explicit offline navigation fallback. Keep authenticated/API requests out of that fallback; optional external references/account services should report unavailable instead of receiving shell HTML.
- [ ] Show **Offline ready** only after all required resources are verified and the worker controls the page. Distinguish downloading, ready, unavailable and failed states. Handle cache quota/storage denial and explain backup/export for possible storage eviction.
- [ ] Retain assets needed by open tabs during updates. Do not force a reload or delete an active turn’s old chunks mid-play; activate/clean up only through a safe update policy. Test interrupted downloads, corrupt/missing chunks and releases with a changed manifest.

### 7. Preserve backup, reconnect and existing multiplayer

- [ ] Include local turn state in owned-device backup/export/restore and campaign isolation checks. Retain password/private-document protections and existing save compatibility.
- [ ] Reconnecting must not automatically upload, overwrite, create a room or merge campaign copies. Offer the existing explicit reviewed backup/upload/resume actions and identify local versus server campaign and revision.
- [ ] Preserve online turn authorization, Live synchronization, invitations, session generations, signed-in/guest access and End session. Local pass-phone must not resurrect revoked invitations or introduce persistent player copies.
- [ ] Handle device switching and sign-out deliberately. Do not claim that clearing or evicting browser storage preserves the offline save; verify recovery from an explicit backup.

### 8. Verify behavior on real build artifacts

- [ ] Add meaningful deterministic tests for state transitions, permissions, duplicate/stale operations, atomic failure and backup compatibility. Extend browser audit coverage and the normal verification manifest without weakening existing assertions or timeouts.
- [ ] Run the offline acceptance sequence below against production-built browser assets and bundled mobile assets, not just a dev tab. Test both airplane-mode operation and a fresh offline launch/reload, with no hidden successful network responses.
- [ ] Run the current quick/account/preservation checks and full required PR/main verification at the appropriate stage. Record actual browser/Node versions and evidence; existing focused commands do not already include an offline-turn scenario.
- [ ] Measure comparable timings and review the persistent [performance procedure](../../PERFORMANCE.md). Log every qualifying increase of 15% or more; keep unresolved trends and baseline history intact.
- [ ] Update help, platform/Internet explanations, feature inventory and the root README only after the behavior exists and is verified. Separate supported-by-design from actually tested devices.

### 9. Release only within the later authorization’s scope

- [ ] Prepare a reviewable feature PR with the concrete before/after behavior, migration implications if any, and validation evidence. Apply required changes only through the existing release gates; this parked checklist grants no production changes.
- [ ] For an authorized website release, preserve exact-head PR/main checks, immutable tested artifacts, serialized main-only deployment and desktop/mobile live audits. If an upload succeeds but live verification fails, reconcile and use read-only checks before repeating any publication.
- [ ] For an authorized Android release, follow [ANDROID.md](../../../ANDROID.md): preserve the permanent signing identity, increment the version code, verify packaged offline behavior and signing/checksum/version, and update download metadata only after the signed APK is verified. A website update does not update installed APKs.
- [ ] Record final commit, test runs, tested devices, release identity and remaining limitations; update Recovery with a precise resume point. Keep unchecked any acceptance case that was not run.

## Acceptance sequence and matrix

Using a disposable **owned** campaign with two characters, permissions, coins, stock and a campaign password:

1. While online, finish any explicit room transition, prepare the owned local save and wait for verified Offline ready.
2. Disconnect the network. Start Pass phone; buy an allowed item, transfer coins and an item, make a permitted sheet edit, record a local roll and submit a payment request.
3. End the first turn, start the second and end it. Confirm the next round, recipient balances/items, shop stock and exactly-once logs.
4. Reload and close/reopen offline. Confirm handoff/round persistence and password-protected DM return; approve the request and verify a single debit.
5. Back up/restore, then reconnect. Verify explicit save/resume choices without a silent merge or unintended room creation.

| Coverage | Required result |
| --- | --- |
| Permission/privacy failures | Denied shop/fund/sheet actions and deep links remain denied; no DM/private-screen flash |
| Unsaved drafts and writes | Cancel retains the turn; failed write changes neither ledger nor order; double tap is applied once |
| Multiple campaigns/tabs | No cross-campaign state and no competing turn/action writers |
| Cache lifecycle | Cold offline launch, missing cache, partial install, quota failure, old-tab/new-release behavior covered |
| Sheets and optional content | Local linked sheet/roll works; unavailable network content is explained; private documents stay device-local |
| Existing online play | Live, online turns, invitations, guest memory, account resume and End session retain current behavior |
| Android | Verify bundled assets and force-close/reopen; physical-device status recorded separately |
| Browsers | Test supported Android/desktop browsers and iPhone/iPad Safari/PWA separately; list actual versions and untested cases |

## Existing commands to use after authorization

Use Node 22 and the then-current manual. These are existing commands, not commands to run while parked.

```sh
npm run dev:doctor
npm run verify:quick
npm run verify:focus -- ownership
npm run verify:focus -- invitations
npm run verify:focus -- accounts
npm run build:cloudflare
npm run build:mobile
```

Run builds/tests with disposable local data as documented. Add the new offline-turn audit to the repository’s verification suite before referring to it as an existing command. Do not run an invented `verify:focus -- offline` scenario.

## Execution evidence

No implementation or feature tests have started. Add dated entries only after authorization.

| Task | Commit / evidence | Result / next action |
| --- | --- | --- |
| Authorization gate | Awaiting later owner instruction | Remain parked |

## Resume instruction for a future coding session

```text
Read this README's Start condition and authorization record first.
If no later express owner authorization for offline pass-phone implementation
has been recorded, leave the feature parked and continue only the unrelated
work actually requested.

If authorization exists, reconcile current main, active work, CI and live state;
read AGENTS.project.md, docs/CODING-MANUAL.md and docs/RECOVERY.md.
Create a fresh implementation branch from current main, reconcile this plan,
and execute the first unchecked task within the authorized scope.
Update checkboxes only with evidence. Preserve owned DM persistence, guest
memory-only access, online modes, campaign data and existing release gates.
This document is a plan; it does not itself authorize implementation or release.
```
