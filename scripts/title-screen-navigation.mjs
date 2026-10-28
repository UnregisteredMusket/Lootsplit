// Existing workflow audits enter through the same title screen as a user.
import { APP_VISITOR_COOKIE } from "../src/lib/deployment/public-urls.mjs";

/** A browser that has opened the app before: the bare address goes to the app, not the home page
 * (landingRedirect). Audits that start at "/" mean the app, so they mark the browser first. */
export async function markAppVisitor(context, origin) {
  await context.addCookies([{ name: APP_VISITOR_COOKIE, value: "1", url: new URL(origin).origin }]);
}
/** The title screen button: "Click" with a mouse, "Tap" on touch screens, then the campaign to
 * continue when this device has opened one (design D10). */
export const TITLE_SCREEN = /^Lootsplitter\. (Click|Tap) to continue/;
/** An address no route matches; audits use it to check the website's not-found page. */
export const NOT_FOUND_AUDIT_PATH = "/this-page-does-not-exist";
const publicPaths = new Set([
  "/welcome",
  "/features",
  "/downloads",
  "/updates",
  "/help",
  "/resources",
  "/donate",
  "/privacy",
  "/community",
  // My account is drawn in website chrome and never shows the title screen (W-1).
  "/account",
  // The website's not-found page (W-1); any unknown address renders it.
  NOT_FOUND_AUDIT_PATH,
]);
/** Website pages (no title screen, no DM fixture): the listed pages plus community profiles. */
const isPublicPath = (path) => publicPaths.has(path) || path.startsWith("/community/");
export async function continueIntoApp(page) {
  const path = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  if (isPublicPath(path)) return;
  const title = page.getByRole("button", { name: TITLE_SCREEN });
  await page.waitForFunction(() =>
    document.querySelector(".loot-opening") ||
    document.querySelector("main"),
  );
  if (await title.isVisible()) await title.click();
  await title.waitFor({ state: "detached" });
}
export async function openApplication(page, ...args) {
  const destination = new URL(args[0]);
  if (destination.pathname === "/") await markAppVisitor(page.context(), destination.origin);
  if (!page.guestAccessAudit && ["localhost", "127.0.0.1"].includes(destination.hostname) && !isPublicPath(destination.pathname) && destination.pathname !== "/account" && !destination.searchParams.has("join") && destination.searchParams.get("as") !== "player") {
    await prepareDmFixture(page, destination.origin);
  }
  const response = await page.goto(...args);
  await continueIntoApp(page);
  return response;
}
export async function reloadApplication(page, ...args) {
  const response = await page.reload(...args);
  await continueIntoApp(page);
  return response;
}

