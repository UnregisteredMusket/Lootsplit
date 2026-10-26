import type { CampaignMap } from "./world-schema";

/**
 * Map workspace navigation (docs/MAP-TILES.md, "Map controls"): ← Back goes to the parent map,
 * X closes map mode to the previous in-app screen, Android Back unwinds in a fixed order.
 */

/** The parent map, only when it is in this viewer's accessible list (a hidden parent is never named). */
export function accessibleParent(maps: CampaignMap[], map: CampaignMap | undefined) {
  const id = map?.connected?.parentMapId;
  return id && id !== map?.id ? maps.find((m) => m.id === id) : undefined;
}

export type MapBackStep = "menu" | "panel" | "parent" | "close";
/** Android Back on the map: open menu/search → open panel or sheet → parent map → close the map. */
export function mapBackStep(state: {
  menu: boolean;
  panel: boolean;
  parent: boolean;
}): MapBackStep {
  if (state.menu) return "menu";
  if (state.panel) return "panel";
  if (state.parent) return "parent";
  return "close";
}

/** Where X sends a viewer: the last in-app screen before Maps, or Desk/Home on a cold start. */
const HOME = "/?view=home";
let lastScreen = "";
export function rememberScreen(pathname: string, href: string) {
  if (pathname === "/maps" || !href.startsWith("/")) return;
  lastScreen = href;
}
export function mapExitHref() {
  return lastScreen || HOME;
}
/** Test hook. */
export function resetRememberedScreen() {
  lastScreen = "";
}

export type MapViewState = { x: number; y: number; scale: number };
/**
 * A first visit (no saved, shared or entry camera) fits the whole map. Where the fitted map would
 * leave most of the screen empty (portrait phones), it zooms in only far enough to fill the screen,
 * at most 200 %, and centres on the party when the party is on this map, without showing empty
 * space past the map's edges.
 */
export function openingView({
  size,
  w,
  h,
  focus,
}: {
  size: { w: number; h: number };
  /** The map's fitted (100 %) rendered width and height. */
  w: number;
  h: number;
  /** The party (or selected group), as a 0–1 point on this map. */
  focus?: { x: number; y: number };
}): MapViewState {
  const cover = Math.min(8, Math.max(size.w / w, size.h / h));
  const scale = cover <= 1.4 ? 1 : Math.min(2, cover);
  const axis = (viewport: number, length: number, point: number | undefined) => {
    const scaled = length * scale;
    if (scaled <= viewport || point === undefined) return (viewport - scaled) / 2;
    return Math.min(0, Math.max(viewport - scaled, viewport / 2 - point * scaled));
  };
  return { scale, x: axis(size.w, w, focus?.x), y: axis(size.h, h, focus?.y) };
}
