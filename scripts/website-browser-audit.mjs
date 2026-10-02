import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
const output = process.env.WEBSITE_SCREENSHOTS || "test-results/website";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const failures = [];
const externalFailures = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => failures.push(e.message));
    page.on("requestfailed", (r) => {
      const entry = { url: r.url(), error: r.failure()?.errorText };
      (r.url().startsWith(origin) ? failures : externalFailures).push(entry);
    });
    for (const [path, heading] of [
      ["welcome", "More adventure."],
      ["downloads", "One party. Your platform."],
      ["updates", "Changelog"],
      ["help", "A little help, adventurer."],
      ["resources", "Resources & credits"],
      ["donate", "Support Lootsplit"],
    ]) {
      const response = await page.goto(`${origin}/${path}`, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${path} overflows ${width}`,
      );
      await page.screenshot({ path: `${output}/${path}-${width}.png`, fullPage: true });
    }
    await page.getByRole("link", { name: "Downloads", exact: true }).first().click();
    await page.getByRole("heading", { name: "One party. Your platform." }).waitFor();
    const download = page.getByRole("link", { name: "Download for Android", exact: true });
    assert.equal(await download.getAttribute("href"), "/download/android");
    await page.getByText("Release details & file verification", { exact: true }).click();
    await page.locator(".ls-hash").waitFor({ state: "visible" });
    await page.getByRole("link", { name: "Installation & update guide" }).click();
    assert.match(page.url(), /\/help#android$/);
    await page.getByRole("link", { name: "Open app", exact: true }).click();
    await page.getByRole("link", { name: "Party", exact: true }).first().waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    await context.close();
  }
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({ ok: true, widths: [1280, 390], pages: 6, externalFailures }, null, 2),
  );
} finally {
  await browser.close();
}
