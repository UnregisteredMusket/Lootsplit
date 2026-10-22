import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowLeftRight, ChevronDown, Columns2, Maximize2, Minimize2, Square, X } from "lucide-react";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { cn } from "@/lib/cn";
import {
  DEFAULT_SPLIT_LAYOUT,
  SPLIT_MIN_VIEWPORT,
  SPLIT_SEARCH_KEY,
  besideFromSearch,
  clampRatio,
  defaultBeside,
  keyboardRatio,
  paneCapablePath,
  paneLabel,
  paneScreens,
  paneTitle,
  readSplitLayout,
  rememberBeside,
  sanitizePaneHref,
  screenKey,
  snapRatio,
  withBeside,
  writeSplitLayout,
  type PaneScreen,
  type PaneSide,
  type SplitLayout,
} from "@/lib/quire/split-view";

type AppRouter = ReturnType<typeof useRouter>;

/** Which pane a screen renders in. `null` outside split view (the normal single screen). */
export type PaneInfo = { side: PaneSide };
const PaneContext = createContext<PaneInfo | null>(null);
const PRIMARY: PaneInfo = { side: "primary" };
const SECONDARY: PaneInfo = { side: "secondary" };
export function usePane() {
  return useContext(PaneContext);
}

/** Window-level dialogs the single app frame opens on behalf of the screen in the other pane. */
export type ShellActions = {
  openCampaign: () => void;
  changeRole: () => void;
  openManagement: () => void;
};

type SplitApi = {
  /** The viewport is wide enough (desktop web or tablet landscape) and the seat is known. */
  available: boolean;
  /** Two panes are showing. */
  open: boolean;
  dm: boolean;
  primaryHref: string;
  secondaryHref: string | null;
  layout: SplitLayout;
  ratio: number;
  setRatio: (ratio: number, persist: boolean) => void;
  focused: PaneSide;
  focus: (side: PaneSide) => void;
  fullWidth: PaneSide | null;
  setFullWidth: (side: PaneSide | null) => void;
  openBeside: (href: string) => void;
  setSplit: (on: boolean) => void;
  closePane: (side: PaneSide) => void;
  swap: () => void;
  canSwap: boolean;
  navigatePane: (side: PaneSide, href: string) => void;
  host: HTMLElement | null;
  /** Stable wrappers that call the mounted app frame's dialogs. */
  actions: ShellActions;
  registerActions: (actions: ShellActions | null) => void;
};

const SplitContext = createContext<SplitApi | null>(null);
const inert: SplitApi = {
  available: false,
  open: false,
  dm: false,
  primaryHref: "/",
  secondaryHref: null,
  layout: DEFAULT_SPLIT_LAYOUT,
  ratio: DEFAULT_SPLIT_LAYOUT.ratio,
  setRatio: () => {},
  focused: "primary",
  focus: () => {},
  fullWidth: null,
  setFullWidth: () => {},
  openBeside: () => {},
  setSplit: () => {},
  closePane: () => {},
  swap: () => {},
  canSwap: false,
  navigatePane: () => {},
  host: null,
  actions: { openCampaign: () => {}, changeRole: () => {}, openManagement: () => {} },
  registerActions: () => {},
};
export function useSplitView(): SplitApi {
  return useContext(SplitContext) ?? inert;
}

const PANE_CLOSE = "lootsplit:before-pane-close";
/** Ask the screen in a pane whether it may be replaced (unsaved drafts confirm first). */
export function allowPaneClose(side: PaneSide) {
  return window.dispatchEvent(new CustomEvent(PANE_CLOSE, { detail: side, cancelable: true }));
}
export function onPaneClose(side: PaneSide, listener: (event: Event) => void) {
  const handler = (event: Event) => {
    if ((event as CustomEvent<PaneSide>).detail === side) listener(event);
  };
  window.addEventListener(PANE_CLOSE, handler);
  return () => window.removeEventListener(PANE_CLOSE, handler);
}
export const OPEN_WORKSPACE_WINDOWS = "lootsplit:open-workspace-windows";

