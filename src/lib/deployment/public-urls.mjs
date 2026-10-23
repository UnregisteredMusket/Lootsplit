import { deploymentOrigins } from "./origins.mjs";

/** Public marketing and help pages: the only paths that get a canonical URL (audit section 7). */
const PUBLIC_PAGES = [
  "/welcome",
  "/features",
  "/downloads",
  "/updates",
  "/help",
  "/resources",
  "/donate",
];

/** Host used for absolute share-card URLs. Never taken from Host or X-Forwarded-Host. */
export function publicShareHost() {
  return new URL(deploymentOrigins.website).host;
}

/** Canonical website URL for a public page, or "" for app, account, share and API paths.
 * @param {string} pathname */
export function canonicalPublicUrl(pathname) {
  const path = String(pathname ?? "").replace(/\/+$/, "") || "/";
  const page =
    PUBLIC_PAGES.includes(path) ||
    (path.startsWith("/features/") && /^\/features\/[a-z0-9-]+$/i.test(path));
  return page ? new URL(path, deploymentOrigins.website).href : "";
}

/** Paths crawlers should skip: APIs, server functions, accounts and private share links. */
const CRAWLER_DISALLOW = ["/api/", "/_serverFn/", "/account", "/share"];

/**
 * robots.txt and sitemap.xml, served by the Worker on every host. Both name the canonical
 * website, so the old address points search engines at the new one after a move (audit P2-9).
 * Returns null for any other request.
 * @param {Request} request
 */
export function crawlerFile(request) {
  if (!["GET", "HEAD"].includes(request.method)) return null;
  const path = new URL(request.url).pathname;
  const website = deploymentOrigins.website;
  if (path === "/robots.txt")
    return {
      type: "text/plain; charset=utf-8",
      body: [
        "User-agent: *",
        "Allow: /",
        ...CRAWLER_DISALLOW.map((p) => `Disallow: ${p}`),
        "",
        `Sitemap: ${new URL("/sitemap.xml", website).href}`,
        "",
      ].join("\n"),
    };
  if (path === "/sitemap.xml")
    return {
      type: "application/xml; charset=utf-8",
      body:
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        PUBLIC_PAGES.map((page) => `  <url><loc>${new URL(page, website).href}</loc></url>\n`).join(
          "",
        ) +
        "</urlset>\n",
    };
  return null;
}
