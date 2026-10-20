import { chooseOption } from "./search-select-browser.mjs";
import { expect } from "playwright/test";
export async function openMapSettings(page) {
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
export async function openMoreMapTools(page) {
  await closeMapSettings(page);
  const button = page.getByRole("button", { name: "More map tools", exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
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
