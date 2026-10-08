import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/themes";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ["--no-sandbox"] });
let page;
async function checkScene(scene, mode, width, title) {
  // Router pathname updates before a lazy destination finishes rendering.
  // Wait for its actual heading before inspecting or capturing that workspace.
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await page.waitForFunction(({ scene, mode }) => {
    const workspace = document.querySelector("[data-submenu-scene]");
    const img = workspace?.querySelector(".submenu-scenery img");
    return workspace?.getAttribute("data-submenu-scene") === scene && img?.complete &&
      img.naturalWidth > 0 && img.currentSrc.includes(`-${mode === "light" ? "day" : "night"}-`);
  }, { scene, mode });
  const img = page.locator(".submenu-scenery img");
  assert.equal(await img.getAttribute("alt"), "");
  assert.equal(await page.locator(".submenu-scenery").getAttribute("aria-hidden"), "true");
  const surface = await page.locator("main").evaluate(main => ({
    background: getComputedStyle(main).backgroundColor,
    ground: getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
    image: getComputedStyle(main).backgroundImage,
  }));
  assert.equal(surface.image, "none", "All controls retain a solid readable surface");
  assert.match(surface.background, /^rgb\(/, "Workspace background is opaque");
  const channels = surface.ground.slice(1).match(/../g).map(x => parseInt(x, 16));
  assert.equal(surface.background, `rgb(${channels.join(", ")})`, "Surface matches the tested theme contrast");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await img.evaluate(el => getComputedStyle(el).animationName), "none");
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${mode}-${scene}-${width}.png` });
}
async function clickSection(name) {
  await page.locator('nav[aria-label="Sections"]:visible').getByRole("link", { name, exact: true }).click();
  assert.equal(await page.evaluate(() => window.themeNavigationMarker), "same-document");
  assert.equal(await page.locator(".loot-opening").count(), 0);
}
try {
  // Vite's first dependency discovery can reload the client. Warm its actual entry
  // before collecting errors from the fresh, isolated test contexts below.
  const warmup = await browser.newPage();
  await openApplication(warmup, origin + "/settings#appearance");
  await warmup.getByLabel("Accent color", { exact: true }).waitFor();
  await warmup.waitForLoadState("networkidle");
  await warmup.close();
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await openApplication(page, origin + "/settings#appearance");
    for (const [mode, label, theme] of [
      ["light", "Light · Adventurer’s Ledger", "adventurers-ledger"],
      ["dark", "Dark · Ironbound Dragon", "ironbound-dragon"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction(t => document.documentElement.dataset.fantasyTheme === t, theme);
      await reloadApplication(page);
      await page.waitForFunction(t => document.documentElement.dataset.fantasyTheme === t, theme);
      assert.equal(await page.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"), "true");
      await checkScene("mage-tower-study", mode, width, "Settings");
      await openApplication(page, origin + "/?view=home");
      await page.locator(".readout").first().waitFor();
      await page.screenshot({ path: `${output}/${mode}-desk-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      // Measure the rendered foreground and tokens, rather than trusting appearance labels.
      const contrast = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        function lum(hex) {
          const v = hex.trim().match(/[a-f\d]{2}/gi).map(x => parseInt(x,16)/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
          return v[0]*.2126+v[1]*.7152+v[2]*.0722;
        }
        const bg = lum(root.getPropertyValue("--color-bg"));
        const fg = lum(root.getPropertyValue("--color-fg"));
        return { ratio:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05), darkInk: fg < bg };
      });
      assert.ok(contrast.ratio >= 4.5);
      assert.equal(contrast.darkInk, mode === "light");
      await page.evaluate(() => (window.themeNavigationMarker = "same-document"));
      for (const [name, scene] of [["Market", "market-street"], ["Encounters", "dungeon-corridor"], ["Party", "tavern"], ["Library", "ancient-library"]]) {
        await clickSection(name);
        await checkScene(scene, mode, width, name);
      }
      await page.getByRole("link", { name: "View all →", exact: true }).click();
      await checkScene("blacksmith", mode, width, "Catalog");
      await clickSection("Desk");
      await page.locator('.dm-tool-links a[href^="/features/journal"]').click();
      await checkScene("ancient-library", mode, width, "Journal");
      await page.getByLabel("Journal entry title", { exact: true }).fill("Unfinished scenery check");
      await page.getByLabel("Journal entry text", { exact: true }).fill("Keep this draft through theme changes.");
      await page.locator(".settings-trigger").click();
      const journalSettings = page.getByRole("dialog", { name: "Settings & Management", exact: true });
      await journalSettings.getByRole("button", { name: "Appearance & notifications", exact: true }).click();
      for (const nextMode of [mode === "light" ? "dark" : "light", mode]) {
        await journalSettings.getByLabel("Theme", { exact: true }).selectOption(nextMode);
        await page.waitForFunction(m => {
          const img = document.querySelector(".submenu-scenery img");
          return document.documentElement.dataset.appearance === m && img?.complete && img.naturalWidth > 0 &&
            img.currentSrc.includes(`-${m === "light" ? "day" : "night"}-`);
        }, nextMode);
      }
      await page.keyboard.press("Escape");
      assert.equal(await page.getByLabel("Journal entry title", { exact: true }).inputValue(), "Unfinished scenery check");
      assert.equal(await page.getByLabel("Journal entry text", { exact: true }).inputValue(), "Keep this draft through theme changes.");
      await page.getByLabel("Journal entry title", { exact: true }).fill("");
      await page.getByLabel("Journal entry text", { exact: true }).fill("");
      await page.locator(".feature-return a").click();
      await page.getByRole("button", { name: /^Economy & properties/ }).click();
      await page.locator('.dm-tool-links a[href^="/features/bank"]').click();
      await checkScene("throne-room", mode, width, "Bank");
      await page.locator(".feature-return a").click();
      await page.getByRole("button", { name: /^Economy & properties/ }).click();
      await page.locator('.dm-tool-links a[href^="/features/properties"]').click();
      await checkScene("village-square", mode, width, "Property Management");
      await page.locator(".feature-return a").click();
      assert.equal(await page.evaluate(() => window.themeNavigationMarker), "same-document");
      assert.equal(await page.locator(".loot-opening").count(), 0);
      await page.locator(".settings-trigger").click();
      const dialog = page.getByRole("dialog", { name: "Settings & Management", exact: true });
      await dialog.getByRole("button", { name: "Appearance & notifications", exact: true }).click();
      const select = dialog.getByLabel("Theme", { exact: true });
      assert.equal(await select.inputValue(), mode);
      await page.screenshot({ path: `${output}/${mode}-settings-${width}.png` });
      await select.selectOption(mode === "light" ? "dark" : "light");
      await page.waitForFunction(m => document.documentElement.dataset.appearance === m, mode === "light" ? "dark" : "light");
      await page.keyboard.press("Escape");
      await openApplication(page, origin + "/settings#appearance");
    }
    const backgrounds = page.getByRole("switch", { name: "Show fantasy backgrounds", exact: true });
    await backgrounds.click();
    await page.waitForFunction(() => !document.querySelector("[data-submenu-scene]"));
    await reloadApplication(page);
    assert.equal(await backgrounds.getAttribute("aria-checked"), "false");
    assert.equal(await page.locator(".submenu-scenery").count(), 0);
    await backgrounds.click();
    await page.waitForFunction(() => !!document.querySelector("[data-submenu-scene]"));
    // A retained legacy look clears the fantasy finish; custom colors still persist.
    await page.getByRole("button", { name: "Grove", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.fantasyTheme === "");
    assert.equal(await page.locator(".submenu-scenery").count(), 0);
    assert.equal(await page.getByLabel("Page color", { exact: true }).inputValue(), "#10241c");
    await reloadApplication(page);
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--color-bg") === "#10241c");
    assert.equal(await page.getByRole("button", { name: "Grove", exact: true }).getAttribute("aria-pressed"), "true");
    await openApplication(page, origin + "/settings#gameplay");
    const rolls = page.getByLabel("Roll mode", { exact: true });
    assert.equal(await rolls.inputValue(), "virtual");
    await rolls.selectOption("manual");
    await reloadApplication(page);
    assert.equal(await rolls.inputValue(), "manual");
    await rolls.selectOption("virtual");
    await reloadApplication(page);
    assert.equal(await rolls.inputValue(), "virtual");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Fantasy themes: both settings controls, eight decoded day/night scenes, real navigation, solid readable surfaces, scenery toggle/reload, legacy colors and mobile/desktop fit passed.");
} catch (e) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    await writeFile(`${output}/failure.txt`, await page.locator("body").innerText());
  }
  throw e;
} finally { await browser.close(); }
