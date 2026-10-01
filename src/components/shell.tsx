import { useChatUnread } from "@/lib/quire/use-chat-unread";
import { SyncStatus } from "./sync-status";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Coins,
  Ellipsis,
  Home,
  Hourglass,
  Library,
  Radio,
  Scale,
  ScrollText,
  Search,
  Settings,
  Users,
  Smartphone,
  Store,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { Toaster } from "sonner";
import { getCloudWatch, subscribeCloudWatch, type CloudWatch } from "@/lib/quire/cloud-turn";
import { useLibrary } from "@/lib/quire/library";
import { usePrefs } from "@/lib/quire/prefs";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { setSeat } from "@/lib/quire/table";
import { BillReceipt } from "@/components/bill-receipt";
import { SeatSwitch } from "@/components/seat-switch";
import { Confirm, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import { loadSeatLock } from "@/lib/quire/lock";
import { getOnline, subscribeOnline } from "@/lib/mobile/online";
import { watchCrashes } from "@/lib/quire/reports";

type Dest = "/" | "/market" | "/catalog" | "/party" | "/books" | "/share" | "/settings";

export function Shell({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "wide" | "prose";
}) {
  const { job } = useLibrary();
  const seat = useSeat();
  const { count: unreadCount } = useChatUnread();
  const seatKnown = useSeatKnown();
  const { prefs } = usePrefs();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search });
  const query = searchString(search);
  const [draft, setDraft] = useState(query);
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [more, setMore] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const dirty = useRef(false);

  useEffect(() => watchCrashes(), []);
  useEffect(() => {
    if (import.meta.env.VITE_MOBILE !== "true") return;
    let remove = () => {};
    let live = true;
    void import("@capacitor/app").then(({ App }) => {
      void App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else void App.exitApp();
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

  const view = searchView(search);
  const onHome = pathname === "/" && view !== "sheet";
  const onSheet = pathname === "/" && view === "sheet";
  const inBooks =
    pathname === "/books" || pathname.startsWith("/book/") || pathname.startsWith("/read/");
  const dm = seat.role === "dm";

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    dirty.current = false;
    void navigate({ to: "/books", search: { q: draft.trim() } });
  }

  return (
    <div className="loot-shell min-h-dvh bg-bg text-fg">
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-0 z-20 hidden h-dvh flex-col border-r border-lead/40 bg-bg/95 px-3 py-5 lg:flex">
          <Link
            to="/"
            search={{ view: "home" }}
            className="inline-flex items-center gap-2 px-2 font-display text-3xl leading-none tracking-tight"
          >
            <QuillMark />
            Lootsplit
          </Link>
          <nav className="mt-8 flex flex-1 flex-col gap-2" aria-label="Sections">
            {navLinks("rail")}
          </nav>
          <div className="rounded-xl border border-lead/20 p-4 text-sm text-muted">
            <p className="text-xs tracking-widest text-lead uppercase">Campaign ledger</p>
            <p className="mt-2">Manage party funds, inventory, and shops.</p>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-lead/50 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 lg:px-8">
              <Link
                to="/"
                search={{ view: "home" }}
                className="inline-flex items-center gap-2 font-display text-3xl leading-none tracking-tight lg:hidden"
              >
                <QuillMark />
                Lootsplit
              </Link>
              {inBooks ? (
                <form onSubmit={onSubmit} className="hidden min-w-0 flex-1 lg:block lg:max-w-xl">
                  <SearchField />
                </form>
              ) : null}
              <div className="ml-auto flex items-center">
                <ModeMark />
                <SeatMark
                  role={seat.role}
                  known={seatKnown}
                  onPress={() => void requestRoleChange()}
                />
              </div>
            </div>
            {inBooks ? (
              <form onSubmit={onSubmit} className="mx-auto w-full max-w-6xl px-4 pb-3 lg:hidden">
                <SearchField />
              </form>
            ) : null}
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
          <main
            className={cn(
              "mx-auto w-full px-4 pt-6 pb-28 lg:px-8 lg:pt-8 lg:pb-12",
              width === "prose" ? "max-w-3xl" : "max-w-6xl",
            )}
          >
            {pathname !== "/share" ? <SyncStatus compact /> : null}
            {children}
          </main>
        </div>
      </div>
      {more ? (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-lead/30 bg-elevated lg:hidden">
          <div className="mx-auto flex max-w-3xl flex-col px-2 py-2">
            {dm ? (
              <MoreLink
                to="/books"
                search={{ q: "" }}
                label="Books"
                onPick={() => setMore(false)}
              />
            ) : null}
            <MoreLink
              to="/market"
              search={{ book: "" }}
              label="Market"
              onPick={() => setMore(false)}
            />
            {dm ? (
              <MoreLink to="/catalog" label="Catalog" onPick={() => setMore(false)} />
            ) : (
              <MoreLink
                to="/"
                search={{ view: "sheet" }}
                label="Character sheet"
                onPick={() => setMore(false)}
              />
            )}
            <MoreLink
              to="/settings"
              label={dm ? "Settings" : "Device backups"}
              onPick={() => setMore(false)}
            />
          </div>
        </div>
      ) : null}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-lead/40 bg-bg/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
        aria-label="Sections"
      >
        <div className="mx-auto grid max-w-3xl grid-cols-4">{navLinks("tab")}</div>
      </nav>
      <Toaster theme={prefs.appearance === "light" ? "light" : "dark"} position="top-center" />
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
    if (!seatKnown) return;
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

  function navLinks(layout: "tab" | "rail") {
    if (layout === "rail") {
      return (
        <>
          <NavLink
            layout={layout}
            to="/"
            search={{ view: "home" }}
            active={onHome}
            icon={dm ? <Scale className="size-4" /> : <Home className="size-4" />}
            label="Home"
          />
          <NavLink
            layout={layout}
            to="/market"
            search={{ book: "" }}
            active={pathname.startsWith("/market") || pathname.startsWith("/shop/")}
            icon={<Store className="size-4" />}
            label="Market"
          />
          <NavLink
            layout={layout}
            to="/party"
            active={pathname === "/party"}
            icon={<Coins className="size-4" />}
            label="Party"
          />
          {dm ? (
            <NavLink
              layout={layout}
              to="/catalog"
              active={pathname === "/catalog"}
              icon={<Library className="size-4" />}
              label="Catalog"
            />
          ) : (
            <NavLink
              layout={layout}
              to="/"
              search={{ view: "sheet" }}
              active={onSheet}
              icon={<ScrollText className="size-4" />}
              label="Sheet"
            />
          )}
          {dm ? (
            <NavLink
              layout={layout}
              to="/books"
              search={{ q: "" }}
              active={inBooks}
              icon={<Library className="size-4" />}
              label="Books"
            />
          ) : null}
          <NavLink
            layout={layout}
            to="/share"
            active={pathname === "/share"}
            icon={<Users className="size-4" />}
            label="Multiplayer"
            badge={unreadCount}
          />
          <NavLink
            layout={layout}
            to="/settings"
            active={pathname === "/settings"}
            icon={<Settings className="size-4" />}
            label={dm ? "Settings" : "Device backups"}
          />
        </>
      );
    }
    return (
      <>
        <NavLink
          layout={layout}
          to="/"
          search={{ view: "home" }}
          active={onHome}
          icon={<Home className="size-5" />}
          label="Home"
        />
        <NavLink
          layout={layout}
          to="/party"
          active={pathname === "/party"}
          icon={<Coins className="size-5" />}
          label="Party"
        />
        <NavLink
          layout={layout}
          to="/share"
          active={pathname === "/share"}
          icon={<Users className="size-5" />}
          label="Multiplayer"
          badge={unreadCount}
        />
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
          className={cn(
            "inline-flex min-h-16 flex-col items-center justify-center gap-1 text-sm",
            more ? "text-lead" : "text-muted",
          )}
        >
          <Ellipsis className="size-5" />
          More
        </button>
      </>
    );
  }

  function OfflineNote() {
    const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
    if (online) return null;
    return (
      <p className="border-b border-lead/30 bg-elevated px-4 py-2 text-sm text-muted" role="status">
        Offline. This device keeps its local campaign. A shared change is not saved until the server
        accepts it.
      </p>
    );
  }

  function SearchField() {
    return (
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

const LOCAL_WATCH: CloudWatch = { joined: false, mine: true, live: false, who: "" };

function ModeMark() {
  const watch = useSyncExternalStore(subscribeCloudWatch, getCloudWatch, () => LOCAL_WATCH);
  const mode = !watch.joined ? "local" : watch.live ? "live" : "turns";
  const label = mode === "live" ? "Live Mode" : mode === "turns" ? "Turn-based Mode" : "Local Mode";
  const Icon = mode === "live" ? Radio : mode === "turns" ? Hourglass : Smartphone;
  return (
    <Link
      to="/share"
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 px-2",
        mode === "live" ? "text-accent" : mode === "turns" ? "text-lead" : "text-faint",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="hidden text-xs sm:inline">{label}</span>
    </Link>
  );
}

function SeatMark({
  role,
  known,
  className,
  onPress,
}: {
  role: "dm" | "player";
  known: boolean;
  className?: string;
  onPress: () => void;
}) {
  const player = role === "player";
  return (
    <button
      type="button"
      disabled={!known}
      onClick={onPress}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 text-xs font-medium tracking-wide text-faint uppercase",
        className,
      )}
      aria-label={
        known ? (player ? "Player. Change role." : "Dungeon master. Change role.") : "Role"
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          known ? (player ? "bg-accent" : "bg-lead") : "bg-faint",
        )}
        aria-hidden="true"
      />
      {known ? (player ? "Player" : "Dungeon master") : "…"}
    </button>
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

function NavLink({
  to,
  search,
  active,
  icon,
  label,
  layout,
  badge = 0,
}: {
  to: Dest;
  search?: { book: string } | { q: string } | { view: "home" | "sheet" };
  active: boolean;
  icon: ReactNode;
  label: string;
  badge?: number;
  layout: "tab" | "rail";
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      search={search as never}
      className={cn(
        "font-medium",
        layout === "tab"
          ? "loot-nav-tab inline-flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 text-center text-sm leading-tight"
          : "inline-flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm",
        active ? "text-lead" : "text-faint",
        layout === "rail" && active && "bg-subtle",
      )}
    >
      <span className="relative">
        {icon}
        {badge > 0 ? (
          <span className="chat-nav-badge" aria-label={`${badge} unread messages`}>
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      {label}
    </Link>
  );
}

function searchView(search: unknown): "home" | "sheet" {
  if (typeof search !== "object" || search === null || !("view" in search)) return "home";
  return search.view === "sheet" ? "sheet" : "home";
}

function MoreLink({
  to,
  search,
  label,
  onPick,
}: {
  to: Dest;
  search?: { q: string } | { book: string } | { view: "sheet" };
  label: string;
  onPick: () => void;
}) {
  return (
    <Link
      to={to}
      search={search as never}
      onClick={onPick}
      className="flex min-h-11 items-center px-2 text-sm"
    >
      {label}
    </Link>
  );
}

function searchString(search: unknown): string {
  if (typeof search !== "object" || search === null || !("q" in search)) return "";
  return typeof search.q === "string" ? search.q : "";
}
