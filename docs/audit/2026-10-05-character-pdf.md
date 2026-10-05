# Filled character PDF import — 2026-10-05

Starting main: `c662deb270c61206d293cf9ab379781fcb414a29`. Branch: `fix/character-pdf-fields`. Consult its PR for exact verification and release status.

## Reproduction and correction

The user supplied a four-page filled PDF whose Widget annotations retain values but whose document-level AcroForm field index is absent. PDF.js returns null for the index and only printed labels from page text. Before the fix, the application interpreted Strength as the name, SPECIES as the class, EXPERIENCE POINTS as the background, and twelve labels/footer fragments as equipment. Empty personality sections consumed neighboring headings. The new regression tests failed before implementation.

The reader now collects filled page widgets as well as indexed form fields. Text fallback refuses adjacent printed labels as identity values and stops sections at headings, page boundaries and copyright footers. This preserves ordinary labeled text and OCR imports. Known export aliases populate Animal Handling, hit dice and passive perception; numbered feature/action columns are retained. Numbered equipment rows preserve explicit quantities without inventing entries for empty rows. Attack formulas exclude damage-type prose (retained in notes); fixed damage is supported without inventing dice. Six ability scores, 18 skills, features, actions and the source's fixed-damage attack were verified against the supplied PDF. No rules-derived recalculation substitutes for printed values.

The original PDF and screenshots remain private local inputs and are not committed. Synthetic fixtures exercise indexed and orphaned widgets through the real picker, review dialog, saved character and reload. Existing scanned-PDF browser coverage remains required, along with permission/finance, account, Worker, standby and live release gates.

This correction prevents new bad imports. It does not silently delete previously imported inventory or replace unspecified fields in an existing character. A fresh import has empty inventory when the source has none; cleaning an existing mistaken import remains an explicit edit. Unspecified current HP still uses the existing review/editor defaults; the source's maximum HP is retained. Scans still require human review and are not claimed infallible.

## Local evidence

- Node 22, Linux, compatible Chromium, disposable local accounts; no real campaign mutations.
- Supplied PDF processed through the browser's actual `readCharacterSheet` entry point: all expected identity/score/skill/feature/attack assertions passed, zero equipment or spell entries. Reader time 2.331 seconds including initial PDF module/worker setup; no comparable baseline exists, so no speedup is claimed.
- Expanded encounter browser audit passed: existing statblock/scanned-PDF imports and gameplay/loot permissions, plus indexed and orphan-widget imports and persistence after reload.
- `verify:quick`: 486 passed, 4 existing skips; clean type checking; 0 lint errors / 35 existing warnings. Proxy warnings were suppressed for the existing stderr-JSON unit test. Local Wrangler environment limitation is unchanged; packaged verification remains required in CI.

## Performance analysis before release

Read-only history synchronization: 158 qualifying observations, 27 repeated open trends, no pending runs. The latest recorder checkpoint captured the prior release through 2026-10-05 05:27 UTC (successful recorder run 37267891770). No new observations since PR #37's final checkpoint. No reset is justified by a character parsing correction. After CI/release, inspect new rows and recorder freshness in the PR checkpoint.

Prior comparable PR verification 211s, main verification 202s, deployment 105s. Report subsequent changes against these scopes separately; do not add overlapping jobs. Added PDF browser cases increase the encounter audit workload; the earlier 8s → 20s trend predates these additions and remains unexplained. Prior portrait coverage explains additional work in account suites but is not proof that every observed increase is resolved. Setup/cache/upload changes and one-second timing precision require continued review.

