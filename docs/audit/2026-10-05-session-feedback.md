# Session feedback verification — 2026-10-05

Work branch: `fix/session-feedback`. Starting release: `313c9ae1ad69a80fd24096d9460b00063e562825`. A branch checkpoint is not a release; see the PR and deployment audit for final status.

## Acceptance coverage

- Live DM award to a selected player appears in the campaign-backed account character without reloading. Saves after an award use stable equipment ordering.
- Portrait updates reach both the joined player and a second browser signed into the same account without joining that room. Unsaved local drafts are retained.
- One document-level notification host dismisses completed notifications on route changes and bounds ordinary notification lifetime.
- DM Settings & Management → Players & permissions has individual grants; a maximum-HP grant can apply immediately while armor class remains locked. Server checks remain authoritative.
- Character import is visible for signed-in players, supports PDF/image/JSON, reviews extraction before applying it, and preserves unspecified fields in partial updates. Legacy text remains available; explicit attacks, equipment, leveled spells and resources populate their playable tabs.
- Statblock images use private, same-origin OCR and require review. The supplied Goblin produced AC 15, HP 7, initiative +2, CR 1/4 and 50 XP at 92% recognition confidence, measured at 1.949 seconds locally. This is a new operation with no previous comparable speed baseline.
- Synthetic browser fixtures cover statblock-image review and an image-only character PDF. The original failing character PDFs were not supplied, so their exact fidelity is not claimed. Recognition uncertainty and editor defaults require review.
- Starting a session offers downtime; an explicit 0 saves the opt-out. Positive downtime retains the existing preview/approval workflow.
- The collaborative journal uses contents and dated pages, retaining visibility choices, report attachments and entry creation. Desktop/mobile layout is inspected.

## Performance-history analysis before release

The persistent log was fetched on October 5, 2026. Recorder [37260175083](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37260175083) succeeded. The log contains 91 qualifying observations and six repeated open trends. All history and references remain intact; no reset is justified by the current evidence.

| Repeated operation | Initial → latest logged | Added | Increase | Logged rises |
| --- | --- | --- | --- | --- |
| Development desktop / setup-node | 3s → 7s | 4s | 133.33% | 2 |
| Development gameplay / server startup | 4s → 8s | 4s | 100% | 2 |
| Packaged interface / setup-node | 2s → 5s | 3s | 150% | 2 |
| Packaged accounts / npm ci | 8s → 14s | 6s | 75% | 2 |
| Packaged accounts / Worker startup | 5s → 7s | 2s | 40% | 2 |
| Packaged accounts / monitor audit | 5s → 7s | 2s | 40% | 2 |

Setup/cache/runner variability is a plausible contributor, not a confirmed cause. These are mainly short operations with one-second timestamp resolution. Keep their observations; inspect repeated future rises against actual execution and total waiting time before changing infrastructure.

All 91 entries were reviewed by operation: setup, checkout, dependency/browser install, artifact upload/download, server startup, audit execution, workflow/job totals and queue delay. Existing larger unresolved signals include gameplay job 141s → 168s (+27s, +19.15%), governance job 110s → 166s (+56s, +50.91%), and failure-report queue 3s → 39s (+36s, +1200%). These are separate from production request latency. Deployment action 9s → 11s (+2s, +22.22%) also remains open.

Actual whole-main verification [37235752710](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37235752710) → [37254074683](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37254074683) was 3m31s → 3m37s: +6s (+2.84%), below the logging threshold. Overlapping job times were not summed. The latest pre-change PR verification [37253804812](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37253804812) lasted 3m18s; latest successful deployment [37254338872](https://github.com/UnregisteredMusket/Lootsplit/actions/runs/37254338872) lasted 1m41s. Use these same-scope runs for the eventual release comparison.

New OCR assets and expanded governance/encounter acceptance checks increase coverage and workload. Preserve automatic >=15% observations rather than erasing or renaming baselines. Analyze any increase after the new CI run, distinguishing added OCR work from unchanged audits. Do not claim a percentage speedup for the total development task, whose scope includes nine reported issues and an additional cross-device portrait bug.

## Local verification environment

Node 22 and Chromium on Linux, disposable local accounts/campaigns only. Server and browser run as children of one command because this environment isolates loopback networking between command invocations. The legacy stderr-JSON unit test requires `NODE_NO_WARNINGS=1` locally due to an injected proxy warning; CI retains its standard environment. Packaged Cloudflare execution is gated by CI because local Wrangler fails at `uv_interface_addresses`. No release gate has been removed.

