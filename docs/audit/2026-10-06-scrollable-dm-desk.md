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

The latest logged comparable local control-panel reference was21.084s. Final27.105s adds6.021s (+28.56%). The new audit adds native scrolling, selectors/arrows and multiplayer clicks, and reaches the retained shortcut editor through settings. Record the qualifying increase with that workload explanation; this is not evidence that a campaign operation is28.56% slower. No separate production-runtime benchmark was taken.

Existing open CI trends include development finance17→28s (+64.71%), packaged finance11→19s (+72.73%), full verification220→403s (+83.18%), and website deployment queue4→6780s. Repeated node setup/browser installation and queue delays remain separate from application behavior. The prior control-panel and Library navigation timeout trends have verified resolution records. Continue observing the new exact-head run; do not reset unrelated infrastructure trends or add overlapping job durations.

## Release checkpoint

Baseline main/live e84e24b178df950905b6f716309eabb5371643c4; main verification37453107393 and deployment37453589467 succeeded before this change. Work branch improvement/scrollable-dm-desk. Local source is verified; exact-head PR checks, main verification, deployment and immutable-asset/read-only live audits remain required. Inspect current GitHub state before retrying any publication.
