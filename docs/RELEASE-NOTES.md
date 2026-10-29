# Lootsplitter 1.14.1

Android version code **22**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data. A patch for the site owner's home-screen widget; nothing else in the app changes.

## Added

- None in this release.

## Improved

- **Widget Sign in opens the Connect screen** (site owners only). SIGN IN, the footer, the status block and the "Not connected" row on the Field monitor (and the companion's sign-in lines) open My account → Home-screen Field monitor, where Connect widget connects it in one tap; when the app is signed out, My account asks you to sign in first and then opens that screen. Up to 1.14.0 they opened My account without reaching the widget controls.
- **Why it disconnected** (site owners only). The widget records why its connection last ended (Disconnected in app, Owner access rejected, Encryption key reset, App sign-out ended an older connection, Connection did not finish) and when. A disconnected widget says "Not connected — tap Sign in · <reason> · <time>", My account → Home-screen Field monitor shows "Last disconnected: …", and tapping Refresh while disconnected says "Not connected — tap Sign in" instead of implying a reading is on its way.

## Fixed

- **Removing widgets no longer disconnects the owner widget** (site owners only; owner report 2026-10-29). Up to 1.14.0, removing the last Field monitor and companion from the home screen deleted the widget's stored owner session, so widgets added afterwards showed "No current owner reading · Sign in or tap Refresh" and "OWNER · SIGN IN" although the server session was still valid. Now removing every widget keeps the encrypted connection and only pauses background checks; adding a widget again restarts them and fetches a reading at once when the last one is no longer current. Only Disconnect widget (which also revokes the session on the server), a 401/403 from the server or an unusable encryption key ends the connection. Every widget route still requires the owner role on the server.
- An app sign-out while the phone's secure storage was momentarily busy could remove the widget's own session; it is now kept (a widget still holding an older app token ends on its next server check).

## After updating

If the widget currently shows SIGN IN, tap it (or open My account → Home-screen Field monitor) and choose Connect widget once. From then on, removing and re-adding widgets keeps it connected.

## Release verification

Pending: published by `android-release.yml` (started by the owner), then independently inspected before `release.json` is updated.

---

# Lootsplitter 1.14.0

Android version code **21**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Quest log** (#290, #294, #304). DMs write quests in Quests with a giver, a place, objectives, a promised reward and private DM notes, then reveal them to the whole party or to chosen characters; hidden objectives, DM notes and DM-only chronicle lines never reach players' devices. Objectives can be marked done or failed, chronicle entries are stamped with the session and campaign day, and quests close as completed or failed. Rewards are words plus links to receipts already paid; writing or closing a quest never moves coins or items. Players get Home → Quest log (Active, Done, Failed, a Follow pin, private notes saved under the character who knows the quest, a Quest updated notice and a New quest toast when the DM shares one while the app is open). View as player shows the DM exactly what a chosen character receives, and quests appear on the Desk, on NPC cards and in the map's Here sheet. Removing a campaign from the device also clears its quest follow and updated marks. The quest log's map stage (pins and radius areas) is not in this release.
- **Quests on the map** (#331). DMs can tie a quest or any objective to a place, an existing map pin, or a radius area drawn on a map ("Harkon's horse is somewhere in here"), drawn, dragged or typed in the map's own units and placed off the real target if the DM wants only a general idea. The map's Quests tool lists that map's quests (Show all, Only followed, None) and highlights and zooms to one; Show on map in the quest log opens the map on that quest; Layers can hide quest markers or areas. Players see accent diamonds and dashed circles only for what the DM shared: links to DM-only or fogged pins and areas for hidden objectives never reach players' devices.
- **Session chip, "Since last session" and Pin to Desk** (#322). The DM's header shows "Session 12 · day 42" and opens End & start next, Session Time and a summary of loot awarded, money in and out, requests waiting and characters away since the last session (also on the Desk once a session has ended). Pin to Desk adds a feature screen to the Desk's Pinned row; during an encounter the Desk's party cards have −1 / +1 hit-point buttons, saved through the sheet's own save so a stale sheet is refused; Help leads Settings & Management.
- **Map controls redesign** (#295, #301, #306, #312, #313, #318, #324). ← Back opens the parent map (also Backspace) and X Close map returns to the screen Maps was opened from; a map opened for the first time shows the whole map and the chrome follows the app theme and fonts. On computers and tablets the tools stand in a rail on the right (Move, Play, Table, View, with Here and Plan journey beside everything else), with a Layers panel, a zoom pill and new shortcuts (D, J, E, L, I); phones keep the bottom bar. DMs place the party, markers, entrances, records and location links from a setup rail on the left, each with a small panel beside the map (entrances can pick their arrival view), and fog, walls, lights, the combat token, grid & scale and the inspector moved into the same rail, so the More map tools button is gone; Ctrl+Z / Ctrl+Shift+Z undo and redo fog. All map settings is grouped (This map, Places & party, Players & display, Exploration, Combat, View, Shortcuts & help) with a search box and a group index. An Initiative panel (press I) shows the round, turn order and hit points; players read a revealed-only projection with their own character's hit points. A Quests slot is reserved in the rail for the quest log's map stage.
- **Command palette and shortcuts** (#315). A header search button (or Ctrl/⌘K) finds any screen, character, NPC, shop, place, map or item and opens jobs such as Add loot, Award loot, End session, Advance 8 h and New quest in their usual form; nothing happens until confirmed there. ? lists the shortcuts (/ to search, g then d, p, m, k, l to jump). Players only find what their own screens already show. On narrow screens Tabs & windows moves into Settings & Management → Appearance.
- **SRD values for imported items** (#283). Unpriced equipment on an imported character sheet is matched offline against SRD 5.1 and 5.2 equipment and magic items, preferring the sheet's edition; unlisted magic items use the SRD 5.2.1 rarity value, halved for potions, scrolls and ammunition. The import review lists every value found and every item without a match, values already entered are kept, sheets show each item's value, and Fill missing values from the SRD prices earlier imports.
- **Duplicate shop, encounter and NPC** (#332). Duplicate shop makes "<name> (copy)" with the same settings and stock; Duplicate on a saved encounter makes a fresh draft with the same combatants and loot at round 1; Duplicate NPC opens a new NPC form filled from the original with no coins or items.
- **View receipt and Undo** (#327). Purchases, sales, transfers, Add loot and encounter awards confirm with View receipt (the recorded lines and the created item, linked in the inventory). A DM's shop purchase offers Undo while the toast is on screen; it uses the existing ledger void, so coins, stock and items come back exactly once, and it refuses if the items have since moved.

## Improved

- **One header style and a shorter scene banner** (#325). Party, Market, Encounters and the feature screens share one header (section label, title, main action, ⋯ menu; Market's leads DMs to Trade Exchanges and Shop schedules). With fantasy backgrounds on, the full scene greets the first visit to a screen on this device, then a 72 px band; split view and phone landscape always use the band.
- **Bigger tap targets** (#321). Checkboxes are 24 px with a 44 px row; each Party character card's field permissions open in a Permissions… sheet (the Settings fold keeps the full list); the toast close button and small inline links get larger tap targets.
- **Android shell** (#323). Back closes an open picker, ⋯ menu, sheet or dialog first, then a map panel, and only then goes to the previous screen; on the first screen with a campaign open it shows "Press back again to exit" and a second press within 2 seconds closes the app. Status-bar icons turn dark on the light themes.
- **Phone landscape rail and title screen** (#326). In phone landscape the section tabs become a 56 px icon rail on the left and the header hides while scrolling down. The title screen says "Tap to continue" on touch screens and "Continue · <campaign> · Session N" for the last campaign opened on the device; the Campaigns dialog lists the others by last opened, with time and session.
- **Desk tiles** (#311). Session, Party, Funds, Market, Activity and Rolls as a 3×2 grid on a computer and a swipe strip with dots on a phone; the Session tile names the session with End & start next at the top; new campaigns get a "Set up your campaign" checklist whose steps tick themselves; empty readouts point to a next step.
- **Review Inbox** (#296). One queue by age with type chips, who asked, what it does, the amount and the balance afterwards; Approve (gold) and Deny… (outlined, with remembered reasons); decided requests stay in place as a short note linked to their record; Approve all payments under an amount after one confirmation, each charged once; A/D/J/K keys; the Desk tab counts waiting requests.
- **Loot review** (#293, #282). Finished encounters show on the Desk as Ready for loot review and count in Pending reviews; Encounters opens the only active battle or review directly; one short row per item with value in gold (250 or 2 gp 5 sp); tick several items to assign or pool them; a bottom bar keeps the total and Transfer loot in view (loot is still transferred once); the last coin recipient is offered next time; the One purse coin option reads in one column again.
- **Party inventory** (#298, #300). One list with record rows (holder, quantity, value, ⋯ menu: Edit, Give, Move to pool, Sell to shop, Remove), grouping by holder or category, filters, search and bulk give/pool/remove where each item is its own action and Resume finishes an interrupted run without repeating anything; editing uses Save. Players see their coins and Give under Combined wealth, identical items as one row and an Equipped chip; the party screen is "Party & inventory", tabs no longer wrap, the pool's count sits in its tab, unclaimed items say No claims yet, Claim all as Pass marks only unanswered items, and Fairness explains when no loot has been handed out.
- **Market and shop counter** (#297). Market starts with Shops here and a short exchange summary (the device remembers whether it is open); a shop page starts with its name, keeper and place, an Open/Closed switch for DMs and Counter / Edit tabs; a sticky Paying from bar remembers who last paid at each shop and only the row being changed shows cost and balance; Sell to a character sells each item with one tap; shop editing has labels and one Save changes bar; modern dollar estimates are labelled "≈ $… modern", off by default for players.
- **Encounter tracker and Session Time** (#329). A bottom bar keeps ◀ Prev, the round, whose turn it is and Next turn ▶ in reach on phones; combatants show their side (◆ ally, ✕ enemy) and the instructions sit behind ?; Session Time offers +1 h, +4 h, Long rest · 8 h and Next morning, which fill the form for review.
- **Money inputs** (#316). Copper fields in finances, trade exchanges, ships, the blacksmith and property operations echo the amount in gold and accept coins such as 2 gp 5 sp; gold of 1,000 or more is grouped (15,727 gp); copper stays the saved amount.
- **Themed confirmations and Danger zone** (#288). Discard and delete questions open in the app's own style (Keep editing / Discard changes; deletions named in red), work on phones, in the Android app, in split view and over other dialogs, and Escape or Back cancels; a mismatched campaign code says so; Delete current campaign lives in a Danger zone fold. Fields that save on blur show a Saved tick (#327).
- **Guest join and Home landing** (#328). A join link finds the room's characters at once, the join card asks only for character and name (remembered), errors show under the field, recovery and backup tools fold until joined, and players land on Home with a Getting started strip; Campaign shows the room's mode to players.
- **Campaign name for players** (#309). The join card, header, Campaign screen, tab title and My account memberships show the DM's campaign name instead of "Party overview"; an unnamed campaign shows as "Shared campaign" with its room code.
- **Remembered filters and one Disclosure** (#332, #317). Review Inbox's type filter and the inventory's Holder, Category and Equipped filters are remembered per campaign on the device; folds on Downtime, Party, Market and shop pages share one chevron, row height and focus ring.
- **Glossary renames and Help guide switch** (#319, #280). The DM home is the Desk on the page too, Shop Management is Shop schedules, Downtime is Time & downtime; old links still work. Help has a "Guide for: Players | Dungeon Masters" switch (and `?guide=player` links); in the app it still starts on the guide for your seat.
- **My account in sections** (#310). Campaigns, Characters, Profile, Backups and Support as tabs, Campaigns first with Resume leading each saved campaign; older section links still work; play-only accounts no longer see hosting counts or the DM encounters card; sign-in errors appear under the form and clear on switching between Sign in and Create account.
- **Accessibility** (#285, #291). Skip to content on the first Tab; one Settings & Management navigation stop; Add loot and shop edit label every field; sheet tabs announce as tabs with arrow-key movement; "Item to sell" picker name and readable Market quotes; gain, loss and "Open for trading" colours meet 4.5:1 in every theme; chat history and shop totals are keyboard-reachable and new messages are announced; underlined inline links.
- **Field monitor on the web** (#314, #278, site owners only). Field monitor is its own My account section (/account#field-monitor) on the website and in the app, with the widget's summary at the top (status word, ✕ ! i counts that open Diagnostics filtered, Needs attention, Recently resolved, a 24-hour traffic chart and plan-usage gauges), Copy diagnostics without email addresses, tokens or join codes, and "Last refresh failed" with Retry. Diagnostics has All / Critical / Warning / Info filters.
- **Legible widgets and widget settings preview** (#278, #281, site owners only). Widget text is at least 10 sp and follows Android's font size instead of being cut off (larger sizes drop the "since" line and pace note and show only Diagnostics and History on an expanded item); the ✕ ! i counts open the filtered Diagnostics; the settings screen shows a live preview, names each choice in words, opens on the saved preset, applies a preset on pick, keeps Save widget at the bottom and moves extra app actions into ⋮; the Widgets list shows a sample healthy preview instead of "SIGN IN REQUIRED".
- Design tokens for breakpoints and the type scale (#320); the only visible change is at viewport widths of 640–650 px.

## Fixed

- **Owner widget session** (#334, site owners only). The home-screen Field monitor widget holds its own one-year owner session instead of borrowing the app's sign-in, so signing out of or back in to the app (or the website) no longer leaves it on "Sign in". Connect owner account mints the session (rotating any previous one), Disconnect widget revokes it, and every widget read and the session route require an active owner session: members, admins, moderators and signed-out callers get 401/403, and losing the owner role clears the widget on its next read. Widgets connected by 1.13.0 keep working until the app's session ends; reconnect once after updating to move them to the new session.
- **Large campaigns save online** (#299). A DM edit sends only the part of the campaign it changed instead of the whole journal twice, pending device edits shrink the same way when the campaign next opens, location, shop and other artwork is stored beside the campaign online (like map images) so it no longer counts toward the online size limit, and edits to unrelated parts from two devices no longer conflict.
- **Speak to NPC after a refresh** (#279). Players who open an NPC from a link or refresh the NPC page speak as their own character again instead of being refused for trying to answer as the NPC.
- **Human check after a recovery reset** (#276). The sign-in form reloads the human check whenever it switches between sign in, create account and recovery, so a recovery-key password reset no longer ends in "Complete the human check" until reload.
- Initiative review follow-ups and the themed-confirm stacking check (#324, #303).

## Not in this release

- Website-only changes (home page joining steps and area carousel, promo video poster, phone screenshots, changelog folding, Find a group empty state, the 404 page and direct My account links: #277, #284, #286, #287, #289, #292, #307) and CI/audit-only changes (#272–#275, #302, #305, #308, #330) do not affect the app.


## Release verification

Published October 28, 2026 by `android-release.yml` (run 40707361833, started by the owner) from main `055851e`, after the full preservation checks, the API 24 and API 35 widget and picker checks, and the signed-APK upgrade gate passed.

Independent inspection of the public APK, downloaded through the GitHub API:
- SHA-256 `5d01de7f31e1bd259bd04b98dc8f490d6e852e3abdb9be61869687c6f5dde752` (32,888,166 bytes), matching SHA256SUMS.txt and the GitHub asset digest.
- Its v2 signing block carries the permanent certificate (`baca95a8…f730a0`, unchanged from 1.13.0).
- The manifest keeps package `com.unregisteredmusket.lootsplit`, with versionName 1.14.0 and versionCode 21.
- The bundled app contains the owner widget's own session (`owner/monitor/widget-session`) and the native `sessionToken` method (#334).

---

# Lootsplitter 1.13.0

Android version code **20**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Split the party** (#266, #267, #268). The DM can split the party into up to six groups (letters A–F, each with a colour) at different places, choose who goes with each group, and merge groups that meet again. Everyone stays in the party: balances, companion funds, the treasure pool, Fairness and coin splits are shared as before. Shops, services, nearby NPCs and property for sale follow each character's own group. The Groups panel moves a group, edits groups, hides a group's place from other players and merges groups. On the map each group has its own marker and Here list; each group can have one journey, one approval can move every group the DM ticks, arriving groups are moved in with Move <group> here, a stable's coach carries the paying character's group, and a whole group can board a ship together. Players see which group they're with and where the others are, and can ask the DM to move their group from the Review Inbox. Apps older than 1.13.0 ask to update before acting for a character outside the main group; nothing is lost meanwhile.
- **Fairness ledger** (#257). Party → Fairness adds up the coins and items each party character has received, campaign to date or for one session, with the difference from the party average and the receipts behind each total. Coin splits, encounter awards and treasure-pool items count; purchases, trades, Give, wages, loans and downtime don't. Older encounter items without a recorded value count as 0 cp and are marked. When resolving the treasure pool, the DM can choose Favour whoever is behind.
- **Fences, banks, hirelings and tailors** (#256). A fence opens their shop's Sell tab while the black market is open, a bank opens Apply for a loan with the bank named, an agent can propose a staff contract for one of the party's properties, and a Tailor preset makes clothes over approved downtime (bringing your own cloth costs less).
- **Sages identify items** (#259). Pick an item your character carries and ask; nothing is charged until the DM answers, then the fee is charged once and the answer arrives in your private thread with the sage. The answer can be added to the item's notes and the item renamed.
- **Paid lessons from trainers** (#261). Agree terms in conversation (nothing is charged then), log sessions in Downtime → Learn from a paid teacher, and each session's fee is charged once when the DM approves it. Lessons count in training totals.
- **Courier letters** (#262). Send a letter to an NPC your character has met who is somewhere the courier delivers, priced by distance and paid once. It travels with approved downtime and arrives in your private thread with that NPC; if the recipient can't be found, the DM decides.
- **Stables and coaches** (#263). Book stalls for your animals by the night, with optional feed, paid once up front; the animals stay in your inventory. A coach booking sends a journey request with the fare, charged once when the DM approves departure.

## Improved

- **Journey planner is easier to find** (#258). Plan journey is a labelled button under Here on the map (it stays when the tool bar is collapsed); the Here sheet offers Plan a journey and Journey progress, and the Downtime screen starts with Travel. On phones the map stays visible above the planner and the journey review opens full height. Journey progress shows a bar with leg marks, Undo removes the last waypoint, and optional costs show their price before you turn them on.
- **Online campaign limit** (#260). Each account can host up to 2 online campaigns at a time. Start a room and My account show the count (for example "1 of 2 online campaigns"); at the limit, Create room, Reopen as DM and Restore shared records explain how to free a slot or keep playing on the device. Joining as a player, device campaigns and account backups are not limited, and nothing already hosted is closed.
- New encounter awards record each item's value on its ledger line (#257).
- **Owner Field monitor widget** (#270, site owners only). The home-screen Field monitor is redesigned: severity labels (✕ CRIT, ! WARN, i INFO) with start time and duration, Recently resolved for the last 24 hours, At a glance tiles with traffic, plan-usage, main-run and player charts, and tap-to-expand items and tiles (with a 24h/7d traffic toggle) that never download anything. It can be resized down to 4×2, and the 4×1 companion has an optional Status + charts preset with a Chart column setting; Agent activity stays the default and every earlier row stays under More.

## Fixed

- **Owner widget connect** (#265, site owners only). Connect owner account keeps the new connection when the first reading times out, shows "Could not refresh · tap Refresh to retry" and retries in the background; only an authorization rejection or a changed account clears it. The widget's read limit is 4 s (7 s total).

## Not in this release

- Server-side widget changes (#264 faster monitor answers, #269 the redesign's data) are already live and also help 1.12.0.
- Website-only, CI-only and documentation changes do not affect the app.

## Release verification

Published October 25, 2026 by `android-release.yml` (run 40204536132, first attempt) from main `4c2afe9`, after the full preservation checks, the API 24 and API 35 widget and picker checks, and the signed-APK upgrade gate passed.

Independent inspection of the public APK, downloaded through the GitHub API:
- SHA-256 `7658a56c243da707201c547e974d451542a80595f7646b148a083e425d36fb2a` (32,127,153 bytes), matching the workflow's signed-APK output, SHA256SUMS.txt and the GitHub asset digest.
- Its v2 signing block carries the permanent certificate (`baca95a8…f730a0`, unchanged from 1.12.0).
- The manifest keeps package `com.unregisteredmusket.lootsplit`, with versionName 1.13.0 and versionCode 20.

---

# Lootsplitter 1.12.0

Android version code **19**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Party journeys** (#243). Plan a route on the map, then Review journey turns it into a downtime preview: pace, each day of travel, and optional trail rations and mount upkeep (off by default, charged once on approval). The DM chooses Approve & depart; while the party is on the road the route is locked and located shops are unavailable, the marker moves only when downtime is approved, and on arrival the DM confirms Move party here or Not yet. Players can send journey requests, which the DM approves from the Review Inbox; players see the route where the map is visible to them, or a text card when it is private.
- **Services in NPC conversations** (#247). Services lists every service an NPC runs and explains why one is unavailable (shop closed, NPC or character not there, not switched on). People & NPCs shows the conversation for NPCs who offer services even if they don't barter. Blacksmith commissions are unchanged.
- **Temples** (#249). Healing, curse removal and raising the dead, with SRD 5.2.1 / SRD 5.1 presets or DM prices. Raise Dead and Resurrection go to the DM first and are charged only on approval. Higher-level spells need a town or city.
- **Workshop commissions** (#250). Spell scrolls from scribes and potions from alchemists, paid once at order, advanced by approved downtime and collected at the workshop. The DM can pause, resume or cancel with a reason.
- **Inns** (#251). Rooms and meals for the party, paid once up front, and rumours delivered to the buyer's private thread with the innkeeper.
- **Community profile** (#240). My account → Community profile sets up a profile for the Find a group directory on lootsplitter.com: handle, role, games, time zone, play times, optional Discord username and visibility (Nobody by default). Email addresses are never shown. The directory itself is a website page.

## Improved

- Downtime shows blacksmith and workshop work together under Commissions; Market's Service commission register tracks orders while travelling (#250).
- Temples, workshops and inns appear on the map's Here sheet and on place cards (#249–#251).

## Fixed

- Treasure pool Activity keeps claims and resolutions in order when they share a timestamp (#246).

## Not in this release

- The Cloudflare human check (#241, #248) applies to website sign-up, sign-in and recovery reset only; the app is exempt and unchanged.
- Website-only changes (#242, #244, #253) and documentation (#252) do not affect the app.

## Release verification

Published October 23, 2026 by `android-release.yml` (run 40031758182, first attempt) from main `b4edf5e`, after the full preservation checks, the API 24 and API 35 widget and picker checks, and the signed-APK upgrade gate passed.

Independent inspection of the public APK, downloaded through the GitHub API:
- SHA-256 `7362855ecdfa9db1442c501b583f6eee6c940b9407e5f65f7745e917d58017b1` (32,010,479 bytes), matching the workflow's signed-APK output, SHA256SUMS.txt and the GitHub asset digest.
- Its v2 signing block carries the permanent certificate (`baca95a8…f730a0`, unchanged from 1.11.0).
- The manifest keeps package `com.unregisteredmusket.lootsplit`, with versionName 1.12.0 and versionCode 19.

---

# Lootsplitter 1.11.0

Android version code **18**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **New app icon and splash screen.** The Lootsplitter kobold clutching a gold coin (the owner's brand set, `docs/brand/`). The adaptive icon has a navy background and a monochrome layer for Android 13+ themed icons; the legacy and round icons and the pre-Android-12 splash use the same mark. The in-app title animation is unchanged.
- **Even coin split** (#230). Split a party fund or an encounter's coins between party members in one step; leftover copper goes to the party fund by default.
- **Map place hub** (#228, #232). Pins open place cards, records have Show on map, DMs can Place on map and use portrait pins, and the Here sheet lists what is available at the party's location.
- **Map tools** (#211). Consolidate fog, the alternating 5/10/5 diagonal rule.
- **Journey planner** (#235). Draw a route on a map for leg distances, travel days and terrain; send a drawn route to a ship voyage request; calibrate a scale bar on maps without a grid.
- **Party treasure pool and item claims** (#238). Players mark Need, Greed or Pass; the DM resolves items from the Review Inbox. This merged before the 1.11.0 build commit and ships in its APK; it was added to these notes with 1.12.0.

## Improved

- Shared map images are sent as references and cached on the device (tabletop protocol 4, #209).
- Players see when the DM's device is still updating the map; screen readers announce token moves, pings and scene changes (#211).
- Website links in the app use lootsplitter.com (#214).

## Fixed

- None in this release.

## Release verification

Published October 23, 2026 by `android-release.yml` (run 39948775805) from main `ca6fbb3`, after the full preservation checks, the API 24 and API 35 widget and picker checks, and the signed-APK upgrade gate passed. Two earlier attempts stopped before publishing: one on a widget-test clock race (fixed in #236), and one because main advanced during the run.

Independent inspection of the public APK:
- SHA-256 `add727d131fcc2031d89fdf13cae57caa3a8ec2784fd9291981e6daf09f22970` (31,945,666 bytes), matching SHA256SUMS.txt and the GitHub asset digest.
- Its v2 signing block carries the permanent certificate (`baca95a8…f730a0`, unchanged from 1.10.0).
- The manifest keeps package `com.unregisteredmusket.lootsplit`, with versionName 1.11.0 and versionCode 18.

---

# Lootsplitter 1.10.0

Android version code **17**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Lootsplit is now Lootsplitter.** The app, the website, the home-screen widgets and Help use the new name. It is the same app with the same data: this update installs over the existing app, and your campaigns, characters, settings, account sign-in and placed widgets carry over unchanged.

## Improved

- Help explains the new name. Backups and campaign copies saved under the old name still import, and the website address is unchanged for now.
- Website pages, browser tab titles, notifications and the installed web app use the Lootsplitter name.

## Fixed

- The installed web app (Add to home screen) is now named Lootsplitter instead of a generic placeholder name.

## Release verification

Published October 22, 2026 by `android-release.yml` (run 39859111167) from main `f548d7e` after full preservation checks, the API 24/API 35 widget and picker checks and the signed-APK upgrade gate passed. The public APK's SHA-256 is `83f5841e550ced47196e6467d9a1a0827c217712e0457a7147334d25df0cf456` (28,152,525 bytes), matching SHA256SUMS.txt and the GitHub asset digest. Independent inspection of its v2 signing block confirms the permanent certificate (`baca95a8…f730a0`, unchanged from 1.9.3); the manifest keeps package `com.unregisteredmusket.lootsplit` and carries version 1.10.0 and the Lootsplitter label. The first attempt (run 39802895414) stopped in the upgrade gate before publishing, because the widget-picker audit searched for the new name while the installed 1.9.3 app is still named Lootsplit; #205 fixed the audit. On October 22, 2026 the owner installed the published 1.10.0 APK over 1.9.3 on a physical Android phone and confirmed it works.

---

# Lootsplit 1.9.3

Android version code **16**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Split view on tablets.** On a tablet in landscape (at least 1024 pixels wide), open two screens side by side in one window, for example your character sheet beside the map. Turning the tablet to portrait shows one screen; the second comes back when you turn it again.
- **Barter with NPCs in conversation.** Make an offer to a nearby NPC that allows bartering and get a reply or a counter-offer. A Persuasion roll against a difficulty set by how fair the deal is decides the answer; the DM chooses whether they decide each offer themselves or let the game roll.
- **Companion NPC funds (DM setting).** Party can see companion NPC funds, off by default, lets players whose character is in the party see the coins of visible NPCs travelling with them. Hidden NPCs stay hidden.
- **Set up operations.** DMs can repair an estate property that was bought without its operating record. Nothing is charged and the deed is unchanged.
- **Expandable widget rows (owner Field monitor).** Tap a log row to expand it and read its full title and text, tap again to collapse it, or press OPEN to go to the matching screen in the app. Expanded rows stay open when the widget refreshes.
- **Cloudflare plan usage on the large widget (owner).** Rows for Worker requests, CPU time and database reads and writes: today, the last 7 days and the billing cycle so far, which renews on the 11th of each month (for example “Cycle since Oct 11”). A reading Cloudflare did not return says unavailable, never zero.

## Improved

- When an action fails, the app now tells you and keeps what you entered, instead of looking as if it worked. Retrying never applies the same payment, gift or purchase twice.
- Offline (device) campaigns now buy, sell, give and buy listings exactly like shared rooms.
- Clearer widget status: a problem that has already stopped shows as attention, not failure, and the Multiplayer check is a real test round trip that never appears in your campaigns.
- A healthy widget reading turns amber after 35 minutes instead of 2, matching the background refresh, and widget sync counts only phones seen in the last 7 days.
- Campaigns with long session history keep saving, and restored campaigns keep all their history.
- Shared rooms refresh less when nothing has changed.

## Fixed

- **Privacy:** players no longer receive NPC or exchange treasury balances, and only players whose character is in the party see other party members’ balances.
- The widget stays connected through a temporary storage error on the phone (“Widget storage busy · tap Refresh to retry”) and finishes each refresh within its time limit.
- Android backups no longer carry your account sign-in to a new phone or a reinstall; you sign in again there. Campaigns and settings are still backed up.
- Finance actions in offline campaigns that have a blacksmith no longer fail.
- Buying an imported estate listing keeps its property details, and storage accepts exact fits such as three 0.1 lb items in 0.3 lb.
- Party chat keeps what you type right after opening a room, and sends while your character is still loading.
- Property imports no longer report unchanged data as changed, item weights no longer show long decimals, and rolls made on the device are labeled DEVICE ROLL.

## Release verification

Published October 22, 2026 by `android-release.yml` (run 39768391571) from main `3666624` after full preservation checks, the API 24/API 35 widget and picker checks and the signed-APK upgrade gate passed. The public APK's SHA-256 is `cb93516b3db776f34cace4d3ead2d0029663f6ecd3668babf315859dd882b031` (28,149,033 bytes), matching SHA256SUMS.txt and the GitHub asset digest. Independent inspection of its v2 signing block confirms the permanent certificate (`baca95a8…f730a0`, unchanged from 1.9.2). The first two attempts stopped before signing on CI infrastructure (a slow Playwright browser install that timed out three jobs, then a dev-server connection reset in one account scenario); only failed jobs were re-run and nothing was published from them. Physical-device behavior has not been verified.

---

# Lootsplit 1.9.2

Android version code **15**, same package and permanent signing certificate. Install over the existing app; do not uninstall or clear saved data.

## Added

- **Agent activity** preset for the 4×1 companion: the latest GitHub development activity (workflow runs, pull requests, merges and deploys) with ✓ ! ✕ symbols and ages. While a workflow runs and the screen is on it refreshes about every minute without waking the device; otherwise the usual ~30-minute schedule applies. It shows GitHub activity only, not the development chat.
- New coin-and-quill app icon and splash screen, including a monochrome themed-icon layer.

## Improved

- Field monitor widget redesign: status symbol and one-line reason, four stat tiles (— means unavailable), a task card with its timer, and a log ordered with attention items first.
- 4×1 companion redesign with matching symbols, tinted icon actions and 44dp touch targets.
- Agent activity is the default for new companions; existing companions keep their saved settings and all earlier presets remain.
- The widget face no longer shows your email.

## Fixed

- Removed the companion’s stray “?” status.
- Unavailable GitHub activity states its reason (rate limited, denied, timed out, not connected).

## Release verification

Published October 21, 2026 by `android-release.yml` from main `0932e34` after full preservation checks, the API 24/API 35 widget and picker checks and the signed-APK upgrade gate passed. The public APK's SHA-256 is `3d782a1ac574899347025d925f4f4f6a3b54681a68376b48ab539c989c510ce3`, matching SHA256SUMS.txt. Independent inspection of its v2 signing block confirms the permanent certificate (`baca95a8…f730a0`, unchanged from 1.9.1). Two earlier attempts stopped before signing on an emulator launcher timing issue in the picker audit, which was fixed in #142; nothing was published from them. Physical-device behavior has not been verified.

---

# Lootsplit 1.9.1

Android version code **14**, same package and permanent signing certificate.

## Added

- None in this release.

## Improved

- Add the 4×1 companion with its default Development preset, then choose summaries, actions and theme from Settings.
- Place either widget before connecting owner access; private readings still require authorization.
- Refresh widget list safely reannounces both types and reports Android’s detection state.

## Fixed

- Prevents the companion identity row from shifting outside its bounds on high-density displays.
- Provider-list recovery after APK updates and first launch preserves existing widget IDs, settings and campaign data.
- Release verification now includes both real picker entries, companion binding/configuration, and the actual signed upgrade and Add path without My account.

## Release verification

Published October 21, 2026 after API 24/API 35, complete PR/main preservation checks and the signed-APK upgrade gate passed. The public APK matches the signing artifact and checksum; independent inspection confirms the permanent certificate, package, version 1.9.1/code 14 and both widget providers. See [signed release evidence](audit/android-widget-picker-release-evidence.json). The exact cause on the reported physical launcher has not been confirmed; emulator evidence and the defensive recovery behavior must not be presented as physical-device verification. Install over the existing signed app; do not uninstall or clear saved data. See [picker investigation](audit/2026-10-21-widget-picker.md).

---

# Lootsplit 1.9.0

Android version code **13**. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added

- Private backend monitoring every 30 minutes, independent of phone connectivity, with persistent history, comparisons, recovery evidence and daily reports at 00:10 America/New_York by default.
- A central registry includes existing and future designated logs in daily reporting; missing sources appear as coverage gaps.
- Shared development tasks, persistent elapsed and recorded timing, workflow telemetry, component diagnostics and explained progress warnings.
- A separate customizable 4×1 companion widget with Development, Server Health, Analytics and Quick Actions presets, per-instance summaries/actions and appearance settings.

## Improved

- The main Android widget has a supported scrolling collection with task, diagnostic, log and report links. The matching website and Android account dashboard has bounded scrolling, history search/filters, exports and full daily reports.
- Both widget types use the same encrypted owner authorization and shared dated snapshot, reject older updates and refresh all instances together when data arrives.
- Light/dark/terminal appearance, readable status labels and native elapsed timers accompany the website's reduced-motion-aware warnings and transitions.
- Lootsplit's existing campaign layout, gameplay, accounts, saves, themes and permanent signing identity remain.

## Fixed

- Retains direct home-screen refresh without visiting My account; genuine access denial clears private information and opens a working sign-in route.
- Keeps confirmed component failures visible when their source disconnects, preserves incomplete observations during historical recovery, and carries unresolved incidents into subsequent daily reports.
- Prevents analytics-label clipping in the main widget's fixed header.

## Release verification

Published October 20, 2026 after all nine preservation groups, API24/API35 framework instrumentation, native lint and permanent-key signing passed. The public APK, checksum and extracted signing artifact independently match; v2 signature and the original certificate are verified. See [release evidence](audit/android-monitoring-release-evidence.json). The website manifest follow-up publishes this verified download and corrects GitHub immutable-subject authorization; its deployment status is recorded in the follow-up PR. Android background delivery remains subject to OS and launcher restrictions; backend collection runs independently. Continuous custom widget animation is unsupported, so static status and native timers are intentional. Physical OEM launcher, prolonged Doze, reboot delivery and large-font checks require separate device validation. Raw runtime-log ingestion and end-to-end scheduled multiplayer checks are explicit coverage gaps until connected, never fabricated healthy results. Install over the permanently signed app; do not uninstall it.

---

# Lootsplit 1.8.1

Android version code **12**. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added

- None in this release.

## Improved

- The last dated Field monitor reading stays visible while a check runs or temporarily fails.
- Repeated taps share one check; a bounded timeout releases the widget and shows how to retry.

## Fixed

- Home-screen Refresh starts its check directly without opening My account or reconnecting the owner account.
- My account’s Refresh widget waits for a completed check and reports failures accurately.
- Late requests cannot replace another account or undo a sign-out. Rejected owner access still clears private readings.

## Verification

All eight native cases passed on API24/API35, including actual widget-button, timeout and owner-isolation checks; complete PR/main preservation gates passed. Signed workflow 39475576975 published 1.8.1. Independent inspection verifies the permanent certificate, APK-v2 integrity, package/version and matching public/checksum/artifact bytes. The website metadata follow-up retains its complete PR/main and streamed-download gates. Physical-device installation is not claimed. Install over the permanently signed app; do not uninstall it.

---

# Lootsplit 1.8.0

Android version code **11**. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added

- Owner-only Android home-screen Field monitor in the approved green terminal style, with compact/full sizes, real account identity, service checks, app/game totals and recent GitHub development/deployment metadata.
- My account controls to connect, request launcher placement, refresh and disconnect the widget.
- This APK also packages the current Maps workspace, protected media/fog, connected scenes and encounter handoff already verified on the website.

## Improved

- Readings are dated; Android requests periodic checks about every 30 minutes, subject to power/network restrictions. Manual refresh is available. Provider metadata may be five minutes old.
- Encrypted, backup-excluded widget credentials and snapshots; stale response isolation and immediate device sign-out clearing.
- Lootsplit’s existing themes, campaign data, owner/staff controls and all game features remain. Reference screenshots are not bundled.

## Fixed

- Includes the verified narrow-phone/landscape Maps toolbar and camera containment fixes since Android 1.7.0.
- Missing analytics remain unavailable or not connected, never fabricated zeros. Cloudflare traffic requires the separately configured server-only analytics connection.

## Verification

Native API24/API35 compilation/instrumentation, desktop/mobile account controls and complete PR/main preservation passed. Independent inspection verifies the permanent signing certificate, APK v2 integrity, package/version, widget components and published checksum. The website publication gate verifies the matching download bytes. See `docs/audit/android-widget-release-evidence.json` for the signed artifact. Physical-device installation is not claimed here. Install over the permanently signed app; do not uninstall it.

---

# Lootsplit 1.7.0

Android version code 10. This release retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added features

- The Android bundle includes the current website's map grids/routes, property operations, commodity exchanges, bilateral barter, blacksmith commissions and local reference OCR.
- NPC training uses approved hourly downtime budgets, DM review, complete NPC/category totals and manual milestone resets with lifetime history.

## Improvements

- Compact authenticated unchanged reads retain fresh access and encounter policy without repeatedly transferring/hydrating campaign media. Manual refresh and old clients retain complete snapshots.
- Atomic command batches share one working copy while validating every action and retaining exact financial receipts.
- Character away actions support elapsed campaign hours. Calendar days, usable downtime and displayed training days are explicitly distinguished.
- Cloudflare CPU/log settings travel with the verified artifact and are checked after deployment. Full browser audits are redistributed across existing groups without weaker gates or longer deadlines.

## Bug fixes

- Late bookkeeping can use explicit DM confirmation of historical conditions while enforcing current access and original period budgets.
- Subject spacing/case variants group without rewriting original requests; category totals combine teachers while player totals remain scoped to their contributions.
- Documentation now reflects implemented OCR, six navigation tabs and map tiles. Failure email uses the production secret scope and reports configuration honestly.

## Verification

PR #105 all-nine verification 38303829968 and independent main 38305743510 passed. Signed release 38305743849 passed its own all-nine verification and published Android 1.7.0/code10 from main 2b4abca6. The actual APK manifest, permanent certificate and v2 signed-data/content integrity were independently checked; SHA256 matches the published GitHub asset digest. See `docs/audit/report-android-release-evidence.json`. Website download metadata is updated through the separately verified release follow-up. Physical-device installation, file-picker and force-close remain untested. The broader UI redesign follows this functional release.

---

# Lootsplit 1.6.0 candidate

Android version code 9. This candidate retains package `com.unregisteredmusket.lootsplit` and the permanent signing certificate.

## Added features

- End session & keep room online lets players retain their assigned sheets and permitted campaign information between sessions.
- After ending play, the DM can Leave room online and return through My account.

## Improvements

- Player gameplay, chat, campaign-sheet changes, imports and rolls pause until the DM resumes play.
- Resume play or starting a named session restores play. The existing End session still closes access completely.
- Preserves current account-resume recovery, saves, privacy, guest memory-only storage and the permanent Android package/signing identity.

## Bug fixes

- None in this release.

## Candidate verification

Full PR/main preservation checks and the signed Android workflow must pass. Verify the published APK certificate, version/code and checksum before updating the website download metadata. The public download remains 1.5.1 until the new signed APK and checksum exist. Physical-device installation, file-picker and force-close behavior require separate validation.

---

# Lootsplit 1.5.1 candidate

Android version code 8. This candidate retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates. The public download remains 1.5.0 until the new signed APK and checksum exist.

## Added features

- Account-scoped device recovery copies can be exported when older queued changes belong to another seat or conflict with the saved campaign.

## Improvements

- Sync recovery distinguishes unsynced Live changes from unfinished turn actions.
- The startup campaign selector shows campaign IDs so separate saves with the same name can be identified.
- Pending device work remains exportable from account/startup screens even before a campaign opens successfully.

## Bug fixes

- Account campaign resume reconciles server acknowledgements before classifying device queues, removing the false unfinished-turn blocker for already accepted Live actions.
- Genuine unsynced actions and server-saved turn drafts remain accessible in Multiplayer recovery, with command and retry IDs preserved.
- Changed-seat device actions are kept separately and are never automatically replayed with another seat's permissions.

## Candidate verification

The unchanged complete preservation suite validates unit tests, type checking, lint, shared web/mobile builds, development desktop/mobile flows, packaged Worker and standby behavior. Signed publication requires the permanent certificate check. Website live commit/asset audits and the verified APK/checksum download follow publication; a merge alone does not prove release success. Production campaigns are never used as destructive fixtures.

---

# Lootsplit 1.5.0 candidate

Android version code 7. This candidate retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates of permanently signed installations.

## Added features

- DMs can create suggested, chosen-count or all-matching shop assortments, including mixed markets, with independently selected stock quantities.
- Existing shops support bulk catalog selection, fixed or unlimited quantities, stock summaries, search, filters and paginated shelves.
- Player Home provides six fixed service buttons for Character Sheet, Bank, My Finances, Properties, Journal and Party chat.
- Includes DM-reviewed character imports, campaign-day shop schedules and restocking, and property income and upkeep plans.

## Improvements

- DM Desk and campaign overview share one Campaign control screen with five swipeable information panels, grouped tools and visible Multiplayer settings.
- Dedicated Bank, finance, property, downtime and report screens separate player services from DM approvals and administration.
- Bulk additions preserve existing custom prices and stock; pagination preserves complete saved inventories and PDF exports.
- Brings the bundled Android client up to date with the verified website while retaining the package, permanent certificate, existing saves and supported play modes.

## Bug fixes

- Removes small automatic assortment limits that excluded eligible catalog items from shops.
- Saved DM shortcut destinations wait for account preferences instead of exposing incorrect defaults while loading.
- The DM Review Inbox no longer includes a misplaced payment-request composer, and duplicate multiplayer entries are removed from the DM overview.

## Candidate verification

Full exact-head PR/main preservation checks and the signed Android workflow must pass before publication. Verify the APK version, package, permanent certificate and checksum, then advance the website download metadata and verify its deployed download and changelog. The public download remains 1.4.0 until the new signed APK and checksum exist. Real-device upgrade, file-picker and force-close checks remain separate from automated verification.

No new gameplay rules, offline pass-phone implementation, database migration, domain activation or signing-key change is included. Previously released APKs and changelog entries remain available.

---

# Lootsplit 1.4.0

Android version code 6. This release retains package `com.unregisteredmusket.lootsplit` and the existing permanent signing certificate for in-place updates of permanently signed installations.

## Added features

- Animated opening scene with a loot-hauling adventurer, coin-collecting rogue, and reduced-motion support.
- Adventurer’s Ledger light theme and Ironbound Dragon dark theme, plus Pen & Paper and Virtual roll modes.
- Optional CC0 coin, loot and page-turn sound effects, with device volume and preview controls; automatic sounds default off.
- Account-owned DM campaigns with explicit End session, expiring invitations and guest play without persistent campaign storage.
- Party Add loot supports Open5e search and custom items; scanned character/statblock imports offer local OCR and review.

## Improvements

- Brings the bundled Android interface up to date with the verified website, retaining existing campaigns, exports and permanent signing identity.
- DMs can resume saved campaigns across devices, reopen ended sessions, and control character editing and granular player permissions.
- Clearer room selection, automatic membership linking and pending-upload feedback help prevent duplicate rooms and unsaved portraits.
- Includes updated journal, encounter, loot, notification and owner testing controls.

## Bug fixes

- Internal navigation no longer restarts the title screen when opening account, journal or ledger pages.
- Shared player invitations point to the intended room and character and ask before switching an existing session.
- Imported characters remain selected when older list requests finish, and filled PDF fields preserve supported values for review.
- Character assignment, Live updates and inventory awards retain authorization and duplicate-award protections.

## Verification

PR #44 and main preservation checks passed. Signed Android workflow 37391400899 passed after a targeted rerun of the import-audit timing race documented in docs/RECOVERY.md. The downloaded APK independently confirms version 1.4.0, code 6, package com.unregisteredmusket.lootsplit and the existing permanent certificate. SHA-256: `355baf1eca0c734e705006203eac300d4339558093506ad6f3a97c9477c507e0`, matching SHA256SUMS.txt and the GitHub asset digest. Real-device upgrade, file-picker and force-close checks are not represented as automated verification.

Published October 5, 2026 (America/New_York). [Download Android 1.4.0](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.4.0/Lootsplit-1.4.0.apk) · [Checksums](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.4.0/SHA256SUMS.txt). Website download metadata is advanced by the publication follow-up; verify its live deployment before treating website publication as complete.

---

# Lootsplit 1.3.2

Android version code 5. This release retains the existing package identity and permanent signing certificate and updates permanently signed 1.3.x installations in place.

- Brings the current DM/Player interface, responsive desktop layout, settings panels, encounters, manual gameplay and loot review into the bundled Android client.
- Connects party readouts and character sheets to one character state; wallet and inventory updates retain permission and duplicate-award checks.
- Fixes older sheet edits discarding advanced character data or bypassing DM read-only protection.
- Retains imported levels and skill/save/initiative bonuses; local rolls use the displayed character values.
- Fixes stale characters and permission errors when switching local campaigns.
- Allows HP saves with existing long inventory names, notes and IDs without changing those items.
- Preserves item metadata and every queued offline transfer; report replay cannot award the same transfer again.
- Keeps current mobile formatting and desktop space usage unchanged.

## Verification

See `docs/audit/2026-10-02-bug-fixes.md` for sequential before/after evidence and release gates. Real-device upgrade, file-picker and force-close checks remain separate from automated verification.

## Published — October 2, 2026

[Download Android 1.3.2](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.2/Lootsplit-1.3.2.apk) · [Checksums](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.2/SHA256SUMS.txt) · [Website changelog](https://lootsplit.oliverstorie2017.workers.dev/updates)

Signed release run 37091668595 passed from main commit `1f0da5a`: 396 passing tests, four existing skips, typecheck, lint, web/mobile builds, browser recovery and responsive checks, built Worker checks, Android compilation and permanent-certificate verification. The downloaded APK independently confirms version 1.3.2, code 5, the existing package identity and permanent certificate. SHA-256: `47c78585b88f11752c803df76dc2b5c8151a1fd1bcd08e47aa0954fccc458d01`, matching the published checksum and GitHub asset digest. The owner successfully installed the test candidate. Device file-picker and force-close behavior have not been independently retested here.

Every future Android release must include a website changelog with added features, improvements and summarized fixes. Earlier release entries remain available.

---

# Lootsplit 1.3.1

- Retains all campaign, finance, PDF, reference, multiplayer and appearance features.
- Adds an explicit invitation choice when already connected, with a backup before switching rooms.
- Android exports offer Save file (a persistent location chosen by you) alongside Share.
- Clarifies device-backup recovery and browser-only background push.
- Records explicit transaction types and structured price history for new events, retaining older saves.
- Includes the Greyhaven default party on first initialization; existing campaigns are unchanged.
- Adds release test gates, permanent-certificate verification and APK checksums.

## Install

Download Lootsplit-1.3.1.apk. It updates the permanently signed 1.3.0 app in place. Export a backup before updating. Old debug-signed copies require a one-time backup, uninstall, reinstall and restore; never uninstall before verifying the exported backup.

## Preservation and verification

Local device copies are not external backups. Use Save file and keep the file outside app storage. Importing a backup into the backup list lets you check it without replacing your campaign. Real-device file-picker, force-close recovery and background-delivery behavior still require device validation; automated tests do not substitute for that.

## Published and verified — 2026-10-02

[Download Android 1.3.1](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.1/Lootsplit-1.3.1.apk) · [Checksums](https://github.com/UnregisteredMusket/Lootsplit/releases/download/android-v1.3.1/SHA256SUMS.txt) · [Live web app](https://lootsplit.oliverstorie2017.workers.dev)

Signed release run 36976200449 passed all gates from main commit `549b96f`: 351 passing tests, four legacy-document skips, typecheck, both builds, browser recovery/responsive checks, Android compilation and permanent-certificate verification. The downloaded APK independently confirms version 1.3.1, code 4 and the permanent certificate. Its SHA-256 is `afd1cbeb9a377c10e77a839a161c8f670dfe2acecb703c0846003d4a4db6e088`, matching the published checksum and GitHub asset digest. Cloudflare successfully deployed the same source; the live UI displays 1.3.1. See AUDIT-IMPROVEMENTS.md for release evidence, rollback references and the outstanding device checks.
