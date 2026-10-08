import { openApplication, continueIntoApp } from "./title-screen-navigation.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { verifyAndroidDownload } from "./android-download-audit.mjs";
import { readFileSync } from "node:fs";
const release = JSON.parse(readFileSync("src/lib/website/release.json", "utf8"));
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
      ["account", "Welcome to your next chapter."],
    ]) {
      const response = await openApplication(page, `${origin}/${path}`, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      await page.getByRole("heading", { level: 1 }).filter({ hasText: heading }).waitFor();
      if (path === "account") {
        assert.equal(await page.locator(".ls-header").count(), 1);
        assert.equal(await page.locator(".portal-header").count(), 0);
        assert.equal(
          await page.locator('.ls-header nav a[href="/account"]').getAttribute("aria-current"),
          "page",
        );
        const theme = await page.evaluate(() => {
          const site = getComputedStyle(document.querySelector(".ls-site"));
          const account = getComputedStyle(document.querySelector(".ls-account"));
          return {
            siteBackground: site.backgroundColor,
            accountBackground: account.backgroundColor,
            siteFont: site.fontFamily,
            accountFont: account.fontFamily,
            headingFont: getComputedStyle(document.querySelector(".ls-account h1")).fontFamily,
          };
        });
        assert.equal(theme.accountBackground, theme.siteBackground);
        assert.equal(theme.accountFont, theme.siteFont);
        assert.match(theme.headingFont, /Cormorant Garamond/);
      }
      if (path === "updates") {
        await page.getByRole("heading", { name: "Web & backend", exact: true }).waitFor();
        await page.getByRole("heading", { name: "Android releases", exact: true }).waitFor();
        const latest = page
          .locator(".ls-release")
          .filter({
            has: page.getByRole("heading", { name: `Version ${release.version}`, exact: true }),
          });
        await latest
          .getByRole("heading", { name: `Version ${release.version}`, exact: true })
          .waitFor();
        for (const category of ["Added features", "Improvements", "Bug fixes"])
          await latest.getByRole("heading", { name: category, exact: true }).waitFor();
        assert.equal(await latest.locator("ul").count(), 3);
      }
      if (path === "welcome") {
        await page.getByText("About this app & releases", { exact: true }).click();
        await page.getByText(/Browser · Client release label/).waitFor();
        const identityText = await page.locator(".ls-about").innerText();
        assert.ok(
          identityText.includes(`Version ${release.version} · version code ${release.versionCode}`),
        );
        assert.equal(identityText.includes("Installed app version"), false);
        await page.getByRole("link", { name: "Web & backend history", exact: true }).waitFor();
      }
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
    assert.equal(await page.locator(".ls-hash").textContent(), release.sha256);
    await page
      .getByText(`Permanently signed Android release, version code ${release.versionCode}.`, {
        exact: false,
      })
      .waitFor();
    await page.getByRole("link", { name: "Installation & update guide" }).click();
    assert.match(page.url(), /\/help#android$/);
    await page.getByRole("link", { name: "Open app", exact: true }).click();
    await continueIntoApp(page);
    await page
      .getByText(
        "Create an account or sign in to proceed as a Dungeon Master in your own campaign",
        { exact: true },
      )
      .waitFor();
    await page.getByRole("link", { name: "Create an account or sign in", exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await indexedDB.databases()).length), 0);
    assert.equal(new URL(page.url()).pathname, "/");
    await context.close();
  }
  assert.deepEqual(failures, []);
  // Local fixtures keep their existing route checks; remote live audits also hash the APK bytes.
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
    const downloadReport = await verifyAndroidDownload(origin, release);
    await writeFile(`${output}/android-download.json`, JSON.stringify(downloadReport, null, 2));
    console.log(`PASS live Android ${release.version}: ${downloadReport.sha256}`);
  }
  console.log(
    JSON.stringify({ ok: true, widths: [1280, 390], pages: 7, externalFailures }, null, 2),
  );
} finally {
  await browser.close();
}
