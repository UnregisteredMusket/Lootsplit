import type { ProductShot } from "./product-shots";

/**
 * The public Features page catalog (owner request 2026-10-23: major and minor features, accurate
 * and detailed). Compiled from the code on main and checked against the in-app Help; keep it in
 * step when a feature ships or changes. `dm` marks tools only the Dungeon Master uses.
 */
export type MajorFeature = { title: string; summary: string; details: string[]; dm?: boolean };
export type MinorFeature = { title: string; text: string; dm?: boolean };
export type FeatureArea = {
  id: string;
  chip: string;
  title: string;
  lead: string;
  shots: ProductShot[];
  major: MajorFeature[];
  minor: MinorFeature[];
};

export const FEATURE_AREAS: FeatureArea[] = [
  {
    id: "money",
    chip: "Loot & money",
    title: "Loot & money",
    lead: "Every coin and item the party owns, in one shared ledger.",
    shots: ["ledger", "loot"],
    major: [
      {
        title: "Coins and purses",
        summary:
          "Five coin denominations held in character, NPC and party fund purses, with conversion, payments and transfers.",
        details: [
          "Copper, silver, electrum, gold and platinum, calculated in whole copper",
          "Several party funds per campaign, plus player and NPC purses",
          "Give coins or items between purses; retries never pay twice",
          "Optional real-money estimates, shown for comparison only",
        ],
      },
      {
        title: "Even coin split",
        summary:
          "Divide an amount from a party fund or purse evenly among chosen party characters in one transaction.",
        details: [
          "Shares rounded down to whole copper and paid in gold, silver and copper",
          "Leftover goes to the party fund, stays in the source, one character, or rotates",
          "Preview shows every share and checks nothing is created or lost",
          "Save the leftover rule as the campaign default",
        ],
      },
      {
        title: "Treasure pool claims",
        summary:
          "Put party fund items in a pool; characters mark Need, Greed or Pass and the DM resolves claims.",
        details: [
          "Resolve one item at a time, at random by d100, or round-robin",
          "Pooled items stay in the fund but cannot be given, sold or equipped",
          "Preview shows every outcome; all selected items move once, with one receipt",
          "Each item keeps a claim and resolution history",
        ],
      },
      {
        title: "Activity ledger",
        summary:
          "Every purchase, sale, transfer, payment and adjustment is recorded, searchable and reversible where supported.",
        details: [
          "Void a supported entry to record a reversal instead of deleting it",
          "Splits and pool resolutions appear as one expandable row",
          "Property deeds keep their original purchase receipt",
          "Players see their own history and their party's lines",
        ],
      },
      {
        title: "Bank and loans",
        summary:
          "Loans with interest and installments, plus player requests to spend coins that the DM approves.",
        details: [
          "Simple or compound interest per in-game period",
          "Repayments cover interest before principal; arrears stay visible",
          "Players request loans or spending; the DM approves in Review Inbox",
          "Internal lenders use existing campaign purses",
        ],
      },
    ],
    minor: [
      {
        title: "Add loot",
        text: "Add custom items or property, or search SRD equipment and magic items.",
        dm: true,
      },
      {
        title: "My Finances",
        text: "Players see their own loans, recurring charges and payment history.",
      },
      {
        title: "Party companion funds",
        text: "Optionally let players see coins of NPCs travelling with the party, read-only.",
        dm: true,
      },
      {
        title: "Exactly-once retries",
        text: "Pressing Buy, Give or Split again after an error never applies it twice.",
      },
      {
        title: "Item details",
        text: "Quantities, values, weight, equipped state, notes, categories and search for every holding.",
      },
      {
        title: "Property deeds",
        text: "A filled deed image is attached to each purchased property and follows it.",
      },
    ],
  },
  {
    id: "characters",
    chip: "Characters",
    title: "Characters & party",
    lead: "Full character sheets that share one wallet and inventory with the campaign.",
    shots: ["character", "party"],
    major: [
      {
        title: "Character sheets",
        summary:
          "Editable sheets with abilities, skills, attacks, spells and slots, resources, features and equipment.",
        details: [
          "Play view for vitals, attacks, spells and dice; Edit view for changes",
          "HP, temporary HP, AC, initiative, speed, death saves and inspiration",
          "The sheet, purse and inventory share one character record",
          "Export a sheet or draft; saves are revision-checked across devices",
        ],
      },
      {
        title: "Sheet import",
        summary:
          "Import characters from JSON, filled PDF forms or scanned pages read on your own device.",
        details: [
          "Text recognition for scans and photos runs locally",
          "Review every tab before saving; partial imports keep other fields",
          "Player imports into a campaign wait for DM review",
          "Campaign coins and items are never duplicated by a reimport",
        ],
      },
      {
        title: "Dice and rolls",
        summary:
          "Roll from the sheet with advantage and custom formulas, or record physical dice totals.",
        details: [
          "Ability checks, saves, skills, attacks, damage and spells",
          "Shared rooms use server-generated dice; results go to roll history",
          "Pen & Paper mode records physical totals when the DM allows it",
          "Rolls never apply damage or conditions automatically",
        ],
      },
      {
        title: "Player Home",
        summary:
          "Players get one-tap buttons for their sheet, bank, finances, properties, journal and party chat.",
        details: [
          "Opens the assigned character's full sheet",
          "Inventory puts searchable item cards first",
          "Downtime and training requests are reachable from Home",
        ],
      },
      {
        title: "Placement and permissions",
        summary: "The DM controls which sheet fields players may edit and where each character is.",
        details: [
          "Per-field edit permissions, including inventory and currency",
          "Character edit reports with before and after values",
          "Move characters between the party, a location or the NPC list",
          "Hide a character or share an NPC sheet read-only",
        ],
        dm: true,
      },
    ],
    minor: [
      {
        title: "Portraits",
        text: "Upload or reset portraits for characters and NPCs.",
      },
      {
        title: "Reusable profiles",
        text: "Save names, portraits and notes to your account and add them to campaigns.",
      },
      {
        title: "Charisma pricing",
        text: "Charisma above 10 lowers shop prices by 1% per point, up to 20%.",
      },
      {
        title: "Retry sheet load",
        text: "A failed sheet load can be retried without losing your seat or pending actions.",
      },
      {
        title: "Player and NPC types",
        text: "Mark each character as a player or NPC; only players can be assigned.",
        dm: true,
      },
      {
        title: "Draft protection",
        text: "Unsaved sheet edits ask before you leave, reload or switch.",
      },
    ],
  },
  {
    id: "markets",
    chip: "Shops & trade",
    title: "Shops, trade & barter",
    lead: "Merchants, commodity markets and deals between players and NPCs, all posted to the ledger.",
    shots: ["market", "trade", "barter"],
    major: [
      {
        title: "Shops",
        summary:
          "Generate or build shops with keepers, stock, prices and buy/sell rates, then buy and sell.",
        details: [
          "Generate stock by category, wealth and variety; finite or unlimited quantities",
          "Add exact catalog items, custom items and services",
          "Open and closed states, restocks, search and rarity filters",
          "Share a shop's stock list as a PDF",
        ],
      },
      {
        title: "Trade Exchanges",
        summary:
          "Regional commodity markets with bid and ask quotes, finite stock, treasuries and seasonal prices.",
        details: [
          "Sixty editable fantasy commodities, plus reviewed JSON, CSV or TSV imports",
          "Classic DM prices, or Automatic seasonal proposals the DM approves",
          "Commodity board with search, stock bars and recorded price charts",
          "Every city gets an empty, editable exchange",
        ],
      },
      {
        title: "Trading & Barter",
        summary:
          "Players and NPCs exchange coins, carried goods and property deeds through offers and counteroffers.",
        details: [
          "The recipient accepts or declines; either side can cancel",
          "Funds, ownership and location are rechecked on acceptance",
          "Both sides change in one step; history is kept",
          "Inventories stay private until offered",
        ],
      },
      {
        title: "NPC barter conversations",
        summary:
          "NPCs without a player controller answer offers in a conversation, with a Persuasion roll set by fairness.",
        details: [
          "Players see the DC and plain-language odds before sending",
          "DM decides, server rolls with DM confirmation, or automatic",
          "Per-NPC stance, wanted goods and ten dialogue lines",
          "Caps, cooldowns and a DM queue limit exploits",
        ],
      },
      {
        title: "Temple, workshop and inn",
        summary:
          "NPCs run paid services at their shop: temple spellcasting, scribe, alchemist and tailor commissions, and inn stays.",
        details: [
          "Prices default to the SRD 5.2.1 lists; the DM can edit or start blank",
          "Raise Dead and Resurrection wait for DM review and are charged on approval",
          "Workshop orders are made during approved downtime",
          "Inns book nights and meals, and share rumours privately",
          "Sages identify an item you carry; the DM writes the answer",
          "Tailors make clothes; fences, banks and hiring agents open the Sell tab, a loan request or a staff contract",
        ],
      },
      {
        title: "Blacksmith commissions",
        summary:
          "Players order custom weapons and armor from a permitted smith NPC, built during approved downtime.",
        details: [
          "DM sets skill level, materials, styles, engraving and approved enchantments",
          "Players review the full design and price before paying",
          "Materials come from smith stock or the buyer's carried items",
          "Finished items wait at the forge for one-time collection",
        ],
      },
    ],
    minor: [
      {
        title: "Black-market vendors",
        text: "Hidden vendors with a price premium, revealed or hidden during play.",
        dm: true,
      },
      {
        title: "Shop schedules",
        text: "Opening days and scheduled restocks on the in-game calendar.",
        dm: true,
      },
      {
        title: "Price modifiers",
        text: "Season, shortages, war, plague, roads, scarcity and inflation, with preview and repricing.",
        dm: true,
      },
      {
        title: "Market readout",
        text: "DM Desk shows season, inflation and top commodity quotes.",
        dm: true,
      },
      {
        title: "Trade reversals",
        text: "Correct a supported exchange trade with a reason; goods and money restore together.",
        dm: true,
      },
      {
        title: "Sale exceptions",
        text: "Configure which item categories each merchant buys; services cannot be resold.",
        dm: true,
      },
      {
        title: "Location-aware shopping",
        text: "Players see and use shops at the party's current location.",
      },
      {
        title: "Season review",
        text: "Approve a market season with end-of-session downtime.",
        dm: true,
      },
    ],
  },
  {
    id: "world",
    chip: "World",
    title: "NPCs, property & ships",
    lead: "Build the campaign world and connect it to the economy.",
    shots: ["properties", "ships"],
    major: [
      {
        title: "Locations",
        summary:
          "Regions, cities, towns and areas with descriptions and images, each with assigned shops.",
        details: [
          "Set the party location; players see shops there and in parent places",
          "Import a name list from TXT, CSV, TSV or JSON",
          "Move the party freely onto roads, wilderness, rivers or seas",
        ],
        dm: true,
      },
      {
        title: "People & NPCs",
        summary:
          "NPCs with portraits, locations, inventories, funds and private dialogue with the characters who meet them.",
        details: [
          "Players meet visible NPCs at their location",
          "A player character can be set to speak and trade for an NPC",
          "Import NPCs from reviewed JSON",
          "Train with an NPC during downtime",
        ],
      },
      {
        title: "Property",
        summary:
          "Browse and buy listed property, then store goods, run projects, hire staff and collect rent.",
        details: [
          "Filter, sort and compare up to three listings",
          "Storage with access rules; deposits keep their owner",
          "Building projects, staff contracts, tenants and upkeep",
          "Send letters with instructions from a city post office",
        ],
      },
      {
        title: "Ships and shipyards",
        summary:
          "Own ships with vehicle stats, crew, cargo and passengers, berthed at docks or private shipyards.",
        details: [
          "Separate hull, helm, movement and weapon AC, HP and thresholds",
          "Repairs and upgrades run as property projects",
          "Voyages advance only with approved downtime, optionally along a map route",
          "DM can teleport a ship with its cargo and passengers",
        ],
      },
    ],
    minor: [
      {
        title: "Estate workshop",
        text: "Building presets, materials, work recipes and post offices, with JSON import.",
        dm: true,
      },
      {
        title: "Managers and budgets",
        text: "Delegate a paid manager to trade and order supplies within limits.",
      },
      {
        title: "Boarding",
        text: "Characters board ships and travel aboard with their sheets and inventory.",
      },
      {
        title: "Hidden NPCs",
        text: "Keep NPCs out of player view until you reveal them.",
        dm: true,
      },
      {
        title: "Ship and shipyard presets",
        text: "Create owned ship or private shipyard listings from presets.",
        dm: true,
      },
      {
        title: "Set up operations",
        text: "Repair older offline property purchases that lack an operating record.",
        dm: true,
      },
    ],
  },
  {
    id: "maps",
    chip: "Maps",
    title: "Maps & online tabletop",
    lead: "Linked maps for the world and the battle, shared with players in real time.",
    shots: ["maps"],
    major: [
      {
        title: "Connected maps",
        summary:
          "Import regional, city, dungeon, battle and other maps and link them with entrances and breadcrumbs.",
        details: [
          "PNG, JPEG, WebP, animated images and MP4 or WebM video",
          "Universal VTT imports bring grid, walls, doors and lights",
          "New maps stay private until you share them",
          "Search maps and places from the map",
        ],
      },
      {
        title: "Place cards",
        summary:
          "Tap a pinned shop, NPC, property or exchange to open its card and use it from the map.",
        details: [
          "Buy, barter, commission, store goods or post letters from the card",
          "NPC pins open the conversation hub",
          "Show on map links from shop, NPC and property records",
          "Copy a link to a place; hidden pins stay hidden",
        ],
      },
      {
        title: "Here sheet",
        summary:
          "Lists everything you can use at the party's current location, with filters and links to pins.",
        details: [
          "Shops and trade, people, services and property",
          "Browsing another map shows its shared pins read-only",
          "The DM also sees hidden entries, marked DM only",
        ],
      },
      {
        title: "Tokens and grid",
        summary:
          "Calibrate a grid and move character, ship and creature tokens with measured distances.",
        details: [
          "Diagonal rules include alternating 5/10/5",
          "Measure with waypoints; circle, cone, line and rectangle templates",
          "Players may move only their own tokens, if the DM allows",
          "Ship tokens carry the characters aboard",
        ],
      },
      {
        title: "Journey planner",
        summary:
          "Draw a route across a map to see each leg's distance, travel days at your pace and terrain.",
        details: [
          "Waypoints snap to places and to tile centres on gridded maps",
          "Leg list with miles, days at the chosen pace and terrain",
          "Type a route instead of drawing it, or use the keyboard",
          "Draw a ship voyage route and send it to the voyage request",
        ],
      },
      {
        title: "Fog, walls and vision",
        summary:
          "Reveal or conceal areas, add walls, doors and lights, and show players only what they can see.",
        details: [
          "Brush, rectangle and polygon fog with 20-step undo",
          "Consolidate fog to remove hidden shapes without changing the view",
          "Optional party or per-character vision with darkvision",
          "Players receive only visible pixels, never the original art",
        ],
        dm: true,
      },
    ],
    minor: [
      {
        title: "Place on map",
        text: "Pin a record with a crosshair, choose visibility and an optional portrait pin.",
        dm: true,
      },
      {
        title: "Map scale bar",
        text: "Calibrate a scale on maps without a grid so measuring and routes use real distances.",
        dm: true,
      },
      {
        title: "Five-color pings",
        text: "Everyone can ping the map in five colors and shapes.",
      },
      {
        title: "Shared and DM markers",
        text: "Place shared or DM-only markers live.",
        dm: true,
      },
      {
        title: "Personal drawings",
        text: "Freehand lines and text on your own device, with undo and redo.",
      },
      {
        title: "Scene activation",
        text: "Prepare scenes privately, activate one for players, share your camera once.",
        dm: true,
      },
      {
        title: "Player-view preview",
        text: "Check what the party or one character sees before they do.",
        dm: true,
      },
      {
        title: "Keyboard and screen readers",
        text: "Keyboard tools and announcements for moves, pings and scene changes.",
      },
      {
        title: "Remembered view",
        text: "Maps reopens at your last map, position and zoom.",
      },
    ],
  },
  {
    id: "encounters",
    chip: "Encounters",
    title: "Encounters",
    lead: "Build, run and reward combat, then send the loot where it belongs.",
    shots: ["encounter"],
    major: [
      {
        title: "Encounter builder",
        summary:
          "Add creatures from the SRD index or generate a group by party level, size and difficulty.",
        details: [
          "Filter creatures by name, type and environment",
          "Difficulty uses 2014 XP thresholds and group multipliers",
          "Import stat blocks from text or a picture",
          "Export and import encounter drafts as JSON",
        ],
        dm: true,
      },
      {
        title: "Initiative tracker",
        summary:
          "Track initiative, rounds, HP, AC and conditions, sorting the order when you are ready.",
        details: [
          "Sort initiative keeps ties and puts blanks last",
          "Damage and healing adjustments on condensed rows",
          "Private roll log with app or physical dice",
        ],
        dm: true,
      },
      {
        title: "Loot awards",
        summary: "Draw from guaranteed items and weighted loot tables, review, then transfer once.",
        details: [
          "Choose a recipient per item, or send items to the treasure pool",
          "Coins go to one purse or split evenly among the party",
          "Inventory, ledger and receipt update together, only once",
        ],
        dm: true,
      },
      {
        title: "Battle on the map",
        summary:
          "Start an encounter on a battle map, import its roster as tokens and return to exploration afterwards.",
        details: [
          "Enemy tokens start hidden until you reveal them",
          "Players see the round and the active revealed token",
          "Returning restores the previous scene and camera",
        ],
        dm: true,
      },
      {
        title: "TV / player display",
        summary: "Show a map, chosen combatants and confirmed loot on a TV or second screen.",
        details: [
          "Off by default; starts blank until you reveal",
          "Rotate, zoom and calibrate tile size for miniatures",
          "DM-only markers, notes and stat blocks are excluded",
        ],
        dm: true,
      },
    ],
    minor: [
      {
        title: "Resource-pack creatures",
        text: "Add creatures from imported resource packs to an encounter.",
        dm: true,
      },
      {
        title: "Offline encounters",
        text: "Device encounters work without an account and are included in device backups.",
        dm: true,
      },
      {
        title: "Account drafts",
        text: "Signed-in DMs keep private encounter drafts outside any campaign.",
        dm: true,
      },
      {
        title: "Reference lookup pause",
        text: "Player lookups pause during active encounters unless you allow them.",
        dm: true,
      },
      {
        title: "Player encounter view",
        text: "Players see the round and the revealed active combatant.",
      },
    ],
  },
  {
    id: "downtime",
    chip: "Downtime",
    title: "Sessions & downtime",
    lead: "Campaign time, money owed and what characters do between sessions.",
    shots: ["downtime"],
    major: [
      {
        title: "Downtime preview",
        summary:
          "Preview 1 to 3,650 in-game days of income, interest, expenses and projects, then approve at next session.",
        details: [
          "Nothing changes until the DM approves the stored preview",
          "Income settles first, then loans, then expenses",
          "Covers property work, voyages, smith orders and market seasons",
        ],
        dm: true,
      },
      {
        title: "Hourly downtime and training",
        summary: "Characters spend approved downtime hours on activities and training with NPCs.",
        details: [
          "Martial, Academic and Skill / Profession training with a subject",
          "Recipients must be equal or lower level than the trainer",
          "Current and lifetime hours per trainer, NPC and category",
          "DM milestones reset counters without changing sheets",
        ],
      },
      {
        title: "Party journeys",
        summary:
          "Plan a trip on the map and travel it with downtime: the DM approves departure, progress and arrival.",
        details: [
          "Players propose a route; the DM approves it with the downtime preview",
          "Paces of 18, 24 or 30 miles a day, set by the DM",
          "Optional rations and mount feed, paid once on approval",
          "The DM confirms arrival and moves the party",
        ],
      },
      {
        title: "Session Time",
        summary:
          "Advance 1 to 24 hours during play, with optional rests and prorated property work.",
        details: [
          "Settles finances, shop schedules and deliveries at crossed days",
          "Travel and rest grant no labor unless you enable it",
        ],
        dm: true,
      },
      {
        title: "Recurring finances",
        summary:
          "Recurring income and expenses on in-game periods, optionally tied to an owned item or property.",
        details: [
          "Rent, wages and upkeep use the same schedules",
          "Unpaid expenses stay as arrears",
          "Pause or edit any schedule",
        ],
        dm: true,
      },
      {
        title: "Review Inbox",
        summary:
          "One queue for payment and loan requests, character imports, training, proposals and treasure pool claims.",
        details: [
          "Approve or decline with history kept",
          "Property projects, hires, boarding and voyages wait here too",
        ],
        dm: true,
      },
    ],
    minor: [
      {
        title: "Named play sessions",
        text: "Start and end recorded sessions with coin movement summaries.",
        dm: true,
      },
      {
        title: "Away activities",
        text: "Send characters away for hours or days; they return when time passes.",
        dm: true,
      },
      {
        title: "Financial Settings",
        text: "Price modifiers, shop defaults and every recurring schedule on one screen.",
        dm: true,
      },
      {
        title: "Review Reports",
        text: "Financial overview, session summaries, edit reports and price history.",
        dm: true,
      },
      {
        title: "Player downtime",
        text: "Players see their hours and request training from Home.",
      },
    ],
  },
  {
    id: "together",
    chip: "Play together",
    title: "Play together",
    lead: "At one table, by turns, or live online.",
    shots: ["room"],
    major: [
      {
        title: "Three play modes",
        summary:
          "Local play on the DM's device, Turn-based rooms, or Live rooms where actions sync as accepted.",
        details: [
          "Local DM play works offline on a saved device campaign",
          "Turn-based keeps actions as a draft until you end your turn",
          "Failed or offline actions stay pending for retry",
        ],
      },
      {
        title: "Rooms and invitations",
        summary:
          "Host a room, send invitation links for each character, and let guests join without an account.",
        details: [
          "Copy a link for a specific character",
          "Invitations expire when the session ends",
          "Signed-in players keep their campaigns in My account",
        ],
      },
      {
        title: "Chat and alerts",
        summary: "Party and private chat with unread markers, plus message, turn and room alerts.",
        details: [
          "Chat works outside transaction turns",
          "Optional browser push for new messages, without message text",
        ],
      },
      {
        title: "Room control",
        summary: "Release seats, kick or ban players, and keep the room online between sessions.",
        details: [
          "End play and keep the room online, view-only, then resume",
          "Reopen an ended session from My account",
          "Close the room and revoke all access",
        ],
        dm: true,
      },
      {
        title: "Journal and session reports",
        summary:
          "DM, party and private journal entries, with archived reports of each session's money, edits and messages.",
        details: [
          "Attach session reports to journal entries",
          "Loot entries link to their encounter receipt",
          "Players keep their own reports after leaving",
        ],
      },
    ],
    minor: [
      {
        title: "Shared roll history",
        text: "Everyone's rolls in one campaign log.",
      },
      {
        title: "Connection & recovery",
        text: "See pending changes, retry, or export them before leaving.",
      },
      {
        title: "Party fund access",
        text: "Allow chosen players to spend from party funds.",
        dm: true,
      },
      {
        title: "Campaign password",
        text: "Require a password to switch a device back to DM.",
        dm: true,
      },
      {
        title: "Multiple campaigns",
        text: "Each campaign keeps separate characters, purses, shops and history.",
      },
      {
        title: "Find a group",
        text: "Opt-in community profiles and a directory of DMs and players looking to play.",
      },
    ],
  },
  {
    id: "library",
    chip: "Library & tools",
    title: "Library & table tools",
    lead: "References, private books and atmosphere for the table.",
    shots: ["journal"],
    major: [
      {
        title: "SRD references",
        summary:
          "Search SRD 2014 and 2024 spells, equipment, magic items, creatures and conditions through Open5e.",
        details: [
          "Source credits kept on every import",
          "Players get read-only lookup the DM can limit",
          "Saved results work offline",
        ],
      },
      {
        title: "Private PDF books",
        summary:
          "Import your own PDFs, read and search them, and pull prices and items into shops.",
        details: [
          "PDFs stay on your device and are never uploaded",
          "Review extracted prices before adding them",
          "Save favorite entries; share an entry as a handout",
        ],
        dm: true,
      },
      {
        title: "Catalog",
        summary: "A starter catalog of goods and services, plus custom items and generated goods.",
        details: ["Rarity, categories and services", "Add catalog items to shops in bulk"],
      },
      {
        title: "Music and ambience",
        summary:
          "Bundled music and ambient loops per scene, plus your own audio files in device playlists.",
        details: [
          "Playlists with repeat, shuffle and scene assignment",
          "Imported tracks stay on the device",
          "Separate volume for music, ambience and sound effects",
        ],
      },
      {
        title: "Resource packs",
        summary: "Import reviewed JSON packs of creatures, item, NPC, location and shop templates.",
        details: ["Preview the full pack and warnings first", "Packs stay private to the DM"],
        dm: true,
      },
    ],
    minor: [
      {
        title: "Name generator",
        text: "Offline fantasy names with a saved lexicon.",
      },
      {
        title: "Handouts",
        text: "Share extracted text with players as handouts.",
        dm: true,
      },
      {
        title: "Library search",
        text: "Search campaign records, imported entries, goods and names in one place.",
      },
      {
        title: "Themes",
        text: "Adventurer’s Ledger (light) and Ironbound Dragon (dark), saved per device.",
      },
      {
        title: "Custom colors",
        text: "Ready-made looks and custom accent and page colors.",
        dm: true,
      },
      {
        title: "Fantasy backgrounds",
        text: "Day and night scenery behind menus, switchable.",
      },
      {
        title: "Reading size",
        text: "Adjust PDF reading size; reduced motion is respected.",
      },
      {
        title: "Sound effects",
        text: "Optional coin and page sounds for confirmed actions.",
      },
    ],
  },
  {
    id: "platforms",
    chip: "Platforms",
    title: "Platforms, accounts & backups",
    lead: "The same campaign in the browser, on Android and at the table.",
    shots: ["phone-home"],
    major: [
      {
        title: "Browser app",
        summary: "Runs in desktop and phone browsers and updates as soon as a release goes live.",
        details: [
          "Install as a shortcut where the browser allows",
          "Wide screens use the full monitor width",
        ],
      },
      {
        title: "Android app",
        summary:
          "A permanently signed app with the interface bundled, so device campaigns work offline.",
        details: [
          "Save or share exports through Android",
          "Website features arrive with each signed update",
        ],
      },
      {
        title: "Split view and windows",
        summary:
          "Show two screens side by side, or open screens in separate tabs and windows across monitors.",
        details: [
          "Split view on computers and Android tablets in landscape",
          "Drag the divider or use the keyboard; panes swap and close",
          "Each window keeps its own screen and campaign",
        ],
      },
      {
        title: "Optional accounts",
        summary:
          "Accounts keep your campaigns, characters and backups across devices; guests can still play.",
        details: [
          "Required to host as DM; optional for players",
          "Reusable character profiles and a member profile",
          "Recovery keys that rotate when used",
        ],
      },
      {
        title: "Backups",
        summary:
          "Named device backups to export and restore, and private cloud backup versions in your account.",
        details: [
          "Protect saves with the campaign password",
          "Cloud restores create a new local campaign",
          "Private PDFs are never included in cloud backups",
        ],
      },
    ],
    minor: [
      {
        title: "Bug reports",
        text: "Report a bug from My account, with optional diagnostics you preview.",
      },
      {
        title: "Diagnostics download",
        text: "Download a diagnostic report to share by hand.",
      },
      {
        title: "Address move check",
        text: "Lists unsent changes and device-only data before moving to lootsplitter.com.",
      },
      {
        title: "Help guide",
        text: "Searchable DM and player help, in the app and on the website.",
      },
      {
        title: "Free",
        text: "Every feature is free; donations are optional.",
      },
    ],
  },
];
