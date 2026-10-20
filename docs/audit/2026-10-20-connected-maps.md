# Connected maps implementation — October 20, 2026

Status: implementation in progress, not released. Authorized plan: [Connected maps](../plans/CONNECTED-MAPS.md).

Baseline: main25b77d14c40450c4c4b8e70b69395182434274fb; remote/live readback matches. Earlier fullscreen release is complete. Android1.7.0/code10 remains unchanged.

Acceptance flow: regional settlement → local map → separately placed forge → canonical commission → close to unchanged camera → linked encounter/battle map → review loot → return to local map. Validate desktop/phone, role/fog restrictions, legacy envelopes, stable IDs/revisions and retry receipts. No browsing action moves the party, spends resources or advances time.

Both role Help guides, feature inventory, map guide, README/manual and performance history will be reviewed before the final feature freeze. Full preservation gates remain required. Exact ongoing evidence is kept in the PR and ignored recovery checkpoint.

## First integrated checkpoint

Implemented optional connected-map metadata, canonical per-map record references, explicit defaults/entrances, containment validation and target/fog projection. Protocol2 retains the previous tabletop protocol1 and older APK envelopes; old map/journal writes preserve new metadata. Exact placements suppress inherited anchors without disclosing concealed coordinates or labels. Maps keep the fullscreen frame mounted, preserve cameras, expose breadcrumbs/back/scene selection and retain activation as an explicit action.

Shop content is extracted unchanged into a reusable component; original routes remain. Lazy map panels reuse NPC dialogue/barter, smith services, owned-property operations, listing purchase review, postal correspondence, exchanges, ships and existing character-to-NPC training. Handouts and journal links retain canonical records. Private/read-only/presence checks remain in the service engines.

Encounter transitions persist a private preparation with stable encounter ID/revision, reviewed grid, destination and return camera before starting. Retry reads the canonical encounter and only finishes activation when it has already started. Grid/theatre presentation is explicit and separate from independent cameras. A seat-authorized, no-store map HUD projects only lifecycle, round and a visible token identity, with a fresh room/seat/visibility recheck after reading the private tracker. The existing tracker and one-time loot review are reused in a lazy panel.

Focused connected/tabletop/transition tests:23 pass; TypeScript passed before the latest minor presentation edits; targeted lint0errors/one hook-dependency warning to resolve. The synthetic design preview passed desktop/phone flow checks. First real desktop flow passed linked fullscreen navigation/camera return, canonical shop purchase, battle-grid browsing and separate shop placement. Diagnosed and corrected navigation stack handling, a pre-DOM browser fixture override, image-bound phone placement coordinates and a native-select accessible label. The complete focused desktop/phone flow, now including encounter start/conclude/return, is in progress on a frozen source copy. These are development checks, not release claims.

Remaining: inspect the focused results and visuals; add shared-room combat privacy/authorization and retry coverage; complete role Help/documentation/performance review; run all existing quick/build/browser/full PR/main and publication/live gates. No production data was used as a mutation fixture.

## Integrated verification checkpoint

The focused desktop1280/phone390 flow passes in21.618s with zero page errors: linked fullscreen navigation and camera return, existing purchase command, battle grid, two separately placed shops, saved encounter start/conclude/return. The phone encounter panel now reserves the floating map controls' space; draft navigation guards include the tracker. Readback checks campaign/encounter authority after every retry read. Connected/combat plus real shared-room tests pass39/39, including duplicate preparation receipt, hidden/fog-covered enemy, wrong campaign, inactive presentation and revoked token. Both role Help guides, feature inventory, map guide, README and manual are updated. Original standalone service screens and all prior browser assertions remain.

The first quick-check attempt was blocked by the managed host's experimental HTTP-proxy warning contaminating a CLI test's JSON stderr. This is an environment-only diagnostic; the documented `NODE_NO_WARNINGS=1` local profile is used for the rerun, without changing the test or production application. The source audit runner keeps the normal CI environment and original gates.

## Performance review before release

Latest recorder39355644461 succeeded at2026-10-20T01:50:39Z. A fresh `performance:sync` reports1092 observations,17 resolutions,zero added observations and no stale resolutions. The cursor remains2026-10-19T22:15:30.338Z because later catch-up runs found no eligible new work; pending37642398740 remains visible rather than silently discarded. The four observations since the prior audit's1088-row source checkpoint are:

| Run | Operation | Previous → measured | Added | Increase | Assessment / next action |
| --- | --- | --- | --- | --- | --- |
|39328485877|Player-reference initial queue|38s →124s|86s|226.32%|Queue delay, not application execution; retain history.|
|39329870802|Development desktop browser installation|23s →33s|10s|43.48%|Dependency/setup variance; compare final CI setup separately.|
|39329870802|Packaged interface Worker startup|10s →12s|2s|20%|Short startup measurement; retain and compare final run.|
|39331912265|Packaged accounts finance audit|34s →41s|7s|20.59%|The prior release corrected real campaign-switch fixture navigation; expanded actual workflow cost remains recorded. Verify current full finance audit.|

All four operations succeeded. Earlier unresolved map growth (development56→102→120s cumulative114.29%; main55→122s and packaged44→95s), account cold-start headroom (166s of unchanged170s limit), navigation125.872→160.656s (+27.63%), finance/encounter and setup/cache trends remain open. The new connected-map flow adds preserved coverage to the existing map audit; compare execution and overall workflow/job times separately from setup/queue. No unrelated trend has a proven fix in this change and no reference is reset. The new HUD omits archived-report projection because it returns only the current authorized map status. Diagnostic Chromium153.0.8010.0 is not comparable to the locked153.0.8010.12 baseline; final exact-head CI remains required. Keep all historical entries and inclusive15% recording.

Quick checks pass1,047 tests (1,043 passed/four existing skips), TypeScript and lint0errors. The one newly unused lint suppression was removed; remaining30 warnings predate this work. Measured local quick checks65.254s; web build7.684s and mobile build6.552s both pass. Existing full browser preservation plus final exact-head PR/main verification remain pending.
