# Ships and shipyards

Ships live inside **Property Management**. They are ordinary single property holdings with their original owner, value, location and purchase deed. Fleet metadata supplies vehicle rules and operating records. Cargo remains canonical inventory in property custody; crew contracts remain estate staff; repairs and upgrades remain estate projects. No second wallet, inventory, character or clock is created.

## Acquisition and setup

In **New property listing → Property operations template → Create from preset**, select **Owned ship** or **Private shipyard**. The existing template editor opens in the same dialog. Review its settings and save; the original listing draft is retained and the saved template is selected. Save the listing separately. Opening a preset or saving a template creates no listing, purchase or owned ship. Saved templates and the full DM estate workshop remain available. Purchase through the register's existing transaction/deed flow. A ship template initializes the vessel and storage capacity; a yard template initializes a private facility at the purchased parcel. Both remain independent valued properties. Berthing does not make a ship an attached building or transfer ownership.

Alternatively, the DM may configure an existing single, located property as a ship, or associate an existing property with a shipyard facility. Review its statistics, costs, access and storage rules. Sample values are fictional, editable defaults, not official ship statistics or official construction/repair prices. The property importer keeps its existing reviewed draft contract; importing templates/holdings does not automatically configure fleet records, hire crew or apply purchases.

Authorized players can name ships. Descriptive property editing, purchase, sale, deeds, ordinary Give and bilateral trading retain their existing authorization. Disposal cannot orphan cargo, occupants, voyages, outstanding projects, staff or arrears. A yard with stored ships cannot be disposed of. DM handover preserves contents and obligations; finish or teleport an underway voyage first, and review cancelled proposals after handover.

## Vehicle stat block

The ship tracks vessel type, size, length/dimensions, STR/DEX/CON with modifiers, combat speed, daily travel pace, minimum crew, character capacity, cargo weight, defenses and actions. It has no intelligence, wisdom or charisma. Characters retain all their own abilities.

Hull, helm, movement systems and optional weapons have distinct IDs, names, AC, current/max HP and damage thresholds. Exactly one hull is required. DM damage below the component threshold causes no loss; qualifying damage is applied in full. HP is clamped at zero. Critical components at zero or a nonpositive travel pace block ordinary sailing. These checks are vehicle bookkeeping; attacks, weather and encounter outcomes remain DM controlled.

Advanced component, repair-material and upgrade definitions use strict JSON fields in DM ship settings. Review names, quantities, capacity and costs before activation. Settings changes cannot erase operating arrears, expense remainders, installed upgrades or change a berth; use the dedicated controls.

## Cargo and aboard characters

Use the property's existing **Storage & material staging** section to load trade goods and other real inventory lots. Deposits keep ownership unless explicitly donated. Partial moves conserve quantity/value. Stored, reserved and transit goods remain excluded from carried sheet equipment, consumption, gifts and remote sales. Ship storage requires known weights within its finite capacity.

Players request boarding/disembarking for their assigned characters. The DM reviews requests on the ship or in Review Inbox, rechecking current access and presence. DM placement can act immediately. Characters cannot board/disembark an underway ship. Capacity is rechecked on approval. Aboard membership is optional fleet metadata attached to existing purse IDs; location stays in the canonical character-position record. Saved character positions contain only the existing placement fields, so older clients can read them.

Boarding removes the character from the active party and records whether they should rejoin on disembarking. They rejoin only if the ship and party are in the same place (split the party: where any group is, the group they left first, recorded as `returnGroupId`). **Board a whole group** (split the party, DM, `ship-board-group`): every member of a group other than group A goes aboard together and stays in the party (balances, pool, fairness); the group's place follows the ship (nowhere ashore while sailing), and moving, merging, journeys and single disembarking wait until the DM lands the whole group. Older apps see those characters as aboard alone, and their writes keep the group. Leaving characters aboard moves them with that ship; ashore characters stay. An originally assigned party member retains permitted access to that same party ship while aboard. This does not grant other character control or access to other remote party properties. Visibility/sheet-sharing restrictions remain authoritative.

