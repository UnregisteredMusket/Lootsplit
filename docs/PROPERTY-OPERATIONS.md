# Property operations in Lootsplit

Open **Market → Property Management**. The estate register, deeds, eight broad property types and shop location hierarchy stay in place. Owned properties now have expandable settings, storage, projects, staff, rental, delivery and correspondence sections. The DM estate workshop contains 24 building presets and custom template controls. Presets set capabilities and proposed roles; the DM defines prices, wages, work, tools, checks and yields.

## Set up a property

1. The DM creates a property holding in Funds & inventory, posts a listing in the estate register, or imports a reviewed property document.
2. Create or select its operating template in the DM estate workshop. Add material definitions and construction, repair, gathering or production recipes. Advanced template editing supports ordered stages with individual inputs, work and requirements.
3. Assign the holding to an existing region, city/town or area. The current party location is the existing DM-controlled market location. A city property is accessible from its child areas; an area property requires that area. An unknown party location does not prove presence.
4. Enable its operations and configure owner, assigned party-character or selected-character access. Party warehouses default to shared access. Set unlimited storage or a finite limit using existing inventory weight units; unknown weights must be reviewed for a finite limit.
5. Purchase listings through the existing review flow. A reviewed operating template activates storage on acquisition, while staff and tenancy agreements require separate review. Purchased property retains its transaction-filled inventory deed. Imported pre-owned holdings do not invent a purchase receipt or deed.

## Store items and materials

Deposit or withdraw real inventory lots while the party is at the property. Partial moves split the quantity while conserving total wealth. Stored, reserved and travelling goods cannot be equipped, consumed, sold or given through the carried character sheet. Sheet edits retain those records.

Deposits retain the item's owner. The explicit donation option transfers a deposited lot to the property owner for shared projects. A permitted withdrawal assigns the retrieved quantity to the selected character. Project inputs can use the project's payer's goods and donated party goods; other characters' personal material lots are not silently consumed. DM overrides are recorded in the journal.

## Build, repair, gather and produce

The DM adds recipes to a template, specifying required materials, labor days, full contractor price, optional completed building template, repair condition, tools/check requirements, and any produced item yield, value and weight. Required staff control operated production, while basic storage and vacant ownership do not require workers.

Players propose a known recipe, their assigned workers' shares of downtime, contractors and work/check notes. The DM reviews proposals in Review Inbox or the property, adjusts allocations and approves required checks with the existing character sheet and roll controls. A character's active allocations cannot exceed 100% of a downtime day.

Materials are reserved per stage and consumed once when that stage completes. Cancellation releases unconsumed reservations. Paid labor uses available campaign funds; remote paid work requires a paid, authorized manager and stays within its spending cap. Missing supplies, checks, staff, funds or capacity block work with a visible explanation. Buildings attach to the original legal parcel and do not mint a second valued property or deed. Repairs may update the existing condition.

The DM can pause, resume, cancel, adjust stage progress or force completion with a recorded reason. Paid receipts remain unchanged; a completion override records any waived input requirements. Refunds and salvage use the DM's existing inventory/finance adjustment controls.

The DM can require approval for player withdrawals in Property settings. Players request an exact lot, quantity and receiving character; the DM approves or denies it in Property Management or Review Inbox. Approval leaves the goods stored. The requester collects an unchanged approved lot while present at the property, with access rechecked; changes to goods require a fresh request. Requests can be cancelled, and handover cancels pending authorizations. Deposits remain immediate.

## Hire staff and rent property

Players propose staff contracts; the DM approves or edits names, roles, wages, periods, optional NPC links, manager duties and budget limits. Wages use separate existing expense schedules. Pausing or dismissing staff does not erase arrears; property controls can settle recorded arrears from the actual paying purse.

Managers may receive deliveries, supervise approved projects, manage reviewed tenancy or contracts, purchase reviewed supplies and report results. Standing orders repeat at DM-set campaign-day intervals. They cannot change ownership, invent goods, sell the property or spend another character's personal funds. Actual recorded budget spending survives separate downtime previews.

For rental-capable buildings, the DM records a tenant, occupancy, income, separate upkeep and period. Vacancy, damage, missing required workers or unresolved operating arrears block new rental income. Tenant goods are not added to party inventory. Pause an old generic property income rule before activating a new rental to avoid counting rent twice. Older generic schedules keep their existing behavior.

## Purchase materials and arrange delivery

Players can buy ordinary Market supplies, bring them to the property and deposit them. The DM identifies their material definition and weight. The DM can also approve suppliers using existing stock, material definitions, delivery fees, campaign-day delays and item weights, then buy goods with delivery or authorize manager orders. Edit an existing reviewed supplier to adjust its stock, material, fee, delay or weight; already purchased shipments retain their terms, and pending orders must match the newly reviewed terms.

