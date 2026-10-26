import { chooseOption } from "./search-select-browser.mjs";
import { expect } from "playwright/test";
export async function openMapSettings(page) {
  // At 340 px or less, Map settings is the first item of the title menu.
  if (page.viewportSize().width <= 340) await openMapNavigation(page);
  const button = page.getByRole("button", { name: "Map settings", exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(page.locator("#map-settings")).toBeVisible();
}
export async function closeMapSettings(page) {
  const button = page.getByRole("button", { name: "Close settings", exact: true });
  if (await button.isVisible()) await button.click();
}
export async function openMapNavigation(page) {
  const button = page.getByRole("button", { name: "Map navigation menu", exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}
export async function mapBack(page) {
  await openMapNavigation(page);
  await page.getByRole("button", { name: "Back to map", exact: true }).click();
}
/** DM fog tools live in the setup rail; arming (or re-choosing) one opens its options beside
 * the rail, including Undo fog, Redo fog and the other fog actions. */
export async function openFogOptions(page, tool = "Fog rectangle") {
  await closeMapSettings(page);
  await page
    .getByRole("toolbar", { name: "Map setup", exact: true })
    .getByRole("button", { name: tool, exact: true })
    .click();
  await expect(page.getByRole("complementary", { name: "Tool options", exact: true })).toBeVisible();
}

export async function selectWorkspaceMap(page, id) {
  await closeMapSettings(page);
  await openMapNavigation(page);
  await chooseOption(page.getByLabel("Map", { exact: true }), id);
  const menu = page.getByRole("button", { name: "Map navigation menu", exact: true });
  if ((await menu.getAttribute("aria-expanded")) === "true") await menu.click();
}
export async function selectMapType(page, id) {
  await openMapSettings(page);
  await chooseOption(page.getByLabel("Map type filter", { exact: true }), id);
  await openMapSettings(page);
}

/** DM phones show Search as a row-1 icon (the setup bar takes row 2); open the field first. */
export async function openMapSearch(page) {
  const toggle = page.getByRole("button", { name: "Search maps and places", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  return page.getByRole("combobox", { name: "Search maps and places", exact: true });
}
