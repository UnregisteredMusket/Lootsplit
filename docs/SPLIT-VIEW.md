# Split view

Owner-approved feature (mockups: desktop player Character sheet + Market, the Open beside menu, and an Android tablet in landscape with Maps 60% + Encounters for the DM). Two screens show side by side in **one window**. It complements, and does not replace, Tabs & windows (separate tabs/windows/monitors) and Player display (TV).

## What users get

- Available when the viewport is at least **1024 px** wide: desktop web, and Android tablets in landscape (the Capacitor app uses the same web bundle). Below that there are no split controls; if a split window narrows, only the left pane shows and the right one returns when there is room again.
- Header **Layout** group (`Single screen` / `Split view`, `aria-pressed`) and, on a single screen, **Open beside** (menu: main screens, your/campaign tools, the last-used screen marked, and *Open in a separate window…* which opens the existing Tabs & windows dialog for that screen).
- Each pane has a header: a screen menu (same list), **Swap panes**, **Show this pane full width** (temporary, not persisted) and **Close this pane**. Closing the left pane keeps the right screen as the single screen.
- Divider: drag (snaps to 40/50/60%), keyboard (`role="separator"`, arrows ±5%, Shift ±1%, Home/End limits, Enter 50/50), double-click resets to 50/50. Each pane keeps at least 380 px.
- Focus: clicking or tabbing into a pane focuses it (outlined); F6 / Shift+F6 move between panes. Panes are landmarks labelled “Left pane: …” / “Right pane: …”. The tab title names the focused pane's screen.
- The rail becomes a compact icon rail in split view; **Expand menu** shows the full rail (all main destinations, tools, settings, website link) as an overlay. Rail destinations open in the focused pane; a destination open in the right pane is announced as “(open in right pane)”.

## Screens available in a pane

Exactly the role-filtered list of Tabs & windows (`paneScreens` in `src/lib/quire/split-view.ts`): Home/DM Desk, Character sheet, Inventory/Party, Market, Library, Maps, Encounters (DM), Campaign chat (`/share?tab=chat`) and every `/features/<slug>` the seat may open (DM-only features only for the DM; *My Finances* stays out of the DM list as before). Navigation inside a pane can reach any in-app screen (shops, books, catalog…); public website and account pages open in the main (left) pane instead.

## Architecture

- **Left pane** = the window's normal TanStack router and URL. Its page renders the single app frame (`Shell` → `WindowShell`: rail, header, dialogs, back-button and crash listeners) exactly once.
- **Right pane** = the same route tree in a **second router instance with memory history** (`createPaneRouter` in `src/components/split-view.tsx`). It is rendered by `SplitViewProvider`, which sits inside all app providers (Auth, campaign gate, library, prefs, economy, player display), through a React portal into a detached element that the current frame's right-pane slot adopts. So the right pane survives left-pane navigation (each route renders its own frame) and shares every provider, store and the cloud client with the left pane.
- `PaneContext` tells components which pane they are in. In the right pane the root route renders only `<Outlet />` (no `<html>`, head, scripts or providers again) and `Shell` renders `PaneShell` (content, screen-specific sync status and Library search only). Window dialogs (campaign, role, Settings & Management) are borrowed from the frame through `registerActions`.
- On a single screen every split wrapper is `display: contents`, and the element tree is identical in both modes, so toggling split view never remounts the left screen or loses its drafts.
- Pane bodies use `contain: layout paint`, so route-sized screens that use `position: fixed` (the Maps workspace, route loading) fill their pane instead of the window. Maps measures its pane height for `--map-usable-height`.
- The pane router is created without scroll restoration and with `scrollToTopSelectors` for its own scroll element; it does not replace `window.__TSR_ROUTER__`. The main router resets the left pane's scroll element on navigation.

### Shared state, no duplication

- One React tree, one set of providers: `EconomyProvider`, the cloud client, chat, seat, prefs and library are module or provider singletons; nothing is instantiated per pane. Sync loops, polling, notifications, member activity, menu audio, player display and crash watchers live at the root or in the window frame, not in panes.
- Commands are unchanged: a purchase in the right pane runs the same authoritative command (revision check, idempotent command ID) once; the sheet in the left pane re-reads because the shared economy state changed.
- The browser audit counts API requests during an idle period with one screen and with two panes to catch duplicated polling, and asserts the purse and stock change by exactly one purchase.

## URL and persistence

- `?beside=<path>` on the window URL reflects the right pane (deep links and reload restore it). A root search middleware (`retainBeside`) keeps it across left-pane navigation; explicitly setting `beside: undefined` closes the pane. Updates to it use `replace`, no scroll reset and skip draft blockers (a draft guard also ignores `beside`-only changes).
- Values are sanitized (`sanitizePaneHref`): same-origin app paths only, no public/account pages, no invitation/seat/token/callback parameters, no nested `beside`, and DM-only screens are rejected for player seats. Return links (`safeReturn`) and new windows never carry `beside`.
- Old URLs without `beside` open a single screen exactly as before. The device remembers the divider ratio, last screen beside and recent screens in `localStorage` (`lootsplit.split-view.v1`, every access wrapped in try/catch); the layout toggle uses them. Guests are unaffected: no campaign data is stored.

## Privacy and authorization

A pane never shows more than the seat could open by itself: menus are role-filtered, `beside` is sanitized against the current role, a role change re-sanitizes and closes a DM-only pane, and every screen keeps its own checks. Server-side authorization is unchanged. A DM split window is still a DM window — use Player display for a TV.

## Development rules

- Never render window chrome, global dialogs, listeners or providers inside a pane; check `usePane()` instead.
- Components that navigate must use the router from context (`Link`, `AppLink`, `useNavigate`); writing `window.location`/`history` directly would move the window, not the pane.
- A screen with drafts uses `useDraftGuard`, which already protects pane close/swap/replace.
- Verification: `src/lib/quire/split-view.test.ts` (layout state, URL parse/serialize, availability, min widths, role filter, middleware) and `scripts/split-view-browser-audit.mjs` (CI group `desktop`, step `dev-split-view`).
