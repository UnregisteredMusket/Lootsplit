# Account resume repair — October 7, 2026

The user requested implementation and publication of the account issue (#60). Baseline main/live is `114c93579e8a3b56431aeb2a980bb389d8b64c1d`, tree `0a4424de99c1aeb058c9032b7cb3508f3d2d9022`. Cloudflare Worker `1b9a047a-281e-464a-895f-d21be77a4363` was rechecked serving100% with verification37574857899. Android1.5.0/code7 and PR58/59 publication are already complete; do not repeat them.

## Reproduction and implementation

The actual original cloud-client module, executed with isolated synthetic dependencies, rejected an acknowledged Live command with the exact unfinished-turn warning; the unrelated-current-campaign preservation assertion passed. The old guard did not compare receipts, server draft or seat identity before rejecting the target cache.

The new read-only plan reconciles only the verified seat's acknowledged IDs, preserves genuine pending commands/batch identities, and preserves divergent/earlier-seat queues in append-only account-and-campaign-scoped action records before replacing any connection. No credentials are copied to those records. Storage failure aborts. Both startup and My account allow same-campaign DM recovery, validate current server identity, and refresh the library after an ambiguous reopen. Active and target cache locks protect concurrent tabs. DM resume clears stale guest reconnect state. Pending preview conflicts hydrate the authoritative server table while keeping recoverable actions. Recovery imports with another seat/role are refused; legacy same-campaign exports remain supported.

The recovery UI is additive, retaining existing Retry/Export/Discard, account backups and all campaign controls. Guidance distinguishes shared saves, offline copies and manual snapshots. The account Resume arrow is17px rather than16px; no control is removed. Private PDFs remain local. No server ownership rules, database migration, dependencies, signing keys, domain settings, gameplay rules or parked offline pass-phone functionality change.

## Local verification

Original reconstructed source files were checked against their exact Git blob hashes before editing. The real client dependency-isolated suite now passes22 tests,0 failures,0 skips, runner309.639951ms (Node22.16.0). It covers accepted/lost Live responses, fresh profile, active DM resume, genuine turns, prefix/divergent drafts, stale seats, alias queues, partial receipts/batch identity, conflict hydration, transaction abort, wrong/changing account, invalid server identity, target lock, malformed cache, quota failure, guest ticket, network failure and recovery import/isolation/deduplication.

The initial two-test reproduction runner155.33562ms and expanded22-test runner are different workloads, not a performance comparison. Seven TypeScript/TSX syntax-transpile checks and new JavaScript syntax checks passed; syntax checks are not a full typecheck. Version/code alignment and unchanged historical release notes/changelog entries were checked.

Full local project build/browser/lint/typecheck execution is unavailable: direct GitHub access and npm registry resolution fail with DNS errors, and this environment has only a partial source reconstruction, not installed project dependencies. No complete local pass is claimed. Two new real browser scenarios use disposable accounts/rooms and real UI at desktop/mobile sizes, actual committed-but-lost mutation/reopen responses, unchanged portrait state, genuine staged turns, and real recovery download/rejected cross-seat import. They are included in all account gates with no timeout/retry relaxation. Complete CI must resolve the local environment gap before release.

## Release and interruption checkpoint

Prepare Android1.5.1/code8 using unchanged package `com.unregisteredmusket.lootsplit` and permanent certificate `baca95a880d14d0d8c422c397decd4c9bf0e7f710a3fd6a5be1e47abd3f730a0`. Public release.json remains1.5.0 until the new signed artifact is verified. Full exact-head PR/main gates, automatic signed Android workflow, immutable website deployment/live audit, and a separately gated verified-download follow-up are required. Do not claim a merge is a release or start duplicate signing/deployment after an interrupted response.

At this checkpoint implementation is prepared, not released. Final PR/run/Worker/APK identities, actual browser results, fresh performance-history review, and remaining limitations must be recorded in the PR before handoff. Keep issue60 open until both website and Android delivery are verified. Physical-device installation/file-picker/force-close behavior is not claimed tested. Never publish private campaign names, screenshots, tokens or test credentials in audit prose.