/** Existing gameplay audits now provision real signed-in DMs. Never mutate a live site. */
export async function prepareDmFixture(page, origin, { useAccountLink = false } = {}) {
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw Error("DM fixtures require a disposable local server.");
  if (page.url().startsWith(origin) && await page.evaluate(() => !!sessionStorage.getItem("lootsplit.player.reconnect.v1"))) return;
  if (page.url().startsWith(origin) && await page.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    const owner = localStorage.getItem(`quire.owner.${id}`);
    return !!owner && owner === sessionStorage.getItem("lootsplit.verified-account");
  })) return;
  // Better Auth groups IPv6 by /64: vary the prefix, not only host bits.
  const address = () => `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1`;
  // The identity read carries its own address too: the account API rate-limits by address, and
  // the audits sharing a development server otherwise pool these reads under one address (the
  // 2026-10-28 gameplay group failed with "Fixture identity: 429" in whichever audit ran last).
  const session = await page.context().request.get(origin + "/api/account/auth/get-session", { headers: { "cf-connecting-ip": address() } });
  if (!session.ok()) throw Error(`Fixture identity: ${session.status()}`);
  if (!(await session.json())?.user) {
    await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": address() });
    const response = await page.context().request.post(origin + "/api/account/auth/sign-up/email", { headers: { origin }, data: { name: "Disposable audit DM", email: `dm-${crypto.randomUUID()}@example.com`, password: "disposable audit password 2026" } });
    if (!response.ok()) throw Error(`Fixture signup: ${response.status()} ${await response.text()}`);
  }
  if (page.url().startsWith(origin) && await page.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    return !!localStorage.getItem(`quire.owner.${id}`);
  })) return;
  // Account scenarios have already verified this signed-in document. Enter
  // through its real app link instead of loading another unrelated document.
  // Other gameplay fixtures keep their original cold entry/identity refresh.
  const fromAccount = useAccountLink && page.url().startsWith(origin) &&
    new URL(page.url()).pathname === "/account";
  const appLink = page.getByRole("link", { name: "Open the app", exact: true }).first();
  let navigationMarker;
  if (fromAccount && await appLink.isVisible()) {
    navigationMarker = crypto.randomUUID();
    await page.evaluate(value => { window.dmFixtureNavigationAudit = value; }, navigationMarker);
    await appLink.click();
    await page.waitForURL(url => url.origin === origin && url.pathname === "/");
  } else {
    await page.goto(origin + "/");
    await continueIntoApp(page);
  }
  const claim = page.getByRole("button", { name: "Claim this device’s existing DM campaign", exact: true });
  const ready = page.getByRole("heading", { name: "Desk", exact: true, level: 1 });
  await claim.or(ready).first().waitFor();
  if (await claim.isVisible()) await claim.click();
  await page.getByRole("heading", { name: "Desk", exact: true, level: 1 }).waitFor();
  if (navigationMarker) {
    if (await page.evaluate(() => window.dmFixtureNavigationAudit) !== navigationMarker)
      throw Error("Account fixture app link replaced the document.");
    if (await page.locator(".loot-opening").count())
      throw Error("Account fixture app link replayed startup.");
  }
}

/** Prefer visible real router links; hidden desktop links must not force mobile reloads. */
export async function navigateApplication(page, destination) {
  const target = new URL(destination);
  if (page.url().startsWith(target.origin)) {
    if (new URL(page.url()).pathname === "/maps") {
      const menu = page.getByRole("button", { name: /map navigation menu$/i });
      if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true") await menu.click();
    }
    // Read hrefs in one DOM snapshot. Background sync may replace a live list
    // between count/nth/getAttribute and make an unrelated index wait forever.
    const hrefs = await page.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
    for (const href of hrefs) {
      // In-page anchors such as "Skip to content" (#main) are not route links.
      if (href === null || href.startsWith("#")) continue;
      const link = page.locator(`a[href=${JSON.stringify(href)}]:visible`).first();
      if (!await link.isVisible()) continue;
      const url = new URL(href, page.url());
      if (url.origin !== target.origin || url.pathname !== target.pathname ||
          (!target.search && url.search && !((target.pathname === "/market" && url.searchParams.get("book") === "") || (target.pathname === "/" && url.searchParams.get("view") === "home"))) ||
          [...target.searchParams].some(([key, value]) => url.searchParams.get(key) !== value)) continue;
      await link.click();
      await page.waitForURL(u => u.pathname === target.pathname && [...target.searchParams].every(([k, v]) => u.searchParams.get(k) === v));
      if (await page.locator(".loot-opening").count()) throw Error("Internal navigation replayed the title screen.");
      return;
    }
  }
  await openApplication(page, destination);
}

/**
 * A player who joins a room lands on Home with "You're playing <character>" (plan P3). Audits
 * that continue on the Campaign screen wait for Home and then open Campaign by its link.
 */
export async function afterJoining(page) {
  await page.waitForURL((u) => u.pathname === "/" && u.searchParams.get("view") === "home");
  await page.locator(".player-home").waitFor();
  await navigateApplication(page, new URL("/share", page.url()).href);
  await page.locator(".room-code").waitFor();
}
