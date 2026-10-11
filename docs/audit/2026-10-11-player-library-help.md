# Player Library, reference access and Help — October 11, 2026

Owner-authorized scope: remove DM setup descriptions from the player Library, provide searchable read-only references with a default encounter restriction and DM controls, ensure player Help exists and stays current, and verify character switching without changing correctly functioning permissions.

Baseline main/live: `b393f887b7201c0f58bc6ee7e1db0e3d99d29594`, tree `f098a7e4fc9c779e239dea2d2941f85f8678c443`. Previous city-exchange deployment `38126334991` is complete and must not be repeated. Work branch: `feature/player-reference-help`.

## Findings and implementation

- Player Open5e search displayed DM catalogue import/shop-price instructions despite hiding mutation controls. It now describes read-only lookup; unknown prices say No listed price. Library has explicit Items/Spells/Creatures destinations alongside Catalog, neutral shared-record/handout descriptions, and no DM books/resource-pack controls.
- Optional `journal.referenceAccess` controls overall enablement, allowed indices and an explicit encounter override. Old saves default to available indices outside active encounters and blocked lookup during encounters. The DM-only `reference-policy` command checks the captured prior policy; old journal replacements retain the authoritative setting. Controls appear in Library and Settings & Management → Players & permissions.
- Canonical private encounter rows supply only an active/inactive RoomView boolean. Normal polling updates it even when encounter changes do not change room revision. Any active encounter blocks lookup; draft/review/awarded encounters and personal account drafts do not. Device activity derives from existing local encounter records and refreshes after committed changes. No duplicate combat state, enemy projection, migration or scheduler is introduced.
- Direct Catalog links and cached results follow the client policy. Campaign searches use POST/no-store and recheck the verified seat/policy before and after source retrieval; denied lookup cannot fall back to cached results. Sheet spell search follows the same restriction. This controls Lootsplit's reference workflow, not independently public websites.
- The in-app guide was mounted only on the DM Desk. Player Home now provides Help; Settings → Help remains. Public Help and the dialog automatically select a separate player guide covering invitations/navigation, assignment/editing/imports, dice, references/encounters, finance/property/downtime, city commodities, maps/NPCs/barter, chat/journals, recovery, appearance and installation. DM Help now covers lookup controls, scanned recognition, placement, reviewed resource packs, default city exchanges, commodity imports and audio.
- Character checks confirm ownership is already enforced for guessed IDs, saves and rolls. Editing grants do not allow control of another player's character. Local DM play permits campaign character selection. Explicitly shared NPC sheets retain read-only access. Character permissions remain unchanged; only spell lookup is gated as requested.

## Preservation and instructions

DM catalogues, private packs/PDFs, source credits, imports, generated names, shared records/maps/handouts, saved player sheets and existing play actions retain their permissions. Lookup restrictions are the owner's explicit exception to default feature availability. Six mobile tabs, themes, title/navigation behavior, atomic finance/inventory, archives/backups/recovery and permanent Android signing are preserved.

Reviewed the complete field guide. Corrected obsolete image-import and account-start claims and added affected recent features. Existing coin/Charisma, manual dice, invitation/session lifecycle, transaction turns, privacy, backups, notifications, diagnostics and web/APK distinctions remain documented. AGENTS.project.md, README and the GitHub coding manual now require both role guides, feature inventory and affected development instructions to be reviewed/updated with every feature before release.

## Verification checkpoint

Focused reference, private encounter, character ownership and Library privacy checks: 23/23 passed on Node22.23.3. The new browser audit preserves every original Help assertion and adds real desktop/mobile read-only searches, DM encounter start/conclusion, direct-link blocks, all/section/encounter controls, shared handouts, assigned-character selection and both player Help entry points. The required Help audit runs it in development and the immutable Worker.

Local dev:doctor: locked Playwright Chromium1243 is absent; existing diagnostic Chromium fails to launch (SIGSEGV). This is an environment blocker, not a browser pass. Full current-browser CI must close the gap. Assertions, deadlines, isolation and retry counts remain unchanged.

Full local quick checks passed: 913 tests (909 passed, four existing skips), TypeScript and lint with zero errors/29 existing warnings. Cloudflare web and Android-compatible client builds passed. Exact PR/main verification, immutable publication and matching-asset/live desktop/mobile audits remain required before claiming live completion. Record actual commit/tree/run identities in the PR and ignored recovery checkpoint instead of repeatedly changing a checked release head.

## Performance review

Focused run `38131342389` reaches the player Catalog in both runtimes with the correct read-only form. Its raw-label locator included nested option text, while the recorded accessible combobox name is exactly Reference section; the audit now targets that observed role/name. The player Settings click explicitly chooses a visible trigger at desktop/mobile widths. Supplemental complete account checks retain independent execution after a reference assertion failure, provided the disposable server started successfully. Source permissions did not change.

Second checkpoint run `38130615045` confirmed Resume deliberately returns to Home; the new fixture now follows the real Library link. The packaged Worker needs Wrangler's disposable D1 store, rather than development's SQLite file. The audit now uses the same local-only Wrangler D1 command pattern as the preserved Worker monitor audit, with escaped bound synthetic values. A one-second toast click exposed normal entry animation in standby ownership; restored the original action deadline and follow the exact observed toast node. Only actual removal of that node permits expiration; a remaining notice still fails.

