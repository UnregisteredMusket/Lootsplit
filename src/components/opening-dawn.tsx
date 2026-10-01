import { useEffect, useState } from "react";

export function OpeningDawn() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const handle = window.setTimeout(() => setOn(false), 1500);
    return () => window.clearTimeout(handle);
  }, []);
  if (!on) return null;
  return (
    <div className="quire-dawn" aria-hidden="true">
      <p className="quire-dawn-name">Lootsplit</p>
    </div>
  );
}