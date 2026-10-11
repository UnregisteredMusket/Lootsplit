import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { checkManualInitiative, expectInitiativeOrder } from "./initiative-browser-check.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw new Error("Initiative audit requires a disposable local server.");
const output = "test-results/initiative";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openApplication(page, origin + "/encounters");
  await page.getByRole("button", { name: "New encounter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sort initiative", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add combatant", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Initiative captain");
  await expect(page.getByRole("button", { name: "Sort initiative", exact: true })).toBeDisabled();
  const order = await checkManualInitiative(page, "Initiative captain", output);
  await page.getByRole("button", { name: "Save encounter", exact: true }).click();
  await page.getByText("Encounter saved.", { exact: true }).waitFor();
  await reloadApplication(page);
  await page
    .locator(".encounter-library")
    .getByRole("button", { name: /New encounter/ })
    .click();
  await expectInitiativeOrder(page, order);
  await expect(page.getByLabel("Round", { exact: true })).toHaveValue("2");
  await expect(page.locator(".encounter-combatant.is-active .combat-identity strong")).toHaveText(
    "Initiative scout",
  );
  await expect(page.getByRole("button", { name: "Sort initiative", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Sort initiative", exact: true }).click();
  await expectInitiativeOrder(page, [
    "Initiative captain",
    "Initiative scout",
    "Initiative guard",
    "Unrolled ally",
  ]);
  await expect(page.locator(".encounter-combatant.is-active .combat-identity strong")).toHaveText(
    "Initiative scout",
  );
  expect(errors).toEqual([]);
  console.log(
    "PASS: stable multi-digit focus, explicit keyboard/pointer sorting, ties/blanks, edits/clearing, current turn/round, saved order and desktop/mobile layout.",
  );
} finally {
  await browser.close();
}
