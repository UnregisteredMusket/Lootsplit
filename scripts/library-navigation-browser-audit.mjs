import { prepareDmFixture } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] });
await mkdir("test-results/library-navigation", { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => {
      localStorage.setItem("quire.guide.offer.v3", "seen");
      sessionStorage.setItem("lootsplit.opening.dismissed.v1", "1");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await prepareDmFixture(page, origin); // Real account setup before the navigation assertions.
    await page.goto(origin);
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).waitFor();
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).click();
    await page.locator(".information-strip").waitFor();
    await page.locator(".settings-trigger").click();
    await page.getByRole("dialog").getByRole("button", {name:"Dashboard",exact:true}).click();
    await page.getByRole("link", {name:"Saved shortcut settings →",exact:true}).click();
    await page.getByLabel("Button 1", { exact: true }).selectOption("library");
    await page.getByRole("button", { name: "Save shortcuts", exact: true }).click();
    await page.evaluate(() => window.navigationTestMarker = "same-document");
    async function stillOpen() {
      assert.equal(await page.evaluate(() => window.navigationTestMarker), "same-document", "No document reload");
      assert.equal(await page.locator(".loot-opening").count(), 0, "Opening stays dismissed");
    }
    await page.locator(".shortcut-button").first().click();
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    await stillOpen();
    await page.screenshot({ path: `test-results/library-navigation/library-${width}.png` });
    for (const [name, pane, kind] of [["Creatures", "open5e", "creatures"], ["Spells", "open5e", "spells"], ["Names", "names", null]]) {
      await page.locator(".library-tiles a").filter({ hasText: name }).click();
      await page.getByRole("heading", { name: "Catalog", exact: true }).waitFor();
      const url = new URL(page.url());
      assert.equal(url.searchParams.get("pane"), pane);
      assert.equal(url.searchParams.get("kind"), kind);
      await stillOpen();
      await page.locator('nav[aria-label="Sections"]:visible').getByRole("link", { name: "Library", exact: true }).click();
      await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
      await stillOpen();
    }
    await page.locator(".library-tiles a").filter({ hasText: "Handouts" }).click();
    assert.equal(new URL(page.url()).hash, "#handouts");
    await stillOpen();
    await page.getByRole("link", { name: "Sources & licenses" }).click();
    await page.waitForURL("**/resources");
    await page.goBack();
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    await stillOpen();
    // Exercise actual reported entry points. Never use openApplication here:
    // that helper would dismiss the regression instead of detecting it.
    await page.locator('nav[aria-label="Sections"]:visible').getByRole("link", { name: "Desk", exact: true }).click();
    await page.locator(".information-strip").waitFor();
    if (width === 1440) {
      await page.getByRole("button", { name: /^Activity & balances/ }).click();
      await page.getByRole("link", { name: "Session journal →", exact: true }).click();
      await page.waitForURL(u=>u.pathname === "/features/journal");
      await page.locator("#journal").waitFor();
      await stillOpen();
      await page.goBack();
      await page.locator(".information-strip").waitFor();
    }
    await page.locator('nav[aria-label="Sections"]:visible').getByRole("link", { name: "Party", exact: true }).click();
    await page.getByRole("link", { name: "Ledger", exact: true }).click();
    await page.waitForURL(u=>u.pathname === "/features/reports");
    await page.getByRole("heading",{name:"Review Reports",exact:true}).waitFor();
    await stillOpen();
    await page.locator('nav[aria-label="Sections"]:visible').getByRole("link", { name: "Desk", exact: true }).click();
    await page.locator(".information-strip").waitFor();
    await page.locator(".settings-trigger").click();
    await page.locator(".management-footer").getByRole("link", { name: "My account", exact: true }).click();
    await page.waitForURL("**/account");
    await page.getByRole("heading", { name: "Disposable audit DM’s library", exact: true }).waitFor();
    await stillOpen();
    await page.screenshot({ path: `test-results/library-navigation/account-${width}.png` });
    await page.getByRole("link", { name: "Open app", exact: true }).click();
    await page.locator(".information-strip").waitFor();
    await stillOpen();
    await page.locator(".campaign-switcher").click();
    await page.getByRole("link", { name: "Saved account campaigns →", exact: true }).click();
    await page.waitForURL("**/account");
    await stillOpen();
    await page.goBack();
    await page.locator(".information-strip").waitFor();
    await stillOpen();
    await page.goForward();
    await page.waitForURL("**/account");
    await stillOpen();
    // A required data-context reload skips the full opening exactly once.
    await page.evaluate(() => sessionStorage.setItem("lootsplit.navigation.resume.v1", JSON.stringify({path:"/",at:Date.now()})));
    await page.goto(origin + "/");
    await page.locator(".information-strip").waitFor();
    assert.equal(await page.locator(".loot-opening").count(), 0);
    // Fresh document loads must restore the title, even with a legacy dismissal flag.
    await page.goto(origin + "/library");
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).click();
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await page.reload();
    await page.getByRole("button", { name: "Lootsplit. Click to continue", exact: true }).click();
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    assert.equal(await page.locator(".loot-opening").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: Library shortcut, navigation, query/hash destinations, Resources return, desktop/mobile; no document reload or repeated opening.");
} finally { await browser.close(); }
