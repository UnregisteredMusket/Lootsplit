import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/themes";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
let page;
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
    // A retained legacy look clears the fantasy finish; custom colors still persist.
    await page.getByRole("button", { name: "Grove", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.fantasyTheme === "");
    assert.equal(await page.getByLabel("Page color", { exact: true }).inputValue(), "#10241c");
    await reloadApplication(page);
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--color-bg") === "#10241c");
    assert.equal(await page.getByRole("button", { name: "Grove", exact: true }).getAttribute("aria-pressed"), "true");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Fantasy themes: both settings controls, light ink contrast, reload persistence, legacy colors, mobile/desktop fit passed.");
} catch (e) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    await writeFile(`${output}/failure.txt`, await page.locator("body").innerText());
  }
  throw e;
} finally { await browser.close(); }
