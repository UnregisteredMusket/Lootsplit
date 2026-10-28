import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * A "Saved" tick for fields that save on blur (design D9 / dm #15), so an inline save is never
 * silent. `track` takes the save's result (true when saved); the tick shows for 2.5 s.
 */
export function useSavedTick() {
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const track = (result: Promise<boolean>) => {
    void result.then((ok) => {
      if (!ok) return;
      setSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(false), 2500);
    });
  };
  return { saved, track };
}

export function SavedTick({ saved, label = "Saved" }: { saved: boolean; label?: string }) {
  return (
    <span className="saved-tick" role="status" aria-live="polite">
      {saved ? (
        <>
          <Check size={14} aria-hidden="true" /> {label}
        </>
      ) : null}
    </span>
  );
}
