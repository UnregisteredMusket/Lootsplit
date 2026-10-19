# Connected campaign maps: analysis and proposed design

Research date: October 19, 2026. Inspected source: fullscreen-map PR111, head `18ac818cc3e0d92cfe33ca8b823e09044fbb7a7e`, merged unchanged as `25b77d14c40450c4c4b8e70b69395182434274fb`. This is a proposal for the next update; it does not claim the navigation or service changes below are implemented.

Lootsplit already has most of the underlying systems. The useful next step is to make Maps a place to access those systems: regional exploration, local places, businesses and combat should share one persistent map workspace. Map categories alone do not describe how maps connect.

## What exists and what is missing

| Area | Verified existing behavior | Missing connection |
| --- | --- | --- |
| Map categories | Regional, City, Dungeon, Property, Wilderness, Battle, Ship and Other; optional location/property links and independent grids | Category is a label/filter. No parent scene, destination hotspot or explicit default local/battle map |
| Geography | Canonical region → city/town → area hierarchy; reviewed anchors; closest matching map chosen initially | Clicking an anchored location opens a record link, not that location's map; multiple maps for a place have no chosen default |
| Map records | Shops, NPCs, characters, properties and post offices have icons, grouped counts and exact Library links | Most records inherit the nearest location anchor. The DM cannot place each shop at a separate building while retaining the same town/district assignment |
| Encounters | Saved rosters can become tokens with stable encounter/combatant IDs; configurable grid; manual tile mode; turn refresh | Starting the tracker does not select/activate a battle scene or switch map mode; tracker-to-map link is generic |
| Online play | DM viewing is separate from the players' active scene; explicit activation, optional browsing restriction and camera sharing | No linked-map trail, scene return context or integrated encounter transition |
| Services | Full shop counter, smith commissions, NPC interaction/barter, property operations, postal orders, exchanges, training, docks and voyages | Mostly separate screens; map icons normally lead through Library before the action |
| Fullscreen | Edge-to-edge canvas, floating controls and drawers, safe areas, native/fallback fullscreen, resize-safe current camera | Map selection is outside the map frame; the viewport is keyed by map ID. Linked navigation needs a persistent frame and per-map view history |

“Area” already exists in the location model, while the map category uses City, Dungeon, Wilderness and other descriptive types. Retain these existing categories. Present **Regional / Local / Battle** as contextual navigation choices, without erasing more specific types or inventing another location hierarchy.

## Proposed experience

On a regional map, tap a settlement marker. If there is one configured, accessible local map, open it immediately and keep a compact location card available. If several maps apply, show named choices such as Town, Harbor and Catacombs. If no map exists, show the current location description and available records; do not send the user to a blank canvas.

Keep a breadcrumb such as **Region → Town → Harbor** in the fullscreen header, with Back and a compact map chooser. Back returns to the prior camera and zoom. A map can also have explicit entrances, stairs, gates or cave links that connect to another scene. Support destination entry points without moving combat tokens merely because someone browsed a map.

Use one fullscreen shell throughout. Desktop service details open in a side drawer; phones use a bottom sheet with a clear expand/collapse control. The canvas remains behind it at full size. Closing a panel restores the map and focus at the same place. Allow pinch/pan around markers, use ordinary single taps and visible buttons, and retain keyboard equivalents and a searchable list of places for people who cannot use the image.

### Browsing, travelling and directing players

These must remain three explicit actions:

1. **Open map** changes only this person's view.
2. **Move party here** uses the existing DM-controlled location/travel command and its checks.
3. **Show players** uses the existing active-scene command, and optionally the explicit shared-camera action.

A DM may choose a combined **Arrive and show this place** action after reviewing the destination, but its result must explain which actions succeeded. Viewing a town must never silently move characters, open remote shops, finish a voyage or advance campaign time. Individual character placement and aboard-ship status remain canonical. Player browsing restrictions still apply to all links and breadcrumbs.

## DM placement and assignment

Add **Place on map** with a searchable picker for an existing location, shop, NPC, owned property, property listing, exchange, dock/shipyard, journal/handout or linked scene. The DM selects a record, taps a point and reviews the pin. Use normalized coordinates so image resizing does not move its meaning.

An explicit per-map placement overrides the inherited location anchor. Existing maps keep their current inferred icons until the DM places them individually. Several independent shops in one district can therefore have different building positions, and the same shop can appear on both a town map and an interior map without copying its stock.

