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
  // Phones (320, 390), tablet (768) and desktop: no horizontal page scroll anywhere.
  const widths = [1280, 768, 390, 320];
  for (const width of widths) {
    // Each viewport is its own simulated visitor on disposable local servers, so
    // 32 public page loads do not spend the shared per-address account limit
    // that later audit steps rely on. Live audits never send this header.
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      extraHTTPHeaders: local
        ? { "cf-connecting-ip": `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::1` }
        : {},
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => failures.push(e.message));
    page.on("requestfailed", (r) => {
      const entry = { url: r.url(), error: r.failure()?.errorText };
      (r.url().startsWith(origin) ? failures : externalFailures).push(entry);
    });
    for (const [path, heading] of [
      ["welcome", "Split the loot."],
      ["features", "Features"],
      ["downloads", "One party."],
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
      // One header, one consistent app link label, and a footer route to release details.
      assert.equal(await page.locator(".ls-header").count(), 1);
      assert.equal(await page.locator(".portal-header").count(), 0);
      const appLink = page.getByRole("link", { name: "Open the app", exact: true }).first();
      assert.equal(await appLink.isVisible(), true, `${path} app link hidden at ${width}`);
      assert.ok((await appLink.boundingBox()).height >= 44, `${path} app link target ${width}`);
      for (const old of ["Open app", "Open browser app", "Start your ledger"])
        assert.equal(await page.getByRole("link", { name: old, exact: true }).count(), 0);
      const identity = page.locator(".ls-footer-identity");
      assert.match(
        await identity.innerText(),
        new RegExp(`Android ${release.version.replaceAll(".", "\\.")} \\(code ${release.versionCode}\\)`),
      );
      assert.match(await identity.getAttribute("href"), /\/downloads#release-details$/);
      assert.equal(await page.getByText("About this app & releases", { exact: true }).count(), path === "downloads" ? 1 : 0);
      const current = path === "welcome" ? null : `/${path}`;
      if (current)
        assert.equal(
          await page.locator(`.ls-header nav a[href="${current}"]`).getAttribute("aria-current"),
          "page",
        );
      if (width <= 768) {
        // The header collapses into an accessible menu button on phones and tablets.
        const menu = page.getByRole("button", { name: "Menu", exact: true });
        const nav = page.locator(".ls-header nav");
        assert.equal(await nav.isVisible(), false);
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        await menu.click();
        assert.equal(await menu.getAttribute("aria-expanded"), "true");
        for (const label of ["Features", "Downloads", "Changelog", "Help", "Resources", "Donate", "My account"])
          await nav.getByRole("link", { name: label, exact: true }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(await nav.isVisible(), false);
      }
      if (path === "account") {
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
      if (path === "features") {
        // Nine numbered areas, each reachable from its jump chip, with real screenshots.
        for (const id of ["money", "characters", "markets", "world", "encounters", "downtime", "together", "library", "platforms"]) {
          assert.equal(await page.locator(`section#${id} h2`).count(), 1, id);
          assert.equal(await page.locator(`nav[aria-label="Feature areas"] a[href="#${id}"]`).count(), 1, id);
        }
        const images = await page.locator("main img[src^='/product/']").evaluateAll((nodes) =>
          nodes.map((img) => ({ alt: img.alt, width: img.getAttribute("width"), loading: img.loading })),
        );
        assert.ok(images.length >= 9);
        for (const image of images) {
          assert.ok(image.alt.length > 20 && image.width && image.loading === "lazy", JSON.stringify(image));
        }
      }
      if (path === "updates") {
        const latest = page.locator(`#android-${release.version.replaceAll(".", "\\.")}`);
        await latest
          .getByRole("heading", { name: `Version ${release.version}`, exact: true })
          .waitFor();
        const categories = [];
        for (const category of ["Added features", "Improvements", "Bug fixes"])
          if (await latest.getByRole("heading", { name: category, exact: true }).count())
            categories.push(category);
        assert.ok(categories.length >= 1);
        assert.equal(await latest.locator("ul").count(), categories.length);
        // Filters are real client state with aria-pressed.
        const all = page.getByRole("button", { name: "All releases", exact: true });
        const android = page.getByRole("button", { name: "Android", exact: true });
        const web = page.getByRole("button", { name: "Website and backend", exact: true });
        assert.equal(await all.getAttribute("aria-pressed"), "true");
        const webEntries = page.locator('article[id^="web-"]');
        const androidEntries = page.locator('article[id^="android-"]');
        assert.ok((await webEntries.count()) >= 1 && (await androidEntries.count()) >= 1);
        await android.click();
        assert.equal(await android.getAttribute("aria-pressed"), "true");
        assert.equal(await all.getAttribute("aria-pressed"), "false");
        assert.equal(await webEntries.first().isVisible(), false);
        assert.equal(await androidEntries.first().isVisible(), true);
        await web.click();
        assert.equal(await webEntries.first().isVisible(), true);
        assert.equal(await androidEntries.first().isVisible(), false);
        await all.click();
        assert.equal(await androidEntries.first().isVisible(), true);
        // Older Android releases stay available behind a disclosure.
        const older = androidEntries.nth(1);
        await older.getByText(/^Show changes/).click();
        assert.ok((await older.locator("li").count()) > 0);
      }
      if (path === "downloads") {
        const details = page.locator("#release-details");
        await details.getByText(/Browser · Client release label/).waitFor();
        const identityText = await details.innerText();
        assert.ok(
          identityText.includes(`Version ${release.version} · version code ${release.versionCode}`),
        );
        assert.equal(identityText.includes("Installed app version"), false);
        await details.getByRole("link", { name: "Web & backend history", exact: true }).waitFor();
        assert.equal(await page.locator(".ls-hash").textContent(), release.sha256);
        await page.getByText(`Permanently signed Android release, version code ${release.versionCode}.`, { exact: false }).waitFor();
        await page.getByRole("heading", { name: "Browser or Android?", exact: true }).waitFor();
        assert.equal(await page.locator(".ls-compare tbody tr").count(), 7);
        // The update notice keeps its guidance without naming old versions.
        const notice = await page.locator(".ls-notice").innerText();
        assert.match(notice, /Export a backup first/);
        assert.doesNotMatch(notice, /1\.3\.[01]/);
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
    await page.locator(".ls-hash").waitFor({ state: "visible" });
    assert.equal(await page.locator(".ls-hash").textContent(), release.sha256);
    await page.getByRole("link", { name: "Installation & update guide" }).click();
    assert.match(page.url(), /\/help#android$/);
    // Client-side navigation to the public Features tour keeps the document.
    await page.evaluate(() => (window.websiteAuditMarker = "kept"));
    await page.getByRole("link", { name: "Features", exact: true }).first().click();
    await page.getByRole("heading", { level: 1, name: "Features", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/features");
    assert.equal(await page.evaluate(() => window.websiteAuditMarker), "kept");
    assert.equal(await page.locator(".loot-opening").count(), 0);
    await page.getByRole("link", { name: "Open the app", exact: true }).first().click();
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
    JSON.stringify({ ok: true, widths: [1280, 768, 390, 320], pages: 8, externalFailures }, null, 2),
  );
} finally {
  await browser.close();
}
