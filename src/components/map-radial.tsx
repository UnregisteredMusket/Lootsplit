import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { registerBackOverlay } from "@/lib/mobile/back-handlers";
import {
  RADIAL_HOLD_MS,
  RADIAL_RING_MS,
  sliceLabelPoint,
  slicePath,
  type RadialGeometry,
} from "@/lib/quire/radial-geometry";

export type RadialItem = { id: string; label: string; pill: string; icon: ReactNode; disabled?: boolean };

/**
 * The phone's press-and-hold radial (map tokens PR 5; mockups radial-mobile, radial-mobile-320).
 * Slide onto a slice and release, or lift in the centre and tap a slice. The same `role="menu"`
 * as the desktop menu: slices are `menuitem`s in clockwise order, so TalkBack swipes through
 * them. The hub closes it; so do a tap outside, Esc and Android Back.
 */
export function MapRadial({
  geometry: g,
  items,
  hub,
  hubLabel,
  hot,
  pill,
  pick,
  close,
  label,
  tapsFrom = 0,
}: {
  geometry: RadialGeometry;
  items: RadialItem[];
  hub: ReactNode;
  hubLabel: string;
  /** The slice under the finger (sliding) or focused. */
  hot?: number;
  /** The pill above the wheel ("Place party here · cluster, 4 tokens"). */
  pill?: string;
  pick: (index: number) => void;
  close: () => void;
  label: string;
  /** Clicks before this time are the lift that left the wheel open, not a tap. */
  tapsFrom?: number;
}) {
  const tapped = () => Date.now() >= tapsFrom;
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => registerBackOverlay({ close: () => latest.current(), element: () => root.current }), []);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (["ArrowRight", "ArrowDown"].includes(event.key)) buttons[(index + 1) % buttons.length]?.focus();
    else if (["ArrowLeft", "ArrowUp"].includes(event.key)) buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    else if (event.key === "Escape") close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const top = g.cy - g.radius - 56;
  return (
    <div
      ref={root}
      className="map-radial"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="map-radial-wheel" aria-hidden="true">
        <circle cx={g.cx} cy={g.cy} r={g.radius + 6} className="map-radial-ring" />
        {g.anchor && (
          <>
            <line x1={g.cx} y1={g.cy} x2={g.anchor.x} y2={g.anchor.y} className="map-radial-pointer" />
            <circle cx={g.anchor.x} cy={g.anchor.y} r={5} className="map-radial-point" />
          </>
        )}
        {items.map((item, i) => (
          <path
            key={item.id}
            d={slicePath(g, i)}
            className={`${i === hot ? "hot" : ""}${item.disabled ? " disabled" : ""}`}
            onClick={() => tapped() && !item.disabled && pick(i)}
          />
        ))}
        <circle cx={g.cx} cy={g.cy} r={g.inner - 4} className="map-radial-hub" />
      </svg>
      <div role="menu" aria-label={label} onKeyDown={keys}>
        {items.map((item, i) => {
          const at = sliceLabelPoint(g, i);
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              aria-label={item.pill}
              aria-disabled={item.disabled || undefined}
              data-slice={item.id}
              className={`map-radial-slice${i === hot ? " hot" : ""}`}
              style={{ left: at.x, top: at.y }}
              onClick={() => tapped() && !item.disabled && pick(i)}
            >
              {item.icon}
              <small>{item.label}</small>
            </button>
          );
        })}
        <button
          type="button"
          role="menuitem"
          aria-label={hubLabel}
          className="map-radial-hubtext"
          style={{ left: g.cx, top: g.cy }}
          onClick={() => tapped() && close()}
        >
          {hub}
        </button>
      </div>
      {pill && (
        <div className="map-radial-pill map-glass" role="status" style={{ left: g.cx, top: Math.max(8, top) }}>
          <b>{pill.split(" · ")[0]}</b>
          {pill.includes(" · ") && ` · ${pill.split(" · ").slice(1).join(" · ")}`}
        </div>
      )}
    </div>
  );
}

/** "Keep holding for map actions": a ring that fills from 150 to 500 ms at the press point. */
export function RadialProgress({ x, y }: { x: number; y: number }) {
  return (
    <div className="map-radial-progress" style={{ left: x, top: y }} aria-hidden="true">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="30" className="track" />
        <circle
          cx="36"
          cy="36"
          r="30"
          className="fill"
          style={{ animationDuration: `${RADIAL_HOLD_MS - RADIAL_RING_MS}ms`, animationDelay: `${RADIAL_RING_MS}ms` }}
        />
      </svg>
      <span className="map-radial-hint map-glass">Keep holding for map actions</span>
    </div>
  );
}
