// Visual review captures of the public website pages. Run only against a
// disposable local server: node scripts/capture-site-screenshots.mjs
// Output: SITE_SCREENSHOTS (default test-results/site) / <page>-<width>.png
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openApplication } from "./title-screen-navigation.mjs";

const origin = process.env.AUDIT_ORIGIN || "http://127.0.0.1:8080";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Disposable local server required.");
const output = process.env.SITE_SCREENSHOTS || "test-results/site";
const pages = ["welcome", "features", "downloads", "updates", "help", "resources", "donate"];
const widths = (process.env.SITE_SCREENSHOT_WIDTHS || "390,1440,320,768")
  .split(",")
  .map(Number);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox"],
});
const report = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    for (const path of pages) {
      await openApplication(page, `${origin}/${path}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      await page.waitForFunction(() => document.fonts.status === "loaded");
      // Lazy screenshots load as they scroll into view; load them all first.
      await page.evaluate(async () => {
        for (const img of document.querySelectorAll("img[loading=lazy]")) img.loading = "eager";
        await Promise.all(
          [...document.images].map((img) =>
            img.complete ? null : new Promise((done) => img.addEventListener("load", done, { once: true })),
          ),
        );
      });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const fonts = await page.evaluate(() =>
        [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.style} ${f.weight}`),
      );
      report.push({ path, width, overflow, fonts: fonts.length });
      await page.screenshot({ path: `${output}/${path}-${width}.png`, fullPage: true });
      if (width < 1100 && path === "welcome") {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await page.screenshot({ path: `${output}/${path}-${width}-menu.png` });
        await page.keyboard.press("Escape");
      }
    }
    await context.close();
  }
  console.log(JSON.stringify(report, null, 2));
  const wide = report.filter((item) => item.overflow > 0);
  if (wide.length) throw Error(`Horizontal overflow: ${JSON.stringify(wide)}`);
} finally {
  await browser.close();
}
