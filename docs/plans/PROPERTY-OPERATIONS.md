# Lootsplit approved property operations design

Approved for implementation on October 9, 2026. The `feature/property-operations` branch implements this design; production remains on the previously verified release until the full release gates pass. See `docs/PROPERTY-OPERATIONS.md` for current workflows.

## Confirmed direction

Extend the released fantasy estate register, purchase deeds and property holdings. Players can buy land or buildings, store items locally, rent homes, develop plots, upgrade buildings, commission paid work or contribute downtime labor, acquire and deliver materials, hire required workers and optional managers, and send management instructions from a city post office. The DM can create/import properties and adjust every property setting, requirement, permission and outcome. Bargaining and the future item/deed trading engine remain deferred.

The user selected two defaults: assigned party characters can deposit and withdraw from party-owned storage, with DM-adjustable permissions and a full history; letters have DM-set delivery fees and campaign-day delivery time. A private character property uses owner access unless its owner and DM explicitly share it.

## Property and building catalogue

These are configurable templates, not hard-coded gameplay rules. Required staff means staff needed to operate a service or earn its configured output, not staff needed merely to own an empty building. A manager is optional for ownership and local manual use; unattended automation needs a hired manager with the relevant authority and budget. Counts, wages, capacities, revenue, work, recipes and requirements are all DM-adjustable. Upgrades do not automatically grant combat bonuses, spellcasting or free items.

| Property/building | Player uses | Proposed operational staff | Example development or upgrades |
| --- | --- | --- | --- |
| Land plot | Own a site; build one or several structures | None; builders needed only for commissioned work | Clear site, road, enclosure, utility connections |
| Cottage or house | Home, private/shared storage, rental | No mandatory worker for basic occupancy; optional caretaker or rental manager | Extra rooms, cellar, stronger doors |
| Townhouse or manor | Larger home, multiple rental rooms, estate base | Optional servants/caretaker; manager for automated estate duties | Guest wing, gardens, larger storage |
| Boarding house or apartments | Separate rentable units and owner storage | Caretaker for an operated multi-unit business | More units, furnished rooms, laundry |
| Warehouse or lockup | Party stash, material staging, delivery receiving | No mandatory staff for a manual stash; porter/clerk for delivery handling or commercial warehousing | Racking, additional bays, guarded entrance |
| Granary or storehouse | Food, bulk supplies and farm stock | Storekeeper for commercial operation | Expanded storage, reinforced bins, preservation room |
| Secure vault | Restricted storage of valuable items | Custodian/guards if staffed security is configured | Strongroom, access controls, additional vault |
| Farm or homestead | Residence, supplies, agriculture and rental | Farmhands for automated production | Barn, irrigation, additional fields |
| Orchard or herb garden | Grow ordinary food or recipe ingredients | Grower/gardener for automated harvests | Greenhouse, irrigation, expanded plots |
| Logging camp or sawmill | Gather timber and process building materials | Loggers; sawyer for the mill | Mill equipment, sheds, better transport |
| Quarry or mine | Extract stone, ore or other DM-defined materials | Miners/quarry workers; foreman for organized operation | Supports, shafts, lifting gear, processing yard |
| Workshop or carpentry yard | Build ordinary goods and components | Relevant craftsperson for automated production | Workbenches, tool sets, larger work floor |
| Forge or smithy | Metal goods, repairs and building fittings | Smith; assistants where the recipe requires them | Better forge, more stations, ore processing |
| Apothecary or alchemy laboratory | Ordinary remedies and DM-approved recipes | Qualified apothecary/alchemist for production | Equipment, ingredient beds, secure storage |
| Shop or trading house | Operate a merchant and store sale stock | Shopkeeper/clerk | More floor space, stockroom, service counter |
| Tavern | Operate food/drink service and recurring income | Publican/server; cook when meals are provided | Kitchen, larger hall, entertainment room |
| Inn or guesthouse | Rent rooms, store supplies and provide services | Innkeeper; cleaners; cook where meals are provided | More rooms, stable, upgraded guest rooms |
| Stable or livestock yard | Board animals and keep feed/equipment | Groom/handler for unattended animal care | More stalls, feed store, training yard |
| Dock or boathouse | Store equipment, receive deliveries and operate transport services | Dockhand/boatkeeper for operation | Berths, lifting gear, enclosed store |
| Library, scriptorium or school | Store books, commission copying, support research/training | Librarian/scribe/tutor for operated services | Archive, reading room, classrooms |
| Shrine, temple or infirmary | Store supplies and operate religious/healing services | Caretaker; healer for treatment services | Treatment room, garden, larger hall |
| Guildhall or estate office | Headquarters, records and multiple-property administration | Clerk/steward for automated administration | Meeting rooms, registry, larger offices |
| Post office or courier station | Send paid letters and receive replies; optional owned postal business | Postal clerk; courier for an operated route | Additional routes, relay stable, sorting room |
| Barracks, watchtower, keep or castle | Residence, storage, staffed security and estate headquarters | Guards/soldiers for security; steward for estate operation | Walls, armory, barracks, additional buildings |

