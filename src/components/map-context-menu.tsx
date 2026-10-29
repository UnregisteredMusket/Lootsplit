import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { registerBackOverlay } from "@/lib/mobile/back-handlers";

/** One map action (map tokens PR 4): the right-click menu, the phone radial and its More sheet. */
export type MapAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown at the right: "⇧R", "P", "Enter", or a note such as "SRD" or "Large 2×2". */
  shortcut?: string;
  /** `aria-keyshortcuts` for the shortcut, when it is a real key. */
  keys?: string;
  /** Right-aligned muted text when the action is unavailable ("none selected"). */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** A checkable option inside a submenu ("Players' scene follows"). */
  checked?: boolean;
  submenu?: { title?: string; groups: MapActionGroup[] };
  run?: () => void;
  /** A checkable option: toggling it keeps the menu open. */
  keepOpen?: boolean;
};
export type MapActionGroup = { label?: string; items: MapAction[] };
export type MapActionMenu = { title: string; subtitle: string; groups: MapActionGroup[] };

const flat = (groups: MapActionGroup[]) => groups.flatMap((g) => g.items);

/**
 * The map's right-click menu (mockup context-menu-desktop): `role="menu"` at the pointer (or the
 * keyboard crosshair), sections as `role="group"` with a label, submenus to the right. Keys: ↑/↓,
 * Home/End, → opens a submenu, ← or Esc closes it, Enter/Space activates, a letter jumps. Focus
 * returns to the map (or the token) when it closes.
 */
