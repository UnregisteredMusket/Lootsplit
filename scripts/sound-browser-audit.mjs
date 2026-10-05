import { chromium, expect } from "playwright/test";
import assert from "node:assert/strict";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Disposable local server required");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.addInitScript(() => {
      window.__audioStarts = 0;
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.__audioStarts++;
        return original.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/settings");
    await page.getByText("Sound effects", { exact: true }).click();
    const settings = page.getByRole("group", { name: "Sound effects", exact: true });
    await expect(settings.getByLabel("Enable sound effects")).not.toBeChecked();
    assert.equal(await page.evaluate(() => window.__audioStarts), 0);
    for (const label of ["coins", "loot", "page turn"]) {
      await settings.getByRole("button", { name: "Preview " + label, exact: true }).click();
      await expect(settings.getByRole("status")).toHaveText(
        "Preview: " + label[0].toUpperCase() + label.slice(1),
      );
    }
    await settings.getByLabel("Enable sound effects").check();
    await settings.getByLabel("Sound volume", { exact: true }).fill("22");
    await reloadApplication(page);
    await page.getByText("Sound effects", { exact: true }).click();
    await expect(settings.getByLabel("Enable sound effects")).toBeChecked();
    await expect(settings.getByLabel("Sound volume", { exact: true })).toHaveValue("22");
    await settings.getByLabel("Sound volume", { exact: true }).fill("0");
    await settings.getByRole("button", { name: "Preview coins", exact: true }).click();
    await expect(settings.getByRole("status")).toContainText("could not play");
    await settings.getByLabel("Enable sound effects").uncheck();
    const before = await page.evaluate(() => window.__audioStarts);
    await page.locator('a[href^="/market"]:visible').first().click();
    await page.waitForURL((u) => u.pathname === "/market");
    assert.equal(await page.evaluate(() => window.__audioStarts), before);
    assert.equal(await page.locator(".loot-opening").count(), 0);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Sound settings passed: desktop/mobile, all real WAV previews decoded, persistence, mute and no runtime errors.",
  );
} finally {
  await browser.close();
}
