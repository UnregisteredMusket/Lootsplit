# Live-campaign load audit: 1 to 6 users

- **Requested by:** owner, 2026-10-28 08:13 ET. "Gradually ensure a smooth experience with up to 6 active users in a live campaign… Report your findings before administering any fixes… Ensure this audit does not repeat without my authorization."
- **Run:** 2026-10-28, 08:35–09:05 ET (12:35–13:05 UTC), authorization label `owner-2026-10-28`.
- **Code audited:** `main` at `8652d1a` (#325). Live site at the time: `802b331`.
- **Status:** findings only. **No fixes have been applied.** Each fix below waits for the owner's go-ahead.

## Bottom line

A live campaign with a DM and up to five players works. Every change reached every other browser in about 1 second (worst 2.6 s), and the browser stages showed no page errors or failed actions. But the audit found three problems that will hurt real tables, plus several costs that grow with campaign size and history:

1. **Every campaign eventually stops saving, and the app can't recover it.** The room keeps a receipt for every action forever (about 315 bytes each). After roughly 5,000 lifetime actions, every write is refused as "too large", and *ending the session, which the error message tells the DM to do, is refused too*. At the activity rate of the 6-person stage this is about 100 minutes of continuous busy play. At a calmer real-table pace it's on the order of 10–20 sessions.
2. **When several people act at the same moment, one of them gets an error.** In 4 of 4 runs, six simultaneous actions produced one "The table changed. Refresh before sending your turn." failure.
3. **A DM running combat on home Wi-Fi can lock the whole table out of account actions.** Two of the DM's encounter views use up the household's per-minute account allowance, after which sign-ins and other account actions from that Wi-Fi are refused (HTTP 429).

The rest is cost that scales with campaign size and history. Every change makes every client re-download and re-process the whole campaign, including all archived session reports for the DM. Map pings re-read the whole campaign every second per browser. An encounter check runs a full table scan on every poll. On a large (~1 MB) campaign with six people, a write took 0.7 s typically and up to 6 s, and changes took up to 10 s to reach others in the server harness.

## How it was tested

Nothing touched production data. Production D1 stayed read-only and no campaign was created on the live site.

| Part | What it does | Script |
| --- | --- | --- |
| Protocol stages | Real room server code (`openRoom`, `joinRoom`, `pollRoom`, `roomState`, `submitCommands`, `mapSignals`) against SQLite built from every production migration, through an instrumented D1 stand-in. That stand-in counts queries, rows and bytes, adds a 4 ms round trip per query so concurrent writes race as on D1, and counts revision conflicts. DM alone, then one more player per stage up to 6, 60 s per stage. Each client: poll every 2 s (as `cloud-client.ts`), map signals every 1 s (as `use-map-pings.ts`), a full pull before each action (as `queueCommand`), an action every 6 s (DM) or 8 s (player): chat, coin transfer, token move. Each stage ends with everyone acting at once. | `scripts/live-load-audit.mjs` |
| Scenarios | **Typical:** the Wayfarers demo campaign plus a tabletop map (stored room ≈ 210 KB). **Heavy:** the same plus 4,000 ledger lines, 1,500 messages and 360 KB map art (stored room ≈ 925 KB). | same |
| Browser stages | A real DM browser, then one real player browser per stage up to 6, in one live room on a disposable dev server. Players join through the join link. Each stage runs 60 s of rotating actions, timing how long each takes to reach every other browser, plus a simultaneous burst. Records requests, bytes, long main-thread tasks, heap and page errors. | `scripts/live-load-browser-audit.mjs` |
| Shared Wi-Fi limit | One minute of a DM's TV-display and Initiative views plus a few other actions, all from one household IP, through the real account handler. | `scripts/live-load-ratelimit-check.mjs` |
| Receipt growth | A disposable room given the receipts of a long-running campaign, then chat, end the session, resume, chat. | `scripts/live-load-receipts-check.mjs` |
| Live site | GET-only timings of public pages, a bundle and the session check on both hosts. No sign-in, no writes. | evidence file |
| Code review | Every file on the live sync path, read line by line. Each finding below is marked **measured** or **code-read**. | — |

Raw results are in `docs/audit/evidence/2026-10-28-live-load/`.

**Limits.** The protocol harness runs all users in one Node process on one CPU. Latency *under contention* is therefore an upper bound: production spreads requests across Worker isolates, though D1 writes still serialize. The uncontended single-user costs are the dependable figures. The browser stages ran six browsers and an unminified dev build on a 2-CPU sandbox, and the dev server doesn't compress responses. Client timings, bytes and heap are therefore upper bounds. The harness bypasses the request guard (`guardMemberSeat`), which by code-read adds about 3–7 D1 queries per request in production. Production Worker CPU and D1 metrics could not be read: the Cloudflare connection was unavailable this session. Not exercised: turn mode, physical phones, a combat encounter in the browser stages.

## Results by stage

### Protocol, typical campaign (stored room 212 → 309 KB during the run)

| Users | Requests/min | D1 queries/min | Full refresh p50 / p95 | Action p50 / p95 / max | Conflicts | Change reaches others p50 / p95 / max | Burst of all users |
| ---: | ---: | ---: | --- | --- | ---: | --- | --- |
| 1 | 105 | 333 | 76 / 76 ms | 266 / 441 / 441 ms | 0 | — | ok |
| 2 | 207 | 693 | 88 / 184 ms | 164 / 498 / 498 ms | 1 | 0.5 / 1.6 / 1.6 s | ok |
| 3 | 311 | 1,085 | 71 / 100 ms | 112 / 377 / 482 ms | 3 | 0.9 / 1.6 / 3.4 s | ok |
| 4 | 412 | 1,467 | 71 / 101 ms | 116 / 733 / 834 ms | 6 | 0.9 / 2.0 / 6.3 s | ok |
| 5 | 508 | 1,851 | 73 / 144 ms | 122 / 928 / 1,204 ms | 10 | 0.9 / 1.8 / 2.2 s | ok |
| 6 | 613 | 2,223 | 74 / 134 ms | 130 / 1,526 / 1,692 ms | 15 | 1.0 / 1.8 / 5.0 s | **1 of 6 failed** |

- **Unchanged polls stayed about 10 ms** at every stage.
- **Full refresh sizes:** the DM's response was about 450 KB, more than twice the stored room (see F3). A player's was 49–71 KB.
- **D1 data read:** 23 MB per minute with one user, rising to 247 MB per minute with six.

### Protocol, heavy campaign (stored room 925 → 1,013 KB)

| Users | Full refresh p50 / p95 | Action p50 / p95 / max | Conflicts | Change reaches others p50 / p95 / max | Map signals p50 / p95 | Burst |
| ---: | --- | --- | ---: | --- | --- | --- |
| 1 | 166 / 166 ms | 325 / 430 / 430 ms | 0 | — | 26 / 41 ms | ok |
| 2 | 155 / 189 ms | 331 / 846 / 846 ms | 1 | 0.8 / 1.3 / 1.3 s | 27 / 57 ms | ok |
| 3 | 171 / 301 ms | 343 / 1,232 / 1,496 ms | 3 | 0.9 / 2.1 / 2.1 s | 34 / 156 ms | ok |
| 4 | 174 / 414 ms | 384 / 2,655 / 2,955 ms | 6 | 1.0 / 2.2 / 7.0 s | 74 / 258 ms | ok |
| 5 | 185 / 506 ms | 509 / 3,605 / 3,941 ms | 14 | 1.1 / 7.0 / 8.5 s | 70 / 269 ms | ok |
| 6 | 263 / 710 ms | 740 / 5,262 / 6,026 ms | 22 | 1.5 / 6.9 / 10.1 s | 105 / 378 ms | **1 of 6 failed** |

- **Full refresh sizes:** the DM's response was about 1.18 MB and a player's about 0.8 MB.
- **D1 data read:** 92 MB per minute with one user, rising to 657 MB per minute with six.
- **Map signals:** each call read about 1.1 MB from D1.

### Browser, typical campaign (dev build, 6 browsers on 2 CPUs)

| Users | Action p50 / p95 | Change reaches others p50 / p95 / max | Burst | DM download | Player download | Main-thread blocking per client |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 957 / 1,092 ms | — | ok | 11.4 MB/min | — | 8.2 s/min |
| 2 | 816 / 1,068 ms | 0.9 / 2.0 / 2.0 s | ok | 12.1 MB/min | 1.5 MB/min | 4.3–7.7 s/min |
| 3 | 746 / 1,027 ms | 1.1 / 2.0 / 2.1 s | ok | 11.6 MB/min | 1.6–1.9 MB/min | 3.8–8.9 s/min |
| 4 | 580 / 1,008 ms | 1.0 / 2.0 / 2.1 s | ok | 14.5 MB/min | 1.8–2.0 MB/min | 3.5–10.0 s/min |
| 5 | 582 / 943 ms | 1.2 / 2.0 / 2.3 s | ok | 15.4 MB/min | 2.0–2.4 MB/min | 5.4–11.8 s/min |
| 6 | 605 / 840 ms | 1.2 / 2.4 / 2.6 s | ok (slowest 4.0 s) | 14.1 MB/min | 1.9–2.4 MB/min | 6.2–13.9 s/min |

- No page or console errors and no failed actions. No change took more than 15 s to arrive.
- Each browser made about 90–105 requests per minute, about 560 per minute for the room at six people.
- JS heap (dev build): DM 179 MB, players 104–133 MB. It was flat across stages.

### Live site (GET only, from the audit sandbox through its egress proxy)

- **Response times:** the median request took about 200–300 ms. That includes the sandbox's egress proxy and a new connection each time, so it is not server time.
- **Slow outliers:** 6 of 100 requests took 2.0–9.2 s. They hit pages, the static `release-identity.json` (5.0 s) and the legacy host's `/welcome` (9.2 s). From the sandbox the proxy can't be separated from the site; the owner's Cloudflare analytics would show whether these are cold starts.
- **Main JS bundle:** 573 KB raw, 187 KB Brotli; 31 scripts and styles are referenced from the home page. That's reasonable.

## Findings

Ranked by impact on a real table. **Bug** means wrong behaviour. **Cost** means it works but wastes time, data or server capacity.

### Major

**F1. Bug (measured): campaigns stop saving permanently after about 5,000 lifetime actions, and ending the session cannot fix it.**
- **What's wrong:**
  - Every submitted batch adds permanent receipts to the room body: `commands`, `commandHashes`, `batches` and `batchHashes` (`cloud.server.ts:894`, `:924-979`).
  - Nothing prunes them except test-mode reset (`cloudflare/test-mode.mjs:138`). `archiveSession` and `closeRoom` keep them.
- **Measured:**
  - About 315 bytes per chat message.
  - A room with ~5,200 earlier actions is 1.98 MB against the 1.8 MB limit (`room-images.mjs:12`).
  - From then on every write is refused, including the DM ending the session and resuming play: see `evidence/receipts-check.txt`.
- **Why it's worse than it looks:** the error message tells the DM to end the session, which also fails. The campaign is stuck online until someone edits the database.
- **How soon:** in the 6-person stage the room gained 64 KB of receipts in about 6 minutes of load (180 batches).
- **Proposed fix:**
  - Drop receipts for batches that every seat has already acknowledged when a session is archived, keeping a bounded recent window for idempotent retries. Or move receipts to their own indexed D1 table.
  - Let `closeRoom` succeed when the only thing over the limit is receipts.
  - Add a test that a room past the limit can still end its session.

**F2. Bug (measured): simultaneous actions fail.**
- **What happens:** in 4 of 4 protocol runs, six people acting at the same instant ended with one failure: "The table changed. Refresh before sending your turn."
- **Why:**
  - `submitCommands` retries a revision conflict up to 5 times immediately, with no backoff (`cloud.server.ts:~1001-1004`). Each retry re-reads, re-applies and re-encodes the whole room, so under load the retries collide again.
  - The client does not retry automatically (`cloud-client.ts:1019`); the player has to press Retry.
  - Conflicts rise steeply with users: 0, 1, 3, 6, 10, 15 per stage (typical), and 22 per stage on the heavy campaign.
- **Proposed fix:**
  - Jittered backoff between server retries (for example 20–150 ms).
  - One automatic client retry for the same batch ID, which is safe because command IDs are idempotent.
  - Longer term, F3 shortens the read-to-write window that causes the conflicts.

**F3. Cost (measured): every change makes every client re-download and re-process the whole campaign; the DM's copy carries every archived session report.**
- **What happens:**
  - Any revision change, such as a chat line or a token move, turns each client's next poll into a full read: hydrate, project, send (`cloud.server.ts:406-409`). There's no delta.
  - The DM's full read re-hydrates all archived session reports from `campaign_room_reports` and sends them on every refresh.
- **Measured:**
  - The Wayfarers DM view is 447 KB, of which 238 KB is reports and 178 KB is trade-economy data. The stored room is 210 KB.
  - Full reads take 74 ms (typical) to 166 ms (heavy) of server time each, and each change triggers one per connected client.
  - On a heavy campaign at six users, full reads reached 263 ms p50 / 710 ms p95.
  - The DM's browser downloaded 11–15 MB per minute (uncompressed dev server; production compression would shrink this several-fold).
  - The report share grows with every session the campaign plays.
- **Proposed fix:**
  - Keep archived reports out of the poll and refresh payload, and load them when the DM opens a report.
  - Cache the projected view per (revision, seat).
  - Later: move chat out of the room row so a message doesn't invalidate the whole campaign, or send deltas.

**F4. Bug (measured): a DM running combat on shared Wi-Fi can lock the table out of account actions.**
- **What's wrong:**
  - Every POST to `/api/account/*` counts against 60 per minute per IP (`accounts.mjs:183-192`, checked at `:304` before the request is handled).
  - The DM's TV display controller polls `encounters/detail` every 2 s (`player-display-controller.tsx:210`), and the map Initiative panel every 3 s (`map-initiative-panel.tsx:117`, which doesn't pause in hidden tabs). Together that's 50 per minute.
