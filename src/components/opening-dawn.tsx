import { consumeNavigationResume } from "@/lib/quire/navigation-launch";
import { LogoLoading } from "./route-loading";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { OpeningLandscape } from "./opening-landscape";
import { LootLoader } from "./loot-loader";
import { readCampaignRecents, titlePrompt } from "@/lib/quire/campaign-recents";

// Dismiss only for this running document, never for a restored browser tab.
// The root gate survives SPA navigation; a fresh app load gets its opening back.
let dismissedInDocument = false;

export function OpeningDawn({
  children,
  bypass = false,
  settle = false,
}: {
  children: ReactNode;
  /** A website page: draw it without the title screen. */
  bypass?: boolean;
  /** Showing this page counts as entering the app (My account): its app links never open the
   * title screen afterwards, as when the account page itself used to show it. */
  settle?: boolean;
}) {
  const [on, setOn] = useState<boolean | null>(null);
  // "Tap" on touch screens, and the campaign to continue (design D10 / dm #27).
  const [touch, setTouch] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const screen = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!settle) return;
    dismissedInDocument = true;
    setOn(false);
  }, [settle]);
  useEffect(() => {
    if (!dismissedInDocument) {
      try { dismissedInDocument = consumeNavigationResume(sessionStorage, location.pathname); } catch { /* Storage may be blocked. */ }
    }
    setOn(!dismissedInDocument);
    try {
      setTouch(matchMedia("(pointer: coarse)").matches);
    } catch {
      /* Older browsers: keep "click". */
    }
    setPrompt(titlePrompt(readCampaignRecents()));
  }, []);
  useEffect(() => {
    if (on && !bypass) screen.current?.focus({ preventScroll: true });
  }, [on, bypass]);
  function enter() {
    dismissedInDocument = true;
    setOn(false);
  }
  if (bypass || on === false) return <>{children}</>;
  const verb = touch ? "Tap" : "Click";
  // Wait for hydration before showing the interactive opening.
  if (on === null) return <LogoLoading />;
  return (
    <button
      ref={screen}
      type="button"
      className="quire-dawn loot-opening"
      onClick={enter}
      aria-label={`Lootsplitter. ${verb} to continue${prompt ? `. ${prompt}` : ""}`}
    >
      <span className="quire-dawn-name">Lootsplitter</span>
      <span className="loot-opening-scene">
        <OpeningLandscape />
        <LootLoader />
      </span>
      {prompt ? <span className="loot-opening-prompt">{prompt}</span> : null}
      <span className="loot-opening-continue">{verb.toLowerCase()} to continue</span>
    </button>
  );
}
