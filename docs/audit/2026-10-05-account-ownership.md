# Account-owned campaigns and session access

## Authorized behavior

The user explicitly chose account-required DM hosting; DM-owned campaign saves; guest entry only with a current session invitation; revoked player access and invitations on explicit End session; DM-only offline campaigns; and account player resume across devices. Accepted adjustments retain guest reconnection during the open session, make tab closure non-destructive, and preserve deliberate multi-campaign selection. Offline player sharing is intentionally retired. Existing saves and DM report recovery remain readable.

## Implementation

- Authenticated room creation writes the campaign and owner membership together. Room updates and newly authenticated player seats use revision-checked writes and matching-body membership predicates. Account linking cannot claim another account's seat.
- Stable campaign identity is separate from a rotating invitation generation. Reopening preserves the campaign and invalidates old session links, specific invitations and old player tokens. Returning account players retain character association; new credentials protect the reopened session.
- A startup account gate precedes opening campaign storage. Existing device DM saves require explicit claiming; an active legacy room is linked on the server before completing that claim. Cached DM copies stay account-scoped; selecting another account campaign never merges by name.
- Player campaign contents use the existing Apache-2.0 fake-indexeddb dependency in memory, including signed-in player sessions. Only reconnect credentials persist in sessionStorage. Server-staged turns can recover after reload; guest actions that never reached the server stay in memory, with an unload warning. No guest campaign backup is written to persistent device storage.
- Explicit End session retains the authoritative server campaign. Closing a tab and signing out do not end the room. A DM's device copy is preserved on sign-out. Account player memberships are saved automatically. The packaged client forwards its existing bearer token only to the fixed Worker server-function destination.
- Offline DM edits remain in the owned device copy until explicitly backed up or shared; do not silently overwrite a newer server campaign. Legacy device saves are never auto-deleted. The website and help explain the changed model.

## Verification and preservation

Backend account tests cover automatic ownership, account isolation, unchanged saved characters, rotated links, old-token rejection, same-account reconnect, and fresh-session player assignment. The browser `ownership` scenario verifies anonymous entry, explicit claim, actual hosting and copied invitations, guest refresh without persistent IndexedDB, session closure, old-link rejection, signed-in player resume on another browser, and a player reload after the DM tab closes.

The full eight-scenario account suite and quick checks are required, alongside the unchanged PR/main preservation groups. Related local audits cover governance/permissions, portraits and inventory, encrypted backups, finance, local and shared encounters, and interrupted guest actions. The interrupted-action audit now asserts in-memory retry and absence of persisted guest commands, reflecting the explicitly authorized storage change. Its finance setup selects the actually controlled character.

Existing broad gameplay fixtures provision real authenticated DMs on disposable localhost services, never on production. Read-only live checks now expect the anonymous account gate; title, keyboard, reduced-motion, identity and complete asset-hash checks remain required. Do not infer release success from this source checkpoint or a merge.

## Performance review

Read-only history synchronization on 2026-10-05 found 243 recorded slowdowns, no pending captures and no new observations before this release. The durable reference was c966335d5ce54d9bcad407a68dac3f6702ae57ec. Existing repeated trends remain open, including main account verification 59→114 seconds (+55s, +93.22%, three increases), main packaged account verification 25→60 seconds (+35s, +140%, four increases), and PR packaged account verification 22→58 seconds (+36s, +163.64%, four increases). No trend is reset: this change does not diagnose or resolve those historical runner/workload trends.

The initial local account run exposed duplicate identity reads exhausting the existing request quota, and unnecessarily closing an in-use memory database during auth refresh. Coalescing brief UI identity reads and preserving the database lifetime resolved those reproduced failures; server authentication and rate limits remain enforced. Rapid control-panel navigation now uses real internal links, matching normal navigation without repeated document authentication. These are correctness fixes, not a claimed measured speedup.

The new ownership scenario and authenticated fixtures change workload. Establish a new comparable local baseline after the final source checkpoint. CI's existing collector continues logging qualifying >=15% increases against the last logged reference; faster/sub-threshold runs do not move it. Compare release wall time, PR verification, main verification and deployment separately and explain added coverage. Consult the PR for exact final measurements and live evidence.
