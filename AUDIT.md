# Update for 1.1.1 — October 1, 2026

Finding A03 below is superseded: Google Drive was deliberately removed and replaced with device backups. The existing save system serves all three modes; separate mode-specific storage would duplicate it. Shared snapshots now refresh first, reject personal pending actions, and cannot be loaded over an active connection. Diagnostics remain local downloads. Password migration now updates the campaign password inside re-encrypted backups as well as the outer encryption. The historical 1.1.0 audit follows.

# Lootsplit 1.1.0 audit

Date: October 1, 2026. Scope: application source, local and shared economy flows, server authorization, persistence, backups, navigation, instructions, build, and dependencies. This report supersedes the earlier audit. Priority 1 = high, address before relying on the affected workflow; priority 2 = medium; priority 3 = low/optimization. Verification gaps and configuration requirements are identified separately from confirmed defects.

## Results

312 automated tests passed, none failed, and four repository-tooling tests were skipped because the original Grok skill documents were absent from the uploaded source. This comprises 191 tooling tests, 66 app tests, and 55 data/auth tests. TypeScript checking and the production build passed. ESLint reports zero errors and nine development Fast Refresh warnings. The dependency audit reports zero known vulnerabilities at the time of this audit; it does not establish that every dependency is vulnerability-free.

Browser checks use the production build, Chromium, isolated DM/player browser contexts, and a SQLite implementation of the D1 interface. They do not constitute a production D1 test or real-phone network test. Test data was separate from the user's campaign.

## Audit passes

1. **Architecture and permissions:** traced Local, Turn-based, and Live paths from controls through client persistence to server storage. Replaced writable shared snapshots with validated commands and conflict-checked DM patches. Reviewed player privacy and prohibited unauthorized financial and role changes.
2. **Transactions and recovery:** exercised concurrent purchase attempts, last-stock contention, retries, duplicate loan approvals, atomic batches, turn ownership, draft staging, mode transitions, release/rejoin, closed rooms, and report conflicts. Added regression tests for these boundaries.
3. **Backups and password protection:** checked round-trip metadata, encrypted exports, password changes, restore authorization, and legacy password compatibility. Browser testing exposed and prompted a fix for stale backup references after password changes. Verified create → re-encrypt → export → restore.
4. **UI and instructions:** reviewed mode controls, help, party permissions, handouts, chat, recovery controls, and unsupported integration wording. Checked all seven main routes at 390×844 and 1280×800, persistent local holdings, mobile navigation, and horizontal overflow. No uncaught page errors in these scenarios.
5. **Release regression:** ran the complete test suites, type check, production build, lint, dependency audit, and whitespace check. Replayed the two-context multiplayer workflow against the production build.

## Mode verification

| Mode | Implementation and behavior | Evidence |
| --- | --- | --- |
| Local | Each browser owns a separate IndexedDB campaign. Player copies return activity reports. Reports now include original balances, inventory, and stock; conflicts reject the whole import. Reimporting the same accepted report does nothing. A fresh player copy is needed after reconciliation. | Automated report encoding, conflict, atomicity, and duplicate-import tests; local browser persistence checks. |
| Turn-based | The server checks the current participant. Financial actions become staged drafts; submitting applies a validated batch and advances the turn. Chat works outside the financial turn. Pending server drafts block skipping, closing, or mode switching. | Server tests plus a player purchase, reload with intact draft, submission, and return of the turn to the DM in separate browser contexts. |
| Live | Players submit operations immediately; server-side revision checks serialize conflicting writes. Costs and permissions come from server state. Retried command IDs cannot charge twice. Failed operations remain recoverable. | Concurrent transaction tests; browser purchase synchronization, player-to-DM chat, and visible recovery after room closure. |

Local report exchange remains a DM-reviewed cooperative workflow. Shared online financial commands are server validated; this does not make the entire tabletop application an anti-cheat system.

## Remaining findings and priorities

| ID | Priority | Type | Finding / next action |
| --- | --- | --- | --- |
| A01 | 1 | Configuration | The published site remains owner-private. Other people need site access before a room code is useful. Set the intended audience before a group session; the audit did not broaden access. |
| A02 | 1 | Verification gap | Production D1 behavior, actual iOS/Android browsers, and unstable-network multi-device play have not been exercised end to end. Run a small group rehearsal covering disconnect/reconnect, duplicate taps, background/resume, and room closure before relying on shared play for important campaign data. |
| A03 | 2 | Missing integration | Google Drive authorization/upload is not implemented for this host. The UI now states this and provides local diagnostic downloads. Campaign export and encrypted local backups work. A supported Drive connector and authorization flow are required for cloud backup. |
| A04 | 2 | Recovery limitation | Actions that never reached the server cannot block a DM's mode change or room closure. They remain locally recoverable/exportable. Recovery import requires the same room code; closed-room actions require manual reconciliation into a new room. |
| A05 | 2 | Compatibility limitation | Older activity reports without the new baseline cannot be automatically reconciled safely. Import is rejected with guidance. Reconcile legacy activity manually and issue a fresh player copy. |
| A06 | 2 | Hardening before broad sharing | Room access uses codes and bearer seat tokens, without individual account verification, DM join approval, room quotas, or a dedicated rate limiter. Current private hosting limits exposure. Add those controls before opening access to an untrusted audience. |
| A07 | 2 | Verification gap | Real character-sheet/PDF files were not tested end to end in this pass. Existing parser tests run, but field layouts vary. Image-only scans do not provide the text needed by the existing parser. |
| A08 | 3 | Performance | Shared rooms poll complete snapshots every two seconds. Unchanged revisions avoid IndexedDB rewrites, but network payloads still grow with history. Add conditional/delta responses or a push transport if room size or usage warrants it. |
| A09 | 3 | Growth/maintenance | Room command receipts and ledger/history arrays have no archival policy; large or long-running campaigns have not been load-tested. Add bounded receipts with a safe retry horizon and archive historical records. |
| A10 | 3 | Development warnings | Nine Fast Refresh warnings remain from modules exporting both React components/hooks and other values. Split modules during cleanup; production type checking and build pass. |
| A11 | 3 | Backup limitation | Existing exported encrypted files retain their original derivation settings and password. Re-export to upgrade old archives. Password migration uses separate campaign and backup databases: ordinary errors roll back, but abrupt termination between those writes is not fully crash-atomic. Keep an exported backup before password migration. |
| A12 | 3 | Development limitation | The filesystem room-store fallback is for local development; it is not a safe multi-process deployment store. The production deployment uses D1 revision checks. |
| A13 | 3 | Feature boundary | Notifications depend on the app running; there is no implemented closed-app push service. Offline cold launch is not guaranteed. Do not describe either as an available feature. |

No additional reproducible blocker was found in the tested workflows after the fixes. This is a scoped audit with explicit remaining gaps, not a guarantee that every device, input file, or campaign state is covered.

## Suggested next verification session

After granting the intended party access, use disposable campaign data on two real phones and one DM browser. Test purchases competing for one remaining item, turn submission after losing connectivity, reopening the app with an unsent action, party-fund permission changes, releasing a character, and changing modes with a staged draft. Export a backup, restore it on a separate device, and try representative character PDFs. Record browser versions and failed steps before expanding the audience.
