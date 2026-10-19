# Online tabletop expansion — October 19, 2026

Owner-authorized scope: complete online DM/player map play, incremental Maps UI, token permissions and tools, fog/vision, detailed assets/media/imports, canonical encounter/world integration and optional default-off TV output. Preserve every existing capability, navigation, theme, saved record, role, account/guest boundary, financial receipt, campaign clock and supported platform. A layout preview precedes substantial UI changes; independent backend development continues while review is possible.

## Reconciled baseline

- Main/source `1cce8f7383022575dc920d20387f712f00fa858f`, tree `16ed447b575364e5c324f06c2109412972564b82`.
- Complete main verification `38938272606` succeeded. Cloudflare deployment `c884b00b-8d5c-451a-9b2d-14c525062999` serves version `1630d4a5-c4b7-4c4b-b036-d3471d1f7711` at 100%, annotated with that source/run. No open pull requests at baseline.
- Android remains published 1.7.0/code10, from October 12. No new APK is claimed.
- All local tracked source blobs matched the current GitHub tree before modification. The recovered workspace's dangling Git pointer was replaced with a locally reconstructed, hash-verified shallow main tree; the original pointer was retained outside the checkout. Dependencies restored with locked Node22/npm installation.
- Existing Maps and TV behavior is documented in MAP-TILES, FEATURE-INVENTORY and the October 16 audit. It is the preservation baseline, not a new implementation.

## Delivery contract

1. Interactive synthetic-data preview inside this repository, retaining the current themes and six primary tabs.
2. Additive canonical tabletop schemas, exact-state commands and per-seat projection, using existing receipts/sync/turn guards.
3. Map workspace and online token controls, measurements/templates, scene viewing/activation, explicit camera sharing.
4. Saved manual fog, optional walls/doors/lights/vision and protected original versus player presentation assets; never describe a CSS/SVG mask as image confidentiality.
5. High-detail assets/media and strictly reviewed UVTT/map-authoring interchange; canonical encounter/loot/world integration; default-off optional TV controls.
6. Focused permission, geometry, migration, projection and UI evidence, full preserved PR/main/immutable/live gates, both Help guides, inventory/manual/recovery/performance updates and verified release.

## Invariants

- No duplicated wallets, encounters, sheets, inventories, ship records or clocks. Map movement/measurement has no economic, boarding, travel-time or rules-adjudication side effect.
- Private source images and private geometry/records are absent from player payloads and unauthorized asset responses. Player render assets must contain only explicitly published imagery; new visibility calculations cannot override explicit DM secrecy.
- DM preparation, player access and active/presented scene are separate states. Camera synchronization is deliberate. TV controls are optional and disabled by default; ordinary online play is independent.
- Guests retain campaign contents and pending work only in document memory. Existing campaign-scoped cross-window locks, credentials, draft guards and fresh authentication are retained.
- Older Android/client readers use strict map schemas. Add an explicit additive protocol boundary so unsupported tabletop fields are omitted from legacy envelopes after privacy projection; preserve the original source metadata on older writes. Do not silently discard unknown pending map actions. Verify account-resume/archive boundaries as well as ordinary room reads.
- No production campaign is used as a mutation fixture. Main-only immutable publication, recovery fences, CPU/log policy and all nine verification groups remain intact.

Exact evolving commits, tests, runs and blockers belong in the task audit/checkpoint and PR. This document is an implementation contract, not evidence that unfinished items have shipped.
