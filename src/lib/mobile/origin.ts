/** Public Cloudflare Worker. Not a secret. */
export const API_ORIGIN = "https://lootsplit.oliverstorie2017.workers.dev";

/** WebView origins that may call the Worker. Same-origin browser traffic is separate. */
export const APP_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost"] as const;

export function isAppOrigin(origin: string | null | undefined): boolean {
  return !!origin && (APP_ORIGINS as readonly string[]).includes(origin);
}

/** Point a same-origin server-function URL at the Worker. Other URLs stay put. */
export function rewriteServerFnUrl(url: string, pageOrigin: string): string | null {
  let path = url;
  if (pageOrigin && url.startsWith(pageOrigin)) path = url.slice(pageOrigin.length);
  if (!path.startsWith("/_serverFn/")) return null;
  return API_ORIGIN + path;
}