Keep the distinction between **where a business belongs** and **where its icon is drawn**. Moving a pin is a presentation edit. Reassigning the business to a different city/district is a separate reviewed location edit. Newly created shops should continue to start closed and empty until configured.

Pins refer to stable canonical IDs, with optional display icon/label overrides. Names, inventory, orders, ownership and opening status are read from the real record. Show appropriate states such as Open, Closed, Visit to interact, Order ready, Awaiting DM review or Unavailable. A business may offer several actions; model these as capabilities of its linked records instead of creating a duplicate “map service” economy.

| Map destination | Actions to expose in the map panel | System to reuse |
| --- | --- | --- |
| Shop or market stall | Browse, buy, sell; show hours and availability | Existing stock, prices, Charisma adjustments, purses and transaction receipts |
| Blacksmith | Design/review commission, inspect progress, collect completed item | Existing enabled maker/forge, material contributions, paid orders and physical collection rules |
| NPC | Read permitted description/sheet, converse, barter; open training request where applicable | Existing NPC identity, dialogue privacy, bilateral consent and training approval |
| Owned property | Storage, deposit/withdraw, requests, projects, staff and manager reports | Canonical property holding/deed, custody, capacity, materials, permissions and Review Inbox |
| Property for sale | View details and purchase review | Existing listing, location availability, funds and deed transaction |
| Post office | Send correspondence or structured manager instructions; track delivery | Existing configured city shop/town exception, postage, manager authority and campaign-day delivery |
| Trade exchange | View local quotes and trade permitted commodities | Existing exchange stock/treasury, seasonal pricing and city-access rules |
| Dock, shipyard or ship | View berth/ship, request boarding, repairs/upgrades and voyage | Existing fleet, cargo, passengers, facility capacity, estate projects and approved downtime |
| Inn or other ordinary service | Buy configured service; open a rest/time request when appropriate | Existing catalogue/service transaction and DM-reviewed Session Time; buying lodging must not automatically grant a rest |
| Journal, handout or point of interest | Read shared lore and related records | Existing journal/Library permissions and exact record links; no second journal |
| Battle site | Prepare/start a linked encounter and choose its scene | Existing encounter state, tokens, fog, movement and loot review |

Custom guild, temple or bank markers can initially open a configured service or existing feature. They should not imply new resurrection, skill-progression, interest or healing rules. Dedicated mechanics beyond existing features need a separate design decision.

The current reviewed training flow records a character training an NPC, with level/location and time-budget checks. It is not a general NPC-teaches-player service. A trainer business could expose the existing supported workflow, but selling new training benefits would require an explicit extension.

## Encounter transition

Provide a DM **Start encounter here** action from a place, map point or existing encounter. It should review:

- The saved campaign encounter; save or resolve pending edits first.
- **Use this map's calibrated grid**, **Open a linked battle map**, or **Keep the current view** for theatre-of-the-mind play.
- Optional entry positions and which existing character/ship tokens are reused.
- Which enemy tokens are revealed and whether to show the scene to players immediately.

If the DM configured a default battle map for that place, preselect it. Never pick the first map named “Battle” or match by name. Multiple battle maps, floors and entrances need explicit choices.

The overlay option only makes sense at an appropriate scale. A miles-per-cell regional map cannot become a five-foot battle map by toggling grid visibility. Keep the calibrated grid on a local map, or open a tactical map. Saving, hiding or leaving a grid must retain its calibration, token positions and fog.

After the authoritative encounter start succeeds, activate the chosen shared scene and show its combat controls. Expose round, turn and authorized token details in the floating HUD. DM actions write through the existing encounter API; players receive only an explicit permitted combat presentation. The existing shared `encounterActive` flag does not expose full tracker data, and current map projection strips the private map-level encounter ID. A player HUD therefore needs a deliberate safe projection, not access to the DM encounter endpoint.

Tokens already carry encounter/combatant IDs, but combatants do not currently have a dedicated canonical character-ID field. Names and `sourceKey` are not a safe basis for automatic character-sheet HP synchronization. Preserve tracker HP/initiative/conditions and link permitted sheets explicitly. If bidirectional sheet/tracker synchronization is added later, define the owning record, revision checks and stable character mapping first.

Scene activation and encounter start currently use different persistence paths. Treat a combined start as a recoverable operation: validate the chosen map and encounter, retain stable operation/receipt identity, and report partial completion accurately. If the encounter starts but scene activation fails, offer **Finish opening battle map** rather than starting another encounter. For a fully atomic implementation, review both D1 and local IndexedDB boundaries and include the room/encounter revision checks; two sequential browser requests are not an atomic transaction.

