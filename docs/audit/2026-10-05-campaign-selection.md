# Cross-device campaign selection — 2026-10-05

Base/main: `612ee4612e9b699d746e708acd4094c4ff80d38b`. Branch `fix/portrait-display-sync`; consult its PR for final verification and deployment status.

## Confirmed cause and scope

The user supplied phone and desktop screenshots with different room codes. Both reported saved Live state. Resuming the phone's exact saved membership on desktop restored the portraits; the user confirmed the result. The evidence establishes separate room selection, not the historical action that created the second room. No user campaign was overwritten, merged, deleted or used as a test fixture. Private screenshots, codes and character data are excluded.

The room-creation flow did not automatically link a signed-in DM's new room to the account. A new regression created a room through the UI and found zero account memberships; it failed before implementation. Separate rooms could also share a name with no warning when resuming an older entry.

New signed-in rooms now link automatically. If linking fails, the UI reports that the room exists and retries only the idempotent membership link. Before creation, saved campaigns are offered for resume; a deliberate separate-room checkbox is required when saved rooms exist or the account check is unavailable. Guests can still create rooms, and account lookup failure does not permanently block shared play. My campaigns marks the current room, shows last-open/save time, labels duplicate names, and checks fresh metadata before confirming an older same-name entry. Names are never identity, ownership, proof of newer gameplay data, or grounds for merging. Different devices may intentionally use different rooms.

Both existing portrait upload controls are additionally checked against Party-card image bytes/decoding and the account server readout. The previous failed-upload retry, DM reopen and pending-turn safeguards remain required. No backend schema, permissions, finances, image storage or deployment gate changed.

## Local verification

Node 22.23.3/Linux x64/Chromium; isolated databases and synthetic accounts. New campaign-choice scenario passed in 10.656s (11.239s runner) after the expected pre-fix failure. It verifies auto-linking, blocked accidental new-room creation, a failed account link and retry without another room, cancellation of the duplicate-name warning and explicit older-room resume.

All six account scenarios then passed in 87.373s runner time while quick checks ran concurrently: layout 10.894s, library 11.986s, DM resume 23.274s, recovery 3.502s, expanded portrait resume 27.811s, campaign choice 9.069s. Full quick checks passed: 486 tests, four existing skips, clean TypeScript, zero lint errors and 35 existing warnings. The new chooser's desktop screenshot was inspected. Packaged Worker/standby and mobile/desktop production verification remain full CI/release gates.

## Performance review

PR run 37279628295 passed every group except governance's dev-release audit, which timed out at restored-room refresh after removing network interception. The server log had no runtime error, and the unchanged audit passed locally with diagnostics enabled. The test now keeps its handler installed and toggles the injected command failure off to restore transport without removing interception during background polling. The updated audit also passed locally. CI now retains request and lock diagnostics on a recurrence. This is a fixture stabilization with an unresolved historical timeout cause; no production synchronization fix or performance-trend reset is claimed. Fresh complete CI is required.

Read-only history sync found 196 qualifying observations, no new observations since the prior audit, no pending runs and 43 repeated open trends. Latest inspected automated recorder 37274181669 succeeded. The retained history covers the prior release through 06:04 UTC; the prior release asset readiness increase remains recorded (2.465s → 22.623s, +20.158s/+817.77%). No trends are reset: neither room selection nor a faster individual run diagnoses and fixes these timing causes.

Previous comparable complete-release totals: PR verification 216s (37269780574), main verification 228s (37270098428), deployment 125s (37270395853). Final PR notes must compare those elapsed scopes independently and include absolute/percentage differences. Do not add overlapping jobs. New browser coverage increases the account workload; retain qualifying CI increases under the existing operation names, explain the extra coverage, and inspect the critical job rather than treating every increase as unexplained application slowdown.

The standalone portrait baseline from the earlier upload-only scope is not comparable to expanded Party-card/full-sheet coverage. The new six-scenario local suite is also distinct from the five-scenario packaged standby baseline and the standalone run. No local speedup is claimed. New comparable references are recorded separately for future investigation.

All repeated prior findings are retained below. Setup/cache/artifact steps need runner evidence before a cause is assigned; second-level timing makes short-step percentages noisy. Account and encounter trends include added coverage but their earlier rises remain unresolved. Prior main account execution 59s → 85s (+26s/+44.07%) and Worker accounts 25s → 40s (+15s/+60%) are priorities after the added scenario; compare fresh release totals and recorder entries before resetting anything.


Open trends require investigation. Resolved trends retain their history; each verified reset begins a separate trend.

