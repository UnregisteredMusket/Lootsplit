# Functional foundation before UI redesign

The owner authorized implementation of the October 12 feature/backend review, followed by a separate UI redesign. Preserve every existing capability, saved record, role, platform and gameplay rule. This phase improves the existing tools and protocols; it does not redesign the app shell or activate optional metered infrastructure without evidence of need.

## Acceptance and report mapping

| Report item | Work and acceptance |
| --- | --- |
| F01 runtime configuration | Pin the existing 10,000 ms CPU cap, persistent invocation logs and query redaction in the immutable artifact. Verify the actual post-deploy values; fail closed on drift. |
| F02/F04/F12 sync and processing | Benchmark synthetic fixed-size rooms before/after. Add authenticated unchanged reads without returning/hydrating unchanged campaign payloads; retain account/seat revocation, encounter-active freshness, acknowledgements, drafts, legacy clients and explicit full refresh. Add privacy-safe timing labels. Optimize owned command batches only with unchanged validation/atomicity. |
| F03 verification balance | Move complete independent audits to existing less-loaded groups without changing scenarios, assertions, deadlines, worker counts or the mandatory nine-job gate. Document comparable versus redistributed timings. |
| F05/F06/F15 documentation and inventory | Reconcile current OCR/navigation/maps/ship behavior, regenerate reviewed callable/control evidence, update both Help guides, README and the manual. Preserve historical audits. |
| F07 Android parity | Prepare a separately signed update containing the verified current functional source; verify artifact identity/certificate and update actual download metadata after publication. Web/mobile builds are not distribution. |
| F08 training totals | Add recipient/category totals across teachers and stable normalized subject grouping while preserving original descriptions, per-teacher history, lifetime time, historical conversions and existing group resets. DM-wide resets must never refund hours or alter characters. |
| F09 historical training | Capture/review historical circumstances explicitly. Present-day movement/level changes must not block deliberately reviewed historical time; current ownership/visibility, approved-period budgets, stale checks and DM confirmation remain authoritative. Preserve ordinary current-context checks. |
| F10 units | Make calendar/usable/work/training-day units explicit. Add a reviewed hour adapter for away activity while preserving old whole-day commands, elapsed clock and recipe/ship semantics. |
| F11 notifications | Reconcile actual provider/configuration access, expose honest readiness and preserve sanitized retry-safe failure reports. No inferred recipient or claimed email delivery. Missing inaccessible credentials remain a named external blocker. |
| F13/F14 conditional infrastructure | Measure asset/media work and retain recovery fencing, private media authorization and primary SQL consistency. Record whether a further R2/DO/replica migration is justified; do not turn an option into an automatic infrastructure change. |
| F16 scope register | Keep live manual training and future self/environment activities distinct. The ten additional activities and unrelated deferred tax/foreclosure/game-rule proposals are not included in this foundation phase. |

## Verification and continuity

Use Node22, focused regressions and fixed-input local benchmarks before full CI. Local Chromium availability must be reported honestly; an unavailable executable is an environment gap, not evidence of a product failure. Existing current-browser development and immutable Worker checks close that gap. Preserve guest document-memory, current account/room identities, private projections, financial receipts and old saves.

Branch `improvement/report-followup` starts from verified live main `3b391090c3e954da25dc9e4cad4f547ce029827c`. Exact evolving head/tree, tests, PR/run IDs and next action are checkpointed under ignored `test-results/report-followup/` and in the publication PR. Do not restart finished releases after an interruption.

The UI redesign starts after this functional release is verified. Carry forward the full feature tree, role/permission matrix, canonical data connections and current capabilities as its preservation contract. Navigation/layout changes need an explicit preview and review in that later phase.
