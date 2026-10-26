import { openMapSettings, closeMapSettings, selectWorkspaceMap, selectMapType } from "./map-workspace-browser.mjs";
import { navigateApplication } from "./title-screen-navigation.mjs";
import { chooseOption } from "./search-select-browser.mjs";
import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { autoAnswerThemedDialogs } from "./themed-dialogs.mjs";

/** Called from the full map audit on development and immutable Worker fixtures. */
export async function checkPlayerDisplay(page, context, width, output) {
  await openMapSettings(page);
  await expect(
    page.getByRole("button", { name: "Enable optional TV / player display", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".campaign-maps").getByRole("button", { name: "Player display", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Enable optional TV / player display", exact: true })
    .click();
  await page.evaluate(() =>
    sessionStorage.setItem("display-private-test", "DM credential placeholder"),
  );
  await page
    .locator(".map-session-bar")
    .getByRole("button", { name: "Player display", exact: true })
    .click();
  const controls = page.getByRole("dialog", { name: "Player display", exact: true });
  await controls.getByLabel("Display map", { exact: true }).selectOption("keep");
  await controls
    .getByLabel("Display encounter", { exact: true })
    .selectOption(`local-tiles-${width}`);
  await expect(controls.getByRole("checkbox", { name: "Hidden guard", exact: true })).toBeVisible();
  const popup = page.waitForEvent("popup");
  await controls.getByRole("button", { name: "Open player window", exact: true }).click();
  const viewer = await popup;
  const errors = [],
    requests = [];
  viewer.on("pageerror", (e) => errors.push(e.message));
  viewer.on("request", (request) => {
    if (/\/api\/(account|cloud|campaign)/.test(request.url())) requests.push(request.url());
  });
  await viewer.waitForLoadState("domcontentloaded");
  await expect(viewer.getByRole("heading", { name: "Display paused", exact: true })).toBeVisible();
  assert.deepEqual(
    await viewer.evaluate(() => ({ opener: window.opener, keys: Object.keys(sessionStorage) })),
    { opener: null, keys: [] },
  );
  await controls.getByRole("button", { name: "Show display", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Keep map", exact: true })).toBeVisible();
  await expect(viewer.locator("body")).not.toContainText("Hidden guard");
  await expect(viewer.locator(".shell,.app-notifications,.opening-dawn")).toHaveCount(0);
  await controls.getByRole("checkbox", { name: "Hidden guard", exact: true }).check();
  await expect(viewer.locator(".display-sidebar")).toContainText("Hidden guard");
  await expect(viewer.locator(".display-sidebar")).not.toContainText("HP");
  await controls.getByRole("checkbox", { name: "Show exact HP", exact: true }).check();
  await expect(viewer.locator(".display-sidebar")).toContainText("HP 10 / 10");
  await controls.getByLabel("Display rotation", { exact: true }).selectOption("90");
  await controls.getByLabel("Tile size in screen pixels", { exact: true }).fill("32");
  await expect(viewer.locator(".display-map-plane")).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);
  await expect(viewer.locator(".display-map-plane")).toHaveCSS("width", "320px");
  await expect(viewer.locator(".display-map-plane")).toHaveCSS("height", "320px");
  await controls.getByRole("checkbox", { name: "Show grid", exact: true }).check();
  await expect(viewer.locator(".display-grid")).toHaveCount(1);
  await controls.getByRole("button", { name: "Fit map", exact: true }).click();
  await viewer.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect.poll(() => viewer.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await viewer.getByRole("button", { name: "Hide controls", exact: true }).click();
  await viewer.screenshot({ path: `${output}/player-display-${width}.png` });
  await viewer.reload();
  await expect(viewer.getByRole("img", { name: "Keep map", exact: true })).toBeVisible();
  await controls.getByRole("button", { name: "Blank display", exact: true }).click();
  await expect(viewer.getByRole("heading", { name: "Display paused", exact: true })).toBeVisible();
  await expect(viewer.getByRole("img")).toHaveCount(0);
  await controls.getByRole("button", { name: "Show display", exact: true }).click();
  await expect(viewer.getByRole("img", { name: "Keep map", exact: true })).toBeVisible();
  await controls.getByRole("button", { name: "Close", exact: true }).click();
  const origin = new URL(page.url()).origin;
  const marker = crypto.randomUUID();
  await page.evaluate((value) => {
    window.displayDocumentMarker = value;
  }, marker);
  await page.getByRole("button", { name: "Use encounter roster", exact: true }).click();
  await page.getByRole("button", { name: "Load campaign encounters", exact: true }).click();
  await chooseOption(page.getByLabel("Map encounter", { exact: true }), `local-tiles-${width}`);
  await page.getByRole("link", { name: "Open encounter tracker →", exact: true }).click();
  await expect(page.getByLabel("Round", { exact: true })).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.displayDocumentMarker),
    marker,
    "Map tracker link retains the controlling document",
  );
  await expect(viewer.getByRole("img", { name: "Keep map", exact: true })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await autoAnswerThemedDialogs(page); // themed confirmations (window.confirm is banned)
  await page.getByLabel("Round", { exact: true }).fill("3");
  // An unfinished edit is deliberately absent from the shared display.
  await expect(viewer.getByRole("heading", { name: "Round 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(viewer.getByRole("heading", { name: "Round 3", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next turn", exact: true }).click();
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(viewer.locator(".display-sidebar .display-active")).toContainText("Hidden guard");
  await page.getByRole("button", { name: "Loot & rewards", exact: true }).click();
  await page.getByRole("button", { name: "Add custom loot", exact: true }).click();
  await page.getByLabel("Item name", { exact: true }).fill("Display prize");
  await chooseOption(page.getByLabel("Recipient for item 1", { exact: true }), "hero");
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(page.getByText("Encounter saved.", { exact: true })).toBeVisible();
  await page
    .locator(".encounter-heading")
    .getByRole("button", { name: "Player display", exact: true })
    .click();
  await controls
    .getByRole("checkbox", { name: "Show confirmed awarded loot", exact: true })
    .check();
  await controls.getByRole("button", { name: "Close", exact: true }).click();
  await expect(viewer.locator("body")).not.toContainText("Display prize");
  await page.getByRole("button", { name: "Conclude & review loot", exact: true }).click();
  await expect(page.getByRole("button", { name: "Transfer loot once", exact: true })).toBeEnabled();
  await expect(viewer.locator("body")).not.toContainText("Display prize");
  await page.getByRole("button", { name: "Transfer loot once", exact: true }).click();
  await expect(viewer.locator("body")).toContainText("1 × Display prize");
  await expect(viewer.locator("body")).toContainText("Award receipt:");
  await viewer.screenshot({ path: `${output}/player-display-award-${width}.png` });
  await navigateApplication(page, `${origin}/maps`);
  await expect(viewer.locator("body")).toContainText("1 × Display prize");
  assert.deepEqual(requests, [], "Viewer never fetches DM/account/campaign APIs");
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  return viewer;
}