| Operation | State | Logged increases | Original → latest | Total added | Cumulative increase |
| --- | --- | ---: | ---: | ---: | ---: |
| Development / gameplay / Run actions/setup-node@v4 | open | 2 | 3s → 7s | +4s | +133.33% |
| Development / desktop / Run actions/setup-node@v4 | open | 2 | 3s → 7s | +4s | +133.33% |
| Development / desktop / Run npm ci | open | 2 | 11s → 16s | +5s | +45.45% |
| Development / gameplay / Start disposable development server | open | 2 | 4s → 8s | +4s | +100% |
| Code checks and immutable builds / mobile-build | open | 2 | 3s → 6s | +3s | +100% |
| Development / gameplay / dev-bug-data-integrity | open | 2 | 4s → 6s | +2s | +50% |
| Code checks and immutable builds | open | 2 | 48s → 82s | +34s | +70.83% |
| Development / gameplay / dev-encounter | open | 4 | 8s → 27s | +19s | +237.5% |
| Packaged Worker / interface / Run actions/setup-node@v4 | open | 3 | 2s → 6s | +4s | +200% |
| Packaged Worker / accounts / Run npm ci | open | 2 | 8s → 14s | +6s | +75% |
| Packaged Worker / interface / Run actions/download-artifact@v4 | open | 2 | 1s → 3s | +2s | +200% |
| Packaged Worker / accounts / Start disposable built Worker | open | 2 | 5s → 7s | +2s | +40% |
| Packaged Worker / accounts / worker-monitor | open | 2 | 5s → 7s | +2s | +40% |
| Code checks and immutable builds / Run actions/setup-node@v4 | open | 2 | 2s → 5s | +3s | +150% |
| Development / governance / Run npm ci | open | 2 | 7s → 17s | +10s | +142.86% |
| Development / governance / Start disposable development server | open | 2 | 4s → 8s | +4s | +100% |
| Packaged Worker / interface / Run actions/setup-node@v4 | open | 2 | 3s → 5s | +2s | +66.67% |
| Development / governance / dev-campaign-governance | open | 2 | 18s → 48s | +30s | +166.67% |
| Packaged standby / standby-audit | open | 2 | 20s → 42s | +22s | +110% |
| Packaged standby | open | 2 | 62s → 94s | +32s | +51.61% |
| publish / Run actions/download-artifact@v4 | open | 2 | 1s → 3s | +2s | +200% |
| Publish verified standby | open | 2 | 10s → 18s | +8s | +80% |
| publish | open | 2 | 10s → 18s | +8s | +80% |
| Code checks and immutable builds / Run actions/setup-node@v4 | open | 2 | 3s → 6s | +3s | +100% |
| Packaged Worker / accounts / Run actions/download-artifact@v4 | open | 2 | 1s → 3s | +2s | +200% |
| Packaged Worker / accounts / Run actions/upload-artifact@v4 | open | 2 | 1s → 3s | +2s | +200% |
| Packaged Worker / accounts / worker-account | open | 2 | 22s → 40s | +18s | +81.82% |
| Development / gameplay / Run actions/setup-node@v4 | open | 3 | 2s → 7s | +5s | +250% |
| Development / accounts / Run actions/setup-node@v4 | open | 2 | 3s → 7s | +4s | +133.33% |
| Development / desktop / Run actions/setup-node@v4 | open | 2 | 2s → 7s | +5s | +250% |
| Development / accounts / Run npm ci | open | 2 | 11s → 16s | +5s | +45.45% |
| Packaged standby / Run actions/setup-node@v4 | open | 2 | 2s → 4s | +2s | +100% |
| Packaged Worker / interface / Run npm ci | open | 2 | 11s → 15s | +4s | +36.36% |
| Development / gameplay / Run actions/upload-artifact@v4 | open | 2 | 1s → 3s | +2s | +200% |
| Development / accounts / Run actions/upload-artifact@v4 | open | 2 | 1s → 3s | +2s | +200% |
| deploy / Check current main, existing bindings and applied migrations; deploy without rebuild | open | 2 | 9s → 15s | +6s | +66.67% |
| Packaged Worker / accounts | open | 2 | 85s → 120s | +35s | +41.18% |
| Code checks and immutable builds / Run actions/upload-artifact@v4 | open | 2 | 2s → 4s | +2s | +100% |
| Development / gameplay / dev-encounter | open | 2 | 11s → 19s | +8s | +72.73% |
| Code checks and immutable builds / Run actions/upload-artifact@v4 | open | 2 | 2s → 4s | +2s | +100% |
| Packaged Worker / accounts / Run actions/setup-node@v4 | open | 2 | 3s → 5s | +2s | +66.67% |
| Development / accounts / dev-account | open | 2 | 59s → 85s | +26s | +44.07% |
| Packaged Worker / accounts / worker-account | open | 2 | 25s → 40s | +15s | +60% |