Diagnosed the local browser's earlier SIGSEGV: its old extraction was truncated (66.9MB versus the ELF's 279MB extent). Re-extraction plus the existing dependency directory restores Chromium150 --version, but actual launch fails because socket() is denied; the dev server also fails on denied network-interface enumeration. No browser pass is claimed. A supplemental focused PR workflow now exercises new references/Help early in both runtimes, followed by the complete 12-scenario account suite; every complete release gate remains unchanged.

First PR verification `38130022245` passed code/builds, development accounts/desktop and packaged Worker accounts. The expanded Help fixture incorrectly assumed a cached DM seat bypassed account campaign choice; it now uses the real Resume button before checking Library controls. The standby trace recorded a success toast at 70191.898ms and its automatic removal at 70209.452ms, while the intervening close click waited 15 seconds for an already-removed element. The fixture now accepts only observed count reduction after a bounded close timeout, and still fails if the notice remains. All navigation, character/account scenarios, network boundaries, aggregate/case deadlines and zero retries remain. Restricted-account/missing-room failures also cannot show cached reference results. Preserve the failed run and perform fresh complete exact-head verification after this batched correction.

Initial recorder state is fresh through 2026-10-11T09:30:30.828Z; only earlier run37642398740 is pending. Read complete current observations/references before freezing the checkpoint and collect PR/main/publication deltas. Preserve earlier trends and every >=15% observation. Encounter metadata reuses normal polling with no new client polling loop. Expanded Help audit work is expanded coverage, not inferred gameplay latency. A faster run does not authorize baseline resets.

Reviewed all 802 stored observations and 17 confirmed resolutions. The 212 still-open repeated trends include runner queue/setup noise, growing preservation coverage and failed checks; none is silently reset. The affected execution and overall waiting-time trends are below (seconds; PR and main are independent scopes):

| Operation | Scope | Original → latest | Added | Increase | Logged rises | Latest evidence |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Development / governance / dev-help | main | 6 → 15 | 9 | 150.0% | 3 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37573238905/job/112636350136) |
| Packaged Worker / interface / worker-help | main | 6 → 9 | 3 | 50.0% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37429247281/job/112156433505) |
| Packaged Worker / accounts / worker-account | main | 25 → 109 | 84 | 336.0% | 6 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37601583790/job/112727426159) |
| Verify preserved functionality | PR | 220 → 920 | 700 | 318.2% | 6 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37745618424) |
| Verify preserved functionality | main | 205 → 917 | 712 | 347.3% | 3 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37769999494) |
| Packaged Worker / interface / worker-help | PR | 6 → 25 | 19 | 316.7% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37389052554/job/112029923814) |
| Packaged Worker / interface / worker-market-locations | PR | 23 → 63 | 40 | 173.9% | 3 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38124502509/job/114426303644) |
| Development / gameplay / dev-market-locations | PR | 38 → 68 | 30 | 78.9% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38016186651/job/114106856170) |
| Development / gameplay / dev-market-locations | main | 27 → 68 | 41 | 151.9% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38016770316/job/114108667453) |
| Packaged Worker / interface / worker-world-features | PR | 14 → 85 | 71 | 507.1% | 5 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38053268126/job/114216749462) |
| Development / gameplay / dev-world-features | PR | 16 → 106 | 90 | 562.5% | 3 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38050056893/job/114207200377) |
| Packaged Worker / interface / worker-world-features | main | 13 → 88 | 75 | 576.9% | 3 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38050722056/job/114209459920) |
| Development / gameplay / dev-world-features | main | 17 → 106 | 89 | 523.5% | 4 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38053941691/job/114218473575) |
| Development / gameplay / dev-trade-economy | PR | 33 → 74 | 41 | 124.2% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38053268126/job/114216533406) |
| Packaged Worker / interface / worker-trade-economy | main | 22 → 68 | 46 | 209.1% | 4 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38076562217/job/114285071255) |
| Development / gameplay / dev-trade-economy | main | 32 → 83 | 51 | 159.4% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38053941691/job/114218473575) |
| Packaged Worker / interface / worker-trade-economy | PR | 39 → 68 | 29 | 74.4% | 2 | [run](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/38125086913/job/114427941214) |

The new observations since the earlier task audit remain: failed Worker market-location fixture 45 → 63s (+18s,40%), built Worker startup 9 → 11s (+2s,22.22%), and successful PR Worker trade audit 57 → 68s (+11s,19.30%). The market failure was diagnosed/fixed in PR94; preserve its failed measurement until an explicit comparable resolution is recorded. Setup changes alone do not establish slower gameplay. World/trade and Help coverage grew across recent features; current full PR/main timings must distinguish that added work from runtime latency. Earlier diagnosed account setup and Retry fixture trends remain archived by their recorded resolutions. This task adds a single bound D1 existence query per room view, with no enemy payload or extra browser polling; latency at production-scale encounter counts is unmeasured. Preserve all thresholds and collect release deltas before completion.

Reviewed the server query against current Cloudflare Workers binding and D1 prepared-statement guidance: request-scoped permission state, awaited parameterized binding reads, `LIMIT 1`, no secret in reference URLs and no-store responses. No runtime configuration or binding changes are required.