Ruins and damaged buildings are conditions of these templates, using the existing condition field. They require repair projects rather than a separate economic system. The existing eight broad property types remain compatible: residence, inn, keep, tower, homestead, workshop, land and other. Template keys distinguish warehouses, vaults, forges and other specialized uses within those types. Custom DM templates remain possible.

## Reuse of the existing application

| Existing system | Proposed extension |
| --- | --- |
| Property listings, holdings, deeds and Give | Keep one owned asset and its original acquisition receipt; attach structures, operating profiles and permissions. Purchase/transfer/sale still use existing authoritative commands. |
| Region/city/town/area shop hierarchy and party location | Bind every operational property and post office to those locations. Do not introduce a second map or travel clock. |
| Inventory, quantities, item values and transfers | Move a canonical item lot into/out of property storage. Track its owner separately from its physical location; exclude stored goods from carried/equipped inventory. |
| Shop stock, catalog/custom items and purchase receipts | Buy materials normally. Link shipment destinations and received material lots to the original purchase; never credit a second item copy on delivery. |
| Property plans and recurring finance rules | Use the existing revenue/upkeep engine for rent, wages, maintenance and operating costs. Keep generic recurring-rule controls. |
| Stored downtime preview and explicit DM approval | Preview construction, labor, gathering, shipments, letters and automated orders alongside existing financial effects; apply one approved campaign-day transition atomically. |
| Character sheets and roll modes | Use existing skills/tools and virtual/manual rolls if the DM requests a check. There is no new mandatory construction ruleset. |
| Campaign journal, record links and receipts | Record custody changes, jobs, contracts, dispatch/delivery, overrides and approvals with the same command retry protections. |
| Existing DM review and shared-room authority | Players submit allowed plans and hires; the DM approves or edits economic/rule changes. Validate permissions, location, stock, budget and revisions on the server. |
| Backups, account campaign saves and memory-only guests | Persist optional new property data through existing campaign storage/projections and preserve legacy records. Guest campaign data remains memory-only. |

## Storage and location rules

