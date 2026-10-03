import { useEffect, useRef, useState, type ReactNode } from "react";
import { LootLoader } from "./loot-loader";

export function OpeningDawn({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(true);
  const [ready, setReady] = useState(false);
  const screen = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) screen.current?.focus({ preventScroll: true });
  }, [ready]);
  if (!on) return <>{children}</>;
  return (
    <button
      ref={screen}
      type="button"
      disabled={!ready}
      className="quire-dawn loot-opening"
      onClick={() => setOn(false)}
      aria-label="Lootsplit. Click to continue"
    >
      <span className="quire-dawn-name">Lootsplit</span>
      <LootLoader />
      <span className="loot-opening-continue">click to continue</span>
    </button>
  );
}
