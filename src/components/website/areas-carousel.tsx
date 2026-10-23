import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Pause, Play } from "lucide-react";
import type { ProductShot } from "@/lib/website/product-shots";
import { Shot } from "./parts";

/** Pixels per second; slow enough to read a card as it passes (owner request 2026-10-23). */
const SPEED = 28;
/** After someone scrolls, drags or focuses a card, wait this long before drifting again. */
const RESUME_AFTER_MS = 4000;

export type Area = [shot: ProductShot, anchor: string, title: string, text: string];

/**
 * "Everything around the ledger": one horizontally scrollable row of screenshot cards that
 * drifts slowly and loops. Anyone can scroll it by hand; it pauses on hover, focus, touch and
 * while off screen, never moves for reduced-motion visitors, and has a pause button (WCAG 2.2.2).
 * The second copy of the cards exists only for the seamless loop and is hidden from assistive
 * technology and the tab order.
 */
export function AreasCarousel({ areas }: { areas: Area[] }) {
  const track = useRef<HTMLDivElement>(null);
  const firstSet = useRef<HTMLUListElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    setReduced(Boolean(media?.matches));
    const change = () => setReduced(Boolean(media?.matches));
    media?.addEventListener?.("change", change);
    return () => media?.removeEventListener?.("change", change);
  }, []);

  useEffect(() => {
    const el = track.current;
    const set = firstSet.current;
    if (!el || !set || reduced) return;
    let frame = 0;
    let last = 0;
    let pos = el.scrollLeft;
    let written = el.scrollLeft;
    let holdUntil = 0;
    let hovering = false;
    let visible = true;
    const hold = () => {
      holdUntil = performance.now() + RESUME_AFTER_MS;
    };
    const loopWidth = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      return set.getBoundingClientRect().width + gap;
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      const busy =
        pausedRef.current ||
        hovering ||
        !visible ||
        now < holdUntil ||
        el.matches(":focus-within") ||
        document.hidden;
      if (!busy) {
        const width = loopWidth();
        pos += SPEED * dt;
        if (width > 0 && pos >= width) pos -= width;
        const next = Math.round(pos);
        if (next !== written) {
          el.scrollLeft = next;
          written = el.scrollLeft;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const onScroll = () => {
      // A scroll we did not write came from the visitor: follow it and wait before drifting.
      if (Math.abs(el.scrollLeft - written) > 1) {
        const width = loopWidth();
        if (width > 0 && el.scrollLeft >= width) el.scrollLeft -= width;
        pos = written = el.scrollLeft;
        hold();
      }
    };
    const enter = () => (hovering = true);
    const leave = () => (hovering = false);
    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver(([entry]) => (visible = entry?.isIntersecting ?? true))
        : null;
    observer?.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", hold);
    el.addEventListener("touchstart", hold, { passive: true });
    el.addEventListener("wheel", hold, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", hold);
      el.removeEventListener("touchstart", hold);
      el.removeEventListener("wheel", hold);
    };
  }, [reduced]);

  const cards = (copy: boolean) =>
    areas.map(([shot, anchor, title, text]) => (
      <li key={title}>
        <Link className="ls-area" to="/features" hash={anchor} tabIndex={copy ? -1 : undefined}>
          <h3>{title}</h3>
          <Shot name={shot} size="inset" />
          <p>{text}</p>
        </Link>
      </li>
    ));

  return (
    <div className="ls-carousel">
      <div
        ref={track}
        className="ls-carousel-track"
        role="region"
        aria-roledescription="carousel"
        aria-label="Lootsplitter's eight areas; scroll sideways to see them all"
        tabIndex={0}
      >
        <ul ref={firstSet} className="ls-areas ls-areas-row">
          {cards(false)}
        </ul>
        {!reduced && (
          <ul className="ls-areas ls-areas-row" aria-hidden="true" data-loop-copy="">
            {cards(true)}
          </ul>
        )}
      </div>
      {!reduced && (
        <button
          type="button"
          className="ls-carousel-toggle"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
        >
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          {paused ? "Play the scrolling" : "Pause the scrolling"}
        </button>
      )}
    </div>
  );
}
