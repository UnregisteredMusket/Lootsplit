# Offline turns on the DM’s phone

**PARKED — not authorized for implementation.** Follow the [implementation README and express-authorization gate](offline-pass-phone/README.md). This feature starts only after a later owner message expressly authorizes it; routine development is unaffected.

Requested October 6, 2026. This is the next gameplay design; the current maintenance update changes navigation/inbox clarity, not the turn engine or offline launch.

## Current behavior

| Capability | Dependency |
| --- | --- |
| DM-owned device campaign | IndexedDB and an already verified owner; local actions can continue offline |
| First sign-in, claiming a save, another-device resume | Account service and Internet |
| Local transactions and device rolls | Device storage and already loaded interface |
| Shared Live or Turn-based room | Server-authorized room, synchronization and network turn handoff |
| Guest campaign | Memory only; no persistent offline player copy |
| Android interface | Bundled Capacitor assets; no remote server URL for the interface |
| Fresh website launch/reload offline | Not reliable: the notification service worker has no app-shell cache/fetch handler |
| Cloud backups, chat, account library, external reference searches | Internet; locally saved content is separate |

Source: `campaign-gate.tsx`, `cloud-client.ts`, `db.ts`, `public/notify-sw.js`, `capacitor.config.ts`, `vite.mobile.config.ts`. Switching a hosted room to Local currently ends the session through the server; never silently repurpose that action as an offline switch.

## Settings and handoff

Keep the single Multiplayer settings entry on the DM Desk. Offer Local DM, Pass phone, Online turns and Live. Pass phone belongs to the DM-owned device campaign; it creates neither a guest copy nor an online room.

1. The DM chooses characters/order, permitted shops and shared-fund access. Preserve existing character edit permissions.
2. Show a handoff screen with the next character and Start my turn. Hide the previous character’s details.
3. Show the player’s existing Home, sheet, inventory and permitted actions, with character, round, saved state and End turn on every gameplay screen.
4. Save actions atomically in the same DM database. End turn checks unsaved drafts and active writes. Transfers credit the recipient in that database rather than creating legacy activity reports.
5. Require the campaign password to return to DM controls. Allow DM approvals, skips, order changes and ending local turns. Reload/force-close restores the handoff/round without exposing the DM view.
6. Keep local activity on that device, with backup/export and an explicit reviewed cloud upload/resume path. Reconnecting must not imply an automatic merge of separate local/server campaigns.

## Platforms and verification

Offline turns do not require Android APIs. Supported mobile/desktop browsers can use IndexedDB and service-worker caching. Reliable website offline launch needs a verified, versioned app shell and required route assets. Cache only public app resources, preserve notifications/title behavior, and show Offline ready only after the assets are available. Browser storage can be cleared or evicted. Android already bundles the shell; a future signed APK must include the new engine and pass its release gates. Website updates do not update installed APKs.

Acceptance: disposable owned campaign, network disconnected, purchase, coin/item transfer, permitted sheet edit, payment request, two handoffs, password return to DM and approval. Verify balances, stock, logs, ownership and round after reload/fresh launch. Cover denied edits, DM access, draft cancellation, duplicate taps, failed writes, campaign isolation, linked-profile availability and backups. Preserve online turns, invitations and End session. Verify Android packaging and browser offline caching separately; validate an iPhone before claiming it tested.

References: [MDN offline operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation), [MDN caching](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching), [Capacitor workflow](https://capacitorjs.com/docs/basics/workflow).
