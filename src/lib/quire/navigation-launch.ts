const RESUME_KEY = "lootsplit.navigation.resume.v1";
const MAX_AGE = 15_000;
/** Single-use handoff for data-context reloads, never a persistent startup opt-out. */
export function consumeNavigationResume(
  storage: Pick<Storage, "getItem" | "removeItem">,
  path: string,
  now = Date.now(),
): boolean {
  try {
    const raw = storage.getItem(RESUME_KEY);
    storage.removeItem(RESUME_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw);
    return (
      marker.path === path &&
      Number.isFinite(marker.at) &&
      now >= marker.at &&
      now - marker.at < MAX_AGE
    );
  } catch {
    return false;
  }
}
export function reloadCampaignContext() {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ path: "/", at: Date.now() }));
  } catch {
    /* Startup remains usable if storage is unavailable. */
  }
  window.dispatchEvent(new Event("lootsplit:context-loading"));
  window.location.assign("/");
}
