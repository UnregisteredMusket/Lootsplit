import type { HelpGroup } from "./content";
import { SUPPORT_EMAIL } from "../website/contact.ts";

export const PLAYER_DESCRIPTION =
  "Play your assigned character, manage permitted inventory and requests, read shared records, and stay connected to your party.";
export const PLAYER_HELP_GROUPS: HelpGroup[] = [
  {
    id: "start",
    title: "Join & find your way",
    topics: [
      {
        id: "new-name",
        title: "Lootsplit is now Lootsplitter",
        paragraphs: [
          "Lootsplit has a new name: Lootsplitter. It is the same app: your character, saved memberships, settings and account stay as they were, and invitations from your DM keep working. On Android, version 1.10.0 and later shows the new name on the home screen; install the update over the existing app.",
          "The website has moved to lootsplitter.com. The old address keeps working for at least 12 months, and the Android app needs no change. Your account and your DM's campaign are on the same server: sign in again at lootsplitter.com and rejoin as usual. Some things live only in the browser you used before: unsubmitted changes, saved seats, preferences, map camera positions, notifications and bookmarks. Settings → Moving to the new website address lists unfinished work for every campaign on this device without changing anything; submit it before you switch.",
        ],
        links: [["Campaign connection", "/share"]],
      },
      {
        id: "first-campaign",
        title: "Join your party",
        paragraphs: [
          "Open the current invitation from your DM: the link finds the room’s characters by itself, so choose your assigned available character, enter the name the party should call you (this device remembers it for next time) and choose Join room. You land on Home with a short Getting started strip (Sheet, Inventory & coins, Chat); dismiss it with ×. Campaign → Room shows whether the DM runs the room in Live or Turn-based mode; only the DM changes it. Before you join, Connection & recovery, device backups and manual sharing are folded into one group on Campaign. Guests do not need an account. Signing in lets you resume a saved membership on another device while its room and invitation remain valid. Repeated wrong passwords add a short wait before you can try again (up to 15 minutes). On the website, signing in and creating an account include a quick human check from Cloudflare that usually completes without a click.",
          "If another room is open, choose whether to stay or switch before accepting the new invitation. The join card, the header and the browser tab show your DM’s campaign name, or Shared campaign and the room code when the DM has not named it. A character or campaign name does not identify a room. Ask your DM for a fresh invitation when a session closes; old invitations remain expired after reopening.",
        ],
        links: [
          ["Campaign connection", "/share"],
          ["Saved memberships", "/account"],
        ],
      },
      {
        id: "multiple-windows",
        title: "Use multiple tabs and displays",
        paragraphs: [
          "Choose Tabs & windows in the app header (on screens narrower than 1024 px: Settings & Management → Appearance → Tabs & windows…; the Android app leaves it out), select a permitted screen, then Open new tab or Open separate window. Move separate browser windows onto your monitors. Allow pop-ups if your browser blocks the action, and complete the title screen in each new window. Use the desktop website for multiple monitors; the Android app keeps its normal navigation, and Android tablets in landscape can use split view.",
          "New windows reconnect to your existing authorized seat and retain your assigned-character permissions. They do not grant DM tools or access to private records. Saved campaign changes synchronize through the current play mode; unsaved form entries stay in their original window. Pending actions still need the normal submission or DM approval. Keep unsent guest work open or export it before closing its document. Closing a window does not close the campaign room.",
          "The DM can optionally enable a read-only Player display on a TV; it is off by default and is not required for online play. It contains only the selected shared map, revealed combatants and optional confirmed loot awards. It does not give control of characters or access to DM notes, hidden combatants or unawarded loot. Continue using your own invited player session for actions.",
          "Each window keeps its own screen and campaign selection. Account sign-in and sign-out affect other windows in the same browser profile. Restore minimized windows to refresh their data. Use browser tab mute if you only want audio from one window.",
        ],
        links: [
          ["Player Home", "/?view=home"],
          ["Campaign connection", "/share"],
        ],
      },
      {
        id: "split-view",
        title: "Show two screens side by side (split view)",
        paragraphs: [
          "On a computer, or an Android tablet in landscape (Android 1.9.3 and later), at least 1024 pixels wide, choose Split view in the header’s Layout control or Open beside, then pick a screen, for example your character sheet on the left and the Market on the right. Open beside lists the main screens and your tools and marks the one you used last. Each pane has its own screen menu plus Swap panes, Show this pane full width and Close this pane; Single screen returns to one screen.",
          "Drag the divider, or focus it and use the arrow keys (Shift for small steps, Enter or a double-click for 50/50). Links inside a pane change only that pane. Click a pane or press F6 to focus it; the focused pane is outlined and names the browser tab.",
          "Both panes use your same seat and connection, so buying in the Market updates your purse on the sheet beside it at once, and nothing is bought twice. Panes offer only screens your seat can already open; they never show DM-only screens or other players’ private records. Reloading keeps the screen beside; narrower windows show one screen and restore the other when there is room. Unsaved character edits ask before a pane closes or changes screen.",
        ],
        links: [
          ["Player Home", "/?view=home"],
          ["Market", "/market"],
        ],
      },
      {
        id: "menus",
        title: "Player menus and Help",
        paragraphs: [
          "Home shows your assigned character with Open character sheet, followed by Your services and the same six shortcuts: Character Sheet, Bank, My Finances, Properties, Journal and Party chat, with the quest you follow and a Quest log link above them. Party & inventory opens your permitted possessions and financial actions, the treasure pool and Fairness. Campaign contains the room, chat, rolls and alerts. Market opens nearby shops and trading. Library contains read-only reference indices and shared records. Maps shows shared cartography.",
          "Search (the magnifying glass in the header, Ctrl+K or ⌘K, or / outside a text field) finds screens, records and a few actions in one list: your character, NPCs you have met, shops you can see, places, shared maps, and the items in your own inventory. It only lists what your screens already show you. Arrow keys move, Enter opens, Esc closes. Press ? (or Settings & Management → Help → Keyboard shortcuts) for the shortcut list: g then d Home, g p Party & inventory, g m Maps, g k Market, g l Library. Letter shortcuts never fire while you type, and on Maps the map keeps its own keys.",
          "On a phone turned sideways, the section tabs become a narrow icon rail on the left and the header slides away while you scroll down (scroll up, or move keyboard focus into it, to bring it back); Maps keeps its own controls. The title screen says Tap to continue on touch screens and names the campaign you last opened on this device, with its session.",
          "Open the gear for Settings & Management. Help is available there and from the Help button in the app. Keyboard users: the first Tab on any screen shows Skip to content, which jumps past the navigation. This player guide is searchable; its links open the current campaign with your existing permissions. Internal links do not restart the title screen. Guide for switches between this guide (Players) and the Dungeon Master guide; reading the DM guide changes none of your permissions.",
          "In the Android app, the Back button closes whatever is on top first: a confirmation, an open picker or ⋯ menu, a sheet or dialog, then a map panel, and only then goes to the previous screen. On the first screen with a campaign open, Back shows Press back again to exit; a second press within 2 seconds closes the app. The status-bar icons turn dark on the light themes so they stay readable.",
        ],
        links: [
          ["Player Home", "/?view=home"],
          ["Settings & Management", "/?view=home#management"],
          ["Library", "/library"],
        ],
      },
    ],
  },
  {
    id: "play",
    title: "Your character & references",
    topics: [
      {
        id: "characters",
        title: "Play and edit your assigned character",
        paragraphs: [
          "Play shows your vitals, attacks, skills, spells, equipment and dice. Your assigned campaign character uses the same purse and inventory as the party ledger. Other characters do not become yours when you open a record. An explicitly shared NPC sheet is read-only and does not let you roll or act for it.",
          "If the sheet cannot load, use Retry character sheet on the error message. This retries the read in your current room without signing out or clearing pending actions. Roll permissions still come from the DM. Your assigned character opens straight to the sheet, with Home › Character sheet above it (Home stays highlighted in the navigation). Once a sheet is open, Sheet tools contains Export sheet / draft, Import into this character, Reload sheet and My characters · choose, create or import, which opens your character library below the sheet. −1 HP and +1 HP beside your vitals save at once (temporary HP is used first); Last roll beside Jump to dice tray shows your latest result. The save bar appears only while you have unsaved edits. On a phone, Jump to dice tray moves focus to the existing roll controls. Reload sheet fetches it again; export or save an unsaved draft before confirming that reload.",
          "Your DM controls Live character editing and individual field permissions. A lock icon beside Edit sheet means full editing is off; permitted play actions remain available; restricted sheet edits are reported for DM review. You cannot use the character selector or a direct link to control an unassigned character. A standalone account character remains separate from the campaign until an authorized assignment/import.",
          "Use Import character or the sheet's import controls to review supported JSON, text/form PDF, or image/scanned-PDF extraction. Device-local recognition can misread handwritten or scanned values: compare every tab before submitting. Imported items without a value get their SRD price when the name matches (the review lists each one, and items with no match stay unpriced). Campaign imports can require DM approval and do not replace campaign funds or possessions. Save before leaving an edited sheet.",
        ],
        links: [
          ["Character sheets", "/characters"],
          ["Party & inventory", "/party?section=funds"],
        ],
      },
      {
        id: "rolls",
        title: "Dice and recorded results",
        paragraphs: [
          "Choose Pen & Paper mode or Virtual Mode under Settings & Management → Rolls. Pen & Paper records physical totals including modifiers; Virtual Mode generates dice. The choice is saved on this device, and the campaign's manual-roll policy still applies.",
          "Use your sheet for checks, saves, skills, attacks, damage, spells and custom dice. Shared app rolls are generated by the server and recorded. Advantage and disadvantage apply to supported d20 rolls. Rolling does not automatically apply damage, conditions, spell effects or house rules.",
        ],
        links: [
          ["Sheet dice", "/characters#dice"],
          ["Shared rolls", "/share?tab=rolls"],
        ],
      },
      {
        id: "references",
        title: "Read-only item, spell and creature lookup",
        paragraphs: [
          "Library → Catalog, Items, Spells or Creatures opens searchable references. Choose the rules edition and section, enter a name, search, then expand an entry to read its description, stats and source credit. Reference results never add items, change spells or edit your character. Some recent searches may be available when the source is offline.",
          "Lookup is paused by default while any encounter in your campaign is active. Your DM can disable lookup, limit individual indices or allow it during encounters. Direct Catalog links and saved reference results follow those controls. Your own saved sheet, shared maps, campaign records and handouts remain available; a reference restriction does not remove your spell list or possessions.",
          "Campaign records open the entries shared with you. Search locations, people and other visible records by name or record type. Handouts are read-only campaign references. Private source packs and books are not part of the player Library.",
        ],
        links: [
          ["Library", "/library"],
          ["Items", "/catalog?pane=open5e&kind=items"],
          ["Spells", "/catalog?pane=open5e&kind=spells"],
          ["Creatures", "/catalog?pane=open5e&kind=creatures"],
          ["Handouts", "/library#handouts"],
        ],
      },
      {
        id: "encounters",
        title: "Play during an encounter",
        paragraphs: [
          "Use your assigned sheet, inventory and dice during combat. Your DM runs initiative, rounds, enemies, conditions and loot awards. Lookup restrictions begin when a campaign encounter is started and end when every active encounter is concluded, unless your DM sets an override.",
          "Your DM chooses when to apply initiative order. Entering or correcting a score does not automatically move combatants or change whose turn it is. Campaign encounter ordering controls remain with the DM.",
          "An encounter roll is a recorded result, not an automatic application of combat rules. Awarded loot appears in its chosen canonical inventory; do not add a second copy manually.",
        ],
        links: [
          ["Character sheet", "/characters"],
          ["Party & inventory", "/party?section=funds"],
        ],
      },
    ],
  },
  {
    id: "money",
    title: "Money, shopping & property",
    topics: [
      {
        id: "currency",
        title: "Coins, purchases and transfers",
        paragraphs: [
          "10 cp = 1 sp; 5 sp = 1 ep; 2 ep = 1 gp; 10 gp = 1 pp. Dollar estimates (shown as “≈ $… modern”) are only a display comparison; they are off for players unless you turn on Show dollars. Choose a controlled purse when buying or selling; the app rechecks funds, stock and location, on a player link as in a shared room. One purchase or sale is 1 to 100,000 units. Pressing Buy or Sell again after an error or a lost response applies that same purchase at most once; changing the purse, item or quantity makes it a new one. Your recorded Charisma reduces shop purchase prices by 1% per point above 10, capped at 20%; shared party funds receive no discount.",
          "Give transfers existing coins or possessions. If a Give is refused, for example because funds are short or it is not your turn, the error is shown and the form keeps what you entered; pressing Give again applies that same transfer at most once. Bank lets you request an expense or loan and follow its decision or repayment. Approved spending deducts your coins once; it is not a payment to the DM. My Finances shows your permitted loans, recurring income and expenses, and reports. A repayment amount is entered in copper; the line under the field shows it in gold as you type, and Enter gold, silver or other coins takes amounts such as 2 gp 5 sp. It does not show another character's private debts.",
          "Party & inventory → Inventory (Inventory & purse) shows your coins (pp, gp, ep, sp, cp) with Give, and Split where splitting is offered, right under Combined wealth. Your items are one list: search, filter by category or Equipped, and tap ⋯ on an item to Give it or Sell to shop (pick a shop and its counter opens with that item chosen). Identical entries show as one row, such as Potion of healing ×3; open it to see the separate entries, which stay separate in your inventory. Select lets you give several items at once: each moves as its own transfer, and if the page reloads part-way, Resume sends only what has not moved yet.",
          "Fairness: Party & inventory → Fairness shows how much loot each party character has received, campaign to date or for one session. It only reads receipts that already exist and never moves coins or items. Coin splits from a party fund or an encounter, encounter awards and treasure-pool items count, at the value recorded when they were awarded or claimed; purchases, trades, Give, wages, loans, payments, downtime and splitting your own coins do not. Older encounter items with no recorded value count as 0 cp and are marked. While your character travels with the party you see every party character's total, the gap against the party average and their counted receipts, plus the lines on your own ledger that do not count. Away from the party you see only your own totals. A character who joined later is marked Joined in Session N; pick one session to compare like with like. If you joined a shared campaign later, your totals start at the first session you were part of. The DM may favour whoever is behind when resolving the treasure pool: Need still comes before Greed, and the receipt shows the totals used.",
          "Treasure pool: Party & inventory → Pool shows the items the DM put in the party's pool; the number on the Pool tab is how many lots are waiting. For each item, mark Need (you'll use it), Greed (you'd take it) or Pass (not for you), or use Claim all as Pass for the lots you have not marked yet; if you control several characters, choose who is claiming. A claim is only a request: nothing moves until the DM resolves the item, you can change it until then, and you can send it even when it isn't your turn. Every party member's claims are visible to the party. A stack is one claim; the DM hands its items out one at a time, and a stack with more items than claimants goes round again. Pooled items can't be given, sold, offered or equipped by anyone until the DM resolves them. You see the pool while your character travels with the party; away from the party you see only your own claims and awards. On a player-only device link the pool is read-only. Each resolution appears once in your activity and the party chat, and the pool's History tab shows who received what, with any rolls.",
          "Split coins (beside Give, or Split on a party fund row if the DM lets you use party funds) divides coins from a purse you control evenly among the party characters you tick, including yourself: your own share stays in your purse. Each share is rounded down to whole copper and paid in gold, silver and copper on top of each character's own coins. Leftover copper goes to the party fund unless you choose another rule shown in the dialog. Check the preview, choose Review split, then Split coins; everyone is paid or nobody is, and pressing again after an error never pays twice. In a shared room, each split shows once in your activity with every party member's share; you see your own share and your party's lines, never anything private. Splitting is not available on a player-only device link; use Give there.",
          "Your Holder, Category and Equipped filters in Party & inventory are remembered for each campaign on this device.",
        ],
        links: [
          ["Bank", "/features/bank"],
          ["My Finances", "/features/finances"],
          ["Market", "/market"],
        ],
      },
      {
        id: "shops",
        title: "Nearby shops and trade exchanges",
        paragraphs: [
          "Market opens with Shops here: each card shows Open or Closed, and Visit opens that shop's counter. Below the shops, Trade exchange · N goods is a summary; open it for the full commodity board (this device remembers whether you left it open) or follow Trade Exchanges. People & NPCs and Trading & Barter come next. In a shop, the Paying from bar stays at the top while you scroll and remembers the character you last paid with at that shop. Only the row whose quantity you are changing shows its cost and your balance afterward. Closed, hidden or out-of-reach vendors cannot trade. Services are not carried inventory.",
          "At a blacksmith offering commissions, open Blacksmith services → Design a custom item. Choose a weapon or armor, name, each component's style/material/source, engraving and any offered enchantment. Review commission shows price, value, work days and maker before Place paid commission deducts coins and hands over materials. Your contributions must be matching, unequipped carried inventory owned by the paying account; stored, travelling or reserved lots cannot be offered. The smith's skill, material rarity and approved settings determine pricing and craftsmanship; no hidden combat bonus is added.",
          "At a temple, talk to the priest and choose Services · Temple. Each offer shows its price, time, any item it needs and whether the DM reviews it. Choose who the spell is cast on (any party character here; paying for someone gives you no control over their sheet), and for an offer like Raise Dead either bring a fitting item you carry, such as a diamond worth enough, or let the temple supply it for the added price. Automatic offers are paid and recorded at once. Offers that need the DM's review are sent to the DM and charged only if approved; you can withdraw the request until then, and nothing moves if it's denied. Effects are recorded only: the DM updates hit points, conditions and the rest on the sheet. Some spells are only available in a town or a city.",
          "At a workshop, ask a scribe for a spell scroll or an alchemist for potions: choose the offer and how many, and bring your own materials (such as healing herbs) to lower the price, or let the workshop supply them. You pay once when you order. Work advances only when the DM approves downtime; the order card and Market → Service commission register show its days. When it's ready, return to the workshop with the paying character and choose Collect in the conversation or on the order card.",
          "At an inn, ask the innkeeper for rooms: choose the room tier, who stays (party characters who are here), the nights and meals a day. The total shows each factor and is paid once up front; a booked room doesn't give a long rest by itself, and leaving early isn't refunded automatically. Ask Heard anything interesting? to buy a rumour: you see its teaser and price, and once bought the full story is saved in your private thread with the innkeeper. Each character can buy a rumour once (some are once per party), and you can share it in party chat.",
          "At a stable, choose Stabling to book stalls for your animals (yours or the party fund's) for some nights, with feed if you like: paid once up front, and the animals stay in your inventory. Or choose a coach route: the coach carries the whole party, and booking sends a journey request to the DM with the fare shown. Nothing is charged until the DM approves departure; then the fare is charged once and the party travels over approved downtime like any journey. You can withdraw the booking until then. A route the DM hasn't drawn yet is locked.",
          "At a courier, “I need a letter delivered” sends a letter to an NPC your character has met who is somewhere the courier delivers to. Choose them, write the letter and pay once (miles × 2 cp). It travels only when the DM approves downtime, then appears in your private thread with that NPC, where they answer. Property letters still go through your property's post office; parcels aren't carried.",
          "Ask a trainer “Can you teach me?” for paid lessons: choose a subject, the pupil (a party character who is here) and up to how many training days, then Agree terms. Nothing is charged then. Log each session in Downtime → Learn from a paid teacher after the DM approves downtime: it reserves the hours and shows the fee (hours × the daily rate ÷ hours in a training day, rounded up). The fee is charged once when the DM approves the session; a denied or cancelled session costs nothing. End lessons stops new sessions. Finishing lessons doesn't change your sheet; the DM decides what you learned.",
          "Ask a sage “What is this thing?” to identify an item: choose one your character carries (worn is fine) and ask. Nothing is charged and the item stays with you while the DM answers; you can cancel the request until then. When the DM answers, the fee is charged once and the answer arrives in your private thread with the sage, and may be added to the item's notes or rename it.",
          "Some NPCs connect you to a screen you already know, marked ↗ in the conversation. A fence (only while the black market is open) opens their shop's Sell tab at the fence's rate. A bank opens Apply for a loan with the bank named in your note; the DM decides the loan as usual. Ask for hired hands to propose a staff contract for one of the party's properties: choose the role and the property, and the DM approves it; nothing is paid until wages fall due. A tailor is a workshop: order clothes like any commission and bring cloth to lower the price.",
          "The DM must approve campaign downtime for the smith to make progress. A completed order waits at the original forge; return with the ordering account and use Collect crafted item once. The description records the components, engraving, enchantment, craftsmanship, maker and campaign order/completion dates. Market's Blacksmith commission register lets you track orders while travelling. Existing orders retain agreed terms if the forge changes; cancellation refunds or material salvage require a DM adjustment. These website services reach the Android app through a separately signed update.",
          "The global commodity market is available in a city or an area inside a city. Towns, regions and an unset location do not grant access. The shipped fantasy commodity list is reference data, not free stock or money. A city's default Trade Exchange can be empty or inactive until configured. Exchange offers and seasonal prices follow the campaign's current settings. The DM’s Desk market summary can show campaign-wide prices while travelling; it does not grant remote player trading. Use Market for prices and access available to your character.",
          "After you buy, sell or give, the confirmation at the top has View receipt, showing the lines that action recorded and the item with Show in inventory. Only the DM can undo a purchase.",
        ],
        links: [["Market & exchanges", "/market"]],
      },
      {
        id: "ships",
        title: "Ships, cargo and voyages",
        paragraphs: [
          "Open Property Management from Home to view your ships and authorized shared ships. Your DM reviews templates and publishes available ships through the property register. Searchable menus scroll within their own panel; search narrows the options and Escape returns to the selection control. Name your ship and use its Storage section for trade goods; cargo keeps its owner and cannot also be carried or used remotely. The read-only stat block shows STR, DEX, CON, component AC/HP/thresholds, crew, speed and capacity. Crew characters keep their own complete abilities.",
          "Request boarding or disembarking for your assigned character. Your DM reviews the request. Characters left aboard move with the vessel; characters ashore remain at their location. Boarding does not permit switching to or controlling another character. A boarded character away from the party's market cannot buy or sell there remotely.",
          "Choose a permitted local dock, dry storage or shipyard. Facilities charge their reviewed daily rates and have berth/length limits. A purchased private shipyard avoids rental fees for its owner's ships; upkeep, wages, materials and labor still apply. Launch afloat before proposing travel. Your DM reviews staff contracts, ship rules and purchases.",
          "At a suitable yard, propose a damaged component's repair or an available upgrade. Choose your funded paying character. The quote shows work and contractor cost; insufficient funds block paid work and character labor uses the existing downtime allocation. Your DM approves the ordinary property project. Materials are reserved/consumed once and upgrades preserve existing damage. Moving the ship pauses former-yard work.",
          "Propose a downtime voyage with destination, duration, payer, budget and your aboard crew. Your DM approves it and campaign downtime. Partial advances retain progress; arrival moves ship, cargo and occupants together. Damage, minimum crew, funds and budgets can block travel. Maintenance, provisions, staff wages and facility fees use campaign funds; arrears remain visible. Trade through actual port exchanges or reviewed captain orders, without automatic profits. Your DM can teleport a ship with a recorded override. Optional mapped voyages use a shared gridded map with reviewed port anchors and intermediate tiles. Distance and the ship's travel pace set the proposed duration; the route marker follows approved downtime and pauses when blocked. Manual-duration voyages remain available. Combat token movement does not advance voyages. The Android app includes mapped voyages.",
        ],
        links: [
          ["Property Management", "/features/properties"],
          ["My Finances", "/features/finances"],
        ],
      },
      {
        id: "property-operations",
        title: "Use and manage your properties",
        paragraphs: [
          "Property Management shows properties and storage you may access. You can edit permitted property details and propose work or hires for review. Storage requires the campaign to be at the property's location. Stored, reserved and travelling goods are unavailable as carried equipment; withdrawal returns a permitted lot to the chosen character.",
          "Construction, wages, rent, deliveries and manager actions progress through approved campaign time. Send manager instructions from an open city post office and review postage and delivery time. A letter does not permit remote withdrawals. Active obligations can block ordinary deed sales or transfers until resolved.",
        ],
        links: [
          ["Property Management", "/features/properties"],
          ["My Finances", "/features/finances"],
        ],
      },
      {
        id: "downtime",
        title: "Downtime and campaign time",
        paragraphs: [
          "Open Time & downtime (downtime activities and NPC training; it used to be called Downtime) from Home. The hour bar and text separate available, awaiting-review and allocated hours for the selected approved period. The training form groups participants, activity/time and description/context; its day summary uses that period’s captured conversion. Expand Time rules & training eligibility for full details. After the DM approves a downtime period, allocate its usable hours to NPC training. The defaults are 16 usable hours per character per downtime day and 8 hours per displayed training day; the DM can configure both for new periods. Multiple categories use the same resource. Ship travel consumes no personal hours, while approved property labor and away activities share the budget.",
          "Choose your assigned trainer, an NPC, Martial, Academic or Skill / Profession, a subject, hours and a description. The NPC must be at an equal or lower character level, and class level if you specify a class; both participants need to be together. Training uses the same hours from each participant. Submit for DM review; missing sheets or unrecognized class levels need a written DM confirmation. Pending requests reserve hours, and cancelled/denied requests release them.",
          "Approved training records hours and training days only. It does not change levels, skills, funds, inventory or any character sheet. Review your counters and history. NPC/category contributions include your own visible training only; the DM sees complete totals. Subject spacing/case variants group together while descriptions stay intact. The DM can record a manually applied milestone and reset the current counter; lifetime totals stay saved and spent hours are not refunded. Each historical entry retains its original training-day conversion. For training completed earlier, select Record training completed earlier and explain when/where it occurred and the levels then. The DM must explicitly confirm that history; current access and the selected period's remaining hours still apply. A campaign day is 24 elapsed hours, while usable downtime and displayed training days have separate conversions.",
          "Your DM reviews and approves campaign time and downtime. Income, expenses, property work and deliveries advance through that clock, rather than elapsed real-world time. Individual activities may remove a character from the active party until their recorded finish.",
          "Check your own recurring agreements, possessions and work proposals before the next advance. The DM decides when time counts for rest, travel or labour; the app does not impose new game rules or automatic character rewards.",
        ],
        links: [
          ["Time & downtime", "/features/downtime"],
          ["My Finances", "/features/finances"],
          ["Properties", "/features/properties"],
        ],
      },
    ],
  },
  {
    id: "world",
    title: "Maps, people & barter",
    topics: [
      {
        id: "campaign-maps",
        title: "Explore shared maps and records",
        paragraphs: [
          "Maps filters shared Regional, City, Dungeon, Property, Wilderness, Battle, Ship and Other maps by type and shows the party's position and visible markers. Drag to pan, pinch or scroll to zoom, or use the buttons and keyboard controls. Select an icon to inspect its records; the selected icon has a blue fill and ring. Choose another icon to move the highlight, or Close details to clear it. A linked label opens its shared Library entry. Hidden maps, markers and characters are absent from your campaign view.",
          "Party membership and individual locations are controlled by the DM. A departed character does not automatically follow the party. Shared NPC sheets permit reading, while character control remains with its assigned participant.",
          "Your DM can place the party anywhere on a map and describe Roads, Wilderness with a biome, or another travel environment. Located shops and property listings are unavailable while travelling; campaignwide records retain their existing rules. A private travel map keeps its image and coordinates hidden while sharing the travel environment.",
          "Linked locations and entrances open their available local or battle maps inside Maps. Back to map returns to your prior view; each map keeps its camera. The DM may restrict browsing to the active scene. Changing your viewed map does not move your character, travel the party or grant remote access to a shop.",
          "Select a shared record pin to open its place card: its name, where it is, whether the party is there, and the record's own services. Where several records share one point, the card lists them; choose Open in map on a row to open that record's card. On a phone the card is a bottom sheet; the arrow button expands it. Purchases, smith orders, NPC conversation/barter, property storage, post offices, exchanges and ships keep the same permissions, location rules, payments and pending-turn behavior as their original screens. A card for somewhere the party isn't reads Viewing only. Library links remain available. A shop pin changes no stock or prices. Train this NPC uses the existing character-to-NPC request and DM approval, not a new NPC-teaches-player service.",
          "Here (under the map title) lists everything you can use at the party's location: shops and trade, people, and services and property such as post offices, your properties and property for sale. Filter by Shops, People or Services. Each row's button (Shop, Talk, Send, Open, View, Trade) opens the same place card as its pin; the pin button shows it on the map. A closed shop stays listed. While the party travels, Here reads “on the road” and lists nothing. When you browse a map of somewhere the party isn't, Here becomes read only: the names and kinds of that map's shared pins, each marked Visit to …, with no stock, prices or details. Back to where the party is returns to the party's map. Some NPC pins show the NPC's portrait instead of the round icon; they work the same.",
          "An NPC pin opens the conversation directly: Barter, Shop, Services, Talk and Farewell, with number keys 1–5. Farewell returns to the map. Services lists every service that NPC runs: with one it opens straight away, with several you pick one from a short numbered list (Never mind goes back). A locked service says why, for example the DM hasn't enabled it, the shop is closed, the NPC or your character isn't there, or the DM is reviewing downtime. People & NPCs shows the same conversation for an NPC who offers services, even if they don't barter. More about the NPC keeps their description, inventory and messages. An NPC that a player controls keeps its usual interaction.",
          "Shop, NPC, property, property listing and exchange cards have a Map line. Show on map opens the map centred on that record with its card open; with several maps, Choose a map lists them. No map location means there is nothing on a map you can open; a shop page leaves that line out. Copy link to this place (on the card) copies a link you can share in chat; it opens only for people who may see that place, and anyone else sees “That place isn't on a map you can open.”",
          "When the DM starts a mapped encounter and shows it to players, its reviewed grid or theatre presentation is shared. Your camera remains independent. The combat display gives the round and an active token only when that token is revealed to you; private tracker details and loot stay private. Returning to exploration does not itself award loot or advance campaign time.",
          "A shared gridded map shows its combat token layer by default; Enter tile mode / Leave tile mode toggles it outside a DM-directed combat presentation. Tiles default to 5 feet and the displayed scale can differ. The DM can enable movement of your assigned or explicitly delegated, unlocked tokens. Drag them, use arrow keys with the map focused, or enter an exact column/row in Inspector. Other tokens remain under their authorized controllers. Hidden tokens and private encounter statistics stay private. Token placement does not change character control, inventory, boarding or campaign travel time. Pan, zoom and filters remain available in the map workspace.",
        ],
        links: [
          ["Maps", "/maps"],
          ["Shared Library", "/library"],
        ],
      },
      {
        id: "online-tabletop",
        title: "Play remotely on the tabletop",
        paragraphs: [
          "Join with the DM's current invitation and open Maps on your own device. Online play needs no TV, casting device or shared room. The session status in Settings shows your viewed scene, the active player scene, connection status and whether play is view only. Scene access, token control and current transaction turns still apply.",
          "Your camera is independent until the DM explicitly shares a view. You can pan/zoom afterward. Settings → Map library shows the scenes available to you; the DM may direct the active scene or restrict browsing. Select / move opens a token's Inspector, including its shared linked record. Close inspector clears selection. Shift selects a group; Alt + arrows pans. Pan mode lets you drag without moving a token. Measure adds temporary waypoints and uses the map's diagonal rule; with Alternating 5/10/5, every second diagonal step counts double across all waypoints. On a map without a grid, Measure uses the scale bar the DM set. Plan journey (J, in the map tools) lets you sketch a journey. You can also start from the Here sheet (Plan a journey) or from Travel on the Downtime screen (Plan a journey on the map): tap to add waypoints (they snap to nearby places), tap a waypoint to remove it, and read each leg's miles, days and terrain in the list; Type instead and the keyboard (Enter adds at the crosshair, Backspace removes the last) work too. Sketching changes nothing. To ask the DM for a journey, draw it and choose Send to the DM (with an optional message); your request appears under Travel on the Downtime screen (and under Payments in Bank), where you can withdraw it and see the DM's answer. Once the DM approves, the party is on the road: shops and services are unavailable while travelling, the marker moves only when the DM approves downtime, and the chip at the top of the map shows the day, a progress bar and the current terrain (tap it for the leg list). On a shared map you see the planned route where the map is visible to you; on a private map you get a short text card instead, on Maps (even when no map is shared with you) and under Travel on the Downtime screen. When the party arrives, the DM moves it in. If your character commands a docked ship, Ship voyage draws its route on a gridded map and opens your voyage request with the route filled in. If area templates are enabled, place a circle, cone, line or rectangle; this applies no damage or other rules. Close tool options hides the controls while keeping the tool active. Cancel tool or Escape stops the tool.",
          "Maps opens directly across the available desktop or phone page. Your permitted map and camera are remembered for this campaign and participant; guest views stay in memory for the current document. If access changes, Maps uses a permitted scene. Search maps and places (/) focuses accessible records or linked maps. All map settings is grouped, with a search box: This map (your map library and map type), Places & party (the places on this map and the party's position), Players & display, Combat, View (filters, ping color, tool names; each color also has its own shape: red circle, amber square, green triangle, blue diamond, violet star) and Shortcuts & help; it scrolls above the canvas. On phones, scene and camera controls use compact rows, and the tool dock sits along the bottom edge. Swipe the tool row to reach every tool; the collapse button stays visible. Map markers keep full touch targets around smaller symbols. On desktop the map tools form a vertical rail on the right (landscape phones too); phones keep the bottom bar. They provide Pan (V), Select / move (S), Ping (P; its options hold the ping colour), Measure (M), allowed templates (T), Draw & notes (D, personal drawing/text with undo/redo), Plan journey (J), Initiative (I, while the DM shows combat on this map in a shared campaign: the round, whose turn it is, the order of the combatants revealed on the map and your own character's HP; never other characters' or enemies' HP, hidden combatants, conditions or notes), Here (E, with a count), Quests (Q, when a quest you know has something on this map), Layers (L: Show on map filters, Grid display, Quest markers and Quest areas) and Inspector. Tool names show beside the rail on first use until you choose Hide names (Settings › Show tool names brings them back); otherwise hover, keyboard focus or a long-press shows each name and shortcut. Arrow keys move along the rail. Zoom is a pill at the bottom right. Drawing notes are yours on this device, not shared campaign markers. Zoom, Fit map and Center on party or selection change only your camera. Escape closes a panel or cancels a tool. ← Back (upper left; also Backspace, or Alt+↑ from the controls, since Alt+arrows pan on the map itself) opens the parent map when you can see one; the title shows it in front of the map name and opens the map menu for all six main destinations. X Close map (upper right) returns to the screen you came from, or Home. On Android, Back closes an open panel first, then opens the parent map, then closes the map. On phones 340 px wide or less, Map settings is the first item of the title menu. A first visit to a map fits the whole map (phones zoom in to at most 200 %, centred on the party); your saved view wins on return. Hide interface (H), Show interface and phone rotation preserve your camera. Some browsers retain their address bar; Maps does not require native fullscreen permission.",
          "Hidden map pixels, private markers and DM geometry do not arrive behind a removable overlay. When visibility changes, the scene stays concealed and shows “Waiting for the DM’s device to update the map…” until the DM's device publishes the current protected view. Keep the room open and use Retry map artwork or the existing sync/retry controls if connection is interrupted. Each shared map picture downloads once (Loading map artwork… shows meanwhile) and is reused on later updates; guests keep these pictures in memory only. Screen readers announce token moves you can see, pings (with the nearest visible label), the DM activating a scene, and the waiting state. Tokens and area previews change no money, inventory, boarding or travel time. Guest contents and pending actions stay in memory; refresh reconnects only while the invitation remains valid.",
          "Animated PNG/WebP and MP4/WebM map animation starts paused and has play/pause controls. Concealed animated scenes use a still view. Android 1.8.0 and later include these controls.",
        ],
        links: [
          ["Maps", "/maps"],
          ["Room and connection", "/share"],
        ],
      },
      {
        id: "location-npcs",
        title: "Meet nearby NPCs",
        paragraphs: [
          "People & NPCs lists visible people available at your current location. Open their record for shared details or start a private interaction. The DM or an assigned NPC controller responds. NPC visibility, availability and barter permission are campaign settings.",
          "Expand Details & actions under an NPC to read its description and choose View & interact. The NPC name opens its shared Library entry. Find an NPC and Search NPC records remain available above the list.",
          "Dialogue is shared with the interacting character, DM and configured controller. Opening an NPC record does not assign its character sheet or configuration controls to you.",
        ],
        links: [["People & NPCs", "/features/npcs"]],
      },
      {
        id: "barter",
        title: "Offer goods, coins or property deeds",
        paragraphs: [
          "Trading & Barter exchanges existing coins, carried goods and eligible deeds through reviewed offers and counteroffers. The recipient accepts or declines; either participant can cancel. A nearby NPC needs barter permission and consent from its DM/controller. NPC funds are private unless you are its assigned controller; the trade checks them when it is accepted. If the DM turns on Party can see companion NPC funds, a visible NPC travelling with the party shows its coins and coin history read-only to players whose character is in the party. Other party players' balances stay visible to the party; while your character is not with the party (elsewhere or on downtime), you see only your own.",
          "Acceptance checks both sides' funds, ownership, location and current offer before an atomic exchange. Stored, reserved, travelling or service items cannot be offered. Other inventories remain private until included in an offer. Review the accepted history before repeating a trade.",
        ],
        links: [["Trading & Barter", "/features/trading"]],
      },
      {
        id: "npc-barter",
        title: "Barter with an NPC in conversation",
        paragraphs: [
          "Some nearby NPCs answer offers themselves. In People & NPCs choose View & interact, then Barter (press 1, or tap). Add your goods and coins and what you want in the drawer. Each numbered reply says what will happen, for example [PERSUASION · DC 13 · Likely ~70% · Advantage], [Offer · no roll needed] or [Too low · refused without a roll]. The bar shows how fair the NPC finds the deal.",
          "The room rolls your Charisma (Persuasion) check: your sheet's bonus, with advantage at Charisma 16 or more and disadvantage at 8 or less. Sending the same offer again never rolls again. A narrow miss brings a counter-offer you can accept or decline. After a refusal, the same or a worse offer is locked for a while; make it clearly better or wait. Choose [DM decides] to let the Dungeon Master judge the deal instead.",
          "Your conversations stay under NPC conversations on Trading & Barter. The NPC's purse and how it values your goods stay private; the trade checks them when it happens.",
        ],
        links: [
          ["People & NPCs", "/features/npcs"],
          ["Trading & Barter", "/features/trading"],
        ],
      },
      {
        id: "split-party",
        title: "When the party splits into groups",
        paragraphs: [
          "The DM can split the party into groups at different places. Home and Party & inventory show which group you're with, where it is, and where the other groups are (unless the DM hides a group: then it shows as Elsewhere).",
          "You stay in the party: party balances, the treasure pool, fairness and coin splits work as before, and you can still give coins or items to anyone in the party. Shops, services, NPCs nearby and property for sale are the ones where your own group is.",
          "To go somewhere else, open Move your group, choose a place and add a message. Nothing moves until the DM approves; you can withdraw the request while it waits, and you'll see the DM's answer. If your app is older, it asks you to update before acting for a character who is with another group.",
          "On the map each group has its own marker with its letter and colour, and Here lists what your group can use. A journey you plan is for your own group; the other groups stay where they are unless the DM moves them too.",
        ],
        links: [
          ["Party & inventory", "/party"],
          ["Market", "/market"],
        ],
      },
    ],
  },
  {
    id: "sharing",
    title: "Connection, chat & permissions",
    topics: [
      {
        id: "modes",
        title: "Live and Turn-based play",
        paragraphs: [
          "Live play shares permitted changes after the server accepts them. Turn-based play keeps transaction changes pending until Submit changes and end turn commits them. When changes need attention, the status strip offers Retry and Pending changes, which opens Connection & recovery. A confirmed Turn saved to room is a server draft, not committed money or inventory; submit your turn to commit. Offline or unconfirmed work is labeled separately. Chat is independent of transaction turns. Both use an open shared room and a connection.",
          "Offline campaign play belongs to the DM's owned device save. Guests keep campaign data and unsent actions in memory; a reload can lose unsent work. An account membership is a way to resume an authorized seat, not a private offline player campaign. My account opens on Campaigns, where each saved membership has Resume; Characters, Profile, Backups and Support are separate sections, and links to an older My account section open the right one.",
        ],
        links: [["Room & sync", "/share"]],
      },
      {
        id: "notifications",
        title: "Party chat, journals and alerts",
        paragraphs: [
          "Campaign → Chat supports party and permitted private messages. Home → Journal opens visible campaign entries; visibility determines who can read each entry. Campaign → Rolls and Alerts show recorded results and room/message notices.",
          "Browser notifications depend on your device and permission. Supported browsers can enable background new-message web push without message text. This is not email delivery or native Android push.",
        ],
        links: [
          ["Party chat", "/share?chat=1"],
          ["Journal", "/features/journal"],
          ["Alerts", "/share?tab=notifications"],
        ],
      },
      {
        id: "quest-log",
        title: "Your quest log",
        paragraphs: [
          "Home → Quest log lists the quests your DM has shared with you: Active, Done and Failed. Open one to read what you were asked, who asked, the objectives (done ones are crossed out; New marks one added since you last looked), the promised reward and the chronicle of what happened, stamped with the session and campaign day. Only you know this, or You and other names, means only those characters were told; the DM decides who knows.",
          "Follow this quest pins it to the top of your quest log and your Home, with Show on map and Open quest. Following and the Updated marks are kept on this device only. When the DM shares a new quest with you or updates one you can see, a New quest or Quest updated notice says what changed. Talk opens the person who gave it, if they are nearby.",
          "Show on map opens the map's Quests panel on that quest: accent diamonds mark the places and pins the quest points to, and a dashed circle marks a general area to search (the DM may not have centred it on the target). Show all, Only followed or None chooses which quests the map shows; tap a diamond or an area's label to open its quest. You only see what your DM shared and what is not hidden on the map.",
          "My notes are private journal entries only you can read; the DM cannot see them. Rewards are paid by the DM when the quest is done; a linked receipt shows what was paid.",
        ],
        links: [["Quest log", "/features/quests"]],
      },
      {
        id: "find-a-group",
        title: "Find players or a group",
        paragraphs: [
          "Find a group (lootsplitter.com/community) lists community profiles of Dungeon Masters looking for players and players looking for a table. Filter by role, what people are looking for, game, time zone or name. Signed-in members also see members-only profiles.",
          "To appear there, open My account → Profile → Community profile, choose a handle (your profile address is lootsplitter.com/community/your-handle), then choose who can see it: nobody (the default), signed-in Lootsplitter members, or everyone including search engines. Add whether you DM, play or both, your games, time zone, usual play times, a looking-for-group note and, if you want people to message you, your Discord username. The profile also shows your display name, picture and introduction from your member profile; your email addresses are never shown.",
          "Signed-in members can report a profile from its page. Site staff review reports in My account → Administration and can hide a profile; its owner sees a notice and can contact support. Lootsplitter has no private messages between members: arrange games on Discord or wherever you both chat.",
        ],
        links: [
          ["Find a group", "/community"],
          ["Community profile", "/account#account-community"],
        ],
      },
      {
        id: "permissions",
        title: "Assignment and session access",
        paragraphs: [
          "Website Field monitor and the Android home-screen Field monitor (1.8.0 and later) are private to the site owner; player or campaign DM access does not grant it. Its aggregate statistics do not publish private campaign records or turn account activity into a count of concurrent players. Daily monitoring reports, development timers, diagnostics, log registration and the customizable 4×1 companion remain owner-only. Adding an Android widget before sign-in does not grant owner access; it shows a sign-in state until authorized. These features do not change player permissions or reveal private campaign details.",
          "Your room seat controls assigned characters and any expressly permitted party funds. Selecting a sheet does not change those assignments. Full editing and individual field grants come from the DM; they do not transfer ownership of another character.",
          "When the DM closes the room or removes your seat, campaign access ends and saving into that room is blocked. You may leave the room yourself. A room deliberately left online after play permits authorized viewing until play resumes.",
          "There is no limit on how many campaigns you join as a player. The online campaign limit applies only to rooms an account hosts as DM.",
        ],
        links: [
          ["Campaign connection", "/share"],
          ["Account & saved memberships", "/account"],
        ],
      },
    ],
  },
  {
    id: "safety",
    title: "Recovery, appearance & sound",
    topics: [
      {
        id: "recovery",
        title: "Recover a connection or pending action",
        paragraphs: [
          "Check Campaign → Connection & recovery before retrying, leaving or discarding an action. Export pending actions when offered and retain the original campaign and request identity. A lost response does not prove a purchase or trade failed; inspect sync and receipts before trying again. If the room says you are sending changes too quickly, wait a minute and send again; your pending actions are kept.",
          "Use a current invitation to reconnect. If your character is occupied or the room has closed, ask the DM to resolve the seat or provide the new invitation. Do not clear storage as a first recovery step.",
          "In the Android app, if Android restores Lootsplitter from a device backup onto a new phone or a reinstall, your saved data returns but you sign in to your account again.",
        ],
        links: [["Connection & recovery", "/share#connection-recovery"]],
      },
      {
        id: "appearance",
        title: "Theme, reading and audio",
        paragraphs: [
          "Open Settings & Management → Appearance for Light · Adventurer's Ledger or Dark · Ironbound Dragon, reading size, dollar estimates and sound preferences. These device preferences do not change campaign rules or funds. Motion follows your device's reduced-motion setting. Show fantasy backgrounds puts a scene above each screen: the full scene the first time you open a screen on this device, then a short band so the screen's title and main action stay in view (always a short band in split view and with a phone turned sideways).",
          "The title screen appears on a fresh app document; moving between internal menus keeps it dismissed. Sound playback can require a user gesture. Keep device volume and your app sound preferences in mind when using shared play.",
        ],
        links: [["Appearance & sounds", "/?view=home#management"]],
      },
      {
        id: "bugs",
        title: "Report a bug",
        paragraphs: [
          "Sign in to My account → Support → Report a bug (before signing in, Bug reports is below the sign-in form). Describe your action, expected result, actual result, role and play mode. Preview any optional diagnostics before attaching them. Campaign content and files are not automatically included.",
          "Reports and replies are private to you and authorized site staff. Preserve pending work and a recovery copy before an action that replaces or clears device data.",
        ],
        links: [["Report a bug", "/account#bug-reports"]],
      },
      {
        id: "contact-support",
        title: "Contact support",
        paragraphs: [
          `Need help? Email ${SUPPORT_EMAIL}. Use it for questions, feedback or problems you cannot report from My account, such as being unable to sign in. Questions about your campaign's rules, funds or seat go to your DM.`,
          "Describe what you did and what happened. Never send passwords, recovery keys or campaign invitation links.",
        ],
        links: [["Report a bug", "/account#bug-reports"]],
        email: SUPPORT_EMAIL,
      },
    ],
  },
];
