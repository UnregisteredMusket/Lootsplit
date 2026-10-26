import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ProductShot } from "@/lib/website/product-shots";
import { Shot } from "./parts";

export type Area = [shot: ProductShot, anchor: string, title: string, text: string];

/**
 * "Everything around the ledger": one horizontally scrollable row of screenshot cards that
 * the visitor moves (W-4, A9). It never moves by itself: swipe, scroll, use the keyboard or
 * the previous/next buttons. Cards snap into place, and each opens its Features section.
 */
export function AreasCarousel({ areas }: { areas: Area[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const step = (direction: 1 | -1) => {
    const el = track.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(card.parentElement!).columnGap || "0") || 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: reduce ? "auto" : "smooth",
    });
  };

  return (
    <div className="ls-carousel">
      <div
        ref={track}
        className="ls-carousel-track"
        role="region"
        aria-label="Lootsplitter's eight areas; scroll sideways to see them all"
        tabIndex={0}
      >
        <ul className="ls-areas ls-areas-row">
          {areas.map(([shot, anchor, title, text]) => (
            <li key={title}>
              <Link className="ls-area" to="/features" hash={anchor}>
                <h3>{title}</h3>
                <Shot name={shot} size="inset" />
                <p>{text}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="ls-carousel-controls">
        <button
          type="button"
          className="ls-carousel-step"
          onClick={() => step(-1)}
          disabled={edges.start}
          aria-label="Previous areas"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ls-carousel-step"
          onClick={() => step(1)}
          disabled={edges.end}
          aria-label="Next areas"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
