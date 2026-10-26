import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openApplication, prepareDmFixture } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = "test-results/help";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
let activePage;
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/help");
    // W-3: the public Help page opens the DM guide, and visitors switch guides explicitly.
    const switcher = page.getByRole("group", { name: "Guide for", exact: true });
    const players = switcher.getByRole("button", { name: "Players", exact: true });
    const dms = switcher.getByRole("button", { name: "Dungeon Masters", exact: true });
    await page.getByRole("heading", { name: "Dungeon Master guide", exact: true }).waitFor();
    assert.equal(await dms.getAttribute("aria-pressed"), "true");
    await players.click();
    await page.getByRole("heading", { name: "Player guide", exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("guide"), "player");
    assert.equal(await players.getAttribute("aria-pressed"), "true");
    // The player guide keeps its rule: no DM setup links.
    assert.equal(
      await page.locator(".help-guide").getByRole("link", { name: /DM books|Encounter builder|Player reference controls|Saved DM shortcut/ }).count(),
      0,
    );
    await page.goto(origin + "/help?guide=dm");
    await page.getByRole("heading", { name: "Dungeon Master guide", exact: true }).waitFor();
    await page.goto(origin + "/help?guide=player#references");
    await page.locator("#references[open]").waitFor();
    // An older link to a topic only the player guide has still opens it.
    await page.goto(origin + "/help#multiple-windows");
    await page.getByRole("heading", { name: "Player guide", exact: true }).waitFor();
    await page.locator("#multiple-windows[open]").waitFor();
    await page.goto(origin + "/help");
    const search = page.getByRole("searchbox");
    await search.fill("downtime");
    await page.locator("#downtime[open]").waitFor();
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
    // Public help stays anonymous; protected destinations require a real DM account.
    await prepareDmFixture(page, origin);
    const offer = page.getByRole("dialog", { name: "View the instructions?", exact: true });
    await offer.getByRole("button", { name: "Not now", exact: true }).click();
    await offer.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => localStorage.getItem("quire.guide.offer.v3")), "no");
    await openApplication(page, origin + "/help#downtime");
    await page.locator("#downtime[open]").waitFor();
    await page.getByRole("link", { name: "Play sessions", exact: false }).click();
    // First entry into the application may show the one-time opening.
    const { continueIntoApp } = await import("./title-screen-navigation.mjs");
    await continueIntoApp(page);
    await page.locator('#sessions button[aria-expanded="true"]').waitFor();
    assert.equal(await offer.count(), 0, "The dismissed offer stays dismissed after a cold entry");
    await openApplication(page, origin + "/settings#appearance");
    await page.getByLabel("Accent color", { exact: true }).waitFor();
    await openApplication(page, origin + "/?view=home#management");
    await page.getByRole("dialog", { name: "Settings & Management", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "How Lootsplitter works", exact: true });
    await guide.getByRole("searchbox").fill("encounter");
    await guide.locator("#guide-encounters > summary").waitFor();
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
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/failure.png`, fullPage: true });
    await writeFile(`${output}/failure.txt`, await activePage.locator("body").innerText());
  }
  throw error;
} finally {
  await browser.close();
}
await import("./player-reference-browser-audit.mjs");
