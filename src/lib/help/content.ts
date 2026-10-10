export const APP_DESCRIPTION =
  "Manage tabletop campaigns with character sheets, shared funds, inventory, shops, encounters, and DM-approved downtime finances. Play locally or in shared rooms, with account-owned campaigns, guest invitations and backups.";
export type HelpTopic = {
  id: string;
  title: string;
  audience?: string;
  paragraphs: string[];
  links: [string, string][];
};
export type HelpGroup = { id: string; title: string; topics: HelpTopic[] };
export const HELP_GROUPS: HelpGroup[] = [
  { id: "world", title: "Maps, NPCs, barter & session time", topics: [
    { id: "campaign-maps", title: "Import maps and show locations", audience: "DM / Players", paragraphs: ["Maps is the sixth main tab. The DM imports PNG, JPEG or WebP maps for existing locations, reviews device-local Read location labels suggestions, or links locations manually. The party marker follows Market's selected location; owned/accessible properties, shops, NPCs and post offices share its anchors. Unmapped locations are explicitly unplaced.", "Drag to pan, pinch or scroll to zoom; buttons and keyboard controls are available. The DM places/removes shared or DM-only markers live. Players see everything drawn into a shared image, so keep secret map artwork on a DM-only map."], links: [["Open Maps", "/maps"], ["Complete instructions", "/download/world-features.md"]] },
    { id: "location-npcs", title: "Create, import and interact with NPCs", audience: "DM / Players", paragraphs: ["Market → People & NPCs lets DMs create non-party NPCs with location, description, portrait, inventory and funds. Players meet visible NPCs at their selected location; the DM responds by default. A configured player-character controller may speak/decide trades for that NPC without gaining configuration permissions.", "NPC JSON imports use format lootsplit.npcs, schemaVersion 1, and existing campaign location IDs. Preview before importing; every record is validated atomically. Dialogue is private to the interacting character, DM and configured NPC controller."], links: [["People & NPCs", "/features/npcs"], ["NPC import sample", "/download/location-npcs.sample.json"]] },
    { id: "barter", title: "Barter goods and property deeds", audience: "DM / Players", paragraphs: ["Trading & Barter uses bilateral offers and counteroffers for coins, carried goods and clean property deeds. The current recipient accepts or declines; either participant may cancel. Another player's inventory remains private until they offer it. Nearby NPCs require the DM's Bartering allowed flag, and their DM/controller supplies consent.", "Acceptance rechecks funds, lots, ownership and location, then exchanges both sides atomically. Stored, reserved, transit or service items cannot be offered. Resolve property obligations or use the existing DM handover. Deeds retain their original receipt and update their owner; accepted history is retained."], links: [["Trading & Barter", "/features/trading"], ["Property Management", "/features/properties"]] },
    { id: "black-market", title: "Reveal hidden black-market vendors", audience: "DM", paragraphs: ["Market's Black market toggle reveals/hides configured vendors during play. Each shop's Black-market vendor rules set its hidden status and premium (greater than 1, default 1.5). Stock, location, schedules, rarity, illegal-goods descriptions and ordinary purchase receipts use existing Market tools. The premium applies before the existing Charisma adjustment.", "Hidden vendors are absent from player data; stale purchases are rejected. Toggling does not open closed shops or bypass location. The DM can edit hidden vendors at any time."], links: [["Market", "/market"]] },
    { id: "session-clock", title: "Advance session hours, rest and downtime", audience: "DM", paragraphs: ["Start a recorded play session, then open Session Time. Review and advance 1–24 hours per action. Optional short/long rests use the existing sheet resource policies; the DM decides whether the time qualifies. Hit dice, conditions and manual resources remain manually controlled.", "The canonical campaign clock settles finances, shop schedules, letters and deliveries at crossed days once. Approved property work can progress by elapsed hours using existing assignments, materials and permissions; travel/rest grants no character labor unless the DM enables it. Pending between-session downtime must be approved/cancelled first."], links: [["Session Time", "/features/time"], ["Downtime", "/features/downtime"]] },
  ] },
  {
    id: "start",
    title: "Start here & find a menu",
    topics: [
      {
        id: "first-campaign",
        title: "Start a campaign or join your party",
        paragraphs: [
          "Open the app and choose your device role. The campaign selector at the top creates or switches local campaigns. Each campaign keeps its own characters, purses, inventory, shops and financial history. New blank campaigns do not contain your other campaign’s assets.",
          "The DM adds characters and shared party funds in Party → Funds & inventory. Mark each character as Player or NPC; only player characters can be assigned to players. To join a shared game, open Campaign, enter the room code and choose an available character. An account is optional for guest room play. Everyone needs access to the website or a compatible app.",
        ],
        links: [
          ["Open app", "/?view=home"],
          ["Party & funds", "/party?section=funds"],
          ["Join or host a room", "/share"],
        ],
      },
      {
        id: "menus",
        title: "What each menu does",
        paragraphs: [
          "DM navigation: Desk combines campaign control and overview, with visible multiplayer settings, swipeable Session/Party/Funds/Activity/Rolls readouts, grouped feature links and expandable treasury, activity, sessions and campaign tools; Encounters builds and runs encounters; Party holds character cards, purses and inventory; Market contains shops and trading; Library opens catalog, spells, creatures, names, handouts and private DM books; Maps opens imported location maps, party position and shared markers.",
          "Player navigation: Home offers fixed buttons for Character Sheet, Bank, My Finances, Properties, Journal and Party chat; Inventory opens your possessions and permitted financial actions; Campaign contains Room, Chat, Rolls and Alerts; Market opens trading; Library opens available references; Maps opens shared cartography and location records. The full campaign overview holds sessions, reviews and activity.",
          "The gear opens Settings & Management. Its categories depend on your role. Use the campaign name to switch campaigns and the message icon for chat. On desktop the same destinations appear in the navigation rail. The DM Desk uses swipeable summaries. Previously saved DM shortcuts can still be managed from Dashboard → Saved shortcut settings.",
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
          "Campaign characters use the same character ID, purse and inventory as Party. Changes to permitted coin and equipment fields stay connected to those records. Standalone account characters are separate reusable profiles: their private money and equipment are not silently merged into a campaign.",
          "Play shows vitals, attacks, spells, skills and dice. Edit changes the sheet; save your changes before leaving. Supported JSON and text/form-based PDF imports can be reviewed before saving. Image-only scans are not supported. Species, classes, levels, conditions, spell effects, hit dice and house rules are maintained manually.",
          "Players control assigned characters and permitted actions. They cannot create money, revalue inventory or change price-affecting Charisma. DM financial adjustments are recorded in the ledger. Buying, selling, transfers and DM awards update the existing inventory. In Party → Add loot, choose Custom loot for items or property, or Open5e loot to search SRD equipment and magic items. Review the item value, quantity, recipient and source notes, then confirm Add holding. Open5e search needs a connection unless saved results are available; custom loot works offline.",
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
          "Conclude the encounter, review generated or chosen loot, set item and coin recipients, then explicitly transfer the award. A confirmed award is applied only once. Account drafts cannot award into campaigns; shared campaign awards require the active DM’s permission. Imported drafts reset outcomes, award receipts and recipients so they can be reused safely.",
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
        ],
        links: [
          ["Library", "/library"],
          ["Spells", "/catalog?pane=open5e&kind=spells"],
          ["DM books", "/books"],
          ["Handouts", "/library#handouts"],
          ["Sources & licenses", "/resources"],
        ],
      },
    ],
  },
  {
    id: "money",
    title: "Money, shops & downtime",
    topics: [
      {
        id: "currency",
        title: "Coin values, purchases and transfers",
        paragraphs: [
          "Coin conversions: 10 cp = 1 sp; 5 sp = 1 ep; 2 ep = 1 gp; 10 gp = 1 pp. Prices and calculations use copper internally. Dollar estimates are a display comparison, not real-money payments or a change to coin values.",
          "Choose a purse when buying or selling. The recorded Charisma score reduces purchase prices by 1% per point above 10, capped at 20%; party funds receive no Charisma discount. Blank shop stock quantities mean unlimited supply. Finite stock and available funds are checked when a transaction commits.",
          "Give transfers coins or holdings between campaign accounts. A transfer is not new campaign income. In Bank, players request permission to spend coins on expenses such as an inn bill. The DM approves or declines these in Review Inbox; approval deducts coins from the requesting account once. This does not send a bill to a player or transfer payment to the DM. The DM can also queue a proposed expense in Bank. Ordinary permitted purchases use the shop’s buy flow. Transaction history records purchases, sales, transfers, payments and adjustments. Voiding a supported entry records a reversal, and purchased items must be returned before reversing that purchase.",
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
        id: "property-operations",
        title: "Store, build and manage properties",
        paragraphs: [
          "Property Management keeps the existing estate register, inventory deeds and shop location hierarchy. The DM estate workshop provides building presets, material definitions, work recipes, city post offices and reviewed JSON imports. Import owner aliases map to existing campaign purses; owned configurations start inactive without goods, staff, money movement or invented deeds.",
          "Use a property's expandable sections for storage, work, staff, rentals, deliveries and letters. The party must be at its location to move goods. Stored, reserved and travelling lots stay out of carried character equipment. Deposits keep their owner unless explicitly donated for shared work; permitted withdrawal assigns the retrieved lot to the selected character.",
          "Players propose work and hires for DM review. Approved projects reserve materials, share character downtime or pay contractors and attach completed buildings to the original parcel. Managers need delegated duties, paid contracts and spending limits. Rental income, upkeep and wages use existing finance schedules; vacancy, missing staff and arrears can block new operation benefits.",
          "Send a property letter while at an open city post office. Postage is paid once; campaign-day delivery rechecks the manager, ownership, reviewed instruction and budget. Letters do not allow remote item withdrawal. Review property effects in the existing downtime preview and explicitly approve at the next session. Active obligations must be resolved before ordinary sale/Give, or the DM records a handover retaining contents and history.",
        ],
        links: [["Property Management", "/features/properties"], ["Property proposals", "/features/review"], ["Approved downtime", "/features/downtime"]],
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
          "The campaign DM manages shop prices, catalog, books, character assignment, shared-fund access, turns and approvals. A site staff role does not grant permission to someone else’s campaign. Shared play checks permissions on the server.",
          "Change device role is in the gear’s Settings & Management panel. Set a campaign password in Settings before switching to Player if you want returning to DM to require that password. Shared connections block local role switching; disconnect or return to Local Mode first.",
          "DMs require accounts. Signed-in players receive saved memberships automatically; guests need a current invitation. Accounts also provide private cloud backup versions, profile/privacy controls, recovery keys and reusable characters. Saving a membership is not the same as uploading a campaign backup. Keep your recovery key securely; recovery keys rotate when used. Email delivery and email alerts are not configured.",
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
          "Check Campaign → Connection & recovery before retrying, leaving or discarding anything. Export pending actions if you need a recovery copy. Recovery files belong to the same campaign code. Shared sessions are remembered on this device.",
          "If a character is occupied on another device, the DM can release its seat after pending actions are resolved. The DM can also grant party-fund access and choose the next participant. Mode changes and room closure require submitted drafts to be resolved. Offline changes remain saved on the device where they were made.",
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
        ],
        links: [
          ["Open appearance controls", "/?view=home#management"],
          ["DM custom colors", "/settings#appearance"],
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
    ],
  },
  {
    id: "install",
    title: "Install & update",
    topics: [
      {
        id: "android",
        title: "Android installation and updates",
        paragraphs: [
          "Export and verify a backup first. Use Downloads → Download for Android and open the APK in your phone’s file manager or Downloads. If prompted, allow that browser or file manager to install apps, then return to the installer. Install over the permanently signed Lootsplit app to preserve its data.",
          "An old debug-signed app cannot update in place to the permanent signing key. Export and verify a backup before uninstalling that older build, then install and restore. Do not uninstall a working app just to troubleshoot a download. GitHub and the earlier Google Drive download remain available on Downloads.",
          "The website receives updates independently of the published APK. Website-only improvements become bundled Android features with a future signed APK release; see the published version and changelog on Downloads.",
        ],
        links: [
          ["Downloads & release details", "/downloads"],
          ["Versioned changelog", "/updates"],
        ],
      },
      {
        id: "desktop",
        title: "Use Lootsplit on desktop or mobile web",
        paragraphs: [
          "Open the browser app on your computer or phone. Bookmark it, or use your browser’s Install app/Create shortcut option if available. A native Windows or macOS installer is not available. A shortcut does not synchronize saves or make a backup.",
          "Use the same browser profile and website address for device-local campaigns. Clearing browser storage can remove them. Use shared rooms or an exported backup to move between devices; optional accounts do not automatically upload all local data.",
        ],
        links: [
          ["Open browser app", "/?view=home"],
          ["Downloads", "/downloads"],
        ],
      },
    ],
  },
];
export function topicMatches(topic: HelpTopic, query: string) {
  return [topic.title, topic.audience, ...topic.paragraphs, ...topic.links.flat()]
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
