# Persistent performance history

The user requires every **measured slowdown of 15% or above**, including exactly 15%, against the last logged comparable duration to be recorded on GitHub. A full audit must read and analyze this history.

## Where the evidence lives

The same Lootsplit repository has a dedicated [`performance-history` branch](https://github.com/UnregisteredMusket/Lootsplit/tree/performance-history):

- [`PERFORMANCE-REGRESSIONS.md`](https://github.com/UnregisteredMusket/Lootsplit/blob/performance-history/PERFORMANCE-REGRESSIONS.md): readable log.
- [`regressions.jsonl`](https://github.com/UnregisteredMusket/Lootsplit/blob/performance-history/regressions.jsonl): persistent slowdown observations, including both measurements, commits, environment, run links, added milliseconds and percentage increase.
- [`baselines.json`](https://github.com/UnregisteredMusket/Lootsplit/blob/performance-history/baselines.json): the last recorded duration per comparable operation. The first measurement establishes a reference once; it is not a slowdown entry. Faster and sub-15% runs have no duration entries and never move this reference.
- `state.json`: capture cursor, pending runs and processed attempts for interruption recovery.
- [`resolutions.jsonl`](https://github.com/UnregisteredMusket/Lootsplit/blob/performance-history/resolutions.jsonl): verified fixes, closed trend IDs, new references and any stale reset requests requiring review.

These are committed files, not expiring CI artifacts or chat memory. The separate data branch prevents log writes from changing main's release identity or triggering application releases. Never force-push or delete this history. Keep explanatory audit findings in normal reviewed repository documentation; preserve the original observations.

## Automatic coverage and comparisons

`Record performance regressions` collects GitHub workflow, job, and individual step/action durations after completion. It covers the verification, website deployment, standby, Android, backup/recovery and failure-report workflows. An hourly catch-up also discovers other repository workflows and recovers missed events. Add future workflow names to its event list for immediate capture. The logger excludes itself to prevent recursion.

Only GitHub metadata is read: it never executes triggering PR code, downloads its artifacts, reads secrets, reruns jobs or deploys. Writes target only the data branch and use non-forced updates. Concurrent recorder runs are serialized. Failed publication is visible as a failed workflow; the next event/hourly catch-up retries the collection without duplicating measurements. API errors or pagination limits stop without advancing the capture cursor. The initial history is backfilled from the latest released verification implementation, October 4, 2026 at 20:46 UTC (PR #33 and its main/deployment runs); older operations are not claimed as covered.

Comparable CI measurements share workflow path, trigger type, branch category (PRs versus individual release branches), operation/job/step name, and runner labels. Repeated identically named steps use their occurrence number. The baseline is the **last logged comparable duration**, or the initial reference when no slowdown has been logged yet. Only a new >=15% slowdown advances that reference. Faster runs and 1%–14% slower runs are discarded, not logged. A qualifying failure/timeout keeps its actual outcome visible; review the outcome when analyzing comparability. Retry-only workflow totals are separate from complete first attempts. Skipped, running, zero-duration and invalid-timestamp operations are excluded. Queue delay is recorded separately. Workflow elapsed time spans the first started job through the last completed job; parallel job durations are never summed.

The inclusive test is `currentMs × 100 >= lastRecordedMs × 115`. Baseline and current raw durations are retained; percentages are rounded only for display. A 100-second operation taking 115 seconds qualifies; 114.999 seconds does not. After 115 seconds is logged, the next threshold is 132.25 seconds. An intervening 110- or 114-second run neither creates a duration log entry nor changes the 100-second reference. Run IDs alone are retained for duplicate prevention. GitHub step timestamps have one-second resolution, so short steps may produce noisy but still recorded observations.

Runner speed, cache warmth, workload and test coverage can change. An entry is a signal to investigate, not proof that code became slower. Check these factors during analysis. If work or environment changes materially, give the measured operation a new scope/version (rename a CI operation when necessary), explain why, and establish a new baseline. Never hide a real slowdown by renaming it or resetting its baseline. Uninstrumented application functions have no trustworthy duration; add a benchmark or record a measured operation when investigating them. This does not add production profiling overhead.

## Local tests, functions, deployments, actions and audits

Future coding sessions must record comparable local measurements too, especially any observed >=15% slowdown. Measure the same operation, input size, machine/runtime, warm/cold cache and scope version. Do not compare a focused test with a full suite, or a local run with a GitHub runner. Keep sensitive data out of this public log.

Run `npm run performance:sync` to fetch current references, write a measurement JSON file, then run `npm run performance:record -- measurement.json`. The record command saves only an initial reference or a qualifying >=15% slowdown; it does not append sub-threshold durations. Example shape (replace every example value with actual measured evidence):

```json
{
  "kind": "function",
  "name": "calculate-party-totals",
  "environment": "node22/linux-x64/developer-machine-A/warm/1000-entries",
  "scopeVersion": "v1",
  "commit": "FULL_40_CHARACTER_SOURCE_COMMIT",
  "url": "https://github.com/UnregisteredMusket/Lootsplit/pull/NUMBER",
  "outcome": "success",
  "startedAt": "2026-10-04T21:00:00Z",
  "finishedAt": "2026-10-04T21:00:02Z",
  "durationMs": 2000
}
```

Qualifying records and initial references are appended to `performance/manual-measurements.jsonl`. Commit that file with the task's PR, including the earlier baseline when it is not already in history. The recorder imports reviewed entries from main. Supply timestamps and duration from the actual measurement, and evidence in the linked PR/run; never fabricate a baseline or use an estimate as a measured result. Allowed kinds: `test`, `function`, `deployment`, `action`, `audit`. Include local observations even when CI is blocked, so a later session can publish the checkpoint.

The readable log automatically highlights operations with at least two logged increases and calculates their cumulative change from the original reference. Repeated rises in the logged threshold are a performance trend requiring investigation. Report the original reference → latest logged duration, cumulative added time and percentage increase, number of increases, affected operations, and whether total workflow time also worsened. Preserve every qualifying entry so an increasing threshold cannot hide the accumulated slowdown.

## Resolve a confirmed issue and reset the trend

Once investigation identifies and fixes the cause, confirm resolution with a successful comparable verification. Then close that trend and use the verified post-fix duration as the new reference. Preserve its previous increases, cumulative totals, diagnosis, fix and verification links. Do not automatically reset after a faster run or delete the old evidence. Full audits must distinguish open trends from resolved historical ones.

1. Sync current history with `npm run performance:sync`. Identify the affected reference's `id` in `test-results/performance/baselines.json`.
2. For a CI operation, create a resolution input with `baselineId`, `reason` (diagnosis/fix and evidence), and `runId` of the completed successful verification. Run `npm run performance:resolve -- resolution.json`. The command reads the actual GitHub duration for the matching operation/environment and refuses failed, noncomparable, older or unimproved evidence. For a local function/action, supply `measurement` instead of `runId`, using the measured JSON shape above.
3. Commit the resulting `performance/resolutions.jsonl` entry with the fix or its verified follow-up. The recorder marks the old trend resolved, preserves its entries, and starts a new trend at the verified duration. If newer slowdown evidence changed the reference before publication, the request is marked `stale_reference` and does not reset anything; investigate and submit a new request against the current reference.

Example: a recorded trend of 100s → 115s → 132.25s remains archived after a verified fix brings the operation to 80s. The new trend's first threshold is 92s (80 × 1.15). This reset is explicit and evidence-backed, not an automatic downward baseline change.

## Required full-audit analysis

1. Fetch the latest data branch, read the readable log and recorded references, and check the latest recorder workflow succeeded. A stale or unavailable log is an explicit audit gap, never evidence that performance is healthy.
2. Review every new >=15% entry since the previous audit, plus unresolved earlier findings. Group repeated slowdowns by comparable operation and distinguish queue, setup/cache, actual execution and deployment/live-audit time.
3. Report baseline → current duration, added time, percentage increase, commit/run links, outcome, likely cause and the evidence supporting it. Separate noise, changed workload and confirmed regressions. Do not discard noisy entries.
4. Prioritize repeated regressions and changes to total waiting time. Record the investigation, action taken, and a comparable follow-up measurement in the audit's committed report or PR. Link that finding back to the log entry ID. Do not rerun production mutations merely to collect timing data.

Read-only collection: `npm run performance:sync` saves a local snapshot under `test-results/performance/`. The automated workflow supplies the publishing token; no extra service or subscription is needed.

References: [GitHub workflow-run security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [workflow job timing API](https://docs.github.com/en/rest/actions/workflow-jobs).
