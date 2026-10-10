# Shared campaign response recovery — October 9, 2026

## Report and confirmed cause

The user reported `Cannot read properties of undefined (reading 'userId')` while importing a location hierarchy and supplied a screenshot of the same exception during Save. The investigation started from clean main/live `73c84e1724a1b4577d3c1c7f8ea402a84d7365e4`; work is isolated on `fix/location-import-response`.

Executing the actual original `accept()` function with an undefined response reproduced the exact exception before changing application code. The shared import path runs `queueCommand → refresh → accept` before retaining a new action. Campaign backup capture also calls `refresh`. The CSV parser and hierarchy preview do not read `userId`.

An isolated experiment with the installed TanStack client confirmed that an ordinary JSON response without the expected server-function result can become `undefined`. Both a generic JSON 500 response and a serialized envelope missing its serialization marker reproduce that condition. Properly serialized replies work. This establishes the client failure mechanism; it does not identify the upstream cause of the user's particular response.

Read-only Cloudflare telemetry discovery/query for Worker `lootsplit`, October 9 18:00–18:25 UTC, returned no matching stored events. Settings returned no observability configuration and `logpush: false`. No production 500, stale-function-ID exception or database-limit event was observed. Logging configuration and production campaigns were not changed. The missing telemetry is an investigation gap, not proof that the server accepted or rejected the user's action.

## Correction and preservation

Functional checkpoint: `87ecf48aca22e0be36c75c930f1a98925a6b5548`.

`readRoomResponse()` validates required response fields, acknowledgements, seat metadata, the table and every draft command before acceptance touches account identity, pending work, batch receipts or revision. It uses the existing runtime `readCloudTable()` reader, retaining legacy archive behavior. It preserves original table objects and the parsed commands' original receipt content; schema normalization does not rewrite commands. Guest and legacy responses may still omit account identity and newer optional flags.

`accept()` also rejects a reply for a different room or seat before mutation and retains the existing owner check. Account membership resume uses the same boundary before selecting a campaign or writing recovery/session state, and verifies the returned room and owner.

The error tells the person that the response is incomplete and that pending work is retained. It does not claim that a server save failed: the server may have committed the action before its response was lost. Existing Retry reads authoritative receipts and preserves exact action IDs rather than creating another import. No import schema, account authorization, financial command, database migration or published APK changes are included.

The original failure had an additional preservation risk: a malformed draft or table could clear a guest's in-memory pending queue before throwing. Regression cases now reject those responses before any such mutation. This repair does not claim to make unrelated later IndexedDB failures transactional.

## Verification

Local environment: Node 22.23.3 and diagnostic Chromium 133.0.6943.0. The repository's locked Playwright browser is not installed here; complete current-browser CI remains a release gate.

| Check | Result |
| --- | --- |
| Related response, acceptance, account-resume, hierarchy, location and room-store tests | 82 passed |
| Complete `verify:quick` | 835 tests: 831 passed, four existing skips; clean TypeScript; zero lint errors and 30 existing warnings |
| Web and mobile builds | Passed |
| Immutable Worker packaging | Dry-run preparation and 563-file manifest verification passed for the functional checkpoint |
| Complete development market-location browser audit | Passed at 1280 and 390 pixels in 110.925 seconds |
| Focused `resume-partial` | Passed; 43.3 seconds in the browser runner, 54.515 seconds including isolated setup |
| Actual supplied hierarchy CSV | All 483 rows imported through a signed-in shared campaign: 494 locations and 14 shops; server acknowledged, reload retained every entry, repeat preview added zero |
| Packaged Worker browser audit | Complete desktop/mobile audit passed in 57.631 seconds; exact supplied CSV shared import/reload/repeat also passed in 8.645 seconds; full current-browser CI remains mandatory |

The full browser audit retains every previous location/image/trading/guest-memory assertion. Added cases use synthetic names, not resource-book content. At both widths it uploads and reviews a 483-row hierarchy creating 508 locations, injects an incomplete preflight response, verifies the exact draft/preview and all saved data remain intact, then imports and checks duplicate prevention. A separate case forwards a real import to the server but replaces its reply: another participant sees the saved shop while the DM retains the original action and batch IDs. The actual Multiplayer → Connection & recovery → Retry control acknowledges the saved action without submitting it again; exactly one shop and one event remain.

The private supplied CSV was also checked before and after the correction in disposable signed-in campaigns. Shops remained closed and empty, stock and purse balances were unchanged, and the party did not move. Neither the source books nor the CSV contents are included in this repository change.

Initial diagnostic issues were resolved without weakening assertions: separate command invocations had separate loopback namespaces, so the local server and browser are now children of one isolated runner. An environment-injected `UNDICI-EHPA` warning contaminated a CLI test's JSON stderr; only that warning was disabled for the clean full run. Adding the large hierarchy before an existing small-import case caused its five-second mobile dialog-close check to expire immediately before the successful close; the new size case now runs after the original cases. Wrangler's automatic inspector-port search could not enumerate network interfaces in this environment; explicit supported loopback and inspector-port options allowed the local packaged run. All database migrations in that run targeted its disposable local database. Original assertions and deadlines remain unchanged.

## Performance evidence

The history snapshot contained 741 slowdown observations and 15 resolution records; the latest inspected recorder run, `37967184736`, succeeded. No reference was reset.

The expanded local location audit increased from its last logged comparable 65.756 seconds to 110.925 seconds: **45.169 seconds added, 68.69%**. The qualifying measurement is retained in `performance/manual-measurements.jsonl`. This audit now includes both-width large imports and two response-failure/recovery cases. The existing trend's original 36.179-second reference to this result is **74.746 seconds added, 206.60%, across three logged increases**. The workload increase is explicit; a faster subsequent run would not alone justify resetting the trend. The packaged Worker diagnostic took 57.631 seconds, recorded as an initial reference in its separate environment; it is not a comparable improvement over the development run. No new PR/main workflow duration exists for this unpublished correction.

A narrow synchronous check using the actual hierarchy's 80,169-byte synthetic room response measured 20 response-reader calls: median 2.420 ms, maximum 13.656 ms. This is not a browser/IndexedDB benchmark or evidence of an optimization. It did not support the validator itself as the cause of the mobile five-second assertion delay.

## Release and recovery

The user explicitly authorized publication to GitHub and deployment after release checks on October 9 at 22:05 America/New_York (October 10 UTC). The next read-only reconciliation found main and live still at `73c84e1724a1b4577d3c1c7f8ea402a84d7365e4`, with no open PR or published branch for this fix.

The old shared Git object store was unavailable when this session resumed, but all changed source files and verification evidence remained. A fresh isolated clone recovered the nine-file change and reproduced the exact previously verified Git tree `c4b6c137ed3aed4906f7fce2055a603ac2319a70`; only the authorization/recovery notes were then updated. The application and test source remain identical to the completed local verification.

Publication proceeds through complete fresh PR checks and independent main verification, followed by the existing immutable main-only website/standby release and read-only live audit. Final remote commit, PR, run, performance and live evidence will be recorded in the PR and local recovery checkpoint without changing the source while those gates run. This prepared checkpoint does not itself establish a production release. No production campaign mutation, new migration or signed APK release is part of this fix.