- **Measured:** one minute of those two views plus ten other account actions from one household IP ends with the next sign-in from that Wi-Fi refused with 429 (`evidence/ratelimit-check.json`).
  - The harness's encounter requests were themselves refused by validation (no real campaign membership). That doesn't change the outcome, because the limit is counted first.
- **Proposed fix:**
  - Count signed-in requests per account rather than per IP, or exempt read-only encounter detail.
  - Share one encounter poller between the display and the panel, and pause it in hidden tabs.

**F5. Cost (measured query plan): the encounter check scans every encounter on the site on every poll.**
- **What's wrong:**
  - `activeEncounter` runs `SELECT … FROM dm_encounters WHERE code=? AND status='active'` (`cloud.server.ts:58-67`) on every unchanged poll and every full read.
  - The only index is on `(user_id, updated_at)` (`migrations/0008_encounters.sql:6`). SQLite's plan is `SCAN dm_encounters`.
- **Scale:** at 6 users that's about 180+ full scans per minute per room. The cost grows with the total encounters on the site, not just this campaign's.
- **Proposed fix:** one additive migration, `CREATE INDEX dm_encounters_code_status ON dm_encounters(code, status)`.

**F6. Cost (measured): map pings re-read the whole campaign every second, per browser.**
- **What happens:**
  - Every browser with a map open calls `mapSignals` every second (`use-map-pings.ts:52`).
  - Each call reads and `JSON.parse`s the entire room body to authorize (`map-signals.server.ts:17-24`).
  - Each call also runs a cleanup `DELETE`, a write (`:44`).
