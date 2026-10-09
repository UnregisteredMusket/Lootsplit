import { chromium, expect } from "playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Disposable local server required");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
await mkdir("test-results/sound", { recursive: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.addInitScript(() => {
      window.__audioStarts = 0;
      window.__loopStarts = 0;
      window.__loops = new Set();
      window.__decodeFailures = [];
      const decode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = function (...args) {
        const result = decode.apply(this, args);
        void result.catch((error) => window.__decodeFailures.push(error.message));
        return result;
      };
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.__audioStarts++;
        if (this.loop) {
          window.__loopStarts++;
          window.__loops.add(this);
        }
        return original.apply(this, args);
      };
      const stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (...args) {
        window.__loops.delete(this);
        return stop.apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors = [];
    const audioRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (request) => {
      if (request.url().includes("/audio/scenes/")) audioRequests.push(request.url());
    });
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
    const menus = page.getByRole("group", { name: "Menu music and ambience", exact: true });
    await expect(menus.getByLabel("Enable menu music")).not.toBeChecked();
    await expect(menus.getByLabel("Enable ambient sound")).not.toBeChecked();
    assert.equal(audioRequests.length, 0, "Default-off loops are not downloaded");
    await menus.getByLabel("Enable menu music").check();
    await menus.getByLabel("Enable ambient sound").check();
    try {
      await page.waitForFunction(() => window.__loops.size === 2, null, { timeout: 15000 });
    } catch (error) {
      console.error(
        await page.evaluate(() => ({
          loops: window.__loops.size,
          starts: window.__loopStarts,
          decoding: window.__decodeFailures,
          preferences: localStorage.getItem("quire.prefs.v1"),
        })),
        audioRequests,
      );
      throw error;
    }
    const starts = await page.evaluate(() => window.__loopStarts);
    await menus.getByLabel("Menu music volume", { exact: true }).fill("17");
    await menus.getByLabel("Ambient sound volume", { exact: true }).fill("12");
    assert.equal(
      await page.evaluate(() => window.__loopStarts),
      starts,
      "Volume keeps loops playing",
    );
    await page.screenshot({ path: `test-results/sound/menu-audio-${width}.png`, fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__audioStarts),
      0,
      "Saved-on preferences do not autoplay a fresh document",
    );
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).click();
    await page.getByText("Sound effects", { exact: true }).click();
    await expect(menus.getByLabel("Enable menu music")).toBeChecked();
    await expect(menus.getByLabel("Enable ambient sound")).toBeChecked();
    await expect(menus.getByLabel("Menu music volume", { exact: true })).toHaveValue("17");
    await expect(menus.getByLabel("Ambient sound volume", { exact: true })).toHaveValue("12");
    await page.waitForFunction(() => window.__loops.size === 2);
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Desk", exact: true })
      .click();
    await page.waitForFunction(() => window.__loops.size === 0);
    await page.reload();
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__loopStarts), 0);
    await page.evaluate(() => (window.soundNavigationMarker = "same-document"));
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Market", exact: true })
      .click();
    await page.waitForFunction(() => window.__loops.size === 2);
    for (const name of ["Market", "Encounters", "Party", "Library"]) {
      await page
        .locator('nav[aria-label="Sections"]:visible')
        .getByRole("link", { name, exact: true })
        .click();
      await page.waitForFunction(() => window.__loops.size === 2);
      assert.equal(await page.evaluate(() => window.soundNavigationMarker), "same-document");
      assert.equal(await page.locator(".loot-opening").count(), 0);
    }
    // A controlled visibility event exercises the real listener without timing an OS tab switch.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => window.__loops.size), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(() => window.__loops.size === 2);
    await page.locator(".settings-trigger").click();
    const management = page.getByRole("dialog", { name: "Settings & Management", exact: true });
    if (
      (await management
        .getByRole("button", { name: "Appearance & notifications", exact: true })
        .getAttribute("aria-expanded")) !== "true"
    )
      await management
        .getByRole("button", { name: "Appearance & notifications", exact: true })
        .click();
    await management.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.keyboard.press("Escape");
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Market", exact: true })
      .click();
    await page.waitForFunction(() => window.__loops.size === 2);
    assert.ok(audioRequests.some((url) => url.endsWith("/water.mp3")));
    await page.locator(".settings-trigger").click();
    if (
      (await management
        .getByRole("button", { name: "Appearance & notifications", exact: true })
        .getAttribute("aria-expanded")) !== "true"
    )
      await management
        .getByRole("button", { name: "Appearance & notifications", exact: true })
        .click();
    const managementMenus = management.getByRole("group", {
      name: "Menu music and ambience",
      exact: true,
    });
    await expect(managementMenus.getByLabel("Menu music volume", { exact: true })).toHaveValue(
      "17",
    );
    await expect(managementMenus.getByLabel("Ambient sound volume", { exact: true })).toHaveValue(
      "12",
    );
    await managementMenus.getByLabel("Enable menu music").uncheck();
    await page.waitForFunction(() => window.__loops.size === 1);
    await managementMenus.getByLabel("Ambient sound volume", { exact: true }).fill("0");
    await page.waitForFunction(() => window.__loops.size === 0);
    await managementMenus.getByLabel("Enable ambient sound").uncheck();
    await page.keyboard.press("Escape");
    for (const file of ["town", "study", "mystery", "fire", "water", "crickets", "dungeon"])
      assert.ok(
        audioRequests.some((url) => url.endsWith(`/${file}.mp3`)),
        `${file} really downloaded and decoded`,
      );
    await page
      .locator('nav[aria-label="Sections"]:visible')
      .getByRole("link", { name: "Desk", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.__loops.size), 0);
    // A new document retains preferences but never starts audio by itself.
    await page.goto(origin + "/settings");
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__audioStarts), 0);
    await openApplication(page, origin + "/settings");
    await page.getByText("Sound effects", { exact: true }).click();
    await expect(menus.getByLabel("Menu music volume", { exact: true })).toHaveValue("17");
    await expect(menus.getByLabel("Ambient sound volume", { exact: true })).toHaveValue("0");
    await expect(menus.getByLabel("Enable menu music")).not.toBeChecked();
    await expect(menus.getByLabel("Enable ambient sound")).not.toBeChecked();
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
    "Sound settings passed: desktop/mobile, real WAV effects and seven MP3 loops decoded, independent saved controls, same-document scene/theme switches, volume without restarts, hidden-tab cleanup, fresh-document silence and no runtime errors.",
  );
} finally {
  await browser.close();
}
