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
