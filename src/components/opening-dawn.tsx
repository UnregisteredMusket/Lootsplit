import { useEffect, useState } from "react";
import { LootLoader } from "./loot-loader";

export function OpeningDawn() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const handle = window.setTimeout(() => setOn(false), 2200);
    return () => window.clearTimeout(handle);
  }, []);
  if (!on) return null;
  return (
    <div className="quire-dawn loot-opening" aria-hidden="true">
      <p className="quire-dawn-name">Lootsplit</p>
      <LootLoader />
    </div>
  );
}
