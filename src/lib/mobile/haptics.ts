/**
 * A short haptic tick (the map wheel opening and the finger entering a slice; map tokens Q5).
 * The Android app uses Capacitor Haptics, which drives the phone's vibration motor directly;
 * the website, and the app if the plugin fails, fall back to the web `vibrate` call.
 * Nothing happens when the user asks for reduced motion or the device cannot vibrate.
 */
export function hapticTick(): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const web = () => {
    try {
      navigator.vibrate?.(10);
    } catch {
      // Some browsers throw when vibration is blocked; a tick is never worth an error.
    }
  };
  if (import.meta.env?.VITE_MOBILE !== "true") return web();
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(web);
}
