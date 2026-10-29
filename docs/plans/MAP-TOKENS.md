# Map tokens, DM shortcuts and group placement: research and plan

Status: **approved by the owner on 2026-10-29** ("Stick to those mock-ups and implement them 100% as presented while integrating them into Lootsplitter."). Being built as stacked PRs in the order of section 7. Researched on a read-only checkout of `origin/main` at `53dd3399` (#364); file:line references in section 0 point at that commit.

The mockups are in `docs/previews/map-tokens/`: each `.html` file is the mockup and the `.webp` beside it is its rendering.

## Owner decisions (2026-10-29, final)
These answer every question in section 8 and replace any recommendation that differs.
- **Movement:** free outside combat; turn-based during active combat on that map (a player moves only on their character's tracker turn); free again when combat ends. The DM can always move anything. DM locks apply: the per-map mode (**Automatic** by default, **Off**, or **Ask the DM**, PR 8), the per-token Lock and the per-map `lockedPurseIds`.
- **Q1, existing maps:** maps where player movement is off stay off and show a one-tap "Turn on Automatic" notice. New maps, and maps with no tabletop settings, default to Automatic.
- **Q2, turn-based rooms:** players may move their own token and vote outside their room turn. Combat initiative still applies.
- **Q3, snapping:** tokens snap to the square under the grabbed point; the server refuses moves that aren't snapped and never relocates a token itself.
- **Footprints:** Tiny a quarter square (quadrants); Small and Medium 1×1; Large 2×2; Huge 3×3; Gargantuan 4×4 or larger. The DM can override a token's size. The anchor is the top-left square. Tokens are drawn at their footprint.
- **Grid off** is `snap: false`: tokens move freely and turning it off never moves a token. Turning the grid on offers (a) snap everything, as one undoable command (the default), or (b) shift the grid under the tokens.
- **Q4:** ungridded maps get an automatic hidden grid; hex grids are deferred.
- **Q5, phone gestures:** the radial opens after a 500 ms hold, cancels if the finger moves more than 6 px or a second finger lands, and has a More sheet. Web `vibrate` for haptics now; `@capacitor/haptics` comes with the next APK.
- **Q7, follow map view:** a DM campaign setting, off by default, plus a per-player opt-out. It moves only the token, only onto maps the player can see, and never during combat. A toast offers Undo.
- **Zones:** derived from the nested location tree plus explicit `world.zones`, each with a kind, a travel rule, a size and nesting. Within a zone the party never splits; crossing into an adjacent zone follows the split rule; returning merges the party back; non-adjacent moves need a journey ("This trip takes about N days — ask your DM to plan the journey"); zone changes are blocked during combat.
- **Q6, split rule:** campaign-wide Block, Wait until end of session, or **Party vote** (the default: majority, 5 minutes, a tie or no votes keeps the party together). Per-zone override: one of those, or Allow freely. The rule of the zone being left applies. The DM can always move anyone and can override a vote. "Present players only" is deferred.

Owner requests covered (all from 2026-10-29):
1. Players place and move their own tokens. The DM gets a right-click menu on desktop and a press-and-hold radial on mobile. Group placement and group commands.
2. Grid snapping, creature-size footprints, free movement with the grid off, and what happens to tokens when the grid is turned on.
3. **Decided by the owner:** movement is free outside combat (unless the DM restricts it) and turn-based while combat is active.
4. An option that moves a player's character token when the player switches map.

Mockups (`docs/previews/map-tokens/`): `context-menu-desktop.html`, `radial-mobile.html`, `group-placement.html`, `player-token-move.html`, `grid-snap.html`, `zones.html`, each with a PNG. `radial-mobile-320.png` is the 320 px check.

---

## 0. What exists today (file:line on `53dd3399`)

### Tokens and their storage
- A token is `mapTokenSchema` (`src/lib/quire/world-schema.ts:145-164`). Fields: `kind` character | ship | creature | other, `entityId`, `encounterId`/`combatantId`, integer `column`/`row`, `visibility` party | dm, and the tabletop fields `locked`, `controllerPurseIds`, `offsetX`/`offsetY` (each −0.5…0.5 of a tile), `style.size` (0.25–8 cells, default 1), `style.color`, `style.labels` and `vision` (`src/lib/quire/tabletop-schema.ts:110-131`). A map holds at most 200 tokens (`world-schema.ts:181`).
- **Positions are stored in grid coordinates**, not in pixels and not as normalized image points. The point drawn is `grid.x + (column + 0.5 + offsetX) / columns × grid.width` (`src/lib/quire/tabletop-geometry.ts:154-162`). So column/row is the cell the token's centre is in, and the offset is the sub-cell position.
- **Tokens need a grid.** A token can't exist on an ungridded map: `map-token` needs `grid` (`world-schema.ts:521-529`), and `map-token-move` throws "Configure a combat grid before moving tokens" (`src/lib/quire/tabletop.ts:389`). Tokens are drawn only in tile mode (`src/components/campaign-map.tsx:1972-1982`).
- **Drawing:** tokens are drawn as fixed screen-size record icons (32 px, or 44 px in the workspace) inside `map-icon-group` buttons with `data-map-token` (`campaign-map.tsx:4055-4070`; CSS `src/styles.css:3260`, `:3882`, `.map-kind-combatant` `:3583`). `style.size` changes only the selection ellipse (`src/components/map-tabletop-tools.tsx:1046-1054`). The inspector edits it as "Token size (cells)" (`src/components/map-tabletop-inspector.tsx:204-217`). **No token is drawn at its real footprint today.**
- **Placement is DM-only and one token at a time.** Settings › Combat › Combat token (`CombatControls`, `src/components/map-tile-controls.tsx:244-470`): pick "New token", choose a tile, choose a character/ship link, then "Add combat token". Each save sends one `map-token` command (`map-tile-controls.tsx:380-430`). The handler is DM-only, with a before/after revision check and ship-crew carry (`src/lib/quire/world.ts:448-488`). The rail's Combat token ⇧T opens the same panel (`campaign-map.tsx:170-179`).
- **Encounter roster import:** "Place encounter roster" fills the first free tiles, top-left first, with DM-only creature tokens, and sends one whole-map `map-save` (`map-tile-controls.tsx:513-546`).

### Player movement (`playerMovement`)
- `playerMovement: boolean`, default `false`, on each map's tabletop settings (`tabletop-schema.ts:135`). The DM toggles it in the scene configuration inspector (`map-tabletop-inspector.tsx:323-329`). It is projected to players (`tabletop.ts:134`).
- Server rule `canMoveMapToken` (`tabletop.ts:43-62`): the DM can move anything. A player can move a token only when all of these hold: the map is accessible; `playerMovement` is on; the token is not `locked`; its visibility is `party`; and it is the player's own visible character, or it lists one of their characters in `controllerPurseIds`.
- Further server checks in `map-token-move` (`tabletop.ts:388-463`): an exact grid fingerprint (with the legacy-diagonal form allowed); `ignoreWalls` only for the DM; each token at most once; each `before` must match (revision/CAS); the destination inside the grid; with `snap` on, offsets must be zero (**the server refuses, it does not snap**, `:409-410`); the destination visible to the player through fog/vision (`:413-417`); walls blocking movement (`:418-419`); ship crew carried along. The vision revision is bumped on a move.
- **Players can't place tokens.** `map-token` and `map-save` both call `dm()` (`world.ts:449`, `:490`).
- **No combat turn check:** nothing in `map-token-move` reads initiative. In a turn-based (not Live) room every non-message command already needs the seat's **room turn** (`src/lib/quire/cloud.server.ts:950-955`). That is separate from encounter initiative (`docs/MAP-TILES.md` line 27).
- **No speed limit:** the docs say "The DM decides movement allowance" (`docs/MAP-TILES.md:19`). Character sheets carry a free-text `speed` (`src/lib/quire/sheet.ts:21`, parsed at `:156`).
- Client: Select / move handles drag, Shift-click additive selection and multi-token drag (`map-tabletop-tools.tsx:187-276`), and arrow keys move the selection (`:466-478`). `useDraftGuard` keeps an unsent move (`:122`).

### Encounters
- Encounters are **account-owned rows in D1**, outside the campaign room (`docs/ENCOUNTERS.md:3`, migration `0008`). Device campaigns use `src/lib/encounters/local.ts`. The routes are `encounters/create|save|start|detail|index|generate|…` (`cloudflare/encounters.mjs:152`, `:198`, `:270`). The combatant has no size field (`src/lib/encounters/model.mjs:5-22`). The Open5e SRD index keeps id/name/cr/type/environments but drops size (`src/lib/encounters/index.mjs:30-56`). The Library's Open5e reader shows "Size" only as text (`src/lib/quire/open5e.ts:140`).
- Map ↔ encounter: `world.combat` binding (`src/lib/quire/map-combat-schema.ts:5-19`) through `map-combat-transition` (DM, revision-checked, `world.ts:407-424`). Start from Initiative › "Start encounter here" or the Encounter map workspace (`src/components/map-combat-workspace.tsx:157-205`), which needs a **saved** encounter.
- Turn data: the tracker's `body.activeId`. A token is the active one when `combatantId === activeId`, or when it is a character token with `entityId === activeId` (`src/lib/quire/map-combat.ts:11-16`, `:52-54`). Server readers: `combatView` → `readCombatView` (`cloud.server.ts:1205-1239`, `src/lib/quire/room-store.server.ts:223`).

### Party travel between maps
- Party place: `party-location` (DM; the location, which closes free placement; refused during a journey) (`src/lib/quire/commands.ts:586-610`). Free point: `party-map-position` (`world.ts:425-447`). A split group goes through `applyGroupLocation` / `applyGroupMapPosition` (`src/lib/quire/party-groups-command.ts:85`, `:118`). In the UI, "Move party here" / "Move <group> here" sits per anchor in the map register (`campaign-map.tsx:1157-1186`).
- Connected maps: `connected.parentMapId`, `links` (entrances with `targetMapId` and an optional entry camera) and `placements` (`src/lib/quire/connected-maps-schema.ts:28-44`). Back to the parent uses `accessibleParent` (`src/lib/quire/map-navigation.ts:9`). The ancestry trail is `mapAncestry` (`src/lib/quire/connected-maps.ts:145`).
- The players' scene is `tabletop-session.activeMapId` (DM; "Activate for players", `src/components/map-session-bar.tsx:26-40`).
- The Here sheet works out "away" (browsing elsewhere is read-only) or "here" (`src/lib/quire/place-hub.ts:405-450`). Journeys: `travellingJourney` (`src/lib/quire/journey-engine.ts:109`). Only approved downtime advances travel.
- Player group moves are **requests** that the DM approves (`party-group-request`, which needs a split party, `party-group-request-review`; `src/lib/quire/party-groups-command.ts:302-327`).
- **Locations already nest.** `marketLocationSchema` has `kind` region | city | town | area and `parentId`, validated as region → city/town → area (`src/lib/quire/shop-locations.ts:6-37`). `locationPath` walks up the tree (`:47-60`). A shop is "here" when its location is on the path of the party's location (`shopAvailableHere`, `:75-85`), and a city district shares its city's market (`globalMarketCity`, `:69-74`). Each map has a single `locationId` (`world-schema.ts:170`). Location anchors on a map point at locations (`map.anchors`).
- **"Same place" for groups** is a location id comparison. `groupPlace` returns `{ locationId, position? }` for the main group (market `currentLocationId` + `partyPosition`) or for a split group (`src/lib/quire/party-groups.ts:62-72`). Merge is enabled when the groups are at the same place (`docs/FEATURE-INVENTORY.md:20`); `party-merge` takes `intoLocationId` (`party-groups-schema.ts:54-61`). Splitting is **DM-only**, refuses pending downtime and journeys under way, and is capped at `MAX_PARTY_GROUPS = 6` (`party-groups-command.ts:176-198`, `world-schema.ts:396`).

### Menus, long-press and gestures
- **There is no context menu on the map.** The only `onContextMenu` suppresses the browser menu after a toolbar long-press (`src/components/map-tools-rail.tsx:179-181`). `contextOpen` in the viewport is the tool-options panel, not a menu (`campaign-map.tsx:1904`).
- Long-press precedent: the toolbar tooltip at **500 ms**, which does not activate the tool afterwards (`map-tools-rail.tsx:159-191`).
- Toolbars use roving tabindex (`role="toolbar"`, `nextRovingIndex`, `map-tools-rail.tsx:83-140`). The Android Back chain already closes `[role="menu"]` popovers (`src/lib/mobile/back-chain.ts:7`).
- Shortcuts: `MAP_SHORTCUTS` (`campaign-map.tsx:228-246`) has V/S/P/M/T/D/J/E/L/I and ⇧ setup keys, with the canvas `onKeyDown` at `:3768-3842`. The command palette opens flows but never runs a command (`docs/FEATURE-INVENTORY.md:98`, `src/lib/quire/command-palette.ts:66`).
- Gestures (`campaign-map.tsx:3844-3951`): pointer capture, a `pointers` map; one pointer pans and two pointers pinch (`:3880-3920`); "moved" means more than **6 px** (`:3885`); wheel zoom (`:2207-2219`). A token drag starts after 0.004 normalized (`map-tabletop-tools.tsx:215`). The viewport is `touch-action:none; user-select:none` (`styles.css:2598`). Layouts: phone ≤ 650 px, landscape ≤ 550 px tall, rail otherwise (`src/lib/quire/map-toolbar.ts:10-15`).
- Haptics: no Capacitor haptics plugin is installed (`package.json:50-55`).

### Grid
- `mapGridSchema` (`world-schema.ts:108-124`) has `columns`/`rows` (1–200), `feetPerTile` (default 5), `diagonal` equal | euclidean | orthogonal | **alternating (5/10/5)**, and a rectangle `x/y/width/height` on the image. **Grids are square only, with no hex.** The scale bar applies to ungridded maps (`:131-143`).
- Snapping is already a shared per-map setting, `tabletop.snap` (default **true**, `tabletop-schema.ts:137`). With it on, the client drops offsets (`map-tabletop-tools.tsx:173-185`) and the server refuses non-zero offsets. With it off, a token can sit anywhere inside its cell's ±0.5 range, which is effectively free movement inside the grid rectangle.
- What "grid off" means today: hiding the grid lines is a **local** view switch (`gridVisible`, `campaign-map.tsx:3567-3576`). Leaving tile mode is a local switch too, and it hides tokens (`campaign-map.tsx:461`, `:959`, `:1972`). Neither one moves tokens.

### Protocol
- `CURRENT_TABLETOP_PROTOCOL = 11` (`src/lib/quire/tabletop-protocol.ts:69-76`). Each additive field in a strict schema gets a protocol number. Older clients receive the field stripped (as with `PLACEMENT_STYLE_PROTOCOL` and `MAP_SCALE_PROTOCOL`, `:20-29`), their saves keep the stored field (`world.ts:496-512`), and pending drafts they can't parse are refused with "finish on the updated website" (`tabletopResponse`, `:640-725`).
- The offline engine runs the same `applyCommandBatch` (`src/lib/quire/economy.ts:13`, `:3001`). One batch is all or nothing on a cloned table (`commands.ts:310-314`).

---

## 1. Player tokens

### 1.1 Movement rules (owner decision, 2026-10-29)
> "Remember to separate turned based when combat is active, and free movement when it isn't or otherwise not constricted by the DM."

| Situation | Who may move a character token |
| --- | --- |
| **No active combat on this map** | The player moves their own tokens (and tokens they are a controller of) freely, unless the DM restricted movement (see 1.2). |
| **Combat active on this map** (a `world.combat` binding with `phase: "active"` and `mapId` = this map, and the tracker row `status: "active"`) | **Turn-based automatically.** A player may move only the token whose combatant is the tracker's `activeId`, and only if they control it. Everyone else sees "Not your turn — <name> is acting". |
| **Combat ends** (the binding is cleared by Return, or the tracker is concluded) | Movement returns to free automatically. Nothing is stored for this; it is derived. |
| **DM** | Always moves anything (unchanged, `tabletop.ts:44`). |

**Overrides the DM keeps:**
- **Map-wide setting** (Settings › Players & display and the scene inspector): *Player movement* = **Automatic** (the default: free, or turns during combat), **Off** (DM only, today's behaviour), or **Ask the DM** (proposed, PR 8: a player's drag becomes a pending move the DM approves or denies, like `party-group-request`).
- **Per player or per group:** the existing per-token **Lock** (`locked`, enforced at `tabletop.ts:48`) locks a player out of moving even outside combat. Group commands (section 4) lock or unlock many tokens in one command. A new optional per-map `lockedPurseIds` keeps the lock when that character's token is removed and placed again. This is DM-only and projected to a player only as their own "locked" flag.
- During combat the DM can still move any token, and can **Give this turn's move to…**, which adds a one-turn controller. It is shown as a token menu item and is optional in PR 2.

**Stored shape:** add `movement: "auto" | "off" | "approval"` (optional) beside the legacy `playerMovement` boolean. Reading rules:
- `movement` absent and no `map.tabletop` at all → `auto` (the owner's new default).
- `movement` absent and `playerMovement: true` → `auto`.
- `movement` absent and `playerMovement: false` on a map whose tabletop **was** configured → **`off`**. The schema can't tell a deliberate "off" from the default (`tabletop-schema.ts:135`), so the plan won't silently open movement on a map a DM may have closed. The DM gets a one-time notice in Settings: "New: let players move their own tokens — Turn on Automatic". This is question Q1.
- Writes keep `playerMovement` in step (`auto`/`approval` → `true`, `off` → `false`), so older clients still read the setting sensibly.

### 1.2 Players placing their own token
New command `map-token-claim` (player, or DM on a player's behalf). It places the seat's own character token on a map where that character has none.
- The server checks:
  - the seat controls `purseId` and the character is visible;
  - `mapAccessible` and `map.visible`;
  - the map's `movement` is not `off` and the character is not in `lockedPurseIds`;
  - there is no existing token with `kind: character` and `entityId` = purseId;
  - the destination is inside the grid, snapped (section 2) and visible to the seat (`scenePointVisible`, same as `:413-417`);
  - combat: if combat is active on this map, the claim is allowed only on that character's turn, or the DM placed it.
- The token is created with `visibility: "party"`, `kind: "character"`, the size from the character (section 2.2) and no `controllerPurseIds`.
- UI: a player with no token on the active map sees a **"Place my token"** chip in the map feedback area. On desktop, right-click › "Place my token here". On mobile, the radial "Place me here". Tap a square to confirm.

### 1.3 Server authorization
- Everything stays in `canMoveMapToken` and `applyTabletopCommand`. The client checks are only for convenience.
- A combat turn check is added to `map-token-move`, `map-token-claim` and `map-token-follow`. The turn lives in D1, outside the room row, so `submitCommands` (`cloud.server.ts:837`) reads it once per batch when the batch holds a player token command and `world.combat` is active. It uses the same statement as `readCombatView` (`room-store.server.ts:223`). The `{ encounterId, status, activeId }` result is passed to `applyCommandBatch` through the existing execution context (the `executionFor` pattern, `commands.ts:310`). This follows how `manualRolls` is read before the batch (`cloud.server.ts:876-878`).
  - **Fail closed:** if the row can't be read while combat is active, the player's move is refused with "The turn order is unavailable — ask the DM". The DM is never blocked.
  - The read happens inside `retryRoomWrite`, so a turn change between read and commit is caught: the binding is part of the CAS'd room, and the tracker revision is compared again after the read.
- Offline (device) campaigns have only the DM seat, so the turn check is a no-op there.
- **The room turn (turn-based rooms) is still separate.** Today a player in a non-Live room can submit only on their room turn (`cloud.server.ts:954`). That is question Q2: whether token moves should be exempt, like chat and loot claims.

### 1.4 Fog and visibility
These are unchanged and also apply to claims, follows and group moves made by players:
- the destination must be visible to the seat;
- walls block movement unless the DM overrides;
- hidden (`dm`) tokens never reach players (`tabletop.ts:170-178`);
- a player's preview never shows squares they can't see.

Formation previews made by the DM may land in fog. Player-side placements are never offered in fog.

### 1.5 Conflicts and revisions
- Every command carries `before` positions (or the whole token), like today, plus the grid fingerprint. A stale move gets "A selected token moved or changed. Refresh before moving it." The preview is kept (`useDraftGuard`).
- New commands use client UUIDs as idempotent IDs and are covered by the receipts in `submitCommands` (`cloud.server.ts:899-935`).
- A turn change racing a move: if the turn passed while the move was in flight, the server refuses with "Your turn ended — the move was not saved", and the token snaps back with the preview kept for 3 s.

### 1.6 Older clients and protocol numbering
- New optional fields (`movement`, `lockedPurseIds`, token `footprint`/`sizeClass`/`anchor`, `partyFormation`, the `followView` campaign setting) and new command kinds (`map-token-claim`, `map-tokens-place`, `map-tokens-edit`, `map-token-follow`, `map-grid-snap`) need protocol numbers.
- **We need to coordinate the numbers.** Protocol 11 is current, and another agent may take 12 for history work. Claim the next free numbers in `claude/shared-status.md` before the first schema PR. These plans use them as **P+1** (footprints/snap, PR 1), **P+2** (movement rule and claim, PR 2) and **P+3** (group commands and follow, PRs 3 and 7).
- For protocols below these numbers:
  - fields are stripped in `tableForProtocol`;
  - older saves keep them (the pattern in `world.ts:496-512`);
  - pending drafts with new kinds are refused (`tabletopResponse`);
  - footprint tokens are sent in the **centre form** described in section 2.6, so older apps draw them in the right place.
- The server enforces the new movement rules for every protocol. An old client can't skip the turn check, because the check lives on the server.

---

## 2. Grid snapping and size footprints

### 2.1 Snapping to the dropped square
- **Grid mode on** (`tabletop.snap = true`): every placement and drag lands on the square under the pointer. This covers player, character, monster/enemy (`creature`) and `other` tokens, for drag, Place party, roster import, claim and follow. Formations (section 4) are placed square by square.
- For a token wider than one square, the square under the pointer is the square the **grabbed point** of the footprint falls into. Grabbing a Large token by its lower-right square keeps that relationship, so the token doesn't jump under the finger.
- One shared function, `snapTokenPosition(grid, footprint, point, grabOffset)` in `tabletop-geometry.ts`, is used by the client preview, the server validator and the offline engine.
- **On the server**, a player move with snap on must already be snapped and inside the grid with its whole footprint. Today the server refuses rather than relocating (`tabletop.ts:409-410`), and the plan keeps it that way: "snapping on the server" means the server runs the same function and refuses a mismatch with a clear message. If it moved the token silently, the saved square would differ from the preview the player saw. The owner's phrase "a player's move snaps on the server too" is read as "the server enforces snapping"; this is noted in Q-list item Q3.

### 2.2 Size footprints
| Size | Footprint | Notes |
| --- | --- | --- |
| Tiny | ¼ square (2.5 ft) | Up to 4 share a square. With snap on, a Tiny token snaps to one quadrant (offset ±0.25). |
| Small, Medium | 1×1 | |
| Large | 2×2 | |
| Huge | 3×3 | |
| Gargantuan | 4×4 by default | The DM can set 5–8. |

- Stored as an optional `sizeClass` (tiny | small | medium | large | huge | gargantuan) and an optional DM override `footprint` (an integer number of squares per side, 1–8, or `0.25` for tiny-style), both on the token.
- Where the default size comes from:
  - SRD/Open5e creatures: keep `size.key` in the creature index (`index.mjs` currently drops it) and copy it into the combatant as an optional `size`, which is additive (the combatant schema strips unknown keys, so this needs `model.mjs` changes, but no migration because the encounter body is JSON).
  - Characters: parse the sheet's `size` field, which the sheet importer already lists (`sheet.ts:249`), else Medium.
  - NPCs and custom tokens: Medium.
- The DM overrides the size in the inspector (a "Size" select, plus "Custom squares") and through the token menu › Size.
- **Drawing:** the token becomes a round portrait or initial disc scaled to its footprint in map space (inside `map-layer`, so it zooms with the map). There is a 44 px minimum hit target on screen; when zoomed far out, the icon keeps 32/44 px and shows a footprint outline. The current record-icon grouping stays for pins and ships. The existing `style.size` stays as a **visual** scale for legacy tokens with no `footprint`.

### 2.3 Anchor: top-left square, chosen and justified
The canonical stored position of a footprint token is its **top-left square** (`column`, `row`) with offsets 0. A new marker `anchor: "corner"` says the token uses that meaning.

Why top-left:
1. The same rule works for odd and even sizes. A centre anchor has no centre square for 2×2 and 4×4.
2. Bounds and collisions are integer ranges (`column … column + n − 1`), so the server validation is exact and cheap.
3. It matches how VTTs and the D&D grid diagrams lay out Large creatures.
4. Formations and the "occupied square" checks can work on whole squares.

Legacy tokens (no `anchor`) keep today's centre meaning, so nothing already placed moves. A token changes to the corner form only when the DM sets a size or snaps it. Medium tokens look the same in both forms.

### 2.4 Hex grids
Hex grids are **out of scope for now**. The grid schema is square only (`world-schema.ts:108-124`), and hex footprints, diagonals and walls would need their own geometry. See owner question Q4. The proposed default is to defer hex to a later proposal.

### 2.5 Grid off, and turning the grid on
- **"Grid mode"** in this plan means the shared `tabletop.snap` setting together with drawing the grid lines. It shows as one "Grid mode" switch in Layers/Settings for the DM. The per-viewer "Grid lines" display toggle stays where it is.
- **Grid mode off** (`snap: false`): tokens move freely. They keep exact sub-square positions through the existing `offsetX/offsetY`, inside the grid rectangle. Turning grid mode off **never moves a token**; only `map-tabletop` is sent.
- Maps with **no grid at all**: tokens still need a grid (today's model). When the DM first places a token on an ungridded map, the plan creates a **hidden grid** covering the image, based on the scale bar if there is one, else 5 ft and about 40 px squares, with `snap: false`. Tokens can then be placed freely and the grid can be shown later. This adds no schema change. A `hidden` flag for the grid lines is added only if the owner wants it (folded into Q4).
- **Turning grid mode on** opens a choice dialog (mockup `grid-snap.html`):
  - **(a) Snap tokens to the nearest squares** — *recommended default.* This is one new DM command, `map-grid-snap`: `{ mapId, grid fingerprint, before: tokens[], snap: true }`. It sets `snap: true` and moves each token to its nearest legal square (footprint inside the grid) in one authoritative, revision-checked command. It is undoable: the "Undo" toast sends the inverse `map-grid-snap` with the saved positions, which is allowed while nothing has changed since.
    It is recommended because it keeps the grid the DM calibrated (often aligned to the artwork) and gives an exact, predictable result. Tokens move at most half a square.
  - **(b) Align the grid under the tokens:** offset the grid origin by the circular mean of the token sub-square offsets, so most tokens fall inside squares. The tokens stay exactly where they are on the image and their grid coordinates are rewritten. This is one `map-save` with the grid and the re-expressed tokens. It is useful when the tokens were placed carefully on the artwork. It can push the grid off the artwork's printed lines, which is why it is not the default.
  - "Just turn it on" keeps today's behaviour: tokens with offsets stay where they are until they are moved.
  - **Undo** works for both (a) and (b), using the inverse command or the previous map. Turning grid mode off afterwards never moves anything.

### 2.6 Older clients and server checks for footprints
- For protocols below **P+1**, the server sends corner-anchored tokens in the **centre form**: `column += floor((n−1)/2)`, `offset = ((n−1)/2) mod 1` (0 or 0.5, which the schema allows, `tabletop-schema.ts:113-114`). It strips `anchor`/`footprint`/`sizeClass`. Older apps then draw the token at its true centre.
- An old app's move comes back in the centre form. The server converts it back with the inverse, exactly as `legacyDiagonals` accepts the old grid fingerprint (`tabletop.ts:390-393`).
- Server checks: footprint bounds, snap legality for the footprint (offset 0, or quadrant for Tiny), the destination visible for players (the footprint centre), walls between the centres. Squares overlapping other tokens are not refused; the DM rules on that, as today. Group placement avoids occupied squares anyway.

---

## 3. DM right-click menu (desktop)

Mockup: `context-menu-desktop.html`. The menu opens at the pointer on `contextmenu` over the map canvas. It replaces the browser menu only inside `.map-viewport`, and it shows only actions the seat can do. Every item opens an existing flow or sends one authoritative command. Like the command palette rule, nothing destructive runs without the usual confirmation.

**On empty map (DM)**, grouped:
- **Encounter**
  - *Start encounter here…*: opens the Encounter map workspace with this map as the target and the clicked point as the return camera. The menu shows the saved encounters' names; *New encounter…* uses `encounters/create`.
  - *Add creatures here…*: SRD/Library search (`encounters/index`, the Open5e SRD index). The chosen creatures are added to the bound or chosen encounter (`encounters/save`, revision-checked), then placed as DM-only tokens in a cluster at the point (`map-tokens-place`).
  - *Add characters here…*: a multi-select of campaign characters.
- **Party**
  - *Place party here* (the default formation) and *Place selected players here*: both use `map-tokens-place`.
  - *Move party to ▸*: the submaps whose `parentMapId` is this map, the entrances (`links`) near the point, location anchors near the point, and the parent map. See section 3.1.
  - *Set party position here*: the existing `party-map-position` (the free point).
- **Place**: *Place record here…* ⇧R, *Marker here* ⇧M, *Entrance here* ⇧E, *Location link here* ⇧L. These arm the existing setup tools with the point already chosen (`SETUP_PLACEMENT`, `campaign-map.tsx:188-196`).
- **Table**: *Ping here* (P), *Measure from here* (M), *Share this view with players*, *Activate this map for players* (`tabletop-session`).
- **Reveal**: *Reveal around here* (a brush circle using the current radius, `map-fog shape`), *Conceal around here*, *Add light here* (`map-tabletop`), *Fog brush* ⇧F.

**On a token (DM)**:
- *Open sheet* (characters), *Open in tracker* (creatures)
- *Move to…* (a keyboard square picker)
- *Select all party tokens*
- *Hide from players* / *Show to players*
- *Lock movement* / *Unlock*
- *Add to initiative* / *Remove from combat*: encounter `save` adds or removes the combatant. A character combatant uses `id` = purse id, so it matches `map-combat.ts:54`. Then `map-token` links the token.
- *Size ▸*: Tiny … Gargantuan, Custom
- *Controllers…*
- *Give this turn's move to…* (only during combat)
- *Send to map ▸*
- *Remove token*: confirm first, using `map-token` with `token: null`.

With several tokens selected, the same menu applies to the selection: "4 tokens".

**Players** get a short menu:
- on empty map: *Place my token here* (when allowed), *Ping here*, *Measure from here*;
- on their own token: *Open my sheet*, *Ping*, *Centre*.

**Keyboard and screen readers**
- The ContextMenu key or **Shift+F10** on the focused canvas opens the menu at the keyboard crosshair (the view centre, which keyboard placement already uses, `campaign-map.tsx:3792-3795`). On a focused or selected token it opens at that token.
- The menu is `role="menu"` with `role="menuitem"` items and `role="group"` + `aria-label` for its sections. Submenus use `aria-haspopup="menu"` and `aria-expanded`.
  - ↑/↓ move, Home/End jump to the ends, → opens a submenu, ← or Esc closes it, Enter or Space activates, and a letter typed jumps to the matching item.
  - Focus returns to the canvas, or to the token, when the menu closes. A second Esc closes the menu without disarming tools.
  - The menu is announced as "Map actions at column 12, row 8" through `map-announcer`.
  - Shortcut hints are shown with `aria-keyshortcuts`.
- The Android Back chain already closes `[role=menu]` (`back-chain.ts:7`).
- The canvas region gets `aria-keyshortcuts="Shift+F10"`.
- `MAP_SHORTCUTS` gets a row: "Shift+F10 / Menu key — Map actions here".

### 3.1 Moving the party to a submap or connected map
*Move party to ▸ <map>* runs **one batch**, in this order, all or nothing (`commands.ts:310`):
1. If the destination map has a `locationId` different from the party's place: `party-location` (or the group's), with the existing checks: pending downtime and journeys refuse (`commands.ts:586-610`).
2. Optionally (on by default) `tabletop-session` with `activeMapId = destination` and a camera at the entry point, so players follow.
3. If the destination has a grid: `map-tokens-place` places the party's character tokens on the destination, in the default formation at the entry point, and removes them from the source map (`remove` list).

The entry point is the destination's link back to the source if one exists, else the entrance's entry camera centre, else the party marker, else the map's initial view centre. A summary dialog lists what will happen ("The party moves to The Cellar · players' scene switches · 4 tokens placed at the trapdoor") before sending.

If the party is split, the submenu offers each group ("Move Group B to…").

---

## 4. Mobile radial wheel

Mockup: `radial-mobile.html` (390 px), checked at 320 px.

**Gesture**
- One finger held still on the map for **500 ms** (the same as the toolbar long-press, `map-tools-rail.tsx:163`) opens the radial, centred on the press point.
- **Cancel the timer** if:
  - the finger moves more than **6 px**, the threshold where pan already starts (`campaign-map.tsx:3885`), so pan always wins;
  - a second pointer arrives (pinch, `pointers.size > 1`);
  - `pointercancel` fires;
  - a tool other than Pan/Select is armed (fog, walls and the rest keep their own gestures);
  - placement or ping mode is active.
- **On a token** the player or DM can move: moving before 500 ms is a drag (unchanged); holding still opens the token radial. A progress ring fills from 150 ms to 500 ms, so the press is visible and doesn't feel stuck.
- Selecting:
  - **slide-to-select:** keep the finger down, slide onto a slice, release;
  - **tap-to-select:** release in the centre, the radial stays open, then tap a slice.
  - Release on the centre or outside the wheel closes it. Android Back, Esc and the ✕ hub also close it.
- **Haptics:** a short tick (`navigator.vibrate(10)`) when the radial opens and when the finger enters a slice. On the APK this can use `@capacitor/haptics` (a new dependency; add it to `resources.ts` credits if adopted, Q5). It is skipped when vibration is unavailable or the user has reduced motion.
- `contextmenu` (which Android WebView fires on a long press) is prevented inside the viewport. `touch-action:none` is already set.

**Slices** (8 at most; DM view): Start encounter · Add creatures · Add characters · Place party · Move party to ▸ · Ping · Reveal · **More**.
- *More* opens a bottom sheet with every desktop menu item in the same groups, within thumb reach. Submenus (Move party to ▸, Size ▸) open as a second ring, or as the sheet on 320 px.
- The token radial has: Sheet, Hide/Show, Lock, Initiative ±, Size, Send to ▸, Remove, More.
- Players get 3–4 slices: Place me here, Ping, Measure, My sheet.

**Layout**
- Diameter 248 px at 390 px wide and 216 px at 320 px. Slices are at least 48 px targets with labels under icons.
- The wheel is clamped to the visible viewport (16 px gutter, safe-area insets), so near an edge it shifts inward with a small pointer to the true point.
- **One-handed reach:** when the press is in the top third, the wheel opens with "More" on the lower side, so the bottom sheet stays the fallback. The sheet always opens from the bottom.

**Reduced motion:** no scale or rotation animation; the wheel appears with an opacity change only (or instantly) and the progress ring becomes a static outline.

**Accessibility:** the radial is the same `role="menu"` as the desktop menu. Slices are `menuitem`s in clockwise DOM order, so TalkBack swipes through them. Screen-reader users without long-press use the "Map actions" button in More tools, which opens the same menu at the centre crosshair.

---

## 5. Group placement and group commands (DM)

Mockup: `group-placement.html`.

- **Place party:**
  - Trigger: the "Place party" tool, which replaces the per-character Combat token loop, the right-click menu or the radial.
  - **Pick tokens:** a sheet lists the party characters. They are all ticked by default and split groups are separated. Characters that already have a token on this map are marked "will move".
  - **Formation:** cluster (default), line or circle, with spacing in squares. **R** or the rotate button rotates, and the mouse wheel with Alt changes spacing.
  - **Preview:** ghost footprints follow the pointer, snapped square by square (section 2). The planner skips occupied squares, squares outside the grid and wall-blocked squares, and marks squares in fog with a hatch for the DM.
  - **Confirm:** click or tap once. This sends one `map-tokens-place` command, with an Undo toast.
- **Multi-select:**
  - desktop: **Shift+drag** on empty map draws a selection box (plain drag still pans), and Shift-click adds or removes tokens (existing);
  - mobile: a **Select** toggle in the group bar makes taps toggle tokens, and drag-select works while it is on;
  - **Ctrl/⌘+A** on the canvas selects every visible token.
- **Group command bar** (bottom centre; on phones, a sheet above the dock) shows "4 selected":
  - *Move together*: existing `map-token-move`, up to 100 tokens, already one command;
  - *Hide / Show*;
  - *Lock / Unlock movement*;
  - *Add to initiative / Remove from combat*;
  - *Size*;
  - *Formation*: re-arrange the selection in place;
  - *Send to map ▸*;
  - *Clear*.
- **Group settings** (Settings › Combat › Group placement):
  - the party formation default (cluster, line or circle, plus spacing), stored as an optional `partyFormation` on the campaign tabletop session settings;
  - player movement on this map (section 1.1).

**Commands** (one authoritative command each; revision-checked through `before`; client UUID ids):
- `map-tokens-place` (DM): `{ mapId, grid, place: [{ tokenId, before: token | null, token }] ≤ 50, remove?: [{ mapId, grid, tokenId, before }] ≤ 50 }`. It creates or moves tokens and optionally removes them from other maps (Send to map / Move party to). Ship-crew carry is reused from `world.ts:463-486`.
- `map-tokens-edit` (DM): `{ mapId, edits: [{ tokenId, before, token }] ≤ 100 }` for hide/show, lock, size, controllers and the initiative link.
- Initiative add/remove also writes to the encounter tracker. That store is separate (`encounters/save` with its own revision), so it can't share the room transaction. Order: tracker first, then link tokens. A failure after the tracker save leaves a combatant without a token, which is harmless and shown with "Link tokens" retry. The combatant ids are derived (purse id for characters, token id for others), so a retry never duplicates.

---

## 6. Token follows the player's map view (option)

Owner: "Give an option so that When a player switches map view it automatically moves their character token to that map."

**Who controls it and the default:** a DM campaign setting, **"Character tokens follow players' map view"**, **off by default**, with an optional per-character opt-out. When the DM turns it on, the player sees a "Follow me" switch, on by default, in Map › Settings › Players & display.
- It is off by default because browsing is read-only today: the Here sheet's "away" mode (`place-hub.ts:415-447`) treats viewing another place as only looking. Silently moving a token would change the shared table for everyone just because someone looked at another map.
- The player's switch lets someone browse without dragging their token around.

**What it does and doesn't move:**
- It moves the **map token only**. It never changes the party location, split groups, character positions, journeys or ship boarding. This is the same separation as today, where "Combat token placement … does not change party membership, ship boarding, campaign location or voyage progress" (`map-tile-controls.tsx:585-588`).
- **Which maps count:** only a map that is all of the following:
  - accessible to the seat (`mapAccessible`) and shared (`visible`);
  - gridded (or given an automatic hidden grid by the DM, section 2.5);
  - **in the character's zone** (section 6A), which moves the token only, **or in an adjacent zone** (linked by an entrance, a parent/child map or a location anchor), which moves the token and splits the character off (6A.2, 6A.4). Any other zone needs a journey.
  Browsing a map in a zone that isn't a neighbour (another town far away) moves nothing and shows "Viewing only — <name> is in Testville. Travel there with a journey." Hidden or DM-only maps are never in the player's projection, so the client never sends a follow for them. The server refuses with the generic "This map is unavailable." (`tabletop.ts:258`), so no message confirms that a map exists.
- **Journeys:** while the character's group is travelling (`travellingJourney`, or a free `partyPosition`), a token follows only onto the map that shows the party marker. Travel still advances only through approved downtime, and following never moves the marker.

**Groups (the owner answered this with zones, section 6A):**
- A follow inside the character's **zone** moves the token only and never splits the party.
- A follow onto a map in **another, adjacent zone** would split that character off. Whether that happens immediately, waits for the end of the session, needs a party vote or is refused is the DM's **split rule** (6A.9).
- With zones not set up, every map gets a zone derived from its location (6A.1). So a city map and its district maps already share a zone, and a wilderness region map is its own zone.

**Combat:** switching maps during active combat is **never blocked**, since viewing stays free. But a token in an active combat (on the combat map, or with a combatant in the active encounter) **does not move**. The player sees "In combat — your token stays on the Battle map". After combat ends, the next map switch follows normally.

**Placement on the destination:**
- The token goes to the destination's link back to the source map, else the group's party marker, else the initial view centre. It is snapped, footprint-aware and placed on the first free visible square near that point.
- The token on the map the player left is removed in the same command; tokens on other maps are untouched.
- If the character already has a token on the destination map, that token is used (moved only if it is not visible to the player; otherwise it is left where it is).

**Server enforcement:** a new command, `map-token-follow` (player or DM), with `{ purseId, fromMapId?, toMapId, beforeFrom, beforeTo, at }`. The server checks:
- the setting is on and the character hasn't opted out;
- the seat controls the character;
- both maps are accessible and visible;
- the same-place rule above, computed from the room's own data;
- no active combat for that token;
- movement is not `off` and the character is not locked on either map;
- the destination is visible to the seat;
- the snap and footprint rules.
The command is debounced on the client (sent 1.5 s after the view settles), so quick browsing doesn't send many commands.

**UX:** a toast reads "Your token moved to The Cellar" with **Undo**. Undo sends the inverse follow, with the same checks, and is valid until something else changes the token. A pending or refused follow never blocks the map switch.

---

## 6A. Zones: maps that count as one place (owner, 2026-10-29)

> "We should give the option for the DM to combine multiple maps into one location/ group of locations … Players moving between those maps do not split the party … a map that took the player outside of the city … would automatically split the party as their location/ Zone would change."

### 6A.1 Model: reuse the location tree, with an explicit override
Locations already nest region → city/town → area (`shop-locations.ts:6-37`), and maps carry a `locationId`. So a zone is defined first by that tree, and the DM can override it:

- **Derived zone (the default, no setup):**
  - A map's zone is the **city or town** on its location's path (`locationPath`), together with all of that place's areas. So "City-Testville" (location Testville, a city) and "City-Testville-The Commons" (location The Commons, an area under Testville) are both in zone **Testville**.
  - A map whose location is a **region** (for example "Region-Wilderness-Forest outside of Testville") is in that region's zone, which covers only maps linked to the region itself, not the cities inside it.
  - A map with **no location** inherits the zone of its parent map (`connected.parentMapId`, `mapAncestry`), so a dungeon under the city is in the city's zone. With no parent it is **its own zone**. That is the safest choice: nothing silently becomes "the same place".
- **Explicit zones (the DM's "Zones" editor):** an optional `world.zones: [{ id, name, kind, parentZoneId?, mapIds[], locationIds[], settings: { travel: "free" | "journey", size?: { miles } | { hours }, adjacentZoneIds[] } }]`. A derived zone gets an entry only when the DM changes its settings. A map or location listed there belongs to that zone, ahead of the derived rule. The DM uses this to join places the tree keeps apart (a castle area and its outer ward, two neighbouring hamlets) or to move a map out of its city's zone (a sewer map that should count as a separate place). Each map is in at most one explicit zone; the server validates this. Mockup: `zones.html`.
- `zoneOf(table, mapId)` is one function in `src/lib/quire/zones.ts`, shared by the client, the server and the offline engine. It always gives an id, either `zone:<id>`, `loc:<city/town/region id>` or `map:<id>`.

### 6A.2 Behaviour
- **Same zone:** follow-map-view and token moves between maps of one zone **never split the party**. The party location and groups don't change; only the token moves.
- **Another, adjacent zone:** a player's token arriving on a map in an adjacent zone (by follow, or by "Send to map") would split that character off. The DM's **split rule** (6A.9) decides what happens: Block, Wait until end of session, or Party vote. A per-zone "Allow freely" override splits immediately. When the split is applied (straight away, after a vote passes, or at the end of the session), it happens in one authoritative command, as below. A zone that isn't adjacent needs a journey (6A.4).
  - If a group of this party is already in the destination zone, the character **joins it**.
  - Otherwise a new group is created at the destination map's `locationId`, or at a free `position` on that map if it has none. It is named after the character ("Mira — Forest outside of Testville") and gets the next free colour.
  - The usual split checks apply: at most `MAX_PARTY_GROUPS`; no pending downtime; not travelling on a journey; keep at least one character in the main group. A refused split gives the player a reason ("The party can't split further — ask the DM"), and **the token doesn't move**.
- **Return:** when the character's token comes back into the zone of another group, the server **merges** the character back (`party-merge` logic, `party-groups-command.ts`). A one-member group dissolves into the group it rejoins. A larger group (two players went out together) merges only when the **last** member returns, or when the DM merges it.
- **The DM's own moves** (Place party, Send to map, Move party to ▸) follow the same zone rule for the characters they move, and the summary dialog lists the split or merge that will happen. The DM can tick "Keep together" to move the party location instead (`party-location`).

### 6A.3 Here sheet, shops and services
These **stay per location** (recommended). A zone decides only whether characters are together; it never makes a shop or service available. The Here sheet, `shopAvailableHere` and the service gates keep using the group's location path, as today (`place-hub.ts:405`, `shop-locations.ts:75`). A character who wanders onto The Commons map inside Testville is still with the party at the party's location until the DM moves the party, so no stock, prices or services open up just because a token moved. The Here sheet adds one line: "Your token is on The Commons (Testville)".

### 6A.4 Zone settings, travel and journeys (owner decision, 2026-10-29)
> "That can be handled with zone settings. For instance a zone could be a region, a town, a city, a forest … It would not be unreasonable to let a player travel throughout a city zone in one session, but it would be unrealistic for them to travel an entire region without inducing downtime."

Each zone, whether derived or explicit, has **settings** (`world.zones[].settings`; derived zones use the defaults for their kind until the DM saves an override):

| Kind | Default "inside" travel | Default size | Derived from |
| --- | --- | --- | --- |
| District / building | Free during a session | — | area locations; maps without a location under a city map |
| Town | Free during a session | ~1 mile across | `town` locations |
| City | Free during a session | ~3 miles across | `city` locations |
| Dungeon | Free during a session | — | DM-chosen (map type Dungeon is a hint) |
| Forest / wilderness | **Journey** | from the map scale, else 10 miles | DM-chosen |
| Region | **Journey** | from the map scale, else 50 miles | `region` locations |
| Custom | DM picks | DM picks | — |

- **"Free during a session"** means token moves and follows between this zone's maps don't touch the journey system and use no campaign time.
- **"Journey"** means moving between places inside this zone, or entering or leaving it, needs the existing journey planner: paces of 18/24/30 miles a day (`world.travel.paces`, `world-schema.ts:281-289`; `docs/MAP-TILES.md` Journey planner), a DM-approved `downtime-plan` (only approved downtime advances travel, `journey-engine.ts`), and the DM confirming arrival with "Move party here" or "Move <group> here". A token never jumps ahead of that. When the journey arrives, the group's tokens are placed on the arrival map (Place party rules).
- **Size and time:** a zone's `size` (miles across, or a fixed travel time in hours or days) is filled in by default from the map's `scale` or grid feet (`journey.ts:29-45`, `scaleDistance`) when its main map is calibrated. The DM can override it. It is used only to **estimate** the trip ("about 2 days at a normal 24 mi/day pace", using `journeyDurationMinutes`/`downtimeDays`, `journey.ts:81-99`). The real duration still comes from the route the DM approves in the planner.

**Crossing between zones (the simple rule):**
- **Adjacent zones** are crossed **freely** (no journey, no time): two zones are adjacent when a map in one has an entrance link to a map in the other, a parent/child map relation, or a location anchor for the other's location. Testville's North Gate → Forest outside of Testville is one example. The DM can untick "Adjacent" on a link to force a journey, or mark two zones adjacent with no link.
- **Anything else needs a journey.** Moving the token isn't allowed; the player sees "This trip takes about 2 days — ask your DM to plan the journey", with a "Propose a journey" button that opens the existing player journey proposal (`party-journey`, time only).
- Which zone's rules apply: crossing uses the **adjacency** rule above. Once inside, the **destination zone's** inside-travel rule applies to later moves.

**Nesting:** explicit zones may have a `parentZoneId`. Derived zones nest the way locations do (region ⊃ city/town ⊃ district).
- **Party split:** characters are together when they are in the **same innermost zone that has free travel**. Testville's districts are one city zone, so they are together. A character in the city and one in the forest of the same region are in different innermost zones, so they are apart. The region alone never keeps people together.
- **Travel:** moving **within a region but between cities** (Testville → another town in the same region) is a journey, because the region's inside-travel is "Journey" and the two cities aren't adjacent. Moving between two districts of one city is free.

Journeys are **decided** (owner, 2026-10-29), and this section records the decision. What happens when an adjacent crossing would split the party is also decided: the DM chooses (6A.9).

### 6A.5 Permissions and privacy
- Only maps in the player's projection can be a destination. Zone membership is **computed on the server** and never sent as a list of map ids. A player's projection gets `zoneName` only for maps they already receive, and `world.zones` is reduced to entries naming those maps (DM-only zones and hidden maps are stripped in `projectRecord`).
- Refusals for hidden maps stay generic ("This map is unavailable."), so a player can't probe which maps exist.
- Groups are projected as today: a player not in a group sees it as "Elsewhere" when it is `hidden` (`party-groups-schema.ts:29`).

### 6A.6 Combat
While combat is active, **changing zone is blocked** for any character who is in the active encounter (a combatant, or with a token on the combat map), and for every character in the combat map's zone: "Finish the encounter before leaving Testville". Moves inside the zone still follow the turn rule (1.1). The DM can still move anyone, but the dialog asks for confirmation.

### 6A.7 Server-side
- New or extended authoritative commands: `map-token-follow` and `map-tokens-place` carry `beforeGroups` (the canonical groups and the character's position) and do split, join or merge **inside the same command**. So the token and the group can never disagree, and a stale group state refuses with "The party changed. Refresh before moving." The split itself reuses the validation functions in `party-groups-command.ts`, run with the server's own permission instead of `dm()`, and only for that one character.
- The zones editor uses `zone-save` (DM, `before`/`after`, revision-checked, at most 200 zones and 500 maps each). Deleting a zone moves nothing.
- Fields need protocol numbers: `world.zones` and the projected `zoneName`, both at **P+3**. Older clients (below protocol 10) are already refused for group actions (`refuseOldClientGroupActions`, `cloud.server.ts:908-913`). Clients at protocol 10–(P+2) receive groups without zones, and their moves are checked on the server with the same rules.

### 6A.8 Notice and Undo
- When a split is applied, the player sees a toast: "**You left Testville — you're now separate from the party.** Mira is in Forest outside of Testville." with **Undo** (mockup in `player-token-move.html`).
- Undo sends the inverse command: the token goes back and the character is merged back. It is accepted only while that group is unchanged (the same `before`), no one else has joined it, and no journey, downtime or combat has started. After that, the toast's Undo is disabled with "Ask the DM to merge you back".
- The DM sees an activity line ("Mira split off: Forest outside of Testville") and the group card on Party.

### 6A.9 Split rule: the DM decides (owner decision, 2026-10-29)
> "Defer to the DM. They can either block travel altogether, make it wait until the end of the session, or poll the entire party."

This replaces the earlier "Zone changes need my approval" switch.

**Setting:** *"When a player's move would split the party"*. It applies only to crossings into an **adjacent** zone that would split a character off (6A.2).
- It doesn't affect moves inside a zone, which never split.
- It doesn't affect journeys, which still need DM approval and downtime.
- It doesn't affect the DM's own moves (6A.2).
- **Campaign-wide** in Settings › Players & display: Block, Wait until end of session, or **Party vote** (recommended default, Q6).
- **Per-zone override** in the Zones editor: *Use campaign setting* (default), Block, Wait until end of session, Party vote, or **Allow freely**, which splits immediately as in the owner's earlier "automatically split" example and suits a city gate.
- When the destination and source zones differ in their override, the **source zone's** rule applies (the zone being left). Stored as `world.travel.splitRule` and `world.zones[].settings.splitRule` (both optional, P+3).

**Block**
- The move is refused, and the token doesn't move. A follow becomes "viewing only".
- Player message: "**The DM is keeping the party together here.** Ask your DM if Mira should split off to Forest outside of Testville."

**Wait until end of session**
- The player's move creates a queued request (`zone-request`, `mode: "session-end"`). Requests are stored in `world.zoneRequests[]`, shaped like `groupRequests` (`party-groups-command.ts:314-326`). Each records the character, source zone, destination map and point, and `beforeGroup`.
- The token stays where it is. The player sees "**Waiting for the session to end.** Mira will go to Forest outside of Testville when the DM ends the session" with *Withdraw*.
- There is one open request per character. A new request replaces the old one after the player confirms.
- **At session end** (the DM's existing `session` command with `end: true`, `commands.ts:921-937`; Desk "End session" / "End & start next"), the End session dialog lists the queued requests. Each one is ticked to *Apply* when it is still valid; *Decline* is the alternative. Applying runs the split commands in the **same batch, before** the `session` command, so they land in the session that ends. The DM can also apply or decline a request any time from the Review Inbox.
  - The requests are **offered to the DM**, not applied silently, because the DM may want to narrate the departure.
- **If the party moved in the meantime**, each request is checked again against the current state when the session ends:
  - The character's group is now in the destination zone: the request is marked *No longer needed* and nothing changes.
  - The destination is no longer adjacent to the character's current zone, the map was hidden or removed, or a journey, downtime or combat now involves the character: the request is *Can't apply* with that reason. The DM can still move the character directly.
  - Otherwise the request is applied from the character's **current** group and position. It is not applied from the old `before`, because the request means "send Mira there", not "replay the past".
- **No session running** when the player asks: the request goes to the DM's Review Inbox straight away, so it never waits indefinitely.

**Party vote**
- **There is no existing vote or poll mechanism** in the codebase. I searched src/lib and src/components for vote/poll/ballot; the only "poll" hits are network polling (`visible-poll.ts`, `detail-poller.ts`). The design reuses the closest patterns:
  - the request/review lifecycle of `party-group-request` and `party-group-request-review` (`party-groups-command.ts:302-327`), with Review Inbox listing;
  - per-player choices that may be sent outside the room turn, like `loot-claim` (`loot-claims-schema.ts:158-168`; turn exemption `cloud.server.ts:950-953`).
- **Who votes (default):** one vote per player seat that controls a character in the mover's **current group**, meaning the people who would be left behind. The mover's own vote counts as yes. DM-controlled characters and NPCs don't vote.
  - *"Present players only"* would need a presence signal, and the app has none today. I found no seat presence tracking; map pings are per-map signals, not presence. So it is offered only once presence exists, and is a later enhancement.
- **Rule:** **Majority** by default, or *Unanimous*, set by the DM.
  - Majority means more yes than no among the votes cast once the vote closes. It closes early when the outcome can no longer change.
  - Unanimous needs every eligible voter to vote yes.
- **Timeout:** **5 minutes** by default; the DM can choose 2, 5 or 15 minutes, or "until the session ends". Nothing runs on a clock (the app has no wall-clock scheduler), so expiry is settled **lazily** using server time:
  - the next `zone-vote`, the mover's client at the deadline, or any seat's `zone-request-resolve` after the deadline settles it;
  - the server refuses an early resolve unless the outcome is already certain.
- **Ties, and no votes cast:** the request **fails** and the party stays together. "Mira stays with the party: the vote tied."
- **DM override:** at any moment the DM can *Approve* (apply now) or *Reject* (close) from the vote banner or the Review Inbox, and can still move anyone directly.
- **Cancelled** with a reason when, before the vote closes:
  - the mover withdraws;
  - the mover's group or token changes;
  - combat starts;
  - the destination stops being valid.
- **When the vote passes**, the closing command applies the split and the token move together, so they can't disagree, and the mover gets the "You left Testville" toast with Undo (6A.8).
- **Privacy:** voters see only the requester's character name, the destination map name (a map every seated player can already open) and the tally. No vote is shown with the voter's name; the DM sees names. A voter whose seat can't see the destination map is not eligible and is counted as absent. That can't happen with today's map visibility, but the check is kept.

**Commands** (all authoritative, with idempotent IDs and `before` checks, enforced on the server):
- `zone-request`: player; `{ requestId, purseId, toMapId, point, mode }`. The mode comes from the server's rule; the client only proposes.
- `zone-request-withdraw`.
- `zone-vote`: player; `{ requestId, vote: "yes" | "no" }`. It may change until the vote closes, and is allowed outside the room turn (Q2 covers token moves the same way).
- `zone-request-resolve`: any seat after the deadline; the DM at any time, with `approve`/`reject`.
- The End session batch reuses `zone-request-resolve` with approve or decline.
- For older clients (below P+3), these are pending-draft kinds they can't parse (`tabletopResponse`), and their attempts to move across zones are refused on the server with "Update Lootsplitter to vote on or request party splits."

**Mockup:** `zones.html` frame 1 shows the split rule in the Zones editor. Frame 2 shows the player's views: a pending vote, from both the mover's side and a voter's side, and a "waiting until the session ends" request.

---

## 7. Shipping (PRs in order)

Branches are `feature/map-tokens-<n>-<slug>`, stacked in this order (owner approval, 2026-10-29). Each PR body records the tabletop protocol number it took, checked against `origin/main` at the time.

Each PR: branch from main, a failing test first, Help review (`src/lib/help/content.ts` DM, `player-content.ts` players), a website changelog JSON (`src/lib/website/web-changes/<branch>.json`), and an Android note in the next release.

| # | PR | Main changes | Tests and audits |
| --- | --- | --- | --- |
| 0 | `docs/map-tokens-plan` | This plan and the mockups in `docs/previews/map-tokens/`, `docs/MAP-TILES.md` "Planned" note. Docs-only. | build job only |
| 1 | `feature/token-footprints-snap` (**P+1**) | `sizeClass`/`footprint`/`anchor`; `snapTokenPosition`; footprint drawing in map space; inspector Size; Open5e size kept in the index and combatants; centre-form shim for old protocols; server snap/footprint validation | `tabletop.test.ts` (snap, footprint bounds, Tiny quadrants, legacy centre conversion round-trip), `tabletop-protocol` tests, `open5e.test.ts`; browser audit `map-tokens-footprint` (desktop/phone, zoom levels, 44 px targets) |
| 1b | `feature/grid-mode-switch` | Grid mode switch; `map-grid-snap` (a) with Undo; align grid (b) via map-save; automatic hidden grid for ungridded maps | unit: nearest-square, align offset, undo inverse, grid off moves nothing; audit: dialog keyboard/focus |
| 2 | `feature/player-token-movement` (**P+2**) | `movement` auto/off rule, legacy mapping and DM notice; server combat-turn check (D1 read in `submitCommands`, fail closed); `map-token-claim`; "Not your turn" UI; `lockedPurseIds` | `tabletop.test.ts`/`room-store.test.ts`: free outside combat, turn-only inside, turn change races, locked, other player's token, fog, old protocol can't skip; `player-view-privacy.test.ts`; audit `map-player-move` (player and DM, Live and turn-based rooms) |
| 3 | `feature/group-token-commands` (**P+3**) | `map-tokens-place`/`map-tokens-edit`; Place party with formations; Shift-drag box; mobile Select mode; group bar; formation default | unit: formation planner (occupied, walls, bounds, footprints), one-command atomicity, idempotent retry; offline parity test (`offline-command-parity.test.ts`); audit `map-group-place` |
| 4 | `feature/map-context-menu` | Desktop menu, empty-map/token/multi variants, Shift+F10/Menu key, roles, announcer | unit for item availability per seat; audit `map-context-menu` (keyboard-only path, focus return, no player sees DM items) |
| 5 | `feature/map-radial` | Long-press radial, thresholds, haptics, More sheet, reduced motion | audit at 390, 320 and 844×390: pan/pinch/drag never open the radial, slide-to-select, Back closes, reduced motion |
| 6 | `feature/party-to-submap` | Move party to ▸ batch; Start encounter here / Add creatures / Add characters quick flows | unit: batch order and all-or-nothing, journey/downtime refusals, split groups; audit device and room campaign |
| 7 | `feature/token-follows-view` (P+3) | `map-token-follow`, the setting and player opt-out, toast with Undo | unit: same-place rule, hidden-map refusal is generic, combat stays, journey rule, undo; privacy test that no hidden map id leaks; audit player switching maps |
| 7A | `feature/map-zones` (P+3, same as 7 or the next number) | `zones.ts` `zoneOf`; `world.zones` + `zone-save`; Zones editor; split, join and merge inside follow/place; split rule (Block / Wait until end of session / Party vote / per-zone Allow freely) with `zone-request`/`zone-vote`/`zone-request-resolve`/`zone-request-withdraw`, End session dialog list, Review Inbox entries; cross-zone notice with Undo; zone line in the Here sheet | unit: derived zones (city+areas, region, no location → parent → own), explicit override, split/join/merge, MAX_PARTY_GROUPS, downtime/journey/combat refusals, adjacency rule, undo window; split rule per mode (block message, session-end recheck when the party moved, no-session goes to the inbox, majority/unanimous, tie fails, lazy timeout, DM approve/reject, cancel on change, votes outside the room turn); privacy: no hidden map id or zone list leaks; `party-groups-room.test.ts` parity; audit `map-zones` (DM editor, player crossing) |
| 8 | optional `feature/movement-approval` | "Ask the DM" movement mode (pending moves in the Review Inbox) | unit and audit |

Help notes (DM): Place party, the right-click and long-press menus, grid mode and sizes, movement modes, token follow. Help notes (players): moving your token, "Not your turn", Place my token, Follow me. No DM setup links in the player guide.
Changelog note examples: "Right-click (or press and hold) the map for quick actions", "Place the whole party in one go", "Players move their own tokens — taking turns during combat".

---

## 8. Questions for the owner (each with a recommended default)

Decided already: movement is free outside combat and turn-based during active combat, and the DM can lock players or groups (section 1.1). This is not asked again.

1. **Q1 — Existing maps.** Should maps where a DM already set "players may move" off stay off, with a one-tap "Turn on Automatic" notice, while new maps (and maps with no tabletop settings) default to Automatic? **Recommended: yes.**
2. **Q2 — Turn-based rooms.** In turn-based (not Live) rooms, should players be able to move their own token outside their room turn, like chat and loot claims? **Recommended: yes for token moves only;** combat initiative still applies.
3. **Q3 — Snapping on the server.** Should the server refuse an unsnapped move, with the client always snapping, rather than move the token to a different square than the player saw? **Recommended: refuse.**
4. **Q4 — Hex grids and ungridded maps.** Should hex grids wait for a later proposal? Should placing a token on an ungridded map create an automatic hidden grid with grid mode off? **Recommended: defer hex; yes to the hidden grid.**
5. **Q5 — Haptics.** Should we add `@capacitor/haptics` for the Android app's radial tick, or use the web `vibrate` only? **Recommended: web `vibrate` now, the plugin with the next APK.**
6. **Q6 — Default split rule.** The DM chooses the rule (decided). The open part is what new campaigns start with. Should it be **Party vote**, by majority, with a 5-minute timeout, where a tie keeps the party together, and each zone can override it? Or is one of Block, Wait until end of session or Allow freely a better starting point? **Recommended: Party vote (majority, 5 min).** Existing campaigns get the same default.
7. **Q7 — Follow-map-view default.** Should "Character tokens follow players' map view" be a DM campaign setting, **off** by default, with a per-player opt-out? **Recommended: yes.** Browsing is read-only today.

Answered and no longer open:
- **Splitting on follow** is answered by zones: same zone, no split; an adjacent zone splits under the DM's split rule; coming back merges automatically (6A.2, 6A.9).
- **Journeys** are answered by zone settings: city, town, district and dungeon zones have free travel; region and wilderness zones use journeys; adjacent zones are crossed freely and anything else needs a journey (6A.4).
- **Movement** is free outside combat and turn-based in combat (1.1).
- **Who decides a split across zones** is the DM: Block, Wait until end of session, or Party vote, campaign-wide with per-zone overrides (6A.9). This replaces the old approval-switch question.
