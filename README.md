[Report foundation improvements](docs/audit/2026-10-12-report-followup.md) add authenticated compact unchanged sync reads, less cloning in atomic command batches, reproducible Cloudflare CPU/log policy, clearer time units, complete NPC/category training counters and explicitly reviewed historical bookkeeping. Existing saves, features and permissions remain. The broader UI redesign is a separate next phase.

# Lootsplit

[Hourly downtime and NPC training](docs/DOWNTIME-ACTIVITIES.md) gives each character 16 usable hours per approved downtime day by default. Players allocate training across Martial, Academic or Skill / Profession with a written description; the DM reviews eligibility and records manual milestone resets. Training changes no character sheets, and lifetime hours/days remain saved. The DM configures daily hours and the default 8-hour training-day conversion. Property work shares the resource; ship travel uses no personal hours. The guide also proposes additional tracking activities for a later decision.

Blacksmith shops now support [custom weapon and armor commissions](docs/BLACKSMITH-SERVICES.md): component designs, engravings, player material contributions, DM-configured skill/rarity pricing and quality, approved magical enchantments, NPC service permission and completion through campaign downtime. Finished inventory descriptions retain maker and campaign dates. Existing ordinary shop services and stock remain available.

Encounter initiative stays in roster order while scores are entered or edited. In **Battle tracker**, press **Sort initiative** to arrange scores highest first, with ties stable and blank scores last. **Next turn** follows the saved order; sorting keeps the active combatant and round.

Maps support category filters, dungeon/property/ship layouts, free DM party placement with travel environments and wilderness biomes, configurable combat tiles (5 ft by default), saved encounter roster tokens and mapped ship voyages. Tile movement uses authoritative campaign commands; voyages keep the existing approved downtime clock. See [map and tile guide](docs/MAP-TILES.md).

Lootsplit is a shared party ledger and campaign application for web and Android. Production runs on Cloudflare Workers and D1; GitHub Actions verifies and publishes the exact tested artifact from `main`.

## Tabs and multiple monitors

The app header’s **Tabs & windows** control opens the current screen or another permitted screen in a browser tab or separate window. Move windows between monitors using the operating system. Each window retains its own campaign selection and drafts; saved local changes invalidate other windows and hosted rooms retain the existing authoritative sync/receipts. Child windows keep current permissions and reconnect to the same seat without putting credentials in URLs. A DM window remains private DM UI; use a player invitation in a separate browser profile/device for a player-facing screen. Android retains normal navigation and provides desktop guidance. See [verification and preservation](docs/audit/2026-10-16-multi-window.md).

## Home and feature screens

Player Library offers searchable, read-only item, spell and creature indices without DM import or setup instructions. Lookup pauses during active campaign encounters by default. DMs can disable lookup, limit indices, or allow it during encounters from **Library → Player reference lookup** or **Settings & Management → Players & permissions**. Shared campaign records, handouts and saved sheets remain available. Character selection does not grant control of another assigned character; existing full-editing and individual-field permissions remain unchanged.

**Help** is available in-app and under **Settings & Management → Help**, with a separate guide selected automatically for players. Every feature change must review/update the affected DM and player Help topics, feature inventory and GitHub development instructions before release; see `docs/CODING-MANUAL.md`.

The DM Desk and player Home keep the existing theme and six mobile navigation tabs, including Maps. Open a compact feature card or saved shortcut to use a full feature screen. Bottom navigation still works; **Return to …** goes to the screen that opened it. Desktop also offers direct feature links.

| Screen              | Player access                                                                     | DM access                                                      |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Bank                | Loan applications, repayments and payment requests                                | Loan officer tools, terms and financial approvals              |
| My Finances         | Assigned campaign characters’ funds, debts, recurring agreements and transactions | Use Review Reports                                             |
| Downtime            | No settlement controls                                                            | Plan, review and approve campaign time/settlement              |
| Financial Settings  | No economic controls                                                              | Prices/modifiers and recurring financial agreements            |
| Property Management | Own property name and descriptive notes                                           | Property details, revenue and upkeep                           |
| Review Reports      | Own transactions remain in My Finances                                            | Campaign balances, session reports, activity and price history |
| Review Inbox        | Submit character imports through the existing character workflow                  | Approve/deny character imports                                 |
| Journal             | Existing visibility rules and writing tools                                       | Existing private/shared entries and attachments                |
| Shop Management     | Browse Market                                                                     | Opening schedules and downtime-driven restocking               |