- **Measured:** 360 calls per minute at six users. Each read about 250 KB from D1 (typical) or 1.1 MB (heavy). Latency on the heavy campaign rose from 26 ms to 105 ms p50 / 378 ms p95.
- **Proposed fix:**
  - Authorize from `readRoomAccess` plus the one map's metadata (or a per-revision cache).
  - Move the cleanup to the existing minute cron.
  - Consider a 2 s read interval.

### Minor

- **F7. Cost (measured): a full refresh before every live action.** `queueCommand` calls `refresh()` without the conditional flag (`cloud-client.ts:985`). Every live action therefore first downloads the whole room, even when nothing changed. That cost 64–301 ms and up to 1.18 MB per action in the harness. *Fix:* use the conditional poll there.
- **F8. Cost (code-read): combat views poll heavily.** The combat HUD and player Initiative panel poll every 3 s. Each call does two fully hydrated room reads, including map art, and neither pauses in hidden tabs (`map-combat-hud.tsx:59`, `map-initiative-panel.tsx:228`, `cloud.server.ts:1145-1179`). The player panel polls even outside combat. *Fix:* one light read with a revision check, references for map art, and a visibility gate.
- **F9. Cost (measured, upper bound): client main-thread work on every change.** Each browser had 40–133 long tasks per minute, blocking the main thread for 3.5–14 s per minute. That's in the dev build with six browsers on two CPUs, so phones need a check on a production build.
  - **Likely cause (code-read):** every changed revision re-projects all archived reports on the device (`economy.ts:2767`), rewrites every IndexedDB store (`economy.ts:2784-2815`) and sets 12 React state arrays (`economy-context.tsx:356-403`).
  - *Fix:* skip re-projection when the server already projected, and memoize by revision.