Ship cargo can be retrieved by an authorized character actually aboard. A character aboard a distant/underway ship cannot use the ashore party market remotely. Port manager orders use the ship's actual location, current stock/cash, price limits and reviewed budgets. No voyage creates trade profit or free goods.

## Staff and captains

Use existing staff contracts. Active paid roles containing captain, sailor, crew or navigator contribute to the minimum crew. Linked NPC contracts count only when that NPC is aboard; the same character is never counted twice. Assigned aboard characters can serve as sailing crew, but cannot simultaneously hold active property labor allocations. Other passengers do not automatically become crew.

An unattended voyage requires a paid captain with delegated property-manager authority. Its reviewed spending cap is rechecked along with the voyage budget and payer funds. Wages settle through existing finance schedules and are not charged a second time inside ship maintenance. Wage arrears can remove staff from available crew. Captains can use existing reviewed supplies/trade orders at real ports; letters and free text grant no remote inventory access or arbitrary execution.

## Facilities and private shipyards

The DM adds commercial docks, dry storage and shipyards at existing locations in **Docks & shipyards**. Facilities define public/private access, berth/storage slots, maximum ship length, accepted-size notes, daily dock/dry/yard fees and repair/upgrade availability. Private facilities use the associated property's access or explicit selected-character permissions. Current berth terms remain readable to people authorized to view a stored ship.

A ship is docked afloat, in dry storage, in a shipyard, or sailing. Dry/yard storage requires a compatible local facility. Launch to docked/afloat before travel. Arrival and teleport recheck berth slots and ship length; an optional open mooring needs no rented facility. A ship cannot occupy a berth while sailing.

Ships sharing a private yard's owner avoid that yard's rental fees. Maintenance, wages, materials and labor remain payable. A privately owned yard is purchased/stored as property, not a hidden ship wallet.

## Repairs and upgrades

At a suitable dry-storage/yard facility, propose component HP repairs or an uninstalled upgrade. Repair labor days are the requested HP divided by the reviewed daily repair rate, rounded up. Full contractor cost and configured per-HP materials form the quote. Upgrade definitions specify labor, materials and positive increases to capacity, hull, speed/passengers, or an added component. Player inputs cannot create a different price/effect.

Choose an authorized funded payer; DM work defaults to the ship owner. Insufficient funds block paid work with a recorded reason. The proposal creates only a draft estate project. The DM approves ordinary work allocations/checks in the property or Review Inbox. Existing reservations, staged consumption, paid/personal labor, spending caps and downtime allocation limits apply. Personal labor reduces the contractor share through that existing engine. Remote paid work still needs an authorized paid manager.

Completion repairs the quoted HP up to current maximum, or installs its reviewed effect once. Hull upgrades add the same HP to current and maximum, preserving existing damage. Changing cargo capacity cannot discard goods. Departing, changing facility/storage mode, or teleporting pauses former-yard work. Resume only after returning to the reviewed work facility. DM project completion/corrections retain the existing recorded override and receipt semantics.

## Expenses and downtime travel

Voyage travel consumes no personal hourly downtime resource. Passengers/crew can log appropriate training aboard the same ship for DM review; the ordinary location, eligibility and hour checks still apply. Actual shipyard project labor shares the character's hourly resource through the existing property assignments. Voyage elapsed time, costs, minimum crew and physical shipyard requirements are unchanged.

Maintenance/provisions rates distinguish sailing, docked and dry/yard storage. Facility fees and staff wages are separate. Fractional daily charges retain copper remainders. Unpaid maintenance remains ship arrears; explicit payments use a real authorized purse. No app-open or wall-clock time accrues expenses or travel.

Propose a voyage with stable ship/voyage IDs, origin, destination, optional arrival berth, duration, payer, budget, captain, assigned crew and route notes. The DM approves it on the ship or in Review Inbox. Ordinary travel requires docked/afloat launch, usable critical components, positive pace, minimum crew and current approvals. An underway ship has no port location; its cargo remains at that ship and its occupants' canonical location is unset until arrival.