Player Home shows six fixed icon buttons for everyone, including guests: Character Sheet, Bank, My Finances, Properties, Journal and Party chat. There is no player shortcut editor or duplicate feature-card list. The DM Desk now uses six swipeable information panels, grouped campaign tools, and a visible Multiplayer settings button. Previously saved DM shortcuts remain accessible through Dashboard → Saved shortcut settings and can still be saved across devices. Conflicting saves ask for a reload. Existing DM device shortcuts are offered as the initial account configuration; a previously verified campaign owner can still read cached DM destinations offline, but account customization requires connectivity. Existing player preference records remain compatible and are not deleted.

Player Home links to the full Character Sheet, Inventory, Campaign/chat and existing tools. Campaign funds remain separate from standalone account characters. Property descriptions never grant authority to change price, ownership or income. Foreclosures and new special-property purchase rules are not included.

If a character sheet cannot load its campaign roll settings, **Retry character sheet** retries in the same tab while preserving the room connection and pending guest actions. Retry never enables manual rolls without the DM's permission. Save or export drafts before using the **Sheet tools → Reload sheet** control; guests should submit pending actions before refreshing the whole page.

**Deployment requirement:** Migration `0010_account_shortcuts.sql` is additive and was applied to production on October 6, 2026. New installations still require it; the fixed player buttons require no additional migration. No new APK or domain change is included.

## Unified DM home

Campaign control combines the DM Desk and campaign overview. Connection state, encounter status, pending reviews and Multiplayer settings stay visible. Swipe or use named selectors/arrows for Session, Party, Funds, Market, Activity and Rolls; desktop shows several panels together. Session & records and Economy & properties group the feature links. Expand Campaign treasury, Activity & balances, Play sessions, or Campaign tools for totals, transactions, session controls, backups and campaign management. On desktop, Activity & balances retains the full review queue and transaction table. Old `?view=overview` DM links open the same screen; feature screens return to Desk. Player Home is unchanged. The Market information panel shows canonical season/mode, inflation, exchange/quote counts and three commodity quotes with ask/bid, stock/wanted and recorded prior-season changes. It shows city access separately from the DM’s campaign-wide data; links open the exact commodity/exchange or Global market.

## DM shop inventory controls

In **Market → Create a shop**, choose a suggested assortment, a number of item types, or every matching catalog item. Category and rarity filters still apply; **Mixed market** includes all categories. Set quantities independently to suggested units, a fixed amount, or unlimited; services remain unlimited. The preview shows every selected item across pages and saves the entire assortment.

For existing shops, open **Edit → Add from catalog**, search/filter, select individual items or every matching item, and set their quantity. New stock uses the shop’s current wealth/economic pricing; existing custom prices, quantities and items remain intact. Duplicate names are skipped. Custom Add item, stock editing, rates, schedules, restock, trading and complete PDF export remain available. Inventory readouts show item types, finite units, unlimited lines and sold-out lines; search/filter/pages do not truncate saved stock.

The separate offline pass-phone plan remains parked; this shop update does not authorize or implement it. Web/mobile compatibility is checked separately from signed APK publication.

## Continue a campaign on another device

Sign in to the same account, then choose the saved campaign in **My account → My campaigns → Resume**. New shared rooms created while signed in are saved there automatically; a failed account save has a retry that keeps the existing room. **Start a room** creates a separate campaign copy. Copies can have the same name but do not share portraits, loot or later progress. The account page marks the room open on this device and warns before opening an older same-name entry. Existing rooms can still be added with **Save current membership**.

For Live or Turn-based play, the DM must sign in. **Share join link** and each player's **Copy link** grant access only to the current session. **Close room & revoke access** saves the authoritative campaign with the DM and closes access. Alternatively, **End play & keep room online** archives play while players retain view-only sheets and campaign information. Player changes, chat and rolls pause until **Resume play** or the DM starts a named session. The DM can **Leave room online** and return through My account; memberships and current invitations remain valid while the room stays online. Closing a tab or losing a connection does not end a session. Reopening creates a fresh invitation generation. Old links stay invalid. Signed-in players are linked automatically and can resume on another device during the open session. Guests use an in-memory campaign and a tab-scoped reconnect ticket; they must join and be assigned a character again after the room closes. Unsent guest actions are not persisted across reloads. Offline play belongs to the DM; offline player links/files are retired, while old saves and DM activity-report imports remain preserved for recovery.

At startup, choose an account campaign to load its server save. Existing device-only DM campaigns require an explicit **Claim this device’s existing DM campaign** after sign-in; claiming preserves the save. Offline edits stay in the owner's device copy until explicitly backed up or shared online. Do not overwrite a newer account campaign with an older device copy. Multiple campaigns remain separate.

## Character imports, campaign operations and domain preparation

