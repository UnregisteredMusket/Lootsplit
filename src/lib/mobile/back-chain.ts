import { closeTopOverlay, isOverlayElement, runBackHandlers } from "./back-handlers.ts";

/** The topmost open modal dialog, popover or menu that is not a registered overlay. */
export function topDialog(): HTMLElement | null {
  const open = [
    ...document.querySelectorAll<HTMLElement>(
      'dialog[open], [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper] [role="menu"]',
    ),
  ].filter(
    (element) =>
      // Non-modal panels (the map's side panels) belong to their screen's own Back handler.
      element.getAttribute("aria-modal") !== "false" &&
      element.getClientRects().length > 0 &&
      !isOverlayElement(element),
  );
  return open.at(-1) ?? null;
}

/** An open `<details>` drawn as a floating menu (its panel is positioned), not a section. */
export function floatingDetails(): HTMLDetailsElement | null {
  const open = [...document.querySelectorAll<HTMLDetailsElement>("details[open]")].filter(
    (details) =>
      details.hasAttribute("data-back-close") ||
      [...details.children].some(
        (child) =>
          child.tagName !== "SUMMARY" &&
          ["absolute", "fixed"].includes(getComputedStyle(child).position),
      ),
  );
  return open.at(-1) ?? null;
}

/**
 * One Android Back press after themed confirmations (design M3; order in `back-handlers.ts`):
 * a registered overlay, the shell's own panels, the top dialog's Close button or an open Radix
 * menu or popover, a floating `<details>` menu, then the screen handlers. Returns true when
 * something consumed the press; false means navigate back (or exit at the root).
 */
export function androidBackStep(shellPanels: () => boolean = () => false): boolean {
  const dialog = topDialog();
  if (closeTopOverlay(dialog)) return true;
  if (shellPanels()) return true;
  if (dialog) {
    const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    if (close) {
      close.click();
      return true;
    }
    // An open Radix menu or popover closes on Escape, its own dismiss path.
    if (dialog.closest("[data-radix-popper-content-wrapper]")) {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return true;
    }
  }
  const menu = floatingDetails();
  if (menu) {
    menu.open = false;
    menu.querySelector("summary")?.focus({ preventScroll: true });
    return true;
  }
  // A screen's own interceptor (the map: panel, then parent map, then close the map).
  return runBackHandlers();
}