export function MapContextMenu({
  menu,
  x,
  y,
  bounds,
  close,
  sheet = false,
  initialSubmenu,
}: {
  menu: MapActionMenu;
  x: number;
  y: number;
  /** The visible area the menu must stay inside (the map viewport). */
  bounds: { left: number; top: number; width: number; height: number };
  close: (activated: boolean) => void;
  /** Phones' More (map tokens PR 5): a bottom sheet; a submenu replaces the list, with Back. */
  sheet?: boolean;
  /** Open at this submenu (the radial's More for a long list). */
  initialSubmenu?: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    [submenu, setSubmenu] = useState<string | undefined>(initialSubmenu),
    submenuByKey = useRef(false),
    [place, setPlace] = useState({ left: x, top: y, flip: false }),
    items = flat(menu.groups).filter((i) => !i.disabled);
  useLayoutEffect(() => {
    // Keep the menu inside the map: flip left or up near an edge.
    const el = root.current;
    if (!el) return;
    const w = el.offsetWidth,
      h = el.offsetHeight;
    const left = Math.max(bounds.left + 8, Math.min(x, bounds.left + bounds.width - w - 8));
    setPlace({
      left,
      top: Math.max(bounds.top + 8, Math.min(y, bounds.top + bounds.height - h - 8)),
      // Submenus open to the left when there is no room on the right.
      flip: left + w + 338 > bounds.left + bounds.width,
    });
  }, [x, y, bounds.left, bounds.top, bounds.width, bounds.height]);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, []);
  // Android Back closes the menu (or its submenu first).
  const latest = useRef({ submenu, close });
  latest.current = { submenu, close };
  useEffect(
    () =>
      registerBackOverlay({
        close: () => (latest.current.submenu ? setSubmenu(undefined) : latest.current.close(false)),
        element: () => root.current,
      }),
    [],
  );
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".map-context-menu")) close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [close]);
  const activate = (item: MapAction, byKey = false) => {
    if (item.disabled) return;
    if (item.submenu) {
      submenuByKey.current = byKey || submenu === item.id;
      setSubmenu(undefined);
      requestAnimationFrame(() => setSubmenu(item.id));
      return;
    }
    if (item.keepOpen) {
      item.run?.();
      return;
    }
    close(true);
    item.run?.();
  };
  const keys = (event: KeyboardEvent<HTMLElement>, list: MapAction[], inSub: boolean) => {
    const focusable = [...(event.currentTarget.querySelectorAll<HTMLElement>(':scope > [role="group"] > [role^="menuitem"]:not([aria-disabled="true"]), :scope > .map-action-sheet-body > [role="group"] > [role^="menuitem"]:not([aria-disabled="true"]), :scope > [role^="menuitem"]:not([aria-disabled="true"])'))];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => focusable[(i + focusable.length) % focusable.length]?.focus();
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(focusable.length - 1);
    else if (event.key === "ArrowRight" && !inSub) {
      const item = list.find((i) => i.id === (document.activeElement as HTMLElement)?.dataset.action);
      if (item?.submenu) activate(item, true);
      else return;
    } else if (event.key === "ArrowLeft" && inSub) {
      const parent = submenu;
      setSubmenu(undefined);
      requestAnimationFrame(() =>
        root.current?.querySelector<HTMLElement>(`[data-action="${parent}"]`)?.focus(),
      );
    } else if (event.key === "Escape") {
      if (inSub) {
        const parent = submenu;
        setSubmenu(undefined);
        requestAnimationFrame(() =>
          root.current?.querySelector<HTMLElement>(`[data-action="${parent}"]`)?.focus(),
        );
      } else close(false);
    } else if (event.key === "Tab") {
      close(false);
    } else if (event.key === "Enter" || event.key === " ") {
      const item = list.find((i) => i.id === (document.activeElement as HTMLElement)?.dataset.action);
      if (item) activate(item, true);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      // A letter jumps to the next item starting with it.
      const letter = event.key.toLowerCase();
      const order = [...focusable.slice(index + 1), ...focusable.slice(0, index + 1)];
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(letter))?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const open = submenu ? flat(menu.groups).find((i) => i.id === submenu) : undefined;
  const renderItems = (groups: MapActionGroup[], inSub: boolean) =>
    groups.map((group, g) => (
      <div
        key={g}
        role="group"
        aria-label={group.label}
        className={group.label ? "map-menu-group" : "map-menu-group plain"}
      >
        {group.label && (
          <div className="map-menu-caption" aria-hidden="true">
            {group.label}
          </div>
        )}
        {group.items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-action={item.id}
            role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.submenu ? "menu" : undefined}
            aria-expanded={item.submenu ? submenu === item.id : undefined}
            aria-keyshortcuts={item.keys}
            tabIndex={-1}
            className={`map-menu-item${item.danger ? " danger" : ""}${submenu === item.id ? " open" : ""}`}
            onClick={() => activate(item)}
            onPointerEnter={() => {
              if (inSub || submenu === item.id) return;
              submenuByKey.current = false;
              setSubmenu(item.submenu && !item.disabled ? item.id : undefined);
            }}
          >
            <span className="map-menu-icon" aria-hidden="true">
              {item.checked !== undefined ? item.checked ? <Check size={16} /> : null : item.icon}
            </span>
            <span className="map-menu-label">{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
            {item.shortcut && !item.submenu && <kbd>{item.shortcut}</kbd>}
            {item.submenu && (
              <>
                {item.shortcut && <small>{item.shortcut}</small>}
                <ChevronRight size={15} className="map-menu-arrow" aria-hidden="true" />
              </>
            )}
          </button>
        ))}
      </div>
    ));
  if (sheet)
    return (
      <div
        ref={root}
        className="map-context-menu map-action-sheet map-glass"
        role="menu"
        aria-label={open ? open.label : `${menu.title} · ${menu.subtitle}`}
        onKeyDown={(e) => keys(e, open?.submenu ? flat(open.submenu.groups) : items, !!open)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="map-sheet-grab" aria-hidden="true" />
        <div className="map-menu-header" aria-hidden="true">
          <b>{open ? open.label : menu.title}</b>
          <span>{menu.subtitle}</span>
        </div>
        <div className="map-action-sheet-body" key={open?.id ?? "main"} ref={(el) => {
          if (el && !el.dataset.ready) {
            el.dataset.ready = "1";
            el.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
          }
        }}>
          {open?.submenu ? (
            <>
              <div role="group" className="map-menu-group plain">
                <button
                  type="button"
                  role="menuitem"
                  data-action="back"
                  tabIndex={-1}
                  className="map-menu-item"
                  onClick={() => setSubmenu(undefined)}
                >
                  <span className="map-menu-icon" aria-hidden="true">
                    <ChevronLeft size={16} />
                  </span>
                  <span className="map-menu-label">Back</span>
                </button>
              </div>
              {renderItems(open.submenu.groups, true)}
            </>
          ) : (
            renderItems(menu.groups, false)
          )}
        </div>
      </div>
    );
  return (
    <div
      ref={root}
      className={`map-context-menu map-glass${place.flip ? " flip" : ""}`}
      role="menu"
      aria-label={`${menu.title} · ${menu.subtitle}`}
      style={{ left: place.left, top: place.top }}
      onKeyDown={(e) => keys(e, items, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="map-menu-header" aria-hidden="true">
        <b>{menu.title}</b>
        <span>{menu.subtitle}</span>
      </div>
      {renderItems(menu.groups, false)}
      {open?.submenu && (
        <div
          key={open.id}
          className="map-context-submenu map-glass"
          role="menu"
          aria-label={open.label}
          onKeyDown={(e) => keys(e, flat(open.submenu!.groups), true)}
          ref={(el) => {
            if (!el || el.dataset.ready) return;
            el.dataset.ready = "1";
            // Beside its item, kept inside the visible area.
            const item = root.current?.querySelector<HTMLElement>(`[data-action="${open.id}"]`);
            const top = (item?.offsetTop ?? 0) - 8,
              outer = root.current!.getBoundingClientRect().top;
            const room = bounds.top + bounds.height - 8 - (outer + top + el.offsetHeight);
            el.style.top = `${Math.max(bounds.top + 8 - outer, top + Math.min(0, room))}px`;
            if (submenuByKey.current)
              el.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
          }}
        >
          {open.submenu.title && (
            <div className="map-menu-caption" aria-hidden="true">
              {open.submenu.title}
            </div>
          )}
          {renderItems(open.submenu.groups, true)}
        </div>
      )}
    </div>
  );
}
