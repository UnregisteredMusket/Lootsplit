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
  const response = await page.goto(...args);
  await continueIntoApp(page);
  return response;
}
export async function reloadApplication(page, ...args) {
  const response = await page.reload(...args);
  await continueIntoApp(page);
  return response;
}
