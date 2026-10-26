/**
 * Opens Tabs & windows: the header button on wide screens, or Settings & Management →
 * Appearance → Tabs & windows… below 1024 px, where the header leaves it out (design M4).
 */
export async function openTabsAndWindows(page) {
  const header = page.getByRole("button", { name: "Tabs & windows", exact: true });
  if (await header.isVisible()) return header.click();
  await page.getByRole("button", { name: "Settings & Management", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings & Management", exact: true });
  // The sheet remembers which group was open; only expand a closed one.
  const group = settings.getByRole("button", { name: /^Appearance/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await settings.getByRole("button", { name: "Tabs & windows…", exact: true }).click();
}
