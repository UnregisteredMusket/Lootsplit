import { useEffect, useRef, useState, type ReactNode } from "react";
import { OpeningLandscape } from "./opening-landscape";
import { LootLoader } from "./loot-loader";

// Dismiss only for this running document, never for a restored browser tab.
// The root gate survives SPA navigation; a fresh app load gets its opening back.
let dismissedInDocument = false;

export function OpeningDawn({ children, bypass = false }: { children: ReactNode; bypass?: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const screen = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOn(!dismissedInDocument);
  }, []);
  useEffect(() => {
    if (on && !bypass) screen.current?.focus({ preventScroll: true });
  }, [on, bypass]);
  function enter() {
    dismissedInDocument = true;
    setOn(false);
  }
  if (bypass || on === false) return <>{children}</>;
  // Wait for hydration before showing the interactive opening.
  if (on === null) return null;
  return (
    <button
      ref={screen}
      type="button"
      className="quire-dawn loot-opening"
      onClick={enter}
      aria-label="Lootsplit. Click to continue"
    >
      <span className="quire-dawn-name">Lootsplit</span>
      <span className="loot-opening-scene">
        <OpeningLandscape />
        <LootLoader />
      </span>
      <span className="loot-opening-continue">click to continue</span>
    </button>
  );
}
