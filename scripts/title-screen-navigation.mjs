// Existing workflow audits enter through the same title screen as a user.
const publicPaths = new Set([
  "/welcome",
  "/downloads",
  "/updates",
  "/help",
  "/resources",
  "/donate",
]);
export async function continueIntoApp(page) {
  const path = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
  if (publicPaths.has(path)) return;
  const title = page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true });
  await page.waitForFunction(() =>
    document.querySelector(".loot-opening") ||
    document.querySelector("main"),
  );
  if (await title.isVisible()) await title.click();
  await title.waitFor({ state: "detached" });
}
export async function openApplication(page, ...args) {
  const destination = new URL(args[0]);
  if (!page.guestAccessAudit && ["localhost", "127.0.0.1"].includes(destination.hostname) && !publicPaths.has(destination.pathname) && destination.pathname !== "/account" && !destination.searchParams.has("join") && destination.searchParams.get("as") !== "player") {
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
  const session = await page.context().request.get(origin + "/api/account/auth/get-session");
  if (!session.ok()) throw Error(`Fixture identity: ${session.status()}`);
  if (!(await session.json())?.user) {
    // Better Auth groups IPv6 by /64: vary the prefix, not only host bits.
    await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1` });
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
  const appLink = page.getByRole("link", { name: "Open app", exact: true });
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
  const ready = page.getByText("Campaign control", { exact: true });
  await claim.or(ready).first().waitFor();
  if (await claim.isVisible()) await claim.click();
  await page.getByText("Campaign control", { exact: true }).waitFor();
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
    const links = page.locator("a[href]");
    for (let i = 0; i < await links.count(); i++) {
      const link = links.nth(i);
      if (!await link.isVisible()) continue;
      const url = new URL(await link.getAttribute("href"), page.url());
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
