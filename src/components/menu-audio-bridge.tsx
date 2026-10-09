import { useEffect, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { usePrefs } from "@/lib/quire/prefs";
import { submenuScene } from "@/lib/quire/submenu-scenes";
import { menuAudio } from "@/lib/quire/menu-audio";
import { useSeat, useSeatKnown } from "@/lib/quire/seat";
import { localAudioLibrary, localAudioPlayer } from "@/lib/quire/local-audio";
import { LocalAudioMini } from "./local-audio-mini";

/** Own audio for the running document, above route-specific shells. */
export function MenuAudioBridge() {
  const { prefs, ready } = usePrefs();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scene = submenuScene(pathname);
  const seat = useSeat(),
    known = useSeatKnown();
  const local = useSyncExternalStore(
    localAudioLibrary.subscribe,
    localAudioLibrary.getSnapshot,
    localAudioLibrary.getServerSnapshot,
  );
  useEffect(() => {
    if (known && seat.role === "dm") void localAudioLibrary.load();
    else localAudioLibrary.clearMemory();
    return () => localAudioLibrary.clearMemory();
  }, [known, seat.role]);
  useEffect(() => {
    if (local.library && known && seat.role === "dm")
      localAudioPlayer.configure(local.library, scene || "");
  }, [local.library, known, seat.role, scene]);
  useEffect(() => {
    menuAudio.configure({ ...prefs, scene: ready ? scene : undefined });
  }, [ready, scene, prefs]);
  useEffect(() => {
    const gesture = (event: Event) => {
      if (event.isTrusted) void menuAudio.unlock();
    };
    const visibility = () => {
      localAudioPlayer.visibility();
      menuAudio.refresh();
    };
    const leave = () => {
      localAudioLibrary.clearMemory();
      menuAudio.dispose();
    };
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
      localAudioLibrary.clearMemory();
    };
  }, []);
  return known && seat.role === "dm" ? <LocalAudioMini /> : null;
}
