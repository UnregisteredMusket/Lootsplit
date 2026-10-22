import { deploymentOrigins } from "./origins.mjs";

/** Public marketing and help pages: the only paths that get a canonical URL (audit section 7). */
const PUBLIC_PAGES = ["/welcome", "/features", "/downloads", "/updates", "/help", "/resources", "/donate"];

/** Host used for absolute share-card URLs. Never taken from Host or X-Forwarded-Host. */
export function publicShareHost() {
  return new URL(deploymentOrigins.website).host;
}

/** Canonical website URL for a public page, or "" for app, account, share and API paths.
 * @param {string} pathname */
export function canonicalPublicUrl(pathname) {
  const path = String(pathname ?? "").replace(/\/+$/, "") || "/";
  const page = PUBLIC_PAGES.includes(path) || (path.startsWith("/features/") && /^\/features\/[a-z0-9-]+$/i.test(path));
  return page ? new URL(path, deploymentOrigins.website).href : "";
}