Only approved **between-session downtime** progresses the voyage. Partial advances retain elapsed time. Arrival updates the ship and aboard characters together. A voyage arriving partway through a day charges sailing for that part and docked/arrival-berth rates for the remainder; later days charge the destination rate. Crew, damage, budgets, payer funds and destination capacity are rechecked. Blocked voyages retain a visible reason and their progress. Weather, diversions and encounter damage are DM decisions.

The existing single stored downtime quote previews all financial settlement, ship progress/expenses, projects, arrivals and manager orders. Full relevant state participates in the stale comparison. Approval applies it atomically once; changed state needs a new preview. Existing financial settlement order is preserved. Session-hour advances settle maintenance through the same clock, but do not progress downtime-only voyages.

## DM teleport

**DM Override · Teleport Ship** chooses an existing destination and optional compatible berth, plus an optional reason. It moves the ship and every aboard character in the same authoritative command; cargo remains attached to the same canonical holding. No elapsed time, travel spending, repair or refund is applied. Crew/damage restrictions are bypassed. Ongoing/proposed voyages close as `dm-overridden`; former-yard work pauses. The move is journaled. Decide or cancel pending downtime first. Repeat shared receipts do not move or log twice.

## Maps and compatibility

Voyages retain IDs, origin/destination, elapsed minutes and reviewed route metadata. Maps now support configurable combat grids, port anchors, saved token placement and frozen voyage tile routes; see [Map tiles](MAP-TILES.md). Mapped voyage progress uses the same approved downtime engine. Legacy voyages and maps without grids remain available.

Optional journal fleet data needs no database migration. Old saves without it remain readable. Backups, archives, account-owned rooms, memory-only guests and privacy projections retain it. Legacy journal replacements preserve authoritative fleet metadata. Website code is shared with the Android build, but distributing these new controls requires a separately verified signed APK; no APK is published with this website feature.

## Development verification

Run `ships.test.ts`, `room-store.test.ts`, estate/finance/character-position/trade regressions, then full quick checks and both builds. `scripts/ships-browser-audit.mjs` exercises real desktop/mobile setup, damage, berthing, repair approval/time, boarding, voyage progress, teleport, shared player access/privacy and memory-only guests. The complete preservation workflow requires it in development and the independently packaged Worker. Preserve every existing account scenario, deadline, retry limit and release gate. Update both role Help guides, this document, feature inventory and the coding manual whenever these behaviors change.

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Ships, shipyards and voyages

Read `docs/SHIPS.md`. Ships remain single owned property holdings; cargo uses estate custody, crews use staff contracts, and repairs/upgrades use ordinary reviewed projects. Fleet data is optional journal metadata; aboard membership lives there while character location stays canonical. Do not persist the derived ship identity fields into character-position records: older clients must retain their existing readable placement shape. Legacy journal replacements preserve authoritative fleet metadata. Never create another wallet, scheduler or stored cargo copy.

Use stale-checked ship commands and existing room receipts. DM-only configuration, damage, boarding reviews and teleport must remain enforced on the server. Players propose only their own payer/workers/boarding characters. Presence, berth slots/length, cargo weights/capacity, critical components, minimum crew, wage arrears, current access and travel/manager budgets are rechecked. Voyage progress is between-session downtime only; session-hour advances settle maintenance without voyage progress. Teleport moves ship and all aboard positions atomically with no time/cost, closes ongoing voyages and pauses former-yard work. Ship expenses retain remainders/arrears; upgrade completion preserves damage and applies once.

Run `ships.test.ts`, shared `room-store.test.ts`, estate/finance/character-position/trade tests, full quick checks and web/mobile builds. The unchanged full nine-group PR/main workflow additionally requires `scripts/ships-browser-audit.mjs` in development and the immutable Worker at desktop/mobile widths. Preserve every prior gate, account/network bound, guest-memory/privacy rule and signed Android release requirement. Tile routing remains future work using the same clock. Update DM/player Help, SHIPS, README and feature inventory in each affected change.
