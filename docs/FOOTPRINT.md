# Footprint: keeping features lean

Owner decision, 2026-11-01 (the signed-off "Lootsplitter Lean Growth Plan"). Every new feature, and
every change that stores more data or makes the server do more work, follows this structure, so
storage and CPU grow with players slowly and predictably instead of needing upgrades and rework.

**Monitoring is outside this structure.** Development telemetry, monitoring logs, daily reports and
monitoring history are kept in full (owner, 2026-11-01). Only the storage warning below watches them.

## Where things stand (production, 2026-11-01)

- D1 is 174 MB of the 5 GB included (3.5%); about 60% of it is monitoring, kept in full.
- Campaign data is about 22 MB for 14 shared campaigns (about 1.5 MB each, mostly session journals).
  This is what scales with players: a thousand campaigns at that average is about 1.5 GB.
- Worker CPU is the allowance in real use (18% of the cycle at 71% elapsed). Requests, D1 reads and
  writes are far below their allowances.

## The six places data can live

Choose from the top down: the first place that works wins, because each step down costs more
server storage or CPU.

| Place | What belongs there | Server cost | Examples |
| --- | --- | --- | --- |
| 1. Computed, never stored | Anything derivable from data the client already has | None | Fairness ledger, totals, level-up prompts, session recap, sell-and-split preview |
| 2. The device only | Drafts, view settings, private files, offline campaigns | None | Chat drafts, private PDFs, guests' pending actions, Local Mode |
| 3. Live campaign (working set) | Only what play needs now | Counts toward the 4 MB live cap; sent on every sync | Balances, items, characters, the current session's ledger, the open map |
| 4. Campaign history (archive) | Anything finished | Stored once (delta archives), read only on request | Archived sessions, Load earlier entries |
| 5. A feature table | Many small records the server must search or expire | One indexed row each; needs a cap or an expiry | Encounter rolls, map pings (expire), receipts |
| 6. Files | Images and documents | Chunked, per-upload size limit | Map images, portraits, resource PDFs |

## Eight questions every feature answers

A pull request that adds or changes stored data, or server work on a request path, answers these in a
`## Footprint` section (the template has it). A change that stores nothing new writes
`Footprint: none — <reason>`. Mockup reviews cover the answers before building.

1. **Where does its data live?** One of the six places, and why a cheaper place does not work.
2. **How much does it add?** Bytes per use and per session, and the size after a year of weekly play.
   It must fit within 10% of the live cap (400 KB) in the reference campaign.
3. **What stops it growing forever?** A count limit, an expiry, or moving to history when a session
   closes. "Nothing" is not allowed.
4. **What does the server compute, and how often?** The client does the arithmetic with the shared
   rules engine (`commands.ts` / `economy.ts`); the server checks once per change. No request path
   scans every campaign or a whole history.
5. **What does a sync send?** Only what changed; new strict-schema fields follow the tabletop
   protocol rule (`tabletop-protocol.ts`).
6. **What happens to old saves?** They keep opening; a missing field means "not used yet".
7. **What is logged?** Money and item receipts as now; anything else only if someone reads it, with a
   retention period (monitoring itself excepted, see above).
8. **How is it measured?** The footprint test covers it with the reference campaign.

## Budgets and their checks

| Budget | Limit | Enforced by |
| --- | --- | --- |
| Live campaign | 4 MB per campaign (existing) | Server refuses larger writes |
| One feature's share | 10% of the live cap (400 KB) in the reference campaign | Footprint test (`scripts/footprint.test.mjs`) |
| Growth per pull request | Live size, sync size or archive per session up more than 10% fails unless the baseline is updated in that PR with a reason | Footprint test baseline (`scripts/footprint-baseline.json`) |
| Reference campaign | A synthetic year of weekly play through the real server code: 6 characters and a party fund, 300 items, 52 sessions of 24 transfers and 2 notes each; three shops of 20 lines, a settlement profile, three factions with a renown change for every character each session, two 20-item shop lists, and a market event and stock swap every fourth session | `scripts/footprint-fixture.mjs` |
| Server work per request | No scan of every campaign or whole history on a request path | Guard tests (as the existing ban on direct `campaign_rooms` SQL) |
| Widget and monitor requests | Under 1.5 s on the server | `widget-served` timing entries (Field monitor) |
| Monitoring growth | No limit: kept in full | Database size in the daily monitoring report (the weekly summary runs on GitHub without database access) |
| Database size | Amber at 1 GB, review at 2.5 GB (5 GB included) | Field monitor "Database storage" check |
| Worker CPU | Amber when the cycle's use runs ahead of its pace | Cloudflare usage gauge |

## The reference campaign today

Baseline 2026-11-11 (`scripts/footprint-baseline.json`): stored live campaign 179,447 bytes, DM view
183,321 bytes, player view 129,079 bytes, archive 39,528 bytes per session. The fixture then gained
the world features (factions, settlements, shop lists, market events; audit 2026-11-10, F6), so
growth there fails the test too; without them it measured 151,633 / 155,494 / 116,887 bytes and
30,726 bytes per session (baseline 2026-11-06; 61,805 per session before re-basing, below). Factions
together are refused past 400 KB on a new save (`MAX_FACTIONS_BYTES`, `factions.ts`; owner decision
2026-11-11). Run it with `node --experimental-strip-types scripts/footprint-fixture.mjs`.
Adding about 120 bytes to every item grows the live campaign by 21%, which the test refuses.

Why an archived session cost 62 KB (investigated 2026-11-06): every archived snapshot carries the
campaign's whole session list and journal, which grow each session, and every delta was taken
against the room's first full snapshot, so each one re-stored everything written since then (14.5 KB
for session 2, 110 KB by session 52). New sessions now re-base, storing a full snapshot, once a
delta would pass 35% of its snapshot (`REPORT_REBASE_FRACTION`, `cloudflare/room-reports.mjs`):
30.7 KB per session. The session's own new data is about 14.5 KB. Deltas chained to the previous
session would reach about 18 KB but need a reader release before any writer stores them
(`report-delta.mjs` release order); not done.

## Improvements worth making (optional, in order)

1. Done (#406): game statistics are running totals (`game_analytics_cache`, migration 0031); a collection rereads only campaigns whose revision changed. The public statistics route reads only the stored totals row (audit F4, 2026-11-10).
2. Measure the minute timer's jobs and skip work when nothing changed.
3. Check that finished session journals leave live campaign data (the largest campaign held 1.7 MB of
   journal in its live row on 2026-11-01).
4. Files stay in D1 until they pass about 1 GB, then consider R2.
5. Not planned: thinning monitoring. Revisit only if the 1 GB warning fires.
