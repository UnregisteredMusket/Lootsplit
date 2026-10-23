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
    // The home page shows the treasury only from 10,000 gp (owner decision 2026-10-23); a fresh
    // disposable database is far below that, so the display is checked with routed snapshots.
    const snapshotBody = (spentCopper) => JSON.stringify({ ...data, metrics: { spentCopper } });
    const serve = (body, status = 200) =>
      page.route("**/api/account/site-analytics", (route) =>
        route.fulfill({ status, contentType: "application/json", body }),
      );
    await serve(snapshotBody(2_500_000));
    await openApplication(page, origin + "/welcome");
    await page.getByRole("status").filter({ hasText: "gp spent" }).waitFor();
    assert.equal(await page.locator(".ls-ledger-entry").count(), 3);
    const explanation = page.getByText("About this total", { exact: true });
    await explanation.focus();
    await explanation.press("Enter");
    await page
      .getByText(/Recorded purchases and outgoing payments across current shared campaigns/)
      .waitFor({ state: "visible" });
    await page.getByText(/Snapshots are cached for up to a minute/).waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `${output}/gold-${width}.png`, fullPage: true });
    for (const [label, body, status] of [
      ["below threshold", snapshotBody(999_999), 200],
      ["unavailable", '{"error":"Unavailable"}', 503],
    ]) {
      await page.unroute("**/api/account/site-analytics");
      await serve(body, status);
      await page.reload();
      await page.getByText("Three ways to play", { exact: true }).waitFor();
      await page.waitForLoadState("networkidle");
      assert.equal(await page.getByText("The treasury", { exact: true }).count(), 0, label);
      assert.equal(await page.locator(".ls-ledger-entry").count(), 2, label);
      assert.equal(
        await page.getByRole("status").filter({ hasText: "gp spent" }).count(),
        0,
        label,
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Gold counter: public response, private denial, shown from 10,000 gp, hidden below it and on failure, desktop/mobile passed.",
  );
} finally {
  await browser.close();
}
