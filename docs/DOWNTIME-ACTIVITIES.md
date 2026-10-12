# Hourly downtime and NPC training

The shared campaign clock and stored DM-approved financial preview remain canonical. Approving a positive downtime period creates a separate per-character resource window: by default **16 usable hours per day**. Property labor actually performed and existing away activities consume that same resource. Travel aboard a ship does not consume personal hours. Voyage progress, upkeep, smith work, deliveries, finances and explicit session-hour advances retain their existing rules. No wall-clock scheduler or duplicate wallet is added.

Players log training against an approved period; the DM reviews the recorded time before it counts. Unused hours remain attached to that period, so they cannot inflate another day's allowance. An old period remains reviewable for late session bookkeeping; a request does not advance campaign time. The DM confirms that its context and time describe the activity performed. Future planning before financial approval can be added without changing these immutable period identities.

## Implemented training contract

- Home → Downtime & NPC training is available to players, and the existing DM Downtime tools remain available. Review Inbox includes pending training.
- Select the assigned trainer, existing NPC, Martial / Academic / Skill or Profession, subject, hours and free-text description. An optional class name requests a class-level comparison in addition to total character levels.
- The NPC must be equal or lower level. Known higher character/class levels fail. When a sheet or recognizable class-level text is absent, the DM must explicitly confirm eligibility in the decision note. No sheet is created for a sheetless NPC. Private NPC sheets and time balances remain private.
- Both characters must be visible and together: same active party, canonical individual location, or same ship. Active away activities must first finish/cancel. Approval rechecks the current participants, levels and hour balances. DM review confirms the recorded period's circumstances.
- Submitted requests reserve hours for both participants. All three categories compete for the same pool. Approval counts time; denial/cancellation releases pending time. Shared retry receipts preserve one-time requests/decisions. Turn-based drafts retain normal submission and recovery.
- Counters retain lifetime and since-reset hours and training days by trainer, recipient, category and subject. A default training day is **8 hours**. Both daily allowance and training-day conversion are DM-configurable from 1–24 hours, for new periods only. Historical day totals sum each entry using its captured conversion.
- DM milestone & reset requires a manual reward/change note. It resets only the current counter; lifetime totals, descriptions, original approvals and reset history remain. No resource refund, character edit, proficiency, level, money or item is granted.
- Metadata is optional journal state, preserved in old journal writes, saves, archives, recovery and cross-device rooms. No database migration or separately published APK is needed for the website change. Android distribution still needs its signed release process.

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
