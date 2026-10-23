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

/** Set by the app (not the public website) once a browser has opened it; lets returning players
 * go straight into the app from the bare address. Not a secret and not an identity. */
export const APP_VISITOR_COOKIE = "lootsplit-app";

/**
 * The bare address opens the public home page for first-time visitors and search engines; people
 * who have opened the app (marker cookie) or are signed in (account session cookie) go straight
 * into the app. Only `GET|HEAD /` with no query string and an HTML Accept header is redirected, so
 * invitations (/share?…), app links with a query, the installed web app (start_url /?view=home),
 * API calls and the Android app (bundled files) are never affected.
 * @param {{ method?: string, url: string, accept?: string | null, cookie?: string | null }} request
 * @returns {string | null} the redirect path, or null to serve the app
 */
export function landingRedirect({ method = "GET", url, accept, cookie }) {
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return null;
  const parsed = new URL(url, "http://local.invalid");
  if (parsed.pathname !== "/" || parsed.search) return null;
  if (!String(accept ?? "").includes("text/html")) return null;
  const jar = String(cookie ?? "");
  if (new RegExp(`(?:^|;\\s*)${APP_VISITOR_COOKIE}=1(?:;|$)`).test(jar)) return null;
  if (/(?:^|;\s*)(?:__Secure-)?lootsplit\.session_token=/.test(jar)) return null;
  return "/welcome";
}

/**
 * Title and description per public page: the route head (<title>, meta description) and the
 * share tags (og:title, og:description) read the same text. Descriptions stay under about 155
 * characters so search results show them whole.
 */
/** @type {Readonly<Record<string, {title: string, description: string}>>} */
export const PUBLIC_PAGE_META = Object.freeze({
  "/welcome": {
    title: "Lootsplitter \u2014 free D&D loot splitter and campaign ledger",
    description:
      "Split loot fairly and run your whole tabletop campaign: party funds, character sheets, shops, maps and encounters. 100% free, in the browser and on Android.",
  },
  "/features": {
    title: "Features for DMs and players \u00b7 Lootsplitter",
    description:
      "Loot splits, party funds, character sheets, shops and trade, maps with fog of war, encounters, downtime and live rooms: everything Lootsplitter does.",
  },
  "/downloads": {
    title: "Download Lootsplitter for Android or play in your browser",
    description:
      "Play in any browser with nothing to install, or get the free signed Android app with home-screen widgets. Latest version, checksum and install guide.",
  },
  "/updates": {
    title: "Changelog \u00b7 Lootsplitter",
    description:
      "Every Lootsplitter release, newest first: new features, improvements and fixes for the website and the Android app.",
  },
  "/help": {
    title: "Help and guides \u00b7 Lootsplitter",
    description:
      "Guides for Dungeon Masters and players: setting up a campaign, splitting loot, shops, maps, encounters, backups and joining a shared room.",
  },
  "/resources": {
    title: "Resources and credits \u00b7 Lootsplitter",
    description:
      "The open game content, sounds, fonts and art Lootsplitter uses, with their sources and licenses.",
  },
  "/donate": {
    title: "Support Lootsplitter",
    description:
      "Lootsplitter is 100% free, supported by donations. Chip in on Ko-fi to help cover hosting and keep it free for every table.",
  },
});

/** The page's own title and description, or null for app, account and other paths.
 * @param {string} pathname */
export function publicPageMeta(pathname) {
  const path = String(pathname ?? "").replace(/\/+$/, "") || "/";
  return PUBLIC_PAGE_META[path] ?? null;
}

/** TanStack route `head()` for a public page: its title and description. @param {string} path */
export function publicPageHead(path) {
  const meta = PUBLIC_PAGE_META[path];
  return { meta: [{ title: meta.title }, { name: "description", content: meta.description }] };
}

/** WebSite and Organization structured data for the home page (no SoftwareApplication markup:
 * Google requires ratings or reviews for that, and Lootsplitter shows none). */
export function homeStructuredData() {
  const url = deploymentOrigins.website;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${url}/#website`,
        name: "Lootsplitter",
        url: `${url}/`,
        publisher: { "@id": `${url}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${url}/#organization`,
        name: "Lootsplitter",
        url: `${url}/`,
        logo: `${url}/favicon.svg`,
        email: "support@lootsplitter.com",
        sameAs: ["https://github.com/UnregisteredMusket/Lootsplit"],
      },
    ],
  };
}