1. The DM-controlled current party location is the location source for this version. Split-party or independent character travel is not added by this proposal.
2. Item withdrawal, deposit, use, equipping and ordinary sale require presence at the property's assigned location. Reuse the location hierarchy: a city-bound property is usable from its child areas, while an area-bound property requires that area. A cleared location is not proof of presence: new operational storage/postal actions stay blocked until a location is set or the DM explicitly overrides it. Existing campaignwide shop/listing behavior remains.
3. Party-owned stores default to assigned party-character access. Private stores default to owner access. The DM can set named-character restrictions, viewing permission, withdrawal approval, capacity and exceptions per property. Departed/removed members lose access.
4. Moving an item changes custody and carrying state; it does not mint a new holding or add a second wealth valuation. Deposits cannot leave the same item equipped or available for consumption in the character sheet. A withdrawal cannot duplicate it after a lost response/retry.
5. Storage capacity is DM-configured. A finite weight limit uses the same weight units as existing inventory; missing weights need DM resolution rather than being treated as free capacity. An unlimited limit is permitted.
6. Remote viewers can see authorized property reports and contents; they cannot withdraw, equip, consume or sell stored items remotely. Letters and managers issue instructions, not instant physical item transport.
7. Rental homes may retain explicitly designated owner storage. Tenant-occupied rooms and tenant goods do not automatically become party-accessible storage.

## Land, construction, materials and improvements

A plot remains the legal property asset. Buildings and upgrades attach to it unless the DM deliberately creates separately owned parcels. Its deed retains the original buyer, price, date and location; later building work appears in its linked property history, not as a fabricated original purchase or a second valued deed.

Each DM-defined project has a target structure/upgrade, required materials, remaining labor days, permitted skills/tools, labor price, prerequisites and stages. Work can combine paid labor with character downtime. A character cannot spend the same downtime day on two full-day tasks; part-time allocation is configurable. Labor advances only with approved campaign time and available inputs. Building benefits remain inactive until the relevant stage is approved complete. The DM can adjust, pause, cancel or complete a project with a recorded reason.

Material acquisition has two routes: ordinary shop/catalog purchases with optional commissioned delivery, or approved downtime gathering. Gathering quotes record allowed location, work allocation, required tools, any requested skill roll and the DM-confirmed yield. Materials stay in inventory/storage or recorded transit until received. Reserve quantities for a project and consume them once at its documented stage; refunds/salvage on cancellation are DM-reviewed. Transit goods cannot also be used or sold by their sender. Deliveries advance through approved campaign days, with DM-set costs and delays; no map-distance algorithm or new random encounter system is assumed.

The existing finance settlement order is preserved. New quotes show labor, supplies, postage, rent, wages, upkeep, material changes, deadlines and resulting balances together. A changed wallet, site, staff roster, project, ownership or item quantity invalidates a stale preview. New work must not bypass insufficient funds or settle twice. Existing standalone recurring income/expense agreements are not silently converted to staffing-gated operations.

## Staff and managers

Employees have a property assignment, role, wage, pay period, contract status and allowed duties. Linking an existing NPC character is optional; employees are not site administrators or login accounts. Required roles control new automated business output. Vacant roles or unresolved wage arrears flag the operation for DM review and pause future automated work under that property's approved policy; they never erase items, forgive arrears or rewrite prior income.

Managers are hired staff with delegated permissions: receive deliveries, supervise approved projects, manage rentals, hire within limits, order supplies within a spending cap and report results. A manager cannot change legal ownership, move another character's personal funds, invent goods, alter campaign rules or sell the property merely because they were hired. High-impact actions remain owner proposals and DM approvals. Manager automation runs in the existing campaign-time preview, not in real time while the app is closed. The DM can approve/edit/reject any manager action and configure which duties actually run automatically.

Rent uses an explicit rental agreement and existing periodic finance rules. Vacancy or an unfinished building yields no automatic rent for a new operation. Do not count both old generic revenue and a new rental agreement for the same income. Staff wages are separate expenses, not deducted twice inside a net-income figure and again as a recurring rule. Owner and party purses remain the actual money accounts; managers do not create hidden property wallets.

## Postal property management

Post offices are city-located shops/services using the existing market location and service-payment framework. A DM may deliberately enable service in a town or area. While present, a player chooses an owned/authorized property, its designated manager or staff contact, an instruction and a maximum authorized spend. Postage is charged once on dispatch. Store the letter's origin, destination, send day, due day, sender, recipient, status and linked order/receipt.

