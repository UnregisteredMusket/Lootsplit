# Hourly downtime and NPC training

The shared campaign clock and stored DM-approved financial preview remain canonical. Approving a positive downtime period creates a separate per-character resource window: by default **16 usable hours per day**. Property labor actually performed and existing away activities consume that same resource. Travel aboard a ship does not consume personal hours. Voyage progress, upkeep, smith work, deliveries, finances and explicit session-hour advances retain their existing rules. No wall-clock scheduler or duplicate wallet is added.

Players log training against an approved period; the DM reviews the recorded time before it counts. Unused hours remain attached to that period, so they cannot inflate another day's allowance. An old period remains reviewable for late session bookkeeping; a request does not advance campaign time. The DM confirms that its context and time describe the activity performed. Future planning before financial approval can be added without changing these immutable period identities.

## Implemented training contract

- Home → Downtime & NPC training is available to players, and the existing DM Downtime tools remain available. Review Inbox includes pending training.
- Select the assigned trainer, existing NPC, Martial / Academic / Skill or Profession, subject, hours and free-text description. An optional class name requests a class-level comparison in addition to total character levels.
- The NPC must be equal or lower level. Known higher character/class levels fail. When a sheet or recognizable class-level text is absent, the DM must explicitly confirm eligibility in the decision note. No sheet is created for a sheetless NPC. Private NPC sheets and time balances remain private.
- For ordinary current-context requests, both characters must be visible and together: same active party, canonical individual location, or same ship. Active away activities must first finish/cancel. Approval rechecks the current participants, levels and hour balances. For late bookkeeping, select **Record training completed earlier** and describe its historical location, timing and levels. The DM may also mark an earlier pending request as historical. Approval then requires the historical-confirmation checkbox and a written review note; it verifies eligibility as it was then, while current ownership/visibility and the original period's hour balances remain mandatory. Historical mode cannot self-approve or add hours.
- Submitted requests reserve hours for both participants. All three categories compete for the same pool. Approval counts time; denial/cancellation releases pending time. Shared retry receipts preserve one-time requests/decisions. Turn-based drafts retain normal submission and recovery.
- NPC/category totals combine all trainers and subjects for the DM; players see only their own contributions and these are labeled accordingly. Subjects group using normalized spacing/case/Unicode without rewriting original request text. Per-trainer/subject counters and previous resets remain available.
- Counters retain lifetime and since-reset hours and training days by trainer, recipient, category and subject. A default training day is **8 hours**. Both daily allowance and training-day conversion are DM-configurable from 1–24 hours, for new periods only. Historical day totals sum each entry using its captured conversion.
- DM category reset covers the reviewed outstanding entries across trainers/subjects; stale totals are rejected. It stores individual reset history, preserving every original request.
- DM milestone & reset requires a manual reward/change note. It resets only the current counter; lifetime totals, descriptions, original approvals and reset history remain. No resource refund, character edit, proficiency, level, money or item is granted.
- Metadata is optional journal state, preserved in old journal writes, saves, archives, recovery and cross-device rooms. No database migration or separately published APK is needed for the website change. Android distribution still needs its signed release process.

## Time units and away activities

A calendar day is 24 elapsed campaign hours. An approved downtime day gives the configured usable allowance (16 hours by default). A training day displays approved training using its captured conversion (8 hours by default). A full property labor day consumes that period's usable allowance; a fractional assignment consumes the same fraction. These quantities are not interchangeable.

DM character placement supports elapsed campaign hours in quarter-hour increments as well as legacy whole calendar days. Existing commands/saves retain exact return times. Away activity commitments keep the original prorating: elapsed minutes / 1,440 × usable hours per day. At default settings, six elapsed hours occupy four usable hours of a covered downtime day. Session-hour advancement retains its established finances/return behavior and does not create a new downtime resource period or move a voyage.

## Additional activities — design proposal, not implemented

Use the same approved period budgets, free-text goals, category/subject totals, pending → reviewed time, immutable lifetime history and DM milestone/reset record. A milestone is a DM-set hour threshold with a reward description; reaching it marks **ready for DM review**, never applies a reward. A DM may award, defer, refuse, or award and reset. Resetting does not restore the time resource. All prices, checks, prerequisites and rewards remain campaign-specific.

