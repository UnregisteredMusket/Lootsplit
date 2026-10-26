/**
 * Android hardware Back, in the order the shell asks (design M3):
 *
 * 1. an open themed confirmation or prompt (`dismissDialog`);
 * 2. the newest registered **overlay** (a popover, sheet or menu that registered while open),
 *    unless a modal dialog was opened over it;
 * 3. the shell's own Campaigns and Settings panels;
 * 4. the topmost `[role=dialog]`'s Close button, or an open floating Radix menu or popover;
 * 5. the screen-level **handlers** below (newest first; the map: panel, parent map, close);
 * 6. `history.back()`, and at the app root "Press back again to exit" (`rootBack`).
 *
 * A handler returns true when it consumed the press.
 */
type BackHandler = () => boolean;
const handlers: BackHandler[] = [];

export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** Runs the newest handler first; returns true as soon as one consumes the press. */
export function runBackHandlers(): boolean {
  for (const handler of [...handlers].reverse()) if (handler()) return true;
  return false;
}

/** Something that contains a DOM node (an Element in the app; a stub in tests). */
type Container = { contains(node: unknown): boolean };

export type BackOverlay = {
  close: () => void;
  /** The overlay's own element, so a dialog opened on top of it is closed first. */
  element?: () => Container | null;
};
const overlays: BackOverlay[] = [];

/** Registers an open overlay; call the returned function when it closes or unmounts. */
export function registerBackOverlay(overlay: BackOverlay): () => void {
  overlays.push(overlay);
  return () => {
    const index = overlays.lastIndexOf(overlay);
    if (index >= 0) overlays.splice(index, 1);
  };
}

/**
 * Closes the newest overlay. `topDialog` is the topmost open modal dialog that is not itself an
 * overlay: when one exists and does not contain the overlay, the dialog sits above it and must
 * close first, so nothing is consumed here.
 */
export function closeTopOverlay(topDialog: Container | null): boolean {
  const top = overlays.at(-1);
  if (!top) return false;
  if (topDialog) {
    const element = top.element?.() ?? null;
    if (!element || !topDialog.contains(element)) return false;
  }
  top.close();
  return true;
}

/** Whether an element belongs to a registered overlay (it is not a dialog of its own). */
export function isOverlayElement(node: unknown): boolean {
  return overlays.some((overlay) => {
    const element = overlay.element?.();
    return !!element && (element === node || element.contains(node));
  });
}

/** How long a second Back press at the app root exits instead of warning. */
export const EXIT_WINDOW_MS = 2000;

/**
 * At the app root Back exits only on a second press within 2 s while a campaign is open, so a
 * stray press mid-session never closes the app. With no campaign open it exits at once.
 */
export function rootBack(
  state: { campaignOpen: boolean; lastPress: number | null },
  now: number,
): "exit" | "warn" {
  if (!state.campaignOpen) return "exit";
  return state.lastPress !== null && now - state.lastPress <= EXIT_WINDOW_MS ? "exit" : "warn";
}
