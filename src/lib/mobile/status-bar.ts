import type { Appearance } from "../quire/theme.ts";

/**
 * Android status-bar icon style for the app theme (design M3). The web view draws under the
 * status bar (`setOverlaysWebView`), so the icons must contrast with the theme's ground:
 * Capacitor's "LIGHT" style means dark icons for a light background, "DARK" light icons.
 */
export function statusBarStyle(appearance: Appearance): "LIGHT" | "DARK" {
  return appearance === "light" ? "LIGHT" : "DARK";
}

/** Applies the style in the Android app; a no-op on the website and in tests. */
export function syncStatusBar(appearance: Appearance) {
  if (import.meta.env?.VITE_MOBILE !== "true") return;
  const style = statusBarStyle(appearance);
  void import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) =>
      StatusBar.setStyle({ style: style === "LIGHT" ? Style.Light : Style.Dark }),
    )
    .catch(() => undefined);
}
