import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  TOOL_NAMES_KEY,
  mapLayout,
  nextRovingIndex,
  readToolNames,
  type MapLayout,
  type ToolNames,
} from "@/lib/quire/map-toolbar";

/** The map's layout, from the window size (rails on desktop and landscape phones, bars on phones). */
const subscribeSize = (notify: () => void) => {
  window.addEventListener("resize", notify);
  window.visualViewport?.addEventListener("resize", notify);
  return () => {
    window.removeEventListener("resize", notify);
    window.visualViewport?.removeEventListener("resize", notify);
  };
};
export function useMapLayout(): MapLayout {
  return useSyncExternalStore(
    subscribeSize,
    () => mapLayout(window.innerWidth, window.innerHeight),
    () => "desktop",
  );
}

/** The per-device "Show tool names" preference, shared by the rail, its hint and Settings. */
const listeners = new Set<() => void>();
let toolNamesCache: ToolNames | undefined;
function readStoredToolNames(): ToolNames {
  if (toolNamesCache) return toolNamesCache;
  try {
    toolNamesCache = readToolNames(window.localStorage.getItem(TOOL_NAMES_KEY));
  } catch {
    toolNamesCache = "first-use";
  }
  return toolNamesCache;
}
export function setToolNames(value: ToolNames) {
  toolNamesCache = value;
  try {
    window.localStorage.setItem(TOOL_NAMES_KEY, value);
  } catch {
    // Private windows: the choice lasts for this document only.
  }
  for (const notify of listeners) notify();
}
export function useToolNames(): ToolNames {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    readStoredToolNames,
    () => "first-use",
  );
}

const TOOL = "[data-map-tool]";
const visibleTools = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>(TOOL)].filter(
    (b) => !b.disabled && b.getClientRects().length > 0 && !b.closest("[hidden]"),
  );

// Focus tooltips only follow keyboard navigation (not a tap or click that also focuses).
let keyboardFocus = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => (keyboardFocus = true), true);
  window.addEventListener("pointerdown", () => (keyboardFocus = false), true);
}

type Tip = { text: string; top: number; left: number; side: "left" | "top" };

/**
 * A toolbar with one Tab stop: arrows move along it, Home/End jump to the ends (roving tabindex).
 * It also shows each tool's name and shortcut as a tooltip on hover, keyboard focus and a 500 ms
 * long-press (drawn outside the scrolling bar so it is never clipped).
 */