On **Conclude & review loot**, retain the existing explicit recipient review and one-time award. Offer **Return to exploration** with the prior map and camera. Returning does not delete tokens/fog, undo combat, award loot again or assume elapsed travel time. Keep prepared enemy tokens private by default, as the current roster import does.

## Minimal additive data and implementation

Use the existing campaign maps and canonical locations as the base. Proposed fields require schema review before implementation:

| Addition | Purpose | Constraints |
| --- | --- | --- |
| Map navigation metadata | Optional parent map, represented location/property, default purpose | Stable IDs, same campaign, no self-parent or containment cycles; old maps remain valid |
| Place-to-map assignments | Select default overview/local/battle map per place, with optional variants | Multiple maps supported; explicit preference beats array order; no ambiguous automatic migration |
| Scene links | Source point/region, target map, optional entry camera, visibility | Cross-links may be bidirectional; target access and source fog are checked; no automatic movement |
| Record placements | Map ID, record kind/ID, point, visibility/display options | Refer to canonical records, never copy inventory, balances or authority; inherited anchors remain fallback |
| Encounter presentation binding | Encounter/map IDs, entry policy and return context | Same campaign and revision checks; survive refresh/retry; private setup excluded from player responses |
| Per-view navigation state | Trail and camera per scene; currently open panel | Local to the current campaign/window; does not change active scene or authoritative location |

Refactor the Maps page so the frame remains mounted across scene changes. Hoist map selection, breadcrumb and per-scene camera state above the keyed viewport; keep canvas content replaceable. Route/back handling should address the selected map and permitted record while preserving the running document. Unsaved map/encounter/service drafts need the existing leave/reload safeguards.

Extract reusable service content from existing pages into panels that accept an explicit canonical record ID. Keep original routes working and have both surfaces invoke the same commands. Load heavy shop, encounter and property editors on demand; do not bring them into account startup or every map render.

Start with a small action resolver that produces authorized actions and reasons from canonical state. Actual mutations must still recheck permissions, location, quote/revision and receipt on the authority. A disabled button is explanatory UI, not access control.

## Privacy, compatibility and economic boundaries

- Shared maps and their visible anchors already contribute location IDs to the player location projection. Reuse that behavior. It does not grant remote shop access: shop stock, NPC conversations, smith offers and property contents have additional availability/privacy filters.
- A future “known but distant place” preview should disclose only DM-approved public marker information. Do not send full hidden business/NPC/encounter data to display a disabled button. Scene-link target names, thumbnails, parent breadcrumbs and search results can also leak hidden places and must be projected.
- Explicit pins must pass both record visibility and fog/vision checks. Continue to serve only authorized, revision-scoped artwork; do not preload private destination maps or original concealed pixels.
- Honor the active-scene browsing restriction for deep links as well as UI navigation. Revoke stale panels when sharing, membership, location or campaign changes. Guest state stays in memory.
- Keep purchases, barter, custody, commission collections, postage, delivery, loot and project progress on existing atomic commands. Browsing, moving a token or opening a map grants no money, goods, time, ship boarding or physical presence.
- Existing shop rules include a legacy “no location set” mode that allows campaignwide browsing; new map navigation must preserve that behavior rather than silently tightening all old campaigns. More restrictive presence policies should be explicit.
- Preserve individual locations and split parties. Existing service engines do not all use the same presence rule: ordinary shop visibility primarily follows the party, while smith services also check the paying character and maker. The map must call each current rule. Any unification should be an explicit, separately tested change.
- Add new fields through the existing tabletop protocol and backup/archive compatibility boundaries. Older clients must not erase them on journal/map writes. Retain unsupported bytes for recovery, and document website versus separately distributed Android availability.
- Map deletion and record reassignment need reviewed handling of incoming links, service pins and active encounter return paths. Keep existing protections for current party positions, tokens and ongoing voyages; do not silently delete underlying records.

## Recommended delivery order

