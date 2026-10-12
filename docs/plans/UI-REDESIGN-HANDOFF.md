# UI redesign after the functional foundation

The owner wants a separate UI redesign because the current organization no longer fits the application's feature set. Start from the complete feature review, `docs/FEATURE-INVENTORY.md`, `docs/REDESIGN.md` and the current verified source. The report foundation is implemented in PR105; exact website/Android publication evidence is recorded in its audit and recovery checkpoint. This document adds no UI or gameplay changes.

## Preserve these role boundaries

| Audience | Information and actions | Boundary |
| --- | --- | --- |
| Player on phone or desktop | Assigned sheet, rolls, funds/inventory, personal finances, training requests/history, allowed maps, references and messages | Assigned character ownership, physical access, current play/turn state and DM policies remain authoritative. |
| Guest player | Same permitted campaign participation | Campaign data and unsent work stay in the running document; the reconnect ticket carries credentials only. |
| DM | Campaign configuration, party/NPC placement, markets/properties, time, encounters, reviews and manual rewards | Configuration/review controls must not appear as player actions. Every decision keeps current authorization, stale checks and receipt protection. |
| Owner/staff | Authorized website administration, restrictions, reports and monitoring | Website administration is distinct from campaign DM authority. |

## Keep the data connections visible

- One canonical character identity connects its sheet, wallet, inventory, rolls, physical placement and downtime. Property storage, transit and reservations affect custody; they do not create a second inventory or wallet.
- Approved campaign time drives finance, property/ship/smith work and resource windows. A calendar day is 24 elapsed hours; usable downtime defaults to 16 hours/day; displayed training defaults to 8 hours/day. Captured historical conversions remain unchanged. Ship travel uses no personal downtime hours.
- Player requests lead to DM reviews. Training records time only; category and per-teacher meters retain lifetime history. Historical review explicitly confirms conditions then. Resetting a meter never refunds time or edits a sheet; the DM applies rewards manually.
- Maps and combat grids connect canonical character/ship identities with displayed positions. Tile movement does not silently move economic location, inventory or campaign time. Enemy/private encounter details remain DM-only.
- Shared commands use exact action receipts and atomic commits. Compact unchanged reads update access/encounter policy and connection status after full hydration; they never acknowledge pending work or announce database changes. Changed/manual reads retain complete projections.
- Device-local PDFs and reference imports retain source review, attribution and DM access policies. Recovery retains complete old saves, archives, staged actions and readable exports.

## Design acceptance

Present a concrete preview before changing the application shell. Organize the complete feature tree around frequent player tasks and DM review/configuration work, while keeping every existing capability reachable. Give the full character sheet a clear phone entry; distinguish device-pending, saved-turn and committed actions; explain attention with a useful recovery action. Keep current and lifetime training totals distinguishable and label player totals as their own contributions.

Verify real router navigation without startup replay, narrow phones and desktop, both roles, keyboard access, themes, draft protection and all play modes. Preserve every release gate and account deadline. Optional Cloudflare infrastructure and the ten additional downtime designs are separate implementation decisions, not implicit consequences of a UI redesign.