Delivery uses DM-set campaign days. Arrival does not guarantee execution: check the current owner authorization, contact, staffing, materials, funds and cap again. An unavailable recipient or excessive cost leaves a reported blocked order rather than spending unauthorized money. Replies and manager reports remain visible in authorized campaign history. The DM can adjust delivery, redirect, decline or resolve a letter. Buying postal service does not unlock remote access to stored items. This is an in-game letter system; it does not send real email or notifications.

## Sale, transfers and DM controls

Preserve purchase-generated inventory deeds, existing Give, and sale removal. A property transfer does not silently transfer someone else's stored goods or wage/rental liabilities. Before sale/transfer, review storage, occupants, staff contracts, active construction, materials, pending letters, arrears and future finance rules. Default to requiring resolution of nonempty stores and active obligations; the DM may explicitly approve a documented handover. Never delete contents, projects or history as a side effect of removing a deed.

DM creation and import use the same templates and validation. Every template setting and per-property override is editable: classification, location, ownership/access, value/price, capacity, condition, rent, staff requirements/contracts/wages, manager duties/budgets, materials, work rates, prerequisites, fees, delivery days, progress and outcomes. Adjustments remain auditable and require fresh authoritative state. Existing descriptive player edits remain separate from financial/ownership permissions.

Keep the five mobile tabs. Extend Market -> Property listings and the existing Property feature: Overview, Storage, Projects, Staff, Rent & finances, Correspondence and History can be disclosures/subsections. Reuse existing themes, modals, inputs, Review Inbox, inventory links and the same-document router. Do not put downtime inside Bank or build a parallel economic dashboard.

## Proposed import instructions

Use UTF-8 JSON. The companion sample is `docs/examples/property-operations.sample.json`; the draft JSON Schema is `docs/examples/property-operations.schema.json`. The richer import is a future DM-only property importer, not the current location/shop name importer or a raw campaign-backup restore. A DOCX/PDF narrative alone is not machine-importable; the PDF explains the JSON contract.

| Field | Required format and meaning |
| --- | --- |
| `format` | Exact string `lootsplit.property-operations` |
| `schemaVersion` | Integer `1` for this proposal |
| `status` | Exact string `draft`; operation activation needs a separate DM review |
| `currency`, `timeUnit` | `copper` and `campaign-day`; 100 copper = 1 gold |
| `locations` | Array of `{key, kind, name, parentKey}`. Region root; city/town under region; area under city/town. Keys are import references, not guessed campaign IDs. |
| `ownerBindings` | Array of `{key, kind, label}`; kind `party` or `character`. DM explicitly maps each used key to an existing purse. It creates no account/character and grants no player role. |
| `materials` | Array of `{key, name, unit}`. Quantity is a whole positive count in that unit. Link/create ordinary catalog materials explicitly; no invented inventory on import. |
| `templates` | Array with unique `key`, `name`, existing `propertyType`, and `capabilities`; optional storage/rental defaults, staff requirements and construction recipes. These are definitions, not active hires or completed work. |
| `templates[].storage` | `{defaultAccess, capacityWeight}`. Access `party-members` or `owner`; null capacity means unlimited. |
| `templates[].rental` | `{incomeCopper, upkeepCopper, periodDays}`. Nonnegative whole copper, period 1-3650 campaign days. Activation and occupancy are reviewed separately. |
| `templates[].staff` | Array `{role, minimum, wageCopper, periodDays, purpose}`; purpose `operation` or `automation`. Minimum 0 means optional. No employees or wage agreements are created automatically. |
| `templates[].recipes` | Array `{key, name, resultTemplateKey, laborDays, laborCostCopper, materials}`. `laborDays` is full-day labor by one suitable worker; mixed labor uses approved task allocation. Material lines use `{materialKey, quantity}`. |
| `properties` | Array with unique `key`, `name`, `recordKind`, `templateKey`, `locationKey`, `condition`, `notes`. Existing condition keys: `ready`, `maintained`, `repairs`, `ruin`. Optional `parentPropertyKey` links a building to a plot, with matching location. |
| Listing price | `recordKind: listing` requires `priceCopper` and `status: available/reserved/withdrawn`. A listing has no owner and creates no deed. One unique property listing has quantity 1. |
| Owned value | `recordKind: holding` requires `ownerKey` and `valueCopper`. DM-confirmed initial ownership; no payment, purchase receipt or fabricated purchase deed. Quantity 1; existing historical deed imports remain in trusted backup/recovery flows. |
| `postalDefaults` | Optional `{feeCopper, deliveryDays}`. These are settings for linked post-office services, not a new active shop or free postal access. |

