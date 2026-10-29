/**
 * The phone radial's geometry (map tokens PR 5; mockups radial-mobile and radial-mobile-320).
 * Pure, so the gesture, the drawing and the tests agree on where each slice is.
 */
export type RadialBounds = { left: number; top: number; width: number; height: number };
export type RadialGeometry = {
  /** The wheel's centre (clamped inside the visible map), in client pixels. */
  cx: number;
  cy: number;
  /** The press point, when the wheel had to move away from it (a small pointer shows it). */
  anchor?: { x: number; y: number };
  radius: number;
  inner: number;
  /** Slice count and the angle (degrees, 0 = right, clockwise) of slice 0's centre. */
  count: number;
  start: number;
};

/** The hold before the radial opens, when the progress ring starts, and the pan threshold. */
export const RADIAL_HOLD_MS = 500;
export const RADIAL_RING_MS = 150;
export const RADIAL_SLOP_PX = 6;
/** Room kept free at the edges: the side gutter, and the bottom tool dock on portrait phones. */
const GUTTER = 16,
  TOP = 16,
  BOTTOM = 96;

export function radialGeometry(
  press: { x: number; y: number },
  count: number,
  bounds: RadialBounds,
  { player = false, moreLast = false }: { player?: boolean; moreLast?: boolean } = {},
): RadialGeometry {
  // 248 px across at 390 px wide, 216 px at 320; players' short wheel is a little smaller.
  const wide = bounds.width >= 360;
  const radius = (wide ? 124 : 108) - (player ? 16 : 0),
    inner = wide ? 44 : 40;
  const reach = radius + 6;
  // Landscape phones keep their tools in side rails, so only the gutter is kept at the bottom.
  const bottom = bounds.height < 500 ? GUTTER : BOTTOM;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  const cx = clamp(press.x, bounds.left + GUTTER + reach, bounds.left + bounds.width - GUTTER - reach),
    cy = clamp(press.y, bounds.top + TOP + reach, bounds.top + bounds.height - bottom - reach);
  // One-handed reach: a press in the top third turns the wheel so More is on the lower side.
  const topThird = press.y < bounds.top + bounds.height / 3;
  const step = 360 / count;
  const start = moreLast && topThird ? 90 - (count - 1) * step : -90;
  const moved = Math.hypot(cx - press.x, cy - press.y) > 8;
  return { cx, cy, radius, inner, count, start, ...(moved ? { anchor: press } : {}) };
}

/** The slice centre angle (degrees). */
export const sliceAngle = (g: RadialGeometry, i: number) => g.start + (i * 360) / g.count;

/** What is under a point: a slice index, the hub, or outside the wheel. */
export function radialHit(g: RadialGeometry, x: number, y: number): number | "hub" | "outside" {
  const d = Math.hypot(x - g.cx, y - g.cy);
  if (d < g.inner - 4) return "hub";
  if (d > g.radius + 6) return "outside";
  const angle = (Math.atan2(y - g.cy, x - g.cx) * 180) / Math.PI;
  const step = 360 / g.count;
  const relative = (((angle - g.start + step / 2) % 360) + 360) % 360;
  return Math.floor(relative / step) % g.count;
}

/** The SVG path of slice i (an annular sector with a small gap). */
export function slicePath(g: RadialGeometry, i: number) {
  const step = 360 / g.count,
    a0 = sliceAngle(g, i) - step / 2 + 1.2,
    a1 = a0 + step - 2.4;
  const pt = (a: number, r: number) => [g.cx + r * Math.cos((a * Math.PI) / 180), g.cy + r * Math.sin((a * Math.PI) / 180)];
  const [x1, y1] = pt(a0, g.radius),
    [x2, y2] = pt(a1, g.radius),
    [x3, y3] = pt(a1, g.inner),
    [x4, y4] = pt(a0, g.inner);
  const large = step - 2.4 > 180 ? 1 : 0;
  return `M${x1} ${y1} A${g.radius} ${g.radius} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${g.inner} ${g.inner} 0 ${large} 0 ${x4} ${y4}Z`;
}

/** Where slice i's icon and label sit. */
export function sliceLabelPoint(g: RadialGeometry, i: number) {
  const a = (sliceAngle(g, i) * Math.PI) / 180,
    r = (g.radius + g.inner) / 2;
  return { x: g.cx + r * Math.cos(a), y: g.cy + r * Math.sin(a) };
}

/**
 * The long-press tracker: starts on one finger, cancels on movement past the slop, a second
 * finger or a cancel; fires after the hold. Timers are injected so tests can drive it.
 */
export function longPress(
  fire: (pointerId: number) => void,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void } = {
    set: (f, ms) => setTimeout(f, ms),
    clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  },
) {
  let active: { id: number; x: number; y: number; timer: unknown } | undefined;
  const cancel = () => {
    if (active) timers.clear(active.timer);
    active = undefined;
  };
  return {
    down(id: number, x: number, y: number, eligible: boolean) {
      // A second finger (pinch) cancels the hold.
      if (active) return cancel();
      if (!eligible) return;
      active = { id, x, y, timer: timers.set(() => ((active = undefined), fire(id)), RADIAL_HOLD_MS) };
    },
    move(id: number, x: number, y: number) {
      if (active?.id === id && Math.hypot(x - active.x, y - active.y) > RADIAL_SLOP_PX) cancel();
    },
    up(id: number) {
      if (active?.id === id) cancel();
    },
    cancel,
    get pending() {
      return !!active;
    },
  };
}
