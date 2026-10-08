# Fantasy submenu backgrounds — October 8, 2026

The user authorized implementation of the free fantasy resource-pack recommendation. Starting main/live `a878d6258a742c54ee76f33c259fe0fcfeda3899`, PR71 and its website/standby releases were reconciled before creating `feature/submenu-backgrounds`. This adds decoration to existing screens without changing campaign, financial, invitation, shop-image or authorization services. Acceptance: a DM opens Market, Journal and Encounters at phone/desktop widths, sees the appropriate day/night scene, keeps readable working controls, and can disable scenery without losing preferences or an unfinished journal entry.

## Implementation and art provenance

Eight pairs from willYEE's [Fantasy Visual Novel Backgrounds](https://willyee.itch.io/fantasy-visual-novel-backgrounds) are dedicated under CC0 1.0. The pack documentation explicitly discloses Krea 2 generation and Real-ESRGAN upscaling. The original license/documentation, source archive hashes, per-image original hashes and adapted-file hashes ship in `public/scenes/fantasy/`; the Resources page credits the creator and links the original source, license and adaptations.

| Scene | Existing screens |
| --- | --- |
| Market street | Market, individual shops, Shop Management |
| Blacksmith | Catalog |
| Dungeon corridor | Encounters |
| Tavern | Party, Characters, Downtime |
| Village square | Campaign, Property Management |
| Ancient library | Library, Books, Journal, Review Reports |
| Mage tower study | Settings, Review Inbox |
| Throne room | Bank, My Finances, Financial Settings |

Original 1920×1080 JPEGs become 768×432 / 1440×810 WebP at quality77: 32 files total1,877,246bytes, maximum108,780bytes/file. `srcSet` requests only the active scene and appearance at the appropriate size. Static decorative imagery never intercepts input and stays out of the accessibility tree. Solid theme-colored main surfaces preserve the established text contrast. The backdrop wrapper remains mounted through preference changes; existing main children and their direct-child layout selectors remain intact. Print suppresses scenery. Existing custom/legacy colors remain plain. Settings → Colors → Show fantasy backgrounds persists in the existing device-preference key, with additive default normalization for older preferences. There is no migration, dependency change or new signed Android release.

## Verification

- Node22.23.3 / diagnostic Chromium133 launch confirmed. Quick verification passed732 tests/four existing skips, clean types, lint zero errors/30 existing warnings in43.293s. Changed-file lint is clean.
- Web build9.152s, Android client build6.820s; both include all32 scenery files. Immutable Worker packaging verified576 file hashes in5.842s. This package predates the final credits wording; CI must rebuild and verify the frozen final source.
- Expanded desktop1280/mobile390 theme browser audit passed all eight decoded scene pairs, actual router links/Return links without a document or opening replay, opaque surfaces matching the contrast-tested theme, no horizontal overflow, static imagery, both appearance controls, retained journal title/text through day/night switches, disable/re-enable/reload and legacy palette persistence. Final run18:56:51.412–18:57:35.643UTC/44.231s. The initial new assertion raced lazy route completion; it now waits for the destination's actual heading before inspecting/capturing the workspace. Earlier failed evidence remains locally; no application behavior or release gate was weakened. Phone light/dark Market and desktop library/dungeon screenshots were visually inspected.
- Local packaged-Worker browser startup was blocked during disposable D1 migration by `fatal library error, lookup self`; the bounded local session was stopped. This is an explicit environment gap, not a claimed Worker browser pass. Complete current-browser PR/main packaged Worker and standby preservation gates remain required. No production campaign actions are used for verification.

Final source, PR, CI, performance-recorder and production read-only audit identities belong in the PR; a local build or merge does not establish a live release.

## Performance reconciliation

Starting read-only history sync retains652 observations/13 resolutions,333 open trends including171 repeated trends, zero stale requests and the older interrupted37642398740. Latest recorder37826164657 succeeded; no new qualifying observations were pending at the start. Existing account installation, finance, navigation and expanded name-import findings remain open. No reference reset or history deletion.

Relevant repeated execution trends remain development-theme13→24s (+11s/84.62%,2 increases), PR Worker-theme13→35s (+22s/169.23%,2) and main Worker-theme11→25s (+14s/127.27%,4). This task preserves original assertions and adds eight real scene/route checks, image decoding, contrast-surface checks, draft preservation and toggle persistence at both widths; record qualifying CI increases under the unchanged operation names and explain the extra workload. Compare case execution separately from runner installation/cache/artifact overhead. The last released complete PR357s/main340s are below the unchanged logged PR920s/main917s references. Historical cumulative workflow trends remain PR220→920s (+700s/318.18%,6) and main205→917s (+712s/347.32%,3).

Local quick43.293s is below its comparable52.084s reference; web9.152s versus8.956s adds0.196s/2.19%; mobile6.820s versus6.259s adds0.561s/8.96%. None crosses15%; references stay fixed. Worker packaging5.842s is below its51.120s reference. The expanded local theme audit establishes its first measured reference; CI timings and subsequent new/unresolved history findings will be reconciled after complete release verification. Parallel checks overlap and are not summed as task waiting time.
