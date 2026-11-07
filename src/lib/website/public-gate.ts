/**
 * Which addresses the campaign gate lets through, and which of those draw at once.
 *
 * Public website pages never need campaign access, so the gate lets them through. Most of them
 * also need nothing from the campaign providers (library, economy, prefs), so they are drawn
 * straight away, in the server HTML too, instead of "Checking campaign access…" while the two
 * account calls finish (QA pass 2026-11). The providers still mount only after the account check,
 * exactly as before, so no campaign storage opens early and no campaign data reaches these pages.
 */
export const GATE_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/welcome",
  "/features",
  "/downloads",
  "/updates",
  "/help",
  "/resources",
  "/donate",
  "/privacy",
  "/community",
  "/account",
]);

/** Public pages that read campaign providers, so they still wait for the account check. */
const NEEDS_PROVIDERS: ReadonlySet<string> = new Set(["/account"]);

/**
 * One trailing slash is dropped (`/welcome/` is `/welcome`), as the root layout does. Matching
 * stays exact otherwise: `/WELCOME`, `/welcome//`, `/welcome/x` and encoded paths are not public.
 */
function exactPath(path: string) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Whether the gate lets this address through without campaign access. */
export function isGatePublicPath(path: string) {
  return GATE_PUBLIC_PATHS.has(exactPath(path)) || path.startsWith("/community/");
}

/** Whether this address can be drawn before the account check finishes (and on the server). */
export function drawsBeforeAccountCheck(path: string, notFound: boolean) {
  if (notFound) return true;
  return isGatePublicPath(path) && !NEEDS_PROVIDERS.has(exactPath(path));
}
