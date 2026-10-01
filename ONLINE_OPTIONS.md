# Online connectivity review — October 1, 2026

These are recommendations only. No external naming, catalog, push, or realtime service was added in 1.1.1.

## Backup decision

Retain one device-backup system. Three separate implementations would be redundant. Local mode backs up this browser's campaign; Turn-based and Live refresh the shared state first and require the current user's pending actions to be resolved. Pending-action exports serve a different recovery purpose and remain separate. A player's file is not a complete DM campaign backup. Full campaign loading is a DM action and requires leaving the shared room; it restores a local campaign, not a room code, participant connection, or shared revision history. Existing downloaded snapshots remain exportable even if the room is unavailable.

Synchronization is not versioned backup: it propagates edits, including mistakes. A downloadable snapshot remains useful in every mode. Browser snapshots can disappear when site data is cleared, so file download is the durable user-controlled copy. No unattended background-download system was added.

## Recommended options

### 1. Optional fantasy-name generation — strongest content improvement

Current code has 30 first names, 20 surnames, 15 places, and four shop titles per shop category; custom lexicon entries are already supported. Repetition is primarily a small-pool problem, so expand local procedural vocabulary even if an online option is later approved.

Cuename's published developer documentation describes a free, keyless JSON API with procedural categories, batch generation, reproducible seeds, and a documented limit of about 100 requests per minute per IP. It includes category discovery. Treat it as a candidate, not a verified production dependency: no service reliability or naming-quality benchmark was performed.

Proposed UI: optional Online suggestions beside the existing shuffle, with a chosen naming style, separate shop/keeper/place choices, and the ability to retain fields already liked. Request batches, cache suggestions, avoid recent duplicates, and immediately fall back to local names on timeout. Send only the category/style requested, not campaign files. Custom Etharis regional names would need curated local lists; generic fantasy output is not canon.

Source: https://cuename.com/developers

FunGenerators is an alternative with category-based name generation and API-key authentication. Its published entry paid plan is $9.99/month for 1,000 calls, five names per call, at review time. This seems unnecessary for a small private party unless quality testing justifies it.

Source: https://fungenerators.com/products/documentation/namegen

### 2. More efficient shared updates — strongest functional improvement

The current app polls complete room views every two seconds. First consider revision-only checks/delta updates and polling less while backgrounded; these can improve the existing design without a new provider. A later WebSocket-based room service could deliver stock, messages, and turns immediately, with reconnect and polling fallback.

Cloudflare documents Durable Objects as WebSocket coordinators suitable for multiplayer rooms, with hibernation support. This requires additional hosting bindings/service support that has not been verified for the current Sites deployment. It is an architectural option, not a switch already available in this app.

Source: https://developers.cloudflare.com/durable-objects/best-practices/websockets/

### 3. Optional equipment and magic-item lookup — useful catalog expansion

Open5e offers a versioned API with search, source-document filters, and equipment/magic-item resources. Proposed UI: Search online → preview → explicitly add selected items to the local catalog. Cache imported records; never let an online lookup silently change existing shop prices, campaign modifiers, or homebrew rules. Retain source attribution and check each selected source's reuse terms before importing content at scale.

Source: https://open5e.com/api-docs

### 4. Opt-in turn notifications — useful for asynchronous groups

Browser Push can receive server messages even when the application is not in the foreground, using a service worker and a push subscription. A turn notification could include a link to the app. It requires permission, server delivery, subscription maintenance, and mobile-browser testing. Keep notification text generic rather than exposing private purchases or messages. Defer if the group mainly plays together with the app open.

Source: https://developer.mozilla.org/en-US/docs/Web/API/Push_API

## What to skip for now

Do not replace local backup downloads with another cloud-storage provider. Do not make shop creation depend on an internet name service or pay per shuffle without a clear quality benefit. Live real-world currency/price feeds would conflict with the app's DM-controlled fantasy economy. A full character-sheet or virtual-tabletop synchronization layer would add significant scope beyond party funds and shop management.
