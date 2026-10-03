import { openApplication, reloadApplication } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8081";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [];
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openApplication(page, origin);
    await page.waitForTimeout(1800);
    // Optional onboarding is separate from the app workflows being audited.
    const no = page.getByRole("button", { name: "Not now", exact: true });
    if (await no.count()) await no.click();
    await page.getByRole("link", { name: "Add loot", exact: true }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("textbox", { name: "Holding name", exact: true }).fill("Audit ruby");
    await page.getByRole("textbox", { name: "Holding value", exact: true }).fill("12 gp");
    await page.getByRole("button", { name: "Add holding", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByText("Audit ruby", { exact: true }).waitFor();
    await reloadApplication(page);
    await page.getByText("Audit ruby", { exact: true }).waitFor();
    results.push({ viewport, check: "add holding and retain it after reload", passed: true });
    for (const route of ["/", "/market", "/party", "/catalog", "/books", "/share", "/settings"]) {
      await openApplication(page, origin + route);
      await page.waitForTimeout(400);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        ),
        false,
        `overflow at ${route}`,
      );
      assert.ok((await page.locator("main").innerText()).trim().length > 0, `empty ${route}`);
    }
    if (viewport.width === 390) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      assert.ok(await page.getByRole("link", { name: "Share", exact: true }).isVisible());
    }
    results.push({ viewport, check: "all routes, mobile navigation, and overflow", passed: true });
    assert.deepEqual(errors, []);
    await openApplication(page, origin);
    await page.waitForTimeout(1700);
    await page.screenshot({
      path: `/workspace/screenshots/lootsplit-audited-${viewport.width}.png`,
      fullPage: false,
    });
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  await browser.close();
}
