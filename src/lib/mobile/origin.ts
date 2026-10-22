import { deploymentOrigins } from "../deployment/origins.mjs";
/** Public Cloudflare Worker. Not a secret. */
export const API_ORIGIN = deploymentOrigins.nativeApi;

/** WebView origins that may call the Worker. Same-origin browser traffic is separate. */
export const APP_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost"] as const;

export function isAppOrigin(origin: string | null | undefined): boolean {
  return !!origin && (APP_ORIGINS as readonly string[]).includes(origin);
}

/** Worker paths the packaged app calls: server functions and the seat-authorized room image GET. */
export function isWorkerApiPath(path: string): boolean {
  return path.startsWith("/_serverFn/") || path.startsWith("/api/room-image/");
}

/** Point a same-origin server-function (or room image) URL at the Worker. Other URLs stay put. */
export function rewriteServerFnUrl(url: string, pageOrigin: string): string | null {
  let path = url;
  if (pageOrigin && url.startsWith(pageOrigin)) path = url.slice(pageOrigin.length);
  if (!isWorkerApiPath(path)) return null;
  return API_ORIGIN + path;
}
