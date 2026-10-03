import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/help";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/help");
    const search = page.getByRole("searchbox");
    await search.fill("downtime");
    await page.getByText("Preview downtime and start the next session", { exact: true }).waitFor();
    assert.ok((await page.locator(".help-topic[open]").count()) > 0);
    await search.fill("no-such-help-topic");
    await page.getByText("0 matching topics", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Install & update", exact: true }).click();
    assert.equal(await search.inputValue(), "");
    await page.goto(origin + "/help#android");
    await page.locator("#android[open]").waitFor();
    await page.goto(origin + "/help#downtime");
    await page.locator("#downtime[open]").waitFor();
    await page.screenshot({ path: `${output}/help-${width}.png`, fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.getByRole("link", { name: "Play sessions", exact: false }).click();
    // First entry into the application may show the one-time opening.
    const { continueIntoApp } = await import("./title-screen-navigation.mjs");
    await continueIntoApp(page);
    await page.locator('#sessions button[aria-expanded="true"]').waitFor();
    await openApplication(page, origin + "/settings#appearance");
    await page.getByLabel("Accent color", { exact: true }).waitFor();
    await openApplication(page, origin + "/?view=home#management");
    await page.getByRole("dialog", { name: "Settings & Management", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "How Lootsplit works", exact: true });
    await guide.getByRole("searchbox").fill("encounter");
    await guide.getByText("Build, run and import encounters", { exact: true }).waitFor();
    await guide.getByRole("link", { name: "Encounter builder & tracker", exact: false }).click();
    await page.locator(".encounter-workspace").waitFor();
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await openApplication(page, origin + "/share?tab=rolls");
    await page.getByRole("tab", { name: "Rolls", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("tab", { name: "Rolls", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    await openApplication(page, origin + "/?view=overview#campaign-finance");
    await page.locator("#campaign-finance[open]").waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Help: search, jump navigation, legacy anchors, settings/finance/session links and in-app guide passed at desktop/mobile widths.",
  );
} finally {
  await browser.close();
}