| Activity | Who / where | Example progress goal | DM milestone examples, applied manually |
| --- | --- | --- | --- |
| Personal martial practice | Self; safe space or training equipment | Weapon drills, stance or tactics; accumulated hours | A learned technique, instructor introduction, or agreed proficiency progress |
| Academic study | Self; books, teacher or institution | Language, history, theology or arcane theory | Understanding a text, a research lead, or agreed language/proficiency progress |
| Skill / profession practice | Self; suitable tools/workplace | Navigation, performance, medicine, craft or trade | Professional recognition, contacts, or an agreed skill advancement |
| Research & investigation | Self/group; local archive, witness or site | A specific question or mystery | A clue, answer, contact or access to a new source |
| Local scouting & surveying | Self/group; accessible surrounding terrain | Route, district, ruin or hazard survey | Revealed map information, safer route or a site description |
| Foraging & material gathering | Self/group; suitable environment and tools | Search for specified food/herbs/materials | DM-selected findings manually added through canonical loot/material controls |
| Contacts & reputation | Self/group; present community or faction | Build trust, seek employment or establish a contact | A contact, introduction, audience or negotiated service access |
| Crafting research & experimentation | Self/group; workshop/lab | Develop a design, test a formula or prototype | A DM-approved recipe or design; actual production stays with property/smith projects |
| Community service | Self/group; local organization | Repair aid, teaching, healing or relief work | A relationship, recognition, favor or campaign-specific benefit |
| Reflection & creative work | Self; appropriate quiet/work space | Journal, compose, memorialize or recover focus | A completed narrative work or agreed story milestone |

For group activities, each participant contributes their own reserved hours with individual approval/ownership. NPC teaching charges both trainer and pupil; self actions charge only self. A payer, assistant or site owner is never implicitly granted character control. Environmental requirements are reviewed with the canonical location or ship identity; shipboard research/practice is possible if the DM approves its conditions.

Existing construction, ship repair, production and blacksmith commissions keep actual materials, costs and outputs in their existing engines. A tracking action cannot manufacture a second output, provide remote access, claim automatic income, or spend the same labor twice. Monetary rewards and loot use current authoritative commands after the DM chooses them.

Example default day: 4 hours martial practice + 6 hours research + 2 hours contacts + 4 hours NPC training = 16 personal hours. The NPC also allocates 4 hours. Ship travel can advance concurrently without reducing either allowance. A 16-hour training-only allocation represents 2 training days at the default 8-hour conversion, rather than two elapsed calendar days.

## Verification and maintenance

Run downtime-activities, finance, estate, character-position, ships, blacksmith and shared room regressions; quick checks; web/mobile builds; the dedicated desktop/mobile downtime browser audit in development and the immutable Worker; both Help and all preservation gates. Check player projections and optimistic turn drafts against hidden NPC resource balances. Never use real campaigns for training or reset tests.

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Hourly downtime and NPC training

Read `docs/DOWNTIME-ACTIVITIES.md`. `downtimeActivities` is optional journal metadata; only reviewed commands mutate it. Approving the existing financial preview creates a per-character resource window (default 16 usable hours/day), deducting actual property labor and existing away activities. Ship travel consumes no personal time. Session-hour advances retain their existing semantics. Private NPC balances must never be projected (the only exception is the DM's opt-in Party companion funds setting for visible NPCs travelling with the party): client previews may defer that check, but server/local approvals enforce it. Retain all turn receipts and pending drafts. Ordinary requests recheck levels and same-location/ship presence. Explicit historical requests/reviews require a DM checkbox and written affirmation of those conditions then; current ownership/visibility and original-period budgets remain authoritative. NPC/category totals combine teachers while player projections remain contribution-only; subject normalization never rewrites receipt content. Both category/per-teacher resets capture request IDs and reject stale totals. Ordinary missing sheets or unrecognized class levels require written DM confirmation. Training records time only. DM milestone/reset preserves lifetime/captured conversions/history and refunds no hours; character rewards stay manual. Old pending financial quotes and older journal writes remain readable/preserved.

Run downtime-activities, shared-room, finance, estate, placement, ships and smith regressions, quick checks and both builds. The complete workflow requires the new desktop/mobile downtime browser audit in development and the immutable Worker alongside all previous gates. Review both role Help guides, resource previews, player Home link and Review Inbox. Additional activities in the guide are design proposals until separately authorized for implementation.

### Character placement and individual downtime

Canonical optional world `characterPositions` records attach to existing purse IDs. Defaults retain legacy party membership and location-NPC privacy. Only reviewed DM commands may move/hide characters or start/cancel activities. NPC transfers toggle the existing non-party account while keeping its world configuration, wallet, holdings and full sheet; never create a second account or scheduler. Protect active/return locations from deletion, exact-state conflicts and active/pending downtime placement changes. Visibility changes remain allowed during activities. Complete actions once through the existing approved finance/session clock; preserve current visibility and restore recorded prior placement. Keep currency/inventory rewards manual.

Preserve existing visible shared balance/ledger readouts while removing hidden character payloads and separating NPC sheet access. Check current projections, raw room envelopes, account campaign-sheet detail/save/list, role/ownership enforcement, invitation claims, Library/maps, offline views, archives/recovery and retry receipts. Other players may read explicitly shared NPC sheets but cannot edit or roll for them. Character selectors exclude exchange treasuries. Party totals, encounter planning/rest lists and physical property work must use current membership/individual location. Run `character-position.test.ts`, room-store/character/finance/estate regressions and the existing desktop/mobile world audit, which now exercises DM/guest placement and privacy through actual UI controls.