Signed-in players can open **Campaign → Room → Import an account character** after joining, select a saved sheet and their assigned character, and submit it for review. **Characters → DM character & roll controls → Character import requests** lets the DM inspect and approve or deny it. Submission changes no campaign stats. Approval preserves campaign money/items, rechecks current access/session and rejects a changed sheet; refresh or resubmit after denial. Existing assigned profiles remain supported. Importing from the character editor also uses DM approval for players.

DMs can open **Settings & Management → Economy → Shop schedules & properties**, or the same section on the campaign overview. Shop calendars use campaign days (day 0 starts each repeating cycle); approved downtime advances time. Restocking tops finite stock up to the configured quantity, preserving surplus and unlimited stock. Manual shop Open/Close disables its schedule. Saving a schedule starts its next restocking interval from the current campaign day.

Add an owned property in **Funds & inventory**, then configure its revenue/upkeep in **Shop schedules & property management**. The amounts apply to the whole holding per period. These are ordinary campaign finance schedules: preview them with loans and other expenses, then explicitly approve downtime when starting the next session. Partial periods and unpaid upkeep persist; changing a period with carried days is refused. Pause/update agreements before selling/transferring their source. A property plan reuses its existing linked recurring schedules. Multiple linked schedules of the same type require review in the recurring schedule editor before using the combined plan. Unrelated schedules remain unchanged.

The homepage includes real screenshots with synthetic data and a browser/Android comparison. Web and APK release schedules remain separate; this work does not publish a new APK.

**Settings → Prepare for a future website address change** shows sync/private-document considerations and guides use of existing backups. No domain migration is active. See [domain preparation and activation gates](docs/plans/DOMAIN-READINESS.md) and run `npm run migration:check` when editing addresses. [Economy modes and tax rules](docs/plans/ECONOMY-MODES-AND-TAXES.md) are proposals awaiting approval, not active gameplay settings.

## Start here for every coding session

Read [AGENTS.project.md](AGENTS.project.md), then the [Coding session manual](docs/CODING-MANUAL.md). After a timeout or interruption, also read [Recovery](docs/RECOVERY.md) and reconcile the repository, running jobs and live release before repeating an action.

The manual applies to human developers and future coding assistants. Repository instructions survive replacement of a chat or workspace. Automated commands enforce selected checks; the documents are not a guarantee that every assistant will obey them.

## Performance regression log — required during every full audit

Record any measured test, function, deployment, action or audit that takes **15% or above longer than the last logged comparable duration**, including exactly 15%. Faster runs and increases below 15% are not logged and do not change the reference. CI timings are checked automatically in this repository's persistent [performance regression log](https://github.com/UnregisteredMusket/Lootsplit/blob/performance-history/PERFORMANCE-REGRESSIONS.md). Local measurements must be recorded and committed using the [performance history procedure](docs/PERFORMANCE.md).

**Every full audit must fetch and analyze this log**, review new and unresolved slowdowns, check comparison validity and recorder freshness, and report before/after duration, added time, percentage increase, evidence, cause and follow-up action. Repeated rises in the logged threshold are a performance trend requiring investigation. Report the original reference → latest logged duration, cumulative added time and percentage increase, number of increases, affected operations, and whether total workflow time also worsened. Preserve every qualifying entry so an increasing threshold cannot hide the accumulated slowdown. Preserve the history for future analysis; do not treat an unavailable or stale log as a pass.

