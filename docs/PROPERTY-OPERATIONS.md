# Property operations in Lootsplit

Open **Market → Property Management**. The estate register, deeds, eight broad property types and shop location hierarchy stay in place. Owned properties now have expandable settings, storage, projects, staff, rental, delivery and correspondence sections. The DM estate workshop contains 26 building, ship and shipyard presets and custom template controls. Presets set capabilities and proposed roles; the DM defines prices, wages, work, tools, checks and yields.

## Ships and shipyards

Owned ship and Private shipyard presets extend this same register, storage, staff and project engine. See [SHIPS.md](SHIPS.md) for component stats, boarding, repair/upgrades, facility fees, downtime voyages and the DM teleport override. They add no wallet or scheduler.

## Set up a property

1. The DM creates a property holding in Funds & inventory, posts a listing in the estate register, or imports a reviewed property document.
2. Create or select its operating template in the DM estate workshop, or use New property listing → Property operations template → Create from preset. Review/save the template before returning to the retained listing draft; save the listing separately. Add material definitions and construction, repair, gathering or production recipes. Advanced template editing supports ordered stages with individual inputs, work and requirements.
3. Assign the holding to an existing region, city/town or area. The current party location is the existing DM-controlled market location. A city property is accessible from its child areas; an area property requires that area. An unknown party location does not prove presence.
4. Enable its operations and configure owner, assigned party-character or selected-character access. Party warehouses default to shared access. Set unlimited storage or a finite limit using existing inventory weight units; unknown weights must be reviewed for a finite limit.
5. Purchase listings through the existing review flow. A reviewed operating template activates storage on acquisition, while staff and tenancy agreements require separate review. Purchased property retains its transaction-filled inventory deed. Imported pre-owned holdings do not invent a purchase receipt or deed.

### Repair: properties bought without an operating record

Before PR #165, an offline (device) campaign that imported a property document and then bought one of its listings got the deed and the charge but no operating record, because the stored listing had lost its template key. Shared-room purchases were rejected instead, so no shared room was affected.

- **Detection (read-only).** A deeded property holding (`deed.listingId`) with no site in `propertyOperations.sites` and no vessel/facility, whose listing still names a template or whose listing ID is an imported one (`…-property-N`). The `listingPurchase` receipt is reported as evidence but not required, because session archives close older ledger lines. Ordinary market properties without a template are not flagged. `estateSetupNeeds` returns nothing for players.
- **Prompt (DM only).** Property Management shows a summary and a **Set up operations** form under each flagged property. The template is pre-selected when the listing still names one (its attachments are kept) or when exactly one template has the property's type; otherwise the DM chooses.
- **Apply.** Ordinary templates use the existing `estate-site` command with `before: null` and the same record a purchase creates (`purchaseSite`). Ship and shipyard templates use `estate-ship-setup`, which also creates the vessel or facility (`initializeShipPurchase`). Both are DM-only on the server, charge nothing, write no deed or ledger line, and refuse a retry once the record exists. Offline runs the same commands through `executeLocalCommand`.
- **Unsold imported listings** that lost their key: the DM re-selects the **Property operations template** in the listing editor; the editor shows a hint for imported listings without one.

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

Ordinary Give and shop sale retain their existing deed behavior. Resolve stored goods, ongoing projects, tenants, staff, orders and financial obligations before disposing of an operating property. The DM may instead record an explicit handover that preserves the legal parcel, deed, goods and agreements, transfers the former owner's goods and obligations, retains other owners' goods and pauses orders for review. Trading & Barter retains reviewed bilateral deed exchange for clean properties.

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

## Development and verification rules

Moved verbatim from `docs/CODING-MANUAL.md` on 2026-10-21 so each feature's rules live with the feature. They still apply whenever this area changes.

### Property operations and reviewed imports

The user approved the October 9 property expansion after reviewing the catalogue and import contract. Read `docs/plans/PROPERTY-OPERATIONS.md`, `docs/PROPERTY-OPERATIONS.md`, `docs/examples/property-operations.sample.json` and its companion schema. The property importer is separate from the existing location/shop name importer and performs its own reviewed atomic command.

Reuse the existing property register/deeds, canonical holdings, shop location hierarchy and DM-controlled party position, campaign purses/ledger, recurring finance and single stored DM-approved downtime preview. Party storage defaults to assigned-party access and a history; private storage defaults to owner access. The DM may change all rules and permissions. Physical custody is separate from item ownership: stored/transit goods cannot also be carried, equipped, consumed or sold remotely. Unknown/cleared location must not bypass presence checks for new operational actions. Deed/holding transfer or sale must not silently lose stored items, projects, contracts or arrears. Preserve legacy unconfigured holdings and all existing finance agreements.

