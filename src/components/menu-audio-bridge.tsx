import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { usePrefs } from "@/lib/quire/prefs";
import { submenuScene } from "@/lib/quire/submenu-scenes";
import { menuAudio } from "@/lib/quire/menu-audio";

/** Own audio for the running document, above route-specific shells. */
export function MenuAudioBridge() {
  const { prefs, ready } = usePrefs();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scene = submenuScene(pathname);
  useEffect(() => {
    menuAudio.configure({ ...prefs, scene: ready ? scene : undefined });
  }, [ready, scene, prefs]);
  useEffect(() => {
    const gesture = (event: Event) => {
      if (event.isTrusted) void menuAudio.unlock();
    };
    const visibility = () => menuAudio.refresh();
    const leave = () => menuAudio.dispose();
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      menuAudio.dispose();
    };
  }, []);
  return null;
}
