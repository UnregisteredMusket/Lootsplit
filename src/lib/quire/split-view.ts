import { featureScreens, safeReturn, screenName, type Feature } from "./feature-navigation.ts";

/** Split view needs the desktop/tablet-landscape breakpoint used by the app rail. */
export const SPLIT_MIN_VIEWPORT = 1024;
/** Each pane keeps at least this many CSS pixels so neither screen collapses. */
export const SPLIT_MIN_PANE = 380;
export const SPLIT_PRESETS = [0.5, 0.6] as const;
export const SPLIT_DEFAULT_RATIO = 0.5;
export const SPLIT_STORAGE_KEY = "lootsplit.split-view.v1";
export const SPLIT_SEARCH_KEY = "beside";

export type PaneSide = "primary" | "secondary";
export type PaneScreen = { key: string; href: string; title: string; group: "main" | "tools" };
export type SplitLayout = {
  /** Whether this device last had two panes open. The URL decides what a document shows. */
  open: boolean;
  /** The last screen shown beside, restored by the layout toggle. */
  beside: string;
  ratio: number;
  /** Most recent first; the first entry is marked "last used". */
  recent: string[];
};

export const DEFAULT_SPLIT_LAYOUT: SplitLayout = {
  open: false,
  beside: "",
  ratio: SPLIT_DEFAULT_RATIO,
  recent: [],
};

export function splitAvailable(viewportWidth: number) {
  return Number.isFinite(viewportWidth) && viewportWidth >= SPLIT_MIN_VIEWPORT;
}

/** Screens that render inside the app frame. Public website and account pages open in the main pane. */
const paneCapable =
  /^\/(?:|party|maps|market|share|settings|characters|library|encounters|books|catalog|favorites|(?:shop|book|read)\/[^/]+|features\/[a-z]+)$/;
// Opening a pane never replays an invitation, account callback or seat link.
const strippedEverywhere = ["as", "token", "invite", "callbackURL", "redirect", SPLIT_SEARCH_KEY];
const strippedFromShare = ["join", "invitation", "character", "session"];

export function paneCapablePath(pathname: string) {
  return paneCapable.test(pathname);
}

export function screenKey(href: string) {
  const url = new URL(href, "https://lootsplit.invalid");
  if (url.pathname === "/") return "home";
  if (url.pathname === "/share") return "chat";
  return url.pathname;
}

/** DM-only screens a player seat may never open beside (server checks stay authoritative). */
export function dmOnlyScreen(href: string) {
  const url = new URL(href, "https://lootsplit.invalid");
  if (url.pathname === "/encounters") return true;
  const feature = url.pathname.startsWith("/features/")
    ? (url.pathname.slice("/features/".length) as Feature)
    : undefined;
  return !!feature && Object.hasOwn(featureScreens, feature) && featureScreens[feature].dm;
}

/** Normalize a requested pane destination, or return null when it is not allowed for this seat. */
export function sanitizePaneHref(value: unknown, dm: boolean): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 600) return null;
  const safe = safeReturn(value);
  const requested = new URL(value, "https://lootsplit.invalid");
  if (safe === "/?view=home" && requested.pathname !== "/") return null;
  const url = new URL(safe, "https://lootsplit.invalid");
  if (!paneCapable.test(url.pathname)) return null;
  if (url.pathname.startsWith("/features/")) {
    const feature = url.pathname.slice("/features/".length);
    if (!Object.hasOwn(featureScreens, feature)) return null;
  }
  if (!dm && dmOnlyScreen(url.pathname)) return null;
  for (const key of strippedEverywhere) url.searchParams.delete(key);
  if (url.pathname === "/share") for (const key of strippedFromShare) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}

/** Read the `beside` search value (raw URL search string or a parsed router search object). */
export function besideFromSearch(search: unknown, dm: boolean): string | null {
  let value: unknown;
  if (typeof search === "string") value = new URLSearchParams(search).get(SPLIT_SEARCH_KEY);
  else if (search && typeof search === "object")
    value = (search as Record<string, unknown>)[SPLIT_SEARCH_KEY];
  return sanitizePaneHref(value, dm);
}

/** Add or remove the pane destination on a URL; other parameters stay as they are. */
export function withBeside(href: string, beside: string | null) {
  const url = new URL(href, "https://lootsplit.invalid");
  if (beside) url.searchParams.set(SPLIT_SEARCH_KEY, beside);
  else url.searchParams.delete(SPLIT_SEARCH_KEY);
  return url.pathname + url.search + url.hash;
}