A delivery records one purchased inventory lot in transit, depletes actual stock and debits the paying purse once. It arrives during approved campaign downtime and requires available storage and the party or an authorized paid manager to receive it. Failed deliveries remain identifiable with their goods intact; the DM can review weights, retry receipt or retrieve the goods with a recorded override. Purchases and delivery fees are not automatically refunded.

## Send property letters

Trade Exchanges add a structured **Trade stored commodities at a local exchange** instruction to existing letters and manager standing orders. Choose the stable commodity/unit, quantity and maximum buy/minimum sell price. The supplies duty, staff/wages, budget, owner's purse, property location, exchange stock/cash and storage capacity are checked on execution. Sales use the owner's unreserved stored goods; letters do not grant remote inventory access. See [TRADE-ECONOMY.md](TRADE-ECONOMY.md). Reviewed import material keys and units remain the link between recipes, produced goods and trade commodities; the property importer itself never creates commodity inventory or market funds.

The DM designates an existing city shop as a post office and sets postage and delivery days. A town exception is configurable. Players physically present in the city can send a letter or a structured report, project, tenancy, staff or supply instruction to an active property manager. Postage is charged once on dispatch.

Letters record origin, destination, sender, contact, send/due days, spending authorization and receipt. Delivery rechecks ownership, authority, manager wages, reviewed agreements, supplier terms, stock and funds. Blocked instructions keep an explanation; cancelling does not refund postage. Free text is correspondence and does not execute arbitrary actions. Letters do not allow remote withdrawal, equipping or instant transfer of goods. These are in-game letters, not real email.

## Advance campaign time

Use Downtime to preview campaign days. Review existing financial settlement, property progress, labor costs, arrivals, manager orders and blocked results. At the next session, explicitly approve the stored preview. The entire result applies atomically once. Changed funds, stock, goods, settings or ownership require a fresh preview. Income, loans in creation order and expenses retain their existing settlement order; property work uses the remaining available funds. Newly activated schedules apply to future approved periods, without retrospective rent or wages.

Cancel a pending preview before changing property operations. Automation runs through campaign time; leaving the app closed does not advance anything.

## Transfer or sell

Ordinary Give and shop sale retain their existing deed behavior. Resolve stored goods, ongoing projects, tenants, staff, orders and financial obligations before disposing of an operating property. The DM may instead record an explicit handover that preserves the legal parcel, deed, goods and agreements, transfers the former owner's goods and obligations, retains other owners' goods and pauses orders for review. The future bargaining/trading feature remains deferred.

## Import format

Use the DM estate workshop's Reviewed property import. Upload UTF-8 strict JSON; review validation, choose existing owner purses, map existing locations or deliberately create new locations, then review and commit the preview. Changes since preview invalidate it. Conflicting material/template definitions are rejected rather than overwritten. Owner aliases never create accounts or grant permissions.

Download `property-operations.sample.json` and validate against `property-operations.schema.json`. The sample names and prices are fictional, editable examples. Required top-level fields are:

| Field | Required value or content |
| --- | --- |
| `format` | `lootsplit.property-operations` |
| `schemaVersion` | `1` |
| `status` | `draft` (imported owned operations stay inactive) |
| `currency` / `timeUnit` | `copper` / `campaign-day` |
| `locations` | Unique keys, kind, name and parent key; region → city/town → area |
| `ownerBindings` | Unique aliases, party/character kind and review label |
| `materials` | Unique key, name and unit; definitions grant no goods |
| `templates` | Unique key, name, broad property type, capabilities and optional storage/rental/staff/recipes |
| `properties` | Unique key, name, listing/holding kind, template/location references, condition and notes |
| `postalDefaults` | Optional postage and campaign-day delivery defaults |

A listing additionally requires `priceCopper` and available/reserved/withdrawn `status`, and excludes owner/value fields. A pre-owned holding requires `ownerKey` and `valueCopper`, and excludes listing price/status. An attached `parentPropertyKey` must share ownership, record kind and location and have zero independent value: its building belongs to its parent's parcel.

Keys use lower-case letters/digits and `.`, `_`, `-` (maximum 80 characters). Monetary values are whole copper from zero to 1 trillion; periods are 1–3650 days and delivery delays 0–3650 days. Quantities and work are positive whole numbers. Unknown fields, duplicate keys, missing references, invalid hierarchies/cycles and unsupported versions fail validation. Recipes can include optional stages, check requirements, produced items and a resulting property condition; the schema documents every supported field.

Imports create empty inactive owned configurations and sale listings. They do not move the party, spend/credit funds, create account access, buy materials, hire staff, activate rental/wage schedules, complete projects or fabricate deeds. Backups, archives, local DM play, Live and Turn-Based commands retain the optional property records through their existing storage and permission systems.
