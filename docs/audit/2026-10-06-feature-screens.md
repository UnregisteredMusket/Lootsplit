# Feature screens and player Home

Baseline: released main `8614403c64469a93680fe6d0537139614aca96b2` (PR49). Branch: `feature/feature-screens`. User approved implementation after the navigation workshop. Application checkpoint: `735574d212cc2e0b12cf7c8bb8d95455a3bcbdaf`. Implemented and locally verified; not a published release.

## Changes and preservation

- Reorganized existing finance, operations, reports and journal tools into full feature screens, compact entry cards and Return-to-origin navigation. Existing parchment/theme components remain. Mobile retains five primary destinations; desktop has direct feature links.
- Added Player Home with assigned character readouts, full-sheet access, feature links and signed-in account shortcuts. Guests have fixed links without preference storage/customization.
- Bank contains player applications/repayment/payment requests and DM loan/approval controls. Downtime settlement is separate. My Finances exposes only assigned-character agreements, balances and transaction records; standalone account sheets remain independent.
- Property management permits descriptive name/notes changes only, checks prior values, and preserves ownership, quantity, value and finance rules. DM retains revenue/upkeep configuration. No foreclosure or new property acquisition rules are activated.
- Review Reports reuses existing session-summary calculations, archived reports, activity and price history. Review Inbox preserves account-character approval including saved campaigns not currently joined. Site/owner analytics remain in their existing account area.
- Account shortcut preferences use additive migration0010, user/role ownership and revision compare-and-set. Legacy device DM favorites can seed the first explicit account save; their old financial-review destination maps to Bank. Previously verified DM campaign owners retain readonly cached destinations offline. Account preferences, caches, financial audit records and retries serve distinct purposes.
- Shared repayment/property commands use existing server authorization, command receipts, synchronization and turn submission. No duplicate wallet, accounting store, financial scheduler, listener or polling service was added. Existing requests retain their existing meaning and approval rules.

## Verification checkpoint

Node22.23.3/Linux x64/Chromium133, disposable local databases only. Final quick checks passed: **508 tests, four pre-existing skips, clean TypeScript, zero lint errors /34 existing warnings**. Web/mobile builds passed. Finance, control-panel, library navigation, character, expanded governance (including anonymous guest Home), help and desktop browser checks passed. All eight account scenarios passed, including sign-in/recovery, portraits, invitations, ownership, campaign choice and cross-device resume.

| Bounded local operation | Duration |
| --- | ---: |
| Complete quick checks |27.322s|
| Cloudflare web build |7.543s|
| Mobile client build |4.224s|
| Eight account scenarios including setup |98.204s|
| Expanded governance |60.271s|
| Help/legacy links |14.026s|
| Control panel |18.436s|
| Desktop responsive audit |66.791s|
| Finance workflow |29.099s|

New comparable references are recorded in `performance/manual-measurements.jsonl` with environment/scope labels. The account measurement did not reach the existing15% slowdown threshold, so its reference remains unchanged. Quick/build checks overlapped; desktop/accounts overlapped. Durations are not additive and are not total development time. No before/after performance improvement is claimed.

Browser checks exercise original workflows (loans, recurring finances, downtime, property income/upkeep, shop restock, separate campaigns, session archives, player edits, character imports and title-screen navigation), plus actual player repayment/property rename/account shortcut persistence. An initial browser failure identified missing submit types on new shared Button forms; fixed and the real actions then passed. Other fixture failures were old-route assertions and a guest setup helper that automatically provisioned a DM account; assertions were adapted to the approved navigation and guest setup now explicitly stays anonymous.

Backend regressions cover ownership and stale property descriptions, repayment debt limits/pending downtime, private finance projection, authenticated shortcut ownership/role separation and409 stale saves. Existing server financial permissions remain authoritative. A mobile client build is not a physical Android test or signed APK publication.

## Performance and release limits

No runtime speed improvement is claimed. This is a navigation and usability change with expanded test workloads. No heavy dependency or new background polling was added. Final bounded timings are retained separately; expanded governance/finance checks cannot be compared as identical workloads to earlier narrower checks.

Performance history was read through the connected GitHub API because direct recovery HTTP returned403. Latest history has347 observations, no pending collections, and includes release37412626230. Recorder37412824045 succeeded. Existing setup, encounter, standby and verification trends remain unresolved; this UI change does not establish a fix and no reference is reset. Since the previous roadmap report,14 additional observations remain preserved:

| Operation | Before → after | Added | Increase |
| --- | --- | --- | --- |
| Dev account browser install |27 →32s|5s|18.52%|
| Dev finance |20 →28s|8s|40%|
| Worker interface browser install |26 →35s|9s|34.62%|
| Dev character |13 →16s|3s|23.08%|
| Lint |7 →9s|2s|28.57%|
| Standby Node setup |6 →11s|5s|83.33%|
| Standby browser install |31 →38s|7s|22.58%|
| Worker theme |15 →19s|4s|26.67%|
| Worker sound |6 →8s|2s|33.33%|
| Dev party sheet |17 →20s|3s|17.65%|
| Worker loot |5 →6s|1s|20%|
| Worker finance |13 →15s|2s|15.38%|
| Standby queue |4 →5s|1s|25%|
| Website preflight/deployment |15 →28s|13s|86.67%|

These are prior-release observations (37411859467,37412269946,37412626382,37412626230), not measurements of this unsubmitted branch. Setup/queue entries measure infrastructure; gameplay/short-step entries need equivalent next-run comparison; finance/character coverage expanded in PR49. Deployment includes external preflight/upload, not application response time. Preserve evidence and inspect equivalent full CI before diagnosing a source regression. Parallel durations must not be added as total wait time.

## Remaining release gates

The user approved publication, additive migration0010 and gated deployment on 2026-10-06. No GitHub publication, new production migration, merge or deployment has occurred at this authorization checkpoint. Prepare exact-head full PR verification, reviewed additive migration0010, gated main verification/deployment and read-only live identity/assets/browser checks under that authorization. Do not reapply migration0009 or repeat PR49 release actions. Existing installed APKs require a separately authorized signed update; signing identity remains unchanged. Domain activation and taxes are outside this scope.