| Operation                                                                                     | State | Logged increases | Original → latest | Total added | Cumulative increase |
| --------------------------------------------------------------------------------------------- | ----- | ---------------: | ----------------: | ----------: | ------------------: |
| Development / gameplay / Run actions/setup-node@v4                                            | open  |                2 |           3s → 7s |         +4s |            +133.33% |
| Development / desktop / Run actions/setup-node@v4                                             | open  |                2 |           3s → 7s |         +4s |            +133.33% |
| Development / desktop / Run npm ci                                                            | open  |                2 |         11s → 16s |         +5s |             +45.45% |
| Development / gameplay / Start disposable development server                                  | open  |                2 |           4s → 8s |         +4s |               +100% |
| Development / gameplay / dev-encounter                                                        | open  |                3 |          8s → 20s |        +12s |               +150% |
| Packaged Worker / interface / Run actions/setup-node@v4                                       | open  |                3 |           2s → 6s |         +4s |               +200% |
| Packaged Worker / accounts / Run npm ci                                                       | open  |                2 |          8s → 14s |         +6s |                +75% |
| Packaged Worker / interface / Run actions/download-artifact@v4                                | open  |                2 |           1s → 3s |         +2s |               +200% |
| Packaged Worker / accounts / Start disposable built Worker                                    | open  |                2 |           5s → 7s |         +2s |                +40% |
| Packaged Worker / accounts / worker-monitor                                                   | open  |                2 |           5s → 7s |         +2s |                +40% |
| Development / governance / Run npm ci                                                         | open  |                2 |          7s → 17s |        +10s |            +142.86% |
| Development / governance / Start disposable development server                                | open  |                2 |           4s → 8s |         +4s |               +100% |
| Development / governance / dev-campaign-governance                                            | open  |                2 |         18s → 48s |        +30s |            +166.67% |
| Packaged standby / standby-audit                                                              | open  |                2 |         20s → 42s |        +22s |               +110% |
| Packaged standby                                                                              | open  |                2 |         62s → 94s |        +32s |             +51.61% |
| publish / Run actions/download-artifact@v4                                                    | open  |                2 |           1s → 3s |         +2s |               +200% |
| Publish verified standby                                                                      | open  |                2 |         10s → 18s |         +8s |                +80% |
| publish                                                                                       | open  |                2 |         10s → 18s |         +8s |                +80% |
| Packaged Worker / accounts / Run actions/download-artifact@v4                                 | open  |                2 |           1s → 3s |         +2s |               +200% |
| Packaged Worker / accounts / Run actions/upload-artifact@v4                                   | open  |                2 |           1s → 3s |         +2s |               +200% |
| Packaged Worker / accounts / worker-account                                                   | open  |                2 |         22s → 40s |        +18s |             +81.82% |
| Development / gameplay / Run actions/setup-node@v4                                            | open  |                2 |           2s → 4s |         +2s |               +100% |
| Packaged standby / Run actions/setup-node@v4                                                  | open  |                2 |           2s → 4s |         +2s |               +100% |
| Packaged Worker / interface / Run npm ci                                                      | open  |                2 |         11s → 15s |         +4s |             +36.36% |
| Development / gameplay / Run actions/upload-artifact@v4                                       | open  |                2 |           1s → 3s |         +2s |               +200% |
| deploy / Check current main, existing bindings and applied migrations; deploy without rebuild | open  |                2 |          9s → 15s |         +6s |             +66.67% |
| Packaged Worker / accounts                                                                    | open  |                2 |        85s → 120s |        +35s |             +41.18% |


## Diagnosed standby test isolation failure

PR run 37269258333 passed every group except the standby account audit. Its final portrait scenario received HTTP 429 while creating the synthetic account. The Node transport correctly discards caller CF identity headers outside its trusted proxy mode; the audit had therefore grouped every synthetic device under localhost. Minute-window timing concealed this on earlier runs. This is a fixture isolation defect, not evidence that the PDF import failed.

The loopback-only audit server now emulates the trusted proxy hop using the fixture's distinct device addresses. Production transport, account limits, security settings and all five scenarios are unchanged. A direct-transport regression assertion confirms spoofed forwarding headers still cannot replace the socket IP. The same immutable standby artifact from the failed job was verified by manifest/hash and passed the entire local five-scenario audit with this correction: 37.1s browser execution, 38.184s audit process. Complete quick checks also passed again (486 pass / 4 existing skips / clean types / 35 existing warnings). They overlapped the local audit; this is an initial measurement, not a claimed comparable improvement. A fresh complete CI run remains required because test source changed.
