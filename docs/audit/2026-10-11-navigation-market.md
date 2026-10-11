# Application controls and DM market display — October 11, 2026

## Scope and findings

The owner requested a complete application link/button audit and global market data in the scrollable DM information display. Base main is `187a9d81d9f7185bd4d04e0e1504f2335a74ca84`, tree `3b76345f46f00cebbbc223aa14570be0c224a1e1`; the previous map/tile and manual-initiative releases remain intact. Existing website release authorization persists. No migration, new dependency, account protocol change or distributed APK is required.

`node scripts/control-inventory.mjs` inventories every TSX declaration: **846 controls**, comprising **515 buttons** (208 native, 307 shared Button), **278 links** (50 anchors, 96 Link, 132 AppLink), and **53 forms**. Review covered click/pointer/keyboard handlers, form submission, generated destinations, disclosure/modal controls, disabled/read-only conditions, native downloads, hash targets, route/search state, role projections and return links. Eleven buttons without their own action handler are intentional: nine submit their form and two use the underlying Radix cancel action. No disconnected action handler was found. Declaration counts include wrappers and conditional/generated entries; they are not a claim that every possible saved-data/permission permutation ran in a browser.

| Misleading control or behavior | Corrected destination/behavior |
| --- | --- |
| DM Review requests; legacy review hash | Review inbox, instead of the Bank payment form |
| Recorded holdings | Party's Funds pane, instead of its character pane |
| DM Economy rules | Financial rules, instead of general Settings |
| Property guidance: market locations | Market locations, instead of shop schedules |
| Combined shop/property management entry | Separate Shop schedules and Property management destinations |
| Requests & approvals in Management | Review inbox |
| Profile/security/cloud-backup entry | Separate profile/security and cloud-backup sections |
| Authorized staff tools | The permission-gated account administration section |
| Room permissions and turn management | Explicit Room tab |
| Saved DM Character Sheet shortcut | Character sheets; stable saved shortcut ID retained; player's assigned-sheet shortcut retained |
| Feature Return link from Encounters, Library, record pages or Help | Actual original screen, preserving safe query/hash context |
| Hash-only AppLink such as approving downtime at Play sessions | Current feature's hash, preserving document and opening its disclosure |
| Catalog index links during same-route navigation | Query changes update the addressed pane and reference index; obsolete results clear |

The bad Encounter return origin was reproduced against the original helper before modification. Safe-return validation still rejects external, protocol-relative, backslash, unknown and oversized destinations. Return-context recursion is removed. Shared AppLink preserves TanStack navigation and adds a validated origin only for feature destinations without an explicit origin. Internal route inventory tests reject missing literal route targets and document-reloading internal anchors. API/download/external endpoints retain their appropriate behavior.

## Market readout and preservation

The DM Desk has six information panels: Session, Party, Funds, **Market**, Activity and Rolls. Market reads canonical campaign journal/realm data through the existing economy context. It displays season, enabled/mode state, inflation, exchange and active-quote counts, party city access, and three current commodity quotes ordered by largest recorded price change. Each quote shows exchange, unit, ask/bid, stock, demand and the prior-season comparison (or an explicit missing-history message). Links open the full global market or the exact exchange/commodity, plus commodity configuration. Loading and empty markets have explicit states.

The panel includes the DM's closed/private exchanges with labels. This readout creates no remote trading access, stock, money, seasonal history, location mutation or duplicate economy. Existing global-market city ancestry and open-exchange rules remain authoritative. Players receive their existing location/permission-filtered Market and no DM information strip. All five prior readouts remain reachable; dimensions, scroll selectors, mobile/keyboard behavior, saved shortcut IDs and permissions remain supported.

No campaign schema/version, IDs, journal history, backup, room command, property storage, ship travel, map tile, encounter turn/initiative, account ownership or transaction behavior is replaced. Existing controls and forms keep their authoritative handlers. New navigation fixtures operate only on disposable loopback data and deliberately reload only during prerequisite hydration, before assertions. Each actual navigation click asserts the same document marker and absence of the title screen; helpers never dismiss a replayed title.

## Verification and coverage

Local verification: **958 tests, 954 passes, four existing skips**, clean types, lint **zero errors / 30 existing warnings**, and successful web/mobile builds. Static/unit regressions cover literal routes, safe origins, query/hash preservation, DM/player saved shortcuts and complete workflow assignments. The inventory is retained under ignored `test-results/navigation/source-controls.json`.

