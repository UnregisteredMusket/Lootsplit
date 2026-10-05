# Invitation destination audit — 2026-10-05

## Reproduction and change

On base `2fa630f431d0e63df2c6f3ed83ecc8b3c40b1132`, the actual player-specific **Copy link** button in a Live room produced `/?as=player#t...`, an offline campaign snapshot. The regression expected `/share?join=ROOM&character=ID` and failed at the path assertion. This establishes a real defect; the user's exact sent link was not supplied and is not inferred.

Shared player links now target the active room and character. Offline links and files remain available with an explicit warning. Existing connections require a foreground room choice, and the destination is validated before leaving. The join panel responds to query changes and back/forward navigation; invitations take precedence over chat/other tab parameters. An unavailable invited character does not fall back to someone else. Dismissal/success clears the room, character and one-use invitation parameters. An in-flight request cannot clear a newer invitation.

Guest, account, Local, Live, Turn-based, native share and manual file/report workflows remain supported. Server authorization, seat assignment, pending-action protections and backup restrictions are unchanged. A DM switching rooms still receives the existing explicit end-session confirmation; no hosted room is silently ended. No real campaign data was used or merged. Older offline links have no trustworthy room identity and require a fresh invitation; they are never guessed into a room.

## Verification

- Failing original reproduction and passing focused invitation scenario, with mobile screenshot inspection.
- Expanded invitation test covers both actual share/copy controls, retained deliberate offline links, two distinct hosted rooms, a player already in the other room, cancellation, unavailable-character protection, same-document and back/forward navigation, correct character selection and confirmed connected destination.
- All seven isolated account scenarios passed locally. The new scenario originally preceded the six existing scenarios during that run; it is now last to match the preservation manifest. Final PR/main CI must cover this order.
- Existing release browser audit passed: fresh invitation, conflicting restored membership, interrupted purchase/reload/retry, desktop/mobile routes and no runtime errors. The conflict assertion now scopes the required dialog.
- Quick verification: 486 passed, four existing skips, clean types, zero lint errors/35 existing warnings. An initial quick run caught the scenario/manifest order mismatch; the test was moved to match, and the full quick command passed.
- Final exact-head PR verification, main verification, immutable deployment and read-only live identity/assets/desktop/mobile checks are required. See the linked PR for their results; this checkpoint does not establish a release. Android compatibility is checked, but no APK publication is claimed.

## Performance analysis

Read-only history sync at this task found 222 preserved regressions, no new observations since PR #39, no pending runs, and recorder `37281333853` successful. The capture cursor was `2026-10-05T08:04:09.140Z`. All 49 repeated open trends remain open.

Priorities carried forward: PR account development 57→101s (+44s, +77.19%, two increases), PR packaged account 22→50s (+28s, +127.27%, three), main account development 59→85s (+26s, +44.07%, two), main packaged account 25→48s (+23s, +92%, three), and PR standby audit 28→51s (+23s, +82.14%, two). Earlier audits added portrait/account coverage; this update adds a seventh invitation scenario on every supported server. Separate increased work from a runtime regression; inspect per-scenario execution and runner setup before optimizing. No diagnosed performance fix or baseline reset is claimed.

Previous comparable end-to-end CI totals: PR 220s (`37280342384`), main 224s (`37280755805`), deployment 106s (`37281139424`). Final PR evidence must report new elapsed totals, differences and percentages, and review every new >=15% log entry. Local seven-scenario scope is different from the prior six-scenario baseline; do not present that comparison as a speed gain/regression. Overlapping jobs are not added together. Record the final focused invitation audit as a new local scope, then preserve qualifying future increases against its last logged duration.
