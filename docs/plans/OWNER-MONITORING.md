# Synchronized owner monitoring

Authorized October 20, 2026. Preserve all existing layouts, campaigns, permissions,
themes, release gates and the permanent Android signing certificate.

## Verified baseline

Main/live `4f4746c0cf7f866aa16da645fb29982d8dc08d4a`; no open PRs or dirty files.
Worker `98f8dfc3-64cd-47ba-a664-a4a995502d4f`. Android 1.8.1/code12 is published
and independently verified; do not repeat that release. The runtime contains the
Cloudflare analytics account/token bindings and GitHub opt-in. Secret values were
not read. There are no Cron Triggers. The existing monitor is request-driven,
with five-minute provider caches and current owner/session checks. Its Android
manual broadcast refresh is already immediate and bounded; retain that fix.
Performance history contains 1,288 observations and 17 historical resolutions;
the new task must retain every trend and the inclusive 15% rule.

## Reviewable phases and acceptance

1. Backend: additive D1 journal, UTC half-hour slots, lease/idempotency and missed
   intervals, typed comparisons, central registry, calendar-day reports with
   America/New_York default 00:10, authenticated task events and device reports.
   Verify real SQLite transactions, races, gaps, DST, resets and permissions.
2. Shared owner interface: one versioned snapshot, history/search/filter/export,
   report evidence, component diagnostics, task timings and coverage. Preserve
   the website overview and make its capabilities available in bundled Android.
3. Native widgets: keep direct refresh and encrypted backup-excluded state;
   add a supported collection, Chronometer, per-instance 4×1 companion settings,
   direct destinations and authorization clearing. Verify API24/API35; identify
   physical launcher/Doze limitations honestly.
4. Documentation/release: both role Help guides, inventory/manual/recovery,
   changelog, performance records, fresh complete PR/main gates, immutable web
   publication, signed Android inspection and matching download publication.

## Data contract

The D1 journal is authoritative. Collection observations and device delivery are
separate timestamps. Monotonic database revisions order immutable snapshots;
clients reject older revisions. Half-hour collection keys use scheduled UTC
boundaries, independent of calendar-day reporting timezone. A minute Cron checks
due work and retries leases; it does not collect every minute. Missed slots are
retained explicitly; only provider history actually recovered is marked recovered.
Current observations never pretend to have happened at a missed time.

Every future log explicitly requested or designated for Lootsplit must
automatically become part of the daily report. A registry entry includes its
source, collection mode, freshness expectation and registration date. Existing
operational logs register adapters. External logs register through the owner API
and send idempotent observations/coverage attestations; absence remains a gap.
Reports enumerate every registered source, including sources with no data.
History has no automatic deletion. Paginated JSON export is the archival path.

Development activity is explicit event telemetry, never inferred from chats or
commits. A task has a persistent ID and optimistic revision, event history,
heartbeat/progress timestamps and measured/recorded time separately from total
wall time. Long stages declare expected duration. Missing telemetry is uncertainty,
not proof of failure. Workflow publishers authenticate with narrowly verified
GitHub OIDC; owner actions use the current session and transactional role guard.

Green means all required checks are current and healthy; yellow is stale,
disconnected or unverified; red requires observed failure. A disconnected check
does not clear a previously observed failure. Android does not use animation or
network timers to imply fresh data; its host renders static warnings and a native
elapsed timer. Web animation respects reduced motion.

## Release evidence

Implementation and verification are pending. Evolving exact heads/run IDs belong
in the review PR and `test-results/recovery/monitoring-journal.json`; no release or
physical-device verification is claimed by this design checkpoint.
