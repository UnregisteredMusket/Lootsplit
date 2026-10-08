import type { ReactNode } from "react";
import { usePrefs } from "@/lib/quire/prefs";
import { fantasyLook } from "@/lib/quire/theme";
import { submenuScene } from "@/lib/quire/submenu-scenes";

export function SubmenuBackdrop({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { prefs } = usePrefs();
  const scene =
    prefs.fantasyBackgrounds && fantasyLook(prefs.appearance, prefs.accent, prefs.ground)
      ? submenuScene(pathname)
      : undefined;
  const light = prefs.appearance === "light";
  const source = `/scenes/fantasy/${scene}-${light ? "day" : "night"}`;
  // The workspace remains mounted when changing theme or disabling scenery.
  return (
    <div className="submenu-workspace" data-submenu-scene={scene}>
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
