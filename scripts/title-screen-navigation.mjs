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
export async function prepareDmFixture(page, origin) {
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
    const response = await page.context().request.post(origin + "/api/account/auth/sign-up/email", { headers: { origin }, data: { name: "Disposable audit DM", email: `dm-${crypto.randomUUID()}@example.com`, password: "disposable audit password 2026" } });
    if (!response.ok()) throw Error(`Fixture signup: ${response.status()} ${await response.text()}`);
  }
  if (page.url().startsWith(origin) && await page.evaluate(() => {
    const id = localStorage.getItem("quire.campaign.v1") || "main";
    return !!localStorage.getItem(`quire.owner.${id}`);
  })) return;
  await page.goto(origin + "/");
  await continueIntoApp(page);
  const claim = page.getByRole("button", { name: "Claim this device’s existing DM campaign", exact: true });
  await claim.waitFor(); await claim.click();
  await page.getByText("Campaign control", { exact: true }).waitFor();
}