const wideQuery = `(min-width: ${SPLIT_MIN_VIEWPORT}px)`;
function subscribeWide(change: () => void) {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
const getWide = () => window.matchMedia(wideQuery).matches;
const getServerWide = () => false;

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function parts(router: AppRouter, href: string) {
  const url = new URL(href, "https://lootsplit.invalid");
  return {
    to: url.pathname,
    search: router.options.parseSearch!(url.search) as Record<string, unknown>,
    hash: url.hash.slice(1) || undefined,
  };
}

/**
 * The right pane renders the same route tree in a second router with memory history.
 * It shares this document's providers, stores and cloud client; only its location differs.
 */
function createPaneRouter(main: AppRouter, href: string): AppRouter {
  const global = window as unknown as { __TSR_ROUTER__?: unknown };
  const previous = global.__TSR_ROUTER__;
  try {
    return createRouter({
      routeTree: main.routeTree,
      history: createMemoryHistory({ initialEntries: [href] }),
      scrollRestoration: false,
      scrollToTopSelectors: ['[data-split-scroll="secondary"]'],
      defaultErrorComponent: main.options.defaultErrorComponent,
      defaultPendingComponent: main.options.defaultPendingComponent,
      defaultPendingMs: main.options.defaultPendingMs,
      defaultPendingMinMs: main.options.defaultPendingMinMs,
    }) as unknown as AppRouter;
  } finally {
    // The window's router stays the registered instance for framework helpers.
    global.__TSR_ROUTER__ = previous;
  }
}

export function SplitViewProvider({ children }: { children: ReactNode }) {
  const main = useRouter();
  const seat = useSeat();
  const seatKnown = useSeatKnown();
  const dm = seat.role === "dm";
  const location = useRouterState({ select: (s) => s.location });
  const wide = useSyncExternalStore(subscribeWide, getWide, getServerWide);
  const [layout, setLayoutState] = useState<SplitLayout>(DEFAULT_SPLIT_LAYOUT);
  const [ratio, setRatioState] = useState(DEFAULT_SPLIT_LAYOUT.ratio);
  const [focused, setFocused] = useState<PaneSide>("primary");
  const [fullWidth, setFullWidth] = useState<PaneSide | null>(null);
  const shellActions = useRef<ShellActions | null>(null);
  const [actions] = useState<ShellActions>(() => ({
    openCampaign: () => shellActions.current?.openCampaign(),
    changeRole: () => shellActions.current?.changeRole(),
    openManagement: () => shellActions.current?.openManagement(),
  }));
  const registerActions = useCallback((next: ShellActions | null) => {
    shellActions.current = next;
  }, []);
  const focusedRef = useRef<PaneSide>("primary");
  focusedRef.current = focused;
  const [pane, setPane] = useState<AppRouter | null>(null);
  const [secondaryHref, setSecondaryHref] = useState<string | null>(null);
  const [host] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "split-pane-host";
    return element;
  });

  useEffect(() => {
    const stored = readSplitLayout(localStore());
    setLayoutState(stored);
    setRatioState(stored.ratio);
  }, []);
  const saveLayout = useCallback((update: (layout: SplitLayout) => SplitLayout) => {
    setLayoutState((current) => {
      const next = update(current);
      writeSplitLayout(localStore(), next);
      return next;
    });
  }, []);

  const available = seatKnown && wide;
  const beside = useMemo(
    () => (seatKnown ? besideFromSearch(location.search, dm) : null),
    [location.search, dm, seatKnown],
  );
  const primaryHref = withBeside(location.href, null);
  const active = available && !!beside;

  const latest = useRef({ beside, dm, primaryHref, pane, secondaryHref });
  latest.current = { beside, dm, primaryHref, pane, secondaryHref };

  /** Change only the pane parameter of the window URL (no history entry, scroll or draft prompt). */
  const setBesideInUrl = useCallback(
    (next: string | null) => {
      const current = main.state.location;
      const search = {
        ...(current.search as unknown as Record<string, unknown>),
        [SPLIT_SEARCH_KEY]: next ?? undefined,
      };
      void main.navigate({
        to: current.pathname,
        search,
        hash: current.hash || undefined,
        replace: true,
        resetScroll: false,
        ignoreBlocker: true,
      } as never);
    },
    [main],
  );

  // Create the pane router when two panes are showing; dispose it when the window
  // narrows or the pane closes (the URL keeps the choice to restore it when wide again).
  useEffect(() => {
    if (!active || !beside) {
      setPane(null);
      setSecondaryHref(null);
      setFullWidth(null);
      setFocused("primary");
      return;
    }
    setPane((current) => current ?? createPaneRouter(main, beside));
    // `beside` changes are followed by the effect below without recreating the router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, main]);

  // URL → pane: a changed `beside` (menu choice, swap, reload, deep link) moves the right pane.
  useEffect(() => {
    if (!pane || !beside) return;
    const shown = sanitizePaneHref(pane.state.location.href, dm);
    if (shown !== beside) void pane.navigate({ ...parts(pane, beside), replace: true } as never);
  }, [pane, beside, dm]);

  // Pane → URL: navigation inside the right pane is reflected in `?beside=` for reload/deep links.
  useEffect(() => {
    if (!pane) return;
    let lastGood = pane.state.location.href;
    const sync = () => {
      const href = pane.state.location.href;
      const path = new URL(href, "https://lootsplit.invalid").pathname;
      if (!paneCapablePath(path)) {
        // Account and website pages open in the main pane; the right pane stays where it was.
        void main.navigate(parts(main, href) as never);
        void pane.navigate({ ...parts(pane, lastGood), replace: true } as never);
        return;
      }
      lastGood = href;
      setSecondaryHref(href);
      const safe = sanitizePaneHref(href, latest.current.dm);
      if (!safe) return;
      if (safe !== latest.current.beside) setBesideInUrl(safe);
      saveLayout((layout) => rememberBeside(layout, safe));
    };
    sync();
    return pane.subscribe("onResolved", sync);
  }, [pane, main, setBesideInUrl, saveLayout]);

  // F6 / Shift+F6 move between the panes, as in other multi-pane applications.
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "F6" || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const next: PaneSide = focusedRef.current === "primary" ? "secondary" : "primary";
      setFocused(next);
      document.querySelector<HTMLElement>(`[data-split-pane="${next}"]`)?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);

  const openBeside = useCallback(
    (href: string) => {
      const safe = sanitizePaneHref(href, latest.current.dm);
      if (!safe || !getWide()) return;
      if (latest.current.beside && !allowPaneClose("secondary")) return;
      saveLayout((layout) => rememberBeside(layout, safe));
      setFullWidth(null);
      setFocused("secondary");
      setBesideInUrl(safe);
    },
    [saveLayout, setBesideInUrl],
  );

  const closePane = useCallback(
    (side: PaneSide) => {
      const { beside: current, pane: router, secondaryHref: shown } = latest.current;
      if (!current) return;
      if (!allowPaneClose("secondary")) return;
      setFullWidth(null);
      setFocused("primary");
      saveLayout((layout) => ({ ...layout, open: false }));
      if (side === "secondary") {
        setBesideInUrl(null);
        return;
      }
      // Closing the left pane keeps the right screen, now as the single screen.
      const target = shown ?? router?.state.location.href ?? current;
      void main.navigate({ ...parts(main, target), search: { ...parts(main, target).search, [SPLIT_SEARCH_KEY]: undefined } } as never);
    },
    [main, saveLayout, setBesideInUrl],
  );

  const swap = useCallback(() => {
    const { beside: current, primaryHref: left, pane: router, secondaryHref: shown, dm: isDm } =
      latest.current;
    const nextBeside = sanitizePaneHref(left, isDm);
    if (!current || !nextBeside) return;
    if (!allowPaneClose("secondary")) return;
    const target = shown ?? router?.state.location.href ?? current;
    const destination = parts(main, target);
    void main.navigate({
      ...destination,
      search: { ...destination.search, [SPLIT_SEARCH_KEY]: nextBeside },
      replace: true,
    } as never);
  }, [main]);

  const navigatePane = useCallback(
    (side: PaneSide, href: string) => {
      setFocused(side);
      if (side === "primary") {
        void main.navigate(parts(main, withBeside(href, null)) as never);
        return;
      }
      const router = latest.current.pane;
      if (router) void router.navigate(parts(router, withBeside(href, null)) as never);
      else openBeside(href);
    },
    [main, openBeside],
  );

  const setSplit = useCallback(
    (on: boolean) => {
      if (!on) {
        closePane("secondary");
        return;
      }
      if (latest.current.beside) return;
      openBeside(defaultBeside(layout, latest.current.primaryHref, latest.current.dm));
    },
    [closePane, openBeside, layout],
  );

  const setRatio = useCallback(
    (next: number, persist: boolean) => {
      setRatioState(next);
      if (persist) saveLayout((layout) => ({ ...layout, ratio: next }));
    },
    [saveLayout],
  );

  const api = useMemo<SplitApi>(
    () => ({
      available,
      open: active && !!pane,
      dm,
      primaryHref,
      secondaryHref,
      layout,
      ratio,
      setRatio,
      focused,
      focus: setFocused,
      fullWidth,
      setFullWidth,
      openBeside,
      setSplit,
      closePane,
      swap,
      canSwap: !!sanitizePaneHref(primaryHref, dm),
      navigatePane,
      host,
      actions,
      registerActions,
    }),
    [
      available,
      active,
      pane,
      dm,
      primaryHref,
      secondaryHref,
      layout,
      ratio,
      setRatio,
      focused,
      fullWidth,
      openBeside,
      setSplit,
      closePane,
      swap,
      navigatePane,
      host,
      actions,
      registerActions,
    ],
  );

  return (
    <SplitContext.Provider value={api}>
      {children}
      {pane &&
        host &&
        createPortal(
          <PaneContext.Provider value={SECONDARY}>
            <RouterProvider router={pane} />
          </PaneContext.Provider>,
          host,
        )}
    </SplitContext.Provider>
  );
}