Unknown fields, bad types, unsafe values, unsupported versions, duplicate keys, invalid hierarchy, missing references and cycles are rejected before any save. Costs and values are whole copper amounts from 0 to 1,000,000,000,000, quantities and labor days whole counts from 1 to 1,000,000,000, delivery days 0-3650, and finance periods 1-3650. Import keys use lowercase letters, digits, periods, underscores or hyphens, start with a letter/digit and contain at most 80 characters. Each top-level data array contains at most 500 entries. Template/property/material/location/owner keys are unique within their own array; recipe keys are unique within a template. Names contain 1-160 characters. A name collision is shown for explicit resolution rather than overwriting an existing property.

The importer must preview resolved locations, owners, templates, listings/holdings and defaults. It may reuse the existing location-name preview/matching logic; it must not move the party or replace configured shops/locations. Review unresolved owner and material mappings, duplicate/missing references, potential ownership grants and disabled financial plans. Commit the reviewed batch atomically through the existing DM command/revision/receipt system. Retry/lost-response protection prevents duplicate creation. Imports never activate rent, hire staff, spend money, fill storage, advance days, complete construction, generate a fake transaction or execute letters. Existing property updates need explicit mapping and a before-state comparison.

The sample uses fictional demonstration names and arbitrary editable prices, not official D&D construction costs. It includes an empty party warehouse as a DM-created owned holding, a house/plot/forge listed for sale, four templates, three material definitions, a build-house recipe and postal defaults. It contains no real campaign IDs, credentials, completed projects or purchased goods.

## Acceptance requirements before implementation can be released

- Purchase warehouse -> deed -> deposit party items -> travel away -> remote report remains readable but withdrawal/equip/sale is denied -> return -> authorized withdrawal once. Test all assigned party characters and membership revocation.
- House purchase -> rental/occupancy agreement -> approved income and separate costs -> paused/vacant periods -> sale review with stored items and obligations -> deed removal, history retained.
- Land -> pay for some labor and allocate character downtime -> buy/deliver/gather materials -> staged consumption -> complete building -> upgrade. Reject double-booked labor, material duplication, early benefits, stale previews and repeat approval.
- Staff hire/required vacancy/wage arrears -> manager budgeted operation -> change ownership/permissions before delivery -> correctly block stale/unauthorized orders. Preserve old generic income rules.
- City post-office visit -> fee once -> delayed delivery through approved time -> valid manager execution or explicit blocked status -> reply/history. Away-from-city sending and remote inventory access remain denied absent a recorded DM override.
- DM create/import -> preview mappings -> atomic save -> lost-response retry -> same records. Reject unknown keys, duplicate IDs, bad locations, owners, numbers and circular plot/building links. Importing creates no automatic financial or item side effects.
- Verify DM offline, Turn-Based/Live command rules, private/party projections, backups/legacy saves, memory-only guests, title/navigation preservation and both themes at 320/390px and desktop. Complete existing local/PR/main/immutable/live gates before any authorized release.

Suggested implementation sequence: storage and permissions; rentals and staffing; construction/materials within downtime; managers and correspondence; reusable templates and reviewed imports. The data/import contract should be frozen before writing the importer. No feature implementation or deployment is authorized by this planning request.
