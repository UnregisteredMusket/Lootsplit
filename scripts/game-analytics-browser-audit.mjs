import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = process.env.ANALYTICS_SCREENSHOTS || "test-results/analytics";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await context.request.get(origin + "/api/account/site-analytics");
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.deepEqual(Object.keys(data.metrics), ["spentCopper"]);
    assert.equal(Number.isSafeInteger(data.metrics.spentCopper), true);
    assert.equal(
      (await context.request.get(origin + "/api/account/owner/analytics")).status(),
      401,
    );
    await openApplication(page, origin + "/welcome");
    await page.getByRole("status").filter({ hasText: "gp spent" }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `${output}/gold-${width}.png`, fullPage: true });
    await page.route("**/api/account/site-analytics", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Unavailable"}',
      }),
    );
    await page.reload();
    await page.getByText("Gold spent · temporarily unavailable", { exact: false }).waitFor();
    assert.equal(await page.getByRole("status").filter({ hasText: "0 gp spent" }).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Gold counter: public response, private denial, desktop/mobile and failure state passed.",
  );
} finally {
  await browser.close();
}