- **F10. Bug (code-read): dice rolls can fail during active chat.** The roll insert is guarded by exact equality of the whole room body (`cloud.server.ts:150`). Any chat line between the roll's read and insert gives "Campaign changed. Reload and retry." *Fix:* guard on revision and retry once.
- **F11. Bug (code-read): other room writes have no retry.**
  - The affected writes are join, seat management, pace, naming, pass turn and close.
  - Several players joining at the start of a session, or a join while others chat, can fail with "The table changed".
  - *Fix:* the same bounded retry as submits.
- **F12. Cost (code-read): push notifications are sent inside the submit.** The submit waits up to 4 s per push endpoint before answering (`cloud.server.ts:987-998`). The sender's tab holds its lock meanwhile, which delays that player's own polls. *Fix:* `waitUntil`.
- **F13. Cost (code-read): a failed poll is retried as a full read.** Any poll error, including 429 and 5xx, falls back to a full read (`cloud-client.ts:658-664`). During a D1 hiccup every client doubles its load. *Fix:* fall back only on protocol errors.
- **F14. Cost (code-read): the whole room is re-sent with account-seat updates.** Each write re-sends the full room body to D1 once per account-linked seat, as an equality guard (`room-store.server.ts:326-345`). With 6 account seats and a 1.5 MB room that's about 10 MB per write. *Fix:* guard on revision.
- **F15. Note (measured, needs confirmation): occasional slow live requests.** 6% of GET requests from the sandbox took 2–9 s, including a static file. This could be the sandbox proxy, Worker cold starts or edge delay. *Next step:* check request-duration percentiles in Cloudflare analytics before changing anything.

