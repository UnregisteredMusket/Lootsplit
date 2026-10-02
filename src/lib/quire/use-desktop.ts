import { useSyncExternalStore } from "react";

const query = "(min-width: 1024px)";
const snapshot = () => window.matchMedia(query).matches;
const serverSnapshot = () => false;
function subscribe(change: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
/** Match the existing desktop navigation breakpoint; mobile rendering stays unchanged. */
export function useDesktop() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
