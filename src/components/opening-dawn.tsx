import { useEffect, useRef, useState, type ReactNode } from "react";
import { OpeningLandscape } from "./opening-landscape";
import { LootLoader } from "./loot-loader";

const openingSessionKey = "lootsplit.opening.dismissed.v1";
// Storage can be unavailable in private/restricted webviews. Keep SPA navigation safe there too.
let dismissedInDocument = false;

export function OpeningDawn({ children, bypass = false }: { children: ReactNode; bypass?: boolean }) {
  const [on, setOn] = useState<boolean | null>(null);
  const screen = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let dismissed = dismissedInDocument;
    try {
      dismissed ||= sessionStorage.getItem(openingSessionKey) === "1";
    } catch { /* An unavailable browser store must not block entry. */ }
    setOn(!dismissed);
  }, []);
  useEffect(() => {
    if (on && !bypass) screen.current?.focus({ preventScroll: true });
  }, [on, bypass]);
  function enter() {
    dismissedInDocument = true;
    try {
      sessionStorage.setItem(openingSessionKey, "1");
    } catch { /* The in-memory fallback still protects client-side navigation. */ }
    setOn(false);
  }
  if (bypass || on === false) return <>{children}</>;
  // Resolve tab-session storage before painting, so refreshes cannot flash the opening.
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
