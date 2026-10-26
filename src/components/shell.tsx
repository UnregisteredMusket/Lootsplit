import { ShellMapActions } from "./shell-map-actions";
import { FeatureCards } from "./feature-navigation";
import { WorkspaceWindows } from "./workspace-windows";
import { SubmenuBackdrop } from "./submenu-backdrop";
import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import {
  afterContextChange,
  allowContextChange,
  confirmContextChange,
} from "@/lib/quire/use-draft-guard";
import { dismissDialog } from "@/lib/quire/confirm-store";
import { runBackHandlers } from "@/lib/mobile/back-handlers";
import { rememberScreen } from "@/lib/quire/map-navigation";
import { useChatUnread } from "@/lib/quire/use-chat-unread";
import { useReviewCount } from "@/lib/quire/use-review-count";
import { ManagementPanel, CampaignPanel } from "./control-panel/settings";
import { getCampaigns, subscribeCampaigns, serverCampaigns } from "@/lib/quire/campaigns";
import { SyncStatus } from "./sync-status";
import {
  SplitHeaderControls,
  SplitWorkspace,
  paneFrameClass,
  usePane,
  useSplitView,
} from "./split-view";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { getCloudWatch } from "@/lib/quire/cloud-turn";
import { useLibrary } from "@/lib/quire/library";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { setSeat } from "@/lib/quire/table";
import { BillReceipt } from "@/components/bill-receipt";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { SeatSwitch } from "@/components/seat-switch";
import { Confirm, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadSeatLock } from "@/lib/quire/lock";
import { getOnline, subscribeOnline } from "@/lib/mobile/online";
import { watchCrashes } from "@/lib/quire/reports";
import { isEphemeralCampaign } from "@/lib/quire/guest-storage";

type Dest =
  | "/maps"
  | "/encounters"
  | "/characters"
  | "/library"
  | "/account"
  | "/welcome"
  | "/downloads"
  | "/"
  | "/market"
  | "/catalog"
  | "/party"
  | "/books"
  | "/share"
  | "/settings";

type ShellProps = {
  children: ReactNode;
  width?: "wide" | "prose";
};

/** One app frame per window; a screen in the right split-view pane renders content only. */
export function Shell(props: ShellProps) {
  const pane = usePane();
  if (pane?.side === "secondary") return <PaneShell {...props} />;
  return <WindowShell {...props} />;
}