### Checked and fine

- **Unchanged polls are light:** about 10 ms server time and a ~250-byte answer. They pause in hidden tabs and when offline, and back off to 30 s after failures (`cloud-client.ts:427-443`).
- **Room rate limits are fair to a shared household:** join and lookup limits are per IP but only cover entry, and command limits are per seat (`room-submit-limit.ts`). Only the account API limit (F4) is a problem.
- **Ordering is safe:** within a tab, polls and writes never overlap (a serial chain plus Web Locks).
- **Nothing is duplicated or lost:** command and batch IDs are idempotent, writes use the revision compare-and-swap, a batch is capped at 100 actions and 2 MB, and nothing was double-applied in any run.
- **Oversized writes are refused cleanly:** the room size guard refuses before writing and reports to monitoring.
- **Live history is bounded per session:** archiving clears ledger, messages, events and rolls into reports. Receipts (F1) and re-shipped reports (F3) are the exceptions.
- **No leaks:** timers, listeners and server-side caches are all cleaned up or bounded, and heap stayed flat across stages.
- **The browser stages showed no page errors, console errors, failed actions or lost changes.**

## Suggested order of fixes (not started)

1. **F1:** receipt pruning, and let a campaign over the limit end its session. Prevents campaigns getting stuck.
2. **F5:** one additive index. Smallest change, removes a site-wide scan from every poll.
3. **F2:** retry with backoff on the server, and one automatic client retry.
4. **F4:** account limit keyed by account for signed-in requests; one shared encounter poller.
5. **F6, F7, F8:** lighter map signals, conditional pre-action refresh, lighter combat polling.
6. **F3, F9:** reports out of the refresh payload, cached projection, less client re-work. This is the largest change.
7. **F10–F14** as they come up.

Each would ship as its own PR with tests and the normal checks. Re-running this audit afterwards would show the effect, but only with the owner's authorization (below).

## Re-running this audit

**Owner authorization required.** The audit is not part of CI, `npm test`, any workflow, schedule or npm script.
- **Authorization variable:** each script refuses to start unless `LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD` names the owner's authorization.
- **CI:** each script refuses to run under CI.
- **Guard test:** `scripts/live-load-audit-guard.test.mjs` runs in CI. It fails if any workflow, npm script, `wrangler.toml` or `render.yaml` ever references the audit, and it checks that each script refuses to start without authorization or under CI.

With authorization:

```
LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD node --experimental-strip-types scripts/live-load-audit.mjs                      # typical
LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD LOAD_SCENARIO=heavy node --experimental-strip-types scripts/live-load-audit.mjs
LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD AUDIT_ORIGIN=http://127.0.0.1:<dev port> node --experimental-strip-types scripts/live-load-browser-audit.mjs
LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD node --experimental-strip-types scripts/live-load-ratelimit-check.mjs
LOOTSPLIT_LOAD_AUDIT=owner-YYYY-MM-DD node --experimental-strip-types scripts/live-load-receipts-check.mjs
```