/** The same role-filtered destinations as Tabs & windows. */
export function paneScreens(dm: boolean): PaneScreen[] {
  const main: Omit<PaneScreen, "key" | "group">[] = [
    { href: "/?view=home", title: dm ? "DM Desk" : "Home" },
    { href: "/characters", title: "Character sheet" },
    { href: "/party", title: dm ? "Party" : "Party & inventory" },
    { href: "/market", title: "Market" },
    { href: "/library", title: "Library" },
    { href: "/maps", title: "Maps" },
    ...(dm ? [{ href: "/encounters", title: "Encounters" }] : []),
    { href: "/share?tab=chat", title: "Campaign chat" },
  ];
  const tools = Object.entries(featureScreens)
    .filter(([id, f]) => (!f.dm || dm) && !(dm && id === "finances"))
    .map(([id, f]) => ({ href: `/features/${id}`, title: f.title }));
  return [
    ...main.map((s) => ({ ...s, key: screenKey(s.href), group: "main" as const })),
    ...tools.map((s) => ({ ...s, key: screenKey(s.href), group: "tools" as const })),
  ];
}

export function paneTitle(href: string, dm: boolean) {
  const key = screenKey(href);
  return paneScreens(dm).find((s) => s.key === key)?.title || screenName(href, dm);
}

export function paneLabel(side: PaneSide, href: string, dm: boolean) {
  return `${side === "primary" ? "Left" : "Right"} pane: ${paneTitle(href, dm)}`;
}

/** Pick what the layout toggle opens: the last screen used beside, else the first other main screen. */
export function defaultBeside(layout: SplitLayout, primaryHref: string, dm: boolean) {
  const primary = screenKey(primaryHref);
  for (const candidate of [layout.beside, ...layout.recent]) {
    const safe = sanitizePaneHref(candidate, dm);
    if (safe && screenKey(safe) !== primary) return safe;
  }
  const preferred = ["/market", "/party", "/?view=home"];
  for (const href of preferred) if (screenKey(href) !== primary) return href;
  return "/library";
}

export function rememberBeside(layout: SplitLayout, href: string): SplitLayout {
  const key = screenKey(href);
  const recent = [href, ...layout.recent.filter((r) => screenKey(r) !== key)].slice(0, 6);
  return { ...layout, open: true, beside: href, recent };
}

function minRatio(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 0.25;
  return Math.min(0.5, SPLIT_MIN_PANE / width);
}

/** Keep both panes at least SPLIT_MIN_PANE wide inside `width` (the space shared by the panes). */
export function clampRatio(ratio: number, width: number) {
  const min = minRatio(width);
  const value = Number.isFinite(ratio) ? ratio : SPLIT_DEFAULT_RATIO;
  return Math.round(Math.min(1 - min, Math.max(min, value)) * 1000) / 1000;
}

/** Dragging close to a preset (50/50, 60/40 or 40/60) settles exactly on it. */
export function snapRatio(ratio: number) {
  for (const preset of [0.4, 0.5, 0.6]) if (Math.abs(ratio - preset) < 0.015) return preset;
  return ratio;
}

/** Keyboard resizing for the divider: arrows move 5% (1% with Shift), Home/End reach the limits. */
export function keyboardRatio(ratio: number, key: string, shift: boolean, width: number) {
  const step = shift ? 0.01 : 0.05;
  const current = clampRatio(ratio, width);
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampRatio(Math.round((current - step) * 100) / 100, width);
    case "ArrowRight":
    case "ArrowUp":
      return clampRatio(Math.round((current + step) * 100) / 100, width);
    case "Home":
      return clampRatio(0, width);
    case "End":
      return clampRatio(1, width);
    case "Enter":
      return SPLIT_DEFAULT_RATIO;
    default:
      return null;
  }
}

function localPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && value.length <= 600;
}

export function readSplitLayout(storage: Pick<Storage, "getItem"> | undefined): SplitLayout {
  try {
    const raw = storage?.getItem(SPLIT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SPLIT_LAYOUT };
    const value = JSON.parse(raw) as Partial<SplitLayout>;
    const recent = Array.isArray(value.recent)
      ? value.recent.filter((r): r is string => localPath(r)).slice(0, 6)
      : [];
    return {
      open: value.open === true,
      beside: localPath(value.beside) ? value.beside : "",
      ratio:
        typeof value.ratio === "number" && value.ratio > 0 && value.ratio < 1
          ? value.ratio
          : SPLIT_DEFAULT_RATIO,
      recent,
    };
  } catch {
    return { ...DEFAULT_SPLIT_LAYOUT };
  }
}

export function writeSplitLayout(storage: Pick<Storage, "setItem"> | undefined, layout: SplitLayout) {
  try {
    storage?.setItem(SPLIT_STORAGE_KEY, JSON.stringify(layout));
    return true;
  } catch {
    // Private windows and blocked storage keep the layout for this document only.
    return false;
  }
}

/**
 * Root search middleware: navigation inside the main (left) pane keeps the pane beside it.
 * Passing `beside: undefined` explicitly closes it.
 */
export function retainBeside({ search, next }: { search: any; next: (search: any) => any }) {
  const result = next(search);
  if (
    search &&
    typeof search[SPLIT_SEARCH_KEY] === "string" &&
    result &&
    typeof result === "object" &&
    !Object.hasOwn(result, SPLIT_SEARCH_KEY)
  )
    return { ...result, [SPLIT_SEARCH_KEY]: search[SPLIT_SEARCH_KEY] };
  return result;
}
