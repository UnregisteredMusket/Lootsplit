# DM shop stock control — October 7, 2026 UTC

User requested larger shop inventories and more DM control. Baseline main/live is `8a7b5e379077a1690fedee0ae5816a5bd16ed397`; offline pass-phone remains parked and outside this work. Branch: `feature/shop-stock-controls`.

## Problem and change

The generator used small per-rarity wealth caps and deliberately omitted catalog items even when they fit. Stock depth also mixed assortment size and quantity. The failing regressions produced 3 of 80 requested items and 14 of 40 item types.

DMs can now choose suggested assortment, a target item count, or all catalog matches. Quantity is separate: suggested, fixed, or unlimited; generated services remain unlimited. Category/rarity filters and wealth/economic price rules remain. Explicit selections retain catalog notes. Old callers without the new selection options retain their previous generator behavior.

Existing shop Edit has a catalog picker with search/category/rarity filters, individual or all-matching selection, persistent selection across filters, quantity choice, duplicate indication and retained selection on failure. Atomic additions preserve current stock, prices, quantities, category/rarity/service/source notes and campaign audit history. They check the shop still exists and reject player access; shared changes use the existing DM patch/turn engine.

Both counter and editor have inventory totals, search, rarity/availability filters and 25-item pages. Generator preview and catalog picker are paged too. All saved rows and complete PDF exports remain available. Rates, schedules, restock, custom additions, trading, existing save formats and five mobile tabs are preserved. No migration, dependency, signing, APK or offline-turn-engine changes.

## Verification

- Two new generator regressions failed on the old implementation, then passed. Bulk tests verify competing imports deduplicate, existing prices remain, service/source metadata and full stock survive backup parsing, direct and shared player attempts are denied, invalid/deleted-shop requests fail and an injected second-write failure rolls back stock and its audit event.
- `verify:quick`: 512 passed, four existing skips; TypeScript clean; ESLint zero errors and 34 existing warnings. The first quick run caught the intentionally changed workflow check counts and an environment-injected Node experimental-warning prefix in a pre-existing CLI stderr JSON test. Updated counts retain all old gates and add the new gates; local `NODE_NO_WARNINGS=1` removes that injected diagnostic without changing tests or production code. The complete rerun passed.
- Web and mobile builds passed. No signed APK release is claimed.
- Node22.23.3 / Chromium133 disposable Vite audits: shop stock 14.856s, finance21.856s, help12.189s; desktop/mobile screenshots inspected. New shop flow creates 99 items, buys one, edits a price, browses another page, selects across catalog filters, adds an ordinary good and unlimited service, rejects duplicates, filters stock, reloads and checks router/title preservation.
- Initial new browser fixture runs failed at36.457s and38.841s: it did not open the Create a shop fold, then queried the Edit tab as a button. Corrected the actual clicks/roles; application checks were retained. These were disposable fixture failures, not production changes.
- Required development and packaged Worker shop audits were added to the full verification workflow and preservation baseline. Existing account, finance, permissions, Worker, standby, title, mobile, build and release gates remain mandatory. Full exact-head PR/main/live checks are pending; local Chromium133 does not replace CI's current browser.

## Performance review

Read persistent performance history at85617f2776193ec1678fe38f7da5c317beb7c245. Latest observed recorder37557830344 succeeded; capture cursor2026-10-06T20:33:25.295Z and pending list empty. History is unchanged since the prior release review; intervening operations were recorder runs, not missed application releases.

Help12.189s is below the14.026s logged reference. Finance21.856s is below the29.099s reference, although the recorded reference includes concurrent account work; no reduction is claimed for a different contention level. The new shop audit has no older comparable implementation baseline and establishes its successful scope separately; failed fixture attempts remain documented above.

Unresolved historical trends are preserved: main verification205→744s (+539s, +262.93%, two logged increases); main accounts152→732s (+580s, +381.58%, three increases); main account browser installation22→523s (+501s, +2277.27%, two increases). The last main spike was slow Ubuntu mirror dependency downloads (523s), while account assertions remained124s. PR gameplay141→195s (+54s, +38.30%, two increases) and finance/Worker/setup/deploy trends remain open. New shop checks add real coverage/workload; CI timings and critical-path duration must be compared without summing overlapping jobs or resetting existing trends.

## Release and resume

Publish the verified source/checkpoint, require every exact-head PR check, reconcile main, then follow the existing gated main verification/deployment/live audit. No production migration is required. If an upload succeeds but verification fails, inspect its artifact/readiness evidence and use read-only verification; never rerun a deployment solely to repeat its audit. Record final PR/main/release evidence in the PR before calling the change live.