const mainIcons: Record<string, string> = {
  home: "Desk",
  "/characters": "Party",
  "/party": "Inventory",
  "/market": "Market",
  "/library": "Library",
  "/maps": "Maps",
  "/encounters": "Encounters",
  chat: "Messages",
};

function ScreenItems({
  screens,
  current,
  lastUsed,
  dm,
  onPick,
}: {
  screens: PaneScreen[];
  current?: string;
  lastUsed?: string;
  dm: boolean;
  onPick: (href: string) => void;
}) {
  const groups: [string, PaneScreen[]][] = [
    ["Main screens", screens.filter((s) => s.group === "main")],
    [dm ? "Campaign tools" : "Your tools", screens.filter((s) => s.group === "tools")],
  ];
  return (
    <>
      {groups.map(([label, list]) => (
        <DropdownMenu.Group key={label}>
          <DropdownMenu.Label className="split-menu-group">{label}</DropdownMenu.Label>
          {list.map((screen) => (
            <DropdownMenu.Item
              key={screen.key}
              className="split-menu-item"
              data-current={screen.key === current || undefined}
              onSelect={() => onPick(screen.href)}
            >
              {mainIcons[screen.key] ? (
                <FantasyIcon ui={mainIcons[screen.key]} size={20} />
              ) : (
                <span className="split-menu-dot" aria-hidden="true" />
              )}
              <span>{screen.title}</span>
              {screen.key === current ? (
                <small>shown here</small>
              ) : screen.key === lastUsed ? (
                <small>last used</small>
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Group>
      ))}
    </>
  );
}

function SeparateWindowItem({ href }: { href: string }) {
  return (
    <>
      <DropdownMenu.Separator className="split-menu-separator" />
      <DropdownMenu.Item
        className="split-menu-item"
        onSelect={() =>
          window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_WINDOWS, { detail: href }))
        }
      >
        <span className="split-menu-dot" aria-hidden="true" />
        <span>Open in a separate window…</span>
        <small>other monitor</small>
      </DropdownMenu.Item>
    </>
  );
}

/** Header controls: the layout toggle and, on a single screen, Open beside. */
export function SplitHeaderControls() {
  const split = useSplitView();
  if (!split.available) return null;
  const primaryKey = screenKey(split.primaryHref);
  const screens = paneScreens(split.dm).filter((s) => s.key !== primaryKey);
  const lastUsed = split.layout.recent[0] ? screenKey(split.layout.recent[0]) : undefined;
  return (
    <>
      {!split.open && (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="split-open-beside" aria-label="Open beside">
              <Columns2 size={18} aria-hidden="true" />
              <span className="split-open-beside-label">Open beside</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="split-menu"
              aria-label="Open beside"
              align="end"
              sideOffset={8}
              collisionPadding={12}
            >
              <p className="split-menu-note">Opens on the right. Drag the divider to resize.</p>
              <ScreenItems
                screens={screens}
                lastUsed={lastUsed}
                dm={split.dm}
                onPick={(href) => split.openBeside(href)}
              />
              <SeparateWindowItem href={split.primaryHref} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <div role="group" aria-label="Layout" className="split-layout-toggle">
        <button
          type="button"
          aria-label="Single screen"
          title="Single screen"
          aria-pressed={!split.open}
          onClick={() => split.setSplit(false)}
        >
          <Square size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Split view"
          title="Split view"
          aria-pressed={split.open}
          onClick={() => split.setSplit(true)}
        >
          <Columns2 size={18} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

function PaneHeader({ side, href }: { side: PaneSide; href: string }) {
  const split = useSplitView();
  const key = screenKey(href);
  const lastUsed = split.layout.recent[0] ? screenKey(split.layout.recent[0]) : undefined;
  const title = paneTitle(href, split.dm);
  const full = split.fullWidth === side;
  const icon = mainIcons[key];
  return (
    <div className="split-pane-head">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="split-pane-picker"
            aria-label={`${side === "primary" ? "Left" : "Right"} pane screen: ${title}. Choose another screen`}
          >
            {icon ? <FantasyIcon ui={icon} size={18} /> : null}
            <span>{title}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="split-menu"
            aria-label={`Choose the ${side === "primary" ? "left" : "right"} pane screen`}
            align="start"
            sideOffset={8}
            collisionPadding={12}
          >
            <ScreenItems
              screens={paneScreens(split.dm)}
              current={key}
              lastUsed={lastUsed}
              dm={split.dm}
              onPick={(next) => {
                if (screenKey(next) === key) return;
                split.navigatePane(side, next);
              }}
            />
            <SeparateWindowItem href={href} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <span className="flex-1" />
      <button
        type="button"
        className="split-pane-action"
        aria-label="Swap panes"
        title="Swap panes"
        disabled={!split.canSwap}
        onClick={() => split.swap()}
      >
        <ArrowLeftRight size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="split-pane-action"
        aria-label={full ? "Show both panes" : "Show this pane full width"}
        title={full ? "Show both panes" : "Show this pane full width"}
        aria-pressed={full}
        onClick={() => split.setFullWidth(full ? null : side)}
      >
        {full ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="split-pane-action"
        aria-label="Close this pane"
        title="Close this pane"
        onClick={() => split.closePane(side)}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

function PaneSlot() {
  const { host } = useSplitView();
  const slot = useRef<HTMLDivElement>(null);
  // The right pane's React tree lives at the app root so it survives left-pane navigation;
  // its element moves into whichever app frame is currently mounted.
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element || !host) return;
    element.appendChild(host);
    return () => {
      if (host.parentNode === element) element.removeChild(host);
    };
  }, [host]);
  return <div ref={slot} className="split-pane-slot" />;
}

function Divider({
  ratio,
  width,
  onChange,
}: {
  ratio: number;
  width: number;
  onChange: (ratio: number, persist: boolean) => void;
}) {
  const drag = useRef<{ left: number; width: number } | null>(null);
  const dragged = useRef(ratio);
  const value = Math.round(ratio * 100);
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const next = (event.clientX - drag.current.left) / drag.current.width;
    dragged.current = clampRatio(snapRatio(next), drag.current.width);
    onChange(dragged.current, false);
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panes. Use arrow keys to move the divider."
      aria-valuemin={Math.round(clampRatio(0, width) * 100)}
      aria-valuemax={Math.round(clampRatio(1, width) * 100)}
      aria-valuenow={value}
      aria-valuetext={`Left pane ${value}%, right pane ${100 - value}%`}
      tabIndex={0}
      className="split-divider"
      onPointerDown={(event) => {
        const workspace = event.currentTarget.parentElement;
        if (!workspace || event.button !== 0) return;
        const box = workspace.getBoundingClientRect();
        const styles = getComputedStyle(workspace);
        const left = box.left + parseFloat(styles.paddingLeft || "0");
        drag.current = { left, width: width || box.width };
        dragged.current = ratio;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        if (!drag.current) return;
        move(event);
        drag.current = null;
        onChange(dragged.current, true);
      }}
      onPointerCancel={() => {
        if (!drag.current) return;
        drag.current = null;
        onChange(dragged.current, true);
      }}
      onDoubleClick={() => onChange(0.5, true)}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        const next = keyboardRatio(ratio, event.key, event.shiftKey, width);
        if (next === null) return;
        event.preventDefault();
        onChange(next, true);
      }}
    >
      <span className="split-divider-grip" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

const DIVIDER = 20;

/**
 * Clicking or tabbing into a pane makes it the focused pane. Native listeners are used
 * because the right pane's content is a portal: its React events bubble to the app root,
 * while its DOM events bubble through this pane.
 */
function usePaneFocus(side: PaneSide, enabled: boolean) {
  const { focus } = useSplitView();
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled || !element) return;
    const activate = () => focus(side);
    element.addEventListener("pointerdown", activate, true);
    element.addEventListener("focusin", activate, true);
    return () => {
      element.removeEventListener("pointerdown", activate, true);
      element.removeEventListener("focusin", activate, true);
    };
  }, [element, enabled, focus, side]);
  return setElement;
}

/**
 * The app frame's content area. On a single screen every wrapper here is layout-neutral
 * (`display: contents`), so turning split view on or off never remounts the left screen.
 */
export function SplitWorkspace({
  children,
  primaryClassName,
}: {
  children: ReactNode;
  /** Screen-specific frame classes (trading width, maps workspace) for the left pane. */
  primaryClassName?: string;
}) {
  const split = useSplitView();
  const on = split.open;
  const workspace = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!on || !element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const styles = getComputedStyle(element);
      setWidth(
        element.clientWidth -
          parseFloat(styles.paddingLeft || "0") -
          parseFloat(styles.paddingRight || "0") -
          DIVIDER,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [on]);
  const ratio = clampRatio(split.ratio, width);
  const secondary = split.secondaryHref ?? "/";
  const primaryRef = usePaneFocus("primary", on);
  const secondaryRef = usePaneFocus("secondary", on);
  return (
    <div
      ref={workspace}
      className={on ? "split-workspace" : "split-passthrough"}
      data-full={on ? split.fullWidth || undefined : undefined}
    >
      <section
        className={on ? cn("split-pane", primaryClassName) : "split-passthrough"}
        data-split-pane={on ? "primary" : undefined}
        data-focused={on && split.focused === "primary" ? "true" : undefined}
        aria-label={on ? paneLabel("primary", split.primaryHref, split.dm) : undefined}
        tabIndex={on ? -1 : undefined}
        style={on && !split.fullWidth ? { flex: `0 0 calc((100% - ${DIVIDER}px) * ${ratio})` } : undefined}
        ref={primaryRef}
      >
        {on ? <PaneHeader side="primary" href={split.primaryHref} /> : null}
        <div className={on ? "split-pane-body" : "split-passthrough"}>
          <div
            className={on ? "split-pane-scroll" : "split-passthrough"}
            data-split-scroll={on ? "primary" : undefined}
          >
            <PaneContext.Provider value={on ? PRIMARY : null}>{children}</PaneContext.Provider>
          </div>
        </div>
      </section>
      {on ? <Divider ratio={ratio} width={width} onChange={split.setRatio} /> : null}
      {on ? (
        <section
          className="split-pane"
          data-split-pane="secondary"
          data-focused={split.focused === "secondary" ? "true" : undefined}
          aria-label={paneLabel("secondary", secondary, split.dm)}
          tabIndex={-1}
          ref={secondaryRef}
        >
          <PaneHeader side="secondary" href={secondary} />
          <div className="split-pane-body">
            <div className="split-pane-scroll" data-split-scroll="secondary">
              <PaneSlot />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Class names for a screen frame, shared by the window frame and the right pane. */
export function paneFrameClass(pathname: string, dm: boolean) {
  const tradingWorkspace = ["/market", "/features/economy", "/features/trading"].includes(pathname);
  return cn(dm ? "role-dm" : "role-player", tradingWorkspace && "trading-shell");
}
