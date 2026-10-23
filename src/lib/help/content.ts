import { SUPPORT_EMAIL } from "../website/contact.ts";

export const APP_DESCRIPTION =
  "Manage tabletop campaigns with character sheets, shared funds, inventory, shops, encounters, and DM-approved downtime finances. Play locally or in shared rooms, with account-owned campaigns, guest invitations and backups.";
export type HelpTopic = {
  id: string;
  title: string;
  audience?: string;
  paragraphs: string[];
  links: [string, string][];
  /** A public email address shown as a mailto link beside the topic's app links. */
  email?: string;
};
export type HelpGroup = { id: string; title: string; topics: HelpTopic[] };
export const HELP_GROUPS: HelpGroup[] = [
  {
    id: "workspace-windows",
    title: "Tabs, windows & multiple monitors",
    topics: [
      {
        id: "multiple-displays",
        title: "Open screens side by side",
        audience: "DM / Players",
        paragraphs: [
          "Choose Tabs & windows in the app header, select Current screen or another permitted screen, then Open new tab or Open separate window. Move a separate window to another monitor using your computer’s window controls. Your browser may require pop-up permission or choose how a new window opens. Complete the title screen in each new document. The website supports these controls; the Android app keeps its existing navigation and points you to the desktop website for multiple monitors. To show two screens in one window instead, use split view (below), which also works on Android tablets in landscape.",
          "Each window keeps its own screen, scroll position, form entries and selected campaign. Opening a new window preserves the current one. Saved changes refresh other windows viewing the same campaign; shared campaign updates still use the authoritative server and normal Live/Turn-based rules. Pending changes remain pending until submitted. Closing a window does not end the hosted session; retain or export unsent guest work before closing its document. Private PDFs remain on the same device and browser profile.",
          "Another window retains the current role and character permissions. A second DM window contains DM information; it is not automatically a safe player display. For a normal player session, open a current player invitation in a separate browser profile or device. For a TV map or tracker, use the dedicated Player display control. Guests keep campaign contents in document memory, while the new window reconnects to the same authorized seat. Finish or resolve existing drafts before intentionally changing seats or accounts. Sign-in and sign-out affect the browser profile’s account across its windows.",
          "Edit separate records where practical. Saving stale versions of protected records may require a refresh and review; the app does not silently overwrite an unfinished character or encounter form. Tab titles name their screens. Music remains device-local; use browser tab mute when only one window should produce audio. Browsers may throttle minimized or background tabs; restore the window to refresh it.",
        ],
        links: [
          ["Open campaign", "/?view=home"],
          ["Campaign sync & pending changes", "/share"],
        ],
      },
      {
        id: "split-view",
        title: "Two screens in one window (split view)",
        audience: "DM / Players",
        paragraphs: [
          "On a computer, or an Android tablet in landscape (Android 1.9.3 and later), at least 1024 pixels wide, choose Split view in the header’s Layout control or Open beside, then pick a screen. The current screen stays in the left pane and your choice opens in the right pane. Open beside lists the main screens and your tools, marks the screen you used last and offers Open in a separate window… for another monitor. Each pane has its own screen menu plus Swap panes, Show this pane full width and Close this pane. Single screen returns to one screen.",
          "Drag the divider between the panes, or focus it and use the arrow keys (Shift for small steps, Home and End for the limits, Enter or a double-click for 50/50; 60/40 is two steps from the middle). Each pane stays at least 380 pixels wide. Links inside a pane change only that pane; the side menu opens screens in the focused pane. Click a pane or press F6 to focus it: the focused pane is outlined and names the browser tab.",
          "Both panes use this window’s campaign, seat and connection. A purchase, award, encounter turn or map change in one pane appears in the other immediately, and every change is still sent once through the normal authoritative commands. The screen beside is kept in the address, so reloading or sharing the link to yourself restores it; this device remembers the divider position and last screen for the layout toggle. A link without it opens a single screen as before. Narrower windows show only the left screen and bring the right one back when there is room again.",
          "Each pane shows only what your seat could open on its own, and server permissions are unchanged. A DM layout such as Maps beside Encounters is DM-private; use Player display for a TV. Unsaved character or encounter edits ask before a pane closes, swaps or changes screen.",
        ],
        links: [
          ["Open campaign", "/?view=home"],
          ["Maps", "/maps"],
        ],
      },
      {
        id: "player-display",
        title: "Show a map or encounter on a TV",
        audience: "DM",
        paragraphs: [
          "TV output is optional and off by default. In Maps → Settings, choose Enable optional TV / player display first. Then choose Player display in the header, Maps, or a campaign encounter. Select a shared map and an encounter from the current campaign. Open player window for an HDMI or extended desktop display, or Open player tab for browser tab casting. Move the window to the TV and use Fullscreen. For wireless use, choose Cast tab from the browser casting menu; TV and browser support varies. Lootsplitter does not discover receivers or create a remote public display link.",
          "The display starts blank. Select the combatants to reveal, then Show display. New combatants remain hidden until selected; exact HP and conditions are optional. Only saved encounter updates appear. Shared map tokens follow their existing positions and the selected encounter’s active turn. Creature tokens also require a revealed combatant. DM-only markers, tokens, notes, stat blocks and private financial records are excluded. Shared images are shown whole; prepare player-ready artwork because this view does not add fog of war.",
          "Use rotation, zoom and position controls for the map case. Enable the grid if desired. For physical miniatures, set tile pixels, measure the grid on the TV with a ruler and adjust; browser zoom should be 100%. Fit map resets the camera. Grid settings use the map’s saved rows, columns and alignment. Tile-pixel calibration makes tiles square on both axes; fit mode retains the image proportions. Blank display clears its map, tracker and loot immediately.",
          "Show confirmed awarded loot is optional. Loot appears only after the normal Transfer loot once succeeds and records a receipt. Presenting an award does not transfer anything again. The display shows item names and quantities plus the receipt summary; recipient finances, notes, item values and unawarded loot stay private.",
          "Keep the controlling DM window open. Controls remain available across normal in-app navigation. Changing campaign or role resets the display; closing or reloading the DM window clears it after its connection expires. The viewer holds only the sanitized presentation in memory, receives no copied reconnect ticket and loads no campaign/account interface. A fresh viewer skips the normal campaign title screen. This is presentation on your own device, not a security boundary for someone using your signed-in browser or a replacement for player invitations. Desktop web provides these controls; no new signed Android update is included.",
        ],
        links: [
          ["Open Maps", "/maps"],
          ["Campaign encounters", "/encounters"],
        ],
      },
    ],
  },
  {
    id: "world",
    title: "Maps, NPCs, barter & session time",
    topics: [
      {
        id: "campaign-maps",
        title: "Import maps and show locations",
        audience: "DM / Players",
        paragraphs: [
          "Maps is the sixth main tab. Import PNG, JPEG, WebP, MP4 or WebM maps as Regional, City, Dungeon, Property, Wilderness, Battle, Ship or Other, and filter by map type. Property and ship maps can link to an existing holding. New map drafts start private; review the artwork and check Share this map image with players when ready. Review device-local Read location labels suggestions or link locations manually. Existing anchors, markers, record links, filters, pings and zoom remain available in the map workspace.",
          "Connect regional, local and battle scenes in Settings → Connected maps & places. Choose a parent and, optionally, the default Regional, Local or Battle map for its location. A location opens its one eligible local map or explicitly assigned default; multiple choices remain visible for review. Add a map entrance to an exact saved scene, with an optional entry camera. Back to map and breadcrumbs navigate inside Maps; each scene keeps its camera. Browsing never moves the party or advances time. Move party here and Activate for players remain separate actions.",
          "In Connected maps, choose an existing record, choose a point, then Place record on map. Shops, NPCs, property holdings/listings, exchanges, docks, characters, journals and handouts use canonical record IDs. Each pin can be shared or DM-only; source fog and destination permissions still apply. Moving a pin changes its drawing position, not the business location. Selecting a pin opens its place card: the record's name, location trail, status (open or closed, the party is here, DM only pin) and the existing purchase, smith commission, dialogue/barter, property/storage, postage, exchange or ship controls. Several records at one point are listed, and Open in map on a row opens that record's card. Remote browsing grants no service access, inventory or funds. Keep the original Library and feature links available.",
          "An NPC pin opens the NPC conversation hub directly (Barter, Shop, Services, Talk, Farewell; keys 1–5); More about the NPC keeps the full interaction, and Train this NPC stays below. NPCs a player controls keep the usual interaction. The Shop, NPC, Property, Listing and Exchange cards (a post office is its shop) show a Map line: Placed, On several maps, Approximate (shown at its location's anchor), Placed · DM only, or Not placed. Show on map opens /maps?map=…&record=kind:id centred on the pin with its card open, and the card's Copy link to this place shares the same link. Players see a DM-only or hidden pin exactly like Not on a map yet, and any link they can't use shows one neutral message, so links never reveal hidden places.",
          "Place on map (Map line, DM only) opens /maps?map=…&place=kind:id with the record already chosen: tap the map or press Enter to place at the crosshair, choose Party can see or DM only, optionally Portrait pin for an NPC or character, then Save pin. It saves one pin with the usual map save and never changes where the record belongs; a map without an anchor for that place shows a reminder, not an error. Move pin and Place exactly use the same flow. On a place card, DM · this pin switches visibility, icon or portrait, moves or removes the exact pin (removing returns the record to its location's anchor). Portrait pins are opt-in per pin and show the portrait, or the initial. Players opening a place link see the plain map. Here lists what can be used at the party's location; you also see hidden NPCs and unavailable shops there, tagged DM only, which players never receive. Browsing another place's map turns Here into a read-only list of that map's pins.",
          "Hotbar → More map tools → Start encounter here reviews a saved campaign encounter, destination map and combat presentation. A configured default Battle map is preselected. Grid mode requires confirmation of its existing calibrated scale; it never converts regional miles into tactical feet. Show this scene to players activates the shared scene only after combat starts. A saved preparation survives interrupted requests: Finish opening battle map resumes it without duplicating the encounter. Turn-based changes must be submitted before finishing. Import the saved roster through Combat tiles and reveal enemies explicitly. The in-map tracker retains initiative, HP, conditions, Conclude & review loot and the existing one-time award. Return to exploration restores the prior scene/camera without awarding loot or advancing time.",
          "Drag to pan, pinch or scroll to zoom; buttons and keyboard controls are available. The selected map icon has a blue fill and ring. Choose another icon to move the highlight; Close details clears a record selection. The DM places/removes shared or DM-only markers live. A shared image without exploration restrictions exposes all its pixels. Enable manual fog or optional vision to publish only visible pixels. The original artwork, private walls and fog history stay private; a missing or stale player render remains concealed.",
          "Search maps and places (/) finds permitted scenes, locations, shops, people, properties and entrances. A result focuses its marker or opens its scene without moving characters or granting remote service access. Center on party or selection changes only your camera; Fit map shows the full image. Drawing & annotations creates personal freehand lines or text on this device, with undo/redo. Use shared or DM-only markers for campaign annotations. Personal guest drawings and cameras stay in memory for the current guest document.",
          "Move party freely lets the DM tap any map point without creating a listed location. Choose Roads, Wilderness with a biome, River, Sea, Coast, Underground, Dungeon, Settlement or Other, plus an optional description. This clears the linked party location and closes distant located shops/listings; campaignwide records retain their existing rules. Selecting a listed party location ends free placement. Pending downtime must be decided first.",
          "In Edit map, enable Combat grid settings, set columns/rows and align the grid rectangle to your image. A tile defaults to 5 feet; choose another scale and diagonal rule when needed: one tile per diagonal step, straight-line, horizontal + vertical, or Alternating 5/10/5 (every second diagonal step costs two tiles, counted across measuring waypoints and routes). Existing grids keep their rule. Use the grid/token layer to add a character/ship/custom token or load a saved campaign encounter roster. Imported encounter tokens start DM-only. Select each token to share it or link it to an existing character/ship. The selected combat token is highlighted blue, whether chosen on the map or from the Combat token list. Choose a destination by tapping the map or entering column and row, then Save token move. Distances are measured using the map rule; terrain and movement allowances remain DM decisions. Save encounter tracker changes before refreshing its active turn on the map.",
          "Players see only authorized shared tokens and the grid. Player movement starts disabled. Enable assigned-player movement in Inspector → Scene permissions & vision to let players move only their assigned or explicitly delegated, unlocked tokens. Token placement retains character control, wallets, sheets, inventories and physical campaign locations. Moving a ship token carries already placed aboard-character tokens by the same tile offset, and rejects a move that would leave them outside the grid. It never boards characters, teleports a ship to a port, or advances voyage time. Grids cannot shrink past their tokens; move/remove the party or resolve ongoing routes before deleting their map. Changes synchronize through the campaign mode and retry receipts.",
        ],
        links: [
          ["Open Maps", "/maps"],
          ["Complete instructions", "/download/world-features.md"],
          ["Map and tile guide", "/download/map-tiles.md"],
        ],
      },
      {
        id: "online-tabletop",
        title: "Run an online tabletop session",
        audience: "DM",
        paragraphs: [
          "Host an ordinary Live or Turn-based room and send current player invitations. Every remote player uses their own invited session; no TV, receiver or shared room is required. Maps keeps the existing six-tab navigation. Settings → Map library opens searchable scene cards. Viewing a scene for preparation is separate from Activate for players; activate a shared map to direct players, or Clear active scene before removing it. You can restrict browsing to the active scene.",
          "Opening Maps immediately fills the available page and restores your most recent accessible map, position and zoom for this campaign and account on this device. Settings contains map import/edit, Map library, categories, connected maps, grid calibration, access, saved/shared views, filters and optional Player display. Panels overlay the canvas and scroll independently; closing Settings retains its drafts, including location setup before the first map is imported. On phones, scene and camera controls use compact rows, and the tool dock sits along the bottom edge. Swipe the tool row to reach every tool; More map tools and the collapse button stay visible. Map markers keep full touch targets around smaller symbols. The hotbar has Pan (V), Select / move (S), Ping (P), Measure (M), Area template (T), markers and drawing; More map tools includes fog, walls, lights, grid, encounters and undo/redo. Each ping color also has its own shape (red circle, amber square, green triangle, blue diamond, violet star). Screen readers announce visible token moves, pings with the nearest visible label, scene activation and the waiting state. Escape closes a panel or cancels a tool. The upper-left map menu provides connected navigation and all six main destinations; Back to Lootsplitter returns Home. Hide interface (H) hides the controls; Show interface or Escape restores them. Browser bars may remain visible; native fullscreen permission is not needed.",
          "Your camera is independent. Fit map resets it; Save starting view stores a scene's initial camera. Share this view sends one deliberate camera update to players currently viewing that scene. Players can explore independently afterward. A normal DM window contains private information. Optional TV / player display stays off until explicitly enabled.",
          "Select / move supports token dragging, Shift group selection and arrow-key moves after focusing the canvas; Alt + arrows pans. Inspector gives exact column/row entry, linked character/ship/encounter records, locks, delegated controllers, color, size and vision settings. Select another tool or Cancel tool to stop an operation. Escape cancels. Keyboard users pan to aim and press Enter at the center; Ctrl + Enter completes a fog polygon. Failed or conflicting moves retain a preview for review; sync uses existing turn rules and retry receipts.",
          "Measure uses temporary waypoints and the configured grid/diagonal scale. Area template saves a circle, cone, line or rectangle without applying damage or advancing time. Enable player area templates separately if desired. Exploration & lighting provides reveal/conceal brush, rectangle and polygon tools, Reveal all, Conceal all and saved Undo fog / Redo fog history (20 steps each). A long brush stroke is saved as several connected shapes and undoes as one step. Fog storage shows the map's shape count and stored size, and warns as it nears the limits. Consolidate fog… shows the shape count before and after and asks before changing anything: it removes shapes with no visible effect (painted over later, or revealing what was already revealed) and merges rectangles into combined outlines, without changing what players see. Brush strokes, ellipses and freehand polygons that still show are kept as they are. The merge is one Undo fog step; earlier undo steps stay unchanged and Redo fog is cleared. Limits: 500 fog shapes and 200 tokens per map, and 100 maps per campaign; a shared campaign stops saving above 1.8 MB in total, so prefer rectangles, polygons or a larger brush for big areas. Player-view preview shows saved party or selected-character visibility. With fog or vision on, this device renders the protected player view after each change (a short pause groups rapid token moves); players see “Waiting for the DM’s device to update the map…” until it arrives, and a warning appears on your map if the update takes a while or fails, with Retry player view. Keep this device awake while players are waiting. Physical miniatures still need manual positioning and reveals.",
          "Automatic vision is optional: Off, shared party or individual assigned-character sight. Configure sight/darkvision on character tokens, ambient light, lights and wall/door/window/secret-door segments. Doors open/close in Inspector. Movement barriers are optional; the DM can explicitly override them. Vision is a practical 2D aid, with current visibility rather than explored-memory tracking, and does not adjudicate every D&D lighting or movement rule.",
          "Artwork retains detail up to 20 MB, 8192 pixels per edge and 64 megapixels, separately from the preview. Animated PNG/WebP and MP4/WebM maps start paused and provide Play/Pause map animation; protected scenes use a still player view. Universal VTT 0.2/0.3 (.uvtt/.dd2vtt/.df2vtt) imports up to 30 MB prepare a private, concealed draft with grid, walls, doors and lights. Review geometry, clipping/approximation warnings and the default 5-foot cell scale before Save map. Unsupported URLs, active content, versions or oversized metadata are refused. Replacing a scene with placed tokens requires importing a new map to preserve its grid and tokens.",
          "Token movement and map tools change no wallets, inventory, initiative, boarding, physical locations or clocks. Existing encounters, confirmed loot, locations, ships and approved downtime remain authoritative. Use Retry map artwork if a detailed image download fails; its preview and scene stay available. In shared rooms each map picture downloads once and is reused on later updates, so token moves and purchases no longer resend every map; Loading map artwork… shows while a newly shared map arrives. Complete device backups include map media; account backups store artwork separately and restore it before replacing a campaign. Older clients retain source backups and may require the updated website for new tabletop data. Android 1.8.0 and later include the Maps workspace, connected scenes, protected map media, fog and drawing tools; later website changes reach the app in its next signed update.",
        ],
        links: [
          ["Open Maps", "/maps"],
          ["Campaign room", "/share"],
        ],
      },
      {
        id: "location-npcs",
        title: "Create, import and interact with NPCs",
        audience: "DM / Players",
        paragraphs: [
          "Market → People & NPCs lets DMs create non-party NPCs with location, description, portrait, inventory and funds. Players meet visible NPCs at their selected location; the DM responds by default. A configured player-character controller may speak/decide trades for that NPC without gaining configuration permissions.",
          "NPC records start with Details & actions collapsed; expand a record to read its description, interact or configure it. Names still link to Library entries. Create non-party NPC opens its editor beside the creation button above the records; Configure NPC brings that same editor into view. Collapsing a record retains unsaved smith-permission changes.",
          "NPC JSON imports use format lootsplit.npcs, schemaVersion 1, and existing campaign location IDs. Preview before importing; every record is validated atomically. Dialogue is private to the interacting character, DM and configured NPC controller.",
        ],
        links: [
          ["People & NPCs", "/features/npcs"],
          ["NPC import sample", "/download/location-npcs.sample.json"],
        ],
      },
      {
        id: "barter",
        title: "Barter goods and property deeds",
        audience: "DM / Players",
        paragraphs: [
          "Trading & Barter uses bilateral offers and counteroffers for coins, carried goods and clean property deeds. The current recipient accepts or declines; either participant may cancel. Another player's inventory remains private until they offer it. Nearby NPCs require the DM's Bartering allowed flag, and their DM/controller supplies consent. Players never receive NPC or exchange-treasury balances or ledger lines; an assigned NPC controller still sees that NPC's funds. People & NPCs → Party companion funds is the one exception: when on (default off), players with a character in the party can read the coins and coin history of visible NPCs travelling with the party, read-only. Hidden NPCs, NPCs elsewhere and treasuries stay private either way. Party players' balances and ledger lines stay visible to the other players whose character is in the party, as before; a player whose character is not with the party (elsewhere or on downtime) sees only their own.",
          "Acceptance rechecks funds, lots, ownership and location, then exchanges both sides atomically. Stored, reserved, transit or service items cannot be offered. Resolve property obligations or use the existing DM handover. Deeds retain their original receipt and update their owner; accepted history is retained.",
        ],
        links: [
          ["Trading & Barter", "/features/trading"],
          ["Property Management", "/features/properties"],
        ],
      },
      {
        id: "npc-barter",
        title: "NPCs who barter on their own",
        audience: "DM / Players",
        paragraphs: [
          "An NPC with Bartering allowed and no player controller answers offers in a conversation. In People & NPCs choose View & interact, then Barter. The player builds an offer in the drawer and sees a numbered reply such as [PERSUASION · DC 13 · Very likely ~88% · Advantage] before sending it. NPCs with a controller keep the trading table below, unchanged.",
          "NPC barter rules on Trading & Barter choose who answers: DM decides (the default; offers wait in your NPC barter queue), Server rolls, DM confirms, or Automatic. The NPC values goods it receives at 50% of their recorded value and its own at full value; fairness (received ÷ given) sets the DC: 10 + 25 × (1 − fairness), with Generous −2 and Shrewd +2. At 110% or more it accepts without a roll; below 60% it refuses without one. Every number is adjustable.",
          "The room server (or the DM's device offline) rolls Charisma (Persuasion): the sheet's bonus, advantage at Charisma 16 or more, disadvantage at 8 or less, no automatic 20. A miss by 3 or less brings a counter-offer for a little more coin. A failed try locks equal or worse offers for one in-game hour and adds +2 to later tries that day; after 3 failures, offers come to your queue. Trades with the same NPC in 24 in-game hours are judged together, and large deals (over 50 gp, or 200 gp a day), more than 5 units of one good, unwanted categories and player-set item values go to you or count for nothing.",
          "In each NPC's Barter answers you can set its mode, stance, wanted goods and its ten dialogue lines; empty lines use the stance defaults. Your queue shows what the player saw, the NPC's valuation, and buttons to roll, accept, counter, decline, confirm or overrule with a reason. NPC barter activity keeps every attempt; Clear wait lifts a cooldown. Players never receive the rules, the NPC's valuation or purse, or other players' attempts.",
        ],
        links: [
          ["People & NPCs", "/features/npcs"],
          ["Trading & Barter", "/features/trading"],
        ],
      },
      {
        id: "black-market",
        title: "Reveal hidden black-market vendors",
        audience: "DM",
        paragraphs: [
          "Market's Black market toggle reveals/hides configured vendors during play. Each shop's Black-market vendor rules set its hidden status and premium (greater than 1, default 1.5). Stock, location, schedules, rarity, illegal-goods descriptions and ordinary purchase receipts use existing Market tools. The premium applies before the existing Charisma adjustment.",
          "Hidden vendors are absent from player data; stale purchases are rejected. Toggling does not open closed shops or bypass location. The DM can edit hidden vendors at any time.",
        ],
        links: [["Market", "/market"]],
      },
      {
        id: "session-clock",
        title: "Advance session hours, rest and downtime",
        audience: "DM",
        paragraphs: [
          "Start a recorded play session, then open Session Time. Review and advance 1–24 hours per action. Optional short/long rests use the existing sheet resource policies; the DM decides whether the time qualifies. Hit dice, conditions and manual resources remain manually controlled.",
          "The canonical campaign clock settles finances, shop schedules, letters and deliveries at crossed days once. Approved property work can progress by elapsed hours using existing assignments, materials and permissions; travel/rest grants no character labor unless the DM enables it. Pending between-session downtime must be approved/cancelled first.",
        ],
        links: [
          ["Session Time", "/features/time"],
          ["Downtime", "/features/downtime"],
        ],
      },
    ],
  },
  {
    id: "start",
    title: "Start here & find a menu",
    topics: [
      {
        id: "first-campaign",
        title: "Start a campaign or join your party",
        paragraphs: [
          "Sign in to create or claim your owned DM campaign. The campaign selector creates or switches owned local campaigns; My account resumes saved shared campaigns. Each campaign keeps its own characters, purses, inventory, shops and financial history. New blank campaigns do not contain your other campaign’s assets. Guests join an open room through its current invitation.",
          "The DM adds characters and shared party funds in Party → Funds & inventory. Mark each character as Player or NPC; only player characters can be assigned to players. To join a shared game, open Campaign, enter the room code and choose an available character. An account is optional for guest room play. Everyone needs access to the website or a compatible app.",
        ],
        links: [
          ["Open the app", "/?view=home"],
          ["Party & funds", "/party?section=funds"],
          ["Join or host a room", "/share"],
        ],
      },
      {
        id: "menus",
        title: "What each menu does",
        paragraphs: [
          "DM navigation: Desk combines campaign control and overview, with visible multiplayer settings, swipeable Session/Party/Funds/Market/Activity/Rolls readouts, grouped feature links and expandable treasury, activity, sessions and campaign tools; Encounters builds and runs encounters; Party holds character cards, purses and inventory; Market contains shops and trading; Library opens catalog, spells, creatures, names, handouts and private DM books; Maps opens imported location maps, party position and shared markers.",
          "Desk → Market information shows the campaign season and economy mode, inflation, exchange and active-quote counts, and up to three commodity quotes. Ask/bid prices use the listed unit; stock and wanted quantities come from current offers. Percentage changes compare a matching recorded prior season; missing history is labeled. The DM can read campaign-wide prices while travelling, but trading still requires an eligible location and open exchange. Open a quote for its exact exchange/commodity or use Open global market. These website controls require a separately signed update to appear in the Android app.",
          "Player navigation: Home offers fixed buttons for Character Sheet, Bank, My Finances, Properties, Journal and Party chat; Inventory opens your possessions and permitted financial actions; Campaign contains Room, Chat, Rolls and Alerts; Market opens trading; Library opens available references; Maps opens shared cartography and location records. The full campaign overview holds sessions, reviews and activity.",
          "The gear opens Settings & Management. Its categories depend on your role. Use the campaign name to switch campaigns and the message icon for chat. On desktop the same destinations appear in the navigation rail. The DM Desk uses swipeable summaries and phone selectors arranged in two rows. Encounter and review readouts show their destination. Shared connection status stays in the global strip; Multiplayer settings remains beside the desk heading. Previously saved DM shortcuts can still be managed from Dashboard → Saved shortcut settings.",
        ],
        links: [
          ["Settings & Management", "/?view=home#management"],
          ["Campaign control / overview", "/?view=overview"],
          ["Saved DM shortcut settings", "/?view=home&customize=1#saved-shortcuts"],
          ["Open Library", "/library"],
        ],
      },
    ],
  },
  {
    id: "play",
    title: "Characters, encounters & references",
    topics: [
      {
        id: "characters",
        title: "Character sheets and campaign inventory",
        paragraphs: [
          "If a character sheet cannot load, use Retry character sheet beside the error. It retries the read without changing the seat, campaign, pending actions or roll permissions. An open sheet's Sheet tools contains Export sheet / draft and Reload sheet. The phone Jump to dice tray moves focus to the existing dice controls. Reload sheet still asks before discarding an unsaved draft.",
          "Campaign characters use the same character ID, purse and inventory as Party. Changes to permitted coin and equipment fields stay connected to those records. Standalone account characters are separate reusable profiles: their private money and equipment are not silently merged into a campaign.",
          "Play shows vitals, attacks, spells, skills and dice. Edit changes the sheet; save your changes before leaving. Supported JSON, text/form PDFs and device-local image/scanned-PDF recognition can be reviewed before saving. Review every tab: scanned or handwritten extraction can misread values. Player campaign imports require the applicable DM review and preserve campaign money and inventory. Species, classes, levels, conditions, spell effects, hit dice and house rules are maintained manually.",
          "Players control assigned characters and permitted actions. They cannot create money, revalue inventory or change price-affecting Charisma. DM financial adjustments are recorded in the ledger. Buying, selling, transfers and DM awards update the existing inventory. In Party → Add loot, choose Custom loot for items or property, or Open5e loot to search SRD equipment and magic items. Review the item value, quantity, recipient and source notes, then confirm Add holding. Open5e search needs a connection unless saved results are available; custom loot works offline.",
          "Party and People & NPCs let the DM place characters at individual locations, remove/return them to the active party, hide them, or share an NPC sheet read-only. Transfers retain the same sheet, wallet, inventory and history. Individual downtime removes a participant until approved campaign time reaches the recorded finish, then restores its prior placement once. Selecting a character does not grant another player's seat control; full editing and individual field permissions still apply.",
        ],
        links: [
          ["Character sheets", "/characters"],
          ["Funds & inventory", "/party?section=funds"],
        ],
      },
      {
        id: "rolls",
        title: "Dice rolls and game rules",
        paragraphs: [
          "Choose Pen & Paper mode or Virtual Mode in the gear menu (Gameplay for DMs, Rolls for players), or Settings → Roll mode. Your choice is saved on this device and applies to character quick actions, custom dice, encounter rolls and weighted loot-table draws. Pen & Paper mode records physical totals including modifiers; Virtual Mode generates dice. Campaign manual-roll permissions still apply. Switching a roll form’s source also changes this device setting.",
          "Use the sheet’s dice controls for ability checks, saves, skills, attacks, damage and spells. Single d20 rolls support advantage and disadvantage; custom rolls support dice and modifiers. Shared rolls use server-generated dice; local rolls are labeled as device rolls. Each result is recorded in its available history.",
          "The campaign DM controls whether physical/manual results are allowed. Those results are labeled separately. Rolling does not automatically apply damage, conditions, death-save outcomes, spell effects or your table’s combat rules. Encounter XP is an estimate, not an automatic character reward.",
        ],
        links: [
          ["Sheet dice", "/characters#dice"],
          ["Shared roll history", "/share?tab=rolls"],
          ["DM roll controls", "/characters#dm-roll-controls"],
          ["Roll mode settings", "/settings#gameplay"],
        ],
      },
      {
        id: "encounters",
        title: "Build, run and import encounters",
        audience: "DM tools; account drafts optional",
        paragraphs: [
          "Build encounters in your owned campaign after signing in. Offline encounters belong to the DM’s device copy. Signing in also enables private account drafts; you do not need a multiplayer DM campaign to create those drafts. Export encounter JSON on the website and import it into the app when you want to move a draft.",
          "Add or generate creatures, edit the party and difficulty, then track initiative, rounds, HP, AC and conditions. Difficulty uses 2014 encounter XP thresholds and group-size multipliers; terrain, tactics and house rules still need DM judgment. The tracker does not execute combat rules automatically.",
          "Enter initiative scores in Battle tracker without moving the combatant rows. Press Sort initiative when you are ready to arrange highest scores first; ties retain roster order and blank scores go last. Editing or clearing a score keeps the current order until you press the button again. Next turn follows that order. Sorting preserves the current combatant and round; Save encounter keeps the order when you reopen it.",
          "Conclude the encounter, review generated or chosen loot, set item and coin recipients, then explicitly transfer the award. Under Coins go to, choose One purse (every coin, in its original coin types) or Split evenly among the ticked party characters, with the same leftover rule and preview as a party fund split; encounter coins have no source purse, so the leftover goes to the party fund, a chosen character, or the next in rotation (with no party fund, to the character you choose, first ticked until you choose). Split shares are paid in gold, silver and copper. Awards saved before splitting show exactly as before. A confirmed award is applied only once. Account drafts cannot award into campaigns; shared campaign awards require the active DM’s permission. Imported drafts reset outcomes, award receipts and recipients so they can be reused safely.",
        ],
        links: [
          ["Encounter builder & tracker", "/encounters"],
          ["Creature references", "/catalog?pane=open5e&kind=creatures"],
        ],
      },
      {
        id: "references",
        title: "Catalog, Open5e, books and handouts",
        paragraphs: [
          "Library leads to items and services, spell and creature references, and the offline name generator. Open5e imports keep their source credits. Creatures are references, not shop stock. The DM can add custom catalog items, generate goods or review extracted PDF items before adding them to shops.",
          "Import PDFs with selectable text through Books. Private PDFs stay on the device and are not automatically published or sent with player links. Mark an extracted entry as a handout to share its text; review extracted prices and text first. References do not automate rules. Resources lists content and icon licenses.",
          "While reading a PDF entry, Save adds it to Favorites. Books → Favorites, or the Favorites screen, lists saved entries with their book and pages; open one to continue reading. Favorites are kept on this device only, like the PDFs themselves, and are not shared with players.",
          "Library's Resource packs accepts reviewed reusable JSON creatures, item/NPC/location/shop templates and source references. Preview the complete pack, warnings and source notes before adding it. Imported packs stay private to the DM; separate reviewed actions add campaign records or catalogue items without granting funds, inventory or player access.",
          "Players receive searchable, read-only Catalog, Items, Spells and Creatures indices and permission-projected campaign records. Library → Player reference lookup, or Settings & Management → Players & permissions, controls the overall lookup, individual indices and Allow lookup during active encounters. Any active campaign encounter pauses lookup by default; conclude every active encounter to restore it, or use the explicit override. Private account drafts do not block campaign players. Saved sheet spells, inventory and shared campaign records remain readable.",
        ],
        links: [
          ["Library", "/library"],
          ["Spells", "/catalog?pane=open5e&kind=spells"],
          ["DM books", "/books"],
          ["Favorites", "/favorites"],
          ["Handouts", "/library#handouts"],
          ["Sources & licenses", "/resources"],
          ["Player reference controls", "/library#reference-access"],
        ],
      },
    ],
  },
  {
    id: "money",
    title: "Money, shops & downtime",
    topics: [
      {
        id: "blacksmith-services",
        title: "Custom blacksmith commissions",
        audience: "DM",
        paragraphs: [
          "Open a blacksmith shop → Blacksmith services → Configure blacksmith services. Assign a physical shop location and an existing NPC maker. In People & NPCs, check Offers blacksmith services and save that NPC's permission. Every skill level, including legendary, requires this deliberate permission; meeting a smith alone does not enable commissions.",
          "Choose apprentice, journeyman, expert, master or legendary to load editable pricing/quality examples. Adjust labor, item value and work time multipliers, engraving price/days, material rarity/value/stock, and craftsmanship. Magical forge permits only your approved enchantments at or below the maker's skill. Add enchantments with their effects, fees, value and days; new entries start unapproved. Advanced parts, materials & item settings edits validated JSON for any weapon/armor, component, style, material requirement, weight, base description and price. Values are fictional DM rules; no combat modifier is applied automatically.",
          "Players review a full design and price before placing a paid commission. Materials come from finite/unlimited smith supplies or matching, unequipped carried inventory belonging to the paying account. Stored, travelling or reserved materials are unavailable. Acceptance deducts coins and commits materials once, saving the maker, skill, specifications, price, original forge and campaign date. Changed quotes require another review; editing the smith afterward does not rewrite an existing order.",
          "Downtime previews show smith progress and completion alongside ordinary financial/property results. Only approving that preview performs work; session hours and wall-clock time do not. Completed items wait at the original forge for one-time collection into inventory, with components, engraving, enchantment, craftsmanship, maker, order date and actual completion campaign day/time in their description. Market's Blacksmith commission register remains readable while travelling. The DM can pause, resume or cancel with a recorded reason; refunds and salvage are separate recorded finance/inventory adjustments. Review existing commitments before deleting a customer, forge configuration or pickup location. These website controls need a separately signed update to appear in the Android app.",
        ],
        links: [
          ["Market", "/market"],
          ["People & NPCs", "/features/npcs"],
          ["Downtime", "/features/downtime"],
        ],
      },
      {
        id: "currency",
        title: "Coin values, purchases and transfers",
        paragraphs: [
          "Coin conversions: 10 cp = 1 sp; 5 sp = 1 ep; 2 ep = 1 gp; 10 gp = 1 pp. Prices and calculations use copper internally. Dollar estimates are a display comparison, not real-money payments or a change to coin values.",
          "Choose a purse when buying or selling. The recorded Charisma score reduces purchase prices by 1% per point above 10, capped at 20%; party funds receive no Charisma discount. Blank shop stock quantities mean unlimited supply. Finite stock and available funds are checked when a transaction commits. One purchase, sale or listing purchase is 1 to 100,000 units. Device campaigns and shared rooms apply the same checks and records, and pressing Buy or Sell again after an error or a lost response applies that same purchase at most once; changing the purse, item or quantity makes it a new one.",
          "Give transfers coins or holdings between campaign accounts. A transfer is not new campaign income. If a Give or Party payment is refused, for example because funds are short or it is not your turn, the error is shown and the form keeps what you entered; pressing it again applies that same transfer at most once, and the same Party payment at most once in a device campaign. In a shared room a Party payment is a reviewed table change rather than a command, so after a lost response check the ledger before pressing it again. A loan decision that fails to save stays pending with its Approve and Deny buttons, so it can be tried again. In Bank, players request permission to spend coins on expenses such as an inn bill. The DM approves or declines these in Review Inbox; approval deducts coins from the requesting account once. This does not send a bill to a player or transfer payment to the DM. The DM can also queue a proposed expense in Bank. Ordinary permitted purchases use the shop’s buy flow. Transaction history records purchases, sales, transfers, payments and adjustments. Voiding a supported entry records a reversal, and purchased items must be returned before reversing that purchase.",
          "Split coins divides an amount evenly among ticked party characters in one transaction: everyone is paid or nobody is. Use Split on a party fund row or Split coins beside Give in Party → Funds & inventory. Whoever may Give from a purse may split it: the DM, its controller, or a player you allowed to use party funds. Each share is the amount divided by the number of characters, rounded down to whole copper, and is paid largest coins first in gold, silver and copper, added to the recipient's own coins (their platinum and electrum stay as they are). The source pays with exact change, smallest coins first. Leftover copper goes to the party fund by default; a split from a party fund keeps it there, and with no party fund it stays in the source. You can instead keep it in the source, give it to one ticked character, or rotate it, and tick Make this the default to save that rule for the campaign. The preview shows every share, the leftover and the check that nothing is created or lost; Review split, then Split coins. A refusal, such as a balance that changed meanwhile, keeps the form, and pressing again never pays twice. Each split appears once in Activity as one row you can open, in the session list and in party chat. Only you can include companion NPCs: players never see an NPC's share or the split's details, only the fund's debit and their own party's lines. Split lines are transfers, so correct a mistake with a Give or a payment rather than a ledger void. Splitting is not offered on a player-only device link.",
        ],
        links: [
          ["Funds & inventory", "/party?section=funds"],
          ["Market", "/market"],
          ["Requests & history", "/?view=overview#review"],
        ],
      },
      {
        id: "economy",
        title: "Shop generation and economy settings",
        audience: "DM",
        paragraphs: [
          "Create shops from the catalog and choose category, wealth and buy/sell prices. Item variety can use a suggested assortment, a chosen number of item types, or every matching catalog item. Set quantities separately: suggested, fixed units per item, or unlimited. Services remain unlimited. Shuffle generates another name, keeper, location and stock.",
          "In a shop, choose Edit → Add from catalog to select exact items or every filtered match. Existing prices and quantities are preserved and duplicate names are skipped. Custom items remain available through Add item. Inventory totals, search, rarity and stock filters, and pages help manage large shelves; paging does not remove stock or limit PDF exports. Closed shops cannot trade. Restocking adds to finite quantities without replacing your custom entries or changing unlimited stock.",
          "Price modifiers include season, shortages, war, plague, roads, scarcity and inflation. Review the price preview. Enable automatic repricing or choose Reprice open shops now to apply changes to open shops. New-shop defaults affect future shops; changing defaults is not a replacement for editing existing stock.",
          "Market → Trade Exchanges adds separate campaign economies. The DM defines regional quotes, stable commodity units, stock and treasury funds. Classic retains DM values; Automatic proposes the next season from stored d100 rolls, existing economic settings and recorded trades. Prices stay fixed during the season. Review and approve one seasonal transition with end-of-session Downtime, or use Manual season control for a recorded override without advancing days. Session Time does not settle seasons. Property managers and letters can trade stored goods with price limits and existing budget/location rules.",
          "The global commodity market requires a city or city-area location; towns, regions and an unset location do not grant access. Sixty editable fantasy commodity templates ship with the app. Reviewed JSON/CSV/TSV imports add definitions without goods, quotes, stock or money. Every city without its own exchange receives an editable empty Trade Exchange and zero-funded NPC treasury, including older saves and imported cities; custom exchanges and their settings remain intact. Populate and enable an exchange deliberately before trading.",
          "Reviewed suppliers keep the same material and commodity identity through delivery. Orders use the shop's configured selling price, any active premium and the payer's existing Charisma discount; manager budgets include delivery fees. Linked goods contribute seasonal demand once when purchased. Arrival and delivery retry move the existing lot without buying it again.",
          "Open Trade receipts to review a supported reversal with a reason. The DM's correction restores original goods, payments and stock together, checks current funds and custody, and records opposite activity in the current season. Manager component trades reverse together; review their budgets and order timing separately. Older incomplete receipts and transport obligations explain when a compensating transaction is needed. All receipts and seasonal history remain accessible across pages. Historical Before, Proposed and Applied values stay tied to their saved record. Players see their own receipts and a private-treasury label rather than an invented zero balance.",
        ],
        links: [
          ["Trade Exchanges", "/features/economy"],
          ["Price modifiers", "/settings#economy"],
          ["Shops & stock", "/market"],
          ["Catalog", "/catalog?pane=goods"],
        ],
      },
      {
        id: "dm-feature-screens",
        title: "Financial Settings, Shop Management and Review Reports",
        audience: "DM",
        paragraphs: [
          "Financial Settings (Settings & Management → Economy → Currency, price modifiers & shop defaults) holds Price modifiers (season, shortages, war and the value of a gold piece), the Price preview for an average shop, Open shops repricing, Defaults for the next shop and Reset price modifiers. Below them, Recurring financial agreements lists every recurring revenue and expense schedule; add or edit a schedule there, or follow View all financial schedules from a property. Changing defaults affects new shops only; repricing affects open shops only when you choose it.",
          "Shop Management (Settings & Management → Economy → Shop schedules) sets each shop's opening days and scheduled restocking. Opening days repeat from campaign day 0, and a scheduled top-up fills finite stock without reducing a surplus or changing unlimited stock. The schedule only advances when you approve campaign time. Create and stock shops in Market first; Open Market & stock returns there.",
          "Review Reports gathers the campaign financial overview, session financial summaries, bank decision history, character edit reports, full activity search and the price-change history, with a link to the full ledger. It reads records only; it changes no money or inventory. Party's Ledger link, the Desk's report links and an encounter's Open campaign reports open it.",
          "Session Time (see Advance session hours, rest and downtime) and these screens are DM-only. A player who opens one of their links sees that it is available to the campaign DM.",
        ],
        links: [
          ["Financial Settings", "/features/financial"],
          ["Shop Management", "/features/shops"],
          ["Review Reports", "/features/reports"],
          ["Session Time", "/features/time"],
        ],
      },
      {
        id: "loans",
        title: "Loans, interest and recurring finances",
        audience: "DM approval required",
        paragraphs: [
          "Players can request loans. The DM reviews requests and manages campaign loan agreements in Campaign finances & downtime. Choose the borrower, lender if internal, interest rate per period, period length, simple or compound interest, and installment. These are campaign records, not finances attached to saved account profiles.",
          "Only completed in-game periods accrue; unused days and fractional-copper interest carry forward. Repayments pay interest before principal. Internal lenders use existing campaign purses. Payments cannot overdraw a purse; unpaid amounts remain tracked. Recurring income or expenses can be tied to an owned item or property, and a missing or transferred source must be fixed or paused.",
        ],
        links: [
          ["Campaign finances & downtime", "/?view=overview#campaign-finance"],
          ["Loan requests & approvals", "/?view=overview#review-inbox"],
        ],
      },
      {
        id: "downtime",
        title: "Preview downtime and start the next session",
        audience: "DM",
        paragraphs: [
          "Downtime now includes hourly activity allocations for DM and players. The DM configures usable hours per downtime day (default 16) and hours per training day (default 8). The hourly view groups training participants, activity/time and written context, with a captured-period conversion summary and available/pending/allocated hour bar. Time rules & training eligibility keeps the full guidance available. The stored financial preview shows each character's available hours after approved property labor and away activities; approving creates that period's resource budget once. Ship travel consumes no personal hours. Existing session-hour advances, smith work, finances and voyages keep their established clock behavior.",
          "Players request training for their assigned character and an NPC at the same location or aboard the same ship. Martial, Academic and Skill / Profession share one hour pool, with a subject and free-text description. Both participants allocate the requested time. Character levels and specified class levels must be equal or lower for the recipient; known higher levels are rejected. Review requests in Downtime or Review Inbox. Missing sheets and unrecognized class levels require a written DM level confirmation. Approve records time only; deny releases the reservation.",
          "Training progress shows complete NPC/category totals across trainers, plus current and lifetime hours/training days by trainer, NPC, category and subject. Subject spacing/case variants group together without rewriting descriptions. Category resets capture every reviewed outstanding contribution; existing per-trainer resets remain available. DM milestone & reset records your manual reward/change note and zeros the current counter without changing sheets or refunding hours. Apply character rewards yourself. Old periods and entries keep their settings; each period has a separate budget. For late bookkeeping, use the historical-context field or mark an earlier pending request as historical in DM review. Confirm that participants were together with equal-or-lower levels then and record completed time in the review note. Current ownership/visibility, stale checks and the original hour budget still apply. Historical requests, decisions and resets survive backups and older journal writes. Character away actions offer elapsed campaign hours or 24-hour calendar days; property work uses the usable allowance and training days have their own conversion.",
          "In Campaign finances & downtime, enter the number of in-game days and choose Preview downtime. Review revenue, interest, installments, expenses, unpaid amounts and before/after purse balances. No money moves just because real-world time passes or a preview is created.",
          "At the start of the next session, use Play sessions to review and select the pending downtime approval, then choose Approve downtime & start session. Changed funds or agreements require a fresh preview. Income settles first, then loan installments in creation order, then expenses. Approval advances in-game time and records the financial changes once. Cancel the preview to edit agreements before replanning.",
          "Named sessions summarize recorded coin movement. Internal transfers are excluded from received/spent totals. Session movement is not the same metric as the website’s gold-spent counter.",
        ],
        links: [
          ["Preview downtime", "/?view=overview#campaign-finance"],
          ["Play sessions", "/?view=overview#sessions"],
        ],
      },
      {
        id: "ships",
        title: "Own ships, shipyards and downtime voyages",
        audience: "DM / Players",
        paragraphs: [
          "Property Management contains ship controls. Choose New property listing → Property operations template → Create from preset · Owned ship or Private shipyard. Review the template and save it; your listing draft is retained and the saved template is selected. Review and save the listing separately. Opening a preset or saving its template creates no purchase or owned ship. Saved templates and the full DM estate workshop remain available for custom setup. Purchase through the existing register/deed flow, or configure an existing located property as a ship. Searchable menus scroll within their own bounded panel; Escape returns focus to the selection control. Example stats and costs are editable campaign choices. A ship remains an independently valued holding; a berth is storage, not ownership.",
          "Review the ship stat block: STR, DEX and CON only, speed/pace, crew, character and cargo capacity, actions/defenses, and separate hull, helm, movement and weapon AC/HP/thresholds. Record damage through the DM control. Below-threshold damage causes no loss; qualifying damage applies in full. Upgrade and material definitions use the advanced JSON fields; no intelligence, wisdom or charisma is assigned to the vessel.",
          "Players with ship access can name it, load real inventory through Storage, propose repairs/upgrades and voyages, and request boarding/disembarking for their assigned characters. The DM approves placement in the property or Review Inbox. Aboard characters retain their identity, sheet and inventory and move with the ship. Boarding grants no character-control permissions. Characters ashore stay in place; a boarded character away from the party market cannot trade there remotely.",
          "Create commercial facilities in Docks & shipyards, or purchase a private shipyard. Facilities enforce slots and ship length and have separate dock, dry and yard rates. Dry/yard storage must launch afloat before travel. Own ships avoid rental charges in their owner's private yard, while maintenance, wages, materials and labor remain due. Staff contracts named captain/sailor/crew/navigator provide paid crew. A linked NPC must actually be aboard. An unattended voyage needs a paid captain with delegated manager authority and a sufficient budget.",
          "Ship work becomes an ordinary draft property project. The payer defaults to the ship owner; select the funded authorized purse you intend to charge. Review allocations, checks, materials and contractors in Construction, upgrades & downtime work or Review Inbox. Personal labor shares existing limits; remote paid labor needs a manager. Completion repairs the specified HP or installs the upgrade once, preserving existing damage. Leaving or teleporting out pauses former-yard work. Sailing crew cannot also perform project labor.",
          "Approve a proposed voyage in its ship screen or Review Inbox, then preview and approve between-session Downtime. Travel rechecks crew, components, pace, access, capacity, funds and spending caps. Partial time retains progress; arrival splits sailing and docked costs and moves aboard characters. Session-hour advances settle maintenance but do not progress voyages. Unpaid expenses remain arrears; pay them in Ship expenses. Trade uses real port exchanges and reviewed manager orders, with no automatic profit.",
          "DM Override · Teleport Ship moves the ship, cargo and everyone aboard instantly to an existing location, optionally a compatible berth. It consumes no downtime or travel expense and bypasses crew and damage restrictions. Active voyages close as DM overridden and former-yard work pauses for review. A pending downtime preview must first be decided or cancelled. For mapped voyages, choose a gridded map with reviewed anchors for both ports. Optional intermediate tiles follow a coastline or river. Grid distance and the ship's miles per day determine the proposed duration; its map marker follows approved downtime progress and stops when blocked. Underway route geometry and duration remain fixed, while their saved grid scale survives later map edits. Manual-duration voyages remain available. These controls reach Android only through a separately signed update.",
        ],
        links: [
          ["Property Management", "/features/properties"],
          ["Review Inbox", "/features/review"],
          ["Downtime", "/features/downtime"],
        ],
      },
      {
        id: "property-operations",
        title: "Store, build and manage properties",
        paragraphs: [
          "Property Management keeps the existing estate register, inventory deeds and shop location hierarchy. The DM estate workshop provides building presets, material definitions, work recipes, city post offices and reviewed JSON imports. Import owner aliases map to existing campaign purses; owned configurations start inactive without goods, staff, money movement or invented deeds.",
          "Use a property's expandable sections for storage, work, staff, rentals, deliveries and letters. The party must be at its location to move goods. Stored, reserved and travelling lots stay out of carried character equipment. Deposits keep their owner unless explicitly donated for shared work; permitted withdrawal assigns the retrieved lot to the selected character.",
          "Players propose work and hires for DM review. Approved projects reserve materials, share character downtime or pay contractors and attach completed buildings to the original parcel. Managers need delegated duties, paid contracts and spending limits. Rental income, upkeep and wages use existing finance schedules; vacancy, missing staff and arrears can block new operation benefits.",
          "Send a property letter while at an open city post office. Postage is paid once; campaign-day delivery rechecks the manager, ownership, reviewed instruction and budget. Letters do not allow remote item withdrawal. Review property effects in the existing downtime preview and explicitly approve at the next session. Active obligations must be resolved before ordinary sale/Give, or the DM records a handover retaining contents and history.",
          "A property bought from an imported listing in an older offline save may have its deed but no operating record. Property Management lists it for the DM and shows Set up operations under that property; players never see it. Confirm the suggested template (or choose one) to create the record a purchase creates now, including a ship's or shipyard's fleet record. No coins are charged, the deed is unchanged and a second attempt changes nothing. For unsold imported listings, choose the Property operations template again in the listing editor.",
        ],
        links: [
          ["Property Management", "/features/properties"],
          ["Property proposals", "/features/review"],
          ["Approved downtime", "/features/downtime"],
        ],
      },
      {
        id: "analytics",
        title: "What the website gold counter includes",
        paragraphs: [
          "The homepage counter adds purchases and outgoing payments in currently stored shared campaigns, including approved external repayments and downtime expenses. It excludes internal transfers, balance adjustments, loan proceeds and valid voided entries. Sales are tracked separately rather than subtracted from spending.",
          "Local-only campaigns and private account backups are not uploaded for the counter. The total can decrease after a void, restore or room deletion; it is not a permanent lifetime total. Updates can take about a minute and appear when the page loads. Only aggregate spending is public. Additional game metrics are prepared for future publication but remain owner-only; private player names, chats and ledger details are not published.",
        ],
        links: [["Website gold counter", "/welcome"]],
      },
    ],
  },
  {
    id: "sharing",
    title: "Rooms, messages & permissions",
    topics: [
      {
        id: "modes",
        title: "Local, Live and Turn-based play",
        paragraphs: [
          "Local DM play can continue without Internet using a campaign already saved and claimed on the owner’s device. Initial sign-in, loading an account campaign on another device and cloud backup need a connection. Android bundles the app’s interface; the website currently needs a connection for a reliable fresh launch or reload because it has no offline app-shell cache. Local data storage is available in supported browsers as well as Android. Player offline copies are retired; DMs can still import legacy activity reports for recovery. Back up local changes before switching to an account campaign.",
          "Live: permitted actions synchronize when the server accepts them; participants do not wait for a transaction turn. Failed or offline actions stay pending for review or retry.",
          "In Live or Turn-based play, Share join link and the player-specific Copy link open the current room. If another room is already connected, choose whether to stay or switch; the invitation is not yet accepted. Invitations expire when the DM ends the session and stay invalid after reopening. Send a fresh session invitation to replace an older link. Closing a tab does not end the session.",
          "Turn-based currently uses an online shared room and separate devices; submitting and passing a turn needs a connection. It does not yet provide an offline pass-one-phone turn queue. Only the current participant makes transactions. Actions remain a draft until Submit changes and end turn commits them and passes control. Connected drafts are also saved on the server; guest unsent actions remain only in memory and can be lost on reload. Chat is sent independently of transaction turns. Only the DM changes sharing modes.",
        ],
        links: [
          ["Rooms & sharing", "/share"],
          ["Chat", "/share?chat=1"],
        ],
      },
      {
        id: "permissions",
        title: "DM controls, role changes and account privacy",
        paragraphs: [
          "The site owner can view Field monitor under My account on the website, beside their signed-in identity and Owner access label. It shows service checks, aggregate app/game statistics and recent development/deployment activity. Refresh overview updates the readings; auto-refresh runs every minute while visible. Provider readings can be five minutes old, and unavailable or disconnected sources are labeled. Campaign DM status alone does not grant this access. Existing detailed server monitoring and owner controls remain below it; Android 1.8.0 adds a separate green home-screen Field monitor. In the Android app, open My account → Home-screen Field monitor, Connect owner account, then Add to home screen and confirm Android’s prompt. If your launcher does not support the prompt, long-press the home screen and choose Widgets → Lootsplitter Field monitor. Resize vertically for full or compact details. Readings are dated; background checks are requested about every 30 minutes and may be delayed by Android. In Android 1.8.1, tap Refresh to check directly from the home screen without reopening My account. The last dated reading stays visible during refresh or a temporary failure, with retry feedback; readings over one hour old are hidden. A healthy reading older than 35 minutes is shown amber until the next check; the web dashboard marks readings stale after two minutes. Widget synchronization counts only phones that reported in the last 7 days; older ones are listed as inactive (not a problem) and count again when they next report. Your name, snapshot number and private totals are visible on the home screen; your email stays in My account. The main widget shows a status symbol (✓ healthy, ! needs attention, ✕ failure) with one short reason. ATTENTION means a recent problem that has stopped (for example one Worker error earlier in the day, shown with its time) rather than a current failure; Multiplayer is checked with each half-hour collection by a short synthetic room round trip (open, join, message, read back, then delete) that never appears in campaigns, lists or totals; a failed round trip shows as a failure until the next one passes. The widget shows active/accounts/campaigns/24-hour request tiles (— means unavailable, never zero), the development task with its timer and any warning, then a scrolling log that lists items needing attention first; tap LOGS or ↻ REFRESH for details. From Android 1.9.3, tap a log row to expand it in place and read its full title and text (▾ collapsed, ▴ expanded); tap it again to collapse it, or use its OPEN button for the matching screen in the app. Expanded rows stay open when the widget refreshes. From Android 1.9.3, a temporary storage error on the phone keeps the widget connected: it shows “Widget storage busy · tap Refresh to retry” and background checks retry; only unreadable widget storage asks you to reconnect in My account. Cloudflare plan usage, read hourly for the whole Cloudflare account in UTC, compares Worker requests, Worker CPU time and D1 rows read and written with the Workers Paid included allowance: today against a daily share (the monthly allowance divided by the days in the current billing cycle), the last 7 days against a weekly share and the billing cycle so far (for example “Cycle since Oct 11”) against the full allowance, for example “Worker requests today 12,345” with “3.8% of daily share”; D1 storage is shown against the 5 GB included. It appears in the main widget’s scrolling rows, on the website Field monitor and in daily reports. A metric Cloudflare did not return says unavailable and is never shown as zero, and billing-cycle use at 80% or more is marked amber. Cloudflare resets included usage on your billing renewal day, the 11th of each month (UTC), so each cycle runs from the 11th through the 10th; the share of the billing cycle elapsed is shown as the pace to compare against. Disconnect, sign-out or switching accounts clears the device widget; server-revoked access clears on its next server check. Removing the final widget disconnects it. Android 1.9.0 also shows the shared Field monitor inside My account. Scroll the main widget for monitoring logs, diagnostics and daily reports; use the full dashboard on the website for history search and filters. Export loaded entries saves the entries currently loaded; choose Load older entries until none remain before exporting to include earlier history. Backend half-hour logging continues while the phone is asleep or offline. Add a separate 4×1 companion and choose a preset, two summaries in order (including Agent activity), two toolbar actions and a theme for each instance. Companion actions are icon buttons with spoken labels (Refresh, Logs, Report, Task, Diagnostics, Website, Account, Settings). Main-widget appearance is configurable too. Native timers show elapsed wall time, not proof of recent work; dated readings and telemetry warnings remain visible. Site owners can register external logs for automatic daily-report coverage and publish explicit development progress. When observations for an earlier day arrive late, its daily report is refreshed automatically; if that refresh fails six times in a row, automatic retries stop, the report is marked Out of date with the last error (listed first under Coverage gaps), and Daily reporting stays red until a refresh succeeds. Fix the cause, then choose Retry refresh on that report in Field monitor → Daily reports; the report and every source entry are kept. To stop tracking an external log without losing it, open My account → Field monitor → Log registry & settings, expand the log and choose Retire, then confirm (a reason is optional). Nothing is deleted: its entries stay in Monitoring logs and exports, the change is recorded in that log’s history, and daily reports stop listing it as missing data and show it under Retired logs with when and by whom. Reinstate resumes daily coverage from that moment; the retired time is shown as retired, not as a gap. Built-in logs cannot be retired, and retired logs still count toward the 50 custom-log limit. Android 1.9.1 reannounces both widget types after an update. In Widgets → Lootsplitter, choose Lootsplitter 4×1 companion and Add; new companions start with the Agent activity preset (companions placed earlier keep their Development default), and Settings can switch any instance to Development, Server Health, Analytics or Quick Actions after placement. Agent activity shows GitHub activity only — workflow runs and pull requests, not the development chat or local work: the latest event with its symbol (✓ succeeded or merged, ! running or needs attention, ✕ failed) and age while a workflow runs, for example “Merged #138 · Widget redesign · 2m” (otherwise its clock time), then the running workflow or the previous event. Tap it to open My account → Field monitor → Development & deployments, which lists recent GitHub activity. While a workflow is running and the screen is on, it checks about once a minute without waking the phone; otherwise the usual 30-minute background check applies. If GitHub cannot be read it says so (for example “GitHub activity unavailable · rate limited”) rather than showing no activity. Adding does not require a connected owner session; private readings still do. My account also offers Add 4×1 companion and Refresh widget list if the launcher list needs updating. Refreshing that list preserves placed widgets, settings and saved campaigns. Some third-party launchers (for example Lawnchair) can keep an old widget list after an update; if Lootsplitter 4×1 companion is missing from the launcher’s Widgets menu, add it from My account → Home-screen Field monitor → Add 4×1 companion.",
          "The campaign DM manages shop prices, catalog, books, character assignment, shared-fund access, turns and approvals. A site staff role does not grant permission to someone else’s campaign. Shared play checks permissions on the server.",
          "Change device role is in the gear’s Settings & Management panel. Set a campaign password in Settings before switching to Player if you want returning to DM to require that password. Shared connections block local role switching; disconnect or return to Local Mode first.",
          "DMs require accounts. Signed-in players receive saved memberships automatically; guests need a current invitation. Accounts also provide private cloud backup versions, profile/privacy controls, recovery keys and reusable characters. Saving a membership is not the same as uploading a campaign backup. Keep your recovery key securely; recovery keys rotate when used. Repeated wrong passwords for one email add a short wait before the next sign-in (up to 15 minutes); the right password works again once the wait ends. Email delivery and email alerts are not configured.",
        ],
        links: [
          ["Settings & Management", "/?view=home#management"],
          ["Room permissions", "/share"],
          ["Account & privacy", "/account"],
          ["Campaign password", "/settings"],
        ],
      },
      {
        id: "notifications",
        title: "Chat and notifications",
        paragraphs: [
          "Campaign → Chat supports party and permitted private conversations. Shared-mode chat is independent of transaction turns. Players chat only within an open shared session. Messages and activity reports are not sent to people automatically.",
          "Campaign → Alerts has message, turn and room notices. Allow browser permission when requested. Supported browsers can enable separate background new-message web push for shared rooms; message text stays out of those notifications. Delivery depends on browser/device support and permissions. This is not email delivery or native Android push.",
        ],
        links: [
          ["Chat", "/share?chat=1"],
          ["Alerts & notifications", "/share?tab=notifications"],
        ],
      },
    ],
  },
  {
    id: "safety",
    title: "Backups, recovery & troubleshooting",
    topics: [
      {
        id: "backups",
        title: "Save, export and restore safely",
        paragraphs: [
          "Device backups keeps named snapshots in this browser. Save makes a snapshot; Export downloads it; Import adds a backup file to the list; Load replaces the current campaign with that snapshot. Keep an exported copy outside the browser before clearing data, uninstalling or changing devices. Protect saves encrypts backup files with the campaign password; protected backups require that password.",
          "Shared-mode backups refresh from the server and require pending actions to be resolved first. Players can back up only data visible to them; the DM keeps the complete campaign copy. Pending-action recovery is separate. Disconnect or return to Local Mode before loading a backup: loading does not overwrite or reconnect a shared room.",
          "Private cloud backups are explicit account uploads. Restoring one creates a new local campaign. Local encounters are included in full device backups; private PDF/reference content stays device-local and is not included in account cloud backups. Browser and Android saves are separate unless you join the same shared room or transfer a compatible backup.",
        ],
        links: [
          ["Device backups", "/settings#backups"],
          ["Private cloud backups", "/account"],
        ],
      },
      {
        id: "recovery",
        title: "Pending changes, stuck seats and connection problems",
        paragraphs: [
          "The shared status strip offers Retry and Pending changes when work needs attention. Pending changes opens Campaign → Connection & recovery with its action list. Turn saved to room is an exactly confirmed server draft; its changes remain uncommitted until Submit changes and end turn. Offline and unconfirmed copies stay distinct. Check Campaign → Connection & recovery before retrying, leaving or discarding anything. Export pending actions if you need a recovery copy. Recovery files belong to the same campaign code. Shared sessions are remembered on this device.",
          "If a character is occupied on another device, the DM can release its seat after pending actions are resolved. The DM can also grant party-fund access and choose the next participant. Mode changes and room closure require submitted drafts to be resolved. Offline changes remain saved on the device where they were made.",
          "Each seat has a generous limit on how quickly it can send changes and messages. If someone floods the room, the server answers that they are sending changes too quickly; their pending actions are kept, and after a short wait they can send again. Ended sessions' archived reports are stored beside the room, so archiving does not make the campaign larger. If a room ever reaches its online size limit, the change is refused with that explanation and nothing is changed or lost: end the session to archive the current messages and ledger, or export the campaign.",
        ],
        links: [
          ["Connection & recovery", "/share#connection-recovery"],
          ["Device backups & diagnostics", "/settings#backups"],
        ],
      },
      {
        id: "appearance",
        title: "Appearance, reading size and motion",
        paragraphs: [
          "Open the gear for your role’s Appearance controls. Choose Light · Adventurer’s Ledger for aged parchment and dark ink, or Dark · Ironbound Dragon for dark iron and antique brass. Your theme is saved on this device and stays selected after reload. You can also change PDF reading size and toggle dollar estimates. DM Settings also contains ready-made looks and custom accent/page colors. These are display preferences, not campaign economy changes.",
          "The opening animation follows the device’s reduced-motion preference. After dismissal, internal navigation keeps the app open. A fresh app load or refresh shows the title screen again; a restored tab’s old dismissal cannot hide it. Display options do not change your character, coins or rules.",
          "Music & ambience manages bundled menu/ambient sound and device-local licensed audio/playlist files. A user gesture can be required to start playback. Imported tracks remain on their device rather than being streamed or shared to other players; keep your source permissions and the existing source/license credits. Fantasy backgrounds, sound effects and playback volume are display/audio settings rather than campaign rules.",
        ],
        links: [
          ["Open appearance controls", "/?view=home#management"],
          ["DM custom colors", "/settings#appearance"],
          ["Music & ambience", "/features/music"],
        ],
      },
      {
        id: "bugs",
        title: "Report a bug or get diagnostics",
        paragraphs: [
          "Sign in to My account → Report a bug. Describe the action, what you expected, what happened and whether you were using Local, Live or Turn-based play. You can preview and optionally attach app/device diagnostics. Campaign content and files are not automatically attached.",
          "Reports and responses are private to you, the owner and administrators. Settings also lets you download a diagnostic report to share manually. Keep a backup before attempting recovery that replaces local data.",
        ],
        links: [
          ["Report a bug", "/account#bug-reports"],
          ["Diagnostics", "/settings#backups"],
        ],
      },
      {
        id: "contact-support",
        title: "Contact support",
        paragraphs: [
          `Need help? Email ${SUPPORT_EMAIL}. It is the public support address for questions, feedback and problems you cannot report from My account, such as being unable to sign in.`,
          "Say what you were doing, what you expected and whether you were using Local, Live or Turn-based play. Never send passwords, recovery keys or campaign invitation links; attach a diagnostic report only after previewing it. Bug reports in My account keep their replies in one place.",
        ],
        links: [["Report a bug", "/account#bug-reports"]],
        email: SUPPORT_EMAIL,
      },
    ],
  },
  {
    id: "install",
    title: "Install & update",
    topics: [
      {
        id: "new-name",
        title: "Lootsplit is now Lootsplitter",
        paragraphs: [
          "Lootsplit has a new name: Lootsplitter. It is the same app with the same campaigns, characters, funds, settings and accounts; nothing needs to be moved or re-entered. On Android, version 1.10.0 and later shows the new name on the home screen and in the Widgets menu (Lootsplitter Field monitor and Lootsplitter 4×1 companion). Install the update over the existing app as usual; placed widgets and your sign-in carry over.",
          "Backups, campaign copies and other files exported under the old name still import, and existing invitations keep working.",
          "The website has moved to lootsplitter.com. The old address (lootsplit.oliverstorie2017.workers.dev) keeps working for at least 12 months, and the Android app and widgets need no change. Accounts and shared campaigns live on the same server, so sign in again at lootsplitter.com and they are all there. Browsers keep each address separate, so a few things stay with the old address until you move them: campaigns stored only in that browser (move them with a backup), notifications (turn them on again), bookmarks and an installed home-screen web app (replace them).",
          "Settings → Moving to the new website address reads this device only: it lists unsubmitted shared-room changes in every campaign saved here, not just the open one, and names what stays on this device, such as private PDFs, the local audio library, preferences, map camera positions and bookmarks. It never submits, discards or clears anything. Finish or export pending work there before you switch.",
        ],
        links: [
          ["Moving to the new address", "/settings#migration-readiness"],
          ["Downloads & release details", "/downloads"],
          ["Versioned changelog", "/updates"],
        ],
      },
      {
        id: "android",
        title: "Android installation and updates",
        paragraphs: [
          "Export and verify a backup first. Use Downloads → Download for Android and open the APK in your phone’s file manager or Downloads. If prompted, allow that browser or file manager to install apps, then return to the installer. Install over the permanently signed Lootsplitter app to preserve its data.",
          "An old debug-signed app cannot update in place to the permanent signing key. Export and verify a backup before uninstalling that older build, then install and restore. Do not uninstall a working app just to troubleshoot a download. GitHub and the earlier Google Drive download remain available on Downloads.",
          "The website receives updates independently of the published APK. Website-only improvements become bundled Android features with a future signed APK release; see the published version and changelog on Downloads. The Changelog's Website and backend filter lists each website and backend release on the day it goes live, with what changed. Downloads → Technical details → Release details and verification lists the APK checksum, your client, the hosted web release and the published Android version; every website page links there from its footer.",
          "If Android restores Lootsplitter from a device backup onto a new phone or a reinstall, your saved campaigns and settings return but you sign in to your account again: the account session and the home-screen widget connection are never restored from a backup. Export a backup as well; Android’s own backup is not guaranteed.",
        ],
        links: [
          ["Downloads & release details", "/downloads"],
          ["Versioned changelog", "/updates"],
        ],
      },
      {
        id: "desktop",
        title: "Use Lootsplitter on desktop or mobile web",
        paragraphs: [
          "Open the browser app on your computer or phone. On a first visit, the plain website address shows the Lootsplitter home page; choose Open the app. After that, this browser opens the app directly. Bookmark it, or use your browser’s Install app/Create shortcut option if available. A native Windows or macOS installer is not available. A shortcut does not synchronize saves or make a backup.",
          "Use the same browser profile and website address for device-local campaigns. Clearing browser storage can remove them. Use shared rooms or an exported backup to move between devices; optional accounts do not automatically upload all local data.",
        ],
        links: [
          ["Open the app", "/?view=home"],
          ["Downloads", "/downloads"],
        ],
      },
    ],
  },
];
export function topicMatches(topic: HelpTopic, query: string) {
  return [topic.title, topic.audience, ...topic.paragraphs, ...topic.links.flat(), topic.email]
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
