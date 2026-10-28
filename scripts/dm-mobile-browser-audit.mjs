// DM phone and Android shell (design plan M3) in a disposable device campaign seeded with the
// synthetic "Wayfarers" fixture: one Android Back step (`androidBackStep`, the chain the shell's
// hardware Back listener runs) closes an open record picker, an inventory row's ⋯ menu and the
// Restock dialog, one at a time, without navigating; with nothing open it falls through so the
// shell navigates back (or, at the app root with a campaign open, asks for a second press).
// Runs at 1280, 390 and 320 px and 844×390. Never targets a real campaign.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { expect } from "playwright/test";
import { continueIntoApp, openApplication } from "./title-screen-navigation.mjs";
import { buildWayfarers } from "./product-screenshot-fixture.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("The DM mobile audit changes a disposable campaign; run it only locally.");
const out = `${process.env.AUDIT_RESULTS_DIR || "test-results"}/dm-mobile`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const VIEWS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 760 },
  { width: 844, height: 390 },
];
const table = buildWayfarers();
const noOverflow = async (page, label) =>
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    `${label}: the page scrolls sideways`,
  );
/** One Android hardware Back press, as the shell's listener runs it (after themed dialogs). */
const androidBack = (page) =>
  page.evaluate(async () => (await import("/src/lib/mobile/back-chain.ts")).androidBackStep());

try {
  for (const view of VIEWS) {
    const label = `${view.width}x${view.height}`;
    const phone = view.width < 600 || view.height < 600;
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      isMobile: phone,
      hasTouch: phone,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => localStorage.setItem("quire.guide.offer.v3", "seen"));
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin + "/", { waitUntil: "networkidle" });
    await page.evaluate(async (t) => {
      const { applyCloudTable } = await import("/src/lib/quire/economy.ts");
      await applyCloudTable(t);
    }, table);

    // --- M3: Android Back closes the newest overlay first and never navigates while one is open.
    await page.goto(origin + "/market");
    await continueIntoApp(page);
    const url = page.url();
    const picker = page.getByRole("combobox", { name: "Market location", exact: true });
    await picker.click();
    const menu = page.locator(".record-select-menu");
    await expect(menu).toBeVisible();
    assert.equal(await androidBack(page), true, `${label}: Back consumes the open picker`);
    await expect(menu).toHaveCount(0);
    assert.equal(page.url(), url, `${label}: closing the picker does not navigate`);

    await page.getByRole("button", { name: "Restock", exact: true }).first().click();
    const restock = page.getByRole("dialog", { name: /^Restock / });
    await expect(restock).toBeVisible();
    assert.equal(await androidBack(page), true, `${label}: Back consumes the Restock dialog`);
    await expect(restock).toHaveCount(0);
    assert.equal(page.url(), url);

    await page.goto(origin + "/party?section=funds");
    await continueIntoApp(page);
    const actions = page.getByRole("button", { name: "Actions for Longbow", exact: true }).first();
    await actions.click();
    const rowMenu = page.getByRole("menu", { name: "Actions for Longbow" });
    await expect(rowMenu).toBeVisible();
    const partyUrl = page.url();
    assert.equal(await androidBack(page), true, `${label}: Back consumes the row menu`);
    await expect(rowMenu).toHaveCount(0);
    assert.equal(page.url(), partyUrl);
    // Nothing open: the chain falls through, so the shell navigates back (or warns at the root).
    assert.equal(await androidBack(page), false, `${label}: with nothing open Back navigates`);
    await noOverflow(page, `party ${label}`);
    await page.screenshot({ path: `${out}/back-chain-${label}.png` });

    assert.deepEqual(errors, [], `${label}: no page errors`);
    await context.close();
  }
  console.log("DM mobile audit passed at 1280, 390, 320 and 844x390.");
} finally {
  await browser.close();
}
