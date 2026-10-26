// Phone landscape and the title prompt (design plan M2, D10 / dm #13, #27) in a disposable device
// campaign seeded with the synthetic "Wayfarers" fixture:
// - at 844×390 the six tabs are a 56 px icon rail on the left (names kept as accessible labels),
//   content starts right of it, and the header slides away scrolling down and returns scrolling
//   up; Maps keeps its own chrome (no rail);
// - at 390, 320 and 1280 the bottom bar and desktop rail are unchanged;
// - the title screen says "Tap to continue" on touch screens and "Click to continue" with a mouse,
//   and after a campaign was opened it offers "Continue · <campaign> · Session N";
// - the Campaigns dialog lists the other campaigns by last opened, with the time.
// Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication, TITLE_SCREEN } from "./title-screen-navigation.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The landscape audit changes a disposable campaign; run it only locally.");
const out = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/landscape`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const VIEWS = [
  { width: 844, height: 390, landscape: true },
  { width: 390, height: 844 },
  { width: 320, height: 760 },
  { width: 1280, height: 800 },
];
const table = buildWayfarers();
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
const box = (locator) => locator.evaluate((el) => el.getBoundingClientRect().toJSON());

try {
  for (const view of VIEWS) {
    const label = `${view.width}x${view.height}`;
    const touch = view.width < 1000;
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      isMobile: touch,
      hasTouch: touch,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Title: "Tap" on touch screens, "Click" with a mouse; no campaign to continue yet.
    await page.goto(origin + "/welcome");
    await page.evaluate(() => localStorage.removeItem("lootsplit.campaign-recents.v1"));
    await openApplication(page, origin + "/", { waitUntil: "networkidle" });
    await page.evaluate(async (t) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      await applyCloudTable(t);
    }, table);
    await page.goto(origin + "/party?section=funds");
    const title = page.getByRole("button", { name: TITLE_SCREEN });
    await title.waitFor();
    const verb = touch ? "tap" : "click";
    await expect(page.locator(".loot-opening-continue")).toHaveText(`${verb} to continue`);
    await continueIntoApp(page);
    await page.locator(".party-inventory").waitFor();

    const tabs = page.locator("nav.loot-tabbar");
    if (view.landscape) {
      // M2: a 56 px icon rail on the left, full height, labels kept for assistive technology.
      const rail = await box(tabs);
      assert.equal(Math.round(rail.left), 0, `${label}: rail at the left edge`);
      assert.ok(rail.width >= 55 && rail.width <= 58, `${label}: rail is 56 px wide (${rail.width})`);
      assert.ok(rail.height >= view.height - 1, `${label}: rail spans the height`);
      for (const name of ["Desk", "Party", "Market"])
        await expect(tabs.getByRole("link", { name, exact: true })).toBeVisible();
      const labelBox = await box(tabs.locator(".loot-nav-label").first());
      assert.ok(labelBox.width <= 1, `${label}: tab names are not drawn in the rail`);
      const main = await box(page.locator("#main"));
      assert.ok(main.left >= 56, `${label}: content starts right of the rail (${main.left})`);
      // The header slides away scrolling down and returns scrolling up.
      const header = page.locator("header.loot-header");
      await page.mouse.wheel(0, 900);
      await expect(header).toHaveAttribute("data-scrolled-away", "true");
      await expect.poll(async () => (await box(header)).bottom).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${out}/rail-scrolled-${label}.png` });
      await page.mouse.wheel(0, -200);
      await expect(header).not.toHaveAttribute("data-scrolled-away", "true");
      await expect.poll(async () => (await box(header)).top).toBeGreaterThanOrEqual(-1);
      // Keyboard focus in the header brings it back too.
      await page.mouse.wheel(0, 600);
      await expect(header).toHaveAttribute("data-scrolled-away", "true");
      await header.locator(".campaign-switcher").focus();
      await expect(header).not.toHaveAttribute("data-scrolled-away", "true");
    } else if (view.width < 1024) {
      // Portrait phones keep the bottom bar with visible names.
      const bar = await box(tabs);
      assert.ok(Math.abs(bar.bottom - view.height) <= 1, `${label}: bottom bar at the bottom`);
      assert.ok(bar.width >= view.width - 1, `${label}: bottom bar spans the width`);
      assert.ok((await box(tabs.locator(".loot-nav-label").first())).width > 10);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(300);
      assert.equal(await page.locator("header.loot-header[data-scrolled-away]").count(), 0);
    } else {
      await expect(tabs).toBeHidden();
    }
    await noOverflow(page, `party ${label}`);
    await page.screenshot({ path: `${out}/party-${label}.png` });

    // Maps keeps its own rails: the app's tab rail is not shown there.
    if (view.landscape) {
      await page.goto(origin + "/maps");
      await continueIntoApp(page);
      await page.locator(".map-workspace").first().waitFor();
      await expect(tabs).toBeHidden();
    }

    // The Campaigns dialog lists the other campaigns by last opened.
    const recents = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("lootsplit.campaign-recents.v1") || "null"),
    );
    assert.ok(recents?.last && recents.campaigns[recents.last], `${label}: the open campaign is recorded`);
    const first = recents.campaigns[recents.last];
    assert.ok(first.session >= 1, `${label}: its session number is recorded`);
    if (view.width === 844 || view.width === 1280) {
      await page.goto(origin + "/party");
      await continueIntoApp(page);
      await page.locator(".campaign-switcher").click();
      const campaigns = page.getByRole("dialog", { name: "Campaigns", exact: true });
      await campaigns.getByLabel("New campaign name", { exact: true }).fill(`Audit Second ${label}`);
      await campaigns.getByRole("button", { name: "New campaign", exact: true }).click();
      await expect(page.locator(".campaign-switcher")).toContainText(`Audit Second ${label}`);
      // Creating a campaign opens it in place; the dialog stays open.
      if (!(await campaigns.isVisible())) await page.locator(".campaign-switcher").click();
      const list = campaigns.getByRole("list", { name: "Recent campaigns" });
      const item = list.getByRole("listitem").filter({ hasText: first.name }).first();
      await expect(item).toContainText(`Opened today · Session ${first.session}`);
      await noOverflow(page, `campaigns ${label}`);
      await page.screenshot({ path: `${out}/campaigns-${label}.png` });
      await page.keyboard.press("Escape");
    }

    // A fresh launch offers the last campaign by name and session.
    const fresh = await context.newPage();
    await fresh.goto(origin + "/");
    await fresh.getByRole("button", { name: TITLE_SCREEN }).waitFor();
    await expect(fresh.locator(".loot-opening-prompt")).toHaveText(
      // The seeded campaign names its session; the blank one created above has none yet.
      view.width === 844 || view.width === 1280
        ? `Continue · Audit Second ${label}`
        : new RegExp(`^Continue · .+ · Session ${first.session}$`),
    );
    const promptBox = await box(fresh.locator(".loot-opening-prompt"));
    assert.ok(promptBox.left >= 0 && promptBox.right <= view.width, `${label}: prompt fits`);
    await expect(fresh.getByRole("button", { name: TITLE_SCREEN })).toHaveAccessibleName(
      new RegExp(`^Lootsplitter\\. ${touch ? "Tap" : "Click"} to continue\\. Continue · `),
    );
    await fresh.screenshot({ path: `${out}/title-${label}.png` });
    await fresh.close();

    assert.deepEqual(errors, [], `${label}: no page errors`);
    await context.close();
  }
  console.log("Landscape audit passed at 844x390, 390, 320 and 1280.");
} finally {
  await browser.close();
}
