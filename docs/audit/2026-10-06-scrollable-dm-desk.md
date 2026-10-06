# Scrollable DM information desk — 2026-10-06

## Authorized scope and preservation

The user selected the existing Lootsplit style with horizontally scrollable informational displays, allowed removing the main shortcut grid, and explicitly requested retaining a Multiplayer settings button on the DM screen.

- Connection state, encounter status, review counts and Multiplayer settings remain above the information strip. The labeled multiplayer link opens Campaign → Room via AppLink, without a document reload.
- Session, Party, Funds, Activity and Rolls use existing local/shared campaign state. Native horizontal scrolling, arrows and named jump selectors are available. Desktop shows multiple panels; selection can reach the final panel. Campaign switches remount readout state to prevent displaying another campaign's fetched imports or rolls.
- Party summaries retain portraits and sheet HP/AC, unknown-health labels and full-character links. Summaries show up to four characters, four recent events and four rolls; full lists and history remain reachable.
- Funds distinguishes shared purses from all-account coins and goods/property valuations. Session received/spent uses the existing sessionSummary calculation, excluding transfers. No balance history or synthetic gameplay data is fabricated.
- Pending reviews includes financial requests and loaded current-room character imports. Loading/unavailable/offline imports are explicitly labeled instead of silently claiming a complete total. Shared roll reads are room-scoped and abort on navigation; local logs read existing purse rolls. No authorization or mutation endpoint changed.
- Sessions & records and Economy & properties group all eight existing DM feature destinations. The detailed treasury, activity/balances, complete desktop review queue, session controls, dollar preference, campaign manager and backup/restore controls remain available in their existing disclosures.
- The main shortcut grid is removed as authorized. Saved preferences, account API, offline fallback and editor remain available through Settings & Management → Dashboard → Saved shortcut settings. Existing legacy customize URLs still work. The settings dialog now closes when opening that editor.
- Five primary tabs, current themes/art, player Home buttons, account isolation, local/turn-based/live play, save formats, backups and Android signing remain intact. No migration, production-data change, gameplay rule or new signed APK is included.

## Local verification

Node22.23.3, scratch Chromium133, independent empty-database Vite snapshots and synthetic accounts. Standard locked-browser release checks remain required in CI.

- Quick checks: 508 passed, four pre-existing skips; clean types; zero lint errors and 34 existing warnings.
- Web and mobile client builds passed on final application source.
- Control panel: 27.105 seconds on final application source. Exercises native horizontal input, all named/arrow destinations including last desktop panel, multiplayer Room navigation, no title replay/document reload, review/return, session hash, legacy overview, treasury/activity, backups, saved shortcut edit/reorder/loading/persistence, role settings, keyboard focus and phone/desktop layouts.
- Desktop: 56.101 seconds on final application source; full-width layouts from1024–2560px plus320/390/768/1023; player preservation, no root overflow or runtime errors. Mobile and desktop screenshots inspected.
- Library/navigation: 15.850 seconds; actual shortcut/settings route and Library/query/hash/ledger/account links, back/forward and no title replay. This preceded only a readout-context remount and desktop sizing/readiness correction; full CI repeats the final source.
- Finance: 23.082 seconds; creation, preview, consent, approval, reload, repayments and campaign isolation at both widths. Only the grouped feature-opening click changed in that audit.

Initial local failures were stale selectors for the removed grid/current-session label and the secondary settings dialog not closing. These were diagnosed locally and fixed; no release gate was weakened. The shortcut loading regression now uses a real reload, rather than page.goto to the identical URL (which may only navigate its hash).

## Performance review

Read the persistent performance-history branch at e5ba8d14bad0bac16fe6fb2dbdfad79987fa5b17, including state, regression log, baselines and resolutions. Recorder scanAfter2026-10-06T12:55:56.779Z had no pending runs; latest recorder run37472116481 succeeded. History is retained, with no trend reset.

The latest logged comparable local control-panel reference was 21.084s. Final 27.105s adds 6.021s (+28.56%). The new audit adds native scrolling, selectors/arrows and multiplayer clicks, and reaches the retained shortcut editor through settings. The qualifying increase is recorded in performance/manual-measurements.jsonl with the same environment and scope; this is not evidence that a campaign operation is 28.56% slower. No separate production-runtime benchmark was taken. Its timestamps are reconstructed from the retained final log's last write time and measured child duration; the runner retained duration but did not emit ISO timestamps.

Existing open CI trends include development finance17→28s (+64.71%), packaged finance11→19s (+72.73%), full verification220→403s (+83.18%), and website deployment queue4→6780s. Repeated node setup/browser installation and queue delays remain separate from application behavior. The prior control-panel and Library navigation timeout trends have verified resolution records. Continue observing the new exact-head run; do not reset unrelated infrastructure trends or add overlapping job durations.

## Release checkpoint

Baseline main/live e84e24b178df950905b6f716309eabb5371643c4; main verification37453107393 and deployment37453589467 succeeded before this change. Work branch improvement/scrollable-dm-desk. Verified local implementation commit 064e121794b477e944545885d2bd19b48a009ecf.

Automatic approval review rejected the GitHub push because the UI request was not accepted as explicit authorization to publish the code and documentation to that external repository. No push, PR, full CI, merge or deployment occurred for this update. Do not retry through another route. Obtain explicit publication approval, then reconcile GitHub state before proceeding. Exact-head PR checks, main verification, deployment and immutable-asset/read-only live audits remain required.

A real mobile UI capture from the final local audit is available as lootsplit-dm-screen.png for user review. It uses synthetic fixture data, not a live user campaign. The screenshot was saved separately; repository code remains in the existing local Git checkout.

The user subsequently explicitly approved publishing to UnregisteredMusket/Lootsplit and releasing the website after full checks. Before the approved push, recovery status and remote main were reconciled: main and live still match the baseline above. Full release verification is now authorized and remains pending at this checkpoint.

CLI publication lacked GitHub credentials, so the connected integration created source commit 1d603fd1d2c8b4fb054f20d37aead690ee3878f7. Its tree eeb3ca014d358b10e1a71b124793e1455508afea exactly matches the locally tested source; the performance record references that source commit. Only documentation and the measurement reference changed afterward.
