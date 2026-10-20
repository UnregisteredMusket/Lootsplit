# Maps workspace reorganization

The owner explicitly approved the Project Zomboid Map layout as the visual/interaction template and authorized implementation through verified website publication. Baseline main9ec0eca1d279cc34cec1d91d00b436e3c98dc617, PR112 complete/live; all-nine main39360883040 and read-only live39362526313 passed, Worker7e3ade1d-ac81-4f1d-9f10-08eaed48fa21. No prior deployment or account recovery is repeated.

Reference inspected interactively: https://projectzomboidmap.com/#10990x9612x14. Desktop1363×936: canvas fills the viewport; title capsule14px from top/left, top-centered search,46px circular menu, right-side46–48px tool groups, expandable horizontal drawing strip, translucent rounded settings overlay. Search returns typed location results. Original game artwork/branding/ad systems are not integrated. Local reference screenshots are retained under test-results/map-workspace/reference. Narrow layouts require verification; browser zoom did not change the reference viewport. Scaffold-referenced design-ui/building-games skills are absent after searching the workspace; established components and the owner's explicit reference govern this work.

| Existing capability | New destination |
| --- | --- |
| Map selection, types, import/edit, location management | Settings → Map library/setup |
| Connected parent/default/entrances and exact record placement | Settings → Connected maps; placement hotbar action |
| Saved/shared camera, access, session activation, optional TV | Settings; explicit play/scene actions |
| Pan, select/move, ping, measure, templates, fog, walls, lights | Direct floating hotbar and contextual strip |
| Exact token forms, inspector, grid calibration | Settings and inspector; grid display on hotbar |
| Markers/anchors/party movement/register | In-map Settings and contextual placement panel |
| Canonical services, encounter tracker, loot/return | Existing overlay panels, retained APIs and draft guards |
| All six app destinations and account/campaign controls | Floating app navigation; Back to Lootsplit |
| Original import/editor and protected media | In-map editor with preserved import/draft controls |

Personal last-map/camera state is scoped by account, campaign, room and role/characters; guest state stays memory-only. Permission-filtered maps always constrain restoration/search. Viewing never activates scenes, advances time or changes canonical locations. Native browser chrome is optional; Maps itself always fills the viewport. Android1.7.0/code10 remains unchanged.

Implementation in progress on improvement/map-workspace. Exact source/run/test/live state belongs in PR metadata and test-results/recovery/map-workspace.json. Full current-browser PR/main gates remain mandatory. Account60s/170s/two-worker/zero-retry and all preservation assertions remain. Starting performance history1107 observations/17 resolutions; previous cold account167.8s headroom remains open. No performance trend reset is justified by this task.

## Local implementation checkpoint

The real-component preview at1363×936 and390×844 showed no runtime errors or page overflow. Floating controls follow the measured reference placement; zoom contrast and overlay stacking were refined from screenshots. The connected-map browser fixture passed both1280px and390px with canonical shop purchase, confirmed deletion cancellation, exact record placement, battle-grid navigation, encounter start/conclude/return, camera return, new search, route/reload restoration, retained Settings drafts, personal drawing/text undo/redo, six destinations and interface hiding. Additional deleted/revoked-map cases are being integrated. The expanded full map/world preservation audits remain in progress; old scenarios/assertions are retained through their new visible entry points.

`verify:quick` at this checkpoint passed394 script tests (four intentional skips),597 app tests and55 app-data/auth tests, TypeScript and ESLint (zero errors,40 existing/current warnings). Three new pure camera/state tests cover identity separation, valid fallback, malformed storage and memory-only guests. Fresh final-source local/CI verification remains required.

Deliberate adaptations: parent/connected scene controls use actual map relationships, not invented floors. Drawing/text notes are personal device annotations; canonical shared/DM markers remain the shared campaign annotation path. The viewer uses browser page dimensions and does not request native fullscreen. Browser address bars and keyboards remain browser-owned. The available reference browser exposes no viewport-resize control, so reference screenshots are desktop; Lootsplit itself is tested at desktop,390px,320px and844×390 landscape. No game content or reference imagery is included in the release.

## Preservation and performance review

The final local quick check passed394 script tests (four intentional skips),597 app tests and55 app-data/auth tests; TypeScript passed and ESLint reported zero errors/39 warnings. One earlier local invocation omitted the documented NODE_NO_WARNINGS setting; the injected environment-proxy warning broke an unchanged CLI JSON-stderr assertion. The corrected environment passed without changing that test. Full browser preservation is still being completed before PR submission.

Visible-flow refinements found by the retained audits: fit/pan a corner token before clicking it, close the inspector before using the canvas, close template/fog options while keeping the tool active, and anchor animation/loading controls to the viewport rather than the transformed image. Template controls use compact paired fields. These retain the original token movement, measured distance, template persistence, pixel-alpha fog, undo/redo, protected media and financial-history assertions. Search suppresses inferred locations overridden by explicit placements, including hidden placements. Connected-scene menus respect entrance visibility.

Performance history was refreshed during this audit:1107 preserved regression observations,17 resolution records,zero newly qualifying observations since the starting snapshot,one historical pending run37642398740. Recorder39371790468 succeeded on2026-10-20 at04:51UTC. No history was cleared and no reference reset is claimed. The unresolved main map audit trend is35s→145s across three logged increases (+110s,+314.29%); its latest step was122s→145s (+23s,+18.85%) in39360883040. PR map auditing is35s→140s across four increases (+105s,+300%); packaged PR map auditing is20s→115s across three increases (+95s,+475%). These scopes accumulated connected-map, protected-media and player-display coverage, and this change adds restoration/search/draft/deletion/revocation coverage. Preserve comparability and record new qualifying durations rather than masking this additional work with a renamed gate. Main desktop job598s→698s (+100s,+16.72%) and packaged-account job513s→607s (+94s,+18.32%) are unresolved elapsed-job observations; parallel jobs are not summed. Cold account167.8s remains close to the170s aggregate bound. Its scenarios, independent network-boundary check, two workers and zero retries remain unchanged. Final PR/main run timing and recorder analysis belongs in the release checkpoint.