After an issue is confirmed resolved by a successful comparable verification, close its trend and reset the reference to the verified post-fix duration. Preserve the old log and link the fix/verification evidence. A faster run alone must never reset a trend; use the [verified resolution procedure](docs/PERFORMANCE.md#resolve-a-confirmed-issue-and-reset-the-trend).

## Development commands

Use Node 22 (`nvm use`, or the included development container).

| Command                                          | Purpose                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `npm run dev:doctor`                             | Check the Node version, installed Playwright and browser launch without changing files |
| `npm run dev:setup`                              | Install locked dependencies when changed, install a browser when needed, verify launch |
| `npm run verify:focus -- dm-resume`              | Check two-device DM reopening with disposable data                                     |
| `npm run verify:focus -- accounts`               | Run every account scenario in a disposable source snapshot                             |
| `npm run verify:quick`                           | Unit tests, type checking and lint                                                     |
| `npm run verify:report -- PATH/TO/html`          | Open the account HTML report, including failure screenshots and traces                 |
| `npm run verify:trace -- PATH/TO/trace.zip`      | Inspect a single saved browser trace locally                                           |
| `npm run verify:timings`                         | Summarize recorded verification durations                                              |
| `npm run performance:sync`                       | Read GitHub timing history and collect a local snapshot without publishing             |
| `npm run performance:record -- measurement.json` | Record a measured local operation for inclusion in the task's GitHub commit            |
| `npm run performance:resolve -- resolution.json` | Record a verified resolution and reset request while preserving the previous trend     |
| `npm run recover:status`                         | Inspect saved checkpoints and remote release state                                     |

Focused scenario names: `network-boundary`, `ownership`, `layout`, `library`, `dm-resume`, `resume-queue`, `recovery`, `portrait-resume`, `campaign-choice`, `invitations`, `shared-recovery`; use `accounts` for all eleven. Focused checks include current uncommitted source edits and exclude local databases, secrets and browser profiles. They do not deploy or replace the running development server.

[Development and CI details](docs/DEVELOPMENT.md) · [Feature preservation inventory](docs/FEATURE-INVENTORY.md) · [Android releases](ANDROID.md)

## Faster development without changing the application

Account scenarios run on two Playwright workers with independent accounts, rooms, storage and client identities. Every scenario remains required; retries stay disabled. Focused checks still isolate their server and database, and complete PR/main checks still gate publication.

For recurring aggregate timeouts, follow "Prevent repeated account-suite timeouts" in the coding manual: diagnose the worker timeline and resource-interception overhead, retain the 60s/170s limits, and verify native/fallback network isolation. Interrupted chats resume persisted checkpoints; they do not restart completed releases.

The existing `.devcontainer/devcontainer.json` provides Node22 and runs the locked dependency/browser setup. Use that container where supported, or `nvm use` then `npm run dev:setup`. `dev:doctor` reports the actual Chromium version and path; a custom browser launching successfully does not prove it supports every PDF/import feature. Do not substitute an older browser for release verification.

After a failed focused run, use its printed diagnostics path: `npm run verify:report -- test-results/focused/TIMESTAMP-accounts/html`. Read the failing action, network activity and trace before rerunning. CI account reports are in `test-results/account/html` inside the existing audit artifacts. Reports contain disposable test credentials; keep them in the existing restricted diagnostic artifacts.

Property storage, projects, staff, rentals, delivery and postal management are documented in [Property operations](docs/PROPERTY-OPERATIONS.md), with a [sample import](docs/examples/property-operations.sample.json) and [strict schema](docs/examples/property-operations.schema.json).

Maps, location NPCs, bilateral barter, black-market vendors and session time: [field guide](docs/WORLD-FEATURES.md), [NPC import example](docs/examples/location-npcs.sample.json). Local focused UI check: `CHROMIUM_EXECUTABLE_PATH=/path/to/chromium node scripts/world-local-check.mjs`; complete release verification remains required.

Ships and private shipyards are managed inside Property Management, using existing custody, staff, projects and reviewed downtime. DMs can start with **New property listing → Property operations template → Create from preset · Owned ship**, review/save the template, then save the retained listing draft separately. Saved templates and the full estate workshop remain available. See [the ship guide](docs/SHIPS.md) for setup, 5e-style physical stats, costs, voyages and the DM teleport override. New features require both role Help and developer-manual review.

Map icons show the selected record or combat token with a blue fill and ring. Selection follows record details and the DM token selector; campaign map data and player visibility remain unchanged.

The October 13 current-layout improvements retain the existing navigation, themes, searchable selectors and campaign commands. Player Home opens the exact assigned sheet; Sheet tools groups export/reload; the shared strip links directly to pending recovery; DM readouts and phone selectors wrap more clearly; downtime groups training fields and displays the captured-period hour budget. See [preservation audit](docs/audit/2026-10-13-current-layout.md).


### TV and player display (October 16, 2026)

DMs can open Player display from the header, Maps or the current campaign encounter. A separate window/tab shows only an explicitly projected shared map, selected combatants and optional confirmed loot awards. Fullscreen, rotation, fit/zoom/pan and measured tile-pixel calibration support TVs and map cases. HDMI/extended desktop uses OS window placement; wireless use relies on the browser’s Cast tab support. This adds no public receiver link or remote seat. The viewer mounts no campaign/account providers, clears copied session credentials, receives only strict-schema presentation frames in memory and clears on blanking/controller loss. Secret notes, DM-only map records, unrevealed combatants and unawarded loot are excluded. Awards still use the existing atomic transaction and receipt. Player Help and DM Help cover the distinct workflows. Native Android navigation, all six main tabs and prior maps/encounters/loot remain. Verification extends the complete development/immutable Worker map audit rather than replacing original scenarios; see `docs/audit/2026-10-16-multi-window.md`.