export function MapToolbar({
  label,
  orientation,
  className,
  children,
}: {
  label: string;
  orientation: "vertical" | "horizontal";
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null),
    current = useRef<HTMLButtonElement | null>(null),
    press = useRef<{ timer?: number; fired: boolean }>({ fired: false });
  const [tip, setTip] = useState<Tip>();
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const tools = visibleTools(el);
    const active =
      (current.current && tools.includes(current.current) && current.current) ||
      tools.find((b) => b.getAttribute("aria-pressed") === "true") ||
      tools[0];
    for (const b of el.querySelectorAll<HTMLButtonElement>(TOOL))
      b.tabIndex = b === active ? 0 : -1;
  });
  const show = (tool: HTMLElement) => {
    const host = root.current?.parentElement;
    if (!host || tool.closest("[data-tool-names]")) return;
    const r = tool.getBoundingClientRect(),
      h = host.getBoundingClientRect();
    setTip(
      orientation === "vertical"
        ? { text: tool.dataset.tip ?? "", side: "left", top: r.top - h.top + r.height / 2, left: r.left - h.left }
        : { text: tool.dataset.tip ?? "", side: "top", top: r.top - h.top, left: r.left - h.left + r.width / 2 },
    );
  };
  const toolAt = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest?.<HTMLButtonElement>(TOOL) ?? null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = toolAt(e.target);
    if (!target || !root.current) return;
    const tools = visibleTools(root.current);
    const next = nextRovingIndex(tools.length, tools.indexOf(target), e.key, orientation);
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    for (const b of tools) b.tabIndex = -1;
    tools[next].tabIndex = 0;
    current.current = tools[next];
    tools[next].focus();
    tools[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  return (
    <>
      <div
        ref={root}
        role="toolbar"
        aria-label={label}
        aria-orientation={orientation}
        className={className}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          const tool = toolAt(e.target);
          if (!tool) return;
          current.current = tool;
          if (keyboardFocus) show(tool);
        }}
        onBlur={() => setTip(undefined)}
        onPointerOver={(e) => {
          const tool = toolAt(e.target);
          if (tool && e.pointerType === "mouse") show(tool);
        }}
        onPointerOut={(e) => {
          if (e.pointerType === "mouse") setTip(undefined);
        }}
        onPointerDown={(e) => {
          const tool = toolAt(e.target);
          press.current.fired = false;
          window.clearTimeout(press.current.timer);
          if (!tool || e.pointerType === "mouse") return;
          press.current.timer = window.setTimeout(() => {
            press.current.fired = true;
            show(tool);
          }, 500);
        }}
        onPointerUp={() => {
          window.clearTimeout(press.current.timer);
          if (press.current.fired) window.setTimeout(() => setTip(undefined), 1500);
        }}
        onPointerCancel={() => window.clearTimeout(press.current.timer)}
        onScroll={() => setTip(undefined)}
        onContextMenu={(e) => {
          if (press.current.fired) e.preventDefault();
        }}
        onClickCapture={(e) => {
          // A long-press shows the name; it does not also activate the tool.
          if (press.current.fired) {
            press.current.fired = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {children}
      </div>
      {tip?.text && (
        <span
          className="map-tool-tip"
          role="presentation"
          data-side={tip.side}
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.text}
        </span>
      )}
    </>
  );
}

/** A captioned group of tools; captions and dividers show on desktop rails only. */
export function MapToolGroup({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="map-tool-group" role="group" aria-label={caption}>
      <span className="map-tool-caption" aria-hidden="true">
        {caption}
      </span>
      {children}
    </div>
  );
}

/** One tool: icon, visible name (labels mode), shortcut and an optional count badge. */
export function MapTool({
  icon,
  label,
  name,
  shortcut,
  keys,
  badge,
  badgeLabel,
  pressed,
  expanded,
  controls,
  disabled,
  className,
  onClick,
}: {
  icon: ReactNode;
  /** The accessible name (kept stable for audits and assistive technology). */
  label: string;
  /** The visible name, when it differs from the accessible name. */
  name?: string;
  shortcut?: string;
  keys?: string;
  badge?: string | number;
  badgeLabel?: string;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`map-icon-button map-tool${className ? ` ${className}` : ""}`}
      data-map-tool=""
      data-tip={shortcut ? `${name ?? label} · ${shortcut}` : (name ?? label)}
      aria-label={label}
      aria-keyshortcuts={keys}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="map-tool-label">{name ?? label}</span>
      {badge !== undefined && badge !== "" && (
        <span className="map-tool-badge" aria-label={badgeLabel}>
          {badge}
        </span>
      )}
      {shortcut && (
        <kbd className="map-tool-key" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

/** First use: tool names are showing; "Hide names" or "Keep showing" dismisses the hint. */
export function ToolNamesHint() {
  const names = useToolNames();
  if (names !== "first-use") return null;
  return (
    <section className="map-tool-names-hint map-glass" aria-label="Tool names are showing">
      <h2>Tool names are showing</h2>
      <p>
        Play tools are on the right. Hover, focus or long-press any icon to see its name later.
      </p>
      <div>
        <button type="button" className="map-hint-primary" onClick={() => setToolNames("hidden")}>
          Hide names
        </button>
        <button type="button" onClick={() => setToolNames("shown")}>
          Keep showing
        </button>
      </div>
    </section>
  );
}