1. **Connected exploration:** explicit place-map assignments, clickable location/entrance links, breadcrumbs and per-map camera history inside the persistent fullscreen frame. Keep browsing, travel and player activation separate.
2. **Interactive settlement:** exact record placement and reusable in-map shop/NPC panels, followed by smith, property/postal, exchange and ship services. Retain all original destinations.
3. **Combat transition:** reviewed encounter binding, current-grid versus linked-map choice, safe combat HUD and recoverable activation/return. Reuse roster identity and loot transactions.
4. **Polish and wider references:** contextual lore/training panels, search, floor/variant choices, cluster filtering and permitted preloading. Add new gameplay mechanics only when explicitly designed.

Each stage should ship a complete vertical flow rather than merely adding another category. A good first demonstration is: regional town pin → town map → individually placed forge → existing commission review → close back to unchanged map → start linked encounter → battle map → conclude/review → return to town.

## Acceptance and preservation checks

- Desktop, 320/390px portrait and phone landscape: navigate regional → local → battle → back while remaining fullscreen; retain each camera, focus, safe-area controls and panel scroll.
- Same-name places, multiple maps for one place, missing/removed targets, floors, self/cyclic parents, private parent/shared child and shared parent/private child: no guessed destination or leaked name/thumbnail.
- Two players and a preparing DM: local browsing leaves peers untouched; explicit activation directs permitted players; restricted browsing blocks links and direct URLs.
- Place two shops in the same district at different points. Rename/reprice/change stock in the original shop and verify the map panel reflects the same record. Pin dragging does not reassign geography.
- Actual buy/sell, NPC barter, smith order/collection, storage, postage and exchange operations: current eligibility, stale quote, insufficient funds and lost-response retry behavior remain correct, with one economic result.
- Distant-map browsing, free travel, away character, underway ship, closed vendor, hidden NPC and revoked property permission: preserve each service's current rules and disclose no private payload.
- Same-map grid and dedicated tactical map both work; wrong-scale regional maps require a reviewed tactical choice. Roster reuse does not duplicate combatants. Unsaved tracker edits remain guarded.
- Failed/retried activation, concurrent DM edits and refresh midway through transition: no duplicate encounter, lost tokens, extra awards or silent partial success.
- Leaving combat restores navigation context without rewinding data; secret enemies, HP, notes and original pixels remain private in direct responses/media, not merely hidden by CSS.
- Old saves, legacy client envelopes, complete backups and historical reports preserve new references without erasing prior data. Shared web/mobile builds, both Help guides and all existing release checks remain required for implementation.

## Evidence and reference patterns

The code is the source of truth; some older prose in WORLD-FEATURES describes the earlier compressed-image pipeline. The newer MAP-TILES guide and protected-media implementation document current detailed artwork behavior.

Repository evidence:

- `src/lib/quire/world-schema.ts`: categories, locations, anchors, marker fields, grid/tokens and encounter references.
- `src/lib/quire/shop-locations.ts`, `commands.ts`, `vendors.ts`: location hierarchy, physical/party movement, availability and deletion guards.
- `src/components/campaign-map.tsx`, `map-frame.tsx`, `map-session-bar.tsx`: default map selection, inferred record placement, Library links, keyed viewport, fullscreen and active scene.
- `src/components/map-tile-controls.tsx`: grid setup, saved roster import, token identity and manual encounter refresh.
- `src/lib/quire/tabletop.ts`, `tabletop-schema.ts`, `session-records.ts`: scene access, token permission, fog/media projection and player data filtering.
- `src/lib/quire/library-records.ts`, `src/routes/shop.$shopId.tsx`: existing canonical record links and shop-page boundary to refactor.
- `src/components/encounters/workspace.tsx`, `src/lib/encounters/model.mjs`, `local.ts`, `client.ts`, `cloudflare/encounters.mjs`: tracker actions, separate persistence, revision checks and loot receipts.
- `src/lib/quire/blacksmith.ts`, `estate.ts`, `ships.ts`, `downtime-activities.ts` and their feature guides: service eligibility, property operations, fleet and reviewed training/time.

Primary-source design references, read October 19, 2026:

- [Foundry VTT: Scenes](https://foundryvtt.com/article/scenes/) separates a person's viewed scene from the globally active scene and supports per-scene grid settings. This supports retaining Lootsplit's existing separation between browsing and activation.
- [Foundry VTT: Map Notes](https://foundryvtt.com/article/map-notes/) links map pins to journal records and derives access from record permissions. Lootsplit can extend that pattern to its own canonical services while retaining its stronger server/media filtering.

These are interaction references, not proposed dependencies or imported artwork/code. The game-map inspiration is the continuous spatial navigation, contextual controls, remembered view and return path; all Lootsplit data and permissions remain its own.
