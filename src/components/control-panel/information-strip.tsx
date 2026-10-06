import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
        <div className="information-controls">
          <button
            aria-label="Previous information panel"
            aria-controls={id}
            disabled={selected === 0}
            onClick={() => go(selected - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span aria-live="polite">
            {selected + 1} / {panels.length}
          </span>
          <button
            aria-label="Next information panel"
            aria-controls={id}
            disabled={selected === panels.length - 1}
            onClick={() => go(selected + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
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
      <div className="information-selectors" aria-label="Jump to information">
        {panels.map((panel, index) => (
          <button
            key={panel.name}
            aria-pressed={selected === index}
            aria-controls={id}
            onClick={() => go(index)}
          >
            {panel.name}
          </button>
        ))}
      </div>
    </section>
  );
}
