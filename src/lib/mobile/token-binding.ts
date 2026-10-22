/**
 * Android Auto Backup restores WebView localStorage as one file, and that file also holds the
 * campaign registry, so the account token cannot be excluded on its own (audit S07). Instead the
 * token is bound to this installation: the marker below names the install id from native
 * no-backup storage. A copy restored onto another install (or a reinstall) carries a different
 * marker and its token is dropped, so the person signs in again. Campaign data is untouched.
 */
export const ACCOUNT_TOKEN = "lootsplit.account.token.v1";
export const ACCOUNT_TOKEN_INSTALL = "lootsplit.account.token.install.v1";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Returns true when a token restored from another installation was removed. */
export function applyTokenBinding(storage: Store, installId: string): boolean {
  // Unknown install id (plugin missing, storage error): never sign out on a guess.
  if (!installId) return false;
  const bound = storage.getItem(ACCOUNT_TOKEN_INSTALL);
  if (bound === installId) return false;
  // No marker: data from before this check existed (or a first launch) is adopted as-is.
  storage.setItem(ACCOUNT_TOKEN_INSTALL, installId);
  if (!bound) return false;
  storage.removeItem(ACCOUNT_TOKEN);
  return true;
}

let ready: Promise<void> | undefined;
let settled = false;

/** True once this page's check has finished; callers then read the token without waiting. */
export function accountTokenSettled(): boolean {
  return settled || import.meta.env.VITE_MOBILE !== "true";
}

/** Native only; resolves once per page after the restored-token check. Never rejects. */
export function accountTokenReady(): Promise<void> {
  if (import.meta.env.VITE_MOBILE !== "true" || typeof localStorage === "undefined")
    return Promise.resolve();
  ready ??= (async () => {
    let installId = "";
    try {
      // A bridge that never answers must not hold account requests: give up after two seconds.
      installId = await Promise.race([
        (async () => (await import("./owner-widget")).readInstallId())(),
        new Promise<string>((resolve) => setTimeout(() => resolve(""), 2000)),
      ]);
    } catch {
      installId = "";
    }
    try {
      applyTokenBinding(localStorage, installId);
    } catch {
      // Storage unavailable: requests continue as before.
    }
    settled = true;
  })();
  return ready;
}
