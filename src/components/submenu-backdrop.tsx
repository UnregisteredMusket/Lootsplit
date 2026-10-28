import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/quire/prefs";
import { fantasyLook } from "@/lib/quire/theme";
import { submenuScene } from "@/lib/quire/submenu-scenes";
import { bannerKey, bannerMode } from "@/lib/quire/banner-mode";
import { readDeviceFlag, writeDeviceFlag } from "@/lib/quire/shop-counter-memory";
import { usePane } from "./split-view";

// Measure before paint on the client so a revisit never flashes the full banner.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function SubmenuBackdrop({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { prefs } = usePrefs();
  const scene =
    prefs.fantasyBackgrounds && fantasyLook(prefs.appearance, prefs.accent, prefs.ground)
      ? submenuScene(pathname)
      : undefined;
  const light = prefs.appearance === "light";
  const source = `/scenes/fantasy/${scene}-${light ? "day" : "night"}`;
  // The full banner greets a screen's first visit; afterwards, and in split panes, a compact
  // band keeps primary actions in view (dm-mobile #19). "Show fantasy backgrounds" still decides
  // whether there is a banner at all.
  const splitPane = !!usePane();
  const [seenBefore, setSeenBefore] = useState(false);
  const key = bannerKey(pathname);
  // Read once per screen: React may run this effect twice (Strict Mode), and the second run must
  // not see the flag the first one wrote.
  const visit = useRef<{ key: string; seen: boolean } | null>(null);
  useBeforePaint(() => {
    if (!scene) return;
    if (visit.current?.key !== key) {
      visit.current = { key, seen: readDeviceFlag(key, false) };
      writeDeviceFlag(key, true);
    }
    setSeenBefore(visit.current.seen);
  }, [key, scene]);
  // The workspace remains mounted when changing theme or disabling scenery.
  return (
    <div
      className="submenu-workspace"
      data-submenu-scene={scene}
      data-banner={scene ? bannerMode({ seenBefore, splitPane }) : undefined}
    >
      {scene && (
        <div className="submenu-scenery" aria-hidden="true">
          <img
            src={`${source}-768.webp`}
            srcSet={`${source}-768.webp 768w, ${source}-1440.webp 1440w`}
            sizes="(min-width: 1024px) calc(100vw - 15rem), 100vw"
            width={1440}
            height={810}
            alt=""
            decoding="async"
            draggable={false}
          />
        </div>
      )}
      {children}
    </div>
  );
}