function WindowShell({ children, width = "wide" }: ShellProps) {
  const testRoom = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const { job } = useLibrary();
  const seat = useSeat();
  const { count: unreadCount } = useChatUnread();
  // Review Inbox count on the DM's Desk tab (design Q13).
  const reviewCount = useReviewCount(seat.role === "dm");
  const seatKnown = useSeatKnown();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const search = useRouterState({ select: (state) => state.location.search });
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => rememberScreen(pathname, href), [pathname, href]);
  const split = useSplitView();
  const splitOn = split.open;
  const [railOpen, setRailOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [management, setManagement] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const campaignName =
    campaigns.campaigns.find((c) => c.id === campaigns.activeId)?.name || "Campaign";
  const overlayRef = useRef(false);
  overlayRef.current = management || campaignOpen;
  const [blocked, setBlocked] = useState<string | null>(null);

  const destinationHash = useRouterState({ select: (state) => state.location.hash });
  useEffect(() => {
    if (destinationHash === "management") setManagement(true);
  }, [destinationHash]);
  useEffect(() => watchCrashes(), []);
  useEffect(() => {
    if (import.meta.env.VITE_MOBILE !== "true") return;
    let remove = () => {};
    let live = true;
    void import("@capacitor/app").then(({ App }) => {
      void App.addListener("backButton", ({ canGoBack }) => {
        if (dismissDialog()) return; // A themed confirmation or prompt cancels first.
        if (overlayRef.current) {
          setManagement(false);
          setCampaignOpen(false);
          return;
        }
        const close = document.querySelector<HTMLButtonElement>(
          '[role="dialog"] button[aria-label="Close"]',
        );
        if (close) {
          close.click();
          return;
        }
        // A screen's own interceptor (the map: panel, then parent map, then close the map).
        if (runBackHandlers()) return;
        const back = () => {
          if (canGoBack) window.history.back();
          else void App.exitApp();
        };
        if (allowContextChange(back)) back();
      }).then((handle) => {
        if (!live) {
          void handle.remove();
          return;
        }
        remove = () => void handle.remove();
      });
    });
    void import("@capacitor/status-bar")
      .then(({ StatusBar }) => StatusBar.setOverlaysWebView({ overlay: true }))
      .catch(() => undefined);
    return () => {
      live = false;
      remove();
    };
  }, []);

  // The right pane borrows this frame's campaign, role and settings dialogs.
  useEffect(() => {
    split.registerActions({
      openCampaign: () => {
        afterContextChange(() => setCampaignOpen(true));
      },
      changeRole: () => void requestRoleChange(),
      openManagement: () => setManagement(true),
    });
    return () => split.registerActions(null);
  });
  useEffect(() => {
    if (!splitOn) setRailOpen(false);
  }, [splitOn]);

  const inBooks =
    pathname === "/books" || pathname.startsWith("/book/") || pathname.startsWith("/read/");
  const tradingWorkspace = ["/market", "/features/economy", "/features/trading"].includes(pathname);
  const dm = seat.role === "dm";
  const secondaryUrl =
    splitOn && split.secondaryHref ? new URL(split.secondaryHref, "https://lootsplit.invalid") : null;

  return (
    <div
      className={cn(
        "loot-shell concept-shell min-h-dvh bg-bg text-fg",
        dm ? "role-dm" : "role-player",
        splitOn ? "split-on" : [tradingWorkspace && "trading-shell", pathname === "/maps" && "maps-shell"],
      )}
    >
      <a
        className="app-skip"
        href="#main"
        onClick={(event) => {
          // Move focus without changing the route's hash (some screens read it).
          const main = document.getElementById("main");
          if (!main) return;
          event.preventDefault();
          main.focus({ preventScroll: true });
          main.scrollIntoView({ block: "start" });
        }}
      >
        Skip to content
      </a>
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        {splitOn ? (
          <aside
            className="split-rail sticky top-0 z-30 hidden h-dvh flex-col items-center border-r border-lead/40 bg-bg/95 py-4 lg:flex"
            onClickCapture={(event) => {
              const anchor = (event.target as HTMLElement).closest("a[href]");
              if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
              setRailOpen(false);
              // Rail destinations open in the focused pane.
              if (split.focused !== "secondary") return;
              const href = anchor.getAttribute("href") || "";
              const url = new URL(href, window.location.href);
              if (url.origin !== window.location.origin) return;
              event.preventDefault();
              event.stopPropagation();
              split.navigatePane("secondary", url.pathname + url.search + url.hash);
            }}
          >
            <Link to="/" search={{ view: "home" }} aria-label="Lootsplitter home" className="split-rail-mark">
              <QuillMark />
            </Link>
            <nav className="split-rail-nav" aria-label="Sections">
              {navLinks("compact")}
            </nav>
            <button
              type="button"
              className="split-rail-toggle"
              aria-label={railOpen ? "Collapse menu" : "Expand menu"}
              aria-expanded={railOpen}
              aria-controls="split-rail-panel"
              onClick={() => setRailOpen((open) => !open)}
            >
              {railOpen ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
            </button>
            {railOpen && (
              <div
                id="split-rail-panel"
                className="split-rail-panel"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRailOpen(false);
                }}
              >
                <p className="rail-caption">Your campaign companion</p>
                <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain" aria-label="All sections">
                  {navLinks("rail")}
                </nav>
                <AppLink href="/welcome" className="mt-3 inline-flex min-h-11 items-center px-3 text-sm text-lead">
                  Website & downloads ↗
                </AppLink>
              </div>
            )}
          </aside>
        ) : (
        <aside className="sticky top-0 z-20 hidden h-dvh flex-col border-r border-lead/40 bg-bg/95 px-3 py-5 lg:flex">
          <Link
            to="/"
            search={{ view: "home" }}
            className="inline-flex items-center gap-2 px-2 font-display text-3xl leading-none tracking-tight"
          >
            <QuillMark />
            Lootsplitter
          </Link>
          <p className="rail-caption">Your campaign companion</p>
          <nav
            className="mt-8 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain"
            aria-label="Sections"
          >
            {navLinks("rail", { settings: false })}
          </nav>
          <div className="rounded-xl border border-lead/20 p-4 text-sm text-muted">
            <p className="text-xs tracking-widest text-lead uppercase">Campaign ledger</p>
            <p className="mt-2">Manage party funds, inventory, and shops.</p>
            <AppLink href="/welcome" className="mt-3 inline-flex min-h-11 items-center text-lead">
              Website & downloads ↗
            </AppLink>
          </div>
        </aside>
        )}
        <div className="app-column min-w-0">
          <header className="sticky top-0 z-20 border-b border-lead/50 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 lg:px-8">
              <button
                className="campaign-switcher"
                onClick={() => {
                  afterContextChange(() => setCampaignOpen(true));
                }}
                // The accessible name keeps the visible campaign name (WCAG 2.5.3 label in name).
                aria-label={`Select campaign: ${campaignName}`}
                aria-haspopup="dialog"
              >
                <span>{campaignName}</span>
                <ChevronDown size={16} />
              </button>
              <button
                className="role-chip"
                aria-label={`${dm ? "DM, dungeon master. Change role." : "Player. Change role."}${testRoom.testMode ? " Test mode" : ""}`}
                onClick={() => void requestRoleChange()}
                disabled={!seatKnown}
              >
                {seatKnown ? (dm ? "DM" : "Player") : "…"}
                {testRoom.testMode && <span className="ml-2 text-negative">Test mode</span>}
              </button>
              <div className="header-actions">
                <SplitHeaderControls />
                <WorkspaceWindows />
                <AppLink
                  className="header-icon"
                  href="/share?chat=1"
                  aria-label={unreadCount ? `Messages, ${unreadCount} unread` : "Messages"}
                >
                  <FantasyIcon ui="Messages" size={27} />
                  {unreadCount > 0 && (
                    <span className="chat-nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  )}
                </AppLink>
                <button
                  className="header-icon settings-trigger"
                  aria-label="Settings & Management"
                  aria-haspopup="dialog"
                  aria-expanded={management}
                  onClick={() => setManagement(true)}
                >
                  <FantasyIcon ui="Settings" size={23} />
                </button>
              </div>
            </div>
            {inBooks ? <BooksSearch className="mx-auto w-full max-w-6xl px-4 pb-3" /> : null}
            {job ? (
              <div className="mx-auto w-full max-w-6xl px-4 pb-3 lg:px-8">
                <p className="text-sm text-muted">
                  {job.phase === "save"
                    ? `Saving ${job.name}`
                    : `Reading ${job.name}: page ${job.page} of ${job.total}`}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-sm bg-subtle">
                  <div
                    className="h-full origin-left bg-accent"
                    style={{
                      transform: `scaleX(${job.total ? Math.max(0.04, job.page / job.total) : 0.04})`,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </header>
          <OfflineNote />
          <SplitWorkspace
            primaryClassName={cn(
              tradingWorkspace && "trading-shell",
              pathname === "/maps" && "pane-maps",
            )}
          >
          <SubmenuBackdrop pathname={pathname}>
            <main
              id="main"
              tabIndex={-1}
              className={cn(
                "concept-main mx-auto w-full px-4 pt-6 pb-28 lg:px-8 lg:pt-8 lg:pb-12",
                width === "prose" ? "max-w-3xl" : "max-w-6xl",
              )}
            >
              {pathname !== "/share" && pathname !== "/maps" ? <SyncStatus compact /> : null}
              <ShellMapActions.Provider
                value={{
                  campaignName,
                  dm,
                  seatKnown,
                  unreadCount,
                  openCampaign: () => {
                    afterContextChange(() => setCampaignOpen(true));
                  },
                  changeRole: () => void requestRoleChange(),
                  openManagement: () => setManagement(true),
                }}
              >
                {children}
              </ShellMapActions.Provider>
            </main>
          </SubmenuBackdrop>
          </SplitWorkspace>
        </div>
      </div>
      <ManagementPanel
        open={management}
        onOpenChange={setManagement}
        dm={dm}
        campaign={campaignName}
        onRoleChange={() => void requestRoleChange()}
      />
      <CampaignPanel
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        dm={dm}
        campaign={campaignName}
      />
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-lead/40 bg-bg/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
        aria-label="Sections"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-6">{navLinks("tab")}</div>
      </nav>
      <BillReceipt />
      <SeatSwitch open={switching} onOpenChange={setSwitching} seat={seat} />
      <Confirm
        open={leaving}
        onOpenChange={setLeaving}
        title="Switch to player?"
        body="This browser will act as a player. You will need the campaign password to become the dungeon master again."
        confirmLabel="Switch to player"
        onConfirm={() => {
          if (roleChangeBlocked()) return;
          setSeat({ ...seat, role: "player" });
        }}
      />
      <Modal
        open={blocked !== null}
        onOpenChange={(open) => {
          if (!open) setBlocked(null);
        }}
        title="Role change blocked"
      >
        <p className="text-sm text-muted">{blocked}</p>
      </Modal>
    </div>
  );

  async function requestRoleChange() {
    if (!seatKnown || !(await confirmContextChange())) return;
    const reason = roleChangeBlocked();
    if (reason) return;
    const lock = await loadSeatLock().catch(() => null);
    if (seat.role === "player" && !lock) {
      setBlocked(
        "The dungeon master has not set a password. This browser cannot become the dungeon master until then.",
      );
      return;
    }
    if (!lock) {
      setBlocked("Set a password in Settings before changing roles.");
      return;
    }
    if (seat.role === "dm") setLeaving(true);
    else setSwitching(true);
  }

  function roleChangeBlocked(): string | null {
    const watch = getCloudWatch();
    if (!watch.joined) return null;
    const reason =
      "Disconnect from the shared campaign before changing roles. Open Multiplayer and leave the room or end the session first.";
    setBlocked(reason);
    setLeaving(false);
    setSwitching(false);
    return reason;
  }

  /** `settings: false` leaves out the rail's Settings button where the header gear (the same
   * dialog) sits beside it, so keyboard users meet one Settings stop, not two. */
  function navLinks(layout: "tab" | "rail" | "compact", { settings = true } = {}) {
    const primary = navItems(dm, pathname, search as unknown as Record<string, unknown>);
    const secondary = secondaryUrl
      ? navItems(dm, secondaryUrl.pathname, Object.fromEntries(secondaryUrl.searchParams))
      : null;
    return (
      <>
        {primary.map((link, index) => {
          const right = !!secondary?.[index].active;
          return (
            <NavLink
              key={link.label}
              layout={layout}
              to={link.to as Dest}
              search={link.search as never}
              active={link.active || right}
              current={splitOn ? (split.focused === "secondary" ? right : link.active) : link.active}
              note={splitOn && right && !link.active ? "open in right pane" : ""}
              icon={<FantasyIcon ui={link.icon} size={layout === "compact" ? 24 : 26} />}
              label={link.label}
              badge={link.to === "/share" ? unreadCount : dm && link.to === "/" ? reviewCount : 0}
              badgeLabel={dm && link.to === "/" ? reviewBadgeLabel(reviewCount) : undefined}
            />
          );
        })}
        {layout === "rail" && <FeatureCards desktop />}
        {layout === "rail" && settings && (
          <button className="rail-settings" onClick={() => setManagement(true)}>
            <FantasyIcon ui="Settings" size={20} />
            Settings & Management
          </button>
        )}
      </>
    );
  }

  function OfflineNote() {
    const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
    if (online) return null;
    return (
      <p className="border-b border-lead/30 bg-elevated px-4 py-2 text-sm text-muted" role="status">
        {isEphemeralCampaign()
          ? "Offline. Your player campaign stays in this document; export unsent work before closing it."
          : "Offline. This device keeps its owned local campaign."}{" "}
        A shared change is not saved until the server accepts it.
      </p>
    );
  }

}

export function KeptByDm() {
  return (
    <Shell>
      <h1 className="font-display text-4xl tracking-tight">Dungeon master only</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Players can buy and sell for their assigned characters. Only the dungeon master can change
        prices, the catalog, PDFs, and price settings.
      </p>
    </Shell>
  );
}

function QuillMark() {
  return (
    <svg viewBox="0 0 40 44" className="h-8 w-7" aria-hidden="true">
      <path
        d="M8 29 H26 C27 29 28 30.2 28 32.2 V35.5 C28 39.4 24.2 42 17 42 C9.8 42 6 39.4 6 35.5 V32.2 C6 30.2 7 29 8 29 Z"
        fill="#1a2744"
        stroke="#e0c17a"
        strokeWidth="1.3"
      />
      <ellipse cx="17" cy="29" rx="11" ry="3.1" fill="#243656" stroke="#e0c17a" strokeWidth="1.3" />
      <ellipse cx="17" cy="29" rx="5.2" ry="1.5" fill="#0c1220" />
      <path
        d="M33 5 C26 13 21 20 17.5 28"
        fill="none"
        stroke="#e6d3a4"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M33 5 C29 8 23 10 18 14 C23 12 29 10 34 7 C33 6 33 5.4 33 5 Z"
        fill="#f6f1e6"
        stroke="#e0c17a"
        strokeWidth="1"
      />
      <path d="M31.5 7.2 C27 10 22 12 18.5 14" fill="none" stroke="#c4b49a" strokeWidth="0.7" />
    </svg>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: string;
  active: boolean;
  search?: Record<string, string>;
};

/** The six main destinations for a role, marked active for one location. */
function navItems(dm: boolean, pathname: string, search: Record<string, unknown>): NavItem[] {
  const inBooks =
    pathname === "/books" || pathname.startsWith("/book/") || pathname.startsWith("/read/");
  const library =
    pathname === "/library" || pathname === "/catalog" || inBooks || pathname === "/favorites";
  return dm
    ? [
        {
          to: "/",
          label: "Desk",
          icon: "Desk",
          active: pathname === "/",
          search: { view: "home" },
        },
        {
          to: "/encounters",
          label: "Encounters",
          icon: "Encounters",
          active: pathname === "/encounters",
        },
        {
          to: "/party",
          label: "Party",
          icon: "Party",
          active: pathname === "/party" || pathname === "/characters",
        },
        {
          to: "/market",
          label: "Market",
          icon: "Market",
          active: pathname === "/market" || pathname.startsWith("/shop/"),
          search: { book: "" },
        },
        { to: "/library", label: "Library", icon: "Library", active: library },
        { to: "/maps", label: "Maps", icon: "Maps", active: pathname === "/maps" },
      ]
    : [
        {
          to: "/",
          label: "Home",
          icon: "Desk",
          active: (pathname === "/" && search.view !== "overview") || pathname === "/characters",
          search: { view: "home" },
        },
        {
          to: "/party",
          label: "Inventory",
          icon: "Inventory",
          active: pathname === "/party",
        },
        {
          to: "/share",
          label: "Campaign",
          icon: "Campaign",
          active: pathname === "/share" || (pathname === "/" && search.view === "overview"),
        },
        {
          to: "/market",
          label: "Market",
          icon: "Market",
          active: pathname === "/market" || pathname.startsWith("/shop/"),
          search: { book: "" },
        },
        { to: "/library", label: "Library", icon: "Library", active: library },
        { to: "/maps", label: "Maps", icon: "Maps", active: pathname === "/maps" },
      ];
}

function NavLink({
  to,
  search,
  active,
  current = active,
  note = "",
  icon,
  label,
  layout,
  badge = 0,
  badgeLabel,
}: {
  to: Dest;
  search?: { book: string } | { q: string } | { view: "home" | "sheet" };
  active: boolean;
  /** The destination shown in the focused pane (or the only screen). */
  current?: boolean;
  /** Extra context for assistive technology, e.g. "open in right pane". */
  note?: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  /** Describes the badge without changing the link's name (the Review Inbox count). */
  badgeLabel?: string;
  layout: "tab" | "rail" | "compact";
}) {
  const badgeId = useId();
  const described = !!badgeLabel && badge > 0;
  return (
    <>
    <Link
      to={to}
      aria-describedby={described ? badgeId : undefined}
      aria-current={current ? "page" : undefined}
      aria-label={layout === "compact" || note ? `${label}${note ? ` (${note})` : ""}` : undefined}
      title={layout === "compact" ? label : undefined}
      search={search as never}
      className={cn(
        "font-medium",
        layout === "tab"
          ? "loot-nav-tab inline-flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-center text-sm leading-tight"
          : layout === "compact"
            ? "split-rail-link"
            : "inline-flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm",
        active ? "text-lead" : "text-faint",
        layout === "rail" && active && "bg-subtle",
        layout === "compact" && active && "is-active",
      )}
    >
      <span className="relative">
        {icon}
        {badge > 0 ? (
          described ? (
            <span className="chat-nav-badge review-nav-badge" aria-hidden="true">
              {badge > 99 ? "99+" : badge}
            </span>
          ) : (
            <span className="chat-nav-badge" aria-label={`${badge} unread messages`}>
              {badge > 99 ? "99+" : badge}
            </span>
          )
        ) : null}
      </span>
      {layout === "compact" ? null : label}
    </Link>
    {/* Outside the link so its name stays "Desk"; a hidden element still describes it. */}
    {described ? (
      <span id={badgeId} hidden>
        {badgeLabel}
      </span>
    ) : null}
    </>
  );
}

/** Library search; it searches within the pane (or window) that shows it. */
function BooksSearch({ className }: { className: string }) {
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.search });
  const query = searchString(search);
  const [draft, setDraft] = useState(query);
  const dirty = useRef(false);
  useEffect(() => {
    setDraft(query);
  }, [query]);
  useEffect(() => {
    if (!dirty.current) return;
    const handle = window.setTimeout(() => {
      dirty.current = false;
      void navigate({ to: "/books", search: { q: draft.trim() } });
    }, 180);
    return () => window.clearTimeout(handle);
  }, [draft, navigate]);
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    dirty.current = false;
    void navigate({ to: "/books", search: { q: draft.trim() } });
  }
  return (
    <form onSubmit={onSubmit} className={className}>
      <label className="relative block">
        <span className="sr-only">Search entries</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <input
          value={draft}
          onChange={(event) => {
            dirty.current = true;
            setDraft(event.target.value);
          }}
          placeholder="Search the library"
          className="min-h-11 w-full rounded-sm border border-border bg-subtle pr-3 pl-10 text-base text-fg outline-none placeholder:text-faint"
        />
      </label>
    </form>
  );
}

/**
 * A screen shown in the right split-view pane: its content and screen-specific status only.
 * The rail, header, global dialogs and device listeners exist once, in the window frame.
 */
function PaneShell({ children, width = "wide" }: ShellProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const seat = useSeat();
  const seatKnown = useSeatKnown();
  const dm = seat.role === "dm";
  const { count: unreadCount } = useChatUnread();
  const campaigns = useSyncExternalStore(subscribeCampaigns, getCampaigns, serverCampaigns);
  const campaignName =
    campaigns.campaigns.find((c) => c.id === campaigns.activeId)?.name || "Campaign";
  const { actions } = useSplitView();
  const inBooks =
    pathname === "/books" || pathname.startsWith("/book/") || pathname.startsWith("/read/");
  return (
    <div
      className={cn(
        "pane-shell",
        paneFrameClass(pathname, dm),
        pathname === "/maps" && "pane-maps",
      )}
    >
      {inBooks ? <BooksSearch className="pane-books-search" /> : null}
      <SubmenuBackdrop pathname={pathname}>
        <main
          className={cn(
            "concept-main mx-auto w-full px-4 pt-6 pb-12",
            width === "prose" ? "max-w-3xl" : "max-w-6xl",
          )}
        >
          {pathname !== "/share" && pathname !== "/maps" ? <SyncStatus compact /> : null}
          <ShellMapActions.Provider value={{ campaignName, dm, seatKnown, unreadCount, ...actions }}>
            {children}
          </ShellMapActions.Provider>
        </main>
      </SubmenuBackdrop>
    </div>
  );
}

function searchString(search: unknown): string {
  if (typeof search !== "object" || search === null || !("q" in search)) return "";
  return typeof search.q === "string" ? search.q : "";
}

const reviewBadgeLabel = (n: number) =>
  `${n} ${n === 1 ? "request" : "requests"} waiting in Review Inbox`;