Construction and material gathering/delivery, wages/rent, manager actions and letters advance only through approved campaign days. Use existing sheet skills/manual or virtual rolls when requested by the DM; do not impose new D&D rules or official costs. Postal instructions require a city post-office visit, one service fee, DM-configured delivery time and a current authorized manager/contact. A delivered letter is not permission for remote inventory use, unlimited spending or property sale. Managers are in-game employees, not website staff/accounts; operation requirements, wages, budgets and overrides remain DM-controlled.

The property import is strict UTF-8 JSON with `format: lootsplit.property-operations`, `schemaVersion: 1`, `status: draft`, copper currency, campaign-day time and reviewed location/owner/material/template/property references. Use DM-only preview, explicit existing-purse mapping, hierarchy/cycle/duplicate validation, stale-before comparison and one atomic retry-safe command. Imports must not spend/credit funds, grant account access, move the party, activate rent/wages, fabricate purchase deeds/receipts, fill stores or complete projects. The sample's prices/names are fictional editable demonstrations. Schema validation is followed by relational validation; JSON Schema alone cannot check cross-references or permissions. Trading is now authorized: use reviewed bilateral offers, canonical inventory and deeds, with authoritative stale/permission checks and atomic exchanges. See the plan's acceptance scenarios; preserve every existing local/PR/main/immutable/read-only-live gate for every authorized release.

Character imports require migration `0009_character_imports.sql`. Test approval authorization, pending submission without campaign changes, denial, stale source/target/session, financial preservation and repeated/lost responses. Run `scripts/character-play.test.mjs` and the character browser audit; do not bypass approval in fixtures.

Shop calendars and property plans use the existing command/finance engine. Exercise desktop/mobile finance audits and `finance.test.ts`, including atomic local session archives, shared command permissions, stale previews, stock top-up and backup preservation. Market time is campaign days; no wall-clock polling or new scheduler. Keep the generic recurring rule editor available.

Shop assortment and quantity are separate controls. Preserve suggested/count/all-match generation, catalog/source metadata, duplicate-safe atomic catalog additions, existing custom prices and finite/unlimited stock. Inventory/preview/catalog pagination must never truncate stored stock or full PDF exports. Related checks: `generate.test.ts`, `shop-stock.test.ts` and the desktop/mobile `scripts/shop-stock-browser-audit.mjs`, required in both development and packaged Worker verification. Keep existing player trading and DM/server authorization checks.

DM location/shop name imports use the atomic `market-name-import` command. Preserve reviewed hierarchy validation, matching within the same type/parent, stale-name protection, retained drafts, receipt-based retries and closed/empty new shops. Imports must not update existing shop configuration, finances or images, or move the party. Check `market-name-import.test.ts`, `room-store.test.ts` and the complete desktop/mobile `market-locations-browser-audit.mjs` in development and packaged Worker environments. No new database migration is needed.

Global commodity access uses typed city ancestry, not place names. Keep city areas eligible, towns/regions/unset places closed, server/local transaction rechecks and player projection consistent. Located regional exchanges/ordinary shops keep their established scoped access; managers use their property's location and the explicit DM override remains available. Test stale/deep-link remote buy/sell with no partial finances/inventory and own receipt retention.

Commodity imports use the additive DM-only `trade-commodity-import` command with a captured campaign mutation scope and reviewed catalogue fingerprint. Preserve strict JSON/CSV/TSV validation, stable keys/units/material links, whole copper, skip-identical/reject-conflict behavior, atomic full imports, saved drafts and one-time shared retries. Imported definitions grant no inventory, exchange offers/stock, funds or seasonal history. Keep all60 shipped templates, downloadable JSON/template/schema and full review pagination reachable. Check `commodity-import.test.ts`, `trade-economy.test.ts`, `room-store.test.ts` and the complete desktop/mobile trade browser audit in development/immutable Worker; no migration is needed.

For address changes run `npm run migration:check` and `scripts/domain-readiness.test.mjs`, then the complete preservation suite. Read `docs/plans/DOMAIN-READINESS.md`. An API-only two-origin test does not replace the real two-host browser/legacy-APK cutover rehearsal. Never change DNS or retire old endpoints from a preparation-only task. Economy/tax presets in `docs/plans/ECONOMY-MODES-AND-TAXES.md` require owner decisions before activation.

Product screenshots are real UI captures from disposable local data (`scripts/capture-product-screenshots.mjs`), not screenshots of real user campaigns. Inspect images before placing them in `public/product/`; do not include account credentials or private campaign records. Keep them lazy-loaded and identify synthetic data in captions.