Local browser execution is blocked by this workspace: apt `setgroups/seteuid`, invalid standard Chromium ZIP downloads, diagnostic Chromium SIGSEGV, and Vite `uv_interface_addresses`. These are not browser passes. Required current-browser development and immutable packaged Worker verification must close the gap before merge/release. No release gate, original scenario, account deadline (60s case/170s suite), two-worker limit, zero-retry policy, network isolation or native/fallback checks were removed.

The added navigation audit clicks DM/player primary navigation, every grouped DM feature, all management categories and their links, Library tiles, saved character shortcut, treasury links, market and exact commodity links at 390/1280px. It asserts addressed panes/records, city versus wilderness access, same-document title behavior and no horizontal overflow. Existing full audits cover the remaining data-dependent controls:

| Area | Preserved browser/permission coverage |
| --- | --- |
| Accounts, private backups, invitations, campaigns | All 12 account scenarios; ownership, recovery, portrait, network boundary, administration and governance |
| Desk and player Home | Control-panel, shortcuts, all information panels, mode/seat and new navigation audits |
| Party, character sheets, dice, trade and finance | Character, world, finance, commerce, governance, atomic transaction/receipt tests |
| Shops, global economy and properties | Stock/import, locations, trade economy, property operations, rights and ledgers |
| Encounters, maps and ships | Encounter/device/account, explicit initiative, map tiles, ship travel, authorized commands and projection privacy |
| Library, books, reference, sources, Help | Library identity/navigation, resource/reference, private PDFs, player policy and both Help audits |
| Public website/downloads/resources | Website, release, staff, readiness/bundle hashes and read-only live desktop/mobile audit |

Fresh exact-head all-nine PR and main gates, immutable website publication, standby and read-only live checks remain required. Evolving source/tree/PR/run/live evidence is checkpointed in the PR and `test-results/recovery/navigation-market.json` rather than claiming future success here.

### Local verification and approval recovery

Final local quick verification passed at source `fbb3b5388573a7e2c406db14faa11e393770ce90` (tree `e0bf0739aaa634bf906fa43739454929caf70bb0`): 958 tests/954 passes/four existing skips, clean types, zero lint errors/30 existing warnings. Web and mobile build processes exited zero. The focused eight navigation/shortcut tests passed in **1046ms measured wall time**, `2026-10-11T18:39:39.228Z` → `18:39:40.274Z`; this new scope has no comparable earlier baseline. Its initial measurement is preserved in `performance/manual-measurements.jsonl`, with a real local source SHA; its GitHub source link becomes available only after publication. Final quick verification ran `18:41:42.185Z` → `18:42:26.544Z` (**44359ms**); it is not compared to another workspace or different test coverage.

Automatic approval review rejected `git push -u origin improvement/navigation-market-readout`: it could not verify authorization for the destination. A read-only Personal Context check retrieved the user's prior repository-specific push/publication approvals. Retrying the same push after that evidence was also rejected, explicitly because the reviewer does not accept retrieved prior approvals as trusted user-authored authorization in the current transcript. No alternate publication tool or indirect execution may bypass that rejection. **No PR, new full CI, merge or release exists for this task.** Finish unaffected local work and request explicit approval for publishing this concrete update to `UnregisteredMusket/Lootsplit`, followed by full checks and website publication only after all gates pass. The production identity read also returned HTTP403 in this workspace; no fresh live verification is claimed.

## Help and instructions reviewed

Reviewed both role guides, public/in-app Help routing, feature inventory, README and coding/recovery manual. DM Help now describes all six readouts, canonical market data, exact commodity links and city prerequisites. Player Help explains its existing location-filtered Market; it contains no DM configuration instruction. Account, session, property, ship, encounter and map restrictions remain unchanged. Website features enter an Android APK only through a separately signed verified distribution. No new third-party resource is integrated.

## Performance history review

Fetched the exact persistent history snapshot `0aa6e032df4db019ded310320bd354f29371beff`: **866 observations, 17 resolution records, 394 open trends, including 228 repeated trends**. Latest recorder [38160145060](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38160145060) succeeded. Cursor is `2026-10-11T16:41:49.659Z`; older pending run `37642398740` remains explicit. There are no newly logged observations since the preceding initiative audit's same snapshot. [Complete open-trend review](2026-10-11-navigation-performance.json) retains all scopes, IDs, outcomes, original/latest timings, added time, percentages and evidence links, including single increases. Categories: 7 queue, 167 setup/cache/artifact, 175 execution/coverage, 9 deployment/readiness and 36 overlapping aggregates.

Latest signals from main [38155531326](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38155531326):

