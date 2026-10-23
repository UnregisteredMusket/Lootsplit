# Blacksmith services

Blacksmith shops keep their ordinary stock, buying/selling, custom items, schedules and PDF exports. **Blacksmith services** adds custom weapon and armor commissions using the same canonical campaign accounts, holdings, NPCs and approved downtime clock. No additional wallet, scheduler, database migration or real-time job runs.

## Configure a forge

1. Create an ordinary blacksmith shop and assign a physical campaign location in **Edit**.
2. Create or choose its existing maker in **People & NPCs**. Check **Offers blacksmith services** and save the NPC permission. This defaults off, including for legendary makers; finding an NPC never grants service access.
3. In the shop, expand **Configure blacksmith services**, select the NPC and choose apprentice, journeyman, expert, master or legendary. A skill change loads editable demonstration labor/value/time multipliers and quality descriptions. The DM may override each field.
4. Configure material stock, rarity, base unit value and rarity multiplier. Changing rarity loads editable example multipliers (1/2/5/10/25 from common through legendary). Unlimited stock is explicit. These are deliberately stocked smith supplies; material definitions alone do not grant player inventory. Saving a profile also registers its material keys in the existing property-material catalogue. Reused keys retain their canonical name/unit.
5. Toggle **Magical forge** if appropriate. Create enchantments, set minimum skill, effect description, fee, extra work days and added item value. Check the approval box for each permitted entry. New entries start unapproved. Players may select only approved entries at or below the maker's skill, at a magical forge.
6. **Advanced parts, materials & item settings** exposes strict validated JSON for adding/editing item designs, every component/style, allowed materials, quantities, descriptions, weight, base price and work requirements. Sword examples include blade, handle, pommel, hilt and crossguard; armor examples include plates, helmet, gauntlets, lining, straps and buckles. Add any other part using a unique stable key. Invalid or conflicting configurations retain the draft and make no economic change.

These prices and craftsmanship labels are fictional examples. Put DM-approved combat effects in the item or enchantment description; quality never adds an unstated attack, damage or armor bonus.

## Design and pay

The paying character must be present at the forge and outside individual downtime/underway ship travel. Closed, hidden, remote or unenabled services reject new commissions. Choose **Design a custom item**, an offered weapon/armor, unique name, each part's style/material/source, engraving and an offered enchantment.

Materials can use smith stock or the paying account's matching, unequipped carried holdings. The DM can identify ordinary inventory lots using **Identify inventory materials for contributions**, confirming their canonical material unit and weight. Stored, in-transit, reserved, equipped, other-character and service lots cannot be contributed. Multiple components sharing one lot are checked against their combined quantity. Gather/withdraw existing materials through their ordinary property/inventory flows first.

**Review commission** shows the exact description, maker, cost, value, work days and material contributions. **Place paid commission** deducts funds once, commits/consumes the exact materials once, decrements finite smith supplies and saves an immutable order. It does not grant a completed item immediately. Changes to the quote, stock, holdings, funds, maker or campaign date require a fresh review. Shared command receipts prevent a lost response/retry from charging twice.

| Calculation | Editable inputs |
| --- | --- |
| Material value | Base unit copper × rarity multiplier × component units |
| Labor fee | (Base labor + style fees + engraving fee) × labor price multiplier, rounded up |
| Commission price | Base item price + smith-supplied material value + labor fee + enchantment fee |
| Completed item value | (Base item price + all material value + style fees) × item value multiplier, rounded up, plus enchantment value |
| Work days | Base labor days + style/engraving/enchantment days, multiplied by work time multiplier and rounded up; at least one approved downtime day |

Player materials reduce the supply fee without removing their contribution to the finished item's value. The ordinary shelf's Charisma discounts and repricing do not modify an already reviewed commission formula.

## Work and collection

**Downtime** previews smith progress and completions alongside financial settlement and property operations. Approval applies that stored preview atomically once. Partial downtime retains progress; actual completion records the campaign day and time when the last required work day ends, even when a longer downtime interval was approved. Session-hour advances, an unapproved preview, wall-clock time or leaving the app closed never do smith work.

The DM can pause, resume or cancel with a recorded reason. Committed materials/payment remain historical; refunds and salvage require separate recorded finance/inventory adjustments. Existing orders keep their price, skill, maker name, quality, components and enchantments when a profile or NPC changes. Disabling services blocks new orders while accepted orders continue unless paused.

Completed orders wait at the original forge. **Collect crafted item** rechecks the ordering account and physical presence and inserts one ordinary inventory holding with the reviewed weight/value and a generated description. The description includes every component/material/style, engraving, approved enchantment, craftsmanship, maker/forge names, campaign order date and actual completion date. Collection is not another purchase. Ready orders can still be collected after services close; they remain the customer's paid goods.

**Market → Blacksmith commission register** retains order tracking while travelling. Other players' orders and unapproved enchantment drafts are not disclosed. Resolve open orders before deleting a customer, pickup location or forge configuration. Removing a resolved forge retains commission history. Old saves and archives remain readable; older journal writes retain authoritative smith metadata. The shared web/mobile client includes the feature; an installed APK needs a separately signed update to bundle it.

## Shared service helpers

Since 2026-10-23 the forge's presence check, whole-copper rounding, quote fingerprint, material contribution check, pause/resume/cancel and downtime progress live in `src/lib/quire/service-core.ts` so later providers (temple, workshop, inn) share them; see `docs/SERVICES.md`. The forge's schema, commands, messages and results are unchanged, and `smithHere` remains as an alias of `presentAt`. The NPC conversation hub's **Services · Blacksmith** reply now runs `smithAvailability` and shows its reason instead of opening a shop page that then refuses.

## Verification

Run `blacksmith.test.ts`, shared `room-store.test.ts`, finance/estate/world/ship regressions and `npm run verify:quick`. `scripts/blacksmith-browser-audit.mjs` exercises actual DM setup, NPC permission, custom extra parts, armor/weapon choices, magical approval, player contribution, review/payment, partial/full downtime, provenance, collection, reload and guest memory at 1280/390 pixels. Development and immutable Worker checks are required by the unchanged nine-group release suite; all prior checks remain. Complete exact-head PR/main verification and immutable publishers/read-only live verification before declaring a release.

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Blacksmith commissions

Read `docs/BLACKSMITH-SERVICES.md`. Use `smith-profile`, `smith-order`, `smith-control` and `smith-claim` commands, canonical material keys/holdings, NPC service permission and the existing approved finance downtime quote. Profiles and immutable accepted orders are optional journal metadata, retained across older journal writes. Smith work advances only in between-session downtime, never session hours or wall time. Payments/material consumption and collection use existing authoritative receipt/CAS protection. Recheck finite supplies, contribution custody/ownership/combined quantity, physical presence, funds, magical forge, skill and DM approval; expose no other player's orders or unapproved enchantment drafts. Original completion day/time and maker/specifications survive later edits. Resolve open commissions before deleting referenced customers/locations/profiles. Refunds/salvage remain explicit recorded DM adjustments.

Run smith unit/shared-room/finance/estate/world/ship checks, quick verification, both Help reviews and web/mobile builds. Require the added desktop/phone development and immutable Worker smith browser audits alongside every existing all-nine PR/main/immutable/live gate. Diagnose retained failures; never replace those flows with database-only assertions or weaken account limits/network isolation. No schema migration or APK distribution is required by this feature.
