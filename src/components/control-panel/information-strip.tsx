import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./desk-tiles.css";

/**
 * Desk Information (design D4). Wide screens show the panels as a 3×2 grid of compact tiles, all
 * visible at once. Phones and narrow panes keep the swipe strip, with one row of dots as its only
 * pager (each dot is a button named after its panel, so every panel stays one tap or Tab away).
 */
export function InformationStrip({
  panels,
  resetKey,
}: {
  panels: { name: string; content: ReactNode }[];
  resetKey: string;
}) {
  const id = useId();
  const strip = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    element.scrollLeft = 0;
    function update() {
      if (!element) return;
      const left = element.getBoundingClientRect().left;
      let index = 0,
        distance = Infinity;
      Array.from(element.children).forEach((child, i) => {
        const next = Math.abs(child.getBoundingClientRect().left - left);
        if (next < distance) {
          index = i;
          distance = next;
        }
      });
      setSelected(index);
    }
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [resetKey]);
  function go(index: number) {
    const element = strip.current;
    const target = element?.children[index];
    if (!element || !target) return;
    // Rectangles work even when a distant ancestor owns the offset coordinate system.
    element.scrollTo({
      left:
        element.scrollLeft +
        target.getBoundingClientRect().left -
        element.getBoundingClientRect().left,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }
  return (
    <section className="desk-information" aria-label="Campaign information">
      <div className="panel-heading">
        <h2>Information</h2>
      </div>
      <div className="information-strip" id={id} ref={strip}>
        {panels.map((panel) => (
          <section
            key={panel.name}
            className="information-panel"
            aria-label={`${panel.name} information`}
          >
            {panel.content}
          </section>
        ))}
      </div>
      <div className="information-selectors" role="group" aria-label="Jump to information">
        {panels.map((panel, index) => (
          <button
            key={panel.name}
            type="button"
            aria-label={panel.name}
            title={panel.name}
            aria-pressed={selected === index}
            aria-controls={id}
            onClick={() => go(index)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