| Operation | Last logged → current | Added | Increase | Assessment and next action |
| --- | --- | --- | --- | --- |
| dev-ships | 36 → 46s | 10s | 27.78% | First increase; ship audit unchanged in initiative task. Runner variance is an inference, not a confirmed cause. Profile repeated comparable execution if it persists. |
| dev-local-encounter | 7 → 10s | 3s | 42.86% | Cumulative 6 → 10s across two rises: +4s/+66.67%. Added real initiative entry, sorting, turn and reopen coverage is confirmed workload growth. Compare the same expanded scenario set. |
| dev-trade-economy | 83 → 100s | 17s | 20.48% | Cumulative 32 → 100s across three rises: +68s/+212.5%. Expanded prior coverage is known; protocol/runner causes remain unprofiled. Inspect per-step traces before changing production logic. |

The largest historical single unresolved aggregate is a cancelled backup run, 21 → 12154s (+12133s/+57776.19%); this is interrupted infrastructure execution, not measured UI latency. Largest repeated signals include website queue 4 → 6780s (+6776s/+169400%, two rises), main Chromium setup 21 → 881s (+860s/+4095.24%, four), main gameplay 145 → 911s (+766s/+528.28%, three), PR governance 160 → 921s (+761s/+475.63%, five), PR Worker accounts 85 → 810s (+725s/+852.94%, six), main full verification 205 → 917s (+712s/+347.32%, three) and PR full verification 220 → 920s (+700s/+318.18%, six). These historical references include failed runs and growing coverage; they remain open. Separate queue/setup from scenario execution, prioritize repeated execution/aggregate increases, and use existing per-scenario artifacts for diagnosis. Do not sum parallel jobs as wall time or infer user-facing latency from CI durations.

Last completed release timings were PR737s/main740s/site108s; the preceding map release was PR736s/main674s/site119s. Main verification rose 66s/9.79%; PR rose 1s/0.14%; site fell 11s/9.24%. This compares complete successful workflows, not every historical threshold. New navigation coverage intentionally adds work to desktop/interface groups and leaves the already-long gameplay assignment intact. Current release timings will be recorded automatically and reviewed in the PR checkpoint. No diagnosis/fix/comparable-resolution is established by this navigation work; **no history is deleted, hidden or reset**.

Publication approval was explicitly granted by the owner on October11 in this conversation. The approval blocker above is historical and resolved. A normal git push then failed for unavailable credentials, so the connected GitHub publisher created source `842322fd15262bd652614fa4daed4774d09ed4b4` with exact matching tree `e0bf0739aaa634bf906fa43739454929caf70bb0`. Its content is identical to the measured local source; the performance entry now links this real published object. Full exact-head CI and publication remain pending and will be recorded in the PR checkpoint.

Initial PR99 verification [38166093163](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38166093163) passed code/build, full development accounts and standby. It diagnosed three audit defects: governance still expected Home after a nested property return (now correctly My Finances); the new inflation-slider locator omitted the current value included in its accessible name; the added finance matcher import incorrectly named an uninstalled package. Fixed the expected exact return/heading/path, match the actual slider name, and import from the locked `playwright/test` entry point. All original financial/governance checks and deadlines remain. Both Worker failures confirm these same defects. Source application code is unchanged. Current-browser development/Worker completed45 exact mobile navigation actions with no page errors before the bad slider locator; the market image and full Financial Settings failure image were downloaded, SHA256-verified and inspected. The market presents correct city access, canonical ask/bid/stock and recorded +30.00% change; the slider is present. Require fresh full exact-head CI for the corrected audit source.

Second run [38166556354](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38166556354) exposed an actual nested feature return loop: a Return link to My Finances was being treated as a new forward link and acquired a reverse origin to Properties. The feature footer now explicitly marks `returnLink`, so it preserves the validated target without adding a reverse origin. A direct unit regression covers this full forward/return sequence; governance retains the real property → My Finances → Home clicks and original feature/financial assertions. The second navigation failure is a locator issue: the native reference selector is correctly on Creatures in the accessibility snapshot, but label matching includes nested option text. Use the existing role-based combobox locator and still assert its exact value. Both development and Worker report the same issue. No deadline or assertion was dropped.

After the loop fix: full local verification959tests/955passes/four existing skips, clean types, lint0errors/30existing warnings; sequential web/mobile builds both exit0. Focused navigation/shortcut tests9/9 pass. Require fresh full CI on this final source. Performance snapshot refreshed to `3a3969e80ec81666cbed817d0b156b9948520afc` after the first runs; observations remain866 with no new qualifying slowdown. These failures and timing artifacts stay retained; no history/reference is reset.
